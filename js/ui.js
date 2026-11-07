/* ============================================================
   Mart Manager — shared UI helpers
   ============================================================ */

import { db, round2 } from './db.js';

/* ---------- HTML escaping ---------- */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- money ---------- */
export function fmtMoney(n, withSymbol = true) {
  const num = Number(n) || 0;
  const text = num.toLocaleString('en-PK', {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `${db.settings.currency || 'Rs'} ${text}` : text;
}

export function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
}

export function fmtQty(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

/* ---------- icons (feather-style, inline SVG) ---------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.5 12.5a2 2 0 0 0 2 1.5h7.7a2 2 0 0 0 2-1.6L21 7H6"/>',
  box: '<path d="M21 8.5v7a2 2 0 0 1-1 1.7l-7 3.9a2 2 0 0 1-2 0l-7-3.9a2 2 0 0 1-1-1.7v-7a2 2 0 0 1 1-1.7l7-3.9a2 2 0 0 1 2 0l7 3.9a2 2 0 0 1 1 1.7z"/><path d="M3.3 7.3 12 12.2l8.7-4.9M12 22V12.2"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  truck: '<path d="M1 5h11v11H1zM12 9h4l4 4v3h-8z"/><circle cx="5.5" cy="19" r="1.8"/><circle cx="17.5" cy="19" r="1.8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  supplier: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 9h2M13 9h2M9 13h2M13 13h2M10 21v-4h4v4"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 4-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
  'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  home: '<path d="M3 9.5 12 3l9 6.5V21H3z"/><path d="M9 21v-7h6v7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  barcode: '<path d="M3 5v14M7 5v14M11 5v14M15 5v10M19 5v14"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
};

export function icon(name, cls = '') {
  const path = ICONS[name] || ICONS.box;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* ---------- toast ---------- */
export function toast(message, type = 'success', ms = 2600) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ic = type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check';
  el.innerHTML = `${icon(ic)}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'all .2s';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ---------- modal ---------- */
let activeModal = null;

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = '';
  activeModal = null;
  document.body.style.overflow = '';
}

export function openModal({ title, subtitle = '', body = '', footer = '', size = '', onMount, onClose }) {
  const root = document.getElementById('modal-root');
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
        </div>
        <button class="icon-btn" data-modal-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  activeModal = backdrop;
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) {
      closeModal();
      onClose?.();
    }
  });
  backdrop.querySelectorAll('[data-modal-close]').forEach((btn) =>
    btn.addEventListener('click', () => {
      closeModal();
      onClose?.();
    })
  );
  const escHandler = (e) => {
    if (e.key === 'Escape' && activeModal === backdrop) {
      closeModal();
      onClose?.();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
  onMount?.(backdrop);
  const firstInput = backdrop.querySelector('input:not([type=hidden]), select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
  return backdrop;
}

/* ---------- confirm ---------- */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      body: `<p class="muted" style="font-size:13px;line-height:1.6">${esc(message)}</p>`,
      footer: `
        <button class="btn btn-ghost" data-no>Cancel</button>
        <button class="btn ${danger ? 'btn-red' : ''}" data-yes>${esc(confirmText)}</button>`,
      onClose: () => resolve(false),
    });
    modal.querySelector('[data-no]').addEventListener('click', () => { closeModal(); resolve(false); });
    modal.querySelector('[data-yes]').addEventListener('click', () => { closeModal(); resolve(true); });
    setTimeout(() => modal.querySelector('[data-yes]')?.focus(), 80);
  });
}

/* ---------- navigation / refresh ---------- */
export function navigate(hash) {
  if (location.hash === hash) refresh();
  else location.hash = hash;
}

export function refresh() {
  window.dispatchEvent(new CustomEvent('app:refresh'));
}

/* ---------- misc ---------- */
export function todayInput() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function downloadFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function toCSV(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
}

export function emptyState({ iconName = 'box', title, text, action = '' }) {
  return `
    <div class="empty">
      <div class="art">${icon(iconName)}</div>
      <h4>${esc(title)}</h4>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

export function productStockBadge(product) {
  const stock = Number(product.stock || 0);
  const low = Number(product.lowStock ?? db.settings.lowStock ?? 5);
  if (stock <= 0) return `<span class="badge red"><span class="dot"></span>Out of stock</span>`;
  if (stock <= low) return `<span class="badge amber"><span class="dot"></span>Low · ${fmtQty(stock)}</span>`;
  return `<span class="badge green"><span class="dot"></span>${fmtQty(stock)} in stock</span>`;
}

export function paymentBadge(method) {
  const m = method || 'Cash';
  if (m === 'Udhaar') return `<span class="badge amber">Udhaar</span>`;
  if (m === 'Card') return `<span class="badge blue">Card</span>`;
  if (m === 'Bank') return `<span class="badge teal">Bank</span>`;
  return `<span class="badge green">Cash</span>`;
}

export function sum(arr, fn) {
  return round2(arr.reduce((acc, item) => acc + Number(fn(item) || 0), 0));
}
