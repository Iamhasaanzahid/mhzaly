/* ============================================================
   mhzaly — Expenses
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast, openModal, confirmDialog, downloadFile } from '../ui.js';
import { money } from '../receipt-share.js';
import { toCsv } from '../csv.js';

const CATEGORIES = ['Rent', 'Utilities', 'Salary', 'Transport', 'Other'];

function rangeStart(range) {
  if (range === 'all') return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === 'today') return d;
  const days = Number(range);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Expenses</h2>
        <p>Record rent, utilities, salary and other costs.</p>
      </div>
      <div class="head-actions">
        <select class="input" id="expenseRange" style="width:auto;min-width:130px">
          <option value="all" selected>All time</option>
          <option value="today">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button class="btn btn-ghost" id="exportExpenses">${icon('download')} Export CSV</button>
        <button class="btn btn-primary" id="addExpenseBtn">${icon('plus')} Add Expense</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head"><h3>Expense records</h3><span class="right" id="expenseTotal">—</span></div>
      <div class="card-pad">
        <div class="filter-row">
          <div class="field grow">
            <label>Search</label>
            <input class="input" id="expenseSearch" placeholder="Title, category or note" />
          </div>
          <div class="field">
            <label>Category</label>
            <select class="input" id="expenseCategory"></select>
          </div>
        </div>
        <div class="table-wrap">
          <table style="width:100%;margin-top:10px">
            <thead>
              <tr>
                <th style="text-align:left">Title</th>
                <th style="text-align:left">Category</th>
                <th style="text-align:left">Paid via</th>
                <th style="text-align:right">Amount</th>
                <th style="text-align:left">Date</th>
                <th style="width:70px"></th>
              </tr>
            </thead>
            <tbody id="expenseTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const searchEl = root.querySelector('#expenseSearch');
  const rangeEl = root.querySelector('#expenseRange');
  const categoryEl = root.querySelector('#expenseCategory');

  function paintCategories() {
    const current = categoryEl.value || 'all';
    const list = [...new Set([...CATEGORIES, ...db.expenses.map((e) => e.category || 'Other')])].sort((a, b) => a.localeCompare(b));
    categoryEl.innerHTML = `<option value="all">All categories</option>${list
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join('')}`;
    categoryEl.value = list.includes(current) ? current : 'all';
  }

  function filtered() {
    const q = String(searchEl.value || '').toLowerCase().trim();
    const from = rangeStart(rangeEl.value);
    const category = categoryEl.value;
    return db.expenses
      .filter((e) => {
        const matchesQuery =
          !q ||
          String(e.title || '').toLowerCase().includes(q) ||
          String(e.category || '').toLowerCase().includes(q) ||
          String(e.method || '').toLowerCase().includes(q) ||
          String(e.note || '').toLowerCase().includes(q);
        const matchesRange = !from || new Date(e.createdAt || 0) >= from;
        const matchesCategory = category === 'all' || (e.category || 'Other') === category;
        return matchesQuery && matchesRange && matchesCategory;
      })
      .slice()
      .reverse();
  }

  function renderTable() {
    const list = filtered();
    const totalEl = root.querySelector('#expenseTotal');
    if (totalEl) {
      const total = list.reduce((a, e) => a + (Number(e.amount) || 0), 0);
      totalEl.textContent = `${list.length} entries · ${money(total)}`;
    }
    if (!list.length) {
      root.querySelector('#expenseTableBody').innerHTML = `
        <tr><td colspan="6"><div class="empty-state">Is filter mein koi expense record nahi.</div></td></tr>`;
      return;
    }
    root.querySelector('#expenseTableBody').innerHTML = list
      .map(
        (e) => `
      <tr>
        <td><b>${esc(e.title)}</b>${e.note ? `<div class="pos-meta">${esc(e.note)}</div>` : ''}</td>
        <td><span class="badge neutral">${esc(e.category || 'Other')}</span></td>
        <td><span class="badge ${e.method === 'Cash' || !e.method ? 'ok' : 'teal'}">${esc(e.method || 'Cash')}</span></td>
        <td style="text-align:right">${money(e.amount)}</td>
        <td>${new Date(e.createdAt).toLocaleDateString('en-GB')}</td>
        <td style="text-align:right">
          <button class="btn btn-ghost btn-sm" data-del="${esc(e.id)}" title="Delete">${icon('trash')}</button>
        </td>
      </tr>`
      )
      .join('');
  }

  paintCategories();
  renderTable();
  searchEl.addEventListener('input', renderTable);
  rangeEl.addEventListener('change', renderTable);
  categoryEl.addEventListener('change', renderTable);

  function openForm() {
    openModal({
      title: 'Add expense',
      subtitle: 'Dukaan ka kharcha record karein',
      body: `
        <div class="owner-form-grid">
          <label style="grid-column:1/-1">Title
            <input id="efTitle" placeholder="e.g. Electricity bill" />
          </label>
          <label>Category
            <select id="efCategory">
              ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </label>
          <label>Paid via
            <select id="efMethod">
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="Online">Online / Bank</option>
            </select>
          </label>
          <label>Amount (${esc(db.settings.currency || 'Rs')})
            <input id="efAmount" type="number" min="0" step="0.01" placeholder="0" />
          </label>
          <label>Date
            <input id="efDate" type="date" value="${new Date().toISOString().slice(0, 10)}" />
          </label>
          <label>Note (optional)
            <input id="efNote" placeholder="details" />
          </label>
        </div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
               <button class="btn btn-primary" id="efSave">${icon('check')} Add expense</button>`,
      onMount: (bd) => {
        bd.querySelector('[data-cancel]').addEventListener('click', () => bd.remove());
        const doSave = () => {
          const title = bd.querySelector('#efTitle').value.trim();
          const amount = Number(bd.querySelector('#efAmount').value || 0);
          if (!title) return toast('Expense ka title likhein', 'error');
          if (amount <= 0) return toast('Amount 0 se zyada likhein', 'error');
          const dateVal = bd.querySelector('#efDate').value;
          db.expenses.push({
            id: uid('exp'),
            title,
            category: bd.querySelector('#efCategory').value,
            method: bd.querySelector('#efMethod').value || 'Cash',
            amount,
            note: bd.querySelector('#efNote').value.trim(),
            createdAt: dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : new Date().toISOString(),
          });
          save();
          paintCategories();
          renderTable();
          toast('Expense recorded', 'success');
          bd.remove();
        };
        bd.querySelector('#efSave').addEventListener('click', doSave);
        bd.querySelector('#efTitle').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') doSave();
        });
        setTimeout(() => bd.querySelector('#efTitle').focus(), 60);
      },
    });
  }

  root.querySelector('#addExpenseBtn').addEventListener('click', openForm);

  root.querySelector('#expenseTableBody').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const item = db.expenses.find((x) => x.id === del.dataset.del);
    if (!item) return;
    confirmDialog(`"${item.title}" delete karein?`, () => {
      db.expenses = db.expenses.filter((x) => x.id !== item.id);
      save();
      paintCategories();
      renderTable();
      toast('Expense deleted', 'success');
    });
  });

  root.querySelector('#exportExpenses').addEventListener('click', () => {
    const rows = [['Date', 'Title', 'Category', 'Paid via', 'Amount', 'Note']];
    for (const e of filtered()) {
      rows.push([
        new Date(e.createdAt).toISOString().slice(0, 10),
        e.title || '',
        e.category || 'Other',
        e.method || 'Cash',
        Number(e.amount) || 0,
        e.note || '',
      ]);
    }
    downloadFile(`mhzaly-expenses-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
    toast('Expenses exported', 'success');
  });
}
