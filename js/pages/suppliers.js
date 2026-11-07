/* ============================================================
   Suppliers
   ============================================================ */

import { db, save, uid, getSupplier, supplierBalance, round2 } from '../db.js';
import {
  icon, esc, fmtMoney, fmtDate, initials, toast, refresh, openModal, closeModal,
  confirmDialog, sum,
} from '../ui.js';

export const meta = { title: 'Suppliers', subtitle: 'Who you buy stock from and what you owe' };

function supplierForm(supplier = null) {
  const s = supplier || { name: '', phone: '', address: '', notes: '' };
  return `
    <form id="supplierForm" autocomplete="off">
      <div class="form-grid">
        <div class="field full">
          <label>Supplier / company name *</label>
          <input class="input" name="name" required placeholder="e.g. Metro Wholesale" value="${esc(s.name)}" />
        </div>
        <div class="field">
          <label>Phone</label>
          <input class="input" name="phone" placeholder="042-xxxxxxx" value="${esc(s.phone || '')}" />
        </div>
        <div class="field">
          <label>Address</label>
          <input class="input" name="address" placeholder="Market / area" value="${esc(s.address || '')}" />
        </div>
        <div class="field full">
          <label>Notes</label>
          <input class="input" name="notes" placeholder="Delivery days, contact person, etc." value="${esc(s.notes || '')}" />
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn">${supplier ? 'Save changes' : 'Add supplier'}</button>
      </div>
    </form>`;
}

function openSupplierModal(supplier = null) {
  const modal = openModal({
    title: supplier ? 'Edit supplier' : 'Add supplier',
    subtitle: supplier ? supplier.name : 'Record the wholesalers you buy from',
    body: supplierForm(supplier),
  });
  modal.querySelector('#supplierForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name') || '').trim();
    if (!name) return toast('Supplier name is required', 'error');
    const data = {
      name,
      phone: String(fd.get('phone') || '').trim(),
      address: String(fd.get('address') || '').trim(),
      notes: String(fd.get('notes') || '').trim(),
    };
    if (supplier) {
      Object.assign(supplier, data);
      toast('Supplier updated');
    } else {
      db.suppliers.push({ id: uid('sup'), createdAt: new Date().toISOString(), ...data });
      toast('Supplier added');
    }
    save();
    closeModal();
    refresh();
  });
}

function payModal(supplier) {
  const balance = supplierBalance(supplier.id);
  const modal = openModal({
    title: 'Pay supplier',
    subtitle: `${supplier.name} · payable ${fmtMoney(balance)}`,
    body: `
      <form id="supPayForm">
        <div class="form-grid">
          <div class="field">
            <label>Amount paid *</label>
            <input class="input" name="amount" type="number" min="0.01" step="any" required value="${balance > 0 ? balance : ''}" />
          </div>
          <div class="field">
            <label>Method</label>
            <select class="select" name="method">${['Cash', 'Bank', 'Card'].map((m) => `<option>${m}</option>`).join('')}</select>
          </div>
          <div class="field full">
            <label>Note</label>
            <input class="input" name="note" placeholder="e.g. Weekly payment" />
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn">${icon('check')} Save payment</button>
        </div>
      </form>`,
  });
  modal.querySelector('#supPayForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = Number(fd.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return toast('Enter a valid amount', 'error');
    db.payments.push({
      id: uid('pay'),
      date: new Date().toISOString(),
      type: 'paid',
      supplierId: supplier.id,
      amount: round2(amount),
      method: String(fd.get('method') || 'Cash'),
      note: String(fd.get('note') || '').trim(),
    });
    save();
    closeModal();
    toast(`Payment of ${fmtMoney(amount)} recorded`);
    refresh();
  });
}

function historyModal(supplier) {
  const purchases = db.purchases.filter((p) => p.supplierId === supplier.id);
  const payments = db.payments.filter((p) => p.type === 'paid' && p.supplierId === supplier.id);
  const events = [
    ...purchases.map((p) => ({ date: p.date, title: p.no, sub: `Purchase · ${p.items.length} items`, amount: Number(p.total) || 0 })),
    ...payments.map((p) => ({ date: p.date, title: 'Payment paid', sub: `${p.method || 'Cash'}${p.note ? ' · ' + p.note : ''}`, amount: -Number(p.amount || 0) })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  openModal({
    title: supplier.name,
    subtitle: `${supplier.phone || 'No phone'} · ${supplier.address || 'No address'}`,
    size: 'lg',
    body: `
      <div class="stat-strip" style="margin-bottom:16px">
        <div><div class="lbl">Total purchased</div><div class="val">${fmtMoney(sum(purchases, (p) => p.total))}</div></div>
        <div><div class="lbl">Total paid</div><div class="val text-green">${fmtMoney(sum(purchases, (p) => p.paid) + sum(payments, (p) => p.amount))}</div></div>
        <div><div class="lbl">Payable</div><div class="val ${supplierBalance(supplier.id) > 0 ? 'text-amber' : 'text-green'}">${fmtMoney(supplierBalance(supplier.id))}</div></div>
      </div>
      ${
        events.length
          ? `<div class="ledger">${events
              .map(
                (r) => `<div class="ledger-row">
                  <span class="ldate">${fmtDate(r.date)}</span>
                  <div><div class="ltitle">${esc(r.title)}</div><div class="lsub">${esc(r.sub)}</div></div>
                  <div class="lamt ${r.amount > 0 ? 'text-amber' : 'text-green'}">${r.amount > 0 ? '+' : '−'} ${fmtMoney(Math.abs(r.amount))}</div>
                </div>`
              )
              .join('')}</div>`
          : `<div class="empty" style="padding:30px"><h4>No activity</h4><p>Purchases and payments will appear here.</p></div>`
      }`,
    footer: `<button class="btn btn-ghost" data-modal-close>Close</button>`,
  });
}

export function render(root) {
  const list = [...db.suppliers].sort((a, b) => a.name.localeCompare(b.name));
  const payable = sum(list, (s) => Math.max(0, supplierBalance(s.id)));

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Suppliers</h2>
        <p>${list.length} supplier${list.length === 1 ? '' : 's'} · ${fmtMoney(payable)} total payable</p>
      </div>
      <div class="head-actions">
        <button class="btn" id="addSupplier">${icon('plus')} Add supplier</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>All suppliers</h3>
        <div class="right"><span class="hint">Record purchases from the Purchases page</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Supplier</th><th>Phone</th><th>Purchases</th><th class="th-right">Total purchased</th>
            <th class="th-right">Payable</th><th class="th-right">Actions</th>
          </tr></thead>
          <tbody id="supBody">
            ${
              list.length
                ? list
                    .map((s) => {
                      const purchases = db.purchases.filter((p) => p.supplierId === s.id);
                      const bal = supplierBalance(s.id);
                      return `<tr>
                        <td>
                          <div class="flex">
                            <div class="avatar" style="width:32px;height:32px;flex:0 0 32px;background:var(--blue-soft);color:var(--blue)">${esc(initials(s.name))}</div>
                            <div><div class="cell-title">${esc(s.name)}</div><div class="cell-sub">${esc(s.notes || s.address || '—')}</div></div>
                          </div>
                        </td>
                        <td class="muted">${esc(s.phone || '—')}</td>
                        <td class="muted">${purchases.length}</td>
                        <td class="num">${fmtMoney(sum(purchases, (p) => p.total))}</td>
                        <td class="num ${bal > 0 ? 'text-amber strong' : 'text-green'}">${fmtMoney(bal)}</td>
                        <td><div class="row-actions">
                          <button class="icon-btn" data-pay="${s.id}" title="Pay supplier">${icon('wallet')}</button>
                          <button class="icon-btn" data-history="${s.id}" title="History">${icon('receipt')}</button>
                          <button class="icon-btn" data-edit="${s.id}" title="Edit">${icon('edit')}</button>
                          <button class="icon-btn danger" data-del="${s.id}" title="Delete">${icon('trash')}</button>
                        </div></td>
                      </tr>`;
                    })
                    .join('')
                : `<tr class="empty-row"><td colspan="6">No suppliers yet. Add one when you record a purchase.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  root.querySelector('#addSupplier').addEventListener('click', () => openSupplierModal());

  root.querySelector('#supBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.pay || btn.dataset.history || btn.dataset.edit || btn.dataset.del;
    const supplier = getSupplier(id);
    if (!supplier) return;

    if (btn.dataset.pay) return payModal(supplier);
    if (btn.dataset.history) return historyModal(supplier);
    if (btn.dataset.edit) return openSupplierModal(supplier);
    if (btn.dataset.del) {
      const hasHistory =
        db.purchases.some((p) => p.supplierId === supplier.id) ||
        db.payments.some((p) => p.supplierId === supplier.id);
      if (hasHistory) {
        return toast('This supplier has purchase history and cannot be deleted', 'error');
      }
      const ok = await confirmDialog({
        title: 'Delete supplier?',
        message: `${supplier.name} will be removed from your supplier list.`,
        confirmText: 'Delete supplier',
        danger: true,
      });
      if (!ok) return;
      db.suppliers = db.suppliers.filter((s) => s.id !== supplier.id);
      save();
      toast('Supplier deleted');
      refresh();
    }
  });
}
