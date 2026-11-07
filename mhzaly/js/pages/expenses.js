/* ============================================================
   mhzaly — Expenses
   ============================================================ */

import { db, uid, save } from '../db.js';
import { icon, esc, toast } from '../ui.js';

export function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Expenses</h2>
        <p>Record rent, utilities, salary and other costs.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" id="addExpenseBtn">${icon('plus')} Add Expense</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-pad">
        <table style="width:100%">
          <thead>
            <tr>
              <th style="text-align:left">Title</th>
              <th style="text-align:left">Category</th>
              <th style="text-align:right">Amount</th>
              <th style="text-align:left">Date</th>
            </tr>
          </thead>
          <tbody id="expenseTableBody"></tbody>
        </table>
      </div>
    </div>`;

  function renderTable() {
    root.querySelector('#expenseTableBody').innerHTML = db.expenses.slice().reverse().map((e) => `
      <tr>
        <td>${esc(e.title)}</td>
        <td>${esc(e.category || '')}</td>
        <td style="text-align:right">Rs ${Number(e.amount || 0).toLocaleString()}</td>
        <td>${new Date(e.createdAt).toLocaleDateString('en-GB')}</td>
      </tr>`).join('');
  }
  renderTable();

  root.querySelector('#addExpenseBtn').addEventListener('click', () => {
    const title = prompt('Expense title:');
    if (!title) return;
    const category = prompt('Category (Rent, Utilities, Salary, Other):') || 'Other';
    const amount = Number(prompt('Amount (Rs):') || 0);
    db.expenses.push({ id: uid('exp'), title, category, amount, createdAt: new Date().toISOString() });
    save();
    renderTable();
    toast('Expense recorded');
  });
}
