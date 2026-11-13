/* ============================================================
   mhzaly — currency, locale & country profiles
   Every country gets its own currency symbol, number format and
   date format. Works fully offline (Intl built into the browser).
   ============================================================ */

import { db } from './db.js';

/** Supported country profiles (currency + locale + tax country). */
export const COUNTRIES = [
  { code: 'PK', name: 'Pakistan', currency: 'PKR', symbol: 'Rs', locale: 'en-PK', tax: 'PK' },
  { code: 'IN', name: 'India', currency: 'INR', symbol: '₹', locale: 'en-IN', tax: 'IN' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', symbol: '৳', locale: 'bn-BD', tax: 'BD' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', symbol: '£', locale: 'en-GB', tax: 'GB' },
  { code: 'DE', name: 'Germany', currency: 'EUR', symbol: '€', locale: 'de-DE', tax: 'DE' },
  { code: 'FR', name: 'France', currency: 'EUR', symbol: '€', locale: 'fr-FR', tax: 'FR' },
  { code: 'ES', name: 'Spain', currency: 'EUR', symbol: '€', locale: 'es-ES', tax: 'OTHER' },
  { code: 'IT', name: 'Italy', currency: 'EUR', symbol: '€', locale: 'it-IT', tax: 'OTHER' },
  { code: 'TR', name: 'Turkey', currency: 'TRY', symbol: '₺', locale: 'tr-TR', tax: 'TR' },
  { code: 'RU', name: 'Russia', currency: 'RUB', symbol: '₽', locale: 'ru-RU', tax: 'OTHER' },
  { code: 'CN', name: 'China', currency: 'CNY', symbol: '¥', locale: 'zh-CN', tax: 'OTHER' },
  { code: 'JP', name: 'Japan', currency: 'JPY', symbol: '¥', locale: 'ja-JP', tax: 'OTHER' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', symbol: '₩', locale: 'ko-KR', tax: 'OTHER' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', symbol: 'AED', locale: 'ar-AE', tax: 'AE' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', symbol: 'SAR', locale: 'ar-SA', tax: 'SA' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', symbol: 'QAR', locale: 'ar-QA', tax: 'OTHER' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', symbol: 'KWD', locale: 'ar-KW', tax: 'OTHER' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', symbol: 'E£', locale: 'ar-EG', tax: 'OTHER' },
  { code: 'US', name: 'United States', currency: 'USD', symbol: '$', locale: 'en-US', tax: 'US' },
  { code: 'CA', name: 'Canada', currency: 'CAD', symbol: 'C$', locale: 'en-CA', tax: 'CA' },
  { code: 'AU', name: 'Australia', currency: 'AUD', symbol: 'A$', locale: 'en-AU', tax: 'AU' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', symbol: 'NZ$', locale: 'en-NZ', tax: 'OTHER' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', symbol: 'Rs', locale: 'en-LK', tax: 'LK' },
  { code: 'NP', name: 'Nepal', currency: 'NPR', symbol: '₨', locale: 'ne-NP', tax: 'NP' },
  { code: 'IR', name: 'Iran', currency: 'IRR', symbol: '﷼', locale: 'fa-IR', tax: 'OTHER' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', symbol: 'Rp', locale: 'id-ID', tax: 'OTHER' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', symbol: 'RM', locale: 'ms-MY', tax: 'OTHER' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', symbol: 'R$', locale: 'pt-BR', tax: 'OTHER' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', symbol: '₦', locale: 'en-NG', tax: 'OTHER' },
  { code: 'KE', name: 'Kenya', currency: 'KES', symbol: 'KSh', locale: 'en-KE', tax: 'OTHER' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', symbol: 'R', locale: 'en-ZA', tax: 'OTHER' },
  { code: 'AF', name: 'Afghanistan', currency: 'AFN', symbol: '؋', locale: 'fa-AF', tax: 'OTHER' },
  { code: 'OTHER', name: 'Other / custom', currency: '', symbol: '', locale: 'en-US', tax: 'OTHER' },
];

/** Currency presets offered in Settings (grouped by region feel). */
export const CURRENCIES = [
  { code: 'PKR', symbol: 'Rs', label: 'Pakistani Rupee', country: 'PK', locale: 'en-PK' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee', country: 'IN', locale: 'en-IN' },
  { code: 'BDT', symbol: '৳', label: 'Bangladeshi Taka', country: 'BD', locale: 'bn-BD' },
  { code: 'LKR', symbol: 'Rs', label: 'Sri Lankan Rupee', country: 'LK', locale: 'en-LK' },
  { code: 'NPR', symbol: '₨', label: 'Nepalese Rupee', country: 'NP', locale: 'ne-NP' },
  { code: 'AED', symbol: 'AED', label: 'UAE Dirham', country: 'AE', locale: 'ar-AE' },
  { code: 'SAR', symbol: 'SAR', label: 'Saudi Riyal', country: 'SA', locale: 'ar-SA' },
  { code: 'QAR', symbol: 'QAR', label: 'Qatari Riyal', country: 'QA', locale: 'ar-QA' },
  { code: 'KWD', symbol: 'KWD', label: 'Kuwaiti Dinar', country: 'KW', locale: 'ar-KW' },
  { code: 'EGP', symbol: 'E£', label: 'Egyptian Pound', country: 'EG', locale: 'ar-EG' },
  { code: 'USD', symbol: '$', label: 'US Dollar', country: 'US', locale: 'en-US' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar', country: 'CA', locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', country: 'AU', locale: 'en-AU' },
  { code: 'NZD', symbol: 'NZ$', label: 'New Zealand Dollar', country: 'NZ', locale: 'en-NZ' },
  { code: 'GBP', symbol: '£', label: 'British Pound', country: 'GB', locale: 'en-GB' },
  { code: 'EUR', symbol: '€', label: 'Euro', country: 'DE', locale: 'de-DE' },
  { code: 'TRY', symbol: '₺', label: 'Turkish Lira', country: 'TR', locale: 'tr-TR' },
  { code: 'RUB', symbol: '₽', label: 'Russian Ruble', country: 'RU', locale: 'ru-RU' },
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan', country: 'CN', locale: 'zh-CN' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen', country: 'JP', locale: 'ja-JP' },
  { code: 'KRW', symbol: '₩', label: 'South Korean Won', country: 'KR', locale: 'ko-KR' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian Real', country: 'BR', locale: 'pt-BR' },
  { code: 'IDR', symbol: 'Rp', label: 'Indonesian Rupiah', country: 'ID', locale: 'id-ID' },
  { code: 'MYR', symbol: 'RM', label: 'Malaysian Ringgit', country: 'MY', locale: 'ms-MY' },
  { code: 'NGN', symbol: '₦', label: 'Nigerian Naira', country: 'NG', locale: 'en-NG' },
  { code: 'KES', symbol: 'KSh', label: 'Kenyan Shilling', country: 'KE', locale: 'en-KE' },
  { code: 'ZAR', symbol: 'R', label: 'South African Rand', country: 'ZA', locale: 'en-ZA' },
  { code: 'AFN', symbol: '؋', label: 'Afghan Afghani', country: 'AF', locale: 'fa-AF' },
  { code: 'IRR', symbol: '﷼', label: 'Iranian Rial', country: 'IR', locale: 'fa-IR' },
];

/** Language → default country (used when the app language changes). */
export const LANG_COUNTRY = {
  ur: 'PK',
  hi: 'IN',
  bn: 'BD',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  pt: 'BR',
  tr: 'TR',
  ru: 'RU',
  zh: 'CN',
  ar: 'SA',
};

/**
 * When the app language changes, follow that language's country —
 * unless the shop owner has customised the country/currency by hand.
 */
export function applyLanguageCountry(settings, lang) {
  if (settings.currencyAuto === false) return null;
  const code = LANG_COUNTRY[lang];
  if (!code) return null;
  return applyCountry(settings, code);
}

export function countryProfile(code) {
  return COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];
}

export function currencyProfile(code) {
  return CURRENCIES.find((c) => c.code === code) || null;
}

/** Current shop currency settings (symbol + ISO code + locale). */
export function moneySettings() {
  const s = (db && db.settings) || {};
  return {
    symbol: s.currency || 'Rs',
    code: s.currencyCode || 'PKR',
    locale: s.locale || 'en-PK',
    country: s.country || 'PK',
  };
}

/** Apply a country profile to the shop settings (currency, symbol, locale). */
export function applyCountry(settings, countryCode) {
  const profile = countryProfile(countryCode);
  settings.country = profile.code;
  settings.currency = profile.symbol || settings.currency || 'Rs';
  settings.currencyCode = profile.currency || '';
  settings.locale = profile.locale || 'en-US';
  return profile;
}

/** Apply a currency preset (symbol, code and locale together). */
export function applyCurrency(settings, currencyCode) {
  const preset = currencyProfile(currencyCode);
  if (!preset) return null;
  settings.currency = preset.symbol;
  settings.currencyCode = preset.code;
  settings.locale = preset.locale;
  settings.country = preset.country;
  return preset;
}

/** Locale-aware number formatting (1,234.56 / 1.234,56 / 1 234,56). */
export function formatNumber(value, locale) {
  const n = Number(value) || 0;
  const loc = locale || moneySettings().locale;
  try {
    return new Intl.NumberFormat(loc, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

/** Locale-aware money, e.g. "Rs 1,234.56" / "₺1.234,56" / "€1 234,56". */
export function formatMoney(value, options = {}) {
  const n = Number(value) || 0;
  const cfg = options.symbol !== undefined
    ? { symbol: options.symbol, code: options.code || '', locale: options.locale || moneySettings().locale }
    : moneySettings();
  if (cfg.code) {
    try {
      return new Intl.NumberFormat(cfg.locale || 'en-US', {
        style: 'currency',
        currency: cfg.code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      /* unknown currency code — fall through */
    }
  }
  const number = formatNumber(n, cfg.locale);
  return cfg.symbol ? `${cfg.symbol} ${number}` : number;
}

/** Locale-aware short date (12 Nov 2026 / 12 Kas 2026 / 2026/11/12). */
export function formatDate(value, locale, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  const loc = locale || moneySettings().locale;
  const d = value instanceof Date ? value : new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleDateString(loc, opts);
  } catch {
    return d.toLocaleDateString('en-GB', opts);
  }
}

/** Locale-aware date + time. */
export function formatDateTime(value, locale) {
  return formatDate(value, locale, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Options markup for the country / currency selects. */
export function countryOptions(selected) {
  return COUNTRIES.map((c) =>
    `<option value="${c.code}"${c.code === selected ? ' selected' : ''}>${c.name} (${c.symbol || '—'})</option>`
  ).join('');
}

export function currencyOptions(selected) {
  return CURRENCIES.map((c) =>
    `<option value="${c.code}"${c.code === selected ? ' selected' : ''}>${c.symbol} — ${c.label}</option>`
  ).join('');
}
