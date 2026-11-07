/* ============================================================
   Mart Manager — printable receipt
   ============================================================ */

import { db } from './db.js';
import { esc, fmtMoney, fmtDateTime, fmtQty } from './ui.js';

export function receiptHTML(sale) {
  const s = db.settings;
  const shop = esc(s.shopName || 'My Mart');
  const rows = sale.items
    .map(
      (item) => `
      <tr>
        <td colspan="2">${esc(item.name)}</td>
      </tr>
      <tr>
        <td class="r-small">${fmtQty(item.qty)} × ${fmtMoney(item.price, false)}</td>
        <td class="r-right">${fmtMoney(item.qty * item.price)}</td>
      </tr>`
    )
    .join('');

  return `
  <div class="receipt">
    <div class="r-center">
      <div class="r-shop">${shop}</div>
      ${s.address ? `<div class="r-small">${esc(s.address)}</div>` : ''}
      ${s.phone ? `<div class="r-small">Tel: ${esc(s.phone)}</div>` : ''}
    </div>
    <div class="r-dash"></div>
    <table>
      <tr><td>Invoice</td><td class="r-right">${esc(sale.no)}</td></tr>
      <tr><td>Date</td><td class="r-right">${fmtDateTime(sale.date)}</td></tr>
      <tr><td>Customer</td><td class="r-right">${esc(sale.customerName || 'Walk-in')}</td></tr>
      <tr><td>Payment</td><td class="r-right">${esc(sale.method || 'Cash')}</td></tr>
    </table>
    <div class="r-dash"></div>
    <table>${rows}</table>
    <div class="r-dash"></div>
    <table>
      <tr><td>Subtotal</td><td class="r-right">${fmtMoney(sale.subtotal)}</td></tr>
      ${Number(sale.discount) ? `<tr><td>Discount</td><td class="r-right">− ${fmtMoney(sale.discount)}</td></tr>` : ''}
      ${Number(sale.tax) ? `<tr><td>Tax</td><td class="r-right">${fmtMoney(sale.tax)}</td></tr>` : ''}
      <tr><td class="r-total">TOTAL</td><td class="r-right r-total">${fmtMoney(sale.total)}</td></tr>
      <tr><td>Paid</td><td class="r-right">${fmtMoney(sale.paid)}</td></tr>
      ${Number(sale.due) ? `<tr><td>Balance due</td><td class="r-right">${fmtMoney(sale.due)}</td></tr>` : ''}
    </table>
    <div class="r-dash"></div>
    <div class="r-center r-small">${esc(s.receiptNote || 'Thank you for shopping with us!')}</div>
    <div class="r-center r-small" style="margin-top:6px">Powered by Mart Manager</div>
  </div>`;
}

export function printReceipt(sale) {
  const root = document.getElementById('print-root');
  if (!root) return;
  root.innerHTML = receiptHTML(sale);
  setTimeout(() => window.print(), 80);
}
