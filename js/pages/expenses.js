/* ============================================================
   Expenses
   ============================================================ */

import { db, save, uid, round2, dayKey, todayKey } from '../db.js';
import {
  icon, esc, fmtMoney, fmtDate, toast, refresh, openModal, closeModal,
  confirmDialog, sum, todayInput,
} from '../ui.js';

export const meta = { title: 'Expenses', subtitle: 'Shop running costs and bills' };

const CATS = ['Rent', 'Utilities', 'Salary', 'Transport', 'Supplies', 'Marketing', 'Repairs', 'Other'];

function expenseModal() {
  const modal = openModal({
    title: 'Add expense',
    subtitle: 'Record a shop cost so your profit stays accurate',
    body: `
      <form id="expenseForm">
        <div class="form-grid">
          <div class="field">
            <label>Date</label>
            <input class="input" type="date" name="date" value="${todayInput()}" required />
          </div>
          <div class="field">
            <label>Category</label>
            <input class="input" name="category" list="expCats" value="Utilities" required />
            <datalist id="expCats">${CATS.map((c) => `<option value="${c}"></option>`).join('')}</datalist>
          </div>
          <div class="field full">
            <label>Amount *</label>
            <input class="input" name="amount" type="number" min="0.01" step="any" required placeholder="0" />
          </div>
          <div class="field full">
            <label>Note</label>
            <input class="input" name="note" placeholder="e.g. Electricity bill for October" />
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn">${icon('plus')} Add expense</button>
        </div>
      </form>`,
  });
  modal.querySelector('#expenseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = Number(fd.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return toast('Enter a valid amount', 'error');
    const dateVal = String(fd.get('date') || '');
    const when = dateVal ? new Date(`${dateVal}T${new Date().toTimeString().slice(0, 8)}`).toISOString() : new Date().toISOString();
    db.expenses.push({
      id: uid('exp'),
      date: when,
      category: String(fd.get('category') || 'Other').trim() || 'Other',
      amount: round2(amount),
      note: String(fd.get('note') || '').trim(),
    });
    save();
    closeModal();
    toast('Expense added');
    refresh();
  });
}

export function render(root) {
  const list = [...db.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
  const month = todayKey().slice(0, 7);
  const monthList = list.filter((e) => dayKey(e.date).startsWith(month));
  const monthTotal = sum(monthList, (e) => e.amount);
  const allTotal = sum(list, (e) => e.amount);

  const byCat = {};
  monthList.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Expenses</h2>
        <p>${fmtMoney(monthTotal)} spent this month · ${fmtMoney(allTotal)} recorded in total</p>
      </div>
      <div class="head-actions">
        <button class="btn" id="addExpense">${icon('plus')} Add expense</button>
      </div>
    </div>

    <div class="grid k3">
      <div class="card kpi">
        <div class="label">${icon('calendar')} This month</div>
        <div class="icon-bubble">${icon('wallet')}</div>
        <div class="value">${fmtMoney(monthTotal)}</div>
        <div class="foot">${monthList.length} expense${monthList.length === 1 ? '' : 's'}</div>
      </div>
      <div class="card kpi blue">
        <div class="label">${icon('chart')} Biggest category</div>
        <div class="icon-bubble">${icon('chart')}</div>
        <div class="value" style="font-size:20px">${topCat ? esc(topCat[0]) : '—'}</div>
        <div class="foot">${topCat ? fmtMoney(topCat[1]) + ' this month' : 'No expenses this month'}</div>
      </div>
      <div class="card kpi green">
        <div class="label">${icon('receipt')} All time</div>
        <div class="icon-bubble">${icon('receipt')}</div>
        <div class="value">${fmtMoney(allTotal)}</div>
        <div class="foot">${list.length} total entries</div>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head">
        <h3>Expense history</h3>
        <div class="right"><span class="hint">Deducted from net profit in Reports</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="th-right">Amount</th><th class="th-right"></th></tr></thead>
          <tbody id="expBody">
            ${
              list.length
                ? list
                    .map(
                      (e) => `<tr>
                        <td>${fmtDate(e.date)}</td>
                        <td><span class="badge">${esc(e.category)}</span></td>
                        <td class="muted">${esc(e.note || '—')}</td>
                        <td class="num strong">${fmtMoney(e.amount)}</td>
                        <td><div class="row-actions"><button class="icon-btn danger" data-del="${e.id}" title="Delete">${icon('trash')}</button></div></td>
                      </tr>`
                    )
                    .join('')
                : `<tr class="empty-row"><td colspan="5">No expenses recorded yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  root.querySelector('#addExpense').addEventListener('click', () => expenseModal());

  root.querySelector('#expBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const ok = await confirmDialog({
      title: 'Delete expense?',
      message: 'This expense entry will be removed from your records.',
      confirmText: 'Delete expense',
      danger: true,
    });
    if (!ok) return;
    db.expenses = db.expenses.filter((x) => x.id !== btn.dataset.del);
    save();
    toast('Expense deleted');
    refresh();
  });
}
