/* ============================================================
   mhzaly — shop database (cloud-synced with local cache)
   ============================================================ */

import { scheduleSync } from './api.js';

const LEGACY_KEY = 'mart_manager_db_v1';
const CACHE_PREFIX = 'mhzaly_db_';
const SCHEMA_VERSION = 1;

let storageKey = LEGACY_KEY;
let syncEnabled = false;

/* Shop categories offered at signup. Products are seeded by the API. */
export const SHOP_TYPES = [
  { id: 'mart', label: 'Mart / Kiryana', hint: 'Grocery, household items, drinks aur daily-use products.' },
  { id: 'mobile', label: 'Mobile Shop', hint: 'Chargers, cables, covers, earbuds aur mobile accessories.' },
  { id: 'electronics', label: 'Electronics', hint: 'Bulbs, fans, kettles, wires aur electrical items.' },
  { id: 'medical', label: 'Medical Store / Pharmacy', hint: 'Medicines, first aid, hygiene aur health products.' },
  { id: 'clothing', label: 'Clothing / Garments', hint: 'Shirts, kurtis, jeans, kids wear aur accessories.' },
  { id: 'cosmetics', label: 'Cosmetics / Beauty', hint: 'Makeup, skincare, haircare aur perfumes.' },
  { id: 'stationery', label: 'Stationery', hint: 'Pens, notebooks, school aur office items.' },
  { id: 'hardware', label: 'Hardware', hint: 'Tools, paint, locks, wires aur plumbing items.' },
  { id: 'bakery', label: 'Bakery / Food', hint: 'Bread, cakes, cookies, patties aur bakery items.' },
  { id: 'general', label: 'General Store', hint: 'Mixed daily-use products — grocery style starter list.' },
  { id: 'other', label: 'Other', hint: 'Koi aur type ki shop — starter products khali rahenge.' },
];

export function shopTypeLabel(id) {
  return SHOP_TYPES.find((type) => type.id === id)?.label || SHOP_TYPES[0].label;
}

/* Common grocery items every new shop starts with. */
export const COMMON_PRODUCTS = [
  { name: 'Daal Chana (500g)', category: 'Grocery', unit: 'pack', cost: 145, price: 180, lowStock: 10, sku: '1001' },
  { name: 'Basmati Rice 1kg', category: 'Grocery', unit: 'kg', cost: 230, price: 280, lowStock: 10, sku: '1002' },
  { name: 'Cooking Oil 1L', category: 'Grocery', unit: 'ltr', cost: 420, price: 490, lowStock: 10, sku: '1003' },
  { name: 'Sugar 1kg', category: 'Grocery', unit: 'kg', cost: 135, price: 160, lowStock: 8, sku: '1004' },
  { name: 'Tea 190g', category: 'Beverages', unit: 'pack', cost: 480, price: 560, lowStock: 6, sku: '1005' },
  { name: 'Milk Pack 1L', category: 'Dairy', unit: 'pack', cost: 235, price: 270, lowStock: 12, sku: '1006' },
  { name: 'Eggs (Dozen)', category: 'Dairy', unit: 'dozen', cost: 290, price: 340, lowStock: 5, sku: '1007' },
  { name: 'Bread Large', category: 'Bakery', unit: 'pack', cost: 130, price: 160, lowStock: 6, sku: '1008' },
  { name: 'Soap Bar', category: 'Household', unit: 'pcs', cost: 105, price: 140, lowStock: 6, sku: '1009' },
  { name: 'Detergent 1kg', category: 'Household', unit: 'pack', cost: 330, price: 410, lowStock: 5, sku: '1010' },
  { name: 'Cold Drink 1.5L', category: 'Beverages', unit: 'bottle', cost: 150, price: 190, lowStock: 8, sku: '1011' },
  { name: 'Biscuits Family Pack', category: 'Snacks', unit: 'pack', cost: 90, price: 120, lowStock: 10, sku: '1012' },
];

export function defaultSettings() {
  return {
    shopName: 'My Mart',
    ownerName: '',
    phone: '',
    shopType: 'mart',
    address: '',
    currency: 'Rs',
    taxRate: 0,
    lowStock: 5,
    receiptNote: 'Thank you for shopping with us!',
  };
}

function freshDb() {
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(),
    products: [],
    customers: [],
    suppliers: [],
    sales: [],
    purchases: [],
    payments: [],
    expenses: [],
    counters: { invoice: 1, purchase: 1 },
    createdAt: new Date().toISOString(),
  };
}

export function normalizeDb(parsed) {
  const base = freshDb();
  const data = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    ...base,
    ...data,
    settings: { ...base.settings, ...(data.settings || {}) },
    counters: { ...base.counters, ...(data.counters || {}) },
    products: Array.isArray(data.products) ? data.products : [],
    customers: Array.isArray(data.customers) ? data.customers : [],
    suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
    sales: Array.isArray(data.sales) ? data.sales : [],
    purchases: Array.isArray(data.purchases) ? data.purchases : [],
    payments: Array.isArray(data.payments) ? data.payments : [],
    expenses: Array.isArray(data.expenses) ? data.expenses : [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return freshDb();
    return normalizeDb(JSON.parse(raw));
  } catch (err) {
    console.error('Could not read local data, starting fresh.', err);
    return freshDb();
  }
}

export let db = load();

/** Point the app at a shop cache (or demo cache) before loading data. */
export function configureShop({ shopId = null, demo = false } = {}) {
  syncEnabled = Boolean(shopId) && !demo;
  storageKey = demo ? `${CACHE_PREFIX}demo` : shopId ? `${CACHE_PREFIX}${shopId}` : LEGACY_KEY;
  db = load();
  return db;
}

/** Replace in-memory data with the server copy and refresh local cache. */
export function hydrate(remoteData) {
  db = normalizeDb(remoteData);
  writeLocal();
}

export function isSyncEnabled() {
  return syncEnabled;
}

function writeLocal() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(db));
  } catch (err) {
    console.error('Could not save local cache.', err);
  }
}

export function save() {
  writeLocal();
  if (syncEnabled) scheduleSync(JSON.stringify(db));
}

/** Add the common starter products to a brand new shop. */
export function seedCommonProducts() {
  const existing = new Set(db.products.map((p) => String(p.name || '').toLowerCase()));
  const now = new Date().toISOString();
  let added = 0;
  COMMON_PRODUCTS.forEach((item) => {
    if (existing.has(item.name.toLowerCase())) return;
    db.products.push({
      id: uid('prd'),
      name: item.name,
      sku: item.sku,
      category: item.category,
      unit: item.unit,
      cost: item.cost,
      price: item.price,
      stock: 10,
      lowStock: item.lowStock,
      createdAt: now,
      updatedAt: now,
    });
    added += 1;
  });
  if (added) save();
  return added;
}


export function replaceDb(next) {
  db = { ...freshDb(), ...next };
  save();
}

export function exportDb() {
  return JSON.stringify(db, null, 2);
}

export function importDb(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid backup file');
  if (!Array.isArray(parsed.products) || !Array.isArray(parsed.sales)) {
    throw new Error('This file does not look like a Mart Manager backup');
  }
  const base = freshDb();
  db = {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings || {}) },
    counters: { ...base.counters, ...(parsed.counters || {}) },
  };
  save();
}

export function clearAll() {
  db = freshDb();
  save();
}

/* ---------------- helpers ---------------- */

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function invoiceNo() {
  return 'INV-' + String(db.counters.invoice).padStart(4, '0');
}

export function purchaseNo() {
  return 'PUR-' + String(db.counters.purchase).padStart(4, '0');
}

export function getProduct(id) {
  return db.products.find((p) => p.id === id) || null;
}

export function getCustomer(id) {
  return db.customers.find((c) => c.id === id) || null;
}

export function getSupplier(id) {
  return db.suppliers.find((s) => s.id === id) || null;
}

export function categories() {
  return [...new Set(db.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function lowStockProducts() {
  return db.products
    .filter((p) => Number(p.stock) <= Number(p.lowStock ?? db.settings.lowStock))
    .sort((a, b) => Number(a.stock) - Number(b.stock));
}

export function stockValue() {
  return db.products.reduce((sum, p) => sum + Number(p.stock || 0) * Number(p.cost || 0), 0);
}

export function customerBalance(customerId) {
  const due = db.sales
    .filter((s) => !s.voided && s.customerId === customerId)
    .reduce((sum, s) => sum + Number(s.due || 0), 0);
  const paid = db.payments
    .filter((p) => p.type === 'received' && p.customerId === customerId)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return round2(due - paid);
}

export function supplierBalance(supplierId) {
  const due = db.purchases
    .filter((p) => p.supplierId === supplierId)
    .reduce((sum, p) => sum + Number(p.due || 0), 0);
  const paid = db.payments
    .filter((p) => p.type === 'paid' && p.supplierId === supplierId)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return round2(due - paid);
}

export function totalReceivable() {
  return round2(db.customers.reduce((sum, c) => sum + Math.max(0, customerBalance(c.id)), 0));
}

export function totalPayable() {
  return round2(db.suppliers.reduce((sum, s) => sum + Math.max(0, supplierBalance(s.id)), 0));
}

export function saleProfit(sale) {
  const gross = sale.items.reduce(
    (sum, item) => sum + Number(item.qty || 0) * (Number(item.price || 0) - Number(item.cost || 0)),
    0
  );
  return round2(gross - Number(sale.discount || 0));
}

export function activeSales() {
  return db.sales.filter((s) => !s.voided);
}

export function salesBetween(fromKey, toKey) {
  return activeSales().filter((s) => {
    const key = dayKey(s.date);
    return (!fromKey || key >= fromKey) && (!toKey || key <= toKey);
  });
}

/* ---------------- date helpers ---------------- */

export function dayKey(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey() {
  return dayKey(new Date());
}

export function addDaysKey(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/* ---------------- sample data ---------------- */

export function loadSampleData() {
  const now = new Date();
  const iso = (offsetDays, hour = 12, minute = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  db = freshDb();
  db.settings = {
    shopName: 'Al-Madina Mart',
    ownerName: 'Shop Owner',
    phone: '0300-1234567',
    address: 'Main Bazaar, Lahore',
    currency: 'Rs',
    taxRate: 0,
    lowStock: 5,
    receiptNote: 'Thank you! Please come again.',
  };

  const p = (item) => ({
    id: uid('prd'),
    name: item.name,
    sku: item.sku,
    category: item.category,
    unit: item.unit,
    cost: item.cost,
    price: item.price,
    stock: 0,
    lowStock: item.lowStock,
    createdAt: iso(-60),
    updatedAt: iso(-60),
  });

  db.products = COMMON_PRODUCTS.map(p);

  const c1 = { id: uid('cus'), name: 'Ahmed Ali', phone: '0301-9876543', address: 'Street 4, Model Town', createdAt: iso(-40) };
  const c2 = { id: uid('cus'), name: 'Fatima Bibi', phone: '0322-1112233', address: 'Near Mosque, Main Bazaar', createdAt: iso(-25) };
  db.customers = [c1, c2];

  const s1 = { id: uid('sup'), name: 'Metro Wholesale', phone: '042-111222333', address: 'Wholesale Market', notes: 'Weekly supply', createdAt: iso(-50) };
  const s2 = { id: uid('sup'), name: 'Al-Karam Distributors', phone: '0300-5554443', address: 'Industrial Area', notes: '', createdAt: iso(-30) };
  db.suppliers = [s1, s2];

  const find = (sku) => db.products.find((x) => x.sku === sku);
  const mkSale = (no, daysAgo, items, discount, method, customer) => {
    const lines = items.map(([sku, qty]) => {
      const prod = find(sku);
      return { productId: prod.id, name: prod.name, qty, price: prod.price, cost: prod.cost };
    });
    const subtotal = round2(lines.reduce((s, i) => s + i.qty * i.price, 0));
    const total = round2(subtotal - discount);
    const paid = method === 'Udhaar' ? 0 : total;
    return {
      id: uid('sale'),
      no: 'INV-' + String(no).padStart(4, '0'),
      date: iso(-daysAgo, 10 + (no % 8), 15),
      items: lines,
      subtotal,
      discount,
      tax: 0,
      total,
      paid,
      due: round2(total - paid),
      method,
      customerId: customer ? customer.id : null,
      customerName: customer ? customer.name : 'Walk-in',
      note: '',
    };
  };

  db.sales = [
    mkSale(1, 6, [['1001', 2], ['1002', 1], ['1012', 3]], 0, 'Cash', null),
    mkSale(2, 5, [['1005', 1], ['1006', 2]], 20, 'Cash', null),
    mkSale(3, 4, [['1003', 1], ['1004', 2], ['1009', 2]], 0, 'Udhaar', c1),
    mkSale(4, 3, [['1007', 1], ['1008', 2]], 10, 'Card', null),
    mkSale(5, 2, [['1002', 2], ['1011', 2], ['1012', 2]], 0, 'Udhaar', c2),
    mkSale(6, 1, [['1001', 3], ['1004', 1], ['1010', 1]], 30, 'Cash', null),
    mkSale(7, 0, [['1005', 1], ['1012', 4], ['1011', 1]], 0, 'Cash', null),
    mkSale(8, 0, [['1002', 1], ['1006', 1], ['1008', 1]], 0, 'Cash', c1),
  ];
  db.counters.invoice = 9;

  db.purchases = [
    {
      id: uid('pur'),
      no: 'PUR-0001',
      date: iso(-7, 9, 30),
      supplierId: s1.id,
      supplierName: s1.name,
      items: [
        { productId: find('1001').id, name: find('1001').name, qty: 24, cost: 140 },
        { productId: find('1004').id, name: find('1004').name, qty: 20, cost: 132 },
      ],
      total: 6000,
      paid: 4000,
      due: 2000,
      note: 'Restock',
    },
  ];
  db.counters.purchase = 2;

  db.payments = [
    { id: uid('pay'), date: iso(-3, 16), type: 'received', customerId: c1.id, amount: 500, method: 'Cash', note: 'Khata payment' },
  ];

  db.expenses = [
    { id: uid('exp'), date: iso(-2, 11), category: 'Utilities', amount: 500, note: 'Electricity bill' },
    { id: uid('exp'), date: iso(0, 9), category: 'Transport', amount: 250, note: 'Delivery fuel' },
  ];

  // Fix stock so sample numbers stay realistic
  const stockMap = { 1001: 42, 1002: 55, 1003: 8, 1004: 30, 1005: 18, 1006: 4, 1007: 12, 1008: 6, 1009: 24, 1010: 15, 1011: 20, 1012: 36 };
  db.products.forEach((prod) => { if (stockMap[prod.sku] != null) prod.stock = stockMap[prod.sku]; });

  save();
}
