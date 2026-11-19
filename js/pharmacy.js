/* ============================================================
   mhzaly — Pharmacy engine (multi-batch, expiry, FEFO)
   ============================================================ */

import { db, uid } from './db.js';
import { esc } from './ui.js';

const STATE_RANK = { none: 0, ok: 1, soon: 2, critical: 3, expired: 4 };

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

function expiryTime(value) {
  if (!value) return Infinity;
  const t = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(t) ? Infinity : t;
}

export function sortBatches(list) {
  return list.slice().sort((a, b) => {
    const ea = expiryTime(a.expiry);
    const eb = expiryTime(b.expiry);
    if (ea !== eb) return ea - eb;
    return String(a.batch || '').localeCompare(String(b.batch || ''));
  });
}

/** All batches of a product. Legacy products (no batches[]) map to one batch. */
export function productBatches(product) {
  const p = product || {};
  if (Array.isArray(p.batches)) {
    return p.batches
      .filter((b) => b && Number(b.qty) > 0)
      .map((b) => ({
        id: b.id || '',
        batch: b.batch || '',
        expiry: b.expiry || '',
        qty: Number(b.qty) || 0,
        cost: Number(b.cost) || Number(p.cost) || 0,
        supplierName: b.supplierName || '',
        receivedAt: b.receivedAt || '',
        note: b.note || '',
      }));
  }
  if ((p.expiry || p.batch) && Number(p.stock) > 0) {
    return [{
      id: '',
      batch: p.batch || '',
      expiry: p.expiry || '',
      qty: Number(p.stock) || 0,
      cost: Number(p.cost) || 0,
      supplierName: '',
      receivedAt: '',
      note: '',
    }];
  }
  return [];
}

export function nearestBatch(product, { validOnly = false } = {}) {
  const list = productBatches(product).filter(
    (b) => !validOnly || expiryState(b.expiry).state !== 'expired'
  );
  return sortBatches(list)[0] || null;
}

/** Worst expiry state across all stock batches. */
export function productExpiryState(product) {
  const list = productBatches(product);
  if (!list.length) return expiryState(product && product.expiry);
  return list.reduce(
    (worst, b) => {
      const s = expiryState(b.expiry);
      return STATE_RANK[s.state] > STATE_RANK[worst.state] ? s : worst;
    },
    { state: 'none', days: null }
  );
}

/** Products with at least one expired/near-expiry batch. */
export function expiringProducts(withinDays = 90) {
  if (!isPharmacy()) return [];
  return db.products
    .map((p) => {
      const st = productExpiryState(p);
      const nb = nearestBatch(p);
      return { ...p, _exp: st, _batch: nb };
    })
    .filter(
      (p) =>
        p._exp.state === 'expired' ||
        (p._exp.days !== null && p._exp.days <= withinDays)
    )
    .sort((a, b) => (a._exp.days ?? 99999) - (b._exp.days ?? 99999));
}

/** Batch-level rows for reports — accurate value at risk. */
export function expiringBatches(withinDays = 90) {
  if (!isPharmacy()) return [];
  const rows = [];
  for (const p of db.products) {
    for (const b of productBatches(p)) {
      const st = expiryState(b.expiry);
      if (st.state === 'expired' || (st.days !== null && st.days <= withinDays)) {
        rows.push({
          product: p,
          batch: b,
          exp: st,
          value: b.qty * (Number(b.cost) || Number(p.cost) || 0),
        });
      }
    }
  }
  return rows.sort((a, b) => (a.exp.days ?? 99999) - (b.exp.days ?? 99999));
}

/** Keep product.batch / product.expiry in sync with the earliest batch. */
export function syncLegacyBatch(product) {
  const list = productBatches(product);
  if (!list.length) return;
  const first = sortBatches(list)[0];
  product.batch = first.batch || '';
  product.expiry = first.expiry || '';
}

export function ensureBatchesFromLegacy(product) {
  const p = product;
  if (Array.isArray(p.batches) && p.batches.length) return;
  if ((p.batch || p.expiry) && Number(p.stock) > 0) {
    p.batches = [{
      id: uid('bat'),
      batch: p.batch || '',
      expiry: p.expiry || '',
      qty: Number(p.stock) || 0,
      cost: Number(p.cost) || 0,
      receivedAt: p.createdAt || new Date().toISOString(),
    }];
  }
}

export function addBatch(product, entry) {
  const p = product;
  ensureBatchesFromLegacy(p);
  const qty = Number(entry && entry.qty) || 0;
  if (qty <= 0) return null;
  const batch = String((entry && entry.batch) || '').trim();
  const expiry = String((entry && entry.expiry) || '');
  p.batches = Array.isArray(p.batches) ? p.batches : [];
  let row = p.batches.find(
    (b) =>
      String(b.batch || '').toLowerCase() === batch.toLowerCase() &&
      String(b.expiry || '') === expiry
  );
  if (row) {
    row.qty = (Number(row.qty) || 0) + qty;
    if (entry.cost !== undefined && entry.cost !== null && entry.cost !== '') {
      row.cost = Number(entry.cost) || 0;
    }
    if (entry.supplierName) row.supplierName = entry.supplierName;
  } else {
    row = {
      id: uid('bat'),
      batch,
      expiry,
      qty,
      cost: Number(entry.cost) || 0,
      supplierName: entry.supplierName || '',
      receivedAt: new Date().toISOString(),
      note: entry.note || '',
    };
    p.batches.push(row);
  }
  p.stock = (Number(p.stock) || 0) + qty;
  syncLegacyBatch(p);
  return row;
}

export function removeBatch(product, batchId) {
  const p = product;
  if (!Array.isArray(p.batches)) return false;
  const idx = p.batches.findIndex((b) => b.id === batchId);
  if (idx < 0) return false;
  const qty = Number(p.batches[idx].qty) || 0;
  p.batches.splice(idx, 1);
  p.stock = Math.max(0, (Number(p.stock) || 0) - qty);
  syncLegacyBatch(p);
  return true;
}

/** Write off expired/damaged stock from one batch. */
export function writeOffBatch(product, batchId, qty, reason = '') {
  const p = product;
  const b = (p.batches || []).find((x) => x.id === batchId);
  if (!b) return null;
  const take = Math.min(Number(qty) || 0, Number(b.qty) || 0);
  if (take <= 0) return null;
  b.qty = (Number(b.qty) || 0) - take;
  p.stock = Math.max(0, (Number(p.stock) || 0) - take);
  const loss = take * (Number(b.cost) || Number(p.cost) || 0);
  syncLegacyBatch(p);
  return { qty: take, loss, batch: b, reason };
}

/**
 * FEFO allocation: sell earliest-expiring valid batch first.
 * Returns { allocations, remaining }. remaining > 0 means not enough valid stock.
 */
export function allocateBatches(product, qty) {
  const want = Number(qty) || 0;
  const allocations = [];
  let remaining = want;
  const list = sortBatches(
    productBatches(product).filter((b) => expiryState(b.expiry).state !== 'expired')
  );
  for (const b of list) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.qty);
    if (take > 0) {
      allocations.push({ id: b.id, batch: b.batch, expiry: b.expiry, qty: take });
      remaining -= take;
    }
  }
  const batchTotal = productBatches(product).reduce((a, b) => a + b.qty, 0);
  const unbatch = Math.max(0, (Number(product.stock) || 0) - batchTotal);
  if (remaining > 0 && unbatch > 0) {
    const take = Math.min(remaining, unbatch);
    allocations.push({ id: '', batch: '', expiry: '', qty: take, unbatch: true });
    remaining -= take;
  }
  return { allocations, remaining };
}

/** Deduct sold quantities from batch rows (stock itself is deducted by POS). */
export function deductBatches(product, allocations) {
  if (!Array.isArray(product.batches)) return;
  for (const a of allocations || []) {
    if (!a.id) continue;
    const b = product.batches.find((x) => x.id === a.id);
    if (b) b.qty = Math.max(0, (Number(b.qty) || 0) - (Number(a.qty) || 0));
  }
  syncLegacyBatch(product);
}

/** Number of valid (non-expired) units that can actually be sold. */
export function sellableQty(product) {
  const batches = productBatches(product);
  const batchTotal = batches.reduce((a, b) => a + b.qty, 0);
  const unbatch = Math.max(0, (Number(product.stock) || 0) - batchTotal);
  const valid = batches
    .filter((b) => expiryState(b.expiry).state !== 'expired')
    .reduce((a, b) => a + b.qty, 0);
  return valid + unbatch;
}
