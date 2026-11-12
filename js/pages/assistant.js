/* ============================================================
   mhzaly — Smart AI Assistant (offline, data-aware, free)
   Tries to answer almost every shop-related question from
   local database. No API key, no internet, bilkul free.
   ============================================================ */

import { db, lowStockProducts, totalReceivable } from '../db.js';
import { icon, esc, toast } from '../ui.js';
import { money } from '../receipt-share.js';
import { businessHealth, restockPlan, customerRisk, dayCloseSummary, forecastNext7, taxSummary, profitLeaks, customerSegments } from '../insights.js';

export const meta = { title: 'AI Assistant', subtitle: 'Aap ke shop data se smart jawab' };

const EXAMPLES = [
  'Business health kaisi hai?',
  'Paisa kahan leak ho raha hai?',
  'Restock kya karun?',
  'Aaj ka cash hisab?',
  'Kaun customer risky hai?',
  'Customer segments batao',
  'Next week ka forecast?',
  'Aaj ki sale kitni hai?',
];

/* ---------- date helpers ---------- */
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function rangeBounds(kind) {
  const now = new Date(); const today = startOfDay(now);
  if (kind === 'today') return [today, null];
  if (kind === 'yesterday') { const s = new Date(today); s.setDate(s.getDate()-1); return [s, today]; }
  if (kind === 'week') { const s = new Date(today); s.setDate(s.getDate()-6); return [s, null]; }
  if (kind === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), null];
  if (kind === 'year') return [new Date(now.getFullYear(), 0, 1), null];
  return [null, null];
}
const RANGE_LABEL = { today:'Aaj', yesterday:'Kal', week:'Pichhle 7 din', month:'Is mahine', year:'Is saal', all:'Ab tak' };

function detectRange(q) {
  if (/\b(aaj|aj|today)\b/.test(q)) return 'today';
  if (/\b(kal|yesterday)\b/.test(q)) return 'yesterday';
  if (/\b(hafta|hafte|week)\b/.test(q)) return 'week';
  if (/\b(mahina|mahine|month)\b/.test(q)) return 'month';
  if (/\b(saal|year)\b/.test(q)) return 'year';
  if (/\b(total|kul|sab|all|overall)\b/.test(q)) return 'all';
  return 'today';
}

function inBounds(iso, [start, end]) {
  const t = new Date(iso || 0).getTime();
  if (start && t < start.getTime()) return false;
  if (end && t >= end.getTime()) return false;
  return true;
}
function salesIn(kind) { const b = rangeBounds(kind); return db.sales.filter((s) => inBounds(s.createdAt, b)); }
function expensesIn(kind) { const b = rangeBounds(kind); return db.expenses.filter((e) => inBounds(e.createdAt, b)); }

function profitOf(sales) {
  let p = 0;
  for (const s of sales) {
    if (Array.isArray(s.items) && s.items.length) {
      for (const it of s.items) {
        const prod = db.products.find((x) => x.id === it.id || x.id === it.productId);
        const cost = prod ? Number(prod.cost) || 0 : 0;
        const qty = Number(it.qty) || 1;
        p += ((Number(it.price) || 0) - cost) * qty;
      }
    } else if (s.productId) {
      const prod = db.products.find((x) => x.id === s.productId);
      const cost = prod ? Number(prod.cost) || 0 : 0;
      p += (Number(s.total) || 0) - cost * (Number(s.qty) || 1);
    }
  }
  return p;
}
function sum(list, key) { return list.reduce((a, x) => a + (Number(x[key]) || 0), 0); }

function topProducts(sales, limit = 5) {
  const map = new Map();
  for (const s of sales) for (const it of (s.items || [])) {
    const key = it.id || it.name;
    const row = map.get(key) || { name: it.name || 'Item', qty: 0, revenue: 0 };
    const qty = Number(it.qty) || 1;
    row.qty += qty; row.revenue += qty * (Number(it.price) || 0);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}
function bottomProducts(sales, limit = 5) {
  const map = new Map();
  for (const s of sales) for (const it of (s.items || [])) {
    const key = it.id || it.name;
    const row = map.get(key) || { name: it.name || 'Item', qty: 0, revenue: 0 };
    const qty = Number(it.qty) || 1;
    row.qty += qty; row.revenue += qty * (Number(it.price) || 0);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.qty - b.qty).slice(0, limit);
}
function topCustomers(sales, limit = 5) {
  const map = new Map();
  for (const s of sales) {
    const name = (s.customerName || 'Walk-in').trim() || 'Walk-in';
    if (/^walk[- ]?in$/i.test(name)) continue;
    const row = map.get(name) || { name, total: 0, count: 0 };
    row.total += Number(s.total) || 0; row.count += 1; map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}
function paymentBreakdown(sales) {
  const map = new Map();
  for (const s of sales) { const m = s.paymentMethod || 'Cash'; map.set(m, (map.get(m) || 0) + (Number(s.total) || 0)); }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
function dailySeries(days = 7) {
  const out = []; const today = startOfDay(new Date());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const total = db.sales.filter((s) => { const t = new Date(s.createdAt || 0).getTime(); return t >= d.getTime() && t < next.getTime(); }).reduce((a, s) => a + (Number(s.total) || 0), 0);
    out.push({ date: d, total });
  }
  return out;
}

/* ---------- entity matching ---------- */
const SKIP_WORDS = new Set([
  'sale','sales','stock','price','rate','cost','profit','udhaar','udhar','kharch','kharcha','expense',
  'customer','customers','supplier','suppliers','product','products','item','items','invoice','invoices',
  'bill','bills','report','reports','summary','hisab','aaj','kal','hafta','week','mahina','month','saal',
  'year','total','kul','kitna','kitni','kitne','hai','hain','ka','ki','ke','low','out','the','and','for',
  'kya','bika','bikta','top','best','sab','se','zyada','kaisa','chal','raha','mujhe','batao','value',
  'inventory','maal','compare','versus','vs','muqabla','dena','daina','lena','baqaya','balance','restock',
  'reorder','kam','zyada','saste','mehnge','sasta','mehnga','kahan','kab','kaise','kyun','why','how',
]);

function wordsOf(q) { return new Set(q.replace(/[()]/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean)); }
function findProduct(q) {
  const words = wordsOf(q);
  let best = null, bestScore = 0;
  for (const p of db.products) {
    const name = String(p.name||'').toLowerCase().replace(/[()]/g,' ').replace(/\s+/g,' ').trim();
    if (!name) continue;
    const nt = name.split(' ').filter(Boolean);
    if (nt.length && nt.every((t)=>words.has(t))) return p;
    const tokens = nt.filter((t)=>t.length>2 && !SKIP_WORDS.has(t));
    if (!tokens.length) continue;
    const hits = tokens.filter((t)=>words.has(t)).length;
    if (!hits) continue;
    const score = hits / Math.min(tokens.length, 2);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore >= 0.5 ? best : null;
}
function findByName(list, q) {
  const words = wordsOf(q);
  let best = null, bestScore = 0;
  for (const item of list) {
    const name = String(item.name||'').toLowerCase().replace(/[()]/g,' ').replace(/\s+/g,' ').trim();
    if (!name) continue;
    const tokens = name.split(' ').filter((t)=>t.length>2);
    if (!tokens.length) continue;
    const hits = tokens.filter((t)=>words.has(t)).length;
    if (!hits) continue;
    const score = hits / Math.min(tokens.length, 2);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 0.5 ? best : null;
}

/* ---------- formatters ---------- */
function stat(label, value) { return `<div class="ai-stat"><span>${esc(label)}</span><b>${value}</b></div>`; }
function hbar(label, value, max, right) {
  const pct = max ? Math.max(3, Math.round((value/max)*100)) : 0;
  return `<div class="ai-hbar"><div class="ai-hbar-top"><span>${esc(label)}</span><b>${right}</b></div><div class="ai-hbar-track"><div class="ai-hbar-fill" style="width:${pct}%"></div></div></div>`;
}
function barChart(series) {
  const max = Math.max(...series.map((x)=>x.total), 1);
  return `<div class="ai-chart">${series.map((x)=>{
    const h = Math.max(4, Math.round((x.total/max)*100));
    const label = x.date.toLocaleDateString('en-GB',{weekday:'short'}).slice(0,2);
    return `<div class="ai-bar-col" title="${label}: ${money(x.total)}"><div class="ai-bar-track"><div class="ai-bar-fill" style="height:${h}%"></div></div><span>${label}</span></div>`;
  }).join('')}</div>`;
}
function pctSign(n) { return n > 0 ? '+' + n : (n < 0 ? n : '±0'); }

/* ---------- answers ---------- */
function summaryAnswer() {
  const sales = salesIn('today');
  const revenue = sum(sales,'total');
  const gross = profitOf(sales);
  const exp = sum(expensesIn('today'),'amount');
  const low = lowStockProducts();
  return `<b>📊 Aaj ka summary</b>${stat('Sale', money(revenue))}${stat('Invoices', sales.length)}${stat('Gross profit', money(gross))}${stat('Kharcha', money(exp))}${stat('Net profit', money(gross-exp))}${stat('Low stock items', low.length)}${stat('Total udhaar', money(totalReceivable()))}${low.length?`<br><b>⚠️ Low stock:</b> ${low.slice(0,6).map((p)=>esc(p.name)).join(', ')}${low.length>6?'…':''}`:''}<div class="ai-chart-title">Pichhle 7 din</div>${barChart(dailySeries(7))}`;
}
function compareAnswer() {
  const t = salesIn('today'); const y = salesIn('yesterday');
  const tv = sum(t,'total'); const yv = sum(y,'total'); const diff = tv - yv;
  const pct = yv ? Math.round((diff/yv)*100) : tv ? 100 : 0;
  const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➖';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  return `<b>${arrow} Aaj vs Kal</b>${stat('Aaj ki sale', money(tv))}${stat('Kal ki sale', money(yv))}${stat('Farq', `${sign}${money(Math.abs(diff))} (${pct>=0?'+':''}${pct}%)`)}${stat('Aaj invoices', t.length)}${stat('Kal invoices', y.length)}`;
}
function bestDayAnswer() {
  const map = new Map();
  for (const s of db.sales) {
    const d = new Date(s.createdAt||0); if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0,10);
    map.set(key, (map.get(key)||0) + (Number(s.total)||0));
  }
  const days = [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  if (!days.length) return 'Abhi koi sale record nahi.';
  return `<b>🏅 Best sale days</b><ul>${days.map(([k,v])=>`<li><b>${new Date(k+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</b> — ${money(v)}</li>`).join('')}</ul>`;
}
function stockValueAnswer() {
  let cost = 0, sale = 0, units = 0;
  for (const p of db.products) {
    const st = Number(p.stock)||0; units += st; cost += st*(Number(p.cost)||0); sale += st*(Number(p.price)||0);
  }
  return `<b>📦 Inventory value</b>${stat('Total units', units)}${stat('Cost value', money(cost))}${stat('Sale value', money(sale))}${stat('Potential profit', money(sale-cost))}`;
}
function restockAnswer() {
  const plan = restockPlan({
    days: 30,
    leadDays: Number(db.settings.restockLeadDays) || 7,
    coverDays: Number(db.settings.restockCoverDays) || 14,
  });
  if (!plan.reorder.length) return `✅ <b>Sab stock theek hai!</b> Koi product restock ki zaroorat nahi.`;
  const list = plan.reorder.slice(0, 10).map((row) => {
    const cover = row.cover == null ? '—' : `${Math.round(row.cover)}d`;
    return `<li><b>${esc(row.product.name)}</b> — stock ${row.stock}, sold ${row.sold}, cover ${cover}, order <b>${row.suggested}</b> ${esc(row.product.unit || 'pcs')} (${money(row.cost)})</li>`;
  }).join('');
  return `<b>📦 Smart restock plan (${plan.reorder.length} products):</b><ul>${list}</ul>${plan.reorder.length > 10 ? `<br>…aur ${plan.reorder.length - 10} products.` : ''}${stat('Estimated purchase', money(plan.totals.cost))}${stat('Dead stock value', money(plan.totals.deadValue))}<br><span style="color:#64748b">Full plan, lead time aur cover days Smart Restock page par adjust karein.</span>`;
}

function healthAnswer() {
  const h = businessHealth();
  const bars = [
    ['Sales', h.salesScore],
    ['Profit', h.profitScore],
    ['Stock', h.stockScore],
    ['Credit', h.creditScore],
    ['Expenses', h.expenseScore],
  ].map(([label, value]) => hbar(label, value, 100, `${value}/100`)).join('');
  return `<b>🫀 Business Health: ${h.score}/100 — ${h.grade}</b>${bars}${stat('30-day revenue', money(h.revenue))}${stat('Gross profit', money(h.profit))}${stat('Receivable', money(h.receivable))}${stat('Low stock', h.lowCount)}<br><b>Action plan:</b><ul>${h.actions.map((a) => `<li><b>${esc(a.label)}</b> — ${esc(a.detail)}</li>`).join('')}</ul>`;
}

function creditRiskAnswer() {
  const list = db.customers
    .filter((c) => (Number(c.balance) || 0) > 0)
    .map((c) => ({ customer: c, risk: customerRisk(c) }))
    .sort((a, b) => b.risk.score - a.risk.score);
  if (!list.length) return `✅ <b>Koi udhaar baqi nahi.</b> Sab customers clear hain.`;
  const html = list.slice(0, 12).map(({ customer, risk }) =>
    `<li><b>${esc(customer.name)}</b> — ${money(customer.balance)} · <span class="badge ${risk.tone}">${risk.level} risk</span><br><span style="color:#64748b">${esc(risk.reason)}</span></li>`
  ).join('');
  return `<b>⚠️ Customer credit risk:</b><ul>${html}</ul>${list.length > 12 ? `<br>…aur ${list.length - 12} customers.` : ''}<br><span style="color:#64748b">High risk customers ko pehle reminder bhejein.</span>`;
}

function dayCloseAnswer() {
  const s = dayCloseSummary();
  const existing = (db.closings || []).find((c) => c.date === s.date);
  const opening = Number(existing?.openingCash) || 0;
  const expected = opening + s.netCash;
  return `<b>💰 Aaj ka cash hisab (${s.date})</b>${stat('Cash sales', money(s.cashSales))}${stat('Card sales', money(s.cardSales))}${stat('Online sales', money(s.onlineSales))}${stat('Udhaar sales', money(s.udhaarSales))}${stat('Customer cash in', money(s.cashIn))}${stat('Cash refunds', '− ' + money(s.cashRefunds))}${stat('Cash expenses', '− ' + money(s.cashExpenses))}${stat('Supplier cash out', '− ' + money(s.cashOut))}${stat('Expected drawer cash', money(expected))}${existing ? stat('Saved counted', money(existing.countedCash)) + stat('Variance', money(existing.variance)) : ''}<br><span style="color:#64748b">Day Close page se counted cash reconcile aur closing save karein.</span>`;
}

function forecastAnswer() {
  const f = forecastNext7();
  if (!f.averageDaily) return `📊 Forecast ke liye abhi data kam hai. Kuch sales record karein, phir next 7 days ka estimate milega.`;
  return `<b>🔮 Next 7 days forecast</b>${stat('Average daily', money(f.averageDaily))}${stat('Predicted daily', money(f.predictedDaily))}${stat('Next 7 days', money(f.predictedWeek))}${stat('Trend', `${f.trend > 0 ? '+' : ''}${Math.round(f.trend * 100)}%`)}${stat('Confidence', `${f.confidence}%`)}<br><span style="color:#64748b">Simple forecast — pichhle 28 din ki sales speed aur recent trend par based.</span>`;
}

function leakAnswer() {
  const result = profitLeaks();
  if (!result.leaks.length) return `✅ <b>Koi leak nahi mila.</b> Aap ka pricing, stock aur expenses sab theek hain.`;
  const moneyLeaks = result.leaks.filter((l) => l.kind !== 'pricing-upside');
  const list = result.leaks.slice(0, 8).map((leak) =>
    `<li><b>${esc(leak.title)}</b> — ${leak.kind === 'pricing-upside' ? '+' : ''}${money(leak.amount)}<br><span style="color:#64748b">${esc(leak.action)}</span></li>`
  ).join('');
  return `<b>💧 Profit leak report (${result.leaks.length} leaks):</b><ul>${list}</ul>${stat('Money on the table', money(result.recoverable))}${stat('Pricing upside', money(result.upside))}${stat('30-day revenue', money(result.revenue))}<br><span style="color:#64748b">Poori report Profit Leak Finder page par hai.</span>`;
}

function segmentAnswer() {
  const rows = customerSegments();
  if (!rows.length) return `Abhi customer segments nahi ban sakte — thori sales history chahiye.`;
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.segment)) groups.set(row.segment, []);
    groups.get(row.segment).push(row);
  }
  const html = [...groups.entries()].map(([name, list]) =>
    `<li><b>${esc(name)}</b> (${list.length}) — ${list.slice(0, 6).map((r) => esc(r.customer.name)).join(', ')}</li>`
  ).join('');
  return `<b>👥 Customer segments:</b><ul>${html}</ul>${stat('Champions', (groups.get('Champion') || []).length)}${stat('At risk / dormant', (groups.get('At risk') || []).length + (groups.get('Dormant') || []).length)}<br><span style="color:#64748b">Customers page par segment badges aur ledger hain.</span>`;
}

function deadStockAnswer() {
  const plan = restockPlan({ days: 30 });
  const dead = plan.rows.filter((row) => row.status === 'dead');
  if (!dead.length) return `✅ <b>Koi dead stock nahi.</b> Har product ki pichhle 30 din mein sale hui hai.`;
  return `<b>🧊 Dead stock (30 din se no sale):</b><ul>${dead.slice(0, 12).map((row) => `<li><b>${esc(row.product.name)}</b> — ${row.stock} ${esc(row.product.unit || 'pcs')} stock · ${money(row.deadValue)} capital</li>`).join('')}</ul>${stat('Total dead stock value', money(plan.totals.deadValue))}<br><span style="color:#64748b">Discount, bundle ya supplier return se capital free karein.</span>`;
}
function productDetailAnswer(p) {
  const margin = Number(p.price) - (Number(p.cost)||0);
  const marginPct = Number(p.price) ? Math.round((margin/Number(p.price))*100) : 0;
  return `<b>📦 ${esc(p.name)}</b>${stat('Stock', p.stock??0)}${stat('Sale price', money(p.price))}${stat('Cost', money(p.cost))}${stat('Profit per unit', money(margin))}${stat('Margin', marginPct+'%')}${stat('Category', esc(p.category||'—'))}${stat('Low-stock alert', p.lowStock??5)}`;
}

/* ---------- main intent engine ---------- */
function answer(raw) {
  const q = String(raw||'').toLowerCase().replace(/[?!.,;:]/g,' ').replace(/\s+/g,' ').trim();
  if (!q) return 'Kuch likhein — jaise "aaj ki sale kitni hai?"';

  /* greeting */
  if (/^(salam|assalam|asalam|aoa|hi|hello|hey|hy)\b/.test(q) || /\b(kya haal|haal hai|how are you|kaisa ho|kya chal raha)\b/.test(q)) {
    const today = salesIn('today');
    return `<b>Assalam-o-Alaikum! 👋</b><br>Main mhzaly AI hoon — aap ke shop data se jawab deta hoon.<br><br>${stat('Aaj ki sale', money(sum(today,'total')))}${stat('Aaj ke invoices', today.length)}${stat('Low stock items', lowStockProducts().length)}<br>Aap kuch bhi shop ke baare mein poochh sakte hain: <i>"aaj ka summary"</i>, <i>"low stock"</i>, <i>"top product"</i>, <i>"udhaar kitna hai"</i> ya <i>"stock ki value"</i>.`;
  }

  /* help */
  if (/\b(help|madad|kya kar sakte|kya kar sakti|commands|sikhao|kya poochh sakta)\b/.test(q)) {
    return `<b>Main ye sab bata sakta hoon:</b><ul><li>Business health score aur action plan</li><li>Profit leak finder — paisa kahan ja raha hai</li><li>Smart restock, dead stock aur forecast</li><li>Day close / cash reconciliation</li><li>Customer credit risk aur RFM segments</li><li>Aaj / kal / hafte / mahine ki sale aur profit</li><li>Sab se zyada / kam bikne wale products</li><li>Top customers aur unka udhaar</li><li>Kisi product ka stock, price, margin</li><li>Inventory ki kul value</li><li>Customer ya supplier ka balance</li><li>Kharcha category ke mutabiq</li><li>Tax aur payment method ka hisab</li><li>Aaj ka poora summary</li></ul>Bas apna sawal likhein ya 🎤 mic se bolain.`;
  }

  /* low stock / out of stock (before health so "restock kya karun" wins) */
  if (/\b(low stock|stock kam|kam stock|khatam|out of stock|reorder|stock alert|restock)\b/.test(q)) {
    if (/restock|reorder|order|maal mangwa|kya order/.test(q)) return restockAnswer();
    const low = lowStockProducts().sort((a,b)=>(a.stock??0)-(b.stock??0));
    if (!low.length) return `✅ <b>Sab stock theek hai!</b> Koi product low stock mein nahi.`;
    return `<b>⚠️ Low stock / khatam hone wale products (${low.length}):</b><ul>${low.slice(0,12).map((p)=>`<li><b>${esc(p.name)}</b> — ${p.stock??0} left <span style="color:#64748b">(alert ${p.lowStock??5})</span></li>`).join('')}</ul>${low.length>12?'<br>…aur baaki Products page par.':''}`;
  }

  /* business health / pulse score */
  if (/\b(business health|health score|pulse|business score|action plan|kya karun|improve|halat|kaisa chal raha)\b/.test(q)) {
    return healthAnswer();
  }

  /* customer credit risk */
  if (/\b(credit risk|risk|risky|udhaar risk|default|recovery|reminder)\b/.test(q)) {
    return creditRiskAnswer();
  }

  /* day close / cash reconciliation */
  if (/\b(day close|close day|cash close|cash hisab|cash account|galla|drawer|reconciliation|reconcile|over short|short cash|nakad)\b/.test(q)) {
    return dayCloseAnswer();
  }

  /* forecast */
  if (/\b(forecast|prediction|predict|next week|agle hafte|future sale|expected sale)\b/.test(q)) {
    return forecastAnswer();
  }

  /* dead stock */
  if (/\b(dead stock|slow moving|no sale|nahi bik|non moving|phansa|capital)\b/.test(q)) {
    return deadStockAnswer();
  }

  /* profit leaks */
  if (/\b(leak|leaks|profit leak|paisa kahan|paise kahan|nuqsaan|kahan jaa raha|money leak|zyada kharcha|ganda)\b/.test(q)) {
    return leakAnswer();
  }

  /* customer segments */
  if (/\b(segment|segments|champion|loyal|dormant|customer group|rfm|best customers)\b/.test(q)) {
    return segmentAnswer();
  }

  /* best / worst day */
  if (/\b(best day|top day|best sale day|sab se zyada sale kis din|wah day|bad day|worst day)\b/.test(q)) {
    return bestDayAnswer();
  }

  /* top customers */
  if (/\b(top customer|best customer|sab se zyada kharid|zyada khareed|top grahak|best buyer)\b/.test(q)) {
    const kind = detectRange(q);
    const top = topCustomers(salesIn(kind));
    if (!top.length) return `Is duration (${RANGE_LABEL[kind]}) mein koi customer sale nahi.`;
    const max = top[0].total || 1;
    return `<b>👑 Top customers (${RANGE_LABEL[kind]}):</b>${top.map((c)=>hbar(c.name, c.total, max, `${money(c.total)} · ${c.count} bill`)).join('')}`;
  }

  /* top products */
  if (/\b(top|best|sab se zyada|sabse zyada|zyada bika|best seller|bikta|best selling)\b/.test(q)) {
    const kind = detectRange(q);
    const top = topProducts(salesIn(kind));
    if (!top.length) return `Is duration (${RANGE_LABEL[kind]}) mein koi sale nahi hui.`;
    const max = top[0].qty || 1;
    return `<b>🏆 Sab se zyada bikne wale products (${RANGE_LABEL[kind]}):</b>${top.map((t)=>hbar(t.name, t.qty, max, `${t.qty} qty · ${money(t.revenue)}`)).join('')}<div class="ai-chart-title">Pichhle 7 din</div>${barChart(dailySeries(7))}`;
  }

  /* bottom / least selling */
  if (/\b(kam|sab se kam|least|bottom|sabse kaam|na hua)\b/.test(q) && /\b(bika|product|sale|bikta)\b/.test(q)) {
    const kind = detectRange(q);
    const bot = bottomProducts(salesIn(kind));
    if (!bot.length) return `Is duration (${RANGE_LABEL[kind]}) mein koi sale nahi hui.`;
    const max = bot[0].qty || 1;
    return `<b>📉 Sab se kam bikne wale products (${RANGE_LABEL[kind]}):</b>${bot.map((t)=>hbar(t.name, t.qty, max, `${t.qty} qty · ${money(t.revenue)}`)).join('')}`;
  }

  /* stock value / inventory */
  if (/\b(stock value|inventory value|maal ki value|kitna maal|stock ki value|inventory|total stock)\b/.test(q)) {
    return stockValueAnswer();
  }

  /* compare */
  if (/\b(vs|versus|compare|muqabla)\b/.test(q) || (/\bkal\b/.test(q) && /\baaj\b/.test(q))) {
    return compareAnswer();
  }

  /* specific customer balance */
  const cust = findByName(db.customers, q);
  if (cust && /\b(udhaar|udhar|balance|baqaya|khata|lena|kitna)\b/.test(q)) {
    const bal = Number(cust.balance)||0;
    return `<b>👤 ${esc(cust.name)}</b>${stat('Udhaar / balance', money(bal))}${cust.phone?stat('Phone', esc(cust.phone)):''}${stat('Status', bal>0?'Baqi hai':'Clear')}`;
  }

  /* specific supplier payable */
  const sup = findByName(db.suppliers, q);
  if (sup && /\b(balance|payable|dena|daina|baqaya|kitna)\b/.test(q)) {
    const bal = Number(sup.balance)||0;
    return `<b>🚚 ${esc(sup.name)}</b>${stat('Payable / balance', money(bal))}${sup.phone?stat('Phone', esc(sup.phone)):''}${stat('Status', bal>0?'Dena baqi hai':'Clear')}`;
  }

  /* total udhaar */
  if (/\b(udhaar|udhar|receivable|baqaya|lena|khata)\b/.test(q)) {
    const total = totalReceivable();
    const debtors = db.customers.filter((c)=>(Number(c.balance)||0)>0).sort((a,b)=>(Number(b.balance)||0)-(Number(a.balance)||0));
    if (!total) return `✅ <b>Koi udhaar baqi nahi.</b> Sab customers ka hisab clear hai.`;
    return `<b>💳 Total udhaar (receivable): ${money(total)}</b>${debtors.length?`<ul>${debtors.slice(0,10).map((c)=>`<li><b>${esc(c.name)}</b> — ${money(c.balance)}${c.phone?` <span style="color:#64748b">(${esc(c.phone)})</span>`:''}</li>`).join('')}</ul>`:''}`;
  }

  /* total payable */
  if (/\b(supplier|payable|dena|daina)\b/.test(q)) {
    const payable = db.suppliers.reduce((a,s)=>a+Math.max(0,Number(s.balance)||0),0);
    const list = db.suppliers.filter((s)=>(Number(s.balance)||0)>0).sort((a,b)=>(Number(b.balance)||0)-(Number(a.balance)||0));
    if (!payable) return `✅ <b>Suppliers ko koi payment baqi nahi.</b>`;
    return `<b>📤 Suppliers ko dena (payable): ${money(payable)}</b><ul>${list.slice(0,10).map((s)=>`<li><b>${esc(s.name)}</b> — ${money(s.balance)}</li>`).join('')}</ul>`;
  }

  /* expenses */
  if (/\b(kharch|kharcha|expense|cost)\b/.test(q)) {
    const kind = detectRange(q);
    const list = expensesIn(kind);
    const total = sum(list,'amount');
    if (!list.length) return `Is duration (${RANGE_LABEL[kind]}) mein koi kharcha record nahi.`;
    const byCat = {};
    for (const e of list) { const k = e.category||'Other'; byCat[k] = (byCat[k]||0) + (Number(e.amount)||0); }
    return `<b>🧾 Kharcha (${RANGE_LABEL[kind]}): ${money(total)}</b><ul>${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<li>${esc(k)} — ${money(v)}</li>`).join('')}</ul>`;
  }

  /* profit */
  if (/\b(profit|munafa|nafa|kamai|earning)\b/.test(q)) {
    const kind = detectRange(q);
    const sales = salesIn(kind);
    const revenue = sum(sales,'total');
    const gross = profitOf(sales);
    const exp = sum(expensesIn(kind),'amount');
    return `<b>📈 ${RANGE_LABEL[kind]} ka hisab:</b>${stat('Sale (revenue)', money(revenue))}${stat('Gross profit', money(gross))}${stat('Kharcha', money(exp))}${stat('Net profit', money(gross-exp))}${stat('Invoices', sales.length)}`;
  }

  /* tax */
  if (/\b(tax|gst)\b/.test(q)) {
    const rate = Number(db.settings.taxRate) || 0;
    const kind = detectRange(q);
    const sales = salesIn(kind);
    const tax = sales.reduce((a, s) => a + (Number(s.tax) || 0), 0);
    const total = sales.reduce((a, s) => a + (Number(s.total) || 0), 0);
    return `<b>🧮 Tax setting:</b> ${rate}% · ${esc(db.settings.taxSystem || 'GST')} · ${esc(db.settings.taxCountry || 'PK')}<br><b>${RANGE_LABEL[kind]} tax collected:</b> ${money(tax)}<br><b>Taxable sales:</b> ${money(Math.max(0, total - tax))}<br><b>Tax invoices:</b> ${sales.filter((s) => Number(s.tax) > 0).length}<br><span style="color:#64748b">Pichhle 30 din tax: ${money(taxSummary(30).tax)} · Reports → Tax Summary mein full detail.</span>`;
  }

  /* specific payment collection */
  if (/\b(cash|naqad|card|online|bank)\b/.test(q) && /\b(sale|aaya|collection|total|kitna)\b/.test(q)) {
    const kind = detectRange(q);
    const sales = salesIn(kind);
    const method = /card/.test(q) ? 'Card' : /online|bank/.test(q) ? 'Online' : 'Cash';
    const list = sales.filter((s)=>(s.paymentMethod||'Cash') === method);
    return `<b>💵 ${method} collection (${RANGE_LABEL[kind]}): ${money(sum(list,'total'))}</b>${stat('Invoices', list.length)}${stat('Average bill', money(list.length ? sum(list,'total')/list.length : 0))}`;
  }

  /* sales / revenue */
  if (/\b(sale|sales|bikri|revenue|turnover|bika|bill|invoice|order)\b/.test(q)) {
    const kind = detectRange(q);
    const sales = salesIn(kind);
    const revenue = sum(sales,'total');
    const avg = sales.length ? revenue/sales.length : 0;
    const pay = paymentBreakdown(sales);
    return `<b>🧾 ${RANGE_LABEL[kind]} ki sale:</b>${stat('Total sale', money(revenue))}${stat('Invoices', sales.length)}${stat('Average bill', money(avg))}${pay.length?`<br><b>Payment method:</b><ul>${pay.map(([m,v])=>`<li>${esc(m)} — ${money(v)}</li>`).join('')}</ul>`:''}<div class="ai-chart-title">Pichhle 7 din</div>${barChart(dailySeries(7))}`;
  }

  /* product-specific */
  const p = findProduct(q);
  if (p && /\b(stock|price|rate|cost|kitna|kitni|hai|ka|ki|margin|profit)\b/.test(q)) {
    return productDetailAnswer(p);
  }

  /* summary */
  if (/\b(summary|hisab|report|overview|halat|kaisa chal|aaj ka|sab kuch)\b/.test(q)) {
    return summaryAnswer();
  }

  /* counts */
  if (/\b(kitne|kitni|count)\b/.test(q)) {
    if (/product|item|maal/.test(q)) return `<b>📦 Total products:</b> ${db.products.length}<br><b>Low stock:</b> ${lowStockProducts().length}`;
    if (/customer|grahak/.test(q)) return `<b>👥 Customers:</b> ${db.customers.length}<br><b>Udhaar:</b> ${money(totalReceivable())}`;
    if (/supplier/.test(q)) return `<b>🚚 Suppliers:</b> ${db.suppliers.length}`;
    if (/invoice|bill/.test(q)) return `<b>🧾 Total invoices:</b> ${db.sales.length}`;
  }

  /* product fallback */
  if (p) return productDetailAnswer(p);

  /* fallback */
  return `Main ye sawal samajh nahi saka. 🤔<br>Ye try karein:<ul><li>"Aaj ki sale kitni hai?"</li><li>"Kal se compare karo"</li><li>"Is mahine ka profit?"</li><li>"Low stock products?"</li><li>"Top customer?"</li><li>"Stock ki value?"</li><li>"Restock kya karun?"</li><li>"Aaj ka summary"</li></ul>`;
}

/* ---------- render ---------- */
export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>AI Assistant</h2>
        <p>Apne shop ke baare mein sawal poochhein — jawab aap ke data se, bina internet.</p>
      </div>
      <div class="head-actions">
        <span class="pill brand">${icon('sparkle')} Offline · Free</span>
      </div>
    </div>

    <div class="ai-shell">
      <div class="card ai-card">
        <div class="ai-head">
          <div class="ai-avatar">${icon('sparkle')}</div>
          <div class="grow">
            <h3>mhzaly AI</h3>
            <p>Aap ke shop data se smart jawab · koi API key nahi</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="aiClear" type="button">Clear</button>
        </div>
        <div class="ai-log" id="aiLog"></div>
        <div class="ai-chips" id="aiChips">
          ${EXAMPLES.map((e)=>`<button class="ai-chip" type="button" data-q="${esc(e)}">${esc(e)}</button>`).join('')}
        </div>
        <form class="ai-input" id="aiForm">
          <input class="input" id="aiText" placeholder="Sawal likhein… ya 🎤 dabayein" autocomplete="off" />
          <button class="btn btn-ghost ai-mic" id="aiMic" type="button" title="Voice se poochhein" aria-label="Voice input">${icon('mic')}</button>
          <button class="btn btn-primary ai-send" type="submit">${icon('check')} <span class="ai-send-text">Bhejein</span></button>
        </form>
      </div>
      <p class="ai-note">Ye assistant aap ke browser mein hi chalta hai — data kahin nahi jata. Jawab aap ke products, sales, customers aur expenses se bante hain.</p>
    </div>`;

  const log = root.querySelector('#aiLog');
  const form = root.querySelector('#aiForm');
  const input = root.querySelector('#aiText');

  function add(html, who) {
    const el = document.createElement('div');
    el.className = `ai-msg ${who}`;
    el.innerHTML = `<div class="ai-bubble">${html}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function ask(text) {
    const q = String(text||'').trim();
    if (!q) return;
    add(esc(q), 'user');
    input.value = '';
    const typing = document.createElement('div');
    typing.className = 'ai-msg bot';
    typing.innerHTML = `<div class="ai-bubble ai-typing"><span></span><span></span><span></span></div>`;
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;
    setTimeout(() => {
      typing.remove();
      add(answer(q), 'bot');
    }, 320);
  }

  add(
    `<b>Assalam-o-Alaikum! 👋</b><br>Main mhzaly AI hoon. Apne shop ke baare mein kuch bhi poochhein — sale, profit, stock, udhaar, top products. 🎤 Mic se bol kar bhi poochh sakte hain.`,
    'bot'
  );

  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  root.querySelector('#aiChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-q]');
    if (chip) ask(chip.dataset.q);
  });
  root.querySelector('#aiClear').addEventListener('click', () => {
    log.innerHTML = '';
    add('<b>Chat clear ho gayi.</b> Naya sawal poochhein.', 'bot');
  });

  // Voice input (free, browser-native)
  const micBtn = root.querySelector('#aiMic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = 'Voice is browser mein support nahi (Chrome try karein)';
  } else {
    let rec = null; let listening = false;
    micBtn.addEventListener('click', () => {
      if (listening && rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'ur-PK';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      listening = true;
      micBtn.classList.add('listening');
      rec.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript || '';
        if (text) { input.value = text; ask(text); }
      };
      rec.onerror = () => toast('Voice sun nahi saka — dobara try karein', 'error');
      rec.onend = () => { listening = false; micBtn.classList.remove('listening'); };
      try { rec.start(); } catch { listening = false; micBtn.classList.remove('listening'); }
    });
  }

  setTimeout(() => input.focus(), 80);
}
