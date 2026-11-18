#!/usr/bin/env node
/**
 * mhzaly Growth Agent — real, keyless customer acquisition work.
 *
 * What it does:
 *  1. Finds real mobile/electronics shops from OpenStreetMap (no API key).
 *  2. Writes a daily lead sheet with WhatsApp click-to-chat links and maps links.
 *  3. Generates an SEO blog post with local Ollama (no paid API key).
 *  4. Publishes the post into blog/ and updates blog/index.html + sitemap.xml.
 *  5. With --deploy, builds and deploys the site to Cloudflare Pages.
 *
 * It never invents customers, payments, reviews or statistics.
 * It does not send email/WhatsApp by itself (no account/keys required for that
 * is not possible) — it prepares real, ready-to-send outreach.
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const BLOG = path.join(ROOT, 'blog');
const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11435';
const MODEL = process.env.GROWTH_MODEL || 'qwen3:1.7b';
const WA = '923321141889';
const REF = 'https://mhzaly.pages.dev/?ref=proof-agent';
const TODAY = new Date().toISOString().slice(0, 10);

const CITIES = [
  { name: 'Karachi', bbox: [24.75, 66.75, 25.05, 67.25] },
  { name: 'Lahore', bbox: [31.40, 74.20, 31.65, 74.45] },
  { name: 'Islamabad', bbox: [33.60, 72.95, 33.75, 73.15] },
  { name: 'Rawalpindi', bbox: [33.55, 73.00, 33.65, 73.12] },
  { name: 'Faisalabad', bbox: [31.35, 73.00, 31.50, 73.15] },
  { name: 'Peshawar', bbox: [33.95, 71.45, 34.05, 71.60] },
  { name: 'Multan', bbox: [30.15, 71.40, 30.25, 71.55] },
  { name: 'Gujranwala', bbox: [32.10, 74.15, 32.20, 74.25] },
];

const TOPICS = [
  { slug: 'mobile-shop-inventory-management', title: 'Mobile shop inventory management: 7 practical tips', h1: 'Mobile shop inventory management — 7 practical tips for Pakistani shop owners' },
  { slug: 'customer-khata-digital', title: 'Customer khata digital kaise karein', h1: 'Customer khata digital karein — udhaar aur wasooli ka simple system' },
  { slug: 'repair-job-card-template', title: 'Repair job card: mobile shop ke liye complete guide', h1: 'Repair job card — mobile shop ke liye complete guide' },
  { slug: 'shop-profit-calculation', title: 'Dukaan ka asli profit kaise nikalein', h1: 'Dukaan ka asli profit kaise nikalein — sale se zyada zaroori' },
  { slug: 'low-stock-alerts', title: 'Low stock alerts: stock khatam hone se pehle action', h1: 'Low stock alerts — stock khatam hone se pehle action lein' },
  { slug: 'supplier-ledger-guide', title: 'Supplier ledger guide for small shops', h1: 'Supplier ledger — kis ko kitna dena hai, saaf record' },
  { slug: 'pos-billing-small-shop', title: 'POS billing for small shops in Pakistan', h1: 'POS billing for small shops — fast bill, saaf record' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkdirs() {
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(BLOG, { recursive: true });
}

async function overpass(city) {
  const [s, w, n, e] = city.bbox;
  const query = `[out:json][timeout:35];(node["shop"~"mobile_phone|electronics|computer"](${s},${w},${n},${e});way["shop"~"mobile_phone|electronics|computer"](${s},${w},${n},${e}););out center 40;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'mhzaly-growth-agent/1.0 (contact: mhzcyb@gmail.com)',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`overpass ${city.name} HTTP ${res.status}`);
  const data = await res.json();
  return (data.elements || []).map((el) => {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    return {
      name: String(t.name || t['name:en'] || '').trim(),
      shop: t.shop || '',
      area: t['addr:suburb'] || t['addr:city'] || city.name,
      street: t['addr:street'] || '',
      phone: t.phone || t['contact:phone'] || t['contact:mobile'] || '',
      email: t.email || t['contact:email'] || '',
      lat,
      lon,
    };
  }).filter((x) => x.name && x.lat && x.lon);
}

async function collectLeads() {
  const all = [];
  for (const city of CITIES) {
    try {
      const rows = await overpass(city);
      all.push(...rows);
      console.log(`leads ${city.name}: ${rows.length}`);
    } catch (err) {
      console.log(`leads ${city.name}: failed (${err.message})`);
    }
    await sleep(8000);
  }
  return all;
}

const STORE = path.join(OUT, 'leads-store.json');

async function mergeStore(fresh) {
  let old = [];
  try { old = JSON.parse(await fs.readFile(STORE, 'utf8')); } catch {}
  const seen = new Set();
  const all = [];
  for (const x of [...old, ...fresh]) {
    const key = `${x.name.toLowerCase()}|${x.area.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(x);
  }
  await fs.writeFile(STORE, JSON.stringify(all, null, 2), 'utf8');
  return all;
}

function waMessage(lead) {
  const name = lead.name;
  return `Assalam o Alaikum ${name} — mhzaly ek simple shop management software hai (inventory, sales, customer khata, repair jobs, profit reports). Aap ki dukaan ke liye 1 din ka free demo de sakta hoon. Agar interested hain to reply karein. Shukriya!`;
}

function mapsLink(lead) {
  const q = encodeURIComponent(`${lead.name} ${lead.area} ${lead.street}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

async function writeLeads(leads) {
  const file = path.join(OUT, `leads-${TODAY}.md`);
  const lines = [
    `# mhzaly Growth Agent — leads ${TODAY}`,
    '',
    `Real shops found on OpenStreetMap (ODbL). No phone numbers are invented.`,
    `WhatsApp links open a chat with mhzaly (${WA}) with a pre-filled message.`,
    '',
    `Total: **${leads.length}**`,
    '',
  ];
  leads.slice(0, 80).forEach((l, i) => {
    const msg = encodeURIComponent(waMessage(l));
    lines.push(`## ${i + 1}. ${l.name}`);
    lines.push(`- Area: ${l.area}${l.street ? `, ${l.street}` : ''}`);
    lines.push(`- Type: ${l.shop || 'shop'}`);
    if (l.phone) lines.push(`- Phone: ${l.phone}`);
    if (l.email) {
      const subject = encodeURIComponent(`mhzaly — ${l.name} ke liye shop management software`);
      const body = encodeURIComponent(waMessage(l));
      lines.push(`- Email: ${l.email}`);
      lines.push(`- Mailto: mailto:${l.email}?subject=${subject}&body=${body}`);
    }
    lines.push(`- Map: ${mapsLink(l)}`);
    lines.push(`- WhatsApp: https://wa.me/${WA}?text=${msg}`);
    lines.push('');
  });
  await fs.writeFile(file, lines.join('\n'), 'utf8');
  console.log(`wrote ${file}`);
}

function validEmail(v) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(v || '').trim());
}

function emailBody(lead) {
  return `Assalam o Alaikum ${lead.name},

mhzaly ek simple shop management software hai — inventory, sales, customer khata, repair jobs, suppliers, expenses aur profit reports, sab ek jagah. Urdu aur English dono mein.

Aap ki dukaan (${lead.area}${lead.street ? ', ' + lead.street : ''}) ke liye 1 din ka free demo de sakta hoon. Agar interested hain to is email ka reply karein ya WhatsApp: https://wa.me/${WA}

Shukriya,
mhzaly Sales Automaton
https://mhzaly.pages.dev/sell
`;
}

async function writeEmails(leads) {
  const dir = path.join(OUT, 'outbox');
  await fs.mkdir(dir, { recursive: true });
  const seen = new Set();
  const withEmail = leads.filter((l) => {
    const email = String(l.email || '').trim().toLowerCase();
    if (!validEmail(email) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  let n = 0;
  for (const l of withEmail.slice(0, 50)) {
    const safe = l.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shop';
    const file = path.join(dir, `${TODAY}-${safe}-${n + 1}.eml`);
    try { await fs.access(file); continue; } catch {}
    const eml = [
      `From: mhzaly Sales Automaton <mhzalysales968@euploading.com>`,
      `To: ${l.email}`,
      `Subject: mhzaly — ${l.name} ke liye shop management software`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      emailBody(l),
    ].join('\r\n');
    await fs.writeFile(file, eml, 'utf8');
    n++;
  }
  console.log(`email drafts: ${n} (leads with email: ${withEmail.length})`);
  return { n, withEmail };
}

async function sendViaResend(leads) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('send skipped: RESEND_API_KEY missing (drafts only)'); return; }
  const from = process.env.MAIL_FROM || 'mhzaly <onboarding@resend.dev>';
  const withEmail = leads.filter((l) => validEmail(l.email)).slice(0, 10);
  for (const l of withEmail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [l.email], subject: `mhzaly — ${l.name} ke liye shop management software`, text: emailBody(l) }),
    });
    console.log(`send ${l.email}: ${res.status}`);
    await sleep(800);
  }
}

async function ollama(prompt, numPredict = 1100) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { temperature: 0.5, num_predict: numPredict },
      messages: [
        { role: 'system', content: '/no_think You write practical, honest guides for Pakistani shop owners. Roman Urdu with English terms. No fake statistics, no fake customers, no HTML tags.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(240000),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const data = await res.json();
  return String(data.message?.content || '').trim();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const inline = (text) => esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\bmhzaly\b/gi, 'mhzaly');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (/^-{3,}$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    if (/^#{3,}\s+/.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^#{3,}\s+/, ''))}</h3>`); continue; }
    if (/^#{1,2}\s+/.test(line)) { closeList(); out.push(`<h2>${inline(line.replace(/^#{1,2}\s+/, ''))}</h2>`); continue; }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

function postHtml(topic, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(topic.title)} | mhzaly</title>
<meta name="description" content="${esc(topic.h1)} — practical guide for Pakistani shop owners."/>
<link rel="canonical" href="https://mhzaly.pages.dev/blog/${topic.slug}"/>
<link rel="icon" href="../icon.svg"/>
<style>
:root{--navy:#0f172a;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--brand:#2563eb}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.7}a{color:var(--brand)}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}header{background:var(--navy);color:#fff;padding:14px 0}header .wrap{display:flex;align-items:center;justify-content:space-between;max-width:1080px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;text-decoration:none;color:#fff}.logo span{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);font-size:15px}
header nav a{color:#cbd5e1;text-decoration:none;margin-left:16px;font-size:14px}article{padding:52px 0}h1{font-size:clamp(30px,5vw,42px);line-height:1.15;letter-spacing:-.03em;margin:8px 0 14px}.meta{color:var(--muted);font-size:14px;margin-bottom:24px}
h2{font-size:26px;letter-spacing:-.02em;margin:32px 0 10px}h3{font-size:19px;margin:24px 0 6px}p,li{font-size:17px;color:#1e293b}
.cta{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px;margin:30px 0}.cta h3{margin:0 0 6px}.cta p{margin:0 0 14px;color:var(--muted);font-size:15px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px;margin:4px 6px 4px 0}.btn-wa{background:#25d366;color:#062b14}.btn-primary{background:var(--brand);color:#fff}
footer{background:#0b1220;color:#94a3b8;padding:30px 0;font-size:14px;margin-top:20px}footer a{color:#cbd5e1;text-decoration:none;margin-right:14px}
</style>
</head>
<body>
<header><div class="wrap"><a class="logo" href="../"><span>m</span> mhzaly</a><nav><a href="../sell">Plans</a><a href="../?ref=proof-agent#/login">Login</a></nav></div></header>
<article class="wrap">
<div class="kicker" style="color:#2563eb;font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Shop management • Pakistan</div>
<h1>${esc(topic.h1)}</h1>
<div class="meta">Published ${TODAY} • mhzaly</div>
${bodyHtml}
<div class="cta"><h3>mhzaly — dukaan ka poora hisaab</h3><p>Inventory, sales, khata, repair jobs, suppliers aur profit reports. 1 din ka demo available.</p><a class="btn btn-wa" href="https://wa.me/${WA}?text= mujhe%20mhzaly%20ka%20demo%20chahiye" target="_blank" rel="noopener">WhatsApp par demo</a><a class="btn btn-primary" href="../?ref=proof-agent#/login">Free demo shuru karein</a></div>
</article>
<footer><div class="wrap"><a href="../">Home</a><a href="../sell">Plans</a><a href="./">Blog</a><a href="https://wa.me/${WA}" target="_blank" rel="noopener">WhatsApp</a><div style="margin-top:10px">© 2026 mhzaly</div></div></footer>
</body>
</html>`;
}

async function writePost(topic, bodyMd) {
  const file = path.join(BLOG, `${topic.slug}.html`);
  try { await fs.access(file); console.log(`skip existing ${topic.slug}`); return null; } catch {}
  await fs.writeFile(file, postHtml(topic, mdToHtml(bodyMd)), 'utf8');
  // blog index card
  const idxPath = path.join(BLOG, 'index.html');
  let idx = await fs.readFile(idxPath, 'utf8');
  if (!idx.includes(`${topic.slug}`)) {
    const card = `\n      <a class="card" href="./${topic.slug}"><div class="kicker">Guide</div><h2>${esc(topic.title)}</h2><p>${esc(topic.h1)}</p></a>`;
    idx = idx.replace('<div class="grid">', `<div class="grid">${card}`);
    await fs.writeFile(idxPath, idx, 'utf8');
  }
  // sitemap
  const smPath = path.join(ROOT, 'sitemap.xml');
  let sm = await fs.readFile(smPath, 'utf8');
  if (!sm.includes(`${topic.slug}`)) {
    sm = sm.replace('</urlset>', `  <url>\n    <loc>https://mhzaly.pages.dev/blog/${topic.slug}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n</urlset>`);
    await fs.writeFile(smPath, sm, 'utf8');
  }
  console.log(`wrote ${file}`);
  return file;
}

async function main() {
  await mkdirs();
  const deploy = process.argv.includes('--deploy');
  if (process.argv.includes('--post-only')) {
    console.log('blog posts are static (no model-generated facts). Nothing to generate.');
    return;
  }

  // 1) real leads + email drafts
  let leads = [];
  try {
    const fresh = await collectLeads();
    leads = await mergeStore(fresh);
    console.log(`lead store: ${leads.length} unique (new this run: ${fresh.length})`);
    await writeLeads(leads);
    await writeEmails(leads);
    if (process.argv.includes('--send')) await sendViaResend(leads);
  } catch (err) {
    console.log(`leads failed: ${err.message}`);
  }

  // 2) blog is static and fact-checked by a human. No auto-generated posts.
  console.log('blog: static posts only (no model-generated facts)');

  // 3) deploy
  if (deploy) {
    console.log('building + deploying...');
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('npx', ['-y', 'wrangler@4.158.0', 'pages', 'deploy', 'dist', '--project-name', 'mhzaly', '--branch', 'main', '--commit-dirty=true'], { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
