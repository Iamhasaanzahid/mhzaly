#!/usr/bin/env node
/**
 * mhzaly Outreach Queue — turns real OSM leads into a one-click action sheet.
 *
 * Input : automaton-outbox/leads-store.json (collected by growth-agent.mjs)
 * Output: automaton-outbox/action-queue.html  (open in browser, click, mark done)
 *         automaton-outbox/action-queue.md    (plain text backup)
 *
 * Every number/email comes from OpenStreetMap. Nothing is invented.
 * WhatsApp link opens a chat with the SHOP (not with the owner).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const DAY = new Date().toISOString().slice(0, 10);
const OWNER = '923274777744';

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // take first number out of multi-value fields like "+92 348-...; +92 306-..."
  const first = raw.split(/[;,]/)[0].trim();
  let digits = first.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92') && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^3\d{9}$/.test(digits)) return null; // mobile only — WhatsApp needs mobile
  return digits;
}

function cleanEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const pitch = (name) =>
  `Assalam o Alaikum ${name} — main mhzaly (simple shop software) ke bare mein baat karna cha raha tha. ` +
  `Inventory, sales, customer khata, repair jobs aur profit report ek hi jagah. ` +
  `Aap ki dukan ke liye 1 din ka free demo de sakta hoon. Interested hain to reply karein. Shukriya!`;

const subject = (name) => `mhzaly — ${name} ke liye shop management software`;

const leads = JSON.parse(await fs.readFile(path.join(OUT, 'leads-store.json'), 'utf8'));

const queue = [];
const seen = new Set();
for (const lead of leads) {
  const phone = normalizePhone(lead.phone);
  const email = cleanEmail(lead.email);
  const key = phone || email || `${lead.name}|${lead.area}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const name = String(lead.name || '').trim();
  const waText = encodeURIComponent(pitch(name));
  queue.push({
    name,
    shop: lead.shop || '',
    area: lead.area || '',
    phone,
    email,
    wa: phone ? `https://wa.me/${phone}?text=${waText}` : '',
    call: phone ? `tel:+92${phone}` : '',
    mail: email
      ? `mailto:${email}?subject=${encodeURIComponent(subject(name))}&body=${waText}`
      : '',
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lead.area || ''} ${lead.street || ''}`)}`,
    priority: phone ? 0 : email ? 1 : 2,
  });
}
queue.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

const reachable = queue.filter((x) => x.phone || x.email).length;

// ---------- Markdown ----------
let md = `# mhzaly — Ready Action Queue (${DAY})\n\n`;
md += `Real shops from OpenStreetMap. **${queue.length} leads**, **${reachable} reachable** ` +
  `(phone/email from OSM). Nothing invented.\n\n`;
md += `Open \`action-queue.html\` in the browser for one-click WhatsApp / call / email with progress saved.\n\n`;
queue.forEach((x, i) => {
  md += `## ${i + 1}. ${esc(x.name)}\n`;
  md += `- Shop: ${esc(x.shop)} | Area: ${esc(x.area)}\n`;
  if (x.phone) md += `- WhatsApp: ${x.wa}\n- Call: ${x.call}\n`;
  if (x.email) md += `- Email: ${x.email} — ${x.mail}\n`;
  md += `- Map: ${x.map}\n\n`;
});
await fs.writeFile(path.join(OUT, 'action-queue.md'), md);

// ---------- HTML ----------
const rows = queue.map((x, i) => `
  <article class="card" data-id="${i}">
    <div class="head">
      <div>
        <div class="num">#${i + 1}</div>
        <h2>${esc(x.name)}</h2>
        <div class="meta">${esc(x.shop)} · ${esc(x.area)}</div>
      </div>
      <label class="done"><input type="checkbox" data-done="${i}"> Done</label>
    </div>
    <div class="actions">
      ${x.phone ? `<a class="btn wa" href="${x.wa}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn call" href="${x.call}">Call ${esc(x.phone)}</a>` : ''}
      ${x.email ? `<a class="btn mail" href="${x.mail}" target="_blank" rel="noopener">Email</a>` : ''}
      <a class="btn map" href="${x.map}" target="_blank" rel="noopener">Map</a>
    </div>
    <div class="tags">${x.phone ? '<span class="tag phone">mobile</span>' : ''}${x.email ? '<span class="tag mail">email</span>' : ''}${!x.phone && !x.email ? '<span class="tag none">visit only</span>' : ''}</div>
  </article>`).join('');

const html = `<!doctype html>
<html lang="ur"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mhzaly — Action Queue ${DAY}</title>
<style>
:root{--bg:#0b1020;--card:#151d33;--line:#263153;--txt:#e8eefc;--dim:#9aa8c8;--wa:#25d366;--call:#5b9cff;--mail:#ffb454;--map:#a98bff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,Segoe UI,sans-serif;padding:16px;max-width:860px;margin:auto}
h1{font-size:22px;margin:0 0 4px}p.sub{color:var(--dim);margin:0 0 16px}
.bar{position:sticky;top:0;background:rgba(11,16,32,.95);padding:10px 0;border-bottom:1px solid var(--line);z-index:2;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.bar b{font-size:18px}.reset{background:none;border:1px solid var(--line);color:var(--dim);padding:6px 10px;border-radius:8px;cursor:pointer}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}
.head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.num{color:var(--dim);font-size:12px}h2{font-size:17px;margin:2px 0}.meta{color:var(--dim);font-size:13px}
.done{font-size:13px;color:var(--dim);white-space:nowrap;cursor:pointer}.done input{width:17px;height:17px;vertical-align:middle}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.btn{text-decoration:none;padding:9px 13px;border-radius:9px;font-weight:600;font-size:14px;color:#08111f}
.wa{background:var(--wa)}.call{background:var(--call);color:white}.mail{background:var(--mail)}.map{background:var(--map);color:white}
.tags{margin-top:9px}.tag{font-size:11px;padding:2px 7px;border-radius:99px;border:1px solid var(--line);color:var(--dim);margin-right:5px}
</style></head><body>
<h1>mhzaly — Action Queue</h1>
<p class="sub">${DAY} · ${queue.length} real shops · ${reachable} with phone/email · source: OpenStreetMap. Progress is saved in this browser.</p>
<div class="bar"><b id="stat">0 / ${queue.length} done</b><button class="reset" id="reset">Reset</button></div>
<div id="list">${rows}</div>
<script>
const KEY='mhzaly-queue-${DAY}';
const state=JSON.parse(localStorage.getItem(KEY)||'{}');
function paint(){document.querySelectorAll('[data-done]').forEach(c=>{const d=!!state[c.dataset.done];c.checked=d;const card=c.closest('.card');card.classList.toggle('done',d);card.style.display=d?'none':''});const left=${queue.length}-Object.values(state).filter(Boolean).length;document.getElementById('stat').textContent=left+' leads baqi hain'}
document.querySelectorAll('[data-done]').forEach(c=>c.addEventListener('change',()=>{state[c.dataset.done]=c.checked;localStorage.setItem(KEY,JSON.stringify(state));paint()}));
document.getElementById('reset').onclick=()=>{localStorage.removeItem(KEY);location.reload()};
paint();
</script></body></html>`;
await fs.writeFile(path.join(OUT, 'action-queue.html'), html);

console.log(JSON.stringify({
  leads: queue.length,
  reachable,
  withWhatsApp: queue.filter((x) => x.phone).length,
  withEmail: queue.filter((x) => x.email).length,
  files: ['automaton-outbox/action-queue.html', 'automaton-outbox/action-queue.md'],
}, null, 2));
