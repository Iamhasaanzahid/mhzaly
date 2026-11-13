/* ============================================================
   mhzaly — tax systems, invoice payload & offline QR codes
   QR generation uses the vendored MIT-licensed qrcode-generator.
   ============================================================ */

import qrcode from './vendor/qrcode.js';
import { db } from './db.js';

/** Country-wise tax systems. Pakistan is intentionally first/default. */
export const TAX_SYSTEMS = [
  {
    country: 'PK',
    countryName: 'Pakistan',
    system: 'GST',
    numberLabel: 'NTN / STRN',
    rate: 18,
    example: '1234567-8',
    hint: 'Pakistan ka standard GST 18% hai. Apna NTN/STRN aur buyer ka NTN receipt par show kar sakte hain.',
  },
  {
    country: 'IN',
    countryName: 'India',
    system: 'GST',
    numberLabel: 'GSTIN',
    rate: 18,
    example: '22AAAAA0000A1Z5',
    hint: 'India GST: GSTIN 15 digits. Rate item ke hisaab se badal sakta hai.',
  },
  {
    country: 'AE',
    countryName: 'United Arab Emirates',
    system: 'VAT',
    numberLabel: 'TRN',
    rate: 5,
    example: '100123456700003',
    hint: 'UAE VAT 5%. TRN 15 digits hota hai.',
  },
  {
    country: 'SA',
    countryName: 'Saudi Arabia',
    system: 'VAT',
    numberLabel: 'VAT Number',
    rate: 15,
    example: '300000000000003',
    hint: 'Saudi Arabia VAT 15%.',
  },
  {
    country: 'GB',
    countryName: 'United Kingdom',
    system: 'VAT',
    numberLabel: 'VAT Number',
    rate: 20,
    example: 'GB123456789',
    hint: 'UK VAT 20%.',
  },
  {
    country: 'US',
    countryName: 'United States',
    system: 'Sales Tax',
    numberLabel: 'EIN / Sales Tax Permit',
    rate: 0,
    example: '12-3456789',
    hint: 'US sales tax state ke hisaab se change hota hai — apna rate manually set karein.',
  },
  {
    country: 'CA',
    countryName: 'Canada',
    system: 'GST/HST',
    numberLabel: 'GST/HST Number',
    rate: 5,
    example: '123456789RT0001',
    hint: 'Canada GST 5% (province ke hisaab se HST badal sakta hai).',
  },
  {
    country: 'AU',
    countryName: 'Australia',
    system: 'GST',
    numberLabel: 'ABN',
    rate: 10,
    example: '51 824 753 556',
    hint: 'Australia GST 10%.',
  },
  {
    country: 'DE',
    countryName: 'Germany',
    system: 'VAT',
    numberLabel: 'USt-IdNr.',
    rate: 19,
    example: 'DE123456789',
    hint: 'Germany VAT 19%.',
  },
  {
    country: 'FR',
    countryName: 'France',
    system: 'VAT',
    numberLabel: 'TVA Number',
    rate: 20,
    example: 'FR12345678901',
    hint: 'France VAT 20%.',
  },
  {
    country: 'TR',
    countryName: 'Turkey',
    system: 'VAT',
    numberLabel: 'VKN',
    rate: 20,
    example: '1234567890',
    hint: 'Turkey VAT 20%.',
  },
  {
    country: 'BD',
    countryName: 'Bangladesh',
    system: 'VAT',
    numberLabel: 'BIN',
    rate: 15,
    example: '001234567-0101',
    hint: 'Bangladesh VAT 15%.',
  },
  {
    country: 'LK',
    countryName: 'Sri Lanka',
    system: 'VAT',
    numberLabel: 'VAT Number',
    rate: 18,
    example: '123456789-7000',
    hint: 'Sri Lanka VAT 18%.',
  },
  {
    country: 'NP',
    countryName: 'Nepal',
    system: 'VAT',
    numberLabel: 'PAN / VAT',
    rate: 13,
    example: '123456789',
    hint: 'Nepal VAT 13%.',
  },
  {
    country: 'OTHER',
    countryName: 'Other / custom',
    system: 'Tax',
    numberLabel: 'Tax Number',
    rate: 0,
    example: '',
    hint: 'Apna tax system, number label aur rate manually set karein.',
  },
];

export function taxSystem(country) {
  return TAX_SYSTEMS.find((t) => t.country === country) || TAX_SYSTEMS[0];
}

/** Switch the shop to a country's tax system (name + recommended rate). */
export function applyTaxCountry(settings, country) {
  const t = taxSystem(country);
  settings.taxCountry = t.country;
  settings.taxSystem = t.system;
  settings.taxRate = t.rate;
  return t;
}

export function currentTaxSystem() {  const s = db.settings || {};
  const base = taxSystem(s.taxCountry || 'PK');
  return {
    ...base,
    system: s.taxSystem || base.system,
    rate: Number.isFinite(Number(s.taxRate)) ? Number(s.taxRate) : base.rate,
  };
}

export function taxName() {
  return currentTaxSystem().system || 'Tax';
}

export function taxNumberLabel() {
  return currentTaxSystem().numberLabel || 'Tax Number';
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Shop-local YYYY-MM-DD key (avoids UTC day shift on tax invoices). */
function localDateKey(value) {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function b64urlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Normalised totals used by the receipt, QR payload and verification page. */
export function saleTaxData(sale) {
  const items = Array.isArray(sale.items) ? sale.items : [];
  const itemSubtotal = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 1) * (Number(it.price) || 0),
    0
  );
  const subtotal = itemSubtotal || Number(sale.subtotal) || 0;
  const discount = Math.max(0, Number(sale.discount) || 0);
  const taxable = Math.max(0, subtotal - discount);
  const rate = Math.max(0, Math.min(100, Number(sale.taxRate) || 0));
  const tax = Number.isFinite(Number(sale.tax))
    ? Math.max(0, Number(sale.tax))
    : Math.round(taxable * rate) / 100;
  const total = Number(sale.total ?? (taxable + tax)) || 0;
  return { subtotal: round2(subtotal), discount: round2(discount), taxable: round2(taxable), rate, tax: round2(tax), total: round2(total) };
}

/** Compact tax-invoice payload encoded into the receipt QR. */
export function saleTaxPayload(sale) {
  const s = db.settings || {};
  const system = currentTaxSystem();
  const totals = saleTaxData(sale);
  const payload = {
    v: 1,
    app: 'mhzaly',
    shop: s.shopName || 'My Mart',
    sellerTax: s.taxNumber || '',
    buyerTax: sale.customerTaxNumber || '',
    invoice: sale.invoiceNo || sale.id || '',
    date: localDateKey(sale.createdAt),
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxable: totals.taxable,
    taxRate: totals.rate,
    tax: totals.tax,
    total: totals.total,
    currency: s.currency || 'Rs',
    currencyCode: s.currencyCode || '',
    locale: s.locale || 'en-PK',
    taxSystem: system.system || 'Tax',
    country: system.country || 'PK',
  };
  return JSON.stringify(payload);
}

/** Public, scan-friendly verification URL for the receipt QR. */
export function saleVerifyUrl(sale) {
  let base = 'https://mhzaly.pages.dev/verify.html';
  try {
    base = new URL('verify.html', location.href).toString();
  } catch { /* use production fallback when location is unavailable */ }
  const url = new URL(base);
  url.searchParams.set('d', b64urlEncode(saleTaxPayload(sale)));
  return url.toString();
}


function makeQr(text) {
  if (!text) return null;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

/** Crisp SVG markup for inline previews. */
export function qrSvg(text, cellSize = 3, margin = 4) {
  try {
    const qr = makeQr(text);
    return qr ? qr.createSvgTag(cellSize, margin) : '';
  } catch {
    return '';
  }
}

/** GIF data URL — reliable inside printed iframes and <img> tags. */
export function qrDataUrl(text, cellSize = 4, margin = 4) {
  try {
    const qr = makeQr(text);
    return qr ? qr.createDataURL(cellSize, margin) : '';
  } catch {
    return '';
  }
}
