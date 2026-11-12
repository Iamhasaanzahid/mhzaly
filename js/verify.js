/* ============================================================
   mhzaly — public tax invoice verification (QR target)
   Decodes the payload from ?d= and renders a clean, printable card.
   ============================================================ */

const COUNTRY_NAMES = {
  PK: 'Pakistan',
  IN: 'India',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  GB: 'United Kingdom',
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  TR: 'Turkey',
  BD: 'Bangladesh',
  LK: 'Sri Lanka',
  NP: 'Nepal',
  OTHER: 'Other',
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function b64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readPayload() {
  try {
    const raw = new URLSearchParams(location.search).get('d');
    if (!raw) return null;
    const data = JSON.parse(b64urlDecode(raw));
    if (!data || data.app !== 'mhzaly') return null;
    return data;
  } catch {
    return null;
  }
}

function money(value, currency) {
  const n = Number(value) || 0;
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '—';
  // Payload dates are plain YYYY-MM-DD (shop local day) — parse as UTC to avoid a day shift.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function errorCard() {
  return `
    <div class="error">
      <div class="error-ico">!</div>
      <h2>Invoice data nahi mila</h2>
      <p>Ye QR link complete nahi hai ya data expire / invalid hai. Barah-e-karam printed receipt ka QR dobara scan karein.</p>
      <div class="actions" style="justify-content:center">
        <a class="btn primary" href="./">Open mhzaly</a>
      </div>
    </div>`;
}

function invoiceCard(data) {
  const currency = data.currency || 'Rs';
  const country = COUNTRY_NAMES[data.country] || data.country || '—';
  const system = data.taxSystem || 'Tax';
  const rate = Number(data.taxRate) || 0;
  const tax = Number(data.tax) || 0;
  const total = Number(data.total) || 0;
  const taxable = Number(data.taxable) || Math.max(0, total - tax);
  const subtotal = Number(data.subtotal) || taxable;
  const discount = Number(data.discount) || 0;

  document.title = `Tax Invoice ${data.invoice || ''} — mhzaly`;

  return `
    <div class="top">
      <div>
        <span class="badge">✓ Tax invoice data</span>
        <h1>${esc(data.shop || 'Shop')}</h1>
        <p class="sub">${esc(system)} invoice · ${esc(country)}</p>
      </div>
      <div class="invoice-pill">
        <span>Invoice</span>
        <b>${esc(data.invoice || '—')}</b>
      </div>
    </div>

    <div class="grid">
      <div class="cell"><span>Date</span><b>${esc(formatDate(data.date))}</b></div>
      <div class="cell"><span>Tax rate</span><b>${esc(rate)}%</b></div>
      <div class="cell"><span>Seller ${esc(system)} number</span><b>${esc(data.sellerTax || '—')}</b></div>
      <div class="cell"><span>Buyer tax number</span><b>${esc(data.buyerTax || '—')}</b></div>
    </div>

    <div class="amounts">
      <div class="row"><span>Subtotal</span><b>${esc(money(subtotal, currency))}</b></div>
      ${discount > 0 ? `<div class="row"><span>Discount</span><b>− ${esc(money(discount, currency))}</b></div>` : ''}
      <div class="row"><span>Taxable amount</span><b>${esc(money(taxable, currency))}</b></div>
      <div class="row"><span>${esc(system)} (${esc(rate)}%)</span><b>${esc(money(tax, currency))}</b></div>
      <div class="row total"><span>Total</span><b>${esc(money(total, currency))}</b></div>
    </div>

    <div class="note">
      Ye page QR code mein encoded tax invoice data dikhata hai. Amounts aur tax numbers printed receipt se match karein.
      Kisi bhi farq ki soorat mein dukaan se rabta karein.
    </div>

    <div class="actions">
      <button class="btn primary" type="button" id="verifyPrint">Print / Save PDF</button>
      <a class="btn" href="./">Open mhzaly</a>
    </div>`;
}

const card = document.getElementById('verifyCard');
const data = readPayload();
if (card) {
  card.innerHTML = data ? invoiceCard(data) : errorCard();
  const printBtn = card.querySelector('#verifyPrint');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}
