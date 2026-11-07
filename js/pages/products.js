/* ============================================================
   Products / Inventory
   ============================================================ */

import { db, save, uid, getProduct, categories, lowStockProducts } from '../db.js';
import {
  icon, esc, fmtMoney, fmtQty, toast, refresh, openModal, closeModal,
  confirmDialog, downloadFile, toCSV, productStockBadge, emptyState,
} from '../ui.js';

export const meta = { title: 'Products', subtitle: 'Your inventory, prices and stock levels' };

let query = '';
let category = '';

const UNITS = ['pcs', 'kg', 'gram', 'ltr', 'ml', 'pack', 'dozen', 'bottle', 'box', 'bag'];

function productForm(product = null) {
  const p = product || { name: '', sku: '', category: '', unit: 'pcs', cost: '', price: '', stock: '', lowStock: db.settings.lowStock };
  const cats = categories();
  return `
    <form id="productForm" autocomplete="off">
      <div class="form-grid">
        <div class="field full">
          <label>Product name *</label>
          <input class="input" name="name" required placeholder="e.g. Basmati Rice 1kg" value="${esc(p.name)}" />
        </div>
        <div class="field">
          <label>Barcode / SKU</label>
          <input class="input" name="sku" placeholder="Scan or type code" value="${esc(p.sku || '')}" />
          <span class="hint">Barcode scanners work here.</span>
        </div>
        <div class="field">
          <label>Category</label>
          <input class="input" name="category" list="catList" placeholder="e.g. Grocery" value="${esc(p.category || '')}" />
          <datalist id="catList">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        </div>
        <div class="field">
          <label>Unit</label>
          <select class="select" name="unit">
            ${UNITS.map((u) => `<option value="${u}" ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Low stock alert at</label>
          <input class="input" name="lowStock" type="number" min="0" step="any" value="${esc(p.lowStock ?? 5)}" />
        </div>
        <div class="field">
          <label>Purchase price (cost) *</label>
          <input class="input" name="cost" type="number" min="0" step="any" required value="${esc(p.cost)}" placeholder="0" />
        </div>
        <div class="field">
          <label>Selling price *</label>
          <input class="input" name="price" type="number" min="0" step="any" required value="${esc(p.price)}" placeholder="0" />
        </div>
        <div class="field full">
          <label>Stock quantity</label>
          <input class="input" name="stock" type="number" min="0" step="any" value="${esc(p.stock)}" placeholder="0" />
          <span class="hint">You can change this later with the stock adjust button.</span>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn">${product ? 'Save changes' : 'Add product'}</button>
      </div>
    </form>`;
}

export function openProductModal(product = null) {
  const modal = openModal({
    title: product ? 'Edit product' : 'Add product',
    subtitle: product ? product.name : 'Create a new item in your inventory',
    body: productForm(product),
  });
  const form = modal.querySelector('#productForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const price = Number(fd.get('price'));
    const cost = Number(fd.get('cost'));
    if (!name) return toast('Product name is required', 'error');
    if (!Number.isFinite(price) || price < 0) return toast('Enter a valid selling price', 'error');
    if (!Number.isFinite(cost) || cost < 0) return toast('Enter a valid purchase price', 'error');

    const data = {
      name,
      sku: String(fd.get('sku') || '').trim(),
      category: String(fd.get('category') || '').trim(),
      unit: String(fd.get('unit') || 'pcs'),
      cost,
      price,
      stock: Number(fd.get('stock')) || 0,
      lowStock: Number(fd.get('lowStock')) || 0,
      updatedAt: new Date().toISOString(),
    };

    if (product) {
      Object.assign(product, data);
      toast('Product updated');
    } else {
      db.products.push({ id: uid('prd'), createdAt: new Date().toISOString(), ...data });
      toast('Product added');
    }
    save();
    closeModal();
    refresh();
  });
}

function stockModal(product) {
  const modal = openModal({
    title: 'Adjust stock',
    subtitle: product.name,
    body: `
      <form id="stockForm">
        <div class="stat-strip" style="margin-bottom:16px">
          <div><div class="lbl">Current stock</div><div class="val">${fmtQty(product.stock)} ${esc(product.unit)}</div></div>
          <div><div class="lbl">Low stock alert</div><div class="val">${fmtQty(product.lowStock)}</div></div>
          <div><div class="lbl">Stock value</div><div class="val">${fmtMoney(Number(product.stock) * Number(product.cost))}</div></div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Action</label>
            <select class="select" name="mode">
              <option value="add">Add stock (+)</option>
              <option value="remove">Remove stock (−)</option>
              <option value="set">Set exact stock</option>
            </select>
          </div>
          <div class="field">
            <label>Quantity</label>
            <input class="input" name="qty" type="number" min="0" step="any" required placeholder="0" />
          </div>
          <div class="field full">
            <label>Note (optional)</label>
            <input class="input" name="note" placeholder="e.g. Received from supplier" />
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn">Update stock</button>
        </div>
      </form>`,
  });
  modal.querySelector('#stockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mode = fd.get('mode');
    const qty = Number(fd.get('qty'));
    if (!Number.isFinite(qty) || qty < 0) return toast('Enter a valid quantity', 'error');
    let next = Number(product.stock) || 0;
    if (mode === 'add') next += qty;
    else if (mode === 'remove') next -= qty;
    else next = qty;
    if (next < 0) return toast('Stock cannot go below zero', 'error');
    product.stock = next;
    product.updatedAt = new Date().toISOString();
    save();
    closeModal();
    toast(`Stock updated to ${fmtQty(next)} ${product.unit}`);
    refresh();
  });
}

export function render(root) {
  // Deep-link: #/products?new=1 opens the add form
  const wantsNew = location.hash.includes('new=1');
  if (wantsNew) history.replaceState(null, '', '#/products');

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Products</h2>
        <p>${db.products.length} item${db.products.length === 1 ? '' : 's'} in inventory${lowStockProducts().length ? ` · ${lowStockProducts().length} need restocking` : ''}</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="exportProducts">${icon('download')} Export CSV</button>
        <button class="btn" id="addProduct">${icon('plus')} Add product</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="search-wrap">
          ${icon('search')}
          <input class="input" id="prodSearch" placeholder="Search name, SKU or category…" value="${esc(query)}" />
        </div>
        <select class="select" id="catFilter" style="width:auto;min-width:150px">
          <option value="">All categories</option>
          ${categories()
            .map((c) => `<option value="${esc(c)}" ${c === category ? 'selected' : ''}>${esc(c)}</option>`)
            .join('')}
        </select>
        <div class="right"><span class="hint" id="prodCount"></span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Product</th><th>Category</th><th class="th-right">Cost</th><th class="th-right">Price</th>
              <th>Stock</th><th class="th-right">Actions</th>
            </tr>
          </thead>
          <tbody id="prodBody"></tbody>
        </table>
      </div>
    </div>`;

  const body = root.querySelector('#prodBody');
  const count = root.querySelector('#prodCount');

  function visible() {
    const q = query.trim().toLowerCase();
    return db.products
      .filter((p) => (category ? p.category === category : true))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          String(p.sku || '').toLowerCase().includes(q) ||
          String(p.category || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderRows() {
    const list = visible();
    count.textContent = `${list.length} shown`;
    if (!list.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="6">
        ${db.products.length ? 'No product matches your search.' : 'No products yet — add your first item to start selling.'}
      </td></tr>`;
      return;
    }
    body.innerHTML = list
      .map((p) => {
        const margin = Number(p.price) - Number(p.cost);
        return `<tr>
          <td>
            <div class="cell-title">${esc(p.name)}</div>
            <div class="cell-sub">${p.sku ? 'SKU ' + esc(p.sku) : 'No SKU'} · ${esc(p.unit || 'pcs')}</div>
          </td>
          <td>${p.category ? `<span class="badge">${esc(p.category)}</span>` : '<span class="muted">—</span>'}</td>
          <td class="num muted">${fmtMoney(p.cost)}</td>
          <td class="num strong">${fmtMoney(p.price)}<div class="cell-sub ${margin >= 0 ? 'text-green' : 'text-red'}">${margin >= 0 ? '+' : ''}${fmtMoney(margin)}</div></td>
          <td>${productStockBadge(p)}</td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" data-action="adjust" data-id="${p.id}" title="Adjust stock">${icon('arrow-up')}</button>
              <button class="icon-btn" data-action="edit" data-id="${p.id}" title="Edit">${icon('edit')}</button>
              <button class="icon-btn danger" data-action="delete" data-id="${p.id}" title="Delete">${icon('trash')}</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');
  }

  renderRows();

  root.querySelector('#prodSearch').addEventListener('input', (e) => {
    query = e.target.value;
    renderRows();
  });
  root.querySelector('#catFilter').addEventListener('change', (e) => {
    category = e.target.value;
    renderRows();
  });
  root.querySelector('#addProduct').addEventListener('click', () => openProductModal());

  root.querySelector('#exportProducts').addEventListener('click', () => {
    const rows = visible().map((p) => [
      p.name, p.sku || '', p.category || '', p.unit || '', p.cost, p.price, p.stock, p.lowStock,
    ]);
    if (!rows.length) return toast('Nothing to export', 'warn');
    const csv = toCSV(['Name', 'SKU', 'Category', 'Unit', 'Cost', 'Price', 'Stock', 'Low stock alert'], rows);
    downloadFile(`products-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    toast('Products exported');
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const product = getProduct(btn.dataset.id);
    if (!product) return;
    if (btn.dataset.action === 'edit') openProductModal(product);
    if (btn.dataset.action === 'adjust') stockModal(product);
    if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog({
        title: 'Delete product?',
        message: `"${product.name}" will be removed from your inventory. Previous sales will not be affected.`,
        confirmText: 'Delete product',
        danger: true,
      });
      if (!ok) return;
      db.products = db.products.filter((p) => p.id !== product.id);
      save();
      toast('Product deleted');
      refresh();
    }
  });

  if (wantsNew) openProductModal();
}
