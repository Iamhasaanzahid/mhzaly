/* ============================================================
   Reports
   ============================================================ */

import {
  db, activeSales, saleProfit, dayKey, todayKey, round2, getProduct, addDaysKey,
} from '../db.js';
import {
  icon, esc, fmtMoney, fmtDate, fmtQty, toast, refresh, downloadFile, toCSV, sum,
} from '../ui.js';

export const meta = { title: 'Reports', subtitle: 'Sales, profit and expense analysis' };

let fromKey = '';
let toKey = '';

function defaults() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  fromKey = dayKey(first.toISOString());
  toKey = todayKey();
}

function eachDay(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end && out.length < 800) {
    out.push(dayKey(d.toISOString()));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function shortDate(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function monthLabel(key) {
  return new Date(`${key}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function bucketsFor() {
  const days = eachDay(fromKey, toKey);
  if (days.length <= 14) {
    return days.map((k) => ({ start: k, end: k, label: shortDate(k), full: shortDate(k) }));
  }
  if (days.length <= 90) {
    const out = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      out.push({
        start: chunk[0],
        end: chunk[chunk.length - 1],
        label: shortDate(chunk[0]),
        full: `${shortDate(chunk[0])} – ${shortDate(chunk[chunk.length - 1])}`,
      });
    }
    return out;
  }
  const map = new Map();
  days.forEach((k) => {
    const m = k.slice(0, 7);
    if (!map.has(m)) map.set(m, { start: k, end: k, label: monthLabel(m), full: monthLabel(m) });
    map.get(m).end = k;
  });
  return [...map.values()];
}

function barChart(buckets, values) {
  const max = Math.max(...values, 1);
  return `<div class="chart-bars">
    ${buckets
      .map(
        (b, i) => `<div class="chart-col" title="${esc(b.full)}: ${fmtMoney(values[i])}">
          <div class="chart-val">${values[i] ? fmtNumShort(values[i]) : ''}</div>
          <div class="chart-bar-track"><div class="chart-bar ${values[i] ? '' : 'zero'}" style="height:${Math.max((values[i] / max) * 100, 2)}%"></div></div>
          <div class="chart-label">${esc(b.label)}</div>
        </div>`
      )
      .join('')}
  </div>`;
}

function fmtNumShort(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(Math.round(n));
}

export function render(root) {
  if (!fromKey || !toKey) defaults();
  if (fromKey > toKey) toKey = fromKey;

  const sales = activeSales().filter((s) => {
    const k = dayKey(s.date);
    return k >= fromKey && k <= toKey;
  });
  const expenses = db.expenses.filter((e) => {
    const k = dayKey(e.date);
    return k >= fromKey && k <= toKey;
  });

  const revenue = sum(sales, (s) => s.total);
  const grossProfit = sum(sales, (s) => saleProfit(s));
  const expenseTotal = sum(expenses, (e) => e.amount);
  const netProfit = round2(grossProfit - expenseTotal);
  const avg = sales.length ? round2(revenue / sales.length) : 0;

  const buckets = bucketsFor();
  const series = buckets.map((b) => sum(sales.filter((s) => { const k = dayKey(s.date); return k >= b.start && k <= b.end; }), (s) => s.total));

  // product performance
  const prodMap = new Map();
  sales.forEach((s) => {
    s.items.forEach((item) => {
      const cur = prodMap.get(item.productId) || { name: item.name, qty: 0, revenue: 0, profit: 0 };
      cur.qty += Number(item.qty) || 0;
      cur.revenue += (Number(item.qty) || 0) * (Number(item.price) || 0);
      cur.profit += (Number(item.qty) || 0) * ((Number(item.price) || 0) - (Number(item.cost) || 0));
      prodMap.set(item.productId, cur);
    });
  });
  const products = [...prodMap.values()].sort((a, b) => b.revenue - a.revenue);

  // category performance
  const catMap = new Map();
  sales.forEach((s) => {
    s.items.forEach((item) => {
      const p = getProduct(item.productId);
      const cat = p?.category || 'Uncategorised';
      catMap.set(cat, (catMap.get(cat) || 0) + (Number(item.qty) || 0) * (Number(item.price) || 0));
    });
  });
  const cats = [...catMap.entries()].sort((a, b) => b[1] - a[1]);

  // payment methods
  const payMap = new Map();
  sales.forEach((s) => {
    const m = s.method || 'Cash';
    const cur = payMap.get(m) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(s.total) || 0;
    payMap.set(m, cur);
  });
  const methods = [...payMap.entries()].sort((a, b) => b[1].total - a[1].total);

  const expMap = {};
  expenses.forEach((e) => { expMap[e.category] = (expMap[e.category] || 0) + Number(e.amount); });
  const expCats = Object.entries(expMap).sort((a, b) => b[1] - a[1]);

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Reports</h2>
        <p>${fmtDate(fromKey + 'T12:00:00')} — ${fmtDate(toKey + 'T12:00:00')} · ${sales.length} invoices</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="exportReport">${icon('download')} Export sales CSV</button>
      </div>
    </div>

    <div class="card card-pad">
      <div class="toolbar">
        <div class="flex" style="gap:7px">
          <span class="small muted">From</span>
          <input class="input input-sm" type="date" id="repFrom" value="${fromKey}" style="width:auto" />
          <span class="small muted">to</span>
          <input class="input input-sm" type="date" id="repTo" value="${toKey}" style="width:auto" />
        </div>
        <div class="spacer"></div>
        <button class="chip" data-quick="today">Today</button>
        <button class="chip" data-quick="7">7 days</button>
        <button class="chip" data-quick="30">30 days</button>
        <button class="chip" data-quick="month">This month</button>
      </div>
    </div>

    <div class="grid k4 mt">
      <div class="card kpi">
        <div class="label">${icon('cart')} Revenue</div>
        <div class="icon-bubble">${icon('cart')}</div>
        <div class="value">${fmtMoney(revenue)}</div>
        <div class="foot">${sales.length} invoices · avg ${fmtMoney(avg)}</div>
      </div>
      <div class="card kpi green">
        <div class="label">${icon('chart')} Gross profit</div>
        <div class="icon-bubble">${icon('arrow-up')}</div>
        <div class="value">${fmtMoney(grossProfit)}</div>
        <div class="foot">${revenue ? Math.round((grossProfit / revenue) * 100) : 0}% gross margin</div>
      </div>
      <div class="card kpi amber">
        <div class="label">${icon('wallet')} Expenses</div>
        <div class="icon-bubble">${icon('wallet')}</div>
        <div class="value">${fmtMoney(expenseTotal)}</div>
        <div class="foot">${expenses.length} entries in this period</div>
      </div>
      <div class="card kpi ${netProfit >= 0 ? 'green' : 'red'}">
        <div class="label">${icon('sparkle')} Net profit</div>
        <div class="icon-bubble">${icon('sparkle')}</div>
        <div class="value">${fmtMoney(netProfit)}</div>
        <div class="foot">Gross profit minus expenses</div>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head">
        <div><h3>Sales trend</h3><div class="hint">${buckets.length > 14 ? 'Grouped' : 'Daily'} · total ${fmtMoney(revenue)}</div></div>
        <div class="right"><span class="badge teal">${sales.length} sales</span></div>
      </div>
      <div class="card-pad">${barChart(buckets, series)}</div>
    </div>

    <div class="grid k2 mt">
      <div class="card">
        <div class="card-head"><h3>Top products</h3><div class="right"><span class="hint">by revenue</span></div></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Product</th><th class="th-right">Qty</th><th class="th-right">Revenue</th><th class="th-right">Profit</th></tr></thead>
            <tbody>
              ${
                products.length
                  ? products.slice(0, 8).map((p) => `<tr>
                      <td class="cell-title">${esc(p.name)}</td>
                      <td class="num">${fmtQty(p.qty)}</td>
                      <td class="num">${fmtMoney(p.revenue)}</td>
                      <td class="num text-green">${fmtMoney(p.profit)}</td>
                    </tr>`).join('')
                  : `<tr class="empty-row"><td colspan="4">No sales in this period.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Payment methods</h3></div>
        <div class="card-pad">
          ${
            methods.length
              ? methods.map(([m, v]) => `<div class="flex-between" style="padding:9px 0;border-bottom:1px solid var(--line-2)">
                  <div class="flex"><span class="badge ${m === 'Udhaar' ? 'amber' : m === 'Card' ? 'blue' : 'green'}">${esc(m)}</span><span class="small muted">${v.count} invoices</span></div>
                  <strong>${fmtMoney(v.total)}</strong>
                </div>`).join('')
              : `<div class="empty" style="padding:26px"><h4>No payments yet</h4></div>`
          }
        </div>
      </div>
    </div>

    <div class="grid k2 mt">
      <div class="card">
        <div class="card-head"><h3>Sales by category</h3></div>
        <div class="card-pad">
          ${
            cats.length
              ? cats.map(([c, v]) => `<div class="flex-between" style="padding:9px 0;border-bottom:1px solid var(--line-2)">
                  <span class="small">${esc(c)}</span>
                  <div class="flex"><span class="xsmall muted">${revenue ? Math.round((v / revenue) * 100) : 0}%</span><strong>${fmtMoney(v)}</strong></div>
                </div>`).join('')
              : `<div class="empty" style="padding:26px"><h4>No category data</h4></div>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Expenses by category</h3><div class="right"><span class="hint">${fmtMoney(expenseTotal)}</span></div></div>
        <div class="card-pad">
          ${
            expCats.length
              ? expCats.map(([c, v]) => `<div class="flex-between" style="padding:9px 0;border-bottom:1px solid var(--line-2)">
                  <span class="small">${esc(c)}</span><strong>${fmtMoney(v)}</strong>
                </div>`).join('')
              : `<div class="empty" style="padding:26px"><h4>No expenses in period</h4></div>`
          }
        </div>
      </div>
    </div>`;

  const setRange = (from, to) => {
    fromKey = from;
    toKey = to;
    refresh();
  };
  root.querySelector('#repFrom').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) setRange(v, toKey);
  });
  root.querySelector('#repTo').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) setRange(fromKey, v);
  });
  root.querySelectorAll('[data-quick]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const q = btn.dataset.quick;
      if (q === 'today') setRange(todayKey(), todayKey());
      if (q === '7') setRange(addDaysKey(-6), todayKey());
      if (q === '30') setRange(addDaysKey(-29), todayKey());
      if (q === 'month') { defaults(); refresh(); }
    })
  );

  root.querySelector('#exportReport').addEventListener('click', () => {
    if (!sales.length) return toast('No sales in this period', 'warn');
    const rows = [...sales]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((s) => [
        s.no, fmtDate(s.date), s.customerName || 'Walk-in', s.items.length,
        s.subtotal, s.discount, s.tax, s.total, s.paid, s.due, s.method,
        saleProfit(s),
      ]);
    downloadFile(
      `report-${fromKey}-to-${toKey}.csv`,
      toCSV(['Invoice', 'Date', 'Customer', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Due', 'Payment', 'Profit'], rows),
      'text/csv'
    );
    toast('Report exported');
  });
}
