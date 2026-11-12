/* ============================================================
   mhzaly — Profit Leak Finder
   Finds where money is leaking out of the shop and estimates
   how much can be recovered. Fully offline, no API needed.
   ============================================================ */

import { db } from '../db.js';
import { icon, esc, toast, downloadFile } from '../ui.js';
import { money } from '../receipt-share.js';
import { profitLeaks } from '../insights.js';
import { toCsv } from '../csv.js';

export const meta = { title: 'Profit Leak Finder', subtitle: 'Paisa kahan jaa raha hai' };

const KIND_LABEL = {
  'loss-price': 'Loss price',
  'thin-margin': 'Thin margin',
  discount: 'Excess discount',
  expense: 'Heavy expense',
  'dead-stock': 'Dead stock',
  'over-stock': 'Over stock',
  'pricing-upside': 'Pricing upside',
};

export function render(root) {
  const result = profitLeaks();
  const leaks = result.leaks;
  const moneyLeak = leaks.filter((l) => l.kind !== 'pricing-upside');
  const upside = leaks.find((l) => l.kind === 'pricing-upside');

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Profit Leak Finder</h2>
        <p>mhzaly aap ke poore data ko scan karta hai aur batata hai ke paisa kahan leak ho raha hai — aur kitna wapas mil sakta hai.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="leakExport">${icon('download')} Export CSV</button>
        <button class="btn btn-primary" id="leakWhats">${icon('sparkle')} WhatsApp plan</button>
      </div>
    </div>

    <div class="stat-strip">
      <div><div class="lbl">Leaks found</div><div class="val">${moneyLeak.length}</div></div>
      <div><div class="lbl">Money on the table</div><div class="val">${money(result.recoverable)}</div></div>
      <div><div class="lbl">Pricing upside</div><div class="val">${money(result.upside)}</div></div>
      <div><div class="lbl">30-day revenue</div><div class="val">${money(result.revenue)}</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Leak report</h3>
        <span class="right">${leaks.length ? 'Har leak ka estimated recovery' : 'Koi leak nahi mila'}</span>
      </div>
      <div class="card-pad">
        ${
          leaks.length
            ? `<div class="leak-list">${leaks
                .map(
                  (leak) => `
          <div class="leak-item ${leak.tone}">
            <div class="leak-ico">${icon(leak.kind === 'pricing-upside' ? 'check' : 'alert')}</div>
            <div class="grow">
              <div class="leak-title">${esc(leak.title)}</div>
              <div class="leak-detail">${esc(leak.detail)}</div>
              <div class="leak-action">→ ${esc(leak.action)}</div>
            </div>
            <div class="leak-amount">
              <span class="badge ${leak.tone === 'ok' ? 'ok' : leak.tone}">${KIND_LABEL[leak.kind] || leak.kind}</span>
              <b>${leak.kind === 'pricing-upside' ? '+' : ''}${money(leak.amount)}</b>
            </div>
          </div>`
                )
                .join('')}</div>`
            : `<div class="empty-state">Aap ka data bilkul saaf hai — koi leak nahi mila. 🎉</div>`
        }
      </div>
    </div>

    <div class="card mt">
      <div class="card-head"><h3>Ye kaise kaam karta hai</h3></div>
      <div class="card-pad">
        <div class="insight-grid">
          <div class="insight-tile">
            <b>Loss price</b>
            <span>Jis product ki price uske cost se neeche hai — har sale mein nuqsaan.</span>
          </div>
          <div class="insight-tile">
            <b>Thin margin</b>
            <span>Jo products tez bikte hain lekin margin 12% se kam rakhte hain.</span>
          </div>
          <div class="insight-tile">
            <b>Dead / over stock</b>
            <span>60 din se bikne wala maal aur demand se zyada khareeda hua stock.</span>
          </div>
          <div class="insight-tile">
            <b>Discount abuse</b>
            <span>Jab discount sales ka 4% se zyada kha jaye, profit dheere dheere khatam hota hai.</span>
          </div>
          <div class="insight-tile">
            <b>Heavy expense</b>
            <span>Expense categories jo revenue ka 6% se zyada kha rahi hain.</span>
          </div>
          <div class="insight-tile">
            <b>Pricing upside</b>
            <span>Tez bikne wale products jinka margin 25% se kam hai — price thora barha kar margin behtar ho sakta hai.</span>
          </div>
        </div>
        <p class="small muted" style="margin:12px 0 0">Har leak ka amount ek estimate hai — actual recovery aap ke action par depend karta hai.</p>
      </div>
    </div>`;

  root.querySelector('#leakExport').addEventListener('click', () => {
    const rows = [['Type', 'Leak', 'Detail', 'Estimated recovery', 'Recommended action']];
    for (const leak of leaks) {
      rows.push([
        KIND_LABEL[leak.kind] || leak.kind,
        leak.title,
        leak.detail,
        leak.amount,
        leak.action,
      ]);
    }
    downloadFile(`mhzaly-profit-leaks-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
    toast('Leak report exported', 'success');
  });

  root.querySelector('#leakWhats').addEventListener('click', () => {
    const shop = db.settings.shopName || 'My Mart';
    const lines = [
      `*${shop} — Profit Leak Report*`,
      `Pichhle 30 din ke hisab se ${moneyLeak.length} leak mile hain.`,
      '',
    ];
    for (const leak of leaks.slice(0, 12)) {
      lines.push(`• ${leak.title} — ${money(leak.amount)}`);
      lines.push(`  ${leak.action}`);
    }
    lines.push('', `Total money on the table: *${money(result.recoverable)}*`, '_Generated by mhzaly — offline business intelligence_');
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  });
}
