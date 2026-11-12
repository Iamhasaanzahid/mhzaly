/* ============================================================
   mhzaly — Sales
   ============================================================ */

import { db, save } from '../db.js';
import { icon, esc, emptyState, openModal, downloadFile, toast } from '../ui.js';
import { money, printReceipt, shareWhatsApp } from '../receipt-share.js';
import { toCsv } from '../csv.js';

function itemCount(sale) {
  return (sale.items || []).reduce((a, it) => a + (Number(it.qty) || 1), 0);
}

function rangeStart(range) {
  if (range === 'all') return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === 'today') return d;
  const days = Number(range);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function goToReturn(saleId) {
  sessionStorage.setItem('mhzaly_open_return', saleId);
  location.hash = '#/returns';
}

function showInvoice(sale) {
  const rows = (sale.items || [])
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}</td><td style="text-align:center">${esc(it.qty)}</td><td style="text-align:right">${money(
          (Number(it.qty) || 1) * (Number(it.price) || 0)
        )}</td></tr>`
    )
    .join('');

  openModal({
    title: 'Invoice ' + (sale.invoiceNo || sale.id),
    subtitle: new Date(sale.createdAt).toLocaleString(),
    body: `
      <div class="sale-done">
        <div class="sale-done-total">${money(sale.total)}</div>
        <div class="sale-done-sub">${esc(sale.customerName || 'Walk-in')} · ${itemCount(sale)} item(s) · ${esc(sale.paymentMethod || 'Cash')}</div>
      </div>
      <div class="table-wrap">
        <table style="width:100%">
          <thead><tr><th style="text-align:left">Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3">${emptyState('No items.')}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="field" style="margin-top:14px">
        <label>Customer phone (WhatsApp)</label>
        <input class="input" id="invPhone" value="${esc(sale.customerPhone || '')}" placeholder="03xx-xxxxxxx" inputmode="tel" />
      </div>
      <div class="field">
        <label>Customer tax / NTN (optional)</label>
        <input class="input" id="invTax" value="${esc(sale.customerTaxNumber || '')}" placeholder="Buyer tax number" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-close-inv>Close</button>
      <button class="btn btn-ghost" data-return-inv>${icon('return')} Return</button>
      <button class="btn btn-ghost" id="invPrint">${icon('download')} Print</button>
      <button class="btn btn-primary" id="invWhatsapp">${icon('check')} WhatsApp</button>`,
    onMount: (bd) => {
      const phoneEl = bd.querySelector('#invPhone');
      const taxEl = bd.querySelector('#invTax');
      const syncContact = () => {
        const value = String(phoneEl.value || '').trim();
        if (value !== (sale.customerPhone || '')) {
          sale.customerPhone = value;
          save();
        }
        const tax = String(taxEl.value || '').trim();
        if (tax !== (sale.customerTaxNumber || '')) {
          sale.customerTaxNumber = tax;
          save();
        }
        return value;
      };
      bd.querySelector('[data-close-inv]').addEventListener('click', () => bd.remove());
      bd.querySelector('[data-return-inv]').addEventListener('click', () => {
        bd.remove();
        goToReturn(sale.id);
      });
      bd.querySelector('#invPrint').addEventListener('click', () => {
        syncContact();
        printReceipt(sale);
      });
      bd.querySelector('#invWhatsapp').addEventListener('click', () => {
        shareWhatsApp(sale, syncContact());
      });
    },
  });
}

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Sales</h2>
        <p>All invoices and transactions.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="exportSales">${icon('download')} Export CSV</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head"><h3>Invoices</h3><span class="right" id="salesSummary">—</span></div>
      <div class="card-pad">
        <div class="filter-row">
          <div class="field grow">
            <label>Search</label>
            <input class="input" id="salesSearch" placeholder="Invoice or customer" />
          </div>
          <div class="field">
            <label>Date range</label>
            <select class="input" id="salesRange">
              <option value="all" selected>All time</option>
              <option value="today">Today</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </div>
          <div class="field">
            <label>Payment</label>
            <select class="input" id="salesMethod">
              <option value="all">All methods</option>
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="Online">Online</option>
              <option value="Udhaar">Udhaar</option>
            </select>
          </div>
        </div>
        <div class="table-wrap">
          <table style="width:100%;margin-top:10px">
            <thead>
              <tr>
                <th style="text-align:left">Invoice</th>
                <th style="text-align:left">Customer</th>
                <th style="text-align:right">Items</th>
                <th style="text-align:left">Date</th>
                <th style="text-align:right">Total</th>
                <th style="width:110px"></th>
              </tr>
            </thead>
            <tbody id="salesTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const searchEl = root.querySelector('#salesSearch');
  const rangeEl = root.querySelector('#salesRange');
  const methodEl = root.querySelector('#salesMethod');
  const body = root.querySelector('#salesTableBody');
  const summaryEl = root.querySelector('#salesSummary');

  function list() {
    const q = String(searchEl.value || '').toLowerCase();
    const from = rangeStart(rangeEl.value);
    const method = methodEl.value;
    return db.sales
      .filter((s) => {
        const matchesQuery =
          !q ||
          String(s.invoiceNo || s.id).toLowerCase().includes(q) ||
          String(s.customerName || '').toLowerCase().includes(q);
        const matchesRange = !from || new Date(s.createdAt || 0) >= from;
        const matchesMethod = method === 'all' || (s.paymentMethod || 'Cash') === method;
        return matchesQuery && matchesRange && matchesMethod;
      })
      .slice()
      .reverse();
  }

  function renderTable() {
    const rows = list();
    if (summaryEl) {
      const total = rows.reduce((a, s) => a + (Number(s.total) || 0), 0);
      summaryEl.textContent = `${rows.length} invoice${rows.length === 1 ? '' : 's'} · ${money(total)}`;
    }
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6">${emptyState('Koi sale nahi mili. Filter change karein.')}</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (s) => `
      <tr>
        <td><b>${esc(s.invoiceNo || s.id)}</b></td>
        <td>${esc(s.customerName || 'Walk-in')}</td>
        <td style="text-align:right">${itemCount(s)}</td>
        <td>${new Date(s.createdAt).toLocaleDateString('en-GB')}</td>
        <td style="text-align:right">${money(s.total)}</td>
        <td style="text-align:right; white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-view="${esc(s.id)}" title="View invoice">${icon('eye')}</button>
          <button class="btn btn-ghost btn-sm" data-return-sale="${esc(s.id)}" title="Return items">${icon('return')}</button>
          <button class="btn btn-ghost btn-sm" data-print="${esc(s.id)}" title="Print receipt">${icon('download')}</button>
        </td>
      </tr>`
      )
      .join('');
  }

  renderTable();
  searchEl.addEventListener('input', renderTable);
  rangeEl.addEventListener('change', renderTable);
  methodEl.addEventListener('change', renderTable);

  body.addEventListener('click', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) {
      const sale = db.sales.find((s) => s.id === view.dataset.view);
      if (sale) showInvoice(sale);
      return;
    }
    const ret = e.target.closest('[data-return-sale]');
    if (ret) {
      goToReturn(ret.dataset.returnSale);
      return;
    }
    const pr = e.target.closest('[data-print]');
    if (pr) {
      const sale = db.sales.find((s) => s.id === pr.dataset.print);
      if (sale) printReceipt(sale);
    }
  });

  root.querySelector('#exportSales').addEventListener('click', () => {
    const rows = [['Invoice', 'Date', 'Customer', 'Phone', 'Buyer Tax', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Payment']];
    for (const s of list()) {
      const subtotal =
        Number(s.subtotal) ||
        (s.items || []).reduce((a, it) => a + (Number(it.qty) || 1) * (Number(it.price) || 0), 0);
      rows.push([
        s.invoiceNo || s.id,
        new Date(s.createdAt).toISOString().slice(0, 10),
        s.customerName || 'Walk-in',
        s.customerPhone || '',
        s.customerTaxNumber || '',
        itemCount(s),
        subtotal,
        Number(s.discount) || 0,
        Number(s.tax) || 0,
        Number(s.total) || 0,
        s.paymentMethod || 'Cash',
      ]);
    }
    downloadFile(`mhzaly-sales-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
    toast('Sales exported', 'success');
  });
}
