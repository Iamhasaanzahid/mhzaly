/* ============================================================
   New Sale (POS)
   ============================================================ */

import { db, save, round2, invoiceNo, getProduct, getCustomer, categories } from '../db.js';
import {
  icon, esc, fmtMoney, fmtQty, toast, refresh, openModal, closeModal, sum,
} from '../ui.js';
import { receiptHTML, printReceipt } from '../receipt.js';

export const meta = { title: 'New Sale', subtitle: 'Scan, add items and take payment' };

let cart = [];
let customerId = '';
let method = 'Cash';
let discount = 0;
let paidManual = false;
let query = '';
let category = '';

function cartLines() {
  return cart
    .map((line) => {
      const product = getProduct(line.productId);
      return product ? { ...line, product } : null;
    })
    .filter(Boolean);
}

function totals() {
  const lines = cartLines();
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * Number(l.product.price), 0));
  const disc = Math.min(Number(discount) || 0, subtotal);
  const taxRate = Number(db.settings.taxRate) || 0;
  const tax = round2(((subtotal - disc) * taxRate) / 100);
  const total = round2(subtotal - disc + tax);
  return { lines, subtotal, disc, tax, taxRate, total };
}

function visibleProducts() {
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

function addToCart(productId) {
  const product = getProduct(productId);
  if (!product) return;
  const line = cart.find((l) => l.productId === productId);
  const inCart = line ? line.qty : 0;
  if (inCart + 1 > Number(product.stock)) {
    toast(`Only ${fmtQty(product.stock)} ${product.unit || 'pcs'} of ${product.name} in stock`, 'warn');
    return;
  }
  if (line) line.qty += 1;
  else cart.push({ productId, qty: 1 });
}

export function render(root) {
  cart = cart.filter((l) => getProduct(l.productId));
  const t = totals();
  if (!paidManual) discount = Math.min(Number(discount) || 0, t.subtotal);

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>New Sale</h2>
        <p>Search or scan a product, then tap it to add to the bill.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" data-go="products">${icon('box')} Manage products</button>
      </div>
    </div>

    <div class="pos-grid">
      <div class="card">
        <div class="card-head">
          <div class="search-wrap" style="max-width:none">
            ${icon('search')}
            <input class="input" id="posSearch" placeholder="Search product or scan barcode, then press Enter…" value="${esc(query)}" autocomplete="off" />
          </div>
        </div>
        <div class="chips" id="posChips">
          <button class="chip ${category === '' ? 'active' : ''}" data-cat="">All</button>
          ${categories()
            .map((c) => `<button class="chip ${category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
            .join('')}
        </div>
        <div class="pos-products" id="posGrid"></div>
      </div>

      <div class="pos-side">
        <div class="card cart">
          <div class="card-head">
            <h3>Current bill</h3>
            <span class="badge teal" id="cartCount">0 items</span>
            <div class="right">
              <button class="icon-btn danger" id="clearCart" title="Clear bill">${icon('trash')}</button>
            </div>
          </div>
          <div class="cart-body" id="cartBody"></div>
          <div class="cart-sum">
            <div class="field" style="gap:4px">
              <label style="font-size:11px">Customer</label>
              <select class="select input-sm" id="customerSelect">
                <option value="">Walk-in customer</option>
                ${[...db.customers]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => `<option value="${c.id}" ${c.id === customerId ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="sum-row"><span class="lbl">Subtotal</span><span id="sumSubtotal">${fmtMoney(t.subtotal)}</span></div>
            <div class="sum-row">
              <span class="lbl">Discount (${esc(db.settings.currency || 'Rs')})</span>
              <input class="input input-sm" id="discountInput" type="number" min="0" step="any" value="${discount || ''}" placeholder="0" />
            </div>
            <div class="sum-row"><span class="lbl">Tax (${t.taxRate}%)</span><span id="sumTax">${fmtMoney(t.tax)}</span></div>
            <div class="sum-row total"><span class="lbl">Total</span><span id="sumTotal">${fmtMoney(t.total)}</span></div>
            <div class="field" style="gap:4px">
              <label style="font-size:11px">Payment method</label>
              <select class="select input-sm" id="methodSelect">
                ${['Cash', 'Card', 'Bank', 'Udhaar'].map((m) => `<option ${m === method ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
            <div class="sum-row">
              <span class="lbl">Amount received</span>
              <input class="input input-sm" id="paidInput" type="number" min="0" step="any" value="${t.total}" />
            </div>
            <div class="change-line" id="changeLine" style="display:none"></div>
          </div>
          <div class="cart-foot">
            <button class="btn btn-lg btn-block" id="completeSale">${icon('check')} Complete sale · <span id="btnTotal">${fmtMoney(t.total)}</span></button>
          </div>
        </div>
      </div>
    </div>`;

  const grid = root.querySelector('#posGrid');
  const chips = root.querySelector('#posChips');
  const cartBody = root.querySelector('#cartBody');
  const count = root.querySelector('#cartCount');
  const paidInput = root.querySelector('#paidInput');

  function renderGrid() {
    const list = visibleProducts();
    if (!db.products.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="art">${icon('box')}</div>
        <h4>No products yet</h4>
        <p>Add products first, then they will show up here for billing.</p>
        <button class="btn" data-go="products">${icon('plus')} Add product</button>
      </div>`;
      return;
    }
    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:28px"><h4>No match</h4><p>Try a different search or category.</p></div>`;
      return;
    }
    grid.innerHTML = list
      .map((p) => {
        const inCart = cart.find((l) => l.productId === p.id);
        const out = Number(p.stock) <= 0;
        return `<button class="pos-card ${out ? 'out' : ''}" data-add="${p.id}" ${out ? 'disabled' : ''}>
          <div class="pc-name">${esc(p.name)}</div>
          <div class="pc-sku">${p.sku ? esc(p.sku) : esc(p.category || '')}</div>
          <div class="pc-foot">
            <span class="pc-price">${fmtMoney(p.price)}</span>
            <span class="pc-stock">${out ? 'Out' : fmtQty(p.stock) + ' ' + esc(p.unit || '')}${inCart ? ` · ${inCart.qty} in bill` : ''}</span>
          </div>
        </button>`;
      })
      .join('');
  }

  function renderChips() {
    chips.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cat === category);
    });
  }

  function renderCart() {
    const { lines, subtotal, disc, tax, total } = totals();
    count.textContent = `${lines.reduce((s, l) => s + l.qty, 0)} item${lines.length === 1 && lines[0]?.qty === 1 ? '' : 's'}`;

    if (!lines.length) {
      cartBody.innerHTML = `<div class="cart-empty">${icon('cart')}<div>Bill is empty</div><div class="xsmall">Tap a product to start</div></div>`;
    } else {
      cartBody.innerHTML = lines
        .map(
          (l) => `<div class="cart-line">
            <div class="grow">
              <div class="cl-name">${esc(l.product.name)}</div>
              <div class="cl-price">${fmtMoney(l.product.price)} × ${fmtQty(l.qty)}</div>
            </div>
            <div class="qty-ctrl">
              <button data-qty="-1" data-id="${l.productId}" aria-label="Less">${icon('minus')}</button>
              <span>${fmtQty(l.qty)}</span>
              <button data-qty="1" data-id="${l.productId}" aria-label="More">${icon('plus')}</button>
            </div>
            <div class="cl-total">${fmtMoney(l.qty * l.product.price)}</div>
          </div>`
        )
        .join('');
    }

    root.querySelector('#sumSubtotal').textContent = fmtMoney(subtotal);
    root.querySelector('#sumTax').textContent = fmtMoney(tax);
    root.querySelector('#sumTotal').textContent = fmtMoney(total);
    root.querySelector('#btnTotal').textContent = fmtMoney(total);

    if (!paidManual) {
      paidInput.value = method === 'Udhaar' ? 0 : round2(total);
    }
    updateChange();

    root.querySelector('#clearCart').disabled = !lines.length;
  }

  function updateChange() {
    const { total } = totals();
    const paid = Number(paidInput.value) || 0;
    const change = round2(paid - total);
    const line = root.querySelector('#changeLine');
    if (change > 0.009) {
      line.style.display = 'flex';
      line.innerHTML = `<span>Change to return</span><span>${fmtMoney(change)}</span>`;
    } else if (change < -0.009) {
      line.style.display = 'flex';
      line.style.color = 'var(--red)';
      line.innerHTML = `<span>Balance due</span><span>${fmtMoney(Math.abs(change))}</span>`;
    } else {
      line.style.display = 'none';
    }
  }

  renderGrid();
  renderCart();

  root.querySelector('#posSearch').addEventListener('input', (e) => {
    query = e.target.value;
    renderGrid();
  });

  root.querySelector('#posSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const list = visibleProducts();
    const exact = db.products.find((p) => String(p.sku || '').toLowerCase() === q);
    if (exact) {
      addToCart(exact.id);
      query = '';
      e.target.value = '';
      renderGrid();
      renderCart();
      return;
    }
    if (list.length === 1) {
      addToCart(list[0].id);
      query = '';
      e.target.value = '';
      renderGrid();
      renderCart();
      return;
    }
    toast('No exact barcode match — pick a product below', 'warn');
  });

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    category = btn.dataset.cat;
    renderChips();
    renderGrid();
  });

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    addToCart(btn.dataset.add);
    renderGrid();
    renderCart();
  });

  cartBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qty]');
    if (!btn) return;
    const line = cart.find((l) => l.productId === btn.dataset.id);
    if (!line) return;
    const product = getProduct(line.productId);
    const next = line.qty + Number(btn.dataset.qty);
    if (next <= 0) {
      cart = cart.filter((l) => l.productId !== line.productId);
    } else if (next > Number(product.stock)) {
      toast(`Only ${fmtQty(product.stock)} ${product.unit || 'pcs'} available`, 'warn');
      return;
    } else {
      line.qty = next;
    }
    renderGrid();
    renderCart();
  });

  root.querySelector('#clearCart').addEventListener('click', () => {
    if (!cart.length) return;
    cart = [];
    discount = 0;
    paidManual = false;
    root.querySelector('#discountInput').value = '';
    renderGrid();
    renderCart();
    toast('Bill cleared');
  });

  root.querySelector('#discountInput').addEventListener('input', (e) => {
    discount = Math.max(0, Number(e.target.value) || 0);
    renderCart();
  });

  root.querySelector('#customerSelect').addEventListener('change', (e) => {
    customerId = e.target.value;
    if (customerId && method === 'Udhaar') {
      // fine — customer selected for khata
    }
  });

  const methodSelect = root.querySelector('#methodSelect');
  methodSelect.addEventListener('change', (e) => {
    method = e.target.value;
    paidManual = false;
    if (method === 'Udhaar' && !customerId) {
      toast('Select a customer for udhaar', 'warn');
    }
    renderCart();
  });

  paidInput.addEventListener('input', () => {
    paidManual = true;
    updateChange();
  });

  root.querySelector('#completeSale').addEventListener('click', () => {
    const { lines, subtotal, disc, tax, total } = totals();
    if (!lines.length) return toast('Add at least one product to the bill', 'warn');

    for (const l of lines) {
      if (l.qty > Number(l.product.stock)) {
        return toast(`Not enough stock for ${l.product.name}`, 'error');
      }
    }

    const customer = customerId ? getCustomer(customerId) : null;
    if (method === 'Udhaar' && !customer) {
      return toast('Udhaar sale ke liye customer select karein', 'error');
    }

    let paid = Number(paidInput.value) || 0;
    if (paid < 0) paid = 0;
    if (paid > total) paid = total;
    const due = round2(total - paid);
    if (due > 0 && !customer) {
      return toast('Select a customer to keep the remaining amount as udhaar', 'error');
    }

    const sale = {
      id: `sale_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      no: invoiceNo(),
      date: new Date().toISOString(),
      items: lines.map((l) => ({
        productId: l.product.id,
        name: l.product.name,
        qty: l.qty,
        price: Number(l.product.price),
        cost: Number(l.product.cost),
      })),
      subtotal,
      discount: disc,
      tax,
      total,
      paid: round2(paid),
      due,
      method,
      customerId: customer ? customer.id : null,
      customerName: customer ? customer.name : 'Walk-in',
      note: '',
    };

    lines.forEach((l) => {
      l.product.stock = round2(Number(l.product.stock) - l.qty);
      l.product.updatedAt = sale.date;
    });
    db.sales.push(sale);
    db.counters.invoice += 1;
    save();

    const saleForReceipt = sale;
    cart = [];
    customerId = '';
    discount = 0;
    paidManual = false;
    method = 'Cash';
    query = '';
    refresh();

    openModal({
      title: 'Sale complete',
      subtitle: `${saleForReceipt.no} · ${fmtMoney(saleForReceipt.total)}`,
      size: 'lg',
      body: `<div style="background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:12px">${receiptHTML(saleForReceipt)}</div>`,
      footer: `
        <button class="btn btn-ghost" data-modal-close>Close</button>
        <button class="btn" id="printReceiptBtn">${icon('print')} Print receipt</button>`,
      onMount: (modal) => {
        modal.querySelector('#printReceiptBtn').addEventListener('click', () => printReceipt(saleForReceipt));
      },
    });
    toast(`${saleForReceipt.no} saved · ${fmtMoney(saleForReceipt.total)}`);
  });

  setTimeout(() => {
    if (window.innerWidth > 900) root.querySelector('#posSearch')?.focus();
  }, 80);
}
