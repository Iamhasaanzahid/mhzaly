/* ============================================================
   Sales / invoices
   ============================================================ */

import { db, save, getProduct, activeSales, saleProfit, round2, dayKey } from '../db.js';
import {
  icon, esc, fmtMoney, fmtDate, fmtDateTime, fmtQty, toast, refresh, openModal, closeModal,
  confirmDialog, downloadFile, toCSV, paymentBadge, emptyState, sum,
} from '../ui.js';
import { printReceipt, receiptHTML } from '../receipt.js';

export const meta = { title: 'Sales', subtitle: 'Invoices, payments and profit' };

let query = '';
let fromKey = '';
let toKey = '';
let methodFilter = '';

function filtered() {
  const q = query.trim().toLowerCase();
  return activeSales()
    .filter((s) => {
      const k = dayKey(s.date);
      if (fromKey && k < fromKey) return false;
      if (toKey && k > toKey) return false;
      if (methodFilter && s.method !== methodFilter) return false;
      if (
        q &&
        !String(s.no || '').toLowerCase().includes(q) &&
        !String(s.customerName || '').toLowerCase().includes(q)
      )
        return false;
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function saleModal(sale) {
  const items = sale.items
    .map(
      (i) => `<tr>
        <td>${esc(i.name)}</td>
        <td class="num">${fmtQty(i.qty)}</td>
        <td class="num">${fmtMoney(i.price)}</td>
        <td class="num strong">${fmtMoney(i.qty * i.price)}</td>
      </tr>`
    )
    .join('');

  const modal = openModal({
    title: sale.no,
    subtitle: `${fmtDateTime(sale.date)} · ${sale.customerName || 'Walk-in'}`,
    size: 'lg',
    body: `
      <div class="flex flex-wrap" style="margin-bottom:14px;gap:8px">
        ${paymentBadge(sale.method)}
        ${sale.voided ? '<span class="badge red">Voided</span>' : sale.due > 0 ? '<span class="badge amber">Payment due</span>' : '<span class="badge green">Paid</span>'}
        <span class="badge">${sale.items.reduce((s, i) => s + Number(i.qty), 0)} items</span>
      </div>
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:12px">
        <table class="table">
          <thead><tr><th>Item</th><th class="th-right">Qty</th><th class="th-right">Price</th><th class="th-right">Total</th></tr></thead>
          <tbody>${items}</tbody>
        </table>
      </div>
      <div style="max-width:320px;margin-left:auto;margin-top:14px">
        <div class="sum-row"><span class="lbl">Subtotal</span><span>${fmtMoney(sale.subtotal)}</span></div>
        ${sale.discount ? `<div class="sum-row"><span class="lbl">Discount</span><span>− ${fmtMoney(sale.discount)}</span></div>` : ''}
        ${sale.tax ? `<div class="sum-row"><span class="lbl">Tax</span><span>${fmtMoney(sale.tax)}</span></div>` : ''}
        <div class="sum-row total"><span class="lbl">Total</span><span>${fmtMoney(sale.total)}</span></div>
        <div class="sum-row"><span class="lbl">Paid</span><span>${fmtMoney(sale.paid)}</span></div>
        ${sale.due ? `<div class="sum-row"><span class="lbl">Due</span><span class="text-amber strong">${fmtMoney(sale.due)}</span></div>` : ''}
        ${!sale.voided ? `<div class="sum-row"><span class="lbl">Profit</span><span class="text-green strong">${fmtMoney(saleProfit(sale))}</span></div>` : ''}
      </div>`,
    footer: `
      ${!sale.voided ? `<button class="btn btn-danger btn-sm" id="voidSale">${icon('trash')} Void sale</button>` : ''}
      <div class="grow"></div>
      <button class="btn btn-ghost" data-modal-close>Close</button>
      <button class="btn" id="printSale">${icon('print')} Print</button>`,
    onMount: (m) => {
      m.querySelector('#printSale').addEventListener('click', () => printReceipt(sale));
      const voidBtn = m.querySelector('#voidSale');
      if (voidBtn) {
        voidBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Void this sale?',
            message: `${sale.no} will be marked as void, stock will be returned to inventory and any udhaar will be cleared.`,
            confirmText: 'Void sale',
            danger: true,
          });
          if (!ok) return;
          sale.items.forEach((item) => {
            const product = getProduct(item.productId);
            if (product) product.stock = round2(Number(product.stock) + Number(item.qty));
          });
          sale.voided = true;
          sale.voidedAt = new Date().toISOString();
          save();
          closeModal();
          toast('Sale voided and stock restored');
          refresh();
        });
      }
    },
  });
  return modal;
}

export function render(root) {
  const viewId = new URLSearchParams(location.hash.split('?')[1] || '').get('view');
  if (viewId) {
    history.replaceState(null, '', '#/sales');
    const sale = db.sales.find((s) => s.id === viewId);
    setTimeout(() => sale && saleModal(sale), 30);
  }

  const list = filtered();
  const revenue = sum(list, (s) => s.total);
  const profit = sum(list, (s) => saleProfit(s));
  const due = sum(list, (s) => s.due);

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Sales</h2>
        <p>${list.length} invoice${list.length === 1 ? '' : 's'} · ${fmtMoney(revenue)} revenue · ${fmtMoney(profit)} profit</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="exportSales">${icon('download')} Export CSV</button>
        <button class="btn" data-go="pos">${icon('plus')} New sale</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head" style="flex-wrap:wrap">
        <div class="search-wrap">
          ${icon('search')}
          <input class="input" id="saleSearch" placeholder="Search invoice or customer…" value="${esc(query)}" />
        </div>
        <div class="flex" style="gap:7px">
          <input class="input input-sm" type="date" id="saleFrom" value="${fromKey}" style="width:auto" title="From date" />
          <span class="muted xsmall">to</span>
          <input class="input input-sm" type="date" id="saleTo" value="${toKey}" style="width:auto" title="To date" />
        </div>
        <select class="select input-sm" id="saleMethod" style="width:auto">
          <option value="">All payments</option>
          ${['Cash', 'Card', 'Bank', 'Udhaar'].map((m) => `<option ${methodFilter === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <div class="right"><span class="badge ${due > 0 ? 'amber' : 'green'}">Due ${fmtMoney(due)}</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Invoice</th><th>Date</th><th>Customer</th><th>Items</th>
            <th class="th-right">Total</th><th class="th-right">Due</th><th>Payment</th><th class="th-right">Actions</th>
          </tr></thead>
          <tbody id="salesBody">
            ${
              list.length
                ? list
                    .map(
                      (s) => `<tr>
                        <td><div class="cell-title mono">${esc(s.no)}</div></td>
                        <td><div>${fmtDate(s.date)}</div><div class="cell-sub">${new Date(s.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div></td>
                        <td>${esc(s.customerName || 'Walk-in')}</td>
                        <td class="muted">${s.items.reduce((a, i) => a + Number(i.qty), 0)}</td>
                        <td class="num strong">${fmtMoney(s.total)}</td>
                        <td class="num ${s.due > 0 ? 'text-amber strong' : 'muted'}">${s.due > 0 ? fmtMoney(s.due) : '—'}</td>
                        <td>${paymentBadge(s.method)}</td>
                        <td>
                          <div class="row-actions">
                            <button class="icon-btn" data-view="${s.id}" title="View">${icon('eye')}</button>
                            <button class="icon-btn" data-print="${s.id}" title="Print">${icon('print')}</button>
                          </div>
                        </td>
                      </tr>`
                    )
                    .join('')
                : `<tr class="empty-row"><td colspan="8">No sales match this filter. <a href="#/pos">Create a sale</a>.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  const rerender = () => refresh();

  root.querySelector('#saleSearch').addEventListener('input', (e) => {
    query = e.target.value;
    const body = root.querySelector('#salesBody');
    // lightweight live refresh without losing focus
    const list = filtered();
    body.innerHTML = list.length
      ? list
          .map(
            (s) => `<tr>
              <td><div class="cell-title mono">${esc(s.no)}</div></td>
              <td><div>${fmtDate(s.date)}</div><div class="cell-sub">${new Date(s.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div></td>
              <td>${esc(s.customerName || 'Walk-in')}</td>
              <td class="muted">${s.items.reduce((a, i) => a + Number(i.qty), 0)}</td>
              <td class="num strong">${fmtMoney(s.total)}</td>
              <td class="num ${s.due > 0 ? 'text-amber strong' : 'muted'}">${s.due > 0 ? fmtMoney(s.due) : '—'}</td>
              <td>${paymentBadge(s.method)}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-view="${s.id}" title="View">${icon('eye')}</button>
                <button class="icon-btn" data-print="${s.id}" title="Print">${icon('print')}</button>
              </div></td>
            </tr>`
          )
          .join('')
      : `<tr class="empty-row"><td colspan="8">No sales match this filter.</td></tr>`;
  });

  root.querySelector('#saleFrom').addEventListener('change', (e) => { fromKey = e.target.value; refresh(); });
  root.querySelector('#saleTo').addEventListener('change', (e) => { toKey = e.target.value; refresh(); });
  root.querySelector('#saleMethod').addEventListener('change', (e) => { methodFilter = e.target.value; refresh(); });

  root.querySelector('#salesBody').addEventListener('click', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) {
      const sale = db.sales.find((s) => s.id === view.dataset.view);
      if (sale) saleModal(sale);
      return;
    }
    const print = e.target.closest('[data-print]');
    if (print) {
      const sale = db.sales.find((s) => s.id === print.dataset.print);
      if (sale) printReceipt(sale);
    }
  });

  root.querySelector('#exportSales').addEventListener('click', () => {
    const exportList = filtered();
    if (!exportList.length) return toast('Nothing to export', 'warn');
    const rows = exportList.map((s) => [
      s.no, fmtDate(s.date), s.customerName || 'Walk-in', s.items.length,
      s.subtotal, s.discount, s.tax, s.total, s.paid, s.due, s.method, s.voided ? 'Void' : 'Completed',
    ]);
    downloadFile(
      `sales-${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(['Invoice', 'Date', 'Customer', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Due', 'Payment', 'Status'], rows),
      'text/csv'
    );
    toast('Sales exported');
  });
}
