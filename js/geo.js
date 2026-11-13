// mhzaly — IP‑based country / language / currency detection
// Free, offline‑first, uses Cloudflare edge header CF‑IPCountry only.
// Falls back gracefully when the header is absent (local dev, etc.).

export const GEO_DONE = 'mhzaly_geo_done';
export const LANG_EXPLICIT = 'mhzaly_lang_explicit';
export const COUNTRY = 'mhzaly_geo_country';

/** Map ISO‑2 country code → preferred UI language (ISO‑639‑1). */
export const COUNTRY_LANG = {
  PK: 'ur', // Pakistan → Urdu script
  IN: 'hi', // India → Hindi
  BD: 'bn', // Bangladesh → Bengali
  SA: 'ar', // Saudi Arabia → Arabic
  AE: 'ar', // UAE → Arabic
  QA: 'ar', // Qatar → Arabic
  KW: 'ar', // Kuwait → Arabic
  EG: 'ar', // Egypt → Arabic
  DE: 'de', // Germany → German
  FR: 'fr', // France → French
  ES: 'es', // Spain → Spanish
  PT: 'pt', // Portugal / Brazil → Portuguese
  TR: 'tr', // Turkey → Turkish
  RU: 'ru', // Russia → Russian
  CN: 'zh', // China → Chinese (Simplified)
  US: 'en', // United States → English
  GB: 'en', // United Kingdom → English
  CA: 'en', // Canada → English
  AU: 'en', // Australia → English
  NZ: 'en', // New Zealand → English,
  // everything else defaults to English (so the UI stays in a language the user likely reads)
  DEFAULT: 'en',
};

/** Detect country from Cloudflare header (same‑origin, no third‑party API). */
export async function detectGeo() {
  try {
    const resp = await fetch('/api/geo', {
      // same‑origin; Cloudflare will automatically forward CF‑IPCountry
      credentials: 'omit',
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      countryCode: data.country || '',
      city: data.city || '',
      region: data.region || '',
      timezone: data.timezone || '',
    };
  } catch (e) {
    // fetch failed – likely local dev without the function; gracefully return null
    // (caller can decide to fall back to manual selection)
    return null;
  }
}

/**
 * Apply detected country defaults on first visit.
 * – Language: if the user has not explicitly chosen a language, set it now.
 * – Store flags so we don’t re‑apply on every page load.
 * – NOTE: currency & tax are applied later when the shop is created (configureShop).
 */
export async function applyGeoDefaults() {
  // already done? → nothing
  if (localStorage.getItem(GEO_DONE) === '1') return;

  // mark that we ran (even if no country found – prevents infinite loops)
  localStorage.setItem(GEO_DONE, '1');

  const geo = await detectGeo();
  if (!geo || !geo.countryCode) return; // nothing to apply

  // remember the country for later (e.g. shop creation)
  localStorage.setItem(COUNTRY, geo.countryCode);

  // ----- Language -----
  // if the user has not manually overridden the language, use the IP‑derived one
  const explicit = localStorage.getItem(LANG_EXPLICIT) === '1';
  if (!explicit) {
    const langMap = COUNTRY_LANG;
    const lang = langMap[geo.countryCode] || COUNTRY_LANG.DEFAULT;
    // store the chosen language (source language = Roman Urdu is always available)
    localStorage.setItem('mhzaly_lang', lang);
    // also set the source-language marker so t()/hasTranslation() work correctly
    localStorage.setItem('mhzaly_source_lang', lang === 'ur' ? 'ur-roman' : 'ur');
  }
}

/** Call this once after the shop has been created / configured.
 *  It applies the stored country defaults (currency, locale, tax) to the shop’s
 *  settings, but only when the shop is still fresh (no products / no owner name).
 */
export function applyGeoToFreshShop() {
  // only run once per shop creation
  if (localStorage.getItem('mhzaly_geo_applied_to_shop') === '1') return;
  if (!db || !db.settings) return; // db not ready yet

  const countryCode = localStorage.getItem(COUNTRY);
  if (!countryCode) return; // no geo data

  // only apply if the shop hasn’t been customised yet
  const isFresh =
    !db.settings.ownerName &&
    !db.settings.shopName &&
    (db.products?.length === 0 || true) && // be permissive – any fresh shop
    !db.settings._geo_applied;

  if (!isFresh) return;

  // apply country profile (currency, locale, tax name)
  const profile = applyCountry(db.settings, countryCode); // from currency.js
  // apply tax system if the profile has a known tax value
  if (profile && profile.tax && profile.tax !== 'OTHER') {
    applyTaxCountry(db.settings, profile.tax); // from tax.js
  }

  // if the shop has no explicit language yet, overlay the geo language
  if (!db.settings.language) {
    const langMap = COUNTRY_LANG;
    db.settings.language = langMap[countryCode] || COUNTRY_LANG.DEFAULT;
  }

  // remember that we applied
  db.settings._geo_applied = true;
  localStorage.setItem('mhzaly_geo_applied_to_shop', '1');
  save(); // writes localStorage + schedules sync
}
