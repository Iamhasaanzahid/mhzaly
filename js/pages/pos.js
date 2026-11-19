/* ============================================================
   mhzaly — POS Billing (barcode, discount, hold bill, udhaar)
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast, openModal } from '../ui.js';
import { money, printReceipt, shareWhatsApp } from '../receipt-share.js';
import { expiryBadge, productBatches, nearestBatch, productExpiryState, allocateBatches, deductBatches, sellableQty } from '../pharmacy.js';

const HELD_KEY = 'mhzaly_held_bills';

function shopTag() { return db.settings.shopName || 'shop'; }
function loadHeld() {
  try {
    const all = JSON.parse(localStorage.getItem(HELD_KEY) || '[]');
    return Array.isArray(all) ? all.filter((h) => h.shop === shopTag()) : [];
  } catch { return []; }
}
function writeHeld(list) {
  try {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); } catch { all = []; }
    all = (Array.isArray(all) ? all : []).filter((h) => h.shop !== shopTag());
    localStorage.setItem(HELD_KEY, JSON.stringify([...all, ...list]));
  } catch { /* ignore */ }
}

export function render(root) {
  const cart = [];
  let customerName = '';
  let customerPhone = '';
  let customerTax = '';
  let rxNote = '';
  let discountType = 'amount';
  let discountValue = 0;

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>POS Billing</h2>
        <p>Scan barcode ya search karein, discount lagayein, aur invoice banayein.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="holdBtn" type="button" title="Bill hold karein">${icon('download')} Hold</button>
        <button class="btn btn-ghost" id="heldBtn" type="button" title="Held bills">${icon('return')} Held <span id="heldCount">0</span></button>
        <button class="btn btn-primary" id="checkoutBtn" disabled>${icon('check')} Checkout</button>
      </div>
    </div>

    <div class="grid k2 mt">
      <div class="card" style="min-height:520px">
        <div class="card-head"><h3>Add Product</h3><div class="right"><span class="hint">${icon('barcode')} Barcode scanner ready</span></div></div>
        <div class="card-pad">
          <div class="field mt-sm">
            <label>Search / scan product</label>
            <input class="input" id="posSearch" placeholder="Name, salt, batch, SKU ya barcode — Enter dabayein" autocomplete="off" />
            <div class="hint" style="margin-top:6px">F2 search focus · F4 checkout · Enter se item add</div>
          </div>
          <div id="posProductList" class="pos-list">${renderProductList(db.products, cart)}</div>
        </div>
      </div>

      <div class="card" style="min-height:520px">
        <div class="card-head"><h3>Cart</h3><span class="right" id="posCount">0 items</span></div>
        <div class="card-pad">
          <div id="posCart" class="pos-cart">${renderCart(cart)}</div>

          <div class="field" style="margin-top:12px">
            <div class="flex-between" style="gap:8px; align-items:center">
              <label for="posCustomer">Customer name (optional)</label>
              <button class="btn btn-ghost btn-sm" id="posAddCustomer" type="button" title="Naya customer add karein">${icon('plus')} New</button>
            </div>
            <input class="input" id="posCustomer" list="posCustomerList" placeholder="Walk-in" autocomplete="off" />
            <datalist id="posCustomerList">
              ${db.customers.map((c) => `<option value="${esc(c.name)}"></option>`).join('')}
            </datalist>
          </div>
          <div class="field">
            <label>Phone (WhatsApp receipt ke liye)</label>
            <input class="input" id="posPhone" placeholder="03xx-xxxxxxx" inputmode="tel" />
          </div>
          <div class="field">
            <label>Customer tax / NTN (optional)</label>
            <input class="input" id="posTax" placeholder="Buyer tax number" autocomplete="off" />
          </div>
          <div class="field">
            <label>Payment method</label>
            <select class="input" id="posPayment">
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="Online">Online / Bank</option>
              <option value="Udhaar">Udhaar (credit)</option>
            </select>
          </div>

          <div class="field" id="posRxBox" hidden>
            <label>Prescription / doctor (Rx items)</label>
            <input class="input" id="posRx" placeholder="Doctor name / Rx number" autocomplete="off" />
          </div>

          <div class="pos-discount">
            <div class="field">
              <label>Discount</label>
              <input class="input" id="posDiscount" type="number" min="0" step="0.01" value="0" placeholder="0" />
            </div>
            <div class="field" style="max-width:110px">
              <label>Type</label>
              <select class="input" id="posDiscountType">
                <option value="amount">${esc(db.settings.currency || 'Rs')}</option>
                <option value="percent">%</option>
              </select>
            </div>
          </div>

          <div class="pos-summary">
            <div class="pos-summary-row"><span>Subtotal</span><span id="posSubtotal">${money(0)}</span></div>
            <div class="pos-summary-row" id="posDiscountRow" hidden><span>Discount</span><span id="posDiscountAmt">${money(0)}</span></div>
            <div class="pos-summary-row" id="posTaxRow" hidden><span>Tax (<span id="posTaxRate">0</span>%)</span><span id="posTax">${money(0)}</span></div>
          </div>
          <div class="pos-total">
            <span>Total</span><span id="posTotal">${money(0)}</span>
          </div>
        </div>
      </div>
    </div>`;

  const listEl = root.querySelector('#posProductList');
  const cartEl = root.querySelector('#posCart');
  const totalEl = root.querySelector('#posTotal');
  const countEl = root.querySelector('#posCount');
  const checkoutBtn = root.querySelector('#checkoutBtn');
  const search = root.querySelector('#posSearch');
  const discountEl = root.querySelector('#posDiscount');
  const discountTypeEl = root.querySelector('#posDiscountType');

  function cartTotals() {
    const subtotal = cart.reduce((sum, i) => sum + i.qty * i.price, 0);
    const rawDiscount = Number(discountValue) || 0;
    const discount = discountType === 'percent'
      ? Math.min(subtotal, Math.round(subtotal * Math.min(100, Math.max(0, rawDiscount))) / 100)
      : Math.min(subtotal, Math.max(0, rawDiscount));
    const taxable = Math.max(0, subtotal - discount);
    const rate = Math.max(0, Math.min(100, Number(db.settings.taxRate) || 0));
    const tax = Math.round(taxable * rate) / 100;
    return { subtotal, discount, taxable, rate, tax, total: taxable + tax };
  }

  function refresh() {
    listEl.innerHTML = renderProductList(filteredProducts(), cart);
    cartEl.innerHTML = renderCart(cart);
    const { subtotal, discount, rate, tax, total } = cartTotals();
    const subEl = root.querySelector('#posSubtotal');
    if (subEl) subEl.textContent = money(subtotal);
    const discRow = root.querySelector('#posDiscountRow');
    if (discRow) {
      discRow.hidden = !(discount > 0);
      root.querySelector('#posDiscountAmt').textContent = '− ' + money(discount);
    }
    const taxRow = root.querySelector('#posTaxRow');
    if (taxRow) {
      taxRow.hidden = !(rate > 0);
      root.querySelector('#posTaxRate').textContent = rate;
      root.querySelector('#posTax').textContent = money(tax);
    }
    totalEl.textContent = money(total);
    const count = cart.reduce((sum, i) => sum + i.qty, 0);
    countEl.textContent = count + ' item' + (count === 1 ? '' : 's');
    checkoutBtn.disabled = cart.length === 0;
    const rxBox = root.querySelector('#posRxBox');
    if (rxBox) rxBox.hidden = !cart.some((i) => i.rx);
    const heldCount = root.querySelector('#heldCount');
    if (heldCount) heldCount.textContent = loadHeld().length;
  }

  function addToCart(id) {
    const p = db.products.find((x) => x.id === id);
    if (!p) return;
    const sellable = sellableQty(p);
    if (sellable <= 0) {
      const exp = productExpiryState(p);
      return toast(exp.state === 'expired' ? `${p.name} ka sab stock expired hai — sale blocked` : 'Ye product out of stock hai', 'error');
    }
    const exp = productExpiryState(p);
    if (exp.state === 'critical') toast(`${p.name} ka kuch stock ${exp.days} din mein expire ho raha hai`);
    if (sellable < (p.stock || 0)) toast(`${p.name}: ${(p.stock || 0) - sellable} units expired hain — sirf valid stock sale hoga`);
    const existing = cart.find((i) => i.id === id);
    if (existing) {
      if (existing.qty >= sellable) return toast('Valid stock limit reached', 'error');
      existing.qty += 1;
    } else {
      const nb = nearestBatch(p, { validOnly: true });
      cart.push({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        qty: 1,
        salt: p.salt || '',
        batch: nb ? nb.batch : (p.batch || ''),
        expiry: nb ? nb.expiry : (p.expiry || ''),
        rx: !!p.rx,
      });
    }
    refresh();
  }

  function changeQty(id, delta) {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    const p = db.products.find((x) => x.id === id);
    const max = p ? sellableQty(p) : 9999;
    item.qty += delta;
    if (item.qty <= 0) {
      const idx = cart.findIndex((i) => i.id === id);
      cart.splice(idx, 1);
    } else if (p && item.qty > max) {
      item.qty = max;
      toast('Stock limit reached', 'error');
    }
    refresh();
  }

  function removeFromCart(id) {
    const idx = cart.findIndex((i) => i.id === id);
    if (idx >= 0) cart.splice(idx, 1);
    refresh();
  }

  function filteredProducts() {
    const q = String(search.value || '').toLowerCase().trim();
    if (!q) return db.products;
    return db.products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.salt || '').toLowerCase().includes(q) ||
        (p.batch || '').toLowerCase().includes(q) ||
        (p.manufacturer || '').toLowerCase().includes(q)
    );
  }

  search.addEventListener('input', () => {
    listEl.innerHTML = renderProductList(filteredProducts(), cart);
  });

  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = String(search.value || '').trim().toLowerCase();
    if (!q) return;
    const bySku = db.products.find((p) => String(p.sku || '').trim().toLowerCase() === q);
    if (bySku) { addToCart(bySku.id); search.value = ''; listEl.innerHTML = renderProductList(db.products, cart); return; }
    const list = filteredProducts();
    const exact = list.find((p) => p.name.toLowerCase() === q);
    if (exact) { addToCart(exact.id); search.value = ''; listEl.innerHTML = renderProductList(db.products, cart); return; }
    if (list.length === 1) { addToCart(list[0].id); search.value = ''; listEl.innerHTML = renderProductList(db.products, cart); return; }
    toast('Product nahi mila — naam ya SKU check karein', 'error');
  });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    addToCart(btn.dataset.add);
  });

  cartEl.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    if (inc) return changeQty(inc.dataset.inc, 1);
    const dec = e.target.closest('[data-dec]');
    if (dec) return changeQty(dec.dataset.dec, -1);
    const rem = e.target.closest('[data-remove]');
    if (rem) return removeFromCart(rem.dataset.remove);
  });

  root.querySelector('#posCustomer').addEventListener('input', (e) => {
    customerName = e.target.value;
    const match = db.customers.find((c) => c.name.toLowerCase() === String(customerName || '').toLowerCase().trim());
    if (match) {
      if (match.phone) {
        root.querySelector('#posPhone').value = match.phone;
        customerPhone = match.phone;
      }
      root.querySelector('#posTax').value = match.taxNumber || '';
      customerTax = match.taxNumber || '';
    }
  });
  root.querySelector('#posPhone').addEventListener('input', (e) => {
    customerPhone = e.target.value;
    const match = db.customers.find((c) => c.phone && String(c.phone).replace(/[^\d]/g, '') === String(customerPhone).replace(/[^\d]/g, ''));
    if (match) {
      if (!customerName.trim()) {
        customerName = match.name;
        root.querySelector('#posCustomer').value = match.name;
      }
      root.querySelector('#posTax').value = match.taxNumber || '';
      customerTax = match.taxNumber || '';
    }
  });
  root.querySelector('#posTax').addEventListener('input', (e) => {
    customerTax = e.target.value;
  });
  root.querySelector('#posRx').addEventListener('input', (e) => {
    rxNote = e.target.value;
  });

  function openQuickCustomer() {
    openModal({
      title: 'New customer',
      subtitle: 'POS se seedha customer khata banayein',
      body: `
        <div class="owner-form-grid">
          <label style="grid-column:1/-1">Customer name
            <input id="qcName" placeholder="e.g. Ali Khan" autocomplete="off" />
          </label>
          <label>Phone / WhatsApp
            <input id="qcPhone" placeholder="03xx-xxxxxxx" inputmode="tel" />
          </label>
          <label>Tax / NTN (optional)
            <input id="qcTax" placeholder="Buyer tax number" autocomplete="off" />
          </label>
        </div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
               <button class="btn btn-primary" id="qcSave">${icon('check')} Save customer</button>`,
      onMount: (bd) => {
        bd.querySelector('[data-cancel]').addEventListener('click', () => bd.remove());
        const doSave = () => {
          const name = bd.querySelector('#qcName').value.trim();
          const phone = bd.querySelector('#qcPhone').value.trim();
          const tax = bd.querySelector('#qcTax').value.trim();
          if (!name) return toast('Customer ka naam likhein', 'error');
          let c = db.customers.find((x) => String(x.name || '').toLowerCase() === name.toLowerCase());
          const isNew = !c;
          if (!c) {
            c = { id: uid('cust'), name, phone, taxNumber: tax, balance: 0, createdAt: new Date().toISOString() };
            db.customers.push(c);
          } else {
            if (phone) c.phone = phone;
            if (tax) c.taxNumber = tax;
            c.updatedAt = new Date().toISOString();
          }
          save();
          customerName = name;
          customerPhone = c.phone || '';
          customerTax = c.taxNumber || '';
          root.querySelector('#posCustomer').value = name;
          root.querySelector('#posPhone').value = customerPhone;
          root.querySelector('#posTax').value = customerTax;
          const dl = root.querySelector('#posCustomerList');
          if (dl) dl.innerHTML = db.customers.map((x) => `<option value="${esc(x.name)}"></option>`).join('');
          bd.remove();
          toast(isNew ? 'Customer add ho gaya' : 'Customer update ho gaya', 'success');
        };
        bd.querySelector('#qcSave').addEventListener('click', doSave);
        bd.querySelector('#qcName').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') doSave();
        });
        setTimeout(() => bd.querySelector('#qcName').focus(), 60);
      },
    });
  }

  root.querySelector('#posAddCustomer').addEventListener('click', openQuickCustomer);

  discountEl.addEventListener('input', (e) => {
    discountValue = Number(e.target.value) || 0;
    refresh();
  });
  discountTypeEl.addEventListener('change', (e) => {
    discountType = e.target.value === 'percent' ? 'percent' : 'amount';
    refresh();
  });

  function clearCart() {
    cart.length = 0;
    customerName = '';
    customerPhone = '';
    customerTax = '';
    rxNote = '';
    discountValue = 0;
    discountType = 'amount';
    root.querySelector('#posCustomer').value = '';
    root.querySelector('#posPhone').value = '';
    root.querySelector('#posTax').value = '';
    root.querySelector('#posRx').value = '';
    root.querySelector('#posDiscount').value = '0';
    root.querySelector('#posDiscountType').value = 'amount';
    root.querySelector('#posPayment').value = 'Cash';
    search.value = '';
    refresh();
  }

  root.querySelector('#holdBtn').addEventListener('click', () => {
    if (!cart.length) return toast('Cart khali hai', 'error');
    const held = loadHeld();
    held.push({
      id: uid('held'),
      shop: shopTag(),
      at: new Date().toISOString(),
      cart: cart.map((i) => ({ ...i })),
      customerName,
      customerPhone,
      customerTax,
      rxNote,
      discountType,
      discountValue,
    });
    writeHeld(held);
    clearCart();
    toast('Bill hold ho gaya');
  });

  root.querySelector('#heldBtn').addEventListener('click', () => {
    const held = loadHeld();
    if (!held.length) return toast('Koi held bill nahi hai');
    openModal({
      title: 'Held bills',
      subtitle: 'Resume karein ya delete karein',
      body: held.length
        ? `<div class="held-list">${held.map((h) => {
            const total = (h.cart || []).reduce((a, i) => a + i.qty * i.price, 0);
            return `<div class="held-row">
              <div class="grow">
                <b>${esc(h.customerName || 'Walk-in')}</b>
                <div class="small muted">${(h.cart || []).length} item(s) · ${money(total)} · ${new Date(h.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <button class="btn btn-primary btn-sm" data-resume="${esc(h.id)}">Resume</button>
              <button class="btn btn-ghost btn-sm" data-drop="${esc(h.id)}" title="Delete">${icon('trash')}</button>
            </div>`;
          }).join('')}</div>`
        : '<div class="empty-state">Koi held bill nahi.</div>',
      footer: '<button class="btn btn-ghost" data-cancel>Close</button>',
      onMount: (bd) => {
        bd.querySelector('[data-cancel]').addEventListener('click', () => bd.remove());
        bd.querySelectorAll('[data-resume]').forEach((btn) => btn.addEventListener('click', () => {
          const bill = loadHeld().find((h) => h.id === btn.dataset.resume);
          if (!bill) return;
          cart.length = 0;
          for (const item of bill.cart || []) {
            const p = db.products.find((x) => x.id === item.id);
            const max = p ? sellableQty(p) : 0;
            if (p && max > 0) cart.push({ ...item, qty: Math.min(item.qty, max) });
          }
          customerName = bill.customerName || '';
          customerPhone = bill.customerPhone || '';
          customerTax = bill.customerTax || '';
          rxNote = bill.rxNote || '';
          discountType = bill.discountType || 'amount';
          discountValue = bill.discountValue || 0;
          root.querySelector('#posCustomer').value = customerName;
          root.querySelector('#posPhone').value = customerPhone;
          root.querySelector('#posTax').value = customerTax;
          root.querySelector('#posRx').value = rxNote;
          root.querySelector('#posDiscountType').value = discountType;
          root.querySelector('#posDiscount').value = discountValue;
          writeHeld(loadHeld().filter((h) => h.id !== bill.id));
          bd.remove();
          refresh();
          toast('Bill resume ho gaya');
        }));
        bd.querySelectorAll('[data-drop]').forEach((btn) => btn.addEventListener('click', () => {
          writeHeld(loadHeld().filter((h) => h.id !== btn.dataset.drop));
          bd.remove();
          refresh();
          toast('Held bill delete ho gaya');
        }));
      },
    });
  });

  checkoutBtn.addEventListener('click', () => {
    if (!cart.length) return toast('Cart is empty', 'error');
    const method = (root.querySelector('#posPayment') || {}).value || 'Cash';
    const name = (customerName || '').trim();
    if (method === 'Udhaar' && (!name || /^walk-in$/i.test(name))) {
      return toast('Udhaar ke liye customer ka naam aur phone zaroori hai', 'error');
    }
    if (cart.some((i) => i.rx) && !String(rxNote || '').trim()) {
      return toast('Rx medicine hai — prescription / doctor ka note likhein', 'error');
    }

    // Pre-check FEFO availability so we never save a half-complete sale.
    for (const item of cart) {
      const p = db.products.find((x) => x.id === item.id);
      if (!p) return toast(`${item.name} product ab maujood nahi`, 'error');
      const { remaining } = allocateBatches(p, item.qty);
      if (remaining > 0) return toast(`${p.name}: valid stock kam hai`, 'error');
    }

    const { subtotal, discount, rate, tax, total } = cartTotals();
    const items = cart.map((i) => ({ ...i }));
    for (const item of items) {
      const p = db.products.find((x) => x.id === item.id);
      if (!p) continue;
      const { allocations } = allocateBatches(p, item.qty);
      deductBatches(p, allocations);
      item.batchAllocations = allocations;
      if (allocations[0]) {
        item.batch = allocations[0].batch || item.batch;
        item.expiry = allocations[0].expiry || item.expiry;
      }
      p.stock = Math.max(0, (p.stock || 0) - item.qty);
    }

    const sale = {
      id: uid('sale'),
      invoiceNo: 'INV-' + String(Date.now()).slice(-6),
      customerName: name || 'Walk-in',
      customerPhone: (customerPhone || '').trim(),
      customerTaxNumber: (customerTax || '').trim(),
      items,
      subtotal,
      discount,
      discountType,
      discountValue: Number(discountValue) || 0,
      taxRate: rate,
      tax,
      total,
      paymentMethod: method,
      rxNote: String(rxNote || '').trim(),
      createdAt: new Date().toISOString(),
    };

    db.sales.push(sale);

    if (method === 'Udhaar') {
      let c = db.customers.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!c) {
        c = { id: uid('cust'), name, phone: sale.customerPhone, taxNumber: sale.customerTaxNumber, balance: 0, createdAt: new Date().toISOString() };
        db.customers.push(c);
      }
      c.balance = (Number(c.balance) || 0) + total;
      if (sale.customerPhone && !c.phone) c.phone = sale.customerPhone;
      if (sale.customerTaxNumber) c.taxNumber = sale.customerTaxNumber;
    } else if (sale.customerTaxNumber) {
      const c = db.customers.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (c && !c.taxNumber) c.taxNumber = sale.customerTaxNumber;
    }

    save();
    clearCart();
    showSaleComplete(sale);
  });

  const onPosKey = (e) => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onPosKey);
      if (window.__mhzalyPosKey === onPosKey) window.__mhzalyPosKey = null;
      return;
    }
    if (document.querySelector('.owner-modal-backdrop')) return;
    if (e.key === 'F2') {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === 'F4') {
      e.preventDefault();
      if (!checkoutBtn.disabled) checkoutBtn.click();
    } else if (e.key === 'Escape' && document.activeElement === search) {
      search.value = '';
      listEl.innerHTML = renderProductList(db.products, cart);
    }
  };
  if (window.__mhzalyPosKey) document.removeEventListener('keydown', window.__mhzalyPosKey);
  window.__mhzalyPosKey = onPosKey;
  document.addEventListener('keydown', onPosKey);

  refresh();
}

function showSaleComplete(sale) {
  const rows = (sale.items || [])
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}${it.batch ? `<div class="small muted">Batch ${esc(it.batch)}${it.expiry ? ' · ' + esc(it.expiry) : ''}</div>` : ''}</td><td style="text-align:center">${esc(it.qty)}</td><td style="text-align:right">${money(
          (Number(it.qty) || 1) * (Number(it.price) || 0)
        )}</td></tr>`
    )
    .join('');

  const isCash = (sale.paymentMethod || 'Cash') === 'Cash';

  openModal({
    title: 'Sale complete',
    subtitle: `Invoice ${sale.invoiceNo}`,
    body: `
      <div class="sale-done">
        <div class="sale-done-ico">${icon('check')}</div>
        <div class="sale-done-total">${money(sale.total)}</div>
        <div class="sale-done-sub">${esc(sale.customerName || 'Walk-in')} · ${esc(sale.items.reduce((a, it) => a + (Number(it.qty) || 1), 0))} item(s) · ${esc(sale.paymentMethod || 'Cash')}</div>
      </div>
      ${Number(sale.discount) > 0 ? `<div class="small muted" style="text-align:center;margin:-4px 0 10px">Discount ${money(sale.discount)} applied</div>` : ''}
      ${sale.customerTaxNumber ? `<div class="small muted" style="text-align:center;margin:-4px 0 10px">Buyer tax: <b>${esc(sale.customerTaxNumber)}</b></div>` : ''}
      ${sale.rxNote ? `<div class="small muted" style="text-align:center;margin:-4px 0 10px">Rx: <b>${esc(sale.rxNote)}</b></div>` : ''}
      ${isCash ? `
      <div class="cash-box">
        <div class="field">
          <label>Cash received</label>
          <input class="input" id="cashReceived" type="number" min="0" step="0.01" placeholder="${money(sale.total)}" />
        </div>
        <div class="cash-change">Change: <b id="cashChange">${money(0)}</b></div>
        <div class="cash-quick">
          ${[Math.ceil(Number(sale.total) / 100) * 100, Math.ceil(Number(sale.total) / 500) * 500, Math.ceil(Number(sale.total) / 1000) * 1000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => `<button class="btn btn-ghost btn-sm" type="button" data-cash="${v}">${money(v)}</button>`).join('')}
        </div>
      </div>` : ''}
      <div class="table-wrap">
        <table style="width:100%">
          <thead><tr><th style="text-align:left">Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="field" style="margin-top:14px">
        <label>Customer phone (WhatsApp)</label>
        <input class="input" id="salePhone" value="${esc(sale.customerPhone || '')}" placeholder="03xx-xxxxxxx" inputmode="tel" />
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-close-sale>Done</button>
      <button class="btn btn-ghost" id="salePrint">${icon('download')} Print</button>
      <button class="btn btn-primary" id="saleWhatsapp">${icon('check')} WhatsApp</button>`,
    onMount: (bd) => {
      bd.querySelector('[data-close-sale]').addEventListener('click', () => bd.remove());
      const cashInput = bd.querySelector('#cashReceived');
      const changeEl = bd.querySelector('#cashChange');
      const updateChange = () => {
        const received = Number(cashInput?.value) || 0;
        const change = Math.max(0, received - (Number(sale.total) || 0));
        if (changeEl) changeEl.textContent = money(change);
        sale.cashReceived = received;
        sale.change = change;
      };
      if (cashInput) {
        cashInput.addEventListener('input', updateChange);
        bd.querySelectorAll('[data-cash]').forEach((btn) => btn.addEventListener('click', () => {
          cashInput.value = btn.dataset.cash;
          updateChange();
        }));
        setTimeout(() => cashInput.focus(), 80);
      }
      bd.querySelector('#salePrint').addEventListener('click', () => { updateChange(); save(); printReceipt(sale); });
      bd.querySelector('#saleWhatsapp').addEventListener('click', () => {
        const phone = bd.querySelector('#salePhone').value;
        sale.customerPhone = String(phone || '').trim();
        updateChange();
        save();
        shareWhatsApp(sale, phone);
      });
    },
  });
}

function renderProductList(products, cart) {
  if (!products.length) return '<div class="pos-empty">No products found.</div>';
  const qtyMap = new Map(cart.map((i) => [i.id, i.qty]));
  return products
    .map((p) => {
      const sellable = sellableQty(p);
      const exp = productExpiryState(p);
      const nb = nearestBatch(p);
      const batches = productBatches(p);
      const hasStock = sellable > 0;
      const expired = !hasStock && exp.state === 'expired';
      const inCart = qtyMap.get(p.id) || 0;
      const pharmaMeta = p.salt || nb
        ? `<div class="pos-meta">${p.salt ? esc(p.salt) : ''}${p.salt && nb ? ' · ' : ''}${nb ? 'Batch ' + esc(nb.batch || '—') + (batches.length > 1 ? ` (+${batches.length - 1})` : '') : ''}${nb ? ' · ' + expiryBadge(nb.expiry) : ''}</div>`
        : '';
      return `<div class="pos-row" ${expired ? 'style="opacity:.6"' : ''}>
        <div class="grow">
          <div class="pos-name">${esc(p.name)}${p.rx ? ' <span class="badge warn">Rx</span>' : ''}</div>
          <div class="pos-meta">${esc(p.sku || '')}${p.category ? ' · ' + esc(p.category) : ''}</div>
          ${pharmaMeta}
          <div class="pos-meta">Stock: ${esc(sellable)}${sellable !== (p.stock || 0) ? ` / ${esc(p.stock)} total` : ''} · ${money(p.price)}</div>
        </div>
        <button class="btn btn-primary btn-sm" ${!hasStock ? 'disabled' : ''} data-add="${esc(p.id)}" ${expired ? 'title="Expired — sale blocked"' : ''}>
          ${icon('plus')}${inCart ? ` <span>${inCart}</span>` : ''}
        </button>
      </div>`;
    })
    .join('');
}

function renderCart(cart) {
  if (!cart.length) return '<div class="pos-empty">Cart is empty. Left se products add karein.</div>';
  return cart
    .map(
      (i) => `
    <div class="pos-row">
      <div class="grow">
        <div class="pos-name">${esc(i.name)}</div>
        <div class="pos-meta">${money(i.price)} each${i.batch ? ' · Batch ' + esc(i.batch) : ''}${i.expiry ? ' · ' + expiryBadge(i.expiry) : ''}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" data-dec="${esc(i.id)}">−</button>
        <span class="qty-val">${i.qty}</span>
        <button class="qty-btn" data-inc="${esc(i.id)}">+</button>
        <button class="qty-del" data-remove="${esc(i.id)}" title="Remove">${icon('trash')}</button>
      </div>
    </div>`
    )
    .join('');
}
