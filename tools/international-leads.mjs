#!/usr/bin/env node
/**
 * International real-business lead collector for mhzaly.
 * Uses OpenStreetMap Overpass — public, real business listings only.
 * Captures shops with email / website / phone in major international markets.
 * No fake data, no scraping of personal information.
 *
 *   node tools/international-leads.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'automaton-outbox');
const STORE = path.join(OUT, 'international-leads.json');
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// Real metro areas in mhzaly's target international markets (lifetime-plan countries)
const CITIES = [
  { name: 'London', country: 'UK', bbox: [51.45, -0.25, 51.55, -0.05] },
  { name: 'Manchester', country: 'UK', bbox: [53.46, -2.30, 53.51, -2.20] },
  { name: 'New York', country: 'USA', bbox: [40.70, -74.02, 40.76, -73.96] },
  { name: 'Los Angeles', country: 'USA', bbox: [34.02, -118.30, 34.08, -118.22] },
  { name: 'Toronto', country: 'Canada', bbox: [43.63, -79.45, 43.71, -79.36] },
  { name: 'Sydney', country: 'Australia', bbox: [-33.88, 151.18, -33.84, 151.24] },
  { name: 'Dubai', country: 'UAE', bbox: [25.16, 55.24, 25.24, 55.34] },
  { name: 'Berlin', country: 'Germany', bbox: [52.49, 13.38, 52.53, 13.44] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(city, attempt = 1) {
  const [s, w, n, e] = city.bbox;
  const q = `[out:json][timeout:25];(
    nwr["shop"~"mobile|electronics|computer|hardware|variety|general"](${s},${w},${n},${e});
    nwr["amenity"~"internet_cafe"](${s},${w},${n},${e});
  );out center 150;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'mhzaly-growth/1.0' },
    body: `data=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t.name || t['brand'] || '';
    if (!name) continue;
    const email = t.email || t['contact:email'] || '';
    const website = t.website || t['contact:website'] || '';
    const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || '';
    if (!email && !website && !phone) continue; // only reachable real businesses
    out.push({
      name, shop: t.shop || t.amenity || '', country: city.country, city: city.name,
      street: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
      email, website, phone,
      lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon,
    });
  }
  return out;
}

let store = [];
try { store = JSON.parse(await fs.readFile(STORE, 'utf8')); } catch {}

for (const city of CITIES) {
  try {
    const rows = await overpass(city);
    const before = store.length;
    for (const r of rows) {
      const key = `${r.name.toLowerCase()}-${r.city}`;
      if (!store.some((x) => `${x.name.toLowerCase()}-${x.city}` === key)) store.push(r);
    }
    console.log(`${city.name} (${city.country}): +${store.length - before} (${rows.length} reachable found)`);
  } catch (e) {
    console.log(`${city.name}: failed (${e.message})`);
  }
  await sleep(1500);
}

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(STORE, JSON.stringify(store, null, 2));
const withEmail = store.filter((x) => x.email).length;
const withSite = store.filter((x) => x.website).length;
const withPhone = store.filter((x) => x.phone).length;
console.log(JSON.stringify({
  total: store.length, withEmail, withWebsite: withSite, withPhone,
  countries: [...new Set(store.map((x) => x.country))], file: 'automaton-outbox/international-leads.json',
}, null, 2));
