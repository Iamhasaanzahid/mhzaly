#!/usr/bin/env node
/**
 * mhzaly Sales Automaton (local, real AI)
 * Uses Ollama on 127.0.0.1:11435. No paid keys required.
 * Generates honest marketing content and saves it to automaton-outbox/.
 * It does NOT post or email by itself (needs channel accounts/keys).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11435';
const MODEL = process.env.AUTOMATON_MODEL || 'qwen3:1.7b';
const OUT = process.env.AUTOMATON_OUTBOX || '/home/mhzaly/Documents/mhzaly/automaton-outbox';
const WALLET = '0xca4aF28D7A511Fffa664a913145D8bD8Df7EB4f3';
const REF = 'https://mhzaly.pages.dev/?ref=proof-agent';

const system = `/no_think
You are "mhzaly Sales Automaton" — an honest sales agent for mhzaly, a shop-management SaaS.
Product: inventory, sales, customers, repair jobs, suppliers, expenses, reports; Urdu/English; PKR/USD.
Plans: monthly/quarterly/annual for Pakistan and all countries. Lifetime USD 2000 ONLY for major countries (USA, UK, Canada, Australia, EU, Gulf); NEVER lifetime in Pakistan.
Payments: JazzCash, Western Union, Meezan, Stripe. Customer uploads receipt; owner verifies and activates.
Referral link: ${REF}
Rules: never invent features, discounts, customers, or results. Never spam. Never claim you did something you did not do. Be practical and specific to mobile/retail shops.
Output exactly these sections:
1) 5 social posts (Facebook/Instagram/WhatsApp) — short, benefit-led, Roman Urdu.
2) 3 WhatsApp messages for shop owners — personal, no spam.
3) 1 email outreach template (subject + body).
4) 10 lead categories to target (specific shop types/areas).
5) Today's 24-hour action plan (concrete steps).
Keep the whole answer under 900 words.`;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { temperature: 0.4, num_predict: 1200 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Generate today's marketing kit. Date: ${new Date().toISOString().slice(0, 10)}.` },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ollama HTTP ${res.status}`);
  const text = String(data.message?.content || '').trim();
  if (!text) throw new Error('Ollama returned empty content');

  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(OUT, `${day}-marketing.md`);
  const header = `# mhzaly Sales Automaton — ${day}\n\n` +
    `- Model: \`${MODEL}\` (local Ollama)\n` +
    `- Referral link: ${REF}\n` +
    `- Automaton wallet (30% USDC): \`${WALLET}\`\n` +
    `- Generated: ${new Date().toISOString()}\n\n---\n\n`;
  await fs.writeFile(file, header + text + '\n', 'utf8');
  await fs.writeFile(path.join(OUT, 'email-identity.txt'),
    `Name: mhzaly Sales Automaton\nRole: Referral & sales agent for mhzaly\nReferral link: ${REF}\nUSDC wallet: ${WALLET}\nSignature: — mhzaly Sales Automaton\n`, 'utf8');
  await fs.appendFile(path.join(OUT, 'run.log'),
    `${new Date().toISOString()} ok model=${MODEL} ms=${Date.now() - started} file=${file}\n`, 'utf8');
  console.log(`OK ${file} (${Date.now() - started} ms)`);
  console.log(text.slice(0, 1200));
}

main().catch(async (err) => {
  const msg = `${new Date().toISOString()} error ${err.message}\n`;
  try { await fs.mkdir(OUT, { recursive: true }); await fs.appendFile(path.join(OUT, 'run.log'), msg, 'utf8'); } catch {}
  console.error('ERROR:', err.message);
  process.exit(1);
});
