/* ============================================================
   mhzaly — Suppliers
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast } from '../ui.js';

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Suppliers</h2>
        <p>Manage supplier list and payable balance.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" id="addSupplierBtn">${icon('plus')} Add Supplier</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-pad">
        <table style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left">Name</th>
              <th style="text-align:left">Phone</th>
              <th style="text-align:right">Payable</th>
              <th style="width:140px"></th>
            </tr>
          </thead>
          <tbody id="supplierTableBody"></tbody>
        </table>
      </div>
    </div>`;

  function renderTable() {
    root.querySelector('#supplierTableBody').innerHTML = db.suppliers.map((s) => `
      <tr>
        <td>${esc(s.name)}</td>
        <td>${esc(s.phone || '')}</td>
        <td style="text-align:right">Rs ${Number(s.balance || 0).toLocaleString()}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${esc(s.id)}">${icon('settings')}</button></td>
      </tr>`).join('');
  }
  renderTable();

  root.querySelector('#addSupplierBtn').addEventListener('click', () => {
    const name = prompt('Supplier name:');
    if (!name) return;
    const phone = prompt('Phone:') || '';
    db.suppliers.push({ id: uid('sup'), name, phone, balance: 0, createdAt: new Date().toISOString() });
    save();
    renderTable();
    toast('Supplier added');
  });
}
