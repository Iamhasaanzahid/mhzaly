#!/usr/bin/env node
/**
 * mhzaly Mail Agent — one generator, two outputs.
 *
 * DEFAULT:  node tools/mail-agent.mjs
 *   Writes automaton-outbox/mail-agent.html (offline, inline script, works on file://).
 *
 * PUBLIC:   called by tools/build.mjs -> writes into dist/:
 *   - mail-agent.html          (external JS: CSP script-src 'self' compliant)
 *   - js/mail-agent.js         (lead data + UI logic, no secrets)
 *   - mail-agent-leads.csv     (downloadable outreach leads)
 *   Real lead data is generated at build time and is NEVER committed to git.
 *
 * SEND:     node tools/mail-agent.mjs --send
 *   Uses a connected provider if one exists; otherwise says so plainly.
 *
 * Rules: honest one-to-one mail, 20/day cap, opt-out line in every message.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const LEADS = path.join(OUT, 'leads-store.json');
const DRAFTS = path.join(OUT, 'acquisition-drafts.json');
const CAP = 20;
const SITE = 'https://mhzaly.pages.dev/?ref=mhzaly-sales';
const TODAY = new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function readLeads() {
  if (!fs.existsSync(LEADS)) return [];
  return JSON.parse(fs.readFileSync(LEADS, 'utf8'));
}

// If the Conway automaton produced drafts, use its own words for matching leads.
function automatonMessages() {
  try {
    const d = JSON.parse(fs.readFileSync(DRAFTS, 'utf8'));
    const map = new Map();
    for (const x of d.drafts || []) map.set(String(x.lead || '').toLowerCase(), x.message);
    return { map, agent: d.agent, count: d.count };
  } catch {
    return { map: new Map(), agent: null, count: 0 };
  }
}

function mailUrl(x, override) {
  const name = x.name || 'bhai';
  const subject = `1 din ka free demo — ${name} ke liye (mhzaly)`;
  const body = override || `Assalam o Alaikum ${name},

Main mhzaly — dukan management software — ke bare mein baat karna cha raha tha.
Inventory, sales, customer khata, repair jobs aur profit report ek hi jagah rehte hain.

1 din ka FREE demo yahan se shuru karein:
${SITE}#/login

Sign up karte hi main aapki setup mein madad karunga. Agar interested na hain to
bas "stop" reply kar dein — dobara message nahi karunga.

Shukriya!`;
  return `mailto:${x.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ---------------- send mode ---------------- */
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
    console.log(execFileSync(process.execPath, [path.join(ROOT, 'tools', 'email-sender.mjs'), '--send'], {
      cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 120000,
    }));
  } catch (e) {
    console.log(String(e.stdout || '') + String(e.stderr || ''));
  }
  process.exit(0);
}

/* ---------------- generation ---------------- */
export function generateMailAgent(outDir, { publicMode = false } = {}) {
  const leads = readLeads();
  const emails = leads.filter((x) => x.email && /@/.test(x.email));
  const auto = automatonMessages();
  const mail = emails.map((x) => {
    const override = auto.map.get(String(x.name || '').toLowerCase());
    return {
      to: x.email,
      name: x.name || 'bhai',
      body: override || `Assalam o Alaikum ${x.name || 'bhai'},\n\nMain mhzaly — dukan management software — ke bare mein baat karna cha raha tha.\nInventory, sales, customer khata, repair jobs aur profit report ek hi jagah.\n\n1 din ka FREE demo yahan se shuru karein:\n${SITE}#/login\n\nSign up karte hi main aapki setup mein madad karunga. Agar interested na hain to\nbas "stop" reply kar dein — dobara message nahi karunga.\n\nShukriya!`,
      url: mailUrl(x, override),
    };
  });
  fs.mkdirSync(outDir, { recursive: true });

  // CSV — all real outreach leads (OSM business listings), with actions.
  const head = ['name', 'shop', 'area', 'street', 'phone', 'email', 'whatsapp', 'signup_link'];
  const lines = [head.join(',')].concat(leads.map((x) => [
    csv(x.name), csv(x.shop), csv(x.area), csv(x.street), csv(x.phone), csv(x.email),
    csv(x.phone ? `https://wa.me/${String(x.phone).replace(/\D/g, '')}` : ''),
    csv(SITE),
  ].join(',')));
  fs.writeFileSync(path.join(outDir, 'mail-agent-leads.csv'), '\ufeff' + lines.join('\r\n'));

  const rows = mail.map((m, i) => {
    const x = emails[i];
    return `<div class="row" data-i="${i}">
      <div class="who"><b>${esc(x.name || 'bhai')}</b><span>${esc(x.shop || '')} · ${esc(x.area || '')}</span><a href="${esc(m.url)}">${esc(m.to)}</a></div>
      <a class="send" href="${esc(m.url)}" data-i="${i}" data-act="mail">Mail kholein</a>
      <button class="copy" data-i="${i}" data-act="copy">Copy</button>
      <button class="done" data-i="${i}" data-act="done">Ho gaya</button>
    </div>`;
  }).join('');

  const css = `
:root{--bg:#0b1220;--card:#111c2e;--line:#21314a;--fg:#e8eef7;--dim:#93a4bd;--ok:#34d399;--ac:#60a5fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px system-ui,sans-serif;padding:20px;max-width:900px;margin:auto}
h1{margin:0 0 4px;font-size:22px}.sub{color:var(--dim);font-size:13px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
.row{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.row:last-child{border:0}.who{flex:1;min-width:0}.who b{display:block}.who span{display:block;color:var(--dim);font-size:12px}
.who a{color:var(--ac);font-size:13px;text-decoration:none}
button,.send{background:var(--ac);color:#04101f;border:0;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;font-size:14px}
.copy{background:#0e7490;color:#e8faff}
.done{background:transparent;color:var(--dim);border:1px solid var(--line)}
.row.sent{opacity:.35}.row.sent .who a{text-decoration:line-through}
.stat{color:var(--ok);font-size:13px;margin:8px 0}
.dl{display:inline-block;background:var(--ok);color:#041a12;padding:9px 14px;border-radius:8px;text-decoration:none;font-weight:700}
#msgbox{display:none;margin-top:10px}#msgbox textarea{width:100%;height:170px;background:#0a1424;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px;font:13px system-ui}
`;

  const logic = (dataVar) => `
const MAIL=${dataVar};const KEY='mhzaly-mail-agent-${TODAY}';
let sent=new Set(JSON.parse(localStorage.getItem(KEY)||'[]'));
function save(){localStorage.setItem(KEY,JSON.stringify([...sent]))}
function draw(){document.querySelectorAll('.row').forEach(r=>r.classList.toggle('sent',sent.has(+r.dataset.i)));
 document.getElementById('stat').textContent=sent.size+' / '+Math.min(${CAP},MAIL.length)+' aaj bheje gaye · '+(MAIL.length-sent.size)+' baaki';}
function copyMsg(i){const b=document.getElementById('msgbox');b.style.display='block';
 const t=document.getElementById('msgtext');t.value=MAIL[i].body;t.focus();t.select();
 document.getElementById('msgtitle').textContent='Message for '+MAIL[i].name+' — copy karein ya Gmail/Outlook mein paste karein';
 if(navigator.clipboard)navigator.clipboard.writeText(MAIL[i].body).catch(()=>{});}
function mark(i){if(sent.size>=${CAP}){alert('Aaj ka cap (${CAP}) ho gaya — kal baaki karlein.');return}sent.add(i);save();draw()}
document.addEventListener('click',function(e){
 const el=e.target.closest('[data-act]');if(!el)return;
 const i=+el.dataset.i;
 if(el.dataset.act==='mail'){e.preventDefault();if(sent.size>=${CAP}){alert('Aaj ka cap (${CAP}) ho gaya — kal baaki karlein.');return}window.open(MAIL[i].url,'_blank');}
 else if(el.dataset.act==='copy'){copyMsg(i);}
 else if(el.dataset.act==='done'){mark(i);}
});
draw();`;

  const bodyHtml = `<h1>mhzaly — Mail Agent ✅</h1>
<p class="sub">${TODAY} · ${emails.length} real email leads · ${CAP}/din cap · har mail mein opt-out line · koi account/key nahi chahiye.</p>
<div class="card"><p class="stat" id="stat"></p>
<p class="sub">"Mail kholein" dabayein — aapke mail app mein message tayyar hoga, <b>Send dabana zaroori hai</b>. Message bhejne ke baad "Ho gaya" dabayein.</p>
<p><a class="dl" href="mail-agent-leads.csv" download="mhzaly-outreach-leads.csv">🔒 CSV download (${leads.length} leads · password protected)</a></p></div>
<div class="card" id="msgbox"><b id="msgtitle">Message</b><textarea id="msgtext" readonly></textarea>
<p class="sub">Agar "Mail kholein" se mail app na khule to ye text copy karke Gmail/Outlook mein naya email bana kar paste kar dein.</p></div>
<div class="card" id="rows">${rows || '<p class="sub">Koi email lead nahi mila.</p>'}</div>`;

  const dataJson = JSON.stringify(mail);

  if (publicMode) {
    const js = `/* generated at build time from gitignored leads — no secrets */\n${logic('__MAIL_DATA__').replace('__MAIL_DATA__', dataJson)}`;
    fs.mkdirSync(path.join(outDir, 'js'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'js', 'mail-agent.js'), js);
    fs.writeFileSync(path.join(outDir, 'mail-agent.html'), `<!doctype html><html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>mhzaly — Mail Agent</title><style>${css}</style></head><body>${bodyHtml}<script src="js/mail-agent.js"></script></body></html>`);
  } else {
    fs.writeFileSync(path.join(outDir, 'mail-agent.html'), `<!doctype html><html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mhzaly — Mail Agent</title><style>${css}</style></head><body>${bodyHtml}<script>${logic(dataJson)}</script></body></html>`);
  }

  return { leads: leads.length, emailLeads: emails.length, cap: CAP, publicMode };
}

const isCli = !!process.argv[1] && process.argv[1].endsWith('mail-agent.mjs');
if (isCli || process.argv.includes('--local')) {
  const idx = process.argv.indexOf('--dist');
  if (idx !== -1) {
    const target = path.resolve(process.argv[idx + 1] || 'dist');
    console.log(JSON.stringify(generateMailAgent(target, { publicMode: true })));
  } else {
    console.log(JSON.stringify(generateMailAgent(OUT, { publicMode: false })));
  }
}
