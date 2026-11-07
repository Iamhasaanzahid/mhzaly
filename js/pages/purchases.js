/* ============================================================
   mhzaly — Purchases
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast } from '../ui.js';

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Purchases</h2>
        <p>Record supplier purchases and update stock.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" id="addPurchaseBtn">${icon('plus')} Record Purchase</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-pad">
        <table style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left">Product</th>
              <th style="text-align:left">Supplier</th>
              <th style="text-align:right">Qty</th>
              <th style="text-align:right">Cost</th>
              <th style="text-align:left">Date</th>
            </tr>
          </thead>
          <tbody id="purchaseTableBody"></tbody>
        </table>
      </div>
    </div>`;

  function renderTable() {
    root.querySelector('#purchaseTableBody').innerHTML = db.purchases.slice().reverse().map((p) => `
      <tr>
        <td>${esc(p.productName)}</td>
        <td>${esc(p.supplierName || '')}</td>
        <td style="text-align:right">${esc(p.qty)}</td>
        <td style="text-align:right">Rs ${Number(p.totalCost || 0).toLocaleString()}</td>
        <td>${new Date(p.createdAt).toLocaleDateString('en-GB')}</td>
      </tr>`).join('');
  }
  renderTable();

  root.querySelector('#addPurchaseBtn').addEventListener('click', () => {
    const productName = prompt('Product name:');
    if (!productName) return;
    const supplier = prompt('Supplier name:') || '';
    const qty = Number(prompt('Quantity:') || 0);
    const cost = Number(prompt('Cost per unit (Rs):') || 0);
    db.purchases.push({
      id: uid('pur'),
      productName,
      supplierName: supplier,
      qty,
      totalCost: qty * cost,
      createdAt: new Date().toISOString(),
    });
    const prod = db.products.find((x) => x.name === productName);
    if (prod) prod.stock = (prod.stock || 0) + qty;
    save();
    renderTable();
    toast('Purchase recorded');
  });
}
