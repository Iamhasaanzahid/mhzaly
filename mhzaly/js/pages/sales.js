/* ============================================================
   mhzaly — Sales
   ============================================================ */

import { db } from '../db.js';
import { icon, esc, emptyState } from '../ui.js';

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Sales</h2>
        <p>All invoices and transactions.</p>
      </div>
    </div>

    <div class="card mt">
      <div class="card-pad">
        <table style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left">Invoice</th>
              <th style="text-align:left">Customer</th>
              <th style="text-align:right">Total</th>
              <th style="text-align:left">Date</th>
            </tr>
          </thead>
          <tbody id="salesTableBody"></tbody>
        </table>
      </div>
    </div>`;

  const body = root.querySelector('#salesTableBody');
  if (!db.sales.length) {
    body.innerHTML = `<tr><td colspan="4">${emptyState('No sales yet.')}</td></tr>`;
    return;
  }
  body.innerHTML = db.sales.slice().reverse().map((s) => `
    <tr>
      <td>${esc(s.invoiceNo || s.id)}</td>
      <td>${esc(s.customerName || 'Walk-in')}</td>
      <td style="text-align:right">Rs ${Number(s.total || 0).toLocaleString()}</td>
      <td>${new Date(s.createdAt).toLocaleDateString('en-GB')}</td>
    </tr>`).join('');
}
