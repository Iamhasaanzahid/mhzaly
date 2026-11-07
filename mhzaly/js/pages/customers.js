/* ============================================================
   mhzaly — Customers (Udhaar Khata)
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast } from '../ui.js';

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Customers</h2>
        <p>Manage customer khata (credit/udhaar).</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" id="addCustomerBtn">${icon('plus')} Add Customer</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-pad">
        <table style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left">Name</th>
              <th style="text-align:left">Phone</th>
              <th style="text-align:right">Balance</th>
              <th style="width:140px"></th>
            </tr>
          </thead>
          <tbody id="customerTableBody"></tbody>
        </table>
      </div>
    </div>`;

  function renderTable() {
    root.querySelector('#customerTableBody').innerHTML = db.customers.map((c) => `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${esc(c.phone || '')}</td>
        <td style="text-align:right">Rs ${Number(c.balance || 0).toLocaleString()}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${esc(c.id)}">${icon('settings')}</button></td>
      </tr>`).join('');
  }
  renderTable();

  root.querySelector('#addCustomerBtn').addEventListener('click', () => {
    const name = prompt('Customer name:');
    if (!name) return;
    const phone = prompt('Phone:') || '';
    db.customers.push({ id: uid('cust'), name, phone, balance: 0, createdAt: new Date().toISOString() });
    save();
    renderTable();
    toast('Customer added');
  });
}
