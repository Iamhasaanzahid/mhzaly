#!/usr/bin/env node
/**
 * Professional international outreach for mhzaly.
 * Sends a short, honest, English email ONLY to real international businesses
 * found via OpenStreetMap that published a contact email.
 * From owner's Gmail (private env file), cap 20/day, opt-out in every mail.
 *
 *   node tools/international-outreach.mjs --dry
 *   node tools/international-outreach.mjs --send
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const ENVFILE = path.join(os.homedir(), '.automaton', 'mhzaly-gmail.env');
const LEADS = path.join(OUT, 'international-leads.json');
const SENT = path.join(OUT, 'international-sent.json');
const LOG = path.join(OUT, 'international-send.log');
const CAP = Math.max(1, parseInt(process.env.EMAIL_DAILY_CAP || '20', 10));
const SEND = process.argv.includes('--send');
const SITE = 'https://mhzaly.pages.dev/?ref=mhzaly-sales#/login';
const DEMO = 'https://mhzaly.pages.dev/sell';

const env = {};
for (const line of fs.readFileSync(ENVFILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}
const USER = env.GMAIL_USER, PASS = env.GMAIL_APP_PASSWORD;
if (!USER || !PASS) { console.error('Gmail credentials missing'); process.exit(1); }

const done = new Set();
try { for (const e of JSON.parse(fs.readFileSync(SENT, 'utf8'))) done.add(e); } catch {}

// real intl leads with a clean published email
const raw = JSON.parse(fs.readFileSync(LEADS, 'utf8'));
const list = [];
for (const x of raw) {
  const emails = String(x.email || '').split(/[;,]/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s));
  for (const email of emails.slice(0, 1)) {
    if (done.has(email.toLowerCase())) continue;
    list.push({ ...x, email });
  }
}
const queue = list.slice(0, CAP);
console.log(`Intl outreach: ${USER} · real email leads=${list.length} · already sent=${done.size} · this run=${queue.length} · mode=${SEND ? 'SEND' : 'dry'}`);

function message(x) {
  const subject = `${x.name} — a simpler way to run your shop`;
  const body = `Hi ${x.name} team,

I came across your ${x.shop || 'retail'} store in ${x.city} and wanted to reach out with something practical.

mhzaly is a shop-management platform we built for retail and mobile shops — inventory, sales, customer accounts (khata), repair jobs and profit reports in one place. It is cloud-based, works in English and Urdu, and is built to replace scattered spreadsheets and paper registers.

If it is useful to you, I can set up a 1-day free demo for your store and walk you through it personally:
${SITE}

Pricing and details: ${DEMO}

If this is not relevant, just reply "stop" and I will not contact you again.

Best regards,
mhzaly team`;
  return { subject, body };
}

let sent = 0, failed = 0;
for (const x of queue) {
  const { subject, body } = message(x);
  if (!SEND) { console.log(`  [dry] ${x.email} | ${x.name} (${x.country})`); continue; }
  const tmp = path.join(os.tmpdir(), `mhzaly-intl-${Date.now()}-${Math.random().toString(36).slice(2)}.eml`);
  fs.writeFileSync(tmp, [
    `From: mhzaly <${USER}>`, `To: ${x.email}`, `Subject: ${subject}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '',
    body + '\n\n--\nYou are receiving this because your business contact was listed publicly on OpenStreetMap. Reply "stop" to opt out.',
  ].join('\r\n'));
  try {
    execFileSync('curl', ['-sS', '--max-time', '30', '--url', 'smtp://smtp.gmail.com:587', '--ssl-reqd',
      '--user', `${USER}:${PASS}`, '--mail-from', USER, '--mail-rcpt', x.email, '--upload-file', tmp],
      { stdio: 'pipe', timeout: 40000 });
    done.add(x.email.toLowerCase()); sent++;
    fs.appendFileSync(LOG, `${new Date().toISOString()} OK ${x.email} (${x.country})\n`);
    console.log(`  ✓ ${x.email} (${x.country})`);
  } catch (e) {
    failed++;
    fs.appendFileSync(LOG, `${new Date().toISOString()} FAIL ${x.email} ${String(e.stderr || e.message || '').slice(0, 120)}\n`);
    console.log(`  ✗ ${x.email} — ${String(e.stderr || e.message || '').slice(0, 100)}`);
  } finally {
    fs.unlinkSync(tmp);
  }
  if (SEND) execFileSync('sleep', ['2']);
}
if (SEND) fs.writeFileSync(SENT, JSON.stringify([...done], null, 2));
console.log(`\nDone. sent=${sent} failed=${failed} total-tracked=${done.size}`);
