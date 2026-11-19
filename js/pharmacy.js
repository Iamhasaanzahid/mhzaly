/* ============================================================
   mhzaly — Pharmacy helpers (batch, expiry, salt/formula)
   ============================================================ */

import { db } from './db.js';
import { esc } from './ui.js';

export function isPharmacy() {
  return String((db.settings && db.settings.shopType) || '') === 'medical';
}

export function expiryState(value) {
  if (!value) return { state: 'none', days: null };
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { state: 'none', days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { state: 'expired', days };
  if (days <= 30) return { state: 'critical', days };
  if (days <= 90) return { state: 'soon', days };
  return { state: 'ok', days };
}

export function expiryLabel(value) {
  const { state, days } = expiryState(value);
  if (state === 'none') return '';
  if (state === 'expired') return 'Expired';
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}

export function expiryBadge(value) {
  const { state, days } = expiryState(value);
  if (state === 'none') return '<span class="hint">—</span>';
  if (state === 'expired') return '<span class="badge danger">Expired</span>';
  if (state === 'critical') return `<span class="badge danger">${days === 0 ? 'Today' : `${days}d`}</span>`;
  if (state === 'soon') return `<span class="badge warn">${days}d</span>`;
  return `<span class="badge ok">${esc(new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))}</span>`;
}

export function expiringProducts(withinDays = 90) {
  if (!isPharmacy()) return [];
  return db.products
    .map((p) => ({ ...p, _exp: expiryState(p.expiry) }))
    .filter((p) => p._exp.state === 'expired' || (p._exp.days !== null && p._exp.days <= withinDays))
    .sort((a, b) => (a._exp.days ?? 99999) - (b._exp.days ?? 99999));
}
