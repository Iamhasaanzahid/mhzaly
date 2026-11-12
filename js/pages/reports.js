/* ============================================================
   mhzaly — Reports
   ============================================================ */

import { db, totalReceivable, lowStockProducts } from '../db.js';
import { icon, esc, emptyState, downloadFile } from '../ui.js';
import { toCsv } from '../csv.js';

function money(n) {
  return `${db.settings.currency || 'Rs'} ${Number(n || 0).toLocaleString()}`;
}

function rangeBounds(range) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return { from: start, to: null };
  if (range === '7') {
    const d = new Date(start);
    d.setDate(d.getDate() - 6);
    return { from: d, to: null };
  }
  if (range === '30') {
    const d = new Date(start);
    d.setDate(d.getDate() - 29);
    return { from: d, to: null };
  }
  if (range === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
  if (range === 'lastmonth') {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 1),
    };
  }
  return { from: null, to: null };
}

function rangeLabel(range) {
  return {
    today: 'Today',
    '7': 'Last 7 days',
    '30': 'Last 30 days',
    month: 'This month',
    lastmonth: 'Last month',
    all: 'All time',
  }[range] || 'All time';
}

function itemProfit(it) {
  const p = db.products.find((x) => x.id === it.id || x.id === it.productId);
  const cost = p ? Number(p.cost) || 0 : 0;
  const qty = Number(it.qty) || 1;
  return ((Number(it.price) || 0) - cost) * qty;
}

function refundTotal(row) {
  return (row.items || []).reduce(
    (a, it) => a + (Number(it.qty) || 0) * (Number(it.price) || 0),
    0
  );
}

function kpi(iconName, tone, label, value, sub) {
  return `<div class="kpi">
    <div class="kpi-ico ${tone}">${icon(iconName)}</div>
    <div class="grow">
      <div class="k-lbl">${esc(label)}</div>
      <div class="k-val">${esc(value)}</div>
      ${sub ? `<div class="k-sub">${esc(sub)}</div>` : ''}
    </div>
  </div>`;
}

function miniBars(entries) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return `<div class="mini-bars">${entries
    .map(
      ([label, value]) => `<div class="mini-bar-row">
        <span>${esc(label)}</span>
        <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${Math.max(3, Math.round((value / max) * 100))}%"></div></div>
        <b>${money(value)}</b>
      </div>`
    )
    .join('')}</div>`;
}

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Reports</h2>
        <p>Revenue, profit, customers, payment mix aur expense summary.</p>
      </div>
      <div class="head-actions">
        <select class="input" id="reportRange" style="width:auto;min-width:150px">
          <option value="today">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="month">This month</option>
          <option value="lastmonth">Last month</option>
          <option value="all" selected>All time</option>
        </select>
        <button class="btn btn-ghost" id="exportReports">${icon('download')} Export CSV</button>
      </div>
    </div>
    <div id="reportBody"></div>`;

  const rangeSel = root.querySelector('#reportRange');
  const body = root.querySelector('#reportBody');

  function filtered() {
    const { from, to } = rangeBounds(rangeSel.value);
    const inRange = (iso) => {
      const t = new Date(iso || 0).getTime();
      return (!from || t >= from.getTime()) && (!to || t < to.getTime());
    };
    const sales = db.sales.filter((s) => inRange(s.createdAt));
    const expenses = db.expenses.filter((e) => inRange(e.createdAt));
    const returns = (db.returns || []).filter((r) => inRange(r.createdAt));
    return { sales, expenses, returns };
  }

  function compute() {
    const { sales, expenses, returns } = filtered();
    const returnsTotal = returns.reduce((a, r) => a + refundTotal(r), 0);
    let returnsProfit = 0;
    for (const r of returns) {
      for (const it of r.items || []) returnsProfit += itemProfit(it);
    }
    const revenue = sales.reduce((a, s) => a + (Number(s.total) || 0), 0) - returnsTotal;
    let profit = 0;
    const productMap = new Map();
    const customerMap = new Map();
    const paymentMap = new Map();
    for (const s of sales) {
      for (const it of s.items || []) {
        profit += itemProfit(it);
        const key = it.name || 'Item';
        const cur = productMap.get(key) || { qty: 0, revenue: 0 };
        cur.qty += Number(it.qty) || 1;
        cur.revenue += (Number(it.price) || 0) * (Number(it.qty) || 1);
        productMap.set(key, cur);
      }
      const customer = (s.customerName || 'Walk-in').trim() || 'Walk-in';
      if (!/^walk[- ]?in$/i.test(customer)) {
        const cur = customerMap.get(customer) || { total: 0, count: 0 };
        cur.total += Number(s.total) || 0;
        cur.count += 1;
        customerMap.set(customer, cur);
      }
      const method = s.paymentMethod || 'Cash';
      paymentMap.set(method, (paymentMap.get(method) || 0) + (Number(s.total) || 0));
    }
    profit -= returnsProfit;
    const expenseTotal = expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const net = profit - expenseTotal;
    const top = [...productMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);
    const topCustomers = [...customerMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    const payments = [...paymentMap.entries()].sort((a, b) => b[1] - a[1]);
    const catMap = new Map();
    for (const e of expenses) {
      const key = e.category || 'Other';
      catMap.set(key, (catMap.get(key) || 0) + (Number(e.amount) || 0));
    }
    const cats = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
    const avgBill = sales.length ? sales.reduce((a, s) => a + (Number(s.total) || 0), 0) / sales.length : 0;
    return {
      sales, expenses, returns, returnsTotal, returnsProfit, revenue, profit, expenseTotal, net,
      top, topCustomers, payments, cats, avgBill,
    };
  }

  function renderBody() {
    const data = compute();
    const {
      sales, expenses, returns, returnsTotal, revenue, profit, expenseTotal, net,
      top, topCustomers, payments, cats, avgBill,
    } = data;

    const low = lowStockProducts();
    const inventoryCost = db.products.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.cost) || 0), 0);
    const inventorySale = db.products.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.price) || 0), 0);
    const udhaar = totalReceivable();
    const payable = db.suppliers.reduce((a, s) => a + Math.max(0, Number(s.balance) || 0), 0);

    body.innerHTML = `
      <div class="kpi-grid">
        ${kpi('check', 'green', 'Revenue', money(revenue), `${sales.length} invoices${returns.length ? ` · ${returns.length} returns` : ''}`)}
        ${kpi('sparkle', 'blue', 'Gross Profit', money(profit), 'Sales − cost − returns')}
        ${kpi('alert', 'amber', 'Expenses', money(expenseTotal), expenses.length + ' entries')}
        ${kpi('sparkle', net >= 0 ? 'teal' : 'amber', 'Net Profit', money(net), 'Gross profit − expenses')}
      </div>

      <div class="grid k2 mt">
        <div class="card">
          <div class="card-head"><h3>Top Products</h3><span class="right">${rangeLabel(rangeSel.value)}</span></div>
          <div class="card-pad">
            ${
              top.length
                ? `<div class="table-wrap"><table style="width:100%"><thead><tr><th style="text-align:left">Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody>${top
                    .map(
                      ([name, v]) =>
                        `<tr><td>${esc(name)}</td><td style="text-align:right">${v.qty}</td><td style="text-align:right">${money(v.revenue)}</td></tr>`
                    )
                    .join('')}</tbody></table></div>`
                : emptyState('Is range mein koi sale nahi.')
            }
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Top Customers</h3><span class="right">${rangeLabel(rangeSel.value)}</span></div>
          <div class="card-pad">
            ${
              topCustomers.length
                ? `<div class="table-wrap"><table style="width:100%"><thead><tr><th style="text-align:left">Customer</th><th style="text-align:right">Bills</th><th style="text-align:right">Total</th></tr></thead><tbody>${topCustomers
                    .map(
                      ([name, v]) =>
                        `<tr><td>${esc(name)}</td><td style="text-align:right">${v.count}</td><td style="text-align:right">${money(v.total)}</td></tr>`
                    )
                    .join('')}</tbody></table></div>`
                : emptyState('Is range mein named customer sale nahi.')
            }
          </div>
        </div>
      </div>

      <div class="grid k2 mt">
        <div class="card">
          <div class="card-head"><h3>Payment Methods</h3><span class="right">${money(sales.reduce((a, s) => a + (Number(s.total) || 0), 0))}</span></div>
          <div class="card-pad">
            ${payments.length ? miniBars(payments) : emptyState('Is range mein koi payment nahi.')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Expenses by Category</h3><span class="right">${money(expenseTotal)}</span></div>
          <div class="card-pad">
            ${
              cats.length
                ? miniBars(cats)
                : emptyState('Is range mein koi expense nahi.')
            }
          </div>
        </div>
      </div>

      <div class="grid k2 mt">
        <div class="card">
          <div class="card-head"><h3>Returns & Refunds</h3><span class="right">${returns.length} returns</span></div>
          <div class="card-pad">
            ${
              returns.length
                ? `<div class="stat-strip" style="margin-bottom:12px">
                    <div><div class="lbl">Refund total</div><div class="val">${money(returnsTotal)}</div></div>
                    <div><div class="lbl">Average refund</div><div class="val">${money(returnsTotal / returns.length)}</div></div>
                  </div>
                  <div class="table-wrap"><table style="width:100%"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Invoice</th><th style="text-align:right">Refund</th></tr></thead><tbody>${returns
                    .slice()
                    .reverse()
                    .slice(0, 6)
                    .map(
                      (r) =>
                        `<tr><td>${new Date(r.createdAt || 0).toLocaleDateString('en-GB')}</td><td>${esc(r.invoiceNo || '—')}</td><td style="text-align:right">${money(refundTotal(r))}</td></tr>`
                    )
                    .join('')}</tbody></table></div>`
                : emptyState('Is range mein koi return nahi.')
            }
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Shop Snapshot</h3><span class="right">Live</span></div>
          <div class="card-pad">
            <div class="stat-strip" style="margin-bottom:0">
              <div><div class="lbl">Inventory cost</div><div class="val">${money(inventoryCost)}</div></div>
              <div><div class="lbl">Inventory sale value</div><div class="val">${money(inventorySale)}</div></div>
              <div><div class="lbl">Low stock</div><div class="val">${low.length}</div></div>
              <div><div class="lbl">Udhaar</div><div class="val">${money(udhaar)}</div></div>
              <div><div class="lbl">Supplier payable</div><div class="val">${money(payable)}</div></div>
              <div><div class="lbl">Average bill</div><div class="val">${money(avgBill)}</div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card mt">
        <div class="card-head"><h3>Sales in this range</h3><span class="right">${sales.length} invoices · ${money(sales.reduce((a, s) => a + (Number(s.total) || 0), 0))}</span></div>
        <div class="card-pad">
          ${
            sales.length
              ? `<div class="table-wrap"><table style="width:100%"><thead><tr><th style="text-align:left">Invoice</th><th style="text-align:left">Customer</th><th style="text-align:left">Date</th><th style="text-align:left">Payment</th><th style="text-align:right">Total</th></tr></thead><tbody>${sales
                  .slice()
                  .reverse()
                  .map(
                    (s) =>
                      `<tr><td>${esc(s.invoiceNo || s.id)}</td><td>${esc(s.customerName || 'Walk-in')}</td><td>${new Date(s.createdAt).toLocaleDateString('en-GB')}</td><td>${esc(s.paymentMethod || 'Cash')}</td><td style="text-align:right">${money(s.total)}</td></tr>`
                  )
                  .join('')}</tbody></table></div>`
              : emptyState('No sales data.')
          }
        </div>
      </div>`;
  }

  rangeSel.addEventListener('change', renderBody);
  renderBody();

  root.querySelector('#exportReports').addEventListener('click', () => {
    const data = compute();
    const rows = [];
    rows.push(['mhzaly report', rangeLabel(rangeSel.value)]);
    rows.push([]);
    rows.push(['Summary', '']);
    rows.push(['Revenue', data.revenue]);
    rows.push(['Gross profit', data.profit]);
    rows.push(['Expenses', data.expenseTotal]);
    rows.push(['Net profit', data.net]);
    rows.push(['Invoices', data.sales.length]);
    rows.push(['Returns', data.returns.length]);
    rows.push(['Refund total', data.returnsTotal]);
    rows.push(['Average bill', data.avgBill]);
    rows.push([]);
    rows.push(['Top Products', '']);
    rows.push(['Product', 'Qty', 'Revenue']);
    for (const [name, v] of data.top) rows.push([name, v.qty, v.revenue]);
    rows.push([]);
    rows.push(['Top Customers', '']);
    rows.push(['Customer', 'Bills', 'Total']);
    for (const [name, v] of data.topCustomers) rows.push([name, v.count, v.total]);
    rows.push([]);
    rows.push(['Payment Methods', '']);
    rows.push(['Method', 'Total']);
    for (const [method, total] of data.payments) rows.push([method, total]);
    rows.push([]);
    rows.push(['Expenses by Category', '']);
    rows.push(['Category', 'Amount']);
    for (const [category, total] of data.cats) rows.push([category, total]);
    rows.push([]);
    rows.push(['Returns', '']);
    rows.push(['Date', 'Invoice', 'Customer', 'Refund', 'Method']);
    for (const r of data.returns) {
      rows.push([
        new Date(r.createdAt || 0).toISOString().slice(0, 10),
        r.invoiceNo || '',
        r.customerName || '',
        refundTotal(r),
        r.method || 'Cash',
      ]);
    }
    rows.push([]);
    rows.push(['Sales', '']);
    rows.push(['Invoice', 'Date', 'Customer', 'Total', 'Payment']);
    for (const s of data.sales) {
      rows.push([
        s.invoiceNo || s.id,
        new Date(s.createdAt).toISOString().slice(0, 10),
        s.customerName || 'Walk-in',
        Number(s.total) || 0,
        s.paymentMethod || 'Cash',
      ]);
    }
    downloadFile(`mhzaly-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
  });
}
