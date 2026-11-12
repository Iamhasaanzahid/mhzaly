/* ============================================================
   mhzaly — customer & supplier statements / ledger
   Works fully offline from the local shop database.
   ============================================================ */

import { db } from './db.js';
import { icon, esc, initials, openModal, toast, downloadFile } from './ui.js';
import { money, escapeHtml, normalizePhone } from './receipt-share.js';
import { currentTaxSystem } from './tax.js';
import { toCsv } from './csv.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function norm(value) {
  return String(value || '').trim().toLowerCase();
}
function samePhone(a, b) {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  return Boolean(x && y && x === y);
}
function refundTotal(row) {
  return (row.items || []).reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0),
    0
  );
}
function shortDate(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}
function fullDate(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ---------- ledger builders ---------- */

export function customerLedger(customer) {
  const name = customer?.name || '';
  const phone = customer?.phone || '';
  const sales = (db.sales || []).filter(
    (s) => norm(s.customerName) === norm(name) || (phone && samePhone(s.customerPhone, phone))
  );
  const payments = (db.payments || []).filter(
    (p) => p.type === 'customer' && norm(p.party) === norm(name)
  );
  const returns = (db.returns || []).filter((r) => norm(r.customerName) === norm(name));
  const saleById = new Map((db.sales || []).map((s) => [s.id, s]));

  let creditTotal = 0;
  let paidTotal = 0;
  let refundCredit = 0;
  const entries = [];

  for (const sale of sales) {
    const total = Number(sale.total) || 0;
    const isCredit = sale.paymentMethod === 'Udhaar';
    if (isCredit) creditTotal += total;
    entries.push({
      date: sale.createdAt,
      type: isCredit ? 'credit-sale' : 'paid-sale',
      label: `Invoice ${sale.invoiceNo || sale.id}`,
      detail: isCredit ? 'Udhaar sale' : `Paid · ${sale.paymentMethod || 'Cash'}`,
      debit: isCredit ? total : 0,
      credit: 0,
    });
  }

  for (const payment of payments) {
    const amount = Number(payment.amount) || 0;
    paidTotal += amount;
    entries.push({
      date: payment.createdAt,
      type: 'payment',
      label: 'Payment received',
      detail: `${payment.method || 'Cash'}${payment.note ? ` · ${payment.note}` : ''}`,
      debit: 0,
      credit: amount,
    });
  }

  for (const row of returns) {
    const sale = saleById.get(row.saleId);
    const affects = row.method === 'Udhaar' || (sale && sale.paymentMethod === 'Udhaar');
    const amount = refundTotal(row);
    if (affects) refundCredit += amount;
    entries.push({
      date: row.createdAt,
      type: 'return',
      label: `Return ${row.invoiceNo || ''}`.trim(),
      detail: affects
        ? `Udhaar adjust · ${row.method || 'Udhaar'}`
        : `Refund · ${row.method || 'Cash'}`,
      debit: 0,
      credit: affects ? amount : 0,
    });
  }

  const closing = Number(customer?.balance) || 0;
  const opening = round2(closing - creditTotal + paidTotal + refundCredit);
  return finalize({
    kind: 'customer',
    party: customer,
    entries,
    opening,
    closing,
    totalDebit: creditTotal,
    totalCredit: round2(paidTotal + refundCredit),
    sales,
    payments,
    returns,
  });
}

export function supplierLedger(supplier) {
  const name = supplier?.name || '';
  const purchases = (db.purchases || []).filter((p) => norm(p.supplierName) === norm(name));
  const payments = (db.payments || []).filter(
    (p) => p.type === 'supplier' && norm(p.party) === norm(name)
  );

  let purchaseTotal = 0;
  let paidTotal = 0;
  const entries = [];

  for (const purchase of purchases) {
    const amount = Number(purchase.totalCost) || 0;
    purchaseTotal += amount;
    entries.push({
      date: purchase.createdAt,
      type: 'purchase',
      label: `Purchase · ${purchase.productName || 'Item'}`,
      detail: `${purchase.qty || 0} × ${money(purchase.cost || 0)}`,
      debit: amount,
      credit: 0,
    });
  }

  for (const payment of payments) {
    const amount = Number(payment.amount) || 0;
    paidTotal += amount;
    entries.push({
      date: payment.createdAt,
      type: 'payment',
      label: 'Payment made',
      detail: `${payment.method || 'Cash'}${payment.note ? ` · ${payment.note}` : ''}`,
      debit: 0,
      credit: amount,
    });
  }

  const closing = Number(supplier?.balance) || 0;
  const opening = round2(closing - purchaseTotal + paidTotal);
  return finalize({
    kind: 'supplier',
    party: supplier,
    entries,
    opening,
    closing,
    totalDebit: purchaseTotal,
    totalCredit: paidTotal,
    purchases,
    payments,
  });
}

function finalize(ledger) {
  const entries = ledger.entries
    .slice()
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  let balance = ledger.opening;
  for (const entry of entries) {
    balance = round2(balance + (Number(entry.debit) || 0) - (Number(entry.credit) || 0));
    entry.balance = balance;
  }
  const diff = round2(ledger.closing - balance);
  if (Math.abs(diff) > 0.009) {
    entries.push({
      date: new Date().toISOString(),
      type: 'adjust',
      label: 'Balance adjustment',
      detail: 'Manual opening / data correction',
      debit: diff > 0 ? diff : 0,
      credit: diff < 0 ? -diff : 0,
      balance: ledger.closing,
    });
  }
  return { ...ledger, entries, computedClosing: ledger.closing };
}

/* ---------- labels ---------- */

function labels(ledger) {
  if (ledger.kind === 'supplier') {
    return {
      title: 'Supplier Statement',
      debit: 'Purchase',
      credit: 'Paid',
      balance: 'Payable',
      partyLabel: 'Supplier',
      note: 'Debit = supplier se purchase (payable barhta hai), Credit = payment (payable kam hota hai).',
    };
  }
  return {
    title: 'Customer Statement',
    debit: 'Udhaar',
    credit: 'Received',
    balance: 'Balance',
    partyLabel: 'Customer',
    note: 'Debit = udhaar sale (balance barhta hai), Credit = payment / refund (balance kam hota hai).',
  };
}

function shopHeaderHtml(ledger) {
  const s = db.settings || {};
  const taxInfo = currentTaxSystem();
  const logo = s.logo
    ? `<img class="logo-img" src="${escapeHtml(s.logo)}" alt="" />`
    : `<div class="logo">${escapeHtml(initials(s.shopName || 'mhzaly'))}</div>`;
  const party = ledger.party || {};
  return `
    <div class="shop-head">
      ${logo}
      <div>
        <div class="shop-name">${escapeHtml(s.shopName || 'My Mart')}</div>
        ${s.address ? `<div class="muted">${escapeHtml(s.address)}</div>` : ''}
        ${s.phone ? `<div class="muted">Phone: ${escapeHtml(s.phone)}</div>` : ''}
        ${s.taxNumber ? `<div class="muted">${escapeHtml(taxInfo.numberLabel)}: ${escapeHtml(s.taxNumber)}</div>` : ''}
      </div>
      <div class="statement-badge">${escapeHtml(labels(ledger).title)}</div>
    </div>
    <div class="party-row">
      <div>
        <div class="muted">${escapeHtml(labels(ledger).partyLabel)}</div>
        <div class="party-name">${escapeHtml(party.name || '—')}</div>
        ${party.phone ? `<div class="muted">${escapeHtml(party.phone)}</div>` : ''}
        ${party.taxNumber ? `<div class="muted">${escapeHtml(taxInfo.numberLabel)}: ${escapeHtml(party.taxNumber)}</div>` : ''}
      </div>
      <div class="right">
        <div class="muted">Generated</div>
        <div>${escapeHtml(fullDate(new Date()))}</div>
      </div>
    </div>`;
}

function summaryHtml(ledger) {
  const l = labels(ledger);
  return `<div class="statement-summary">
    <div><span>Opening</span><b>${money(ledger.opening)}</b></div>
    <div><span>${esc(l.debit)}</span><b>${money(ledger.totalDebit)}</b></div>
    <div><span>${esc(l.credit)}</span><b>${money(ledger.totalCredit)}</b></div>
    <div class="closing"><span>${esc(l.balance)}</span><b>${money(ledger.closing)}</b></div>
  </div>`;
}

function entriesHtml(ledger) {
  const l = labels(ledger);
  const rows = [];
  rows.push(`<tr class="opening-row">
    <td>${esc(shortDate(ledger.party?.createdAt))}</td>
    <td><b>Opening balance</b><div class="statement-detail">Pehle se baqi</div></td>
    <td class="r">${ledger.opening > 0 ? money(ledger.opening) : '—'}</td>
    <td class="r">${ledger.opening < 0 ? money(-ledger.opening) : '—'}</td>
    <td class="r"><b>${money(ledger.opening)}</b></td>
  </tr>`);
  for (const entry of ledger.entries) {
    rows.push(`<tr>
      <td>${esc(shortDate(entry.date))}</td>
      <td><b>${esc(entry.label)}</b>${entry.detail ? `<div class="statement-detail">${esc(entry.detail)}</div>` : ''}</td>
      <td class="r">${entry.debit ? money(entry.debit) : '—'}</td>
      <td class="r">${entry.credit ? money(entry.credit) : '—'}</td>
      <td class="r"><b>${money(entry.balance)}</b></td>
    </tr>`);
  }
  if (!ledger.entries.length) {
    rows.push(`<tr><td colspan="5"><div class="empty-state">Abhi koi transaction record nahi.</div></td></tr>`);
  }
  return `<div class="table-wrap">
    <table class="statement-table">
      <thead><tr>
        <th>Date</th><th>Description</th><th class="r">${esc(l.debit)}</th><th class="r">${esc(l.credit)}</th><th class="r">${esc(l.balance)}</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  </div>`;
}

/* ---------- printable HTML ---------- */

export function statementHtml(ledger) {
  const l = labels(ledger);
  const rows = [];
  rows.push(`<tr>
    <td>${escapeHtml(shortDate(ledger.party?.createdAt))}</td>
    <td><b>Opening balance</b></td>
    <td class="r">${ledger.opening > 0 ? money(ledger.opening) : '—'}</td>
    <td class="r">${ledger.opening < 0 ? money(-ledger.opening) : '—'}</td>
    <td class="r"><b>${money(ledger.opening)}</b></td>
  </tr>`);
  for (const entry of ledger.entries) {
    rows.push(`<tr>
      <td>${escapeHtml(shortDate(entry.date))}</td>
      <td><b>${escapeHtml(entry.label)}</b>${entry.detail ? `<div class="detail">${escapeHtml(entry.detail)}</div>` : ''}</td>
      <td class="r">${entry.debit ? money(entry.debit) : '—'}</td>
      <td class="r">${entry.credit ? money(entry.credit) : '—'}</td>
      <td class="r"><b>${money(entry.balance)}</b></td>
    </tr>`);
  }
  if (!ledger.entries.length) {
    rows.push('<tr><td colspan="5" class="empty">Abhi koi transaction record nahi.</td></tr>');
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(l.title)} — ${escapeHtml(ledger.party?.name || '')}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #0f172a; background: #fff;
    font-family: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 182mm; margin: 0 auto; }
  .shop-head { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 14px; border-bottom: 2px solid #0f172a; }
  .logo, .logo-img { width: 48px; height: 48px; border-radius: 10px; flex: 0 0 48px; }
  .logo { display: grid; place-items: center; background: #0f766e; color: #fff; font-weight: 800; font-size: 18px; }
  .logo-img { object-fit: contain; border: 1px solid #e2e8f0; background: #fff; }
  .shop-name { font-size: 20px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
  .muted { color: #64748b; font-size: 10.5px; line-height: 1.5; }
  .statement-badge {
    margin-left: auto; background: #f1f5f9; border: 1px solid #e2e8f0; color: #334155;
    border-radius: 99px; padding: 5px 12px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
  }
  .party-row { display: flex; justify-content: space-between; gap: 18px; padding: 14px 0; }
  .party-name { font-size: 15px; font-weight: 800; margin: 2px 0; }
  .right { text-align: right; }
  .statement-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .statement-summary > div { border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 10px; background: #f8fafc; }
  .statement-summary span { display: block; color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; font-weight: 800; }
  .statement-summary b { display: block; margin-top: 4px; font-size: 13px; }
  .statement-summary .closing { background: #f0fdfa; border-color: #99f6e4; }
  .statement-summary .closing b { color: #0f766e; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1.5px solid #0f172a; padding: 6px 4px; }
  td { padding: 7px 4px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .r { text-align: right; white-space: nowrap; }
  .detail { color: #64748b; font-size: 9.5px; margin-top: 2px; }
  .empty { text-align: center; color: #64748b; padding: 22px; }
  .foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 9.5px; }
  .note { margin-top: 12px; padding: 9px 11px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0; color: #475569; font-size: 9.5px; line-height: 1.5; }
</style></head>
<body>
  <div class="sheet">
    ${shopHeaderHtml(ledger)}
    ${summaryHtml(ledger)}
    <table>
      <thead><tr><th>Date</th><th>Description</th><th class="r">${escapeHtml(l.debit)}</th><th class="r">${escapeHtml(l.credit)}</th><th class="r">${escapeHtml(l.balance)}</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div class="note">${escapeHtml(l.note)}</div>
    <div class="foot"><span>${escapeHtml(l.title)} · ${escapeHtml(ledger.party?.name || '')}</span><span>Powered by mhzaly</span></div>
  </div>
</body></html>`;
}

/* ---------- share / export ---------- */

export function ledgerText(ledger) {
  const l = labels(ledger);
  const s = db.settings || {};
  const lines = [];
  lines.push(`*${s.shopName || 'My Mart'}*`);
  lines.push(`${l.title} — ${ledger.party?.name || ''}`);
  if (ledger.party?.phone) lines.push(`📞 ${ledger.party.phone}`);
  if (ledger.party?.taxNumber) lines.push(`Tax: ${ledger.party.taxNumber}`);
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`Opening: ${money(ledger.opening)}`);
  lines.push(`${l.debit}: ${money(ledger.totalDebit)}`);
  lines.push(`${l.credit}: ${money(ledger.totalCredit)}`);
  lines.push(`*${l.balance}: ${money(ledger.closing)}*`);
  lines.push('━━━━━━━━━━━━━━━');
  const recent = ledger.entries.slice(-25);
  if (recent.length) {
    for (const entry of recent) {
      const side = entry.debit ? `+${money(entry.debit)}` : entry.credit ? `-${money(entry.credit)}` : '—';
      lines.push(`${shortDate(entry.date)} · ${entry.label} · ${side} · ${money(entry.balance)}`);
    }
    if (ledger.entries.length > recent.length) lines.push(`… aur ${ledger.entries.length - recent.length} entries`);
  } else {
    lines.push('Koi transaction record nahi.');
  }
  lines.push('', '_Powered by mhzaly_');
  return lines.join('\n');
}

export function shareStatementWhatsApp(ledger) {
  const digits = normalizePhone(ledger.party?.phone || '');
  if (!digits) {
    toast('Party ka phone number missing hai — pehle edit karke add karein', 'error');
    return;
  }
  const text = encodeURIComponent(ledgerText(ledger));
  window.open(`https://wa.me/${digits}?text=${text}`, '_blank');
}

export function printStatement(ledger) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(statementHtml(ledger));
  doc.close();
  const fire = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  if (doc.readyState === 'complete') setTimeout(fire, 80);
  else iframe.contentWindow.addEventListener('load', () => setTimeout(fire, 80), { once: true });
}

export function ledgerCsv(ledger) {
  const l = labels(ledger);
  const rows = [
    ['Date', 'Description', 'Detail', l.debit, l.credit, l.balance],
    [shortDate(ledger.party?.createdAt), 'Opening balance', '', ledger.opening > 0 ? ledger.opening : 0, ledger.opening < 0 ? -ledger.opening : 0, ledger.opening],
  ];
  for (const entry of ledger.entries) {
    rows.push([shortDate(entry.date), entry.label, entry.detail || '', entry.debit || 0, entry.credit || 0, entry.balance]);
  }
  return toCsv(rows);
}

export function downloadStatementCsv(ledger) {
  const name = `${ledger.kind}-statement-${String(ledger.party?.name || 'party').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(name, ledgerCsv(ledger), 'text/csv');
}

/* ---------- modal ---------- */

export function openStatement(ledger) {
  const l = labels(ledger);
  const taxInfo = currentTaxSystem();
  openModal({
    title: `${ledger.party?.name || 'Party'} — statement`,
    subtitle: `${l.title} · ${ledger.entries.length} transactions · ${money(ledger.closing)} ${l.balance.toLowerCase()}`,
    body: `
      ${summaryHtml(ledger)}
      ${ledger.party?.taxNumber ? `<p class="small muted" style="margin:0 0 10px">${esc(taxInfo.numberLabel)}: <b>${esc(ledger.party.taxNumber)}</b></p>` : ''}
      <p class="small muted" style="margin:0 0 10px">${esc(l.note)}</p>
      ${entriesHtml(ledger)}
    `,
    footer: `
      <button class="btn btn-ghost" data-statement-close>Close</button>
      <button class="btn btn-ghost" data-statement-csv>${icon('download')} CSV</button>
      <button class="btn btn-ghost" data-statement-wa>${icon('check')} WhatsApp</button>
      <button class="btn btn-primary" data-statement-print>${icon('download')} Print</button>`,
    onMount: (bd) => {
      bd.querySelector('[data-statement-close]').addEventListener('click', () => bd.remove());
      bd.querySelector('[data-statement-csv]').addEventListener('click', () => {
        downloadStatementCsv(ledger);
        toast('Statement CSV download ho gaya', 'success');
      });
      bd.querySelector('[data-statement-wa]').addEventListener('click', () => shareStatementWhatsApp(ledger));
      bd.querySelector('[data-statement-print]').addEventListener('click', () => printStatement(ledger));
    },
  });
}
