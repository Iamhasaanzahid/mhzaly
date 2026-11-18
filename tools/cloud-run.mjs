#!/usr/bin/env node
/**
 * mhzaly cloud outreach runner (GitHub Actions).
 * Runs entirely on GitHub's servers, so it keeps working when the laptop is off.
 *
 * 1. Collects real businesses with published emails from OpenStreetMap (rotating cities).
 * 2. Imports them into the mhzaly D1 queue (dedupe is permanent, cloud-side).
 * 3. Sends at most 10 Pakistan + 10 international emails per day from Gmail SMTP.
 * 4. Marks every send in D1, so the same lead is never emailed twice.
 *
 * Required env: GMAIL_USER, GMAIL_APP_PASSWORD, MHZALY_API_KEY
 * Optional:     MHZALY_API_URL, OUTREACH_PK_CAP, OUTREACH_INTL_CAP
 *
 *   node tools/cloud-run.mjs --dry
 *   node tools/cloud-run.mjs --send
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = (process.env.MHZALY_API_URL || 'https://mhzaly-api.mhzaly.workers.dev').replace(/\/$/, '');
const KEY = process.env.MHZALY_API_KEY || '';
const USER = process.env.GMAIL_USER || '';
const PASS = process.env.GMAIL_APP_PASSWORD || '';
const SEND = process.argv.includes('--send');
const PK_CAP = Math.max(0, parseInt(process.env.OUTREACH_PK_CAP || '10', 10));
const INTL_CAP = Math.max(0, parseInt(process.env.OUTREACH_INTL_CAP || '10', 10));
const SITE = 'https://mhzaly.pages.dev/?ref=mhzaly-sales';
const DRY = !SEND;

if (!KEY) { console.error('MHZALY_API_KEY missing'); process.exit(1); }
if (!DRY && (!USER || !PASS)) { console.error('Gmail credentials missing'); process.exit(1); }

// ── Cloud API ────────────────────────────────────────────────
async function api(pathname, method = 'GET', body = null) {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      'X-Api-Key': KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'mhzaly-automaton/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

// ── Lead collection (OpenStreetMap Overpass) ─────────────────
const CITIES = [
  // Pakistan
  { name: 'Karachi', country: 'PK', bbox: [24.80, 67.00, 24.95, 67.15] },
  { name: 'Lahore', country: 'PK', bbox: [31.47, 74.26, 31.60, 74.40] },
  { name: 'Islamabad', country: 'PK', bbox: [33.66, 73.00, 33.75, 73.14] },
  { name: 'Rawalpindi', country: 'PK', bbox: [33.56, 73.01, 33.65, 73.12] },
  { name: 'Faisalabad', country: 'PK', bbox: [31.38, 73.03, 31.47, 73.14] },
  { name: 'Multan', country: 'PK', bbox: [30.16, 71.42, 30.24, 71.52] },
  { name: 'Peshawar', country: 'PK', bbox: [33.97, 71.48, 34.05, 71.60] },
  { name: 'Gujranwala', country: 'PK', bbox: [32.13, 74.14, 32.22, 74.24] },
  { name: 'Sialkot', country: 'PK', bbox: [32.46, 74.48, 32.54, 74.58] },
  { name: 'Hyderabad', country: 'PK', bbox: [25.35, 68.33, 25.43, 68.42] },
  // International
  { name: 'London', country: 'UK', bbox: [51.45, -0.25, 51.55, -0.05] },
  { name: 'Manchester', country: 'UK', bbox: [53.44, -2.33, 53.53, -2.17] },
  { name: 'Birmingham', country: 'UK', bbox: [52.44, -1.95, 52.52, -1.82] },
  { name: 'Leeds', country: 'UK', bbox: [53.76, -1.60, 53.83, -1.48] },
  { name: 'Glasgow', country: 'UK', bbox: [55.82, -4.32, 55.89, -4.19] },
  { name: 'New York', country: 'USA', bbox: [40.70, -74.02, 40.79, -73.93] },
  { name: 'Los Angeles', country: 'USA', bbox: [34.00, -118.32, 34.10, -118.20] },
  { name: 'Chicago', country: 'USA', bbox: [41.83, -87.70, 41.93, -87.58] },
  { name: 'Houston', country: 'USA', bbox: [29.70, -95.45, 29.82, -95.30] },
  { name: 'Toronto', country: 'Canada', bbox: [43.62, -79.46, 43.72, -79.34] },
  { name: 'Vancouver', country: 'Canada', bbox: [49.23, -123.16, 49.31, -123.05] },
  { name: 'Sydney', country: 'Australia', bbox: [-33.90, 151.16, -33.82, 151.27] },
  { name: 'Melbourne', country: 'Australia', bbox: [-37.85, 144.92, -37.77, 145.04] },
  { name: 'Dubai', country: 'UAE', bbox: [25.13, 55.20, 25.30, 55.38] },
  { name: 'Abu Dhabi', country: 'UAE', bbox: [24.43, 54.45, 24.52, 54.56] },
  { name: 'Riyadh', country: 'Saudi Arabia', bbox: [24.65, 46.62, 24.78, 46.78] },
  { name: 'Jeddah', country: 'Saudi Arabia', bbox: [21.52, 39.16, 21.62, 39.26] },
  { name: 'Doha', country: 'Qatar', bbox: [25.24, 51.47, 25.33, 51.57] },
  { name: 'Berlin', country: 'Germany', bbox: [52.48, 13.36, 52.55, 13.47] },
  { name: 'Hamburg', country: 'Germany', bbox: [53.52, 9.94, 53.60, 10.08] },
  { name: 'Paris', country: 'France', bbox: [48.84, 2.31, 48.89, 2.40] },
  { name: 'Amsterdam', country: 'Netherlands', bbox: [52.35, 4.83, 52.40, 4.94] },
  { name: 'Brussels', country: 'Belgium', bbox: [50.82, 4.32, 50.87, 4.42] },
  { name: 'Milan', country: 'Italy', bbox: [45.45, 9.15, 45.50, 9.24] },
  { name: 'Madrid', country: 'Spain', bbox: [40.40, -3.75, 40.46, -3.65] },
  { name: 'Barcelona', country: 'Spain', bbox: [41.37, 2.13, 41.42, 2.21] },
  { name: 'Istanbul', country: 'Turkey', bbox: [41.00, 28.92, 41.08, 29.03] },
  { name: 'Kuala Lumpur', country: 'Malaysia', bbox: [3.11, 101.66, 3.18, 101.74] },
  { name: 'Singapore', country: 'Singapore', bbox: [1.28, 103.82, 1.34, 103.87] },
  { name: 'Auckland', country: 'New Zealand', bbox: [-36.88, 174.72, -36.83, 174.80] },
];

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const SHOP_TYPES = 'mobile|electronics|computer|hardware|variety|general|department_store|telecommunication';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(city, mirrorIndex = 0) {
  const [s, w, n, e] = city.bbox;
  const q = `[out:json][timeout:30];(
    nwr["shop"~"${SHOP_TYPES}"](${s},${w},${n},${e});
    nwr["amenity"~"internet_cafe"](${s},${w},${n},${e});
  );out center 200;`;
  const res = await fetch(MIRRORS[mirrorIndex % MIRRORS.length], {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'mhzaly-outreach/1.0' },
    body: `data=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t.name || t.brand || '';
    const email = String(t.email || t['contact:email'] || '').split(/[;,]/)[0].trim().toLowerCase();
    if (!name || !email) continue;
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) continue;
    if (/noreply|no-reply|example\.|test@|@example|@domain|@email|@sentry|wixpress/i.test(email)) continue;
    out.push({
      email,
      name: name.slice(0, 120),
      country: city.country,
      city: city.name,
      shop: (t.shop || t.amenity || '').slice(0, 80),
      source: 'osm-cloud',
      channel: city.country === 'PK' ? 'email-pk' : 'email-intl',
    });
  }
  return out;
}

async function collectLeads() {
  // Rotate 8 cities per day so the whole list is covered regularly.
  const day = Math.floor(Date.now() / 86400000);
  const todays = CITIES.filter((_, i) => i % 7 === day % 7);
  const found = [];
  for (let i = 0; i < todays.length; i++) {
    const city = todays[i];
    let rows = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        rows = await overpass(city, attempt);
        break;
      } catch (e) {
        console.log(`${city.name}: attempt ${attempt + 1} failed (${e.message})`);
        await sleep(1500);
      }
    }
    found.push(...rows);
    console.log(`${city.name} (${city.country}): ${rows.length} with email`);
    await sleep(1200);
  }
  // Dedupe within this run.
  const seen = new Set();
  return found.filter((x) => (seen.has(x.email) ? false : seen.add(x.email)));
}

// ── Email ────────────────────────────────────────────────────
function pkMessage(x) {
  const name = x.name || 'bhai';
  return `Assalam o Alaikum ${name},

Main mhzaly ki taraf se baat kar raha hoon — shop management software. Inventory, sales, customer khata, repair jobs aur profit report, sab ek hi jagah cloud par. Urdu aur English dono mein.

1 din ka free demo: ${SITE}

Agar interested na hon to "stop" reply kar dein — dobara email nahi karunga.

Shukriya,
mhzaly`;
}

function intlMessage(x) {
  const name = x.name || 'there';
  return `Hi ${name} team,

I'm reaching out from mhzaly, a cloud shop-management platform for retail and mobile shops. It brings inventory, sales, customer accounts, repairs and profit reports into one place, and works in English and Urdu.

If it's useful, I can set up a 1-day free demo for your store:
${SITE}

If you'd rather not hear from me, reply "stop" and I won't email again.

Best regards,
mhzaly`;
}

function sendMail(to, subject, body) {
  const eml = [
    `From: mhzaly <${USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    `List-Unsubscribe: <mailto:${USER}?subject=unsubscribe>`,
    '',
    body,
  ].join('\r\n');
  const tmp = path.join(os.tmpdir(), `mhzaly-${Date.now()}-${Math.random().toString(36).slice(2)}.eml`);
  fs.writeFileSync(tmp, eml);
  const netrc = path.join(os.tmpdir(), '.mhzaly-netrc');
  fs.writeFileSync(netrc, `machine smtp.gmail.com login ${USER} password ${PASS}\n`, { mode: 0o600 });
  try {
    execFileSync('curl', [
      '-sS', '--max-time', '35', '--url', 'smtp://smtp.gmail.com:587', '--ssl-reqd',
      '--netrc-file', netrc, '--mail-from', USER, '--mail-rcpt', to, '--upload-file', tmp,
    ], { stdio: 'pipe', timeout: 45000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.unlinkSync(netrc); } catch {}
  }
}

async function sendChannel(channel, cap) {
  if (cap <= 0) return { channel, sent: 0, failed: 0, skipped: 0 };
  const { leads } = await api(`/api/automaton/outreach/queue?channel=${encodeURIComponent(channel)}&limit=${cap}`);
  let sent = 0, failed = 0;
  for (const x of leads) {
    const isPk = channel === 'email-pk';
    const subject = isPk
      ? `1 din ka free demo — ${x.name || 'aap ki shop'} (mhzaly)`
      : `${x.name || 'your shop'} — 1-day free demo (mhzaly)`;
    const body = isPk ? pkMessage(x) : intlMessage(x);
    if (DRY) { console.log(`  [dry] ${channel} ${x.email}`); continue; }
    try {
      sendMail(x.email, subject, body);
      await api('/api/automaton/outreach/mark', 'POST', {
        email: x.email, channel, name: x.name, status: 'sent',
      });
      sent++;
      console.log(`  sent ${channel} ${x.email}`);
    } catch (e) {
      failed++;
      console.log(`  failed ${channel} ${x.email}: ${String(e.stderr || e.message).slice(0, 120)}`);
    }
    await sleep(2000);
  }
  return { channel, sent, failed, skipped: leads.length - sent - failed };
}

// ── Main ─────────────────────────────────────────────────────
const collected = await collectLeads();
console.log(`Collected ${collected.length} new leads with email`);
if (collected.length) {
  const imported = await api('/api/automaton/outreach/import', 'POST', { leads: collected });
  console.log(`Imported: ${JSON.stringify(imported)}`);
}

const statsBefore = await api('/api/automaton/outreach/stats');
console.log('Queue before:', JSON.stringify(statsBefore));

const pk = await sendChannel('email-pk', PK_CAP);
const intl = await sendChannel('email-intl', INTL_CAP);

const statsAfter = await api('/api/automaton/outreach/stats');
console.log(JSON.stringify({ mode: DRY ? 'dry' : 'send', pk, intl, statsBefore, statsAfter }, null, 2));
