#!/usr/bin/env node
/**
 * mhzaly WhatsApp Agent — local, no keys, no packages.
 *
 * Generates a self-contained browser console (automaton-outbox/whatsapp-agent.html)
 * that does the "brain" work of a sales agent:
 *   - Outreach: one click opens WhatsApp with a personalized pitch to a REAL lead.
 *   - Inbox: paste any customer message -> intent detected -> ready reply drafted.
 *   - Pipeline: lead stages (new -> contacted -> replied -> demo -> trial -> paid).
 *   - Follow-ups: auto-drafts a reminder for leads gone quiet.
 *   - Cap + log: daily outreach cap and a local JSONL log.
 *
 * NOTE: WhatsApp Web cannot be safely automated on a personal number — Meta bans
 * numbers for bot behaviour. This agent drafts + opens chats; the human taps Send.
 * No invented customers, payments or results. Works fully offline.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const DAY = new Date().toISOString().slice(0, 10);
const WA = '923274777744';          // agent WhatsApp number given by owner
const WA_DISPLAY = '0327 4777744';
const SITE = 'https://mhzaly.pages.dev';
const REF = `${SITE}/?ref=whatsapp-agent`;
const CAP = 25;                     // safe daily outreach cap

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const first = raw.split(/[;,]/)[0].trim();
  let d = first.replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(4);
  else if (d.startsWith('92') && d.length > 10) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^3\d{9}$/.test(d) ? d : null;
}
function cleanEmail(raw) {
  const m = String(raw || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const leads = JSON.parse(await fs.readFile(path.join(OUT, 'leads-store.json'), 'utf8'));
const queue = [];
const seen = new Set();
for (const l of leads) {
  const phone = normalizePhone(l.phone), email = cleanEmail(l.email);
  const key = phone || email || `${l.name}|${l.area}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const name = String(l.name || '').trim();
  const pitch = `Assalam o Alaikum ${name} — main mhzaly (simple shop software) ke bare mein baat karna cha raha tha. Inventory, sales, customer khata, repair jobs aur profit report ek hi jagah. Aap ki dukan ke liye 1 din ka free demo de sakta hoon. Interested hain to reply karein. Shukriya!`;
  queue.push({
    name, area: l.area || '', shop: l.shop || '', phone, email,
    wa: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(pitch)}` : '',
    call: phone ? `tel:+92${phone}` : '',
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${l.area || ''}`)}`,
    priority: phone ? 0 : email ? 1 : 2,
  });
}
queue.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

// ---- Intent engine: rules run in the browser, deterministic, no API ----
const intents = [
  { id:'demo', re:'demo|trial|try|dekh|test|free|azma|chahiye', label:'Demo / Trial',
    reply:`Bilkul! 1 din ka FREE demo ready hai. 👇\n${REF}#/login\n\nBas email se sign up karein — 24 ghante ke liye poora access mil jayega. Setup mein madad chahiye to yahin message karein.` },
  { id:'price', re:'rate|price|kimat|qimat|kitna|cost|fee|charge|rs|rupee|payment', label:'Price / Payment',
    reply:`Pricing simple hai:\n\n• Pakistan: Monthly / Quarterly / Annual plans (current rate WhatsApp par confirm hota hai)\n• Lifetime: sirf major countries ke liye $2000 USD — Pakistan mein available nahi\n\nPayment: JazzCash, Meezan Bank, Western Union ya card. Receipt verify hone par account 24h mein active. Plans: ${SITE}/sell` },
  { id:'payment', re:'jazzcash|meezan|western|transfer|receipt|pay|bhuj|deposit', label:'Payment method',
    reply:`Payment ke 3 aasan tareeqe:\n\n1️⃣ JazzCash — Muhammad Hassaan Zahid, 0332 1141889 (payment receiver — WhatsApp agent number 0327 4777744 se alag)\n2️⃣ Meezan Bank / Western Union — receiver: MUHAMMAD HASSAAN ZAHID (Pakistan)\n3️⃣ Card / Stripe (international customers)\n\nPayment ke baad receipt/y photo yahin bhej dein — verify karke account 24h mein active kar deta hoon. ✅` },
  { id:'greet', re:'assalam|salam|hi|hello|hey', label:'Greeting',
    reply:`Wa Alaikum Assalam! 👋 Main mhzaly ka sales agent hoon. Aap ki dukan ka hisaab (inventory, sales, customer khata, repair jobs, profit) simple kar deta hoon. 1 din ka FREE demo chahiye? Bataiye to link bhej deta hoon.` },
  { id:'referral', re:'refer|agent|commission|partner|earn|paisa|kamay|dukan dila|client', label:'Referral / Agent',
    reply:`mhzaly Referral Program 👇\n\nAap kisi dukan ko mhzaly recommend karein. Jab uska payment aaye to aapko (gateway fee ke baad) 30% commission milta hai — refund/dispute par adjust ho jata hai.\n\nAap ka referral link:\n${REF}\n\nJitni dukanein aayein, utna kamaayein. Wallet balance automatically update hota hai.` },
  { id:'support', re:'help|madad|problem|issue|login|password|kaam nahi|error|setup', label:'Support',
    reply:`Madad mil jayegi 👍\n\n• Login / setup issue: ${REF}#/login\n• Ya yahin apna issue likhein (screenshot bhi bhej sakte hain)\n\nMain review karke 24h mein reply karta hoon. Aap ka time zone kya hai?` },
  { id:'interested', re:'interested|haan|han|yes|ok|theek|achcha|good|bhej|send|kar do', label:'Interested',
    reply:`Shukriya! 😊 Bas ye 2 cheezein bata dein:\n\n1️⃣ Dukan ka naam aur city?\n2️⃣ Kab tak demo chahiye — aaj ya kal?\n\nPhir main aapko 1 din ka demo link bhej deta hoon. ${WA_DISPLAY}` },
  { id:'notinterested', re:'nahi|no|not interested|band|chhod|later|baad|busy', label:'Not interested',
    reply:`Koi baat nahi! 🙏 Agar kabhi zarurat ho to yahin message karein ya ${SITE}/sell par dekhlein. Aap ka din achcha ho.` },
  { id:'thanks', re:'shukriya|thanks|thank|jazak|allah', label:'Thanks',
    reply:`Shukriya! 😊 Koi bhi sawal ho to yahin poochlein. Aap ki dukan ke liye 1 din ka free demo hamesha ready hai.` },
  { id:'fallback', re:'', label:'Fallback',
    reply:`Assalam o Alaikum! 👋 Main ne aap ka message samajh liya. Main mhzaly ka sales agent hoon — shop management software for inventory, sales, khata, repair jobs aur profit.\n\nAap chahein to:\n• "demo" likhein — 1 din ka free demo\n• "rate" likhein — pricing aur payment\n• "agent" likhein — referral program\n\nYa seedha bataiye aap ki kya madad chahiye?` },
];

const rows = queue.map((x, i) => `
  <article class="card" data-id="${i}">
    <div class="head"><div><div class="num">#${i+1}</div><h2>${esc(x.name)}</h2><div class="meta">${esc(x.shop)} · ${esc(x.area)}</div></div>
      <select data-stage="${i}"><option value="new">New</option><option value="contacted">Contacted</option><option value="replied">Replied</option><option value="demo">Demo</option><option value="trial">Trial</option><option value="paid">Paid</option><option value="lost">Lost</option></select>
    </div>
    <div class="actions">
      ${x.wa ? `<a class="btn wa" data-wa="${i}" href="${x.wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${x.call ? `<a class="btn call" href="${x.call}">Call</a>` : ''}
      ${x.email ? `<a class="btn mail" href="mailto:${x.email}?subject=${encodeURIComponent('mhzaly — demo')}">Email</a>` : ''}
      <a class="btn map" href="${x.map}" target="_blank" rel="noopener">Map</a>
      <button class="btn follow" data-follow="${i}">Follow-up</button>
    </div>
    <div class="tags">${x.phone?'<span class="tag phone">mobile</span>':''}${x.email?'<span class="tag mail">email</span>':''}</div>
  </article>`).join('');

const html = `<!doctype html>
<html lang="ur"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mhzaly — WhatsApp Agent</title>
<style>
:root{--bg:#0b1020;--card:#151d33;--line:#263153;--txt:#e8eefc;--dim:#9aa8c8;--wa:#25d366;--call:#5b9cff;--mail:#ffb454;--map:#a98bff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,Segoe UI,sans-serif;padding:16px;max-width:860px;margin:auto}
h1{font-size:22px;margin:0}h2{font-size:17px;margin:2px 0}p.sub{color:var(--dim);margin:4px 0 14px}
.tabs{display:flex;gap:6px;margin:14px 0}.tabs button{flex:1;background:var(--card);color:var(--dim);border:1px solid var(--line);padding:9px;border-radius:9px;cursor:pointer;font-weight:700}
.tabs button.on{background:var(--wa);color:#06170d;border-color:var(--wa)}
.panel{display:none}.panel.on{display:block}
.bar{position:sticky;top:0;background:rgba(11,16,32,.96);padding:10px 0;border-bottom:1px solid var(--line);z-index:2;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.bar b{font-size:16px}.reset{background:none;border:1px solid var(--line);color:var(--dim);padding:6px 10px;border-radius:8px;cursor:pointer}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}.head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.num{color:var(--dim);font-size:12px}.meta{color:var(--dim);font-size:13px}
select{background:#0b1428;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:6px;font-size:13px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.btn{text-decoration:none;padding:9px 13px;border-radius:9px;font-weight:600;font-size:14px;color:#08111f;border:none;cursor:pointer}
.wa{background:var(--wa)}.call{background:var(--call);color:white}.mail{background:var(--mail)}.map{background:var(--map);color:white}.follow{background:#31405f;color:var(--txt)}
.tags{margin-top:9px}.tag{font-size:11px;padding:2px 7px;border-radius:99px;border:1px solid var(--line);color:var(--dim);margin-right:5px}
textarea,input{width:100%;background:#0b1428;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:12px;font:15px/1.5 system-ui,sans-serif}
textarea{min-height:110px;resize:vertical}
.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.row button{background:var(--wa);color:#06170d;border:none;padding:10px 16px;border-radius:9px;font-weight:700;cursor:pointer}
.row button.alt{background:#31405f;color:var(--txt)}
.out{background:#0f1730;border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px;white-space:pre-wrap;font:14px/1.6 system-ui,sans-serif}
.intent{display:inline-block;background:#1c2a49;color:#8fd6ff;font-size:12px;padding:3px 9px;border-radius:99px;margin-bottom:8px}
.stat{color:var(--dim);font-size:13px;margin-top:8px}
.log{font:12px/1.5 ui-monospace,monospace;color:var(--dim);max-height:260px;overflow:auto;background:#0b1428;border:1px solid var(--line);border-radius:10px;padding:10px}
code{color:#8fd6ff}
</style></head><body>
<h1>mhzaly — WhatsApp Agent 🤖</h1>
<p class="sub">${DAY} · Agent number: <b>${WA_DISPLAY}</b> · ${queue.length} real leads (OpenStreetMap) · daily cap ${CAP} · offline, no keys.</p>
<div class="tabs"><button class="on" data-tab="chat">Chat Agent</button><button data-tab="leads">Outreach (${queue.length})</button><button data-tab="log">Log</button></div>

<section class="panel on" id="chat">
  <p class="sub">Customer ka message neeche paste karein — agent khud intent detect karke reply tayyar karega. Copy karke WhatsApp par bhej dein.</p>
  <textarea id="msg" placeholder="e.g. Assalam o Alaikum, demo chahiye. Rate kya hai?"></textarea>
  <div class="row"><button id="gen">Reply banao</button><button class="alt" id="clear">Clear</button></div>
  <div class="out" id="reply" style="display:none"><span class="intent" id="intent"></span><div id="replytext"></div><div class="row"><button id="copy">Copy reply</button><a id="waopen" class="btn wa" target="_blank" rel="noopener" style="text-decoration:none;padding:10px 16px;border-radius:9px;font-weight:700">WhatsApp par kholein</a></div></div>
  <p class="stat">Agent har message ko 10 categories mein classify karta hai: greeting, demo, price, payment, referral, support, interested, not interested, thanks, fallback. Strings match, no paid API.</p>
</section>

<section class="panel" id="leads">
  <div class="bar"><b id="stat">0 / ${CAP} aaj bheje</b><button class="reset" id="reset">Reset progress</button></div>
  <p class="sub">Green WhatsApp button seedha us dukan par chat kholta hai (aapke ${WA_DISPLAY} se). "Follow-up" quiet lead ke liye gentle reminder draft karta hai.</p>
  <div id="list">${rows}</div>
</section>

<section class="panel" id="log">
  <p class="sub">Har bheja gaya message aur stage change yahin local browser mein record hota hai.</p>
  <div class="log" id="logbox">No activity yet.</div>
</section>

<script>
const KEY='mhzaly-wa-agent-${DAY}';
const state=JSON.parse(localStorage.getItem(KEY)||'{"sent":0,"stages":{},"log":[]}');
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function log(s){state.log.unshift(new Date().toLocaleTimeString()+' — '+s);state.log=state.log.slice(0,200);save();renderLog()}
function renderLog(){document.getElementById('logbox').textContent=state.log.join(String.fromCharCode(10))||'No activity yet.'}
function renderStat(){const left=Math.max(0,${CAP}-state.sent);document.getElementById('stat').textContent=state.sent+' / ${CAP} aaj bheje · '+left+' baqi'}
const intents=${JSON.stringify(intents)};
function detect(t){const s=t.toLowerCase();const ref=/refer|agent|commission|partner|kamay|paisa/.test(s);const price=/rate|price|kimat|qimat|kitna|cost|fee|charge|rs|rupee|payment|jazzcash|meezan|western/.test(s);const demo=/demo|trial|try|dekh|test|free|azma/.test(s);if(ref)return intents.find(x=>x.id==='referral');if(price&&demo)return intents.find(x=>x.id==='demo');for(const x of intents){if(x.id==='fallback')continue;if(new RegExp(x.re).test(s))return x}return intents[intents.length-1]}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));document.getElementById(b.dataset.tab).classList.add('on')});
document.getElementById('gen').onclick=()=>{const t=document.getElementById('msg').value.trim();if(!t){alert('Pehle customer ka message paste karein');return}const x=detect(t);document.getElementById('intent').textContent='Intent: '+x.label;document.getElementById('replytext').textContent=x.reply;document.getElementById('reply').style.display='block';document.getElementById('waopen').href='https://wa.me/?text='+encodeURIComponent(x.reply);log('Reply drafted: '+x.label)};
document.getElementById('clear').onclick=()=>{document.getElementById('msg').value='';document.getElementById('reply').style.display='none'};
document.getElementById('copy').onclick=async()=>{await navigator.clipboard.writeText(document.getElementById('replytext').textContent);log('Reply copied')};
document.querySelectorAll('[data-wa]').forEach(a=>a.onclick=()=>{if(state.sent>=${CAP}){alert('Aaj ka cap (${CAP}) ho gaya — kal dobara try karein');return false}state.sent++;const i=a.dataset.wa;state.stages[i]='contacted';save();renderStat();log('WhatsApp opened: #'+(Number(i)+1)+' '+document.querySelector('[data-id="'+i+'"] h2').textContent);sync()});
document.querySelectorAll('[data-follow]').forEach(b=>b.onclick=()=>{const i=b.dataset.follow;const el=document.querySelector('[data-id="'+i+'"]');const name=el.querySelector('h2').textContent;const stage=state.stages[i]||'new';const msg=stage==='new'?'Assalam o Alaikum '+name+' — 1 din ka free demo abhi bhi available hai. Interested hain to reply karein.':stage==='demo'?'Assalam o Alaikum '+name+' — demo kaise laga? Koi issue ho to main madad kar sakta hoon.':'Assalam o Alaikum '+name+' — mhzaly ke bare mein koi sawal? Free demo ready hai.';document.getElementById('msg').value=msg;document.querySelector('[data-tab="chat"]').click();document.getElementById('gen').click();log('Follow-up drafted: '+name+' ('+stage+')')});
document.querySelectorAll('[data-stage]').forEach(s=>{s.value=state.stages[s.dataset.stage]||'new';s.onchange=()=>{state.stages[s.dataset.stage]=s.value;save();log('Stage: '+s.value+' #'+(Number(s.dataset.stage)+1))}});
document.getElementById('reset').onclick=()=>{localStorage.removeItem(KEY);location.reload()};
function sync(){document.querySelectorAll('[data-stage]').forEach(s=>{s.value=state.stages[s.dataset.stage]||'new'})}
renderStat();renderLog();sync();
</script></body></html>`;
await fs.writeFile(path.join(OUT, 'whatsapp-agent.html'), html);
console.log(JSON.stringify({leads:queue.length, withWhatsApp:queue.filter(x=>x.phone).length, file:'automaton-outbox/whatsapp-agent.html', number:WA_DISPLAY, cap:CAP, intents:intents.length}, null, 2));
