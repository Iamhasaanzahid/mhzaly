/* ============================================================
   Customers & khata (udhaar)
   ============================================================ */

import { db, save, uid, getCustomer, customerBalance, round2, todayKey } from '../db.js';
import {
  icon, esc, fmtMoney, fmtDate, initials, toast, refresh, openModal, closeModal,
  confirmDialog, emptyState, sum,
} from '../ui.js';

export const meta = { title: 'Customers & Khata', subtitle: 'Udhaar, payments and customer history' };

function customerForm(customer = null) {
  const c = customer || { name: '', phone: '', address: '' };
  return `
    <form id="customerForm" autocomplete="off">
      <div class="form-grid">
        <div class="field full">
          <label>Customer name *</label>
          <input class="input" name="name" required placeholder="e.g. Ahmed Ali" value="${esc(c.name)}" />
        </div>
        <div class="field">
          <label>Phone</label>
          <input class="input" name="phone" placeholder="03xx-xxxxxxx" value="${esc(c.phone || '')}" />
        </div>
        <div class="field">
          <label>Address</label>
          <input class="input" name="address" placeholder="Area / street" value="${esc(c.address || '')}" />
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn">${customer ? 'Save changes' : 'Add customer'}</button>
      </div>
    </form>`;
}

function openCustomerModal(customer = null) {
  const modal = openModal({
    title: customer ? 'Edit customer' : 'Add customer',
    subtitle: customer ? customer.name : 'Keep a record of your regular customers',
    body: customerForm(customer),
  });
  modal.querySelector('#customerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name') || '').trim();
    if (!name) return toast('Customer name is required', 'error');
    const data = {
      name,
      phone: String(fd.get('phone') || '').trim(),
      address: String(fd.get('address') || '').trim(),
    };
    if (customer) {
      Object.assign(customer, data);
      toast('Customer updated');
    } else {
      db.customers.push({ id: uid('cus'), createdAt: new Date().toISOString(), ...data });
      toast('Customer added');
    }
    save();
    closeModal();
    refresh();
  });
}

function paymentModal(customer) {
  const balance = customerBalance(customer.id);
  const modal = openModal({
    title: 'Receive payment',
    subtitle: `${customer.name} · balance ${fmtMoney(balance)}`,
    body: `
      <form id="payForm">
        <div class="form-grid">
          <div class="field">
            <label>Amount received *</label>
            <input class="input" name="amount" type="number" min="0.01" step="any" required value="${balance > 0 ? balance : ''}" />
          </div>
          <div class="field">
            <label>Payment method</label>
            <select class="select" name="method">${['Cash', 'Card', 'Bank'].map((m) => `<option>${m}</option>`).join('')}</select>
          </div>
          <div class="field full">
            <label>Note</label>
            <input class="input" name="note" placeholder="e.g. Khata payment" />
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn">${icon('check')} Save payment</button>
        </div>
      </form>`,
  });
  modal.querySelector('#payForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = Number(fd.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return toast('Enter a valid amount', 'error');
    db.payments.push({
      id: uid('pay'),
      date: new Date().toISOString(),
      type: 'received',
      customerId: customer.id,
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

function ledgerModal(customer) {
  const sales = db.sales.filter((s) => !s.voided && s.customerId === customer.id);
  const payments = db.payments.filter((p) => p.type === 'received' && p.customerId === customer.id);

  const events = [
    ...sales.map((s) => ({
      date: s.date,
      title: s.no,
      sub: `Sale · ${fmtMoney(s.total)}${s.due ? ` · ${fmtMoney(s.due)} on khata` : ' · paid'}`,
      amount: Number(s.due) || 0,
    })),
    ...payments.map((p) => ({
      date: p.date,
      title: 'Payment received',
      sub: `${p.method || 'Cash'}${p.note ? ' · ' + p.note : ''}`,
      amount: -Number(p.amount || 0),
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const rows = events.map((ev) => {
    running += ev.amount;
    return { ...ev, running: round2(running) };
  }).reverse();

  const totalBilled = sum(sales, (s) => s.total);
  const totalPaid = sum(sales, (s) => s.paid) + sum(payments, (p) => p.amount);

  openModal({
    title: customer.name,
    subtitle: `${customer.phone || 'No phone'} · ${customer.address || 'No address'}`,
    size: 'lg',
    body: `
      <div class="stat-strip" style="margin-bottom:16px">
        <div><div class="lbl">Total billed</div><div class="val">${fmtMoney(totalBilled)}</div></div>
        <div><div class="lbl">Total received</div><div class="val text-green">${fmtMoney(totalPaid)}</div></div>
        <div><div class="lbl">Current balance</div><div class="val ${customerBalance(customer.id) > 0 ? 'text-amber' : 'text-green'}">${fmtMoney(customerBalance(customer.id))}</div></div>
      </div>
      ${
        rows.length
          ? `<div class="ledger">
              ${rows
                .map(
                  (r) => `<div class="ledger-row">
                    <span class="ldate">${fmtDate(r.date)}</span>
                    <div><div class="ltitle">${esc(r.title)}</div><div class="lsub">${esc(r.sub)}</div></div>
                    <div class="lamt ${r.amount > 0 ? 'text-amber' : 'text-green'}">${r.amount > 0 ? '+' : '−'} ${fmtMoney(Math.abs(r.amount))}<div class="lsub right">bal ${fmtMoney(r.running)}</div></div>
                  </div>`
                )
                .join('')}
            </div>`
          : `<div class="empty" style="padding:30px"><h4>No khata entries</h4><p>Sales on udhaar and payments will appear here.</p></div>`
      }`,
    footer: `
      <button class="btn btn-ghost" data-modal-close>Close</button>
      <button class="btn" id="receiveFromLedger">${icon('wallet')} Receive payment</button>`,
    onMount: (m) => {
      m.querySelector('#receiveFromLedger').addEventListener('click', () => {
        closeModal();
        setTimeout(() => paymentModal(customer), 60);
      });
    },
  });
}

export function render(root) {
  const list = [...db.customers].sort((a, b) => a.name.localeCompare(b.name));
  const totalDue = sum(list, (c) => Math.max(0, customerBalance(c.id)));
  const withDue = list.filter((c) => customerBalance(c.id) > 0).length;

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Customers & Khata</h2>
        <p>${list.length} customer${list.length === 1 ? '' : 's'} · ${withDue} with pending udhaar · ${fmtMoney(totalDue)} receivable</p>
      </div>
      <div class="head-actions">
        <button class="btn" id="addCustomer">${icon('plus')} Add customer</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>All customers</h3>
        <div class="right"><span class="hint">Balance = udhaar minus payments received</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Customer</th><th>Phone</th><th>Sales</th><th class="th-right">Total billed</th>
            <th class="th-right">Balance</th><th class="th-right">Actions</th>
          </tr></thead>
          <tbody id="cusBody">
            ${
              list.length
                ? list
                    .map((c) => {
                      const bal = customerBalance(c.id);
                      const sales = db.sales.filter((s) => !s.voided && s.customerId === c.id);
                      return `<tr>
                        <td>
                          <div class="flex">
                            <div class="avatar" style="width:32px;height:32px;flex:0 0 32px;background:var(--brand-soft);color:var(--brand-ink)">${esc(initials(c.name))}</div>
                            <div><div class="cell-title">${esc(c.name)}</div><div class="cell-sub">${esc(c.address || 'No address')}</div></div>
                          </div>
                        </td>
                        <td class="muted">${esc(c.phone || '—')}</td>
                        <td class="muted">${sales.length}</td>
                        <td class="num">${fmtMoney(sum(sales, (s) => s.total))}</td>
                        <td class="num ${bal > 0 ? 'text-amber strong' : 'text-green'}">${fmtMoney(bal)}</td>
                        <td><div class="row-actions">
                          <button class="icon-btn" data-pay="${c.id}" title="Receive payment">${icon('wallet')}</button>
                          <button class="icon-btn" data-ledger="${c.id}" title="Khata / history">${icon('receipt')}</button>
                          <button class="icon-btn" data-edit="${c.id}" title="Edit">${icon('edit')}</button>
                          <button class="icon-btn danger" data-del="${c.id}" title="Delete">${icon('trash')}</button>
                        </div></td>
                      </tr>`;
                    })
                    .join('')
                : `<tr class="empty-row"><td colspan="6">No customers yet. Add one to start a khata.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  root.querySelector('#addCustomer').addEventListener('click', () => openCustomerModal());

  root.querySelector('#cusBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.pay || btn.dataset.ledger || btn.dataset.edit || btn.dataset.del;
    const customer = getCustomer(id);
    if (!customer) return;

    if (btn.dataset.pay) return paymentModal(customer);
    if (btn.dataset.ledger) return ledgerModal(customer);
    if (btn.dataset.edit) return openCustomerModal(customer);
    if (btn.dataset.del) {
      const hasHistory =
        db.sales.some((s) => s.customerId === customer.id) ||
        db.payments.some((p) => p.customerId === customer.id);
      if (hasHistory) {
        return toast('This customer has sales history and cannot be deleted', 'error');
      }
      const ok = await confirmDialog({
        title: 'Delete customer?',
        message: `${customer.name} will be removed from your customer list.`,
        confirmText: 'Delete customer',
        danger: true,
      });
      if (!ok) return;
      db.customers = db.customers.filter((c) => c.id !== customer.id);
      save();
      toast('Customer deleted');
      refresh();
    }
  });
}
