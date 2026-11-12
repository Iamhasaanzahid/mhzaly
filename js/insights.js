/* ============================================================
   mhzaly — business intelligence engine (offline, free)
   Shared calculations for Pulse score, smart restock, credit
   risk, day close, tax summaries and simple forecasting.
   ============================================================ */

import { db, lowStockProducts, totalReceivable } from './db.js';

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function norm(value) {
  return String(value || '').trim().toLowerCase();
}

export function dayStart(value = new Date()) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function rangeStart(daysAgo) {
  const d = dayStart();
  d.setDate(d.getDate() - Math.max(0, Number(daysAgo) || 0));
  return d;
}

function inWindow(value, start, end) {
  const t = new Date(value || 0).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/** End of the current business day (so a bill made later tonight still counts today). */
export function endOfToday() {
  const d = dayStart();
  d.setDate(d.getDate() + 1);
  return d;
}

export function salesInDays(days = 30) {
  const start = rangeStart(Math.max(1, Number(days) || 1) - 1);
  const end = endOfToday();
  return db.sales.filter((s) => inWindow(s.createdAt, start, end));
}

export function salesBetweenDays(fromDaysAgo, toDaysAgo) {
  const start = rangeStart(fromDaysAgo);
  const end = rangeStart(toDaysAgo);
  return db.sales.filter((s) => inWindow(s.createdAt, start, end));
}

export function expensesInDays(days = 30) {
  const start = rangeStart(Math.max(1, Number(days) || 1) - 1);
  const end = endOfToday();
  return db.expenses.filter((e) => inWindow(e.createdAt, start, end));
}

export function returnsInDays(days = 30) {
  const start = rangeStart(Math.max(1, Number(days) || 1) - 1);
  const end = endOfToday();
  return (db.returns || []).filter((r) => inWindow(r.createdAt, start, end));
}

export function sumBy(list, key) {
  return list.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

export function saleProfit(sale) {
  let profit = 0;
  if (Array.isArray(sale.items) && sale.items.length) {
    for (const it of sale.items) {
      const product = db.products.find((p) => p.id === it.id || p.id === it.productId);
      const cost = product ? Number(product.cost) || 0 : 0;
      const qty = Number(it.qty) || 1;
      profit += ((Number(it.price) || 0) - cost) * qty;
    }
  } else if (sale.productId) {
    const product = db.products.find((p) => p.id === sale.productId);
    const cost = product ? Number(product.cost) || 0 : 0;
    profit += (Number(sale.total) || 0) - cost * (Number(sale.qty) || 1);
  }
  return profit;
}

export function refundTotal(row) {
  return (row.items || []).reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0),
    0
  );
}

export function paymentMix(sales) {
  const map = new Map();
  for (const sale of sales) {
    const method = sale.paymentMethod || 'Cash';
    map.set(method, (map.get(method) || 0) + (Number(sale.total) || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function dailySeries(days = 7) {
  const out = [];
  for (let i = Math.max(1, days) - 1; i >= 0; i -= 1) {
    const start = rangeStart(i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const total = db.sales
      .filter((s) => inWindow(s.createdAt, start, end))
      .reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    out.push({ date: start, total });
  }
  return out;
}

export function topProducts(sales, limit = 5) {
  const map = new Map();
  for (const sale of sales) {
    for (const it of sale.items || []) {
      const key = it.id || it.name || 'Item';
      const row = map.get(key) || { name: it.name || 'Item', qty: 0, revenue: 0 };
      const qty = Number(it.qty) || 1;
      row.qty += qty;
      row.revenue += qty * (Number(it.price) || 0);
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}

export function topCustomers(sales, limit = 5) {
  const map = new Map();
  for (const sale of sales) {
    const name = String(sale.customerName || 'Walk-in').trim() || 'Walk-in';
    if (/^walk[- ]?in$/i.test(name)) continue;
    const row = map.get(name) || { name, total: 0, count: 0 };
    row.total += Number(sale.total) || 0;
    row.count += 1;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function moneyText(value) {
  return `${db.settings.currency || 'Rs'} ${Number(value || 0).toLocaleString()}`;
}

/* ---------- Pulse: business health score ---------- */

export function businessHealth() {
  const recent = salesInDays(30);
  const revenue = sumBy(recent, 'total');
  const profit = recent.reduce((sum, sale) => sum + saleProfit(sale), 0);
  const expenses = sumBy(expensesInDays(30), 'amount');
  const low = lowStockProducts();
  const receivable = totalReceivable();

  const last7 = salesInDays(7);
  const prev7 = salesBetweenDays(7, 14);
  const last7Total = sumBy(last7, 'total');
  const prev7Total = sumBy(prev7, 'total');

  const margin = revenue > 0 ? profit / revenue : 0;
  const expenseRatio = revenue > 0 ? expenses / revenue : 0;
  const lowRatio = db.products.length ? low.length / db.products.length : 0;

  let salesScore = 30;
  if (prev7Total > 0) {
    const growth = (last7Total - prev7Total) / prev7Total;
    salesScore = clamp(50 + growth * 100);
  } else if (last7Total > 0) {
    salesScore = 80;
  }

  const profitScore = revenue > 0 ? clamp((margin / 0.35) * 100) : 0;
  const stockScore = db.products.length ? clamp(100 - lowRatio * 100) : 50;
  const creditScore = revenue > 0 ? clamp(100 - (receivable / revenue) * 100) : receivable ? 25 : 70;
  const expenseScore = revenue > 0 ? clamp(100 - expenseRatio * 120) : expenses ? 20 : 70;

  let score = Math.round(
    salesScore * 0.2 +
    profitScore * 0.25 +
    stockScore * 0.2 +
    creditScore * 0.2 +
    expenseScore * 0.15
  );

  if (!recent.length && !db.products.length) score = 0;
  else if (!recent.length && db.products.length) score = Math.min(score, 30);

  let grade = 'Needs attention';
  let tone = 'danger';
  if (score >= 80) { grade = 'Excellent'; tone = 'ok'; }
  else if (score >= 65) { grade = 'Good'; tone = 'ok'; }
  else if (score >= 50) { grade = 'Fair'; tone = 'warn'; }

  const actions = [];
  if (low.length) {
    actions.push({
      label: `${low.length} product${low.length > 1 ? 's' : ''} restock karein`,
      detail: `Sab se kam ${low[0].name} (${low[0].stock ?? 0} left)`,
      go: 'restock',
      tone: 'warn',
    });
  }
  if (receivable > 0) {
    actions.push({
      label: `${moneyText(receivable)} udhaar recover karein`,
      detail: 'Customers page se reminder / payment receive karein',
      go: 'customers',
      tone: 'warn',
    });
  }
  if (revenue > 0 && margin < 0.15) {
    actions.push({
      label: 'Profit margin kam hai',
      detail: `Margin ${Math.round(margin * 100)}% — pricing aur cost review karein`,
      go: 'reports',
      tone: 'danger',
    });
  }
  if (revenue > 0 && expenseRatio > 0.35) {
    actions.push({
      label: 'Expenses zyada hain',
      detail: `Revenue ka ${Math.round(expenseRatio * 100)}% kharcha — categories check karein`,
      go: 'expenses',
      tone: 'warn',
    });
  }
  if (!last7.length) {
    actions.push({
      label: 'Is hafte koi sale nahi',
      detail: 'POS se pehla bill banayein',
      go: 'pos',
      tone: 'warn',
    });
  }
  if (!actions.length) {
    actions.push({
      label: 'Sab theek chal raha hai',
      detail: 'Next sale aur customer follow-up par focus karein',
      go: 'pos',
      tone: 'ok',
    });
  }

  return {
    score,
    grade,
    tone,
    salesScore: Math.round(salesScore),
    profitScore: Math.round(profitScore),
    stockScore: Math.round(stockScore),
    creditScore: Math.round(creditScore),
    expenseScore: Math.round(expenseScore),
    revenue,
    profit,
    expenses,
    margin,
    expenseRatio,
    receivable,
    lowCount: low.length,
    low,
    last7Total,
    prev7Total,
    growth: prev7Total > 0 ? (last7Total - prev7Total) / prev7Total : null,
    actions,
  };
}

/* ---------- Smart restock: demand forecast ---------- */

export function restockPlan({ days = 30, leadDays = 7, coverDays = 14 } = {}) {
  const windowDays = Math.max(1, Number(days) || 30);
  const lead = Math.max(0, Number(leadDays) || 0);
  const coverTarget = Math.max(1, Number(coverDays) || 14);
  const start = rangeStart(windowDays - 1);
  const byId = new Map();
  const byName = new Map();

  for (const sale of db.sales) {
    if (new Date(sale.createdAt || 0) < start) continue;
    if (Array.isArray(sale.items) && sale.items.length) {
      for (const it of sale.items) {
        const qty = Number(it.qty) || 1;
        if (it.id) byId.set(it.id, (byId.get(it.id) || 0) + qty);
        if (it.productId) byId.set(it.productId, (byId.get(it.productId) || 0) + qty);
        if (it.name) byName.set(norm(it.name), (byName.get(norm(it.name)) || 0) + qty);
      }
    } else if (sale.productId) {
      byId.set(sale.productId, (byId.get(sale.productId) || 0) + (Number(sale.qty) || 1));
    }
  }

  const rows = db.products.map((product) => {
    const sold = Math.max(
      byId.get(product.id) || 0,
      byName.get(norm(product.name)) || 0
    );
    const stock = Number(product.stock) || 0;
    const lowStock = Number(product.lowStock) || 5;
    const velocity = sold / windowDays;
    const cover = velocity > 0 ? stock / velocity : null;
    const target = Math.ceil(velocity * (lead + coverTarget));
    let suggested = Math.max(0, target - stock);
    if (stock <= lowStock) suggested = Math.max(suggested, lowStock - stock);
    if (suggested <= 0 && stock <= 0) suggested = Math.max(1, lowStock);

    let status = 'ok';
    if (stock <= 0) status = 'out';
    else if (stock <= lowStock) status = 'low';
    else if (cover !== null && cover <= lead) status = 'urgent';
    else if (sold === 0) status = 'dead';

    return {
      product,
      sold,
      velocity,
      stock,
      lowStock,
      cover,
      suggested,
      cost: suggested * (Number(product.cost) || 0),
      status,
      deadValue: sold === 0 ? stock * (Number(product.cost) || 0) : 0,
    };
  });

  const rank = { out: 0, low: 1, urgent: 2, ok: 3, dead: 4 };
  rows.sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus) return byStatus;
    const coverA = a.cover == null ? 9999 : a.cover;
    const coverB = b.cover == null ? 9999 : b.cover;
    return coverA - coverB || b.suggested - a.suggested;
  });

  const reorder = rows.filter((row) => row.suggested > 0);
  const dead = rows.filter((row) => row.status === 'dead');
  return {
    days: windowDays,
    leadDays: lead,
    coverDays: coverTarget,
    rows,
    reorder,
    totals: {
      reorderCount: reorder.length,
      units: reorder.reduce((sum, row) => sum + row.suggested, 0),
      cost: reorder.reduce((sum, row) => sum + row.cost, 0),
      deadCount: dead.length,
      deadValue: dead.reduce((sum, row) => sum + row.deadValue, 0),
    },
  };
}

/* ---------- Customer credit risk ---------- */

function daysSince(value) {
  const t = new Date(value || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export function customerRisk(customer) {
  const balance = Number(customer?.balance) || 0;
  if (balance <= 0) {
    return { level: 'Clear', tone: 'ok', score: 0, balance, reason: 'Koi udhaar baqi nahi' };
  }

  const name = norm(customer?.name);
  const sales = db.sales.filter((s) => norm(s.customerName) === name);
  const payments = (db.payments || []).filter((p) => p.type === 'customer' && norm(p.party) === name);
  const lastSale = sales.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
  const lastPayment = payments.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
  const totalPurchases = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const ratio = totalPurchases > 0 ? balance / totalPurchases : 1;
  const sincePayment = lastPayment ? daysSince(lastPayment.createdAt) : null;
  const sinceSale = lastSale ? daysSince(lastSale.createdAt) : null;

  let score = Math.min(40, ratio * 40);
  score += sincePayment == null ? 25 : Math.min(30, sincePayment / 2);
  if (sinceSale != null && sinceSale > 60) score += 15;
  if (!sales.length) score += 15;
  score = Math.round(Math.min(100, score));

  let level = 'Low';
  let tone = 'ok';
  if (score >= 70) { level = 'High'; tone = 'danger'; }
  else if (score >= 40) { level = 'Medium'; tone = 'warn'; }

  let reason = 'Payment history normal hai';
  if (sincePayment == null) reason = 'Kabhi payment receive nahi hui';
  else if (sincePayment > 45) reason = `${sincePayment} din se payment nahi aayi`;
  else if (ratio > 0.7) reason = 'Balance total purchases ke muqable zyada hai';
  else if (sinceSale != null && sinceSale > 60) reason = `${sinceSale} din se koi purchase nahi`;

  return { level, tone, score, balance, sincePayment, sinceSale, reason };
}

/* ---------- Day close / cash reconciliation ---------- */

export function dayBounds(dateStr) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let day = now.getDate();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  }
  const start = new Date(year, month, day, 0, 0, 0, 0);
  const end = new Date(year, month, day + 1, 0, 0, 0, 0);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return { start, end, key };
}

function methodOf(row) {
  return row?.paymentMethod || row?.method || 'Cash';
}

export function dayCloseSummary(dateStr) {
  const { start, end, key } = dayBounds(dateStr);
  const inDay = (value) => {
    const t = new Date(value || 0).getTime();
    return t >= start.getTime() && t < end.getTime();
  };

  const sales = db.sales.filter((s) => inDay(s.createdAt));
  const returns = (db.returns || []).filter((r) => inDay(r.createdAt));
  const expenses = db.expenses.filter((e) => inDay(e.createdAt));
  const payments = (db.payments || []).filter((p) => inDay(p.createdAt));

  const cashSales = sales.filter((s) => methodOf(s) === 'Cash').reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const cardSales = sales.filter((s) => methodOf(s) === 'Card').reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const onlineSales = sales.filter((s) => methodOf(s) === 'Online').reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const udhaarSales = sales.filter((s) => methodOf(s) === 'Udhaar').reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const cashRefunds = returns.filter((r) => methodOf(r) === 'Cash').reduce((sum, r) => sum + refundTotal(r), 0);
  const cashExpenses = expenses.filter((e) => methodOf(e) === 'Cash').reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const cashIn = payments
    .filter((p) => p.type === 'customer' && methodOf(p) === 'Cash')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const cashOut = payments
    .filter((p) => p.type === 'supplier' && methodOf(p) === 'Cash')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const totalSales = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const netCash = cashSales + cashIn - cashRefunds - cashExpenses - cashOut;

  return {
    date: key,
    start,
    end,
    sales,
    returns,
    expenses,
    payments,
    invoices: sales.length,
    totalSales,
    cashSales,
    cardSales,
    onlineSales,
    udhaarSales,
    cashRefunds,
    cashExpenses,
    cashIn,
    cashOut,
    netCash,
  };
}

export function previousClosing(dateStr) {
  const { key } = dayBounds(dateStr);
  return (db.closings || [])
    .filter((c) => c.date < key)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

/* ---------- Profit leak finder ---------- */

/**
 * Scans the whole shop for money that is leaking out: loss-making prices,
 * thin margins, dead stock, over-stock, excessive discounts and heavy
 * expense categories. Every leak carries an estimated recoverable amount.
 */
export function profitLeaks() {
  const leaks = [];
  const windowDays = 30;
  const sales = salesInDays(windowDays);
  const revenue = sumBy(sales, 'total');
  const expenses = sumBy(expensesInDays(windowDays), 'amount');
  const totalCost = sales.reduce((sum, sale) => {
    let c = 0;
    for (const it of sale.items || []) {
      const product = db.products.find((p) => p.id === it.id || p.id === it.productId);
      c += (product ? Number(product.cost) || 0 : 0) * (Number(it.qty) || 1);
    }
    return sum + c;
  }, 0);

  // 1. products sold below cost
  for (const product of db.products) {
    const price = Number(product.price) || 0;
    const cost = Number(product.cost) || 0;
    if (price > 0 && cost > 0 && price < cost) {
      const stock = Number(product.stock) || 0;
      leaks.push({
        kind: 'loss-price',
        tone: 'danger',
        title: `${product.name} — cost se neeche bech rahe hain`,
        detail: `Cost ${moneyText(cost)} · Price ${moneyText(price)} (${Math.round(((price - cost) / cost) * 100)}% loss)`,
        amount: Math.round((cost - price) * stock * 100) / 100,
        action: 'Price foran theek karein — ya stock discount par nikaalein',
        go: 'products',
      });
    }
  }

  // 2. thin margin products that actually sell
  const soldMap = new Map();
  for (const sale of sales) {
    for (const it of sale.items || []) {
      const key = it.id || it.name;
      const row = soldMap.get(key) || { name: it.name, qty: 0, revenue: 0, price: 0 };
      row.qty += Number(it.qty) || 1;
      row.revenue += (Number(it.qty) || 1) * (Number(it.price) || 0);
      row.price = Number(it.price) || row.price;
      soldMap.set(key, row);
    }
  }
  for (const product of db.products) {
    const price = Number(product.price) || 0;
    const cost = Number(product.cost) || 0;
    if (!price || !cost || price <= cost) continue;
    const marginPct = (price - cost) / price;
    const sold = soldMap.get(product.id) || soldMap.get(norm(product.name));
    if (!sold || sold.qty < 3) continue;
    if (marginPct >= 0.12) continue;
    const gap = Math.round(((cost / 0.88) - price) * sold.qty * 100) / 100;
    leaks.push({
      kind: 'thin-margin',
      tone: 'warn',
      title: `${product.name} — margin sirf ${Math.round(marginPct * 100)}%`,
      detail: `${sold.qty} unit biki · cost ${moneyText(cost)} · price ${moneyText(price)}`,
      amount: Math.max(0, gap),
      action: 'Price 12% margin par le jaayein ya bundle banayein',
      go: 'products',
    });
  }

  // 3. dead stock (no sale in 60 days)
  const stock60 = rangeStart(59);
  const soldRecently = new Set();
  for (const sale of db.sales) {
    if (new Date(sale.createdAt || 0) < stock60) continue;
    for (const it of sale.items || []) soldRecently.add(it.id || it.name);
  }
  let deadValue = 0;
  const deadNames = [];
  for (const product of db.products) {
    const stock = Number(product.stock) || 0;
    if (stock <= 0) continue;
    if (soldRecently.has(product.id) || soldRecently.has(norm(product.name))) continue;
    const value = stock * (Number(product.cost) || 0);
    deadValue += value;
    deadNames.push(product.name);
  }
  if (deadValue > 0) {
    leaks.push({
      kind: 'dead-stock',
      tone: 'warn',
      title: `${deadNames.length} products 60 din se zero sale`,
      detail: `${deadNames.slice(0, 4).join(', ')}${deadNames.length > 4 ? '…' : ''} — ${moneyText(deadValue)} capital phansa hua hai`,
      amount: Math.round(deadValue * 100) / 100,
      action: 'Discount, bundle ya supplier se wapas return karein',
      go: 'restock',
    });
  }

  // 4. over-stock — far more stock than demand
  const soldQty = new Map();
  for (const sale of sales) {
    for (const it of sale.items || []) {
      const key = it.id || it.name;
      soldQty.set(key, (soldQty.get(key) || 0) + (Number(it.qty) || 1));
    }
  }
  let overValue = 0;
  const overNames = [];
  for (const product of db.products) {
    const stock = Number(product.stock) || 0;
    if (stock <= 0) continue;
    const sold = soldQty.get(product.id) || soldQty.get(norm(product.name)) || 0;
    const daily = sold / windowDays;
    if (daily <= 0) continue;
    const cover = stock / daily;
    if (cover <= 60) continue;
    const excess = Math.floor(stock - daily * 30);
    if (excess <= 0) continue;
    const value = excess * (Number(product.cost) || 0);
    overValue += value;
    overNames.push(product.name);
  }
  if (overValue > 0) {
    leaks.push({
      kind: 'over-stock',
      tone: 'warn',
      title: `${overNames.length} products mein 60 din se zyada stock`,
      detail: `${overNames.slice(0, 4).join(', ')}${overNames.length > 4 ? '…' : ''} — ${moneyText(overValue)} extra maal`,
      amount: Math.round(overValue * 100) / 100,
      action: 'Order plan kam karein aur paisa cash flow mein lein',
      go: 'restock',
    });
  }

  // 5. heavy discounting
  const discountTotal = sales.reduce((sum, s) => sum + (Number(s.discount) || 0), 0);
  if (discountTotal > 0 && revenue > 0 && discountTotal / revenue > 0.04) {
    leaks.push({
      kind: 'discount',
      tone: 'warn',
      title: 'Discount zyada diya ja raha hai',
      detail: `${moneyText(discountTotal)} discount diya gaya (${Math.round((discountTotal / revenue) * 100)}% of sales)`,
      amount: Math.round(discountTotal * 100) / 100,
      action: 'Discount limit set karein ya loyal-customer scheme use karein',
      go: 'reports',
    });
  }

  // 6. expense categories eating the profit
  if (revenue > 0) {
    const byCategory = new Map();
    for (const e of expensesInDays(windowDays)) {
      const key = e.category || 'Other';
      byCategory.set(key, (byCategory.get(key) || 0) + (Number(e.amount) || 0));
    }
    for (const [category, amount] of byCategory.entries()) {
      const share = amount / revenue;
      if (share < 0.06) continue;
      leaks.push({
        kind: 'expense',
        tone: share > 0.15 ? 'danger' : 'warn',
        title: `${category} kharcha revenue ka ${Math.round(share * 100)}%`,
        detail: `${moneyText(amount)} is mahine — gross profit ${moneyText(revenue - totalCost)}`,
        amount: Math.round(amount * Math.min(0.5, share - 0.05) * 100) / 100,
        action: 'Is category ka budget set karein',
        go: 'expenses',
      });
    }
  }

  // 7. pricing upside on fast movers (conservative: target 25% margin, max +15% price)
  let upside = 0;
  const upsideNames = [];
  for (const product of db.products) {
    const price = Number(product.price) || 0;
    const cost = Number(product.cost) || 0;
    if (!price || !cost || price <= cost) continue;
    const sold = soldQty.get(product.id) || soldQty.get(norm(product.name)) || 0;
    if (sold < 5) continue;
    const marginPct = (price - cost) / price;
    if (marginPct > 0.25) continue;
    const target = Math.round(cost / 0.75);
    const capped = Math.min(target, Math.round(price * 1.15));
    if (capped <= price) continue;
    upside += (capped - price) * sold;
    upsideNames.push(product.name);
  }
  if (upside > 0) {
    leaks.push({
      kind: 'pricing-upside',
      tone: 'ok',
      title: `${upsideNames.length} tez bikne wale products par price badha sakte hain`,
      detail: `${upsideNames.slice(0, 4).join(', ')}${upsideNames.length > 4 ? '…' : ''} — 25% margin ya max 15% price increase`,
      amount: Math.round(upside * 100) / 100,
      action: 'Test price badha kar margin dekhein',
      go: 'products',
    });
  }

  const recoverable = leaks
    .filter((leak) => leak.kind !== 'pricing-upside')
    .reduce((sum, leak) => sum + Math.max(0, leak.amount), 0);

  const order = { 'loss-price': 0, 'thin-margin': 1, 'expense': 2, discount: 3, 'dead-stock': 4, 'over-stock': 5, 'pricing-upside': 6 };
  leaks.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || b.amount - a.amount);

  return { leaks, recoverable, upside, windowDays, revenue, expenses };
}

/* ---------- RFM customer segmentation ---------- */

/**
 * Recency / Frequency / Monetary scoring for every customer, turned into
 * plain-language segments a shop owner can act on.
 */
export function customerSegments() {
  const now = Date.now();
  const rows = [];
  for (const customer of db.customers) {
    const name = norm(customer.name);
    const sales = db.sales.filter((s) => norm(s.customerName) === name);
    if (!sales.length) continue;
    const monetary = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const frequency = sales.length;
    const latest = Math.max(...sales.map((s) => new Date(s.createdAt || 0).getTime() || 0));
    const recencyDays = Math.floor((now - latest) / 86400000);
    const payments = (db.payments || []).filter((p) => p.type === 'customer' && norm(p.party) === name);
    const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const balance = Number(customer.balance) || 0;

    let r = recencyDays <= 7 ? 5 : recencyDays <= 14 ? 4 : recencyDays <= 30 ? 3 : recencyDays <= 60 ? 2 : 1;
    let f = frequency >= 10 ? 5 : frequency >= 6 ? 4 : frequency >= 3 ? 3 : frequency >= 2 ? 2 : 1;
    let m = monetary >= 50000 ? 5 : monetary >= 25000 ? 4 : monetary >= 10000 ? 3 : monetary >= 4000 ? 2 : 1;
    const score = Math.round((r + f + m) / 3 * 20);

    let segment = 'At risk';
    let tone = 'warn';
    if (r >= 4 && f >= 4 && m >= 3) { segment = 'Champion'; tone = 'ok'; }
    else if (f >= 3 && m >= 3 && r >= 3) { segment = 'Loyal'; tone = 'ok'; }
    else if (r <= 2 && (f >= 3 || m >= 3)) { segment = 'At risk'; tone = 'warn'; }
    else if (r <= 1 && f <= 2) { segment = 'Dormant'; tone = 'danger'; }
    else { segment = 'Potential'; tone = 'neutral'; }

    rows.push({
      customer,
      recencyDays,
      frequency,
      monetary,
      paid,
      balance,
      score,
      segment,
      tone,
      r, f, m,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/* ---------- Tax summary ---------- */

export function taxSummary(days = 30) {
  const sales = salesInDays(days);
  const tax = sales.reduce((sum, s) => sum + (Number(s.tax) || 0), 0);
  const total = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  return {
    sales,
    tax,
    total,
    taxable: Math.max(0, total - tax),
    invoices: sales.filter((s) => Number(s.tax) > 0).length,
  };
}

/* ---------- Simple 7-day forecast ---------- */

export function forecastNext7() {
  const series = dailySeries(28);
  const last7 = series.slice(-7).map((x) => x.total);
  const prev7 = series.slice(-14, -7).map((x) => x.total);
  const avg = last7.reduce((a, b) => a + b, 0) / 7;
  const prevAvg = prev7.reduce((a, b) => a + b, 0) / 7;
  const trend = prevAvg > 0 ? (avg - prevAvg) / prevAvg : 0;
  const predicted = Math.max(0, avg * (1 + trend * 0.4));
  const activeDays = series.filter((x) => x.total > 0).length;
  return {
    averageDaily: avg,
    predictedDaily: predicted,
    predictedWeek: predicted * 7,
    trend,
    confidence: Math.min(95, 35 + activeDays * 2),
  };
}
