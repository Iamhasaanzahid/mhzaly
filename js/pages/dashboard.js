/* ============================================================
   Dashboard
   ============================================================ */

import {
  db, activeSales, todayKey, dayKey, addDaysKey, lowStockProducts,
  totalReceivable, totalPayable, saleProfit, stockValue, round2, loadSampleData,
} from '../db.js';
import {
  icon, esc, fmtMoney, fmtNum, fmtQty, fmtDate, fmtTime, navigate, emptyState, sum, toast, refresh,
} from '../ui.js';

export const meta = { title: 'Dashboard', subtitle: 'A quick look at your shop today' };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function chart(days) {
  const max = Math.max(...days.map((d) => d.total), 1);
  return `
    <div class="chart-bars">
      ${days
        .map(
          (d) => `
        <div class="chart-col" title="${esc(d.label)}: ${fmtMoney(d.total)}">
          <div class="chart-val">${d.total ? fmtNum(Math.round(d.total)) : ''}</div>
          <div class="chart-bar-track">
            <div class="chart-bar ${d.total ? '' : 'zero'}" style="height:${Math.max((d.total / max) * 100, 2)}%"></div>
          </div>
          <div class="chart-label">${esc(d.label)}</div>
        </div>`
        )
        .join('')}
    </div>`;
}

export function render(root) {
  if (!db.products.length && !db.sales.length) {
    root.innerHTML = `
      <div class="page-head">
        <div class="grow">
          <h2>${greeting()}${db.settings.ownerName ? ', ' + esc(db.settings.ownerName) : ''} 👋</h2>
          <p>Let's set up your shop in a couple of minutes.</p>
        </div>
      </div>
      <div class="card">
        <div class="empty" style="padding:54px 22px">
          <div class="art">${icon('bag')}</div>
          <h4>Welcome to mhzaly</h4>
          <p>Track your products, bill customers, manage udhaar khata and see your profit — all from one simple app. Aap ka data aap ke shop account ke saath cloud mein safe rehta hai.</p>
          <div class="flex" style="margin-top:16px;justify-content:center;flex-wrap:wrap">
            <button class="btn" data-go="products">${icon('plus')} Add your first product</button>
            <button class="btn btn-ghost" id="loadSample">${icon('sparkle')} Explore with demo data</button>
          </div>
          <p class="xsmall" style="margin-top:14px">Demo data can be removed any time from Settings.</p>
        </div>
      </div>`;
    root.querySelector('#loadSample').addEventListener('click', () => {
      loadSampleData();
      toast('Demo shop loaded — take a look around!');
      refresh();
    });
    return;
  }

  const today = todayKey();
  const yKey = addDaysKey(-1);
  const all = activeSales();
  const todays = all.filter((s) => dayKey(s.date) === today);
  const yesterday = all.filter((s) => dayKey(s.date) === yKey);

  const todayTotal = sum(todays, (s) => s.total);
  const todayProfit = sum(todays, (s) => saleProfit(s));
  const yTotal = sum(yesterday, (s) => s.total);
  const delta = yTotal > 0 ? Math.round(((todayTotal - yTotal) / yTotal) * 100) : null;
  const margin = todayTotal > 0 ? Math.round((todayProfit / todayTotal) * 100) : 0;

  const receivable = totalReceivable();
  const payable = totalPayable();
  const low = lowStockProducts();
  const lowCount = low.length;

  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const key = addDaysKey(-i);
    const total = sum(all.filter((s) => dayKey(s.date) === key), (s) => s.total);
    days.push({
      key,
      label: i === 0 ? 'Today' : new Date(key + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' }),
      total,
    });
  }

  const since = addDaysKey(-30);
  const productStats = new Map();
  all
    .filter((s) => dayKey(s.date) >= since)
    .forEach((s) => {
      s.items.forEach((item) => {
        const cur = productStats.get(item.productId) || { name: item.name, qty: 0, revenue: 0 };
        cur.qty += Number(item.qty) || 0;
        cur.revenue += (Number(item.qty) || 0) * (Number(item.price) || 0);
        productStats.set(item.productId, cur);
      });
    });
  const top = [...productStats.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

  const recent = [...all].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 7);

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>${greeting()}${db.settings.ownerName ? ', ' + esc(db.settings.ownerName) : ''} 👋</h2>
        <p>Here is what is happening at ${esc(db.settings.shopName || 'your shop')} today.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" data-go="products">${icon('plus')} Add product</button>
        <button class="btn" data-go="pos">${icon('cart')} New sale</button>
      </div>
    </div>

    ${
      db.sales.length === 0
        ? `<div class="alert-box" style="background:#f0fdfa;border-color:#99f6e4;color:#115e59;margin-bottom:16px">
            ${icon('sparkle')}
            <div>
              <b>Welcome to mhzaly!</b> Aap ke liye 12 common products already add kar diye hain (rice, oil, sugar, milk, tea…)
              starting stock 10 ke saath. Apne hisaab se stock adjust karein, phir pehli sale banayein.
              <div class="flex flex-wrap" style="gap:8px;margin-top:8px">
                <a class="btn btn-sm" href="#/products">Adjust stock</a>
                <a class="btn btn-sm btn-ghost" href="#/pos">Make first sale</a>
              </div>
            </div>
          </div>`
        : ''
    }

    <div class="grid k4">
      <div class="card kpi">
        <div class="label">${icon('cart')} Today's sales</div>
        <div class="icon-bubble">${icon('cart')}</div>
        <div class="value">${fmtMoney(todayTotal)}</div>
        <div class="foot">${todays.length} invoice${todays.length === 1 ? '' : 's'}
          ${delta === null ? '' : `<span class="${delta >= 0 ? 'up' : 'down'}">· ${delta >= 0 ? '+' : ''}${delta}% vs yesterday</span>`}
        </div>
      </div>
      <div class="card kpi green">
        <div class="label">${icon('chart')} Today's profit</div>
        <div class="icon-bubble">${icon('arrow-up')}</div>
        <div class="value">${fmtMoney(todayProfit)}</div>
        <div class="foot">${margin}% margin on today's sales</div>
      </div>
      <div class="card kpi amber">
        <div class="label">${icon('users')} Udhaar / receivable</div>
        <div class="icon-bubble">${icon('wallet')}</div>
        <div class="value">${fmtMoney(receivable)}</div>
        <div class="foot">${fmtMoney(payable)} payable to suppliers</div>
      </div>
      <div class="card kpi ${lowCount ? 'red' : 'green'}">
        <div class="label">${icon('alert')} Low stock items</div>
        <div class="icon-bubble">${icon('box')}</div>
        <div class="value">${lowCount}</div>
        <div class="foot">${db.products.length} products · stock value ${fmtMoney(stockValue())}</div>
      </div>
    </div>

    <div class="grid k2-wide mt">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Sales — last 7 days</h3>
            <div class="hint">Total ${fmtMoney(sum(days, (d) => d.total))} this week</div>
          </div>
          <div class="right"><span class="badge teal">${all.filter((s) => dayKey(s.date) >= days[0].key).length} invoices</span></div>
        </div>
        <div class="card-pad">${chart(days)}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Low stock alerts</h3>
          <div class="right"><a class="small" href="#/products">View all</a></div>
        </div>
        <div class="card-pad" style="padding-top:6px;padding-bottom:6px">
          ${
            low.length
              ? `<div class="mini-list">
                  ${low
                    .slice(0, 5)
                    .map(
                      (p) => `<div class="mini-item">
                        <div class="rank">${icon('box')}</div>
                        <div class="grow">
                          <div class="name">${esc(p.name)}</div>
                          <div class="sub">${esc(p.category || 'Uncategorised')} · alert at ${fmtQty(p.lowStock)}</div>
                        </div>
                        <div class="val">${Number(p.stock) <= 0 ? '<span class="badge red">Out</span>' : `<span class="badge amber">${fmtQty(p.stock)} left</span>`}</div>
                      </div>`
                    )
                    .join('')}
                </div>`
              : `<div class="empty" style="padding:34px 10px">
                  <div class="art" style="width:48px;height:48px">${icon('check')}</div>
                  <h4>All stocked up</h4>
                  <p>No product is below its low-stock alert level.</p>
                </div>`
          }
        </div>
      </div>
    </div>

    <div class="grid k2-wide mt">
      <div class="card">
        <div class="card-head">
          <h3>Recent sales</h3>
          <div class="right"><a class="small" href="#/sales">All sales</a></div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Time</th><th class="th-right">Total</th><th></th></tr></thead>
            <tbody>
              ${
                recent.length
                  ? recent
                      .map(
                        (s) => `<tr>
                          <td><div class="cell-title mono">${esc(s.no)}</div><div class="cell-sub">${fmtDate(s.date)}</div></td>
                          <td>${esc(s.customerName || 'Walk-in')}</td>
                          <td class="muted">${fmtTime(s.date)}</td>
                          <td class="num strong">${fmtMoney(s.total)}</td>
                          <td class="right"><button class="icon-btn" data-view-sale="${esc(s.id)}" title="View">${icon('eye')}</button></td>
                        </tr>`
                      )
                      .join('')
                  : `<tr class="empty-row"><td colspan="5">No sales yet. <a href="#/pos">Create your first sale</a>.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Top products</h3>
          <div class="hint">last 30 days</div>
        </div>
        <div class="card-pad" style="padding-top:6px;padding-bottom:6px">
          ${
            top.length
              ? `<div class="mini-list">
                  ${top
                    .map(
                      (p, i) => `<div class="mini-item">
                        <div class="rank">${i + 1}</div>
                        <div class="grow">
                          <div class="name">${esc(p.name)}</div>
                          <div class="sub">${fmtQty(p.qty)} sold</div>
                        </div>
                        <div class="val">${fmtMoney(p.revenue)}</div>
                      </div>`
                    )
                    .join('')}
                </div>`
              : `<div class="empty" style="padding:34px 10px">
                  <div class="art" style="width:48px;height:48px">${icon('chart')}</div>
                  <h4>No sales data yet</h4>
                  <p>Your best-selling products will appear here.</p>
                </div>`
          }
        </div>
      </div>
    </div>`;

  root.querySelectorAll('[data-view-sale]').forEach((btn) =>
    btn.addEventListener('click', () => {
      navigate('#/sales?view=' + btn.dataset.viewSale);
    })
  );
}
