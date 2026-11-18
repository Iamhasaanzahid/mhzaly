#!/usr/bin/env node
/**
 * mhzaly Mail Agent — final, simple, one-command.
 *
 * DEFAULT:  node tools/mail-agent.mjs
 *   Reads real leads, writes automaton-outbox/mail-agent.html — one-click
 *   mailto links with a ready message. No account or key needed. Works now.
 *
 * AUTO:     node tools/mail-agent.mjs --send
 *   Sends via a connected provider (Gmail / Resend / Brevo / Mailjet / SMTP2GO)
 *   if credentials exist. Otherwise says so plainly and leaves drafts intact.
 *
 * Rule: one-to-one honest mail only. 20/day cap. Every mail has an opt-out line.
 * Fake leads, fake sends and mass blasts are never generated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const LEADS = path.join(OUT, 'leads-store.json');
const HTML = path.join(OUT, 'mail-agent.html');
const CAP = 20;
const SITE = 'https://mhzaly.pages.dev/?ref=mhzaly-sales';
const TODAY = new Date().toISOString().slice(0, 10);

const leads = JSON.parse(fs.readFileSync(LEADS, 'utf8'));
const emails = leads.filter((x) => x.email && /@/.test(x.email));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function subject(name) {
  return `1 din ka free demo — ${name} ke liye (mhzaly)`;
}

function body(name) {
  return `Assalam o Alaikum ${name},

Main mhzaly — dukan management software — ke bare mein baat karna cha raha tha.
Inventory, sales, customer khata, repair jobs aur profit report ek hi jagah rehte hain.

1 din ka FREE demo yahan se shuru karein:
${SITE}#/login

Sign up karte hi main aapki setup mein madad karunga. Agar interested na hain to
 bas "stop" reply kar dein — dobara message nahi karunga.

Shukriya!`;
}

if (process.argv.includes('--send')) {
  const has = [
    ['gmail', process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD],
    ['resend', process.env.RESEND_API_KEY],
    ['brevo', process.env.BREVO_API_KEY],
    ['mailjet', process.env.MAILJET_API_KEY && process.env.MAILJET_API_SECRET],
    ['smtp2go', process.env.SMTP2GO_API_KEY],
  ].filter(([, ok]) => ok);
  if (!has.length) {
    console.log('Koi mail account connect nahi hai. Automaton khud tab bhejega jab Gmail/Resend/Brevo key milegi.');
    console.log('Abhi ke liye ye panel ready hai: automaton-outbox/mail-agent.html');
    process.exit(0);
  }
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'email-sender.mjs'), '--send'], {
      cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 120000,
    });
    console.log(out);
  } catch (e) {
    console.log(String(e.stdout || '') + String(e.stderr || ''));
  }
  process.exit(0);
}

const rows = emails.map((x, i) => {
  const name = x.name || 'bhai';
  const to = x.email;
  const subj = encodeURIComponent(subject(name));
  const text = encodeURIComponent(body(name));
  return `<div class="row" data-i="${i}">
    <div class="who"><b>${esc(name)}</b><span>${esc(x.shop || '')} · ${esc(x.area || '')}</span><a href="mailto:${esc(to)}?subject=${subj}&body=${text}">${esc(to)}</a></div>
    <button class="send" onclick="openMail(${i})">Mail kholein</button>
    <button class="done" onclick="mark(${i})">Ho gaya</button>
  </div>`;
}).join('');

const data = JSON.stringify(emails.map((x) => ({
  to: x.email,
  url: `mailto:${x.email}?subject=${encodeURIComponent(subject(x.name || 'bhai'))}&body=${encodeURIComponent(body(x.name || 'bhai'))}`,
})));

const html = `<!doctype html><html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mhzaly — Mail Agent</title><style>
:root{--bg:#0b1220;--card:#111c2e;--line:#21314a;--fg:#e8eef7;--dim:#93a4bd;--ok:#34d399;--ac:#60a5fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px system-ui,sans-serif;padding:20px;max-width:900px;margin:auto}
h1{margin:0 0 4px;font-size:22px}.sub{color:var(--dim);font-size:13px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
.row{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.row:last-child{border:0}.who{flex:1;min-width:0}.who b{display:block}.who span{display:block;color:var(--dim);font-size:12px}
who a,.who a{color:var(--ac);font-size:13px;text-decoration:none}
button{background:var(--ac);color:#04101f;border:0;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer}
.done{background:transparent;color:var(--dim);border:1px solid var(--line)}
.row.sent{opacity:.35}.row.sent .who a{text-decoration:line-through}
.stat{color:var(--ok);font-size:13px;margin:8px 0}
</style></head><body>
<h1>mhzaly — Mail Agent ✅</h1>
<p class="sub">${TODAY} · ${emails.length} real email leads · ${CAP}/din cap · har mail mein opt-out line · koi account/key nahi chahiye.</p>
<div class="card"><p class="stat" id="stat"></p><p class="sub">"Mail kholein" dabayein — aapke mail app mein message tayyar ho jayega, bas Send karein. "Ho gaya" dabate hi next lead par chale jayein.</p></div>
<div class="card" id="rows">${rows || '<p class="sub">Koi email lead nahi mila.</p>'}</div>
<script>
const MAIL=${data};const KEY='mhzaly-mail-agent-${TODAY}';
let sent=new Set(JSON.parse(localStorage.getItem(KEY)||'[]'));
function save(){localStorage.setItem(KEY,JSON.stringify([...sent]))}
function draw(){document.querySelectorAll('.row').forEach(r=>r.classList.toggle('sent',sent.has(+r.dataset.i)));
 document.getElementById('stat').textContent=sent.size+' / '+Math.min(${CAP},MAIL.length)+' aaj bheje gaye · '+(MAIL.length-sent.size)+' baaki';}
function openMail(i){if(sent.size>=${CAP}){alert('Aaj ka cap (${CAP}) ho gaya — kal baaki karlein.');return}window.location.href=MAIL[i].url;sent.add(i);save();draw()}
function mark(i){sent.add(i);save();draw()}
draw();
</script></body></html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(HTML, html);
console.log(JSON.stringify({ leads: leads.length, emailLeads: emails.length, cap: CAP, file: 'automaton-outbox/mail-agent.html' }, null, 2));
