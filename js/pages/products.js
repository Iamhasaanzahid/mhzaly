/* ============================================================
   mhzaly — Products
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast, openModal, confirmDialog, downloadFile } from '../ui.js';
import { money } from '../receipt-share.js';
import { parseCsv, toCsv, readFileText } from '../csv.js';
import { isPharmacy, expiryBadge, productBatches, nearestBatch, productExpiryState, addBatch, removeBatch, writeOffBatch, syncLegacyBatch, ensureBatchesFromLegacy } from '../pharmacy.js';

const CSV_TEMPLATE = `Name,Category,SKU,Unit,Cost,Price,Stock,Low Stock,Salt,Batch,Expiry,Manufacturer,Rack,Rx
Basmati Rice 1kg,Grocery,1002,kg,230,280,10,10,,,,,
Panadol 500mg (Strip),Pain Relief,4001,strip,25,35,20,20,Paracetamol 500mg,B-2291,2027-12-31,GSK,A-3,No
`;

const HEADER_ALIASES = {
  name: ['name', 'product name', 'product', 'item', 'item name'],
  category: ['category', 'group', 'type'],
  sku: ['sku', 'code', 'barcode', 'item code', 'product code'],
  unit: ['unit', 'uom', 'measure'],
  cost: ['cost', 'cost price', 'purchase price', 'buy price', 'purchase rate'],
  price: ['price', 'sale price', 'selling price', 'retail price', 'mrp', 'rate'],
  stock: ['stock', 'qty', 'quantity', 'inventory', 'stock qty'],
  lowStock: ['low stock', 'low', 'alert', 'min stock', 'minimum stock', 'reorder level'],
  salt: ['salt', 'formula', 'composition', 'generic', 'generic name', 'salt name'],
  batch: ['batch', 'batch no', 'batch number', 'lot', 'lot no', 'lot number'],
  expiry: ['expiry', 'expiry date', 'exp date', 'exp', 'expires', 'expire date'],
  manufacturer: ['manufacturer', 'company', 'brand', 'mfr'],
  rack: ['rack', 'shelf', 'location', 'shelf no'],
  rx: ['rx', 'prescription', 'prescription required', 'schedule'],
};

function normalizeDate(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    const d = Number(a);
    const mo = Number(b);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return v;
}

function normHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function headerKey(header) {
  const h = normHeader(header);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(h)) return key;
  }
  return null;
}

function importProducts(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV mein header aur kam az kam ek product row honi chahiye');

  const headers = rows[0].map(headerKey);
  if (!headers.includes('name')) throw new Error('CSV mein "Name" column zaroori hai');

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const row of rows.slice(1)) {
    const data = {};
    headers.forEach((key, i) => {
      if (key) data[key] = String(row[i] ?? '').trim();
    });

    const name = data.name || '';
    if (!name) { skipped += 1; continue; }

    const price = data.price === undefined || data.price === '' ? null : Number(data.price);
    const cost = data.cost === undefined || data.cost === '' ? null : Number(data.cost);
    const stock = data.stock === undefined || data.stock === '' ? null : Number(data.stock);
    const lowStock = data.lowStock === undefined || data.lowStock === '' ? null : Number(data.lowStock);
    const sku = data.sku || '';

    const existing = sku
      ? db.products.find((p) => String(p.sku || '').toLowerCase() === sku.toLowerCase())
      : db.products.find((p) => String(p.name || '').toLowerCase() === name.toLowerCase());

    if (existing) {
      existing.name = name;
      if (data.category) existing.category = data.category;
      if (sku) existing.sku = sku;
      if (data.unit) existing.unit = data.unit;
      if (cost !== null && Number.isFinite(cost) && cost >= 0) existing.cost = cost;
      if (price !== null && Number.isFinite(price) && price > 0) existing.price = price;
      if (stock !== null && Number.isFinite(stock) && stock >= 0) existing.stock = stock;
      if (lowStock !== null && Number.isFinite(lowStock) && lowStock >= 0) existing.lowStock = lowStock;
      if (data.salt) existing.salt = data.salt;
      if (data.batch) existing.batch = data.batch;
      if (data.expiry) existing.expiry = normalizeDate(data.expiry);
      if (data.manufacturer) existing.manufacturer = data.manufacturer;
      if (data.rack) existing.rack = data.rack;
      if (data.rx !== undefined) existing.rx = /^(1|true|yes|y|rx)$/i.test(data.rx);
      existing.updatedAt = now;
      updated += 1;
      continue;
    }

    if (price === null || !Number.isFinite(price) || price <= 0) { skipped += 1; continue; }

    const newProduct = {
      id: uid('prd'),
      name,
      category: data.category || 'General',
      sku: sku || `SKU-${Date.now()}-${added + 1}`,
      unit: data.unit || 'pcs',
      cost: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : 0,
      price,
      stock: stock !== null && Number.isFinite(stock) && stock >= 0 ? stock : 0,
      lowStock: lowStock !== null && Number.isFinite(lowStock) && lowStock >= 0 ? lowStock : Number(db.settings.lowStock) || 5,
      salt: data.salt || '',
      batch: data.batch || '',
      expiry: normalizeDate(data.expiry),
      manufacturer: data.manufacturer || '',
      rack: data.rack || '',
      rx: /^(1|true|yes|y|rx)$/i.test(data.rx || ''),
      createdAt: now,
      updatedAt: now,
    };
    if ((newProduct.batch || newProduct.expiry) && newProduct.stock > 0) {
      newProduct.batches = [{
        id: uid('bat'),
        batch: newProduct.batch,
        expiry: newProduct.expiry,
        qty: newProduct.stock,
        cost: newProduct.cost,
        receivedAt: now,
      }];
    }
    db.products.push(newProduct);
    added += 1;
  }

  if (added || updated) save();
  return { added, updated, skipped };
}

export function render(root) {
  const pharmacy = isPharmacy();
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Products</h2>
        <p>Add, edit and manage your inventory. Bulk CSV import bhi available hai.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="importProducts">${icon('upload')} Import CSV</button>
        <button class="btn btn-ghost" id="exportProducts">${icon('download')} Export CSV</button>
        <button class="btn btn-primary" id="addProductBtn">${icon('plus')} Add Product</button>
      </div>
    </div>

    <div class="stat-strip" id="productStats"></div>

    <div class="card mt">
      <div class="card-pad">
        <div class="filter-row">
          <div class="field grow">
            <label>Search</label>
            <input class="input" id="productSearch" placeholder="${pharmacy ? 'Name, salt, batch, SKU or category' : 'Name, SKU or category'}" />
          </div>
          <div class="field">
            <label>Category</label>
            <select class="input" id="productCategory"></select>
          </div>
          <div class="field">
            <label>Sort</label>
            <select class="input" id="productSort">
              <option value="name">Name A–Z</option>
              <option value="stock-asc">Stock low → high</option>
              <option value="stock-desc">Stock high → low</option>
              <option value="price-desc">Price high → low</option>
              <option value="margin-desc">Margin high → low</option>
              ${pharmacy ? '<option value="expiry">Expiry soon</option>' : ''}
            </select>
          </div>
          <label class="check-inline">
            <input type="checkbox" id="lowOnly" />
            <span>Low stock only</span>
          </label>
          ${pharmacy ? `<label class="check-inline">
            <input type="checkbox" id="expiryOnly" />
            <span>Expiring ≤ 90 days</span>
          </label>` : ''}
        </div>
        <div class="table-wrap">
          <table style="width:100%;margin-top:10px">
            <thead>
              <tr>
                <th style="text-align:left">Name</th>
                <th style="text-align:left">Category</th>
                ${pharmacy ? `<th style="text-align:left">Salt / Formula</th>
                <th style="text-align:right">Batch</th>
                <th style="text-align:right">Expiry</th>` : ''}
                <th style="text-align:right">SKU</th>
                <th style="text-align:right">Cost</th>
                <th style="text-align:right">Price</th>
                <th style="text-align:right">Stock</th>
                <th style="text-align:right">Low</th>
                <th style="width:180px"></th>
              </tr>
            </thead>
            <tbody id="productTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const searchEl = root.querySelector('#productSearch');
  const categoryEl = root.querySelector('#productCategory');
  const sortEl = root.querySelector('#productSort');
  const lowOnlyEl = root.querySelector('#lowOnly');
  const expiryOnlyEl = root.querySelector('#expiryOnly');
  const statsEl = root.querySelector('#productStats');
  const money0 = (n) => money(Number(n) || 0);

  function paintStats() {
    if (!statsEl) return;
    const totalStock = db.products.reduce((a, p) => a + (Number(p.stock) || 0), 0);
    const costValue = db.products.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.cost) || 0), 0);
    const retailValue = db.products.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.price) || 0), 0);
    const out = db.products.filter((p) => (Number(p.stock) || 0) <= 0).length;
    const nearExpiry = pharmacy
      ? db.products.filter((p) => {
          const exp = productExpiryState(p);
          return exp.state === 'expired' || (exp.days !== null && exp.days <= 90);
        }).length
      : 0;
    statsEl.innerHTML = `
      <div><div class="lbl">Products</div><div class="val">${db.products.length}</div></div>
      <div><div class="lbl">Stock units</div><div class="val">${totalStock}</div></div>
      <div><div class="lbl">Inventory cost</div><div class="val">${money0(costValue)}</div></div>
      <div><div class="lbl">Retail value</div><div class="val">${money0(retailValue)}</div></div>
      <div><div class="lbl">Potential profit</div><div class="val text-ok">${money0(retailValue - costValue)}</div></div>
      <div><div class="lbl">Out of stock</div><div class="val ${out ? 'text-warn' : ''}">${out}</div></div>
      ${pharmacy ? `<div><div class="lbl">Expiry alerts</div><div class="val ${nearExpiry ? 'text-warn' : ''}">${nearExpiry}</div></div>` : ''}`;
  }

  function fillCategories() {
    const current = categoryEl.value || 'all';
    const categories = [...new Set(db.products.map((p) => p.category || 'General'))].sort((a, b) => a.localeCompare(b));
    categoryEl.innerHTML = `<option value="all">All categories</option>${categories
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join('')}`;
    categoryEl.value = categories.includes(current) ? current : 'all';
  }

  function renderTable() {
    const q = String(searchEl.value || '').toLowerCase().trim();
    const category = categoryEl.value || 'all';
    const lowOnly = lowOnlyEl.checked;
    const expiryOnly = !!(pharmacy && expiryOnlyEl && expiryOnlyEl.checked);
    const filtered = db.products.filter((p) => {
      const batches = productBatches(p);
      const matchesQuery =
        !q ||
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.sku || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q) ||
        String(p.salt || '').toLowerCase().includes(q) ||
        String(p.manufacturer || '').toLowerCase().includes(q) ||
        batches.some((b) => String(b.batch || '').toLowerCase().includes(q));
      const matchesCategory = category === 'all' || (p.category || 'General') === category;
      const isLow = (p.stock ?? 0) <= (p.lowStock ?? 5);
      const exp = pharmacy ? productExpiryState(p) : null;
      const matchesExpiry = !expiryOnly || (exp && (exp.state === 'expired' || (exp.days !== null && exp.days <= 90)));
      return matchesQuery && matchesCategory && (!lowOnly || isLow) && matchesExpiry;
    });

    const sort = sortEl ? sortEl.value : 'name';
    const margin = (p) => {
      const price = Number(p.price) || 0;
      return price > 0 ? ((price - (Number(p.cost) || 0)) / price) * 100 : 0;
    };
    filtered.sort((a, b) => {
      if (sort === 'stock-asc') return (Number(a.stock) || 0) - (Number(b.stock) || 0) || String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'stock-desc') return (Number(b.stock) || 0) - (Number(a.stock) || 0) || String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'price-desc') return (Number(b.price) || 0) - (Number(a.price) || 0);
      if (sort === 'margin-desc') return margin(b) - margin(a);
      if (sort === 'expiry' && pharmacy) {
        const ea = productExpiryState(a);
        const eb = productExpiryState(b);
        return (ea.days ?? 99999) - (eb.days ?? 99999);
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    paintStats();

    if (!filtered.length) {
      root.querySelector('#productTableBody').innerHTML = `
        <tr><td colspan="${pharmacy ? 11 : 8}"><div class="empty-state">Koi product nahi mila. Filter change karein ya naya product add karein.</div></td></tr>`;
      return;
    }

    root.querySelector('#productTableBody').innerHTML = filtered
      .map((p) => {
        const low = (p.stock ?? 0) <= (p.lowStock ?? 5);
        const batches = productBatches(p);
        const nb = nearestBatch(p);
        const marginPct = Number(p.price) > 0
          ? Math.round(((Number(p.price) - (Number(p.cost) || 0)) / Number(p.price)) * 100)
          : 0;
        return `
      <tr>
        <td><b>${esc(p.name)}</b></td>
        <td>${esc(p.category || '')}</td>
        ${pharmacy ? `<td>${esc(p.salt || '')}</td>
        <td style="text-align:right"><span class="mono">${esc(nb ? nb.batch : '')}</span>${batches.length > 1 ? ` <span class="badge">${batches.length}</span>` : ''}</td>
        <td style="text-align:right">${expiryBadge(nb ? nb.expiry : '')}</td>` : ''}
        <td style="text-align:right"><span class="mono">${esc(p.sku || '')}</span></td>
        <td style="text-align:right">${money(p.cost)}</td>
        <td style="text-align:right">${money(p.price)}<div class="pos-meta ${marginPct < 0 ? 'text-warn' : ''}">${marginPct}% margin</div></td>
        <td style="text-align:right">${low ? `<span class="badge ${(p.stock ?? 0) === 0 ? 'danger' : 'warn'}">${esc(p.stock || 0)}</span>` : esc(p.stock || 0)}</td>
        <td style="text-align:right">${esc(p.lowStock || 5)}</td>
        <td style="text-align:right">
          ${pharmacy ? `<button class="btn btn-ghost btn-sm" data-batches="${esc(p.id)}" title="Batches">${icon('bag')}</button>
          <button class="btn btn-ghost btn-sm" data-writeoff="${esc(p.id)}" title="Expiry write-off">${icon('alert')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}" title="Edit">${icon('settings')}</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(p.id)}" title="Delete">${icon('trash')}</button>
        </td>
      </tr>`;
      })
      .join('');
  }

  fillCategories();

  const paletteSearch = sessionStorage.getItem('mhzaly_product_search');
  if (paletteSearch) {
    sessionStorage.removeItem('mhzaly_product_search');
    searchEl.value = paletteSearch;
  }
  if (sessionStorage.getItem('mhzaly_product_low')) {
    sessionStorage.removeItem('mhzaly_product_low');
    lowOnlyEl.checked = true;
  }
  if (expiryOnlyEl && sessionStorage.getItem('mhzaly_product_expiry')) {
    sessionStorage.removeItem('mhzaly_product_expiry');
    expiryOnlyEl.checked = true;
  }
  const addFromPalette = sessionStorage.getItem('mhzaly_add_product');
  if (addFromPalette) sessionStorage.removeItem('mhzaly_add_product');

  renderTable();
  searchEl.addEventListener('input', renderTable);
  categoryEl.addEventListener('change', renderTable);
  if (sortEl) sortEl.addEventListener('change', renderTable);
  lowOnlyEl.addEventListener('change', renderTable);
  if (expiryOnlyEl) expiryOnlyEl.addEventListener('change', renderTable);
  if (addFromPalette) setTimeout(() => openProductForm(null), 80);

  function openProductForm(existing) {
    const p = existing || {};
    const isEdit = !!existing;

    openModal({
      title: isEdit ? 'Edit product' : 'Add product',
      subtitle: isEdit ? p.name : 'Naya product inventory mein add karein',
      body: `
        <div class="owner-form-grid">
          <label style="grid-column:1/-1">Product name
            <input id="pfName" value="${esc(p.name || '')}" placeholder="e.g. Basmati Rice 1kg" />
          </label>
          <label>Category
            <input id="pfCategory" value="${esc(p.category || 'General')}" placeholder="Grocery" />
          </label>
          <label>SKU
            <input id="pfSku" value="${esc(p.sku || '')}" placeholder="optional" />
          </label>
          <label>Cost price (${esc(db.settings.currency || 'Rs')})
            <input id="pfCost" type="number" min="0" step="0.01" value="${p.cost ?? 0}" />
          </label>
          <label>Selling price (${esc(db.settings.currency || 'Rs')})
            <input id="pfPrice" type="number" min="0" step="0.01" value="${p.price ?? 0}" />
          </label>
          <label>Stock
            <input id="pfStock" type="number" min="0" step="1" value="${p.stock ?? 0}" />
          </label>
          <label>Low stock alert
            <input id="pfLow" type="number" min="0" step="1" value="${p.lowStock ?? 5}" />
          </label>
          <label>Unit
            <input id="pfUnit" value="${esc(p.unit || 'pcs')}" placeholder="pcs / kg / pack" />
          </label>
          ${pharmacy ? `
          <div style="grid-column:1/-1;margin-top:4px"><b class="small">Pharmacy details</b> <span class="hint">— salt, batch aur expiry bharein. Multiple batches ke liye product row ka Batches button use karein.</span></div>
          <label style="grid-column:1/-1">Salt / Formula
            <input id="pfSalt" value="${esc(p.salt || '')}" placeholder="e.g. Paracetamol 500mg" />
          </label>
          <label>Manufacturer
            <input id="pfManufacturer" value="${esc(p.manufacturer || '')}" placeholder="e.g. GSK" />
          </label>
          <label>Batch no
            <input id="pfBatch" value="${esc(p.batch || '')}" placeholder="e.g. B-2291" />
          </label>
          <label>Expiry date
            <input id="pfExpiry" type="date" value="${esc(p.expiry || '')}" />
          </label>
          <label>Rack / shelf
            <input id="pfRack" value="${esc(p.rack || '')}" placeholder="e.g. A-3" />
          </label>
          <label class="check-inline" style="align-self:end;padding-bottom:8px">
            <input type="checkbox" id="pfRx" ${p.rx ? 'checked' : ''} />
            <span>Prescription (Rx) required</span>
          </label>` : ''}
        </div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
               <button class="btn btn-primary" id="pfSave">${icon('check')} ${isEdit ? 'Save changes' : 'Add product'}</button>`,
      onMount: (bd) => {
        bd.querySelector('[data-cancel]').addEventListener('click', () => bd.remove());
        const doSave = () => {
          const name = bd.querySelector('#pfName').value.trim();
          const price = Number(bd.querySelector('#pfPrice').value || 0);
          const cost = Number(bd.querySelector('#pfCost').value || 0);
          const stock = Number(bd.querySelector('#pfStock').value || 0);
          const low = Number(bd.querySelector('#pfLow').value || 5);
          if (!name) return toast('Product ka naam likhein', 'error');
          if (price <= 0) return toast('Selling price 0 se zyada honi chahiye', 'error');

          const data = {
            name,
            category: bd.querySelector('#pfCategory').value.trim() || 'General',
            sku: bd.querySelector('#pfSku').value.trim() || `SKU-${Date.now()}`,
            unit: bd.querySelector('#pfUnit').value.trim() || 'pcs',
            cost,
            price,
            stock,
            lowStock: low,
            ...(pharmacy ? {
              salt: bd.querySelector('#pfSalt')?.value.trim() || '',
              manufacturer: bd.querySelector('#pfManufacturer')?.value.trim() || '',
              batch: bd.querySelector('#pfBatch')?.value.trim() || '',
              expiry: bd.querySelector('#pfExpiry')?.value || '',
              rack: bd.querySelector('#pfRack')?.value.trim() || '',
              rx: !!bd.querySelector('#pfRx')?.checked,
            } : {}),
            updatedAt: new Date().toISOString(),
          };

          const now = new Date().toISOString();
          if (pharmacy && (data.batch || data.expiry) && stock > 0) {
            const hasBatches = Array.isArray(p.batches) && p.batches.length > 0;
            if (!isEdit || !hasBatches) {
              data.batches = [{
                id: uid('bat'),
                batch: data.batch,
                expiry: data.expiry,
                qty: stock,
                cost,
                receivedAt: now,
              }];
            }
          }

          if (isEdit) {
            Object.assign(p, data);
            syncLegacyBatch(p);
            toast('Product updated', 'success');
          } else {
            db.products.push({ id: uid('prd'), createdAt: now, ...data });
            toast('Product added', 'success');
          }
          save();
          fillCategories();
          renderTable();
          bd.remove();
        };
        bd.querySelector('#pfSave').addEventListener('click', doSave);
        bd.querySelector('#pfName').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') doSave();
        });
        setTimeout(() => bd.querySelector('#pfName').focus(), 60);
      },
    });
  }

  function ensureLegacyBatch(p) {
    ensureBatchesFromLegacy(p);
  }

  function openBatches(p) {
    ensureLegacyBatch(p);
    const batches = productBatches(p);
    const total = batches.reduce((a, b) => a + b.qty, 0);
    const stock = Number(p.stock) || 0;

    openModal({
      title: `${p.name} — Batches`,
      subtitle: 'FEFO: sab se pehle expire hone wala batch pehle sale hoga',
      body: `
        <div class="table-wrap">
          <table style="width:100%">
            <thead><tr><th style="text-align:left">Batch</th><th style="text-align:right">Expiry</th><th style="text-align:right">Qty</th><th style="text-align:right">Cost</th><th style="width:50px"></th></tr></thead>
            <tbody>
              ${batches.length ? batches.map((b) => `<tr>
                <td><span class="mono">${esc(b.batch || '—')}</span></td>
                <td style="text-align:right">${expiryBadge(b.expiry)}</td>
                <td style="text-align:right">${esc(b.qty)}</td>
                <td style="text-align:right">${money(b.cost)}</td>
                <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-del-batch="${esc(b.id)}" title="Delete batch">${icon('trash')}</button></td>
              </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">Koi batch nahi. Neeche se pehla batch add karein.</div></td></tr>`}
            </tbody>
          </table>
        </div>
        ${total !== stock ? `<div class="alert-box mt" style="background:#fffbeb;border-color:#f59e0b;color:#92400e">${icon('alert')}<div>Batch total <b>${total}</b> hai lekin product stock <b>${stock}</b> hai. Stock adjust karein ya batch qty theek karein.</div></div>` : ''}
        <div class="owner-form-grid mt">
          <label>Batch no
            <input id="bBatch" placeholder="e.g. B-2291" />
          </label>
          <label>Expiry date
            <input id="bExpiry" type="date" />
          </label>
          <label>Quantity
            <input id="bQty" type="number" min="1" step="1" value="1" />
          </label>
          <label>Cost per unit (${esc(db.settings.currency || 'Rs')})
            <input id="bCost" type="number" min="0" step="0.01" value="${Number(p.cost) || 0}" />
          </label>
        </div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Close</button>
               <button class="btn btn-primary" id="batchAdd">${icon('plus')} Add batch</button>`,
      onMount: (bd) => {
        bd.querySelector('[data-cancel]').addEventListener('click', () => bd.remove());
        bd.querySelectorAll('[data-del-batch]').forEach((btn) => btn.addEventListener('click', () => {
          const b = batches.find((x) => x.id === btn.dataset.delBatch);
          if (!b) return;
          confirmDialog(`Batch "${b.batch || '—'}" delete karein? ${b.qty} units stock se kam ho jayengi.`, () => {
            removeBatch(p, b.id);
            save();
            bd.remove();
            renderTable();
            openBatches(p);
            toast('Batch delete ho gaya', 'success');
          });
        }));
        bd.querySelector('#batchAdd').addEventListener('click', () => {
          const batch = bd.querySelector('#bBatch').value.trim();
          const expiry = bd.querySelector('#bExpiry').value;
          const qty = Number(bd.querySelector('#bQty').value || 0);
          const cost = Number(bd.querySelector('#bCost').value || 0);
          if (!batch) return toast('Batch number likhein', 'error');
          if (!expiry) return toast('Expiry date chunein', 'error');
          if (qty <= 0) return toast('Quantity 0 se zyada likhein', 'error');
          addBatch(p, { batch, expiry, qty, cost });
          save();
          bd.remove();
          renderTable();
          openBatches(p);
          toast('Batch add ho gaya', 'success');
        });
      },
    });
  }

  function openWriteOff(p) {
    ensureLegacyBatch(p);
    const batches = productBatches(p);
    if (!batches.length) return toast('Pehle batch add karein', 'error');

    openModal({
      title: `${p.name} — Expiry write-off`,
      subtitle: 'Expired / damaged stock ko stock se kam karein',
      body: `
        <div class="owner-form-grid">
          <label style="grid-column:1/-1">Batch
            <select id="woBatch">
              ${batches.map((b) => `<option value="${esc(b.id)}">${esc(b.batch || '—')} · ${esc(b.expiry || 'no expiry')} · ${b.qty} units</option>`).join('')}
            </select>
          </label>
          <label>Quantity to write off
            <input id="woQty" type="number" min="1" step="1" value="1" />
          </label>
          <label>Reason
            <select id="woReason">
              <option value="Expired">Expired</option>
              <option value="Damaged">Damaged</option>
              <option value="Supplier return">Supplier return</option>
              <option value="Other">Other</option>
            </select>
          </label>
        </div>
        <p class="hint mt">Write-off "Expiry loss" expense mein record hoga, taake profit report sahi rahe.</p>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
               <button class="btn btn-primary" id="woSave">${icon('check')} Write off</button>`,
      onMount: (bd) => {
        const sel = bd.querySelector('#woBatch');
        const qtyEl = bd.querySelector('#woQty');
        const syncMax = () => {
          const b = batches.find((x) => x.id === sel.value);
          qtyEl.max = b ? b.qty : 1;
          qtyEl.value = b ? Math.min(Number(qtyEl.value) || 1, b.qty) : 1;
        };
        sel.addEventListener('change', syncMax);
        syncMax();
        bd.querySelector('[data-cancel]').addEventListener('click', () => bd.remove());
        bd.querySelector('#woSave').addEventListener('click', () => {
          const b = batches.find((x) => x.id === sel.value);
          if (!b) return toast('Batch select karein', 'error');
          const qty = Math.min(Number(qtyEl.value || 0), b.qty);
          if (qty <= 0) return toast('Quantity 0 se zyada likhein', 'error');
          const reason = bd.querySelector('#woReason').value;
          const res = writeOffBatch(p, b.id, qty, reason);
          if (!res) return toast('Write-off nahi ho saka', 'error');
          if (res.loss > 0) {
            db.expenses.push({
              id: uid('exp'),
              title: `Expiry write-off: ${p.name}`,
              category: 'Expiry loss',
              amount: Math.round(res.loss * 100) / 100,
              note: `${res.qty} units · batch ${res.batch.batch || '—'} · ${reason}`,
              createdAt: new Date().toISOString(),
            });
          }
          save();
          renderTable();
          bd.remove();
          toast(`Write-off ho gaya: ${res.qty} units`, 'success');
        });
      },
    });
  }

  function openImportModal() {
    openModal({
      title: 'Import products from CSV',
      subtitle: 'Bulk add ya update — SKU/name se match hota hai',
      body: `
        <div class="alert-box" style="background:#f0fdfa;border-color:#99f6e4;color:#115e59">
          ${icon('alert')}
          <div>CSV mein <b>Name</b> aur <b>Price</b> columns zaroori hain. Baqi optional: Category, SKU, Unit, Cost, Stock, Low Stock. Same SKU ya same name wala product update ho jayega.</div>
        </div>
        <div class="import-actions mt">
          <label class="btn btn-ghost" for="csvFile">${icon('upload')} Choose CSV file</label>
          <input type="file" id="csvFile" accept=".csv,text/csv" hidden />
          <button class="btn btn-ghost" id="csvTemplate" type="button">${icon('download')} Download template</button>
          <span class="hint" id="csvFileName">No file selected</span>
        </div>
        <div class="field mt">
          <label>Or paste CSV text</label>
          <textarea class="input" id="csvText" rows="7" placeholder="Name,Category,SKU,Unit,Cost,Price,Stock,Low Stock&#10;Basmati Rice 1kg,Grocery,1002,kg,230,280,10,10"></textarea>
        </div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
               <button class="btn btn-primary" id="csvImportBtn">${icon('check')} Import products</button>`,
      onMount: (bd) => {
        const fileEl = bd.querySelector('#csvFile');
        const textEl = bd.querySelector('#csvText');
        const nameEl = bd.querySelector('#csvFileName');
        bd.querySelector('[data-cancel]').addEventListener('click', () => bd.remove());
        bd.querySelector('#csvTemplate').addEventListener('click', () => {
          downloadFile('mhzaly-products-template.csv', CSV_TEMPLATE, 'text/csv');
        });
        fileEl.addEventListener('change', async () => {
          const file = fileEl.files?.[0];
          if (!file) return;
          try {
            textEl.value = await readFileText(file);
            nameEl.textContent = file.name;
          } catch (err) {
            toast(err.message || 'File read nahi ho saki', 'error');
          }
        });
        bd.querySelector('#csvImportBtn').addEventListener('click', () => {
          const text = textEl.value.trim();
          if (!text) return toast('CSV file choose karein ya text paste karein', 'error');
          try {
            const result = importProducts(text);
            toast(`${result.added} added · ${result.updated} updated${result.skipped ? ` · ${result.skipped} skipped` : ''}`, 'success');
            fillCategories();
            renderTable();
            bd.remove();
          } catch (err) {
            toast(err.message || 'Import nahi ho saka', 'error');
          }
        });
        setTimeout(() => textEl.focus(), 80);
      },
    });
  }

  root.querySelector('#addProductBtn').addEventListener('click', () => openProductForm(null));
  root.querySelector('#importProducts').addEventListener('click', openImportModal);

  root.querySelector('#productTableBody').addEventListener('click', (e) => {
    const batchBtn = e.target.closest('[data-batches]');
    if (batchBtn) {
      const p = db.products.find((x) => x.id === batchBtn.dataset.batches);
      if (p) openBatches(p);
      return;
    }
    const woBtn = e.target.closest('[data-writeoff]');
    if (woBtn) {
      const p = db.products.find((x) => x.id === woBtn.dataset.writeoff);
      if (p) openWriteOff(p);
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const p = db.products.find((x) => x.id === editBtn.dataset.edit);
      if (p) openProductForm(p);
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      const p = db.products.find((x) => x.id === delBtn.dataset.del);
      if (!p) return;
      confirmDialog(`"${p.name}" delete karein?`, () => {
        db.products = db.products.filter((x) => x.id !== p.id);
        save();
        fillCategories();
        renderTable();
        toast('Product deleted', 'success');
      });
    }
  });

  root.querySelector('#exportProducts').addEventListener('click', () => {
    const rows = [['Name', 'Category', 'SKU', 'Unit', 'Cost', 'Price', 'Stock', 'Low Stock', ...(pharmacy ? ['Salt', 'Batch', 'Expiry', 'Manufacturer', 'Rack', 'Rx'] : [])]];
    for (const p of db.products) {
      rows.push([
        p.name,
        p.category || '',
        p.sku || '',
        p.unit || '',
        Number(p.cost) || 0,
        Number(p.price) || 0,
        Number(p.stock) || 0,
        Number(p.lowStock) || 0,
        ...(pharmacy ? [p.salt || '', p.batch || '', p.expiry || '', p.manufacturer || '', p.rack || '', p.rx ? 'Yes' : 'No'] : []),
      ]);
    }
    downloadFile(`mhzaly-products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
    toast('Products exported', 'success');
  });
}
