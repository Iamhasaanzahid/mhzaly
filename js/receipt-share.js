/* ============================================================
   mhzaly — shared receipt helpers (WhatsApp / print)
   ============================================================ */

import { db } from './db.js';
import { currentTaxSystem, saleVerifyUrl, qrDataUrl } from './tax.js';
import { formatMoney, formatDateTime } from './currency.js';

function settings() {
  return db.settings || {};
}

export function money(n) {
  return formatMoney(n);
}

function saleTotals(sale) {
  const items = Array.isArray(sale.items) ? sale.items : [];
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 1) * (Number(it.price) || 0),
    0
  );
  const discount = Math.max(0, Number(sale.discount) || 0);
  const taxable = Math.max(0, subtotal - discount);
  const rate = Math.max(0, Math.min(100, Number(sale.taxRate) || 0));
  const tax = Number.isFinite(Number(sale.tax)) ? Math.max(0, Number(sale.tax)) : Math.round(taxable * rate) / 100;
  const total = Number(sale.total ?? (taxable + tax)) || 0;
  return { items, subtotal, discount, tax, total };
}

function shopInitials(name) {
  const parts = String(name || 'mhzaly').trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => w[0]).join('');
  return (letters || 'M').toUpperCase();
}

function formatDate(value) {
  const d = value ? new Date(value) : new Date();
  try {
    return formatDateTime(d, (db.settings || {}).locale);
  } catch {
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- WhatsApp / share text ---------- */

export function receiptText(sale) {
  const s = settings();
  const { items, subtotal, discount, tax, total } = saleTotals(sale);
  const fmt = (n) => formatMoney(n);
  const lines = [];

  const taxInfo = currentTaxSystem();
  lines.push(`*${s.shopName || 'My Mart'}*`);
  if (s.address) lines.push(`📍 ${s.address}`);
  if (s.phone) lines.push(`📞 ${s.phone}`);
  if (s.taxNumber) lines.push(`🧾 Seller ${taxInfo.numberLabel}: ${s.taxNumber}`);
  if (sale.customerTaxNumber) lines.push(`👤 Buyer ${taxInfo.numberLabel}: ${sale.customerTaxNumber}`);
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`🧾 Invoice: ${sale.invoiceNo || sale.id}`);
  lines.push(`📅 ${formatDate(sale.createdAt)}`);
  if (sale.customerName && sale.customerName !== 'Walk-in') {
    lines.push(`👤 ${sale.customerName}`);
  }
  lines.push('━━━━━━━━━━━━━━━');
  for (const it of items) {
    const qty = Number(it.qty) || 1;
    const price = Number(it.price) || 0;
    lines.push(`• ${it.name}`);
    lines.push(`   ${qty} x ${fmt(price)} = ${fmt(qty * price)}`);
  }
  lines.push('━━━━━━━━━━━━━━━');
  if (discount > 0) {
    lines.push(`Subtotal: ${fmt(subtotal)}`);
    lines.push(`Discount: -${fmt(discount)}`);
  }
  if (tax > 0) {
    if (!(discount > 0)) lines.push(`Subtotal: ${fmt(subtotal)}`);
    lines.push(`Tax: ${fmt(tax)}`);
  }
  lines.push(`*Total: ${fmt(total)}*`);
  lines.push(`💳 Payment: ${sale.paymentMethod || 'Cash'}`);
  if (s.receiptNote) lines.push('', s.receiptNote);
  if (s.receiptTerms) lines.push('', s.receiptTerms);
  if (s.receiptQr !== false && (s.taxNumber || sale.customerTaxNumber || tax > 0)) {
    lines.push('', '🔳 Tax invoice QR printed receipt par hai.');
    lines.push(`🔗 Verify: ${saleVerifyUrl(sale)}`);
  }
  lines.push('', '_Powered by mhzaly_');
  return lines.join('\n');
}

/* ---------- Printable receipt (HTML) ---------- */

export function receiptHtml(sale) {
  const s = settings();
  const { items, subtotal, discount, tax, total } = saleTotals(sale);
  const fmt = (n) => formatMoney(n);
  const shopName = s.shopName || 'My Mart';
  const initials = escapeHtml(shopInitials(shopName));
  const logo = s.logo
    ? `<img class="logo-img" src="${escapeHtml(s.logo)}" alt="" />`
    : `<div class="logo">${initials}</div>`;
  const customer = (sale.customerName && sale.customerName !== 'Walk-in') ? sale.customerName : '';
  const note = s.receiptNote || 'Thank you for shopping with us!';
  const terms = s.receiptTerms || '';
  const taxInfo = currentTaxSystem();
  const shopTax = s.taxNumber || '';
  const buyerTax = sale.customerTaxNumber || '';
  const showTax = Boolean(shopTax || buyerTax || tax > 0);
  const qr = s.receiptQr !== false && showTax ? qrDataUrl(saleVerifyUrl(sale), 4, 2) : '';
  const taxBox = showTax
    ? `<div class="tax-box">
        <div class="tax-title">${escapeHtml(taxInfo.system)} Tax Invoice</div>
        ${shopTax ? `<div><span>Seller ${escapeHtml(taxInfo.numberLabel)}</span><b>${escapeHtml(shopTax)}</b></div>` : ''}
        ${buyerTax ? `<div><span>Buyer ${escapeHtml(taxInfo.numberLabel)}</span><b>${escapeHtml(buyerTax)}</b></div>` : ''}
        <div><span>Taxable amount</span><b>${fmt(Math.max(0, subtotal - discount))}</b></div>
        <div><span>Tax rate</span><b>${Number(sale.taxRate) || 0}%</b></div>
        <div><span>Tax amount</span><b>${fmt(tax)}</b></div>
      </div>`
    : '';

  const rows = items.map((it) => {
    const qty = Number(it.qty) || 1;
    const price = Number(it.price) || 0;
    return `<tr>
      <td class="item">${escapeHtml(it.name)}</td>
      <td class="c">${qty}</td>
      <td class="r">${fmt(price)}</td>
      <td class="r">${fmt(qty * price)}</td>
    </tr>`;
  }).join('');

  const taxRows = (discount > 0 || tax > 0)
    ? `${(discount > 0 || tax > 0) ? `<tr><td class="muted">Subtotal</td><td class="r">${fmt(subtotal)}</td></tr>` : ''}
       ${discount > 0 ? `<tr><td class="muted">Discount</td><td class="r">−${fmt(discount)}</td></tr>` : ''}
       ${tax > 0 ? `<tr><td class="muted">Tax</td><td class="r">${fmt(tax)}</td></tr>` : ''}`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(sale.invoiceNo || '')}</title>
<style>
  @page { size: 80mm auto; margin: 5mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: #0f172a;
    font-size: 12px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt { width: 100%; max-width: 74mm; margin: 0 auto; padding: 4px 0 8px; }
  .top { text-align: center; }
  .logo {
    width: 46px; height: 46px; border-radius: 50%;
    background: linear-gradient(135deg, #14b8a6, #0f766e);
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 18px; margin: 0 auto 7px;
  }
  .logo-img {
    width: 46px; height: 46px; object-fit: contain;
    margin: 0 auto 7px; display: block; border-radius: 8px;
  }
  .shop { font-size: 17px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
  .muted { color: #64748b; font-size: 10.5px; line-height: 1.5; }
  .dash { border: 0; border-top: 1px dashed #cbd5e1; margin: 8px 0; }
  .meta { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .meta td { padding: 1px 0; vertical-align: top; }
  .meta .r { text-align: right; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.items th {
    text-align: left; color: #64748b; font-size: 9px; text-transform: uppercase;
    letter-spacing: .05em; border-bottom: 1px solid #e2e8f0; padding: 4px 0;
  }
  table.items td { padding: 5px 0; border-bottom: 1px dashed #eef2f7; vertical-align: top; }
  table.items tr:last-child td { border-bottom: 0; }
  table.items .c { text-align: center; }
  table.items .r { text-align: right; white-space: nowrap; }
  table.items .item { padding-right: 6px; }
  .totals { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
  .totals td { padding: 2px 0; }
  .totals .r { text-align: right; white-space: nowrap; }
  .grand td { font-size: 14.5px; font-weight: 800; border-top: 1.5px solid #0f172a; padding-top: 7px; }
  .pill {
    display: inline-block; background: #f1f5f9; border: 1px solid #e2e8f0;
    border-radius: 99px; padding: 3px 10px; font-size: 9.5px; font-weight: 700; color: #334155;
  }
  .thanks { text-align: center; margin-top: 10px; font-size: 11px; font-weight: 600; line-height: 1.5; }
  .terms { text-align: center; margin-top: 6px; font-size: 9.5px; color: #64748b; line-height: 1.45; }
  .tax-box {
    margin-top: 9px; border: 1px solid #e2e8f0; border-radius: 7px;
    padding: 7px 9px; font-size: 9.5px; background: #f8fafc;
  }
  .tax-title {
    text-align: center; font-weight: 800; font-size: 9px; letter-spacing: .08em;
    text-transform: uppercase; color: #0f766e; margin-bottom: 5px;
  }
  .tax-box > div:not(.tax-title) { display: flex; justify-content: space-between; gap: 8px; padding: 1.5px 0; }
  .tax-box span { color: #64748b; }
  .tax-box b { font-weight: 700; text-align: right; }
  .qr-box { text-align: center; margin-top: 10px; }
  .qr-img { width: 92px; height: 92px; image-rendering: pixelated; }
  .qr-label { font-size: 8px; color: #64748b; letter-spacing: .04em; margin-top: 2px; }
  .brand {
    text-align: center; margin-top: 9px; font-size: 8.5px; color: #94a3b8;
    letter-spacing: .12em; text-transform: uppercase;
  }
</style></head>
<body>
  <div class="receipt">
    <div class="top">
      ${logo}
      <div class="shop">${escapeHtml(shopName)}</div>
      ${s.address ? `<div class="muted">${escapeHtml(s.address)}</div>` : ''}
      ${s.phone ? `<div class="muted">Phone: ${escapeHtml(s.phone)}</div>` : ''}
      ${s.taxNumber ? `<div class="muted">${escapeHtml(taxInfo.numberLabel)}: ${escapeHtml(s.taxNumber)}</div>` : ''}
    </div>

    <hr class="dash">

    <table class="meta">
      <tr><td class="muted">Invoice</td><td class="r">${escapeHtml(sale.invoiceNo || sale.id || '')}</td></tr>
      <tr><td class="muted">Date</td><td class="r">${escapeHtml(formatDate(sale.createdAt))}</td></tr>
      ${customer ? `<tr><td class="muted">Customer</td><td class="r">${escapeHtml(customer)}</td></tr>` : ''}
    </table>

    <hr class="dash">

    <table class="items">
      <thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="totals">
      ${taxRows}
      <tr class="grand"><td>Total</td><td class="r">${fmt(total)}</td></tr>
    </table>

    <div style="margin-top:8px;text-align:center"><span class="pill">${escapeHtml(sale.paymentMethod || 'Cash')}</span></div>

    ${taxBox}
    ${qr ? `<div class="qr-box"><img class="qr-img" src="${qr}" alt="Tax QR" /><div class="qr-label">Scan to verify tax invoice</div></div>` : ''}

    <div class="thanks">${escapeHtml(note)}</div>
    ${terms ? `<div class="terms">${escapeHtml(terms)}</div>` : ''}
    <div class="brand">Powered by mhzaly</div>
  </div>
</body></html>`;
}

export function printReceipt(sale) {
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
  doc.write(receiptHtml(sale));
  doc.close();
  const fire = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  // Give the iframe a tick to lay out before printing.
  if (doc.readyState === 'complete') setTimeout(fire, 60);
  else iframe.contentWindow.addEventListener('load', () => setTimeout(fire, 60), { once: true });
}

export function normalizePhone(phone) {
  let digits = String(phone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '92' + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith('3')) digits = '92' + digits;
  return digits;
}

export function shareWhatsApp(sale, phone) {
  const text = encodeURIComponent(receiptText(sale));
  const digits = normalizePhone(phone);
  const url = digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
  window.open(url, '_blank');
}
