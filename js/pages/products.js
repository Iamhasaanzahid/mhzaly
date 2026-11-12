/* ============================================================
   mhzaly — Products
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast, openModal, confirmDialog, downloadFile } from '../ui.js';
import { money } from '../receipt-share.js';
import { parseCsv, toCsv, readFileText } from '../csv.js';

const CSV_TEMPLATE = `Name,Category,SKU,Unit,Cost,Price,Stock,Low Stock
Basmati Rice 1kg,Grocery,1002,kg,230,280,10,10
Cooking Oil 1L,Grocery,1003,ltr,420,490,10,10
Soap Bar,Household,1009,pcs,105,140,12,6
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
};

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
      existing.updatedAt = now;
      updated += 1;
      continue;
    }

    if (price === null || !Number.isFinite(price) || price <= 0) { skipped += 1; continue; }

    db.products.push({
      id: uid('prd'),
      name,
      category: data.category || 'General',
      sku: sku || `SKU-${Date.now()}-${added + 1}`,
      unit: data.unit || 'pcs',
      cost: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : 0,
      price,
      stock: stock !== null && Number.isFinite(stock) && stock >= 0 ? stock : 0,
      lowStock: lowStock !== null && Number.isFinite(lowStock) && lowStock >= 0 ? lowStock : Number(db.settings.lowStock) || 5,
      createdAt: now,
      updatedAt: now,
    });
    added += 1;
  }

  if (added || updated) save();
  return { added, updated, skipped };
}

export function render(root) {
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

    <div class="card mt">
      <div class="card-pad">
        <div class="filter-row">
          <div class="field grow">
            <label>Search</label>
            <input class="input" id="productSearch" placeholder="Name, SKU or category" />
          </div>
          <div class="field">
            <label>Category</label>
            <select class="input" id="productCategory"></select>
          </div>
          <label class="check-inline">
            <input type="checkbox" id="lowOnly" />
            <span>Low stock only</span>
          </label>
        </div>
        <div class="table-wrap">
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
      </div>
    </div>`;

  const searchEl = root.querySelector('#productSearch');
  const categoryEl = root.querySelector('#productCategory');
  const lowOnlyEl = root.querySelector('#lowOnly');

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
    const filtered = db.products.filter((p) => {
      const matchesQuery =
        !q ||
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.sku || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q);
      const matchesCategory = category === 'all' || (p.category || 'General') === category;
      const isLow = (p.stock ?? 0) <= (p.lowStock ?? 5);
      return matchesQuery && matchesCategory && (!lowOnly || isLow);
    });

    if (!filtered.length) {
      root.querySelector('#productTableBody').innerHTML = `
        <tr><td colspan="8"><div class="empty-state">Koi product nahi mila. Filter change karein ya naya product add karein.</div></td></tr>`;
      return;
    }

    root.querySelector('#productTableBody').innerHTML = filtered
      .map((p) => {
        const low = (p.stock ?? 0) <= (p.lowStock ?? 5);
        return `
      <tr>
        <td><b>${esc(p.name)}</b></td>
        <td>${esc(p.category || '')}</td>
        <td style="text-align:right"><span class="mono">${esc(p.sku || '')}</span></td>
        <td style="text-align:right">${money(p.cost)}</td>
        <td style="text-align:right">${money(p.price)}</td>
        <td style="text-align:right">${low ? `<span class="badge ${(p.stock ?? 0) === 0 ? 'danger' : 'warn'}">${esc(p.stock || 0)}</span>` : esc(p.stock || 0)}</td>
        <td style="text-align:right">${esc(p.lowStock || 5)}</td>
        <td style="text-align:right">
          <button class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}" title="Edit">${icon('settings')}</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(p.id)}" title="Delete">${icon('trash')}</button>
        </td>
      </tr>`;
      })
      .join('');
  }

  fillCategories();
  renderTable();
  searchEl.addEventListener('input', renderTable);
  categoryEl.addEventListener('change', renderTable);
  lowOnlyEl.addEventListener('change', renderTable);

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
            updatedAt: new Date().toISOString(),
          };

          if (isEdit) {
            Object.assign(p, data);
            toast('Product updated', 'success');
          } else {
            db.products.push({ id: uid('prd'), createdAt: new Date().toISOString(), ...data });
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
    const rows = [['Name', 'Category', 'SKU', 'Unit', 'Cost', 'Price', 'Stock', 'Low Stock']];
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
      ]);
    }
    downloadFile(`mhzaly-products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
    toast('Products exported', 'success');
  });
}
