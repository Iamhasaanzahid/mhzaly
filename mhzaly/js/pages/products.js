/* ============================================================
   mhzaly — Products
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast } from '../ui.js';

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Products</h2>
        <p>Add, edit and manage your inventory.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" id="addProductBtn">${icon('plus')} Add Product</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-pad">
        <div class="field mt-sm">
          <label>Search</label>
          <input class="input" id="productSearch" placeholder="Name, SKU or category" />
        </div>
        <table style="width:100%;margin-top:10px">
          <thead>
            <tr>
              <th style="text-align:left">Name</th>
              <th style="text-align:left">Category</th>
              <th style="text-align:right">SKU</th>
              <th style="text-align:right">Cost</th>
              <th style="text-align:right">Price</th>
              <th style="text-align:right">Stock</th>
              <th style="text-align:right">Low</th>
              <th style="width:120px"></th>
            </tr>
          </thead>
          <tbody id="productTableBody"></tbody>
        </table>
      </div>
    </div>`;

  function renderTable() {
    const q = String(root.querySelector('#productSearch').value || '').toLowerCase();
    const filtered = db.products.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)
    );
    root.querySelector('#productTableBody').innerHTML = filtered.map((p) => `
      <tr>
        <td>${esc(p.name)}</td>
        <td>${esc(p.category || '')}</td>
        <td style="text-align:right"><span class="mono">${esc(p.sku || '')}</span></td>
        <td style="text-align:right">Rs ${Number(p.cost || 0).toLocaleString()}</td>
        <td style="text-align:right">Rs ${Number(p.price || 0).toLocaleString()}</td>
        <td style="text-align:right">${esc(p.stock || 0)}</td>
        <td style="text-align:right">${esc(p.lowStock || 5)}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">${icon('settings')}</button></td>
      </tr>`).join('');
  }

  renderTable();
  root.querySelector('#productSearch').addEventListener('input', renderTable);

  root.querySelector('#addProductBtn').addEventListener('click', () => {
    const name = prompt('Product name:');
    if (!name) return;
    const price = Number(prompt('Selling price (Rs):') || 0);
    const cost = Number(prompt('Cost price (Rs):') || 0);
    const stock = Number(prompt('Initial stock:') || 0);
    const sku = prompt('SKU (optional):') || `SKU-${Date.now()}`;
    db.products.push({
      id: uid('prd'),
      name,
      sku,
      category: 'General',
      unit: 'pcs',
      cost,
      price,
      stock,
      lowStock: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    save();
    renderTable();
    toast('Product added');
  });

  root.querySelector('#productTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (!btn) return;
    const p = db.products.find((x) => x.id === btn.dataset.edit);
    if (!p) return;
    const name = prompt('Product name:', p.name);
    if (name === null) return;
    p.name = name;
    p.price = Number(prompt('Selling price (Rs):', p.price) || p.price);
    p.stock = Number(prompt('Stock:', p.stock) || p.stock);
    p.updatedAt = new Date().toISOString();
    save();
    renderTable();
    toast('Product updated');
  });
}
