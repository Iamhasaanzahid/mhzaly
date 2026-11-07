/* ============================================================
   mhzaly — POS Billing
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast } from '../ui.js';

export function render(root) {
  const cart = [];
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>POS Billing</h2>
        <p>Scan or search products, add to cart, and create an invoice.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" id="checkoutBtn" disabled>${icon('check')} Checkout</button>
      </div>
    </div>

    <div class="grid k2 mt">
      <div class="card" style="min-height:520px">
        <div class="card-head"><h3>Add Product</h3></div>
        <div class="card-pad">
          <div class="field mt-sm">
            <label>Search product</label>
            <input class="input" id="posSearch" placeholder="Name, SKU or barcode" />
          </div>
          <div id="posProductList" style="max-height:340px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin-top:8px;background:#f8fafc">
            ${renderProductList(db.products, cart)}
          </div>
        </div>
      </div>

      <div class="card" style="min-height:520px">
        <div class="card-head"><h3>Cart</h3></div>
        <div class="card-pad">
          <div id="posCart" style="max-height:300px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;margin-bottom:10px">
            ${renderCart(cart)}
          </div>
          <div style="display:flex;justify-content:space-between;font-weight:800;font-size:16px;margin-top:10px">
            <span>Total</span><span id="posTotal">Rs 0</span>
          </div>
        </div>
      </div>
    </div>`;

  const search = root.querySelector('#posSearch');
  search.addEventListener('input', (e) => {
    const q = String(e.target.value || '').toLowerCase();
    const filtered = db.products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    root.querySelector('#posProductList').innerHTML = renderProductList(filtered, cart);
  });

  root.querySelector('#checkoutBtn').addEventListener('click', () => {
    if (!cart.length) return toast('Cart is empty', 'error');
    const total = cart.reduce((sum, i) => sum + i.qty * i.price, 0);
    const sale = {
      id: uid('sale'),
      invoiceNo: 'INV-' + String(Date.now()).slice(-6),
      customerName: 'Walk-in',
      items: [...cart],
      total,
      paymentMethod: 'Cash',
      createdAt: new Date().toISOString(),
    };
    db.sales.push(sale);
    for (const item of cart) {
      const p = db.products.find((x) => x.id === item.id);
      if (p) p.stock = Math.max(0, (p.stock || 0) - item.qty);
    }
    save();
    toast('Invoice created: ' + sale.invoiceNo);
    cart.length = 0;
    root.querySelector('#posCart').innerHTML = renderCart(cart);
    root.querySelector('#posTotal').textContent = 'Rs 0';
    root.querySelector('#checkoutBtn').disabled = true;
    root.querySelector('#posProductList').innerHTML = renderProductList(db.products, cart);
    search.value = '';
    search.focus();
  });
}

function renderProductList(products, cart) {
  if (!products.length) return '<div style="padding:10px;color:#64748b">No products found.</div>';
  const inCart = new Set(cart.map((i) => i.id));
  return products.map((p) => {
    const hasStock = (p.stock || 0) > 0;
    return `<div style="padding:8px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700">${esc(p.name)}</div>
        <div style="font-size:12px;color:#64748b">${esc(p.sku || '')} · ${esc(p.category || '')}</div>
        <div style="font-size:12px;color:#64748b">Stock: ${esc(p.stock)} · Rs ${esc(Number(p.price || 0).toLocaleString())}</div>
      </div>
      <button class="btn btn-primary btn-sm" ${!hasStock || inCart.has(p.id) ? 'disabled' : ''} data-add="${esc(p.id)}">${icon('plus')}</button>
    </div>`;
  }).join('');
}

function renderCart(cart) {
  if (!cart.length) return '<div style="padding:10px;color:#64748b">Cart is empty.</div>';
  return cart.map((i) => `
    <div style="padding:8px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700">${esc(i.name)}</div>
        <div style="font-size:12px;color:#64748b">Rs ${esc(Number(i.price || 0).toLocaleString())} each</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-weight:800">${i.qty}</span>
        <button class="btn btn-ghost btn-sm" data-remove="${esc(i.id)}" style="padding:4px 8px">${icon('trash')}</button>
      </div>
    </div>`).join('');
}
