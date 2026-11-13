/* ============================================================
   mhzaly — advanced on-device intelligence (free, no model needed)
   Counterfactual simulator ("what if I…"), anomaly detection and
   plain-language plan generation. All computed from the local shop
   database — zero cost, zero network.
   ============================================================ */

import { db } from '../db.js';
import {
  salesInDays, sumBy, saleProfit, dailySeries, businessHealth, profitLeaks,
  restockPlan, customerSegments, customerRisk,
} from '../insights.js';
import { money } from '../receipt-share.js';

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function pct(value) {
  return `${Math.round((Number(value) || 0))}%`;
}

/* ---------- What-if simulator ---------- */

/**
 * Answers "agar main 10% discount dun to?" style questions by replaying
 * the last 30 days through the change.
 */
export function whatIf(query) {
  const q = String(query || '').toLowerCase();
  const sales = salesInDays(30);
  if (!sales.length) {
    return 'Is simulator ke liye thori sale history chahiye — abhi koi sale record nahi hai.';
  }
  const revenue = sumBy(sales, 'total');
  const gross = sales.reduce((sum, s) => sum + saleProfit(s), 0);
  const expenses = sumBy(
    db.expenses.filter((e) => new Date(e.createdAt || 0) >= new Date(Date.now() - 30 * 86400000)),
    'amount'
  );
  const net = gross - expenses;
  const margin = revenue ? net / revenue : 0;
  const avgBill = revenue / sales.length;
  const avgProfitPerBill = net / sales.length;

  const discountPct =
    matchNumber(q, /(?:discount|kam|off)\D{0,14}(\d{1,2})\s*%/) ||
    matchNumber(q, /(\d{1,2})\s*%\s*(?:discount|kam|off)/);
  const priceUpPct = matchNumber(q, /price\D{0,14}(\d{1,2})\s*%/) ||
    matchNumber(q, /(\d{1,2})\s*%\s*(?:price|rate|qeemat)/);
  const qtyMatch = q.match(/(\d{1,6})\s*(kg|unit|units|pcs|pack|packet|pieces|bottle)?\D{0,12}(?:bech|bik|sell|bika)/);

  if (discountPct != null && discountPct > 0 && discountPct <= 90) {
    const lost = revenue * (discountPct / 100);
    const newNet = net - lost;
    const extraBills = avgProfitPerBill > 0 ? Math.ceil(lost / avgProfitPerBill) : null;
    const volumeLift = net > 0 ? Math.round((lost / (net + lost)) * 100) : null;
    const verdict = net <= 0
      ? `<b>⚠️ Aap ka net profit abhi negative hai (${money(net)}) — discount se nuqsaan aur barhega. Pehle kharcha kam karein.</b>`
      : extraBills
        ? `Break-even ke liye <b>${extraBills} extra bills</b> chahiye (${volumeLift}% zyada bikri).`
        : `Break-even ke liye extra bikri chahiye.`;
    return `<b>🧪 What-if: ${discountPct}% discount</b>
${stat('Revenue (30 din)', money(revenue))}
${stat('Gross profit', money(gross))}
${stat('Expenses', money(expenses))}
${stat('Current net profit', money(net))}
${stat('Discount ka nuqsaan', `- ${money(lost)}`)}
${stat('Discount ke baad net profit', money(newNet))}
<div class="ai-note">${verdict}</div>
<span style="color:#64748b">Discount tabhi faida deta hai jab extra bikri asli margin se zyada laaye.</span>`;
  }

  if (priceUpPct != null && priceUpPct > 0 && priceUpPct <= 100) {
    const gain = revenue * (priceUpPct / 100);
    const sameVolume = net + gain;
    const dropPct = Math.min(60, Math.round(priceUpPct * 0.5));
    const revenueAfterDrop = revenue * (1 - dropPct / 100);
    const withDrop = margin > 0 ? sameVolume - revenueAfterDrop * margin : sameVolume;
    const best = bestMarginProduct();
    return `<b>🧪 What-if: price ${priceUpPct}% up</b>
${stat('Revenue (30 din)', money(revenue))}
${stat('Current net profit', money(net))}
${stat('Same volume par net profit', money(sameVolume))}
${stat(`${dropPct}% volume girne par`, money(withDrop))}
${margin <= 0 ? '<div class="ai-note">⚠️ Net margin negative hai — volume girne par bhi nuqsaan barhega, faida nahi hoga.</div>' : ''}
${best ? stat('Sab se zyada margin wala product', `${best.name} (${money(best.unitProfit)}/unit)`) : ''}
<div class="ai-note">Price badha kar pehle <b>ek hi product</b> par test karein — poore menu ka price ek saath mat badlein.</div>`;
  }

  if (qtyMatch) {
    const qty = Number(qtyMatch[1]);
    const unit = qtyMatch[2] || 'unit';
    const top = bestMarginProduct();
    if (!top) return 'Profit calculate karne ke liye koi product nahi mila.';
    const extraProfit = qty * top.unitProfit;
    const stockOk = top.stock >= qty;
    return `<b>🧪 What-if: ${qty} ${unit} extra bechein</b>
${stat('Product', top.name)}
${stat('Profit per unit', money(top.unitProfit))}
${stat('Extra profit', money(extraProfit))}
${stat('New monthly net profit', money(net + extraProfit))}
${stat('Stock', `${top.stock} ${unit} (${stockOk ? 'stock mein hai' : 'STOCK NAHI HAI — order karein'})`)}
<span style="color:#64748b">Ye product aapka sab se zyada margin wala hai — yahin promote karein.</span>`;
  }

  return null;
}

function matchNumber(text, regex) {
  const m = text.match(regex);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function bestMarginProduct() {
  const sales = salesInDays(30);
  const sold = new Map();
  for (const sale of sales) {
    for (const it of sale.items || []) {
      const key = it.id || it.name;
      sold.set(key, (sold.get(key) || 0) + (Number(it.qty) || 1));
    }
  }
  let best = null;
  for (const product of db.products || []) {
    const price = Number(product.price) || 0;
    const cost = Number(product.cost) || 0;
    const unitProfit = price - cost;
    if (unitProfit <= 0) continue;
    const qty = sold.get(product.id) || sold.get(String(product.name || '').toLowerCase()) || 0;
    if (!qty) continue;
    if (!best || qty * unitProfit > best.qty * best.unitProfit) {
      best = { name: product.name, unitProfit, qty, stock: Number(product.stock) || 0 };
    }
  }
  return best;
}

/* ---------- Anomaly detection ---------- */

export function detectAnomalies() {
  const issues = [];
  const sales = salesInDays(30);
  const now = Date.now();

  // 1. unusually large bills
  if (sales.length >= 5) {
    const totals = sales.map((s) => Number(s.total) || 0).sort((a, b) => a - b);
    const median = totals[Math.floor(totals.length / 2)];
    const big = sales.filter((s) => (Number(s.total) || 0) > median * 4 && (Number(s.total) || 0) > 5000);
    if (big.length) {
      issues.push({
        level: 'warn',
        title: `${big.length} bill aam se ${4}x bade hain`,
        detail: `Sabse bara bill ${Math.round(Math.max(...totals)).toLocaleString()} — normal bill ${Math.round(median).toLocaleString()} ke aas paas hai.`,
        action: 'Misaal jaan lein — koi return, galti ya bulk order to nahi?',
      });
    }
  }

  // 2. heavy discounts
  const discounted = sales.filter((s) => Number(s.discount || 0) > 0);
  const discountTotal = discounted.reduce((sum, s) => sum + (Number(s.discount) || 0), 0);
  if (discountTotal > 0 && sumBy(sales, 'total') > 0 && discountTotal / sumBy(sales, 'total') > 0.08) {
    issues.push({
      level: 'warn',
      title: 'Discount zyada diya ja raha hai',
      detail: `${discounted.length} bills par ${Math.round(discountTotal).toLocaleString()} discount gaya (${pct((discountTotal / sumBy(sales, 'total')) * 100)} of sales).`,
      action: 'Har bill par discount limit lagayein',
    });
  }

  // 3. negative or impossible stock
  const negative = (db.products || []).filter((p) => Number(p.stock) < 0);
  if (negative.length) {
    issues.push({
      level: 'danger',
      title: `${negative.length} products ka stock minus mein hai`,
      detail: negative.slice(0, 3).map((p) => `${p.name} (${p.stock})`).join(', '),
      action: 'Stock correction karein — returns ya manual entry check karein',
    });
  }

  // 4. price below cost
  const belowCost = (db.products || []).filter((p) => Number(p.price) > 0 && Number(p.cost) > 0 && Number(p.price) < Number(p.cost));
  if (belowCost.length) {
    issues.push({
      level: 'danger',
      title: `${belowCost.length} products cost se neeche bech rahe hain`,
      detail: belowCost.slice(0, 3).map((p) => `${p.name} (cost ${p.cost} → price ${p.price})`).join(', '),
      action: 'Price foran theek karein',
    });
  }

  // 5. udhaar jump
  const risky = (db.customers || [])
    .map((c) => ({ c, risk: customerRisk(c) }))
    .filter((x) => x.risk.balance > 0 && x.risk.sincePayment != null && x.risk.sincePayment > 45);
  if (risky.length) {
    issues.push({
      level: 'warn',
      title: `${risky.length} customers ka udhaar 45+ din purana hai`,
      detail: risky.slice(0, 3).map((x) => `${x.c.name} (${x.risk.balance})`).join(', '),
      action: 'Reminder bhejein ya personal visit karein',
    });
  }

  // 6. demand spike on a product
  const series = dailySeries(14);
  const soldByProduct = new Map();
  for (const sale of db.sales) {
    const t = new Date(sale.createdAt || 0).getTime();
    if (t < now - 7 * 86400000) continue;
    for (const it of sale.items || []) {
      const key = it.id || it.name;
      soldByProduct.set(key, (soldByProduct.get(key) || 0) + (Number(it.qty) || 1));
    }
  }
  const plan = restockPlan({ days: 30 });
  for (const row of plan.rows) {
    const sold7 = soldByProduct.get(row.product.id) || 0;
    if (sold7 >= 5 && row.cover != null && row.cover <= 2) {
      issues.push({
        level: 'warn',
        title: `${row.product.name} — stock khatam hone wala hai`,
        detail: `Pichhle 7 din ${sold7} unit biki, stock ${row.stock} (≈${Math.round(row.cover)} din ka cover).`,
        action: 'Aaj hi order kar dein',
      });
    }
  }

  // 7. dead stock with money stuck
  const leaks = profitLeaks();
  const dead = leaks.leaks.find((l) => l.kind === 'dead-stock');
  if (dead) {
    issues.push({
      level: 'warn',
      title: 'Dead stock mein paisa phansa hua hai',
      detail: dead.detail,
      action: 'Discount/bundle ya supplier return',
    });
  }

  // 8. sales dropped sharply
  const last7 = series.slice(-7).reduce((sum, d) => sum + d.total, 0);
  const prev7 = series.slice(-14, -7).reduce((sum, d) => sum + d.total, 0);
  if (prev7 > 0 && last7 < prev7 * 0.6) {
    issues.push({
      level: 'warn',
      title: 'Sales pichle hafte se gir gaye hain',
      detail: `${Math.round(prev7).toLocaleString()} → ${Math.round(last7).toLocaleString()} (${pct(((last7 - prev7) / prev7) * 100)})`,
      action: 'Stock-out, price change ya competition check karein',
    });
  }

  return issues;
}

export function anomalyAnswer() {
  const issues = detectAnomalies();
  if (!issues.length) {
    return `✅ <b>Koi unusual cheez nahi mili.</b> Sales, stock, pricing aur udhaar sab normal range me hain.`;
  }
  const rows = issues
    .map((i) => `<li><b>${esc2(i.title)}</b><br><span style="color:#64748b">${esc2(i.detail)}</span><br>→ ${esc2(i.action)}</li>`)
    .join('');
  return `<b>🔎 Anomalies / jo cheezein theek nahi hain (${issues.length}):</b><ul>${rows}</ul>`;
}

function esc2(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stat(label, value) {
  return `<div class="ai-stat"><span>${esc2(label)}</span><b>${value}</b></div>`;
}

/* ---------- Plain-language action plan ---------- */

export function planAnswer() {
  const health = businessHealth();
  const plan = restockPlan({ days: 30 });
  const leaks = profitLeaks();
  const segments = customerSegments();

  const steps = [];
  if (plan.reorder.length) {
    const first = plan.reorder[0];
    steps.push(`<b>1. ${plan.reorder.length} products order karein</b> — sab se pehle ${esc2(first.product.name)} (${first.suggested} units, stock ${first.stock})`);
  }
  const leak = leaks.leaks.find((l) => l.kind !== 'pricing-upside');
  if (leak) {
    steps.push(`<b>${steps.length + 1}. ${esc2(leak.title)}</b> — ${esc2(leak.action)} (${money(leak.amount)} recover ho sakta hai)`);
  }
  const atRisk = segments.filter((s) => s.segment === 'At risk' || s.segment === 'Dormant');
  if (atRisk.length) {
    steps.push(`<b>${steps.length + 1}. ${atRisk.length} customers ko reminder bhejein</b> — ${atRisk.slice(0, 3).map((s) => esc2(s.customer.name)).join(', ')}`);
  }
  const dayTotal = dailySeries(1)[0]?.total || 0;
  if (dayTotal === 0) {
    steps.push(`<b>${steps.length + 1}. Aaj ek sale to banayein</b> — dashboard + reports tab meaningful honge`);
  }
  steps.push(`<b>${steps.length + 1}. Din ke end par Day Close karein</b> — expected vs counted cash ka farq pata chal jayega`);

  return `<b>📋 Aaj ka action plan (${steps.length} steps):</b><ul>${steps.map((s) => `<li>${s}</li>`).join('')}</ul>
${stat('Business Health', `${health.score}/100 · ${health.grade}`)}
${stat('Money on the table', money(leaks.recoverable))}
<span style="color:#64748b">Har step ke liye app ka us page par button hai.</span>`;
}
