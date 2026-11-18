#!/usr/bin/env node
/**
 * mhzaly Email Sender — ready for a free provider key.
 *
 * It sends ONLY to addresses in automaton-outbox/consent.json (people who
 * replied / opted in). Cold scraped addresses stay as drafts. This keeps the
 * account compliant with provider anti-spam rules and the "no spam" rule.
 *
 * Supported providers (pick one with EMAIL_PROVIDER):
 *   brevo     BREVO_API_KEY, MAIL_FROM
 *   mailjet   MAILJET_API_KEY + MAILJET_API_SECRET, MAIL_FROM
 *   resend    RESEND_API_KEY, MAIL_FROM
 *   smtp2go   SMTP2GO_API_KEY, MAIL_FROM
 *   gmail     GMAIL_USER + GMAIL_APP_PASSWORD, MAIL_FROM (uses curl SMTP, no npm deps)
 *
 * Usage:
 *   node tools/email-sender.mjs                 # dry run (prints plan)
 *   node tools/email-sender.mjs --send          # actually send (cap applies)
 *
 * Env:
 *   EMAIL_DAILY_CAP=20
 *   EMAIL_PROVIDER=brevo|mailjet|resend|smtp2go
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const DRAFTS = path.join(OUT, 'outbox');
const CONSENT = path.join(OUT, 'consent.json');
const LOG = path.join(OUT, 'send.log');
const DRY = !process.argv.includes('--send');
const CAP = Math.max(1, parseInt(process.env.EMAIL_DAILY_CAP || '20', 10));
const FROM = process.env.MAIL_FROM || 'mhzaly <mhzcyb@gmail.com>';
const UNSUB = '\n\n---\nIf you do not want to receive emails from mhzaly, reply "STOP" and we will remove you.';

function log(line) {
  const msg = `${new Date().toISOString()} ${line}\n`;
  console.log(msg.trim());
  return fs.appendFile(LOG, msg, 'utf8').catch(() => {});
}

function parseEml(text) {
  const idx = text.indexOf('\r\n\r\n') >= 0 ? text.indexOf('\r\n\r\n') : text.indexOf('\n\n');
  const head = text.slice(0, idx);
  const body = text.slice(idx).replace(/^\r?\n\r?\n/, '').trim();
  const headers = {};
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { to: headers.to || '', subject: headers.subject || '', body };
}

async function loadDrafts() {
  const files = (await fs.readdir(DRAFTS).catch(() => [])).filter((f) => f.endsWith('.eml'));
  const out = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(DRAFTS, f), 'utf8');
    const p = parseEml(text);
    if (p.to) out.push({ file: f, ...p });
  }
  return out;
}

async function loadConsent() {
  try {
    const data = JSON.parse(await fs.readFile(CONSENT, 'utf8'));
    if (Array.isArray(data)) return data.map((x) => (typeof x === 'string' ? x : x.email)).filter(Boolean);
  } catch {}
  return [];
}

function emailOf(value) {
  const m = String(value || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(value || '')).trim();
}

async function sendGmail(to, subject, text) {
  const user = process.env.GMAIL_USER || emailOf(FROM);
  const pass = process.env.GMAIL_APP_PASSWORD;
  const from = emailOf(FROM) || user;
  const raw = [
    `From: ${FROM}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text + UNSUB,
  ].join('\r\n');
  const tmp = path.join(os.tmpdir(), `mhzaly-${Date.now()}-${Math.random().toString(36).slice(2)}.eml`);
  await fs.writeFile(tmp, raw, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync('curl', [
      '-sS', '--url', 'smtp://smtp.gmail.com:587', '--ssl-reqd',
      '--user', `${user}:${pass}`,
      '--mail-from', from,
      '--mail-rcpt', to,
      '--upload-file', tmp,
    ]);
    return { ok: true, status: 0, body: (stdout || stderr || '').slice(0, 500) };
  } catch (err) {
    return { ok: false, status: err.code || 1, body: String(err.stderr || err.message || err).slice(0, 500) };
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

async function sendBrevo(to, subject, text) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { email: FROM.replace(/.*<|>.*/g, '') || FROM }, to: [{ email: to }], subject, textContent: text + UNSUB }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function sendMailjet(to, subject, text) {
  const auth = Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_API_SECRET}`).toString('base64');
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Messages: [{ From: { Email: FROM.replace(/.*<|>.*/g, '') || FROM }, To: [{ Email: to }], Subject: subject, TextPart: text + UNSUB }] }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function sendResend(to, subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, text: text + UNSUB }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function sendSmtp2go(to, subject, text) {
  const res = await fetch('https://api.smtp2go.com/v3/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: process.env.SMTP2GO_API_KEY, sender: FROM, to: [to], subject, text_body: text + UNSUB }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  const consent = new Set((await loadConsent()).map((e) => e.toLowerCase()));
  const drafts = await loadDrafts();
  const approved = drafts.filter((d) => consent.has(d.to.toLowerCase()));

  console.log(`provider=${provider || '(none)'} drafts=${drafts.length} consent=${consent.size} approved=${approved.length} dryRun=${DRY} cap=${CAP}`);
  if (!provider) return log('skip: EMAIL_PROVIDER not set');
  if (!consent.size) return log('skip: consent.json is empty (add opted-in emails)');
  if (!approved.length) return log('skip: no draft matches consent list');

  let sent = 0;
  for (const d of approved.slice(0, CAP)) {
    if (DRY) { log(`dry-run -> ${d.to} | ${d.subject}`); continue; }
    let r;
    try {
      if (provider === 'gmail' && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) r = await sendGmail(d.to, d.subject, d.body);
      else if (provider === 'brevo' && process.env.BREVO_API_KEY) r = await sendBrevo(d.to, d.subject, d.body);
      else if (provider === 'mailjet' && process.env.MAILJET_API_KEY && process.env.MAILJET_API_SECRET) r = await sendMailjet(d.to, d.subject, d.body);
      else if (provider === 'resend' && process.env.RESEND_API_KEY) r = await sendResend(d.to, d.subject, d.body);
      else if (provider === 'smtp2go' && process.env.SMTP2GO_API_KEY) r = await sendSmtp2go(d.to, d.subject, d.body);
      else { log(`skip: missing key for provider ${provider}`); break; }
    } catch (err) {
      log(`error ${d.to}: ${err.message}`);
      continue;
    }
    log(`${r.ok ? 'sent' : 'failed'} ${d.to} status=${r.status}`);
    if (r.ok) sent++;
    await new Promise((res) => setTimeout(res, 900));
  }
  log(`done: sent=${sent}/${approved.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
