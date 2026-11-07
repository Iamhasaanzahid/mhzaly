/* ============================================================
   Purchases / stock-in
   ============================================================ */

import { db, save, getProduct, getSupplier, round2, purchaseNo, dayKey, totalPayable } from '../db.js';
import {
  icon, esc, fmtMoney, fmtDate, fmtQty, toast, refresh, openModal, closeModal,
  confirmDialog, emptyState, sum, todayInput,
} from '../ui.js';

export const meta = { title: 'Purchases', subtitle: 'Stock coming in from suppliers' };

function productOptions() {
  return [...db.products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `<option value="${p.id}">${esc(p.name)}${p.sku ? ' · ' + esc(p.sku) : ''}</option>`)
    .join('');
}

function newPurchaseModal() {
  const today = todayInput();
  const modal = openModal({
    title: 'New purchase',
    subtitle: 'Add stock received from a supplier',
    size: 'lg',
    body: `
      <form id="purchaseForm" autocomplete="off">
        <div class="form-grid">
          <div class="field">
            <label>Supplier</label>
            <select class="select" id="purSupplier">
              <option value="">Cash purchase (no supplier)</option>
              ${[...db.suppliers]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label>Purchase date</label>
            <input class="input" type="date" id="purDate" value="${today}" />
          </div>
        </div>

        <div class="section-title">Items received</div>
        <div class="purchase-head">
          <span>Product</span><span>Qty</span><span>Cost / unit</span><span>Amount</span><span></span>
        </div>
        <div id="purRows"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="addPurRow">${icon('plus')} Add another item</button>

        <div class="purchase-sum">
          <div class="sum-row"><span class="lbl">Total purchase</span><span id="purTotal" class="strong">Rs 0</span></div>
          <div class="form-grid" style="margin-top:10px">
            <div class="field">
              <label>Amount paid now</label>
              <input class="input" type="number" min="0" step="any" id="purPaid" value="" placeholder="0" />
            </div>
            <div class="field">
              <label>Remaining (payable)</label>
              <div class="input" id="purDue" style="display:flex;align-items:center;background:#f8fafc">Rs 0</div>
            </div>
          </div>
          <p class="hint" style="margin-top:8px">The remaining amount will be added to the supplier's payable balance.</p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn">${icon('check')} Save purchase</button>
        </div>
      </form>`,
    onMount: (m) => {
      const rows = m.querySelector('#purRows');
      const paid = m.querySelector('#purPaid');
      const totalEl = m.querySelector('#purTotal');
      const dueEl = m.querySelector('#purDue');
      let paidManual = false;

      const calc = () => {
        let total = 0;
        rows.querySelectorAll('[data-row]').forEach((row) => {
          const qty = Number(row.querySelector('.pur-qty').value) || 0;
          const cost = Number(row.querySelector('.pur-cost').value) || 0;
          const line = qty * cost;
          row.querySelector('.pur-line').textContent = fmtMoney(line);
          total += line;
        });
        total = round2(total);
        totalEl.textContent = fmtMoney(total);
        if (!paidManual) paid.value = total || '';
        const paidNow = Math.min(Number(paid.value) || 0, total);
        dueEl.textContent = fmtMoney(round2(total - paidNow));
        return total;
      };

      const addRow = () => {
        const row = document.createElement('div');
        row.className = 'purchase-row';
        row.dataset.row = '1';
        row.innerHTML = `
          <select class="select input-sm pur-product">
            <option value="">Select product…</option>
            ${productOptions()}
          </select>
          <input class="input input-sm pur-qty" type="number" min="0" step="any" placeholder="0" />
          <input class="input input-sm pur-cost" type="number" min="0" step="any" placeholder="0" />
          <div class="pur-line muted small">${fmtMoney(0)}</div>
          <button type="button" class="icon-btn danger pur-remove" title="Remove">${icon('x')}</button>`;
        rows.appendChild(row);
        row.querySelector('.pur-product').addEventListener('change', (e) => {
          const p = getProduct(e.target.value);
          if (p) row.querySelector('.pur-cost').value = p.cost ?? '';
          calc();
        });
        row.querySelectorAll('input').forEach((input) => input.addEventListener('input', calc));
        row.querySelector('.pur-remove').addEventListener('click', () => {
          row.remove();
          if (!rows.children.length) addRow();
          calc();
        });
      };

      m.querySelector('#addPurRow').addEventListener('click', addRow);
      paid.addEventListener('input', () => { paidManual = true; calc(); });
      addRow();
      addRow();
      calc();

      m.querySelector('#purchaseForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const supplierId = m.querySelector('#purSupplier').value;
        const supplier = supplierId ? getSupplier(supplierId) : null;
        const dateVal = m.querySelector('#purDate').value;
        const items = [];
        for (const row of rows.querySelectorAll('[data-row]')) {
          const productId = row.querySelector('.pur-product').value;
          const qty = Number(row.querySelector('.pur-qty').value) || 0;
          const cost = Number(row.querySelector('.pur-cost').value) || 0;
          if (!productId || qty <= 0) continue;
          const product = getProduct(productId);
          if (!product) continue;
          items.push({ productId, name: product.name, qty, cost });
        }
        if (!items.length) return toast('Add at least one item with quantity', 'error');

        const total = round2(items.reduce((s, i) => s + i.qty * i.cost, 0));
        let paidNow = Math.min(Number(paid.value) || 0, total);
        if (paidNow < 0) paidNow = 0;
        const due = round2(total - paidNow);
        if (due > 0 && !supplier) {
          return toast('Select a supplier to record the remaining payable', 'error');
        }

        const when = dateVal ? new Date(`${dateVal}T${new Date().toTimeString().slice(0, 8)}`).toISOString() : new Date().toISOString();
        items.forEach((item) => {
          const product = getProduct(item.productId);
          product.stock = round2(Number(product.stock) + item.qty);
          product.cost = item.cost;
          product.updatedAt = when;
        });

        const no = purchaseNo();
        db.purchases.push({
          id: `pur_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
          no,
          date: when,
          supplierId: supplier ? supplier.id : null,
          supplierName: supplier ? supplier.name : 'Cash purchase',
          items,
          total,
          paid: round2(paidNow),
          due,
          note: '',
        });
        db.counters.purchase += 1;
        save();
        closeModal();
        toast(`${no} saved · stock updated`);
        refresh();
      });
    },
  });
  return modal;
}

function purchaseModal(purchase) {
  const items = purchase.items
    .map(
      (i) => `<tr><td>${esc(i.name)}</td><td class="num">${fmtQty(i.qty)}</td><td class="num">${fmtMoney(i.cost)}</td><td class="num strong">${fmtMoney(i.qty * i.cost)}</td></tr>`
    )
    .join('');
  openModal({
    title: purchase.no,
    subtitle: `${fmtDate(purchase.date)} · ${purchase.supplierName}`,
    body: `
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:12px">
        <table class="table">
          <thead><tr><th>Item</th><th class="th-right">Qty</th><th class="th-right">Cost</th><th class="th-right">Amount</th></tr></thead>
          <tbody>${items}</tbody>
        </table>
      </div>
      <div style="max-width:300px;margin-left:auto;margin-top:14px">
        <div class="sum-row total"><span class="lbl">Total</span><span>${fmtMoney(purchase.total)}</span></div>
        <div class="sum-row"><span class="lbl">Paid</span><span>${fmtMoney(purchase.paid)}</span></div>
        <div class="sum-row"><span class="lbl">Due</span><span class="${purchase.due ? 'text-amber strong' : ''}">${fmtMoney(purchase.due)}</span></div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-modal-close>Close</button>`,
  });
}

export function render(root) {
  const list = [...db.purchases].sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalValue = sum(list, (p) => p.total);
  const payable = totalPayable();

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Purchases</h2>
        <p>${list.length} purchase${list.length === 1 ? '' : 's'} · ${fmtMoney(totalValue)} total · ${fmtMoney(payable)} payable</p>
      </div>
      <div class="head-actions">
        <button class="btn" id="newPurchase">${icon('plus')} New purchase</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Purchase history</h3>
        <div class="right"><span class="hint">Recording a purchase increases stock automatically</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Purchase</th><th>Date</th><th>Supplier</th><th>Items</th>
            <th class="th-right">Total</th><th class="th-right">Paid</th><th class="th-right">Due</th><th class="th-right">Actions</th>
          </tr></thead>
          <tbody id="purBody">
            ${
              list.length
                ? list
                    .map(
                      (p) => `<tr>
                        <td><div class="cell-title mono">${esc(p.no)}</div></td>
                        <td>${fmtDate(p.date)}</td>
                        <td>${esc(p.supplierName || 'Cash purchase')}</td>
                        <td class="muted">${p.items.length}</td>
                        <td class="num strong">${fmtMoney(p.total)}</td>
                        <td class="num muted">${fmtMoney(p.paid)}</td>
                        <td class="num ${p.due ? 'text-amber strong' : 'muted'}">${p.due ? fmtMoney(p.due) : '—'}</td>
                        <td><div class="row-actions">
                          <button class="icon-btn" data-view="${p.id}" title="View">${icon('eye')}</button>
                          <button class="icon-btn danger" data-del="${p.id}" title="Delete">${icon('trash')}</button>
                        </div></td>
                      </tr>`
                    )
                    .join('')
                : `<tr class="empty-row"><td colspan="8">No purchases recorded yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  root.querySelector('#newPurchase').addEventListener('click', () => {
    if (!db.products.length) return toast('Add products first, then record a purchase', 'warn');
    newPurchaseModal();
  });

  root.querySelector('#purBody').addEventListener('click', async (e) => {
    const view = e.target.closest('[data-view]');
    if (view) {
      const p = db.purchases.find((x) => x.id === view.dataset.view);
      if (p) purchaseModal(p);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const p = db.purchases.find((x) => x.id === del.dataset.del);
      if (!p) return;
      const ok = await confirmDialog({
        title: 'Delete purchase?',
        message: `${p.no} will be removed and the received quantities will be deducted from stock.`,
        confirmText: 'Delete purchase',
        danger: true,
      });
      if (!ok) return;
      p.items.forEach((item) => {
        const product = getProduct(item.productId);
        if (product) product.stock = Math.max(0, round2(Number(product.stock) - Number(item.qty)));
      });
      db.purchases = db.purchases.filter((x) => x.id !== p.id);
      save();
      toast('Purchase deleted and stock adjusted');
      refresh();
    }
  });
}
