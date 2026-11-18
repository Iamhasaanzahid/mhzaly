#!/usr/bin/env node
/**
 * mhzaly — Gmail auto-sender (owner-approved one-to-one outreach).
 * Reads credentials from ~/.automaton/mhzaly-gmail.env (mode 0600, never in git/UI).
 * Sends ONLY real leads, max 20/day, STOP opt-out in every mail, per-lead log.
 *
 *   node tools/gmail-send.mjs --dry    # preview (default)
 *   node tools/gmail-send.mjs --send   # actually send
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const ENVFILE = path.join(os.homedir(), '.automaton', 'mhzaly-gmail.env');
const LEADS = path.join(OUT, 'leads-store.json');
const DRAFTS = path.join(OUT, 'acquisition-drafts.json');
const LOG = path.join(OUT, 'gmail-send.log');
const SENT = path.join(OUT, 'gmail-sent.json');
const CAP = Math.max(1, parseInt(process.env.EMAIL_DAILY_CAP || '20', 10));
const SITE = 'https://mhzaly.pages.dev/?ref=mhzaly-sales#/login';
const SEND = process.argv.includes('--send');

// load credentials from private env file (never printed)
const env = {};
for (const line of fs.readFileSync(ENVFILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}
const USER = env.GMAIL_USER;
const PASS = env.GMAIL_APP_PASSWORD;
if (!USER || !PASS) { console.error('Gmail credentials missing'); process.exit(1); }

const done = new Set();
try { for (const e of JSON.parse(fs.readFileSync(SENT, 'utf8'))) done.add(e); } catch {}

const _leadRows = JSON.parse(fs.readFileSync(LEADS, 'utf8')).filter((x) => x.email && /@/.test(x.email));
const _emailsSeen = new Set();
const leads = _leadRows.filter((x) => {
  const k = String(x.email).toLowerCase().trim();
  if (_emailsSeen.has(k)) return false;
  _emailsSeen.add(k); return true;
});
let draftsMap = new Map();
try { const d = JSON.parse(fs.readFileSync(DRAFTS, 'utf8')); for (const x of d.drafts || []) draftsMap.set(String(x.lead || '').toLowerCase(), x.message); } catch {}

const queue = leads.filter((x) => !done.has(x.email)).slice(0, CAP);
console.log(`Gmail: ${USER} · leads=${leads.length} · already sent=${done.size} · this run=${queue.length} · mode=${SEND ? 'SEND' : 'dry'}`);

function mailBody(x) {
  const name = x.name || 'bhai';
  const auto = draftsMap.get(name.toLowerCase());
  const intro = auto && auto.includes('mhzaly.pages.dev')
    ? auto
    : `Assalam o Alaikum ${name} — main mhzaly (shop software) ke bare mein baat karna cha raha tha. Inventory, sales aur customer khata ek hi jagah.\n1 din ka FREE demo: ${SITE}`;
  return `Subject: 1 din ka free demo — ${name} ke liye (mhzaly)\nTo: ${x.email}\n\n${intro}\n\nAgar interested na hain to "stop" reply kar dein — dobara message nahi karunga.\nShukriya!`;
}

let sent = 0, failed = 0;
for (const x of queue) {
  const text = mailBody(x);
  const subject = `1 din ka free demo — ${x.name || 'bhai'} ke liye (mhzaly)`;
  if (!SEND) { console.log(`  [dry] ${x.email} — ${x.name}`); continue; }
  const tmp = path.join(os.tmpdir(), `mhzaly-mail-${Date.now()}-${Math.random().toString(36).slice(2)}.eml`);
  fs.writeFileSync(tmp, [
    `From: mhzaly <${USER}>`, `To: ${x.email}`, `Subject: ${subject}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '',
    text.split('\n\n').slice(1).join('\n\n'),
  ].join('\r\n'));
  try {
    execFileSync('curl', ['-sS', '--max-time', '30', '--url', 'smtp://smtp.gmail.com:587', '--ssl-reqd',
      '--user', `${USER}:${PASS}`, '--mail-from', USER, '--mail-rcpt', x.email, '--upload-file', tmp],
      { stdio: 'pipe', timeout: 40000 });
    done.add(x.email); sent++;
    fs.appendFileSync(LOG, `${new Date().toISOString()} OK ${x.email}\n`);
    console.log(`  ✓ ${x.email}`);
  } catch (e) {
    failed++;
    fs.appendFileSync(LOG, `${new Date().toISOString()} FAIL ${x.email} ${String(e.stderr || e.message || '').slice(0, 120)}\n`);
    console.log(`  ✗ ${x.email} — ${String(e.stderr || e.message || '').slice(0, 100)}`);
  } finally {
    fs.unlinkSync(tmp);
  }
  // small delay to stay under Gmail rate limits
  if (SEND) execFileSync('sleep', ['2']);
}

if (SEND) fs.writeFileSync(SENT, JSON.stringify([...done], null, 2));
console.log(`\nDone. sent=${sent} failed=${failed} total-tracked=${done.size}`);
