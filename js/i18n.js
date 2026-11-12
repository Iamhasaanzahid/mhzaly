/* ============================================================
   mhzaly — multi-language engine (i18n)
   Offline, zero-cost, 12 languages including RTL (Arabic).
   Works by translating rendered text nodes against a dictionary
   of the exact UI strings used across the app.
   ============================================================ */

import { db } from './db.js';

import ur from './i18n/ur.js';
import en from './i18n/en.js';
import hi from './i18n/hi.js';
import de from './i18n/de.js';
import fr from './i18n/fr.js';
import es from './i18n/es.js';
import pt from './i18n/pt.js';
import tr from './i18n/tr.js';
import ru from './i18n/ru.js';
import zh from './i18n/zh.js';
import ar from './i18n/ar.js';
import bn from './i18n/bn.js';

export const LANGS = [
  { code: 'ur', name: 'Urdu (Roman)', native: 'اردو (Roman Urdu)', dir: 'ltr', flag: '🇵🇰' },
  { code: 'en', name: 'English', native: 'English', dir: 'ltr', flag: '🇬🇧' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', dir: 'ltr', flag: '🇧🇩' },
  { code: 'de', name: 'German', native: 'Deutsch', dir: 'ltr', flag: '🇩🇪' },
  { code: 'fr', name: 'French', native: 'Français', dir: 'ltr', flag: '🇫🇷' },
  { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr', flag: '🇪🇸' },
  { code: 'pt', name: 'Portuguese', native: 'Português', dir: 'ltr', flag: '🇧🇷' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', dir: 'ltr', flag: '🇹🇷' },
  { code: 'ru', name: 'Russian', native: 'Русский', dir: 'ltr', flag: '🇷🇺' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '中文（简体）', dir: 'ltr', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl', flag: '🇸🇦' },
];

const DICTS = { ur, en, hi, bn, de, fr, es, pt, tr, ru, zh, ar };
const LANG_KEY = 'mhzaly_lang';

let current = 'ur';

export function langMeta(code) {
  return LANGS.find((l) => l.code === code) || LANGS[0];
}

export function isRtl(code = current) {
  return langMeta(code).dir === 'rtl';
}

/** Best supported language for this device (falls back to Roman Urdu). */
export function detectLang() {
  const candidates = [];
  try {
    const nav = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (const tag of nav) {
      const lower = String(tag || '').toLowerCase();
      if (!lower) continue;
      candidates.push(lower.split('-')[0]);
      if (lower.startsWith('zh')) candidates.push('zh');
    }
  } catch { /* navigator unavailable */ }
  for (const code of candidates) {
    // English is intentionally not auto-detected: the app's base language is
    // Roman Urdu, so an English browser must not silently switch the shop.
    if (code === 'en') continue;
    if (DICTS[code]) return code;
  }
  return 'ur';
}

export function getLang() {
  return current;
}

/** Switch the UI language. Persisted locally and in the shop settings (cloud synced). */
export function setLang(code, { persist = true } = {}) {
  const next = DICTS[code] ? code : 'ur';
  current = next;
  try { localStorage.setItem(LANG_KEY, next); } catch { /* storage blocked */ }
  if (persist) {
    try {
      if (db && db.settings) db.settings.language = next;
    } catch { /* db not ready */ }
  }
  applyDocumentLang();
  return next;
}

export function storedLang() {
  try { return localStorage.getItem(LANG_KEY) || ''; } catch { return ''; }
}

/** Language chosen before sign-up (kept even if the shop is not created yet). */
export function pendingLang() {
  return storedLang() || detectLang();
}

/** Translate a single string. Roman Urdu is the source language; unknown
 *  strings stay in the source language instead of silently switching to English. */
export function t(source) {
  const key = String(source ?? '');
  if (current === 'ur') return key;
  const table = DICTS[current] || {};
  if (table[key]) return table[key];
  return key;
}

/** True when the current language has a translation for this string. */
export function hasTranslation(source) {
  if (current === 'ur') return true;
  const table = DICTS[current] || {};
  return Boolean(table[String(source ?? '')]);
}

export function applyDocumentLang() {
  const meta = langMeta(current);
  document.documentElement.lang = current;
  document.documentElement.dir = meta.dir;
  document.documentElement.setAttribute('data-lang', current);
}

/** Coverage of the current language against the English catalog. */
export function coverage(code = current) {
  if (code === 'ur') return 100;
  const base = Object.keys(DICTS.en || {}).length || 1;
  const done = Object.keys(DICTS[code] || {}).length;
  return Math.min(100, Math.round((done / base) * 100));
}

/* ---------- DOM translation ---------- */

const ATTRS = ['placeholder', 'title', 'aria-label'];

function translateTextNode(node) {
  const raw = node.nodeValue || '';
  const trimmed = raw.trim();
  if (!trimmed) return;
  const table = DICTS[current] || {};
  let hit = table[trimmed];
  if (!hit && trimmed.endsWith(':')) hit = table[trimmed.slice(0, -1)];
  if (!hit) return;
  const translated = trimmed.endsWith(':') && !table[trimmed] ? `${hit}:` : hit;
  node.nodeValue = raw.replace(trimmed, translated);
}

/**
 * Translate a rendered DOM tree in place. Safe to call after every page
 * render — unknown strings simply stay in the source language.
 */
export function translateTree(root = document) {
  if (!root) return;
  const table = DICTS[current] || {};
  if (!Object.keys(table).length) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement && node.parentElement.closest('script, style, code, pre')
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) translateTextNode(node);

  const elements = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label]') : [];
  for (const el of elements) {
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const hit = table[value] || (value.endsWith(':') ? table[value.slice(0, -1)] : '');
      if (hit) el.setAttribute(attr, value.endsWith(':') && !table[value] ? `${hit}:` : hit);
    }
  }
}

/** Apply the current language to the document (direction + strings). */
export function applyLang(root = document) {
  applyDocumentLang();
  translateTree(root);
}

/** Boot the language engine: saved choice → shop setting → device language. */
export function initLang() {
  const saved = storedLang();
  if (saved && DICTS[saved]) {
    current = saved;
  } else {
    try {
      const shopLang = db && db.settings ? db.settings.language : '';
      current = shopLang && DICTS[shopLang] ? shopLang : detectLang();
    } catch {
      current = detectLang();
    }
    try { localStorage.setItem(LANG_KEY, current); } catch { /* storage blocked */ }
  }
  applyDocumentLang();
  return current;
}

/** Options markup for <select> based language pickers. */
export function languageOptions(selected = current) {
  return LANGS.map((l) =>
    `<option value="${l.code}"${l.code === selected ? ' selected' : ''}>${l.flag} ${l.native}</option>`
  ).join('');
}
