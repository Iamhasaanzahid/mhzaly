/* ============================================================
   mhzaly — one-page Business Review
   A printable board pack that combines health score, leaks,
   restock, day close, tax and customers into one document.
   ============================================================ */

import { db } from './db.js';
import { esc } from './ui.js';
import {
  businessHealth, profitLeaks, restockPlan, customerSegments,
  taxSummary, forecastNext7, dayCloseSummary, topProducts, topCustomers,
} from './insights.js';

function money(n) {
  return `${db.settings.currency || 'Rs'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc2(v) {
  return esc(v);
}

export function buildReview() {
  const health = businessHealth();
  const leaks = profitLeaks();
  const plan = restockPlan({ days: 30 });
  const segments = customerSegments();
  const tax = taxSummary(30);
  const forecast = forecastNext7();
  const sales = db.sales.filter((s) => new Date(s.createdAt || 0) >= new Date(Date.now() - 30 * 86400000));
  const products = topProducts(sales, 8);
  const customers = topCustomers(sales, 8);
  const closings = (db.closings || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 7);
  const closingTotals = closings.reduce(
    (acc, c) => {
      acc.expected += Number(c.expectedCash) || 0;
      acc.counted += Number(c.countedCash) || 0;
      acc.variance += Number(c.variance) || 0;
      return acc;
    },
    { expected: 0, counted: 0, variance: 0 }
  );

  return {
    shop: db.settings.shopName || 'My Mart',
    owner: db.settings.ownerName || '',
    generated: new Date(),
    health,
    leaks: leaks.leaks.filter((l) => l.kind !== 'pricing-upside'),
    upside: leaks.upside,
    recoverable: leaks.recoverable,
    plan,
    segments,
    tax,
    forecast,
    products,
    customers,
    closings,
    closingTotals,
  };
}

export function reviewHtml(review) {
  const r = review;
  const moneyLeak = r.leaks.slice(0, 6);
  const reorder = r.plan.reorder.slice(0, 8);
  const topSeg = r.segments.slice(0, 8);

  const leakRows = moneyLeak.length
    ? moneyLeak.map((l) => `<tr><td><b>${esc2(l.title)}</b><div class="muted">${esc2(l.action)}</div></td><td class="r">${money(l.amount)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">Koi leak nahi mila.</td></tr>';

  const restockRows = reorder.length
    ? reorder.map((row) => `<tr><td>${esc2(row.product.name)}</td><td class="r">${row.stock}</td><td class="r">${row.cover == null ? '—' : Math.round(row.cover) + 'd'}</td><td class="r"><b>${row.suggested}</b></td><td class="r">${money(row.cost)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">Koi restock item nahi.</td></tr>';

  const segRows = topSeg.length
    ? topSeg.map((row) => `<tr><td>${esc2(row.customer.name)}</td><td>${esc2(row.segment)}</td><td class="r">${row.frequency} bills</td><td class="r">${money(row.monetary)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">Customer history nahi hai.</td></tr>';

  const prodRows = r.products.length
    ? r.products.map((p) => `<tr><td>${esc2(p.name)}</td><td class="r">${p.qty}</td><td class="r">${money(p.revenue)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">Koi sale nahi.</td></tr>';

  const custRows = r.customers.length
    ? r.customers.map((c) => `<tr><td>${esc2(c.name)}</td><td class="r">${c.count}</td><td class="r">${money(c.total)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">Koi customer sale nahi.</td></tr>';

  const closeRows = r.closings.length
    ? r.closings.map((c) => `<tr><td>${esc2(c.date)}</td><td class="r">${money(c.expectedCash)}</td><td class="r">${money(c.countedCash)}</td><td class="r ${Number(c.variance) < 0 ? 'bad' : 'good'}">${Number(c.variance) > 0 ? '+' : ''}${money(c.variance)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">Koi day close save nahi hua.</td></tr>';

  const actions = r.health.actions
    .map((a) => `<li><b>${esc2(a.label)}</b> — ${esc2(a.detail)}</li>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Business Review — ${esc2(r.shop)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: #0f172a; font-size: 11.5px; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -.03em; }
  h2 { font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .08em; color: #0f766e; }
  .muted { color: #64748b; font-size: 10px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f766e; padding-bottom: 10px; margin-bottom: 14px; }
  .score { text-align: right; }
  .score b { font-size: 30px; letter-spacing: -.04em; color: #0f766e; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 11px 13px; break-inside: avoid; }
  .full { grid-column: 1 / -1; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 3px; border-bottom: 1px solid #f1f5f9; text-align: left; font-size: 10.5px; }
  th { color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }
  td.r, th.r { text-align: right; }
  .bad { color: #b91c1c; font-weight: 700; }
  .good { color: #15803d; font-weight: 700; }
  ul { margin: 0; padding-left: 16px; }
  li { margin-bottom: 3px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 9px; padding: 8px 10px; }
  .kpi span { display: block; color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; font-weight: 700; }
  .kpi b { display: block; margin-top: 3px; font-size: 14px; }
  .foot { margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 8px; color: #64748b; font-size: 9.5px; display: flex; justify-content: space-between; }
  @media print { body { margin: 0; } }
</style></head><body>
  <div class="head">
    <div>
      <h1>${esc2(r.shop)}</h1>
      <div class="muted">Business Review · ${r.generated.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}${r.owner ? ` · ${esc2(r.owner)}` : ''}</div>
    </div>
    <div class="score">
      <b>${r.health.score}</b><span class="muted"> /100</span>
      <div class="muted">${esc2(r.health.grade)} · Business Health</div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><span>30-day revenue</span><b>${money(r.health.revenue)}</b></div>
    <div class="kpi"><span>Gross profit</span><b>${money(r.health.profit)}</b></div>
    <div class="kpi"><span>Tax collected</span><b>${money(r.tax.tax)}</b></div>
    <div class="kpi"><span>Receivable</span><b>${money(r.health.receivable)}</b></div>
    <div class="kpi"><span>Expenses</span><b>${money(r.health.expenses)}</b></div>
    <div class="kpi"><span>Next 7 days forecast</span><b>${money(r.forecast.predictedWeek)}</b></div>
    <div class="kpi"><span>Money on the table</span><b>${money(r.recoverable)}</b></div>
    <div class="kpi"><span>Cash variance (30d)</span><b>${r.closingTotals.variance ? (r.closingTotals.variance > 0 ? '+' : '') + money(r.closingTotals.variance) : money(0)}</b></div>
  </div>

  <div class="grid">
    <div class="card full">
      <h2>Action plan</h2>
      <ul>${actions}</ul>
    </div>

    <div class="card">
      <h2>Profit leaks</h2>
      <table><thead><tr><th>Leak</th><th class="r">Recovery</th></tr></thead><tbody>${leakRows}</tbody></table>
    </div>

    <div class="card">
      <h2>Smart restock plan</h2>
      <table><thead><tr><th>Product</th><th class="r">Stock</th><th class="r">Cover</th><th class="r">Order</th><th class="r">Cost</th></tr></thead><tbody>${restockRows}</tbody></table>
    </div>

    <div class="card">
      <h2>Top products (30 days)</h2>
      <table><thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Revenue</th></tr></thead><tbody>${prodRows}</tbody></table>
    </div>

    <div class="card">
      <h2>Top customers (30 days)</h2>
      <table><thead><tr><th>Customer</th><th class="r">Bills</th><th class="r">Value</th></tr></thead><tbody>${custRows}</tbody></table>
    </div>

    <div class="card">
      <h2>Customer segments</h2>
      <table><thead><tr><th>Customer</th><th>Segment</th><th class="r">Bills</th><th class="r">Value</th></tr></thead><tbody>${segRows}</tbody></table>
    </div>

    <div class="card">
      <h2>Day close / cash reconciliation</h2>
      <table><thead><tr><th>Date</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Variance</th></tr></thead><tbody>${closeRows}</tbody></table>
    </div>

    <div class="card full">
      <h2>Health breakdown</h2>
      <table><thead><tr><th>Area</th><th class="r">Score</th><th>Note</th></tr></thead><tbody>
        <tr><td>Sales momentum</td><td class="r">${r.health.salesScore}/100</td><td class="muted">Is hafte vs pichhle hafte</td></tr>
        <tr><td>Profit margin</td><td class="r">${r.health.profitScore}/100</td><td class="muted">Margin ${Math.round(r.health.margin * 100)}%</td></tr>
        <tr><td>Stock health</td><td class="r">${r.health.stockScore}/100</td><td class="muted">${r.health.lowCount} low stock products</td></tr>
        <tr><td>Credit control</td><td class="r">${r.health.creditScore}/100</td><td class="muted">Receivable ${money(r.health.receivable)}</td></tr>
        <tr><td>Expense control</td><td class="r">${r.health.expenseScore}/100</td><td class="muted">Expenses ${money(r.health.expenses)}</td></tr>
      </tbody></table>
    </div>
  </div>

  <div class="foot">
    <span>Generated by mhzaly · offline business intelligence · tax invoice QR verification built-in</span>
    <span>${esc2(r.shop)}</span>
  </div>
</body></html>`;
}

export function openBusinessReview() {
  const review = buildReview();
  const html = reviewHtml(review);
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}
