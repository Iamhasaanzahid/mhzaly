#!/usr/bin/env node
/**
 * mhzaly Sales Automaton — daily marketing kit
 *
 * This is deliberately template-based (not model-generated) so it never
 * invents features, prices, customers or results. The Growth Agent handles
 * real lead discovery and email drafts; this script prepares honest social /
 * WhatsApp / email copy with a clear CTA.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'automaton-outbox');
const TODAY = new Date().toISOString().slice(0, 10);
const WA = '923321141889';
const WA_DISPLAY = '0332 1141889';
const REF = 'https://mhzaly.pages.dev/?ref=proof-agent';
const SELL = 'https://mhzaly.pages.dev/sell';
const EMAIL = 'mhzcyb@gmail.com';

const social = [
  `Dukaan ka hisaab ab register aur Excel mein nahi — mhzaly mein. Inventory, sales, customer khata, repair jobs aur profit reports, sab ek jagah. Urdu aur English. Demo ke liye WhatsApp: ${WA_DISPLAY} ya ${SELL}`,
  `Mobile shop owners: repair job ka status, parts ka cost aur customer ka number — sab record mein rakhein. mhzaly se kaam asaan. 1 din ka demo: WhatsApp ${WA_DISPLAY}`,
  `Udhaar khata digital karein: customer ka balance, purani sale aur wasooli — ek click par. Register dhoondne ki zaroorat nahi. Demo: WhatsApp ${WA_DISPLAY} ya ${SELL}`,
  `Stock khatam hone se pehle pata chal jaye — mhzaly low-stock alerts deta hai. Mobile shop, mart ya general store ke liye. Demo: WhatsApp ${WA_DISPLAY}`,
  `Nayi dukaan shuru kar rahe hain? mhzaly se pehle din se saaf hisaab rakhein — sale, kharcha, supplier aur profit. Plans: ${SELL} • WhatsApp ${WA_DISPLAY}`,
];

const whatsapp = [
  `Assalam o Alaikum! mhzaly ek simple shop management software hai — inventory, sales, customer khata, repair jobs aur profit reports. Aap ki dukaan ke liye 1 din ka free demo de sakta hoon. Interested hain?`,
  `Assalam o Alaikum! Aap ki mobile/retail dukaan ke liye ek simple hisaab system: sale, stock, udhaar aur repair job — sab ek app mein. 1 din demo bilkul free. Batayein?`,
  `Assalam o Alaikum! Agar dukaan ka hisaab register/Excel mein hai aur mahine ke end par confusion hoti hai, to mhzaly try karein. 1 din ka demo available hai. WhatsApp: ${WA_DISPLAY}`,
];

const email = `Subject: mhzaly — ${'{{shopName}}'} ke liye simple shop management software

Assalam o Alaikum {{shopName}},

mhzaly ek simple shop management software hai — inventory, sales, customer khata, repair jobs, suppliers, expenses aur profit reports, sab ek jagah. Urdu aur English dono mein.

Aap ki dukaan ({{area}}) ke liye 1 din ka free demo de sakta hoon. Agar interested hain to is email ka reply karein ya WhatsApp: https://wa.me/${WA}

Plans aur details: ${SELL}

Shukriya,
mhzaly Sales Automaton
${EMAIL}
`;

const leads = [
  'Mobile phone shops (new + used)',
  'Mobile repair centers',
  'Mobile accessories shops',
  'Electronics stores',
  'Computer / laptop shops',
  'General stores and marts',
  'Pharmacies',
  'Stationery shops',
  'Mobile phone wholesalers / distributors',
  'Shopping plaza / market shops in Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad, Peshawar, Multan, Gujranwala',
];

const plan = `1. Open automaton-outbox/leads-${TODAY}.md (real shops from OpenStreetMap).
2. Send 10 WhatsApp messages using the links in the lead sheet (do not spam; one message per shop).
3. Send 5 emails from automaton-outbox/outbox/*.eml (review before sending).
4. Post 2 social posts from this file on your shop/business page.
5. Log replies and demos in a simple sheet.
6. Follow up once after 48 hours. Never message more than once without a reply.
7. Target: 3 demos this week; do not promise customers or results.`;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const lines = [
    `# mhzaly Sales Automaton — ${TODAY}`,
    '',
    `- Referral link: ${REF}`,
    `- Plans page: ${SELL}`,
    `- WhatsApp: ${WA_DISPLAY}`,
    `- Email: ${EMAIL}`,
    '',
    '> Honest copy only. No fake discounts, customers, statistics or results.',
    '',
    '## 1) Social posts',
    '',
    ...social.map((s, i) => `**${i + 1}.** ${s}\n`),
    '## 2) WhatsApp messages',
    '',
    ...whatsapp.map((s, i) => `**${i + 1}.** ${s}\n`),
    '## 3) Email outreach template',
    '',
    '```',
    email.trim(),
    '```',
    '',
    '## 4) Lead categories',
    '',
    ...leads.map((s) => `- ${s}`),
    '',
    '## 5) 24-hour action plan',
    '',
    plan.split('\n').map((s) => `- ${s.replace(/^\d+\.\s*/, '')}`).join('\n'),
    '',
  ];
  const file = path.join(OUT, `${TODAY}-marketing.md`);
  await fs.writeFile(file, lines.join('\n'), 'utf8');
  await fs.appendFile(path.join(OUT, 'run.log'), `${new Date().toISOString()} ok template file=${file}\n`, 'utf8');
  console.log(`OK ${file} (template, no model)`);
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
