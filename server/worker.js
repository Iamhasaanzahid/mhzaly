/* ============================================================
   mhzaly — Enhanced Cloudflare Worker + D1
   Multi-shop SaaS with subscriptions, security, audit log
   ============================================================ */

const PBKDF2_ITERATIONS = 60000;
const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
const MAX_DATA_BYTES = 2 * 1024 * 1024;
const OWNER_EMAIL_DEFAULT = 'mhzcyb@gmail.com';
const CONFIRM_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const PUBLIC_APP_URL = 'https://mhzaly.pages.dev/';
const OWNER_PANEL_URL = 'https://mhzaly.pages.dev/owner.html';

/* ---------- Security constants ---------- */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;      // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20;          // per IP per endpoint per minute
const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const PASSWORD_MIN_LENGTH = 8;
const SECURE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

const MART_PRODUCTS = [
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

const SHOP_TYPES = {
  mart: { label: 'Mart / Kiryana', products: MART_PRODUCTS },
  mobile: {
    label: 'Mobile Shop',
    products: [
      { name: 'USB Charger 10W', category: 'Chargers', unit: 'pcs', cost: 350, price: 500, lowStock: 5, sku: '2001' },
      { name: 'Fast Charger 20W', category: 'Chargers', unit: 'pcs', cost: 900, price: 1200, lowStock: 5, sku: '2002' },
      { name: 'Type-C Cable', category: 'Cables', unit: 'pcs', cost: 200, price: 300, lowStock: 10, sku: '2003' },
      { name: 'Micro USB Cable', category: 'Cables', unit: 'pcs', cost: 150, price: 250, lowStock: 10, sku: '2004' },
      { name: 'Lightning Cable', category: 'Cables', unit: 'pcs', cost: 350, price: 500, lowStock: 6, sku: '2005' },
      { name: 'Wired Earphones', category: 'Audio', unit: 'pcs', cost: 250, price: 400, lowStock: 8, sku: '2006' },
      { name: 'Bluetooth Earbuds', category: 'Audio', unit: 'pcs', cost: 1800, price: 2500, lowStock: 4, sku: '2007' },
      { name: 'Power Bank 10000mAh', category: 'Power', unit: 'pcs', cost: 2200, price: 3000, lowStock: 3, sku: '2008' },
      { name: 'Phone Cover', category: 'Accessories', unit: 'pcs', cost: 150, price: 300, lowStock: 12, sku: '2009' },
      { name: 'Screen Protector', category: 'Accessories', unit: 'pcs', cost: 80, price: 200, lowStock: 15, sku: '2010' },
      { name: 'Car Charger', category: 'Chargers', unit: 'pcs', cost: 400, price: 600, lowStock: 5, sku: '2011' },
      { name: 'SIM Ejector Tool', category: 'Accessories', unit: 'pcs', cost: 20, price: 50, lowStock: 20, sku: '2012' },
    ],
  },
  electronics: {
    label: 'Electronics',
    products: [
      { name: 'LED Bulb 12W', category: 'Lighting', unit: 'pcs', cost: 250, price: 350, lowStock: 10, sku: '3001' },
      { name: 'Extension Board', category: 'Electrical', unit: 'pcs', cost: 450, price: 650, lowStock: 6, sku: '3002' },
      { name: 'Electric Kettle', category: 'Appliances', unit: 'pcs', cost: 1800, price: 2400, lowStock: 3, sku: '3003' },
      { name: 'Iron Press', category: 'Appliances', unit: 'pcs', cost: 2200, price: 2900, lowStock: 2, sku: '3004' },
      { name: 'Table Fan', category: 'Appliances', unit: 'pcs', cost: 3500, price: 4500, lowStock: 2, sku: '3005' },
      { name: 'TV Remote', category: 'Accessories', unit: 'pcs', cost: 250, price: 400, lowStock: 8, sku: '3006' },
      { name: 'HDMI Cable', category: 'Cables', unit: 'pcs', cost: 350, price: 500, lowStock: 6, sku: '3007' },
      { name: 'Wall Socket', category: 'Electrical', unit: 'pcs', cost: 120, price: 200, lowStock: 15, sku: '3008' },
      { name: 'AA Battery Pack', category: 'Batteries', unit: 'pack', cost: 80, price: 120, lowStock: 20, sku: '3009' },
      { name: 'Rechargeable Torch', category: 'Lighting', unit: 'pcs', cost: 400, price: 600, lowStock: 5, sku: '3010' },
      { name: 'Voltage Stabilizer', category: 'Electrical', unit: 'pcs', cost: 2500, price: 3200, lowStock: 2, sku: '3011' },
      { name: 'Soldering Iron', category: 'Tools', unit: 'pcs', cost: 500, price: 750, lowStock: 4, sku: '3012' },
    ],
  },
  medical: {
    label: 'Medical Store / Pharmacy',
    products: [
      { name: 'Panadol 500mg (Strip)', category: 'Pain Relief', unit: 'strip', cost: 25, price: 35, lowStock: 20, sku: '4001' },
      { name: 'Disprin (Strip)', category: 'Pain Relief', unit: 'strip', cost: 20, price: 30, lowStock: 20, sku: '4002' },
      { name: 'ORS Sachet', category: 'Hydration', unit: 'sachet', cost: 30, price: 45, lowStock: 25, sku: '4003' },
      { name: 'Bandage Roll', category: 'First Aid', unit: 'roll', cost: 60, price: 90, lowStock: 15, sku: '4004' },
      { name: 'Surgical Mask (Pack)', category: 'Protection', unit: 'pack', cost: 50, price: 80, lowStock: 20, sku: '4005' },
      { name: 'Hand Sanitizer 100ml', category: 'Hygiene', unit: 'bottle', cost: 150, price: 220, lowStock: 10, sku: '4006' },
      { name: 'Cough Syrup 100ml', category: 'Medicine', unit: 'bottle', cost: 120, price: 170, lowStock: 8, sku: '4007' },
      { name: 'Antiseptic Liquid 100ml', category: 'First Aid', unit: 'bottle', cost: 180, price: 250, lowStock: 8, sku: '4008' },
      { name: 'Digital Thermometer', category: 'Devices', unit: 'pcs', cost: 350, price: 500, lowStock: 4, sku: '4009' },
      { name: 'Glucose D 200g', category: 'Energy', unit: 'pack', cost: 80, price: 120, lowStock: 10, sku: '4010' },
      { name: 'Cotton Roll', category: 'First Aid', unit: 'roll', cost: 60, price: 90, lowStock: 12, sku: '4011' },
      { name: 'Pain Relief Spray', category: 'Pain Relief', unit: 'pcs', cost: 350, price: 480, lowStock: 6, sku: '4012' },
    ],
  },
  clothing: {
    label: 'Clothing / Garments',
    products: [
      { name: 'Mens T-Shirt', category: 'Men', unit: 'pcs', cost: 600, price: 900, lowStock: 6, sku: '5001' },
      { name: 'Mens Shirt', category: 'Men', unit: 'pcs', cost: 1200, price: 1700, lowStock: 5, sku: '5002' },
      { name: 'Mens Jeans', category: 'Men', unit: 'pcs', cost: 1800, price: 2500, lowStock: 4, sku: '5003' },
      { name: 'Womens Kurti', category: 'Women', unit: 'pcs', cost: 1500, price: 2200, lowStock: 5, sku: '5004' },
      { name: 'Womens Dupatta', category: 'Women', unit: 'pcs', cost: 500, price: 800, lowStock: 8, sku: '5005' },
      { name: 'Kids T-Shirt', category: 'Kids', unit: 'pcs', cost: 400, price: 650, lowStock: 8, sku: '5006' },
      { name: 'Socks Pair', category: 'Accessories', unit: 'pair', cost: 100, price: 180, lowStock: 15, sku: '5007' },
      { name: 'Handkerchief', category: 'Accessories', unit: 'pcs', cost: 60, price: 100, lowStock: 20, sku: '5008' },
      { name: 'Leather Belt', category: 'Accessories', unit: 'pcs', cost: 350, price: 550, lowStock: 8, sku: '5009' },
      { name: 'Cap', category: 'Accessories', unit: 'pcs', cost: 250, price: 400, lowStock: 8, sku: '5010' },
      { name: 'Scarf', category: 'Women', unit: 'pcs', cost: 400, price: 650, lowStock: 8, sku: '5011' },
      { name: 'Mens Trouser', category: 'Men', unit: 'pcs', cost: 1400, price: 2000, lowStock: 4, sku: '5012' },
    ],
  },
  cosmetics: {
    label: 'Cosmetics / Beauty',
    products: [
      { name: 'Face Wash 100ml', category: 'Skincare', unit: 'pcs', cost: 250, price: 350, lowStock: 8, sku: '6001' },
      { name: 'Fairness Cream', category: 'Skincare', unit: 'pcs', cost: 300, price: 450, lowStock: 8, sku: '6002' },
      { name: 'Lipstick', category: 'Makeup', unit: 'pcs', cost: 350, price: 500, lowStock: 10, sku: '6003' },
      { name: 'Nail Polish', category: 'Makeup', unit: 'pcs', cost: 150, price: 250, lowStock: 12, sku: '6004' },
      { name: 'Shampoo 200ml', category: 'Haircare', unit: 'bottle', cost: 350, price: 480, lowStock: 8, sku: '6005' },
      { name: 'Conditioner 200ml', category: 'Haircare', unit: 'bottle', cost: 400, price: 550, lowStock: 6, sku: '6006' },
      { name: 'Body Lotion 200ml', category: 'Skincare', unit: 'bottle', cost: 450, price: 600, lowStock: 6, sku: '6007' },
      { name: 'Perfume Spray 50ml', category: 'Fragrance', unit: 'pcs', cost: 600, price: 900, lowStock: 5, sku: '6008' },
      { name: 'Talcum Powder', category: 'Skincare', unit: 'pcs', cost: 250, price: 350, lowStock: 10, sku: '6009' },
      { name: 'Hair Oil 100ml', category: 'Haircare', unit: 'bottle', cost: 200, price: 300, lowStock: 10, sku: '6010' },
      { name: 'Makeup Kit', category: 'Makeup', unit: 'set', cost: 800, price: 1200, lowStock: 3, sku: '6011' },
      { name: 'Sunblock 50ml', category: 'Skincare', unit: 'pcs', cost: 500, price: 700, lowStock: 5, sku: '6012' },
    ],
  },
  stationery: {
    label: 'Stationery',
    products: [
      { name: 'Ball Pen', category: 'Writing', unit: 'pcs', cost: 20, price: 30, lowStock: 30, sku: '7001' },
      { name: 'Notebook 100 Pages', category: 'Paper', unit: 'pcs', cost: 80, price: 120, lowStock: 20, sku: '7002' },
      { name: 'Pencil', category: 'Writing', unit: 'pcs', cost: 15, price: 25, lowStock: 30, sku: '7003' },
      { name: 'Eraser', category: 'Writing', unit: 'pcs', cost: 10, price: 20, lowStock: 30, sku: '7004' },
      { name: 'Sharpener', category: 'Writing', unit: 'pcs', cost: 10, price: 20, lowStock: 30, sku: '7005' },
      { name: 'Geometry Box', category: 'School', unit: 'set', cost: 250, price: 350, lowStock: 6, sku: '7006' },
      { name: 'Marker', category: 'Writing', unit: 'pcs', cost: 60, price: 90, lowStock: 15, sku: '7007' },
      { name: 'Glue Stick', category: 'Office', unit: 'pcs', cost: 40, price: 60, lowStock: 15, sku: '7008' },
      { name: 'Scissors', category: 'Office', unit: 'pcs', cost: 80, price: 120, lowStock: 10, sku: '7009' },
      { name: 'File Folder', category: 'Office', unit: 'pcs', cost: 60, price: 100, lowStock: 15, sku: '7010' },
      { name: 'Stapler', category: 'Office', unit: 'pcs', cost: 250, price: 350, lowStock: 5, sku: '7011' },
      { name: 'A4 Paper Ream', category: 'Paper', unit: 'ream', cost: 900, price: 1100, lowStock: 5, sku: '7012' },
    ],
  },
  hardware: {
    label: 'Hardware',
    products: [
      { name: 'Claw Hammer', category: 'Tools', unit: 'pcs', cost: 350, price: 500, lowStock: 5, sku: '8001' },
      { name: 'Screwdriver Set', category: 'Tools', unit: 'set', cost: 450, price: 650, lowStock: 5, sku: '8002' },
      { name: 'Measuring Tape 5m', category: 'Tools', unit: 'pcs', cost: 200, price: 300, lowStock: 8, sku: '8003' },
      { name: 'Paint Brush 3in', category: 'Paint', unit: 'pcs', cost: 120, price: 180, lowStock: 10, sku: '8004' },
      { name: 'Wall Paint 1L', category: 'Paint', unit: 'tin', cost: 900, price: 1200, lowStock: 6, sku: '8005' },
      { name: 'Door Lock', category: 'Hardware', unit: 'pcs', cost: 600, price: 850, lowStock: 6, sku: '8006' },
      { name: 'Hinges Pair', category: 'Hardware', unit: 'pair', cost: 150, price: 220, lowStock: 12, sku: '8007' },
      { name: 'Nails Pack', category: 'Hardware', unit: 'pack', cost: 80, price: 120, lowStock: 15, sku: '8008' },
      { name: 'Electric Wire Roll', category: 'Electrical', unit: 'roll', cost: 500, price: 700, lowStock: 6, sku: '8009' },
      { name: 'Switch Board', category: 'Electrical', unit: 'pcs', cost: 250, price: 380, lowStock: 8, sku: '8010' },
      { name: 'PVC Pipe 6ft', category: 'Plumbing', unit: 'pcs', cost: 300, price: 450, lowStock: 8, sku: '8011' },
      { name: 'Tool Box', category: 'Tools', unit: 'pcs', cost: 800, price: 1100, lowStock: 3, sku: '8012' },
    ],
  },
  bakery: {
    label: 'Bakery / Food',
    products: [
      { name: 'Bread Large', category: 'Bread', unit: 'pcs', cost: 130, price: 160, lowStock: 10, sku: '9001' },
      { name: 'Bun Pack', category: 'Bread', unit: 'pack', cost: 80, price: 120, lowStock: 12, sku: '9002' },
      { name: 'Cake Slice', category: 'Cakes', unit: 'pcs', cost: 120, price: 180, lowStock: 8, sku: '9003' },
      { name: 'Cookies Pack', category: 'Biscuits', unit: 'pack', cost: 100, price: 150, lowStock: 10, sku: '9004' },
      { name: 'Rusk Pack', category: 'Biscuits', unit: 'pack', cost: 120, price: 170, lowStock: 10, sku: '9005' },
      { name: 'Croissant', category: 'Pastry', unit: 'pcs', cost: 150, price: 220, lowStock: 6, sku: '9006' },
      { name: 'Pizza Base', category: 'Bread', unit: 'pcs', cost: 180, price: 250, lowStock: 5, sku: '9007' },
      { name: 'Cream Roll', category: 'Pastry', unit: 'pcs', cost: 60, price: 90, lowStock: 12, sku: '9008' },
      { name: 'Patties', category: 'Snacks', unit: 'pcs', cost: 100, price: 150, lowStock: 10, sku: '9009' },
      { name: 'Doughnut', category: 'Pastry', unit: 'pcs', cost: 80, price: 120, lowStock: 12, sku: '9010' },
      { name: 'Birthday Cake 1lb', category: 'Cakes', unit: 'pcs', cost: 900, price: 1200, lowStock: 3, sku: '9011' },
      { name: 'Sandwich Bread', category: 'Bread', unit: 'pcs', cost: 150, price: 200, lowStock: 8, sku: '9012' },
    ],
  },
  general: { label: 'General Store', products: MART_PRODUCTS },
  other: { label: 'Other', products: [] },
};

const DEFAULT_SHOP_TYPE = 'mart';
const DEFAULT_PLAN = 'trial';
const TRIAL_DAYS = 14;
const PLAN_DAYS = {
  trial: 14,
  monthly: 30,
  quarterly: 90,
  annual: 365,
  lifetime: null,
};
const PLAN_LABELS = {
  trial: 'Trial',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  lifetime: 'Lifetime',
};

function shopTypeInfo(type) {
  return SHOP_TYPES[type] || SHOP_TYPES[DEFAULT_SHOP_TYPE];
}

function planInfo(plan) {
  const key = Object.prototype.hasOwnProperty.call(PLAN_DAYS, plan) ? plan : DEFAULT_PLAN;
  return { key, label: PLAN_LABELS[key], days: PLAN_DAYS[key] };
}

function addDays(base, days) {
  return new Date(base.getTime() + days * 86400000).toISOString();
}

function daysLeft(end) {
  if (!end) return null;
  const ms = new Date(end).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function billingAccess(shop) {
  if (shop.status !== 'active') {
    return {
      ok: false,
      code: 'pending',
      message: 'Aap ka account abhi approve nahi hua. Owner ke email par approval request bheji gayi hai.',
    };
  }
  if (shop.billing_status === 'blocked') {
    return {
      ok: false,
      code: 'blocked',
      message: 'Aap ka account temporarily band hai — mhzaly owner se rabta karein.',
    };
  }
  const plan = shop.plan || DEFAULT_PLAN;
  if (plan === 'lifetime') return { ok: true };
  if (!shop.subscription_end) return { ok: true };
  if (new Date(shop.subscription_end).getTime() < Date.now()) {
    return {
      ok: false,
      code: 'expired',
      message: 'Aap ka trial ya subscription khatam ho gaya hai — owner se renew karwayein.',
    };
  }
  return { ok: true };
}

/* ---------- Helpers ---------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed =
    origin === 'https://mhzaly.pages.dev' ||
    /^https:\/\/[a-z0-9-]+\.mhzaly\.pages\.dev$/.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/.test(origin);
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    ...SECURE_HEADERS,
  };
  if (allowed) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURE_HEADERS,
      ...extra,
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURE_HEADERS,
    },
  });
}

function getClientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

async function readJson(request, maxBytes = 20000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request is too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function b64urlEncode(input) {
  // Accepts either a UTF-8 string or raw bytes (token payloads are strings,
  // password salts are Uint8Array).
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input) {
  const s = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
}

function randomCodeSuffix() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  for (let i = 0; i < 3; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.startsWith('92') && digits.length === 12) digits = `0${digits.slice(2)}`;
  return digits;
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/* ---------- Helpers for scalable delivery ---------- */

async function makeEtag(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  const b64 = btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `"${b64.slice(0, 32)}"`;
}

/* ---------- Security: Rate limiting ---------- */

/* In-isolate burst absorber: keeps a hot IP from hammering D1 on
   every single request. D1 stays the source of truth, but it is only
   written every RATE_LIMIT_PERSIST_EVERY hits instead of on each one.
   Keeps the API healthy when thousands of users hit it at once. */
const RATE_LIMIT_PERSIST_EVERY = 5;
const MEM_RATE_LIMIT = new Map();
const MEM_RATE_LIMIT_MAX = 5000;

async function persistRateLimit(env, ip, endpoint, count, windowStart) {
  await env.DB.prepare(
    `INSERT INTO rate_limits (ip, endpoint, count, window_start)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip, endpoint) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`
  )
    .bind(ip, endpoint, count, windowStart)
    .run()
    .catch(() => {});
}

async function checkRateLimit(env, ip, endpoint) {
  const now = Date.now();
  const windowMs = now - (now % RATE_LIMIT_WINDOW_MS);
  const windowStart = new Date(windowMs).toISOString();
  const key = `${ip}|${endpoint}`;

  const mem = MEM_RATE_LIMIT.get(key);
  if (mem && mem.windowMs === windowMs) {
    mem.count += 1;
    if (mem.count > RATE_LIMIT_MAX_REQUESTS) return { ok: false, remaining: 0 };
    if (mem.count % RATE_LIMIT_PERSIST_EVERY === 0) {
      await persistRateLimit(env, ip, endpoint, mem.count, windowStart);
    }
    return { ok: true, remaining: RATE_LIMIT_MAX_REQUESTS - mem.count };
  }

  if (MEM_RATE_LIMIT.size > MEM_RATE_LIMIT_MAX) MEM_RATE_LIMIT.clear();
  MEM_RATE_LIMIT.set(key, { count: 1, windowMs });

  const row = await env.DB.prepare(
    'SELECT count, window_start FROM rate_limits WHERE ip = ? AND endpoint = ?'
  )
    .bind(ip, endpoint)
    .first();

  const persisted = row && row.window_start === windowStart ? Number(row.count) : 0;
  const count = persisted + 1;
  if (count > RATE_LIMIT_MAX_REQUESTS) return { ok: false, remaining: 0 };

  await persistRateLimit(env, ip, endpoint, count, windowStart);
  return { ok: true, remaining: RATE_LIMIT_MAX_REQUESTS - count };
}

/* ---------- Security: Login attempts / lockout ---------- */

async function recordLoginAttempt(env, ip, endpoint, success) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    'SELECT attempts, locked_until FROM login_attempts WHERE ip = ? AND endpoint = ?'
  )
    .bind(ip, endpoint)
    .first();

  if (success) {
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, endpoint, attempts, locked_until, updated_at)
       VALUES (?, ?, 0, NULL, ?)
       ON CONFLICT(ip, endpoint) DO UPDATE SET attempts = 0, locked_until = NULL, updated_at = ?`
    )
      .bind(ip, endpoint, now, now)
      .run();
    return;
  }

  let attempts = row ? Number(row.attempts) + 1 : 1;
  let lockedUntil = null;
  if (attempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
    lockedUntil = addDays(new Date(), LOGIN_LOCKOUT_MINUTES / (24 * 60)); // approx
  }

  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, endpoint, attempts, locked_until, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ip, endpoint) DO UPDATE SET attempts = ?, locked_until = ?, updated_at = ?`
  )
    .bind(ip, endpoint, attempts, lockedUntil, now, attempts, lockedUntil, now)
    .run();
}

async function isLockedOut(env, ip, endpoint) {
  const row = await env.DB.prepare(
    'SELECT attempts, locked_until FROM login_attempts WHERE ip = ? AND endpoint = ?'
  )
    .bind(ip, endpoint)
    .first();
  if (!row) return false;
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return true;
  return false;
}

/* ---------- Password ---------- */

function validatePasswordStrength(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password kam az kam ${PASSWORD_MIN_LENGTH} characters ka hona chahiye` };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, message: 'Password mein kam az kam 1 bade harf (uppercase) ka hona zaroori hai' };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, message: 'Password mein kam az kam 1 chhota harf (lowercase) ka hona zaroori hai' };
  }
  if (!/\d/.test(password)) {
    return { ok: false, message: 'Password mein kam az kam 1 number ka hona zaroori hai' };
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { ok: false, message: 'Password mein kam az kam 1 special character (!@#$%) ka hona zaroori hai' };
  }
  return { ok: true, message: 'Password strong hai' };
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, iter, salt, hash] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const bits = await pbkdf2(password, b64urlDecode(salt), Number(iter));
    return safeEqual(b64urlEncode(bits), hash);
  } catch {
    return false;
  }
}

/* ---------- Session tokens ---------- */

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

async function signToken(payload, secret) {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

async function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = await hmac(secret, body);
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Please log in');
  const payload = await verifyToken(token, env.AUTH_SECRET);
  if (!payload) throw new HttpError(401, 'Session expired — please log in again');
  return payload;
}

async function requireOwner(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.role !== 'owner' || !auth.aid) {
    throw new HttpError(403, 'Owner access required');
  }
  return auth;
}

/* ---------- Audit log ---------- */

async function logAudit(env, { actorType, actorId, action, targetType, targetId, details, ip }) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, details, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(randomId('audit'), actorType, actorId, action, targetType, targetId, details, ip, new Date().toISOString())
      .run();
  } catch {
    // audit logging should never break the main flow
  }
}

/* ---------- Shop data ---------- */

function defaultData(shopName, ownerName, email, phone, shopType = DEFAULT_SHOP_TYPE) {
  const now = new Date().toISOString();
  const type = SHOP_TYPES[shopType] ? shopType : DEFAULT_SHOP_TYPE;
  return {
    version: 1,
    settings: {
      shopName,
      ownerName: ownerName || '',
      phone: phone || '',
      address: '',
      currency: 'Rs',
      taxRate: 0,
      lowStock: 5,
      receiptNote: 'Thank you for shopping with us!',
      email: email || '',
      shopType: type,
    },
    products: shopTypeInfo(type).products.map((item, i) => ({
      id: `seed_${i + 1}`,
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
    })),
    customers: [],
    suppliers: [],
    sales: [],
    purchases: [],
    payments: [],
    expenses: [],
    counters: { invoice: 1, purchase: 1 },
    createdAt: now,
  };
}

async function loadShop(env, shopId) {
  return env.DB.prepare(
    `SELECT id, name, code, email, phone, shop_type, status, plan, billing_status,
            subscription_start, subscription_end, blocked_at, block_reason,
            last_payment_at, last_payment_amount, created_at
     FROM shops WHERE id = ?`
  )
    .bind(shopId)
    .first();
}

function shopPayload(row) {
  const type = row.shop_type || DEFAULT_SHOP_TYPE;
  const plan = row.plan || DEFAULT_PLAN;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone || '',
    shopType: type,
    shopTypeLabel: shopTypeInfo(type).label,
    plan,
    planLabel: PLAN_LABELS[plan] || plan,
    billingStatus: row.billing_status || (plan === 'trial' ? 'trial' : 'active'),
    subscriptionStart: row.subscription_start || null,
    subscriptionEnd: row.subscription_end || null,
    daysLeft: daysLeft(row.subscription_end),
  };
}

function ownerShopRow(row) {
  const type = row.shop_type || DEFAULT_SHOP_TYPE;
  const plan = row.plan || DEFAULT_PLAN;
  const end = row.subscription_end || null;
  let billingStatus = row.billing_status || (plan === 'trial' ? 'trial' : 'active');
  if (
    row.status === 'active' &&
    billingStatus !== 'blocked' &&
    end &&
    new Date(end).getTime() < Date.now()
  ) {
    billingStatus = 'expired';
  }
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone || '',
    shopType: type,
    shopTypeLabel: shopTypeInfo(type).label,
    status: row.status,
    plan,
    planLabel: PLAN_LABELS[plan] || plan,
    billingStatus,
    subscriptionStart: row.subscription_start || null,
    subscriptionEnd: end,
    daysLeft: daysLeft(end),
    blockedAt: row.blocked_at || null,
    blockReason: row.block_reason || '',
    lastPaymentAt: row.last_payment_at || null,
    lastPaymentAmount: row.last_payment_amount ?? null,
    createdAt: row.created_at,
  };
}

/* ---------- Email ---------- */

async function sendOwnerEmail(env, { subject, text, htmlBody }) {
  const owner = env.OWNER_EMAIL || OWNER_EMAIL_DEFAULT;
  const errors = [];

  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM || 'mhzaly <onboarding@resend.dev>',
          to: [owner],
          subject,
          text,
          html: htmlBody,
        }),
      });
      if (res.ok) return { ok: true, provider: 'resend' };
      errors.push(`resend: ${res.status}`);
    } catch (err) {
      errors.push(`resend: ${err.message}`);
    }
  }

  // FlowForm fallback — free no-signup email relay
  try {
    const flowUrl = `https://flowform.to/${encodeURIComponent(owner)}`;
    const res = await fetch(flowUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: owner,
        subject,
        text,
        html: htmlBody,
      }),
    });
    if (res.ok) return { ok: true, provider: 'flowform' };
    errors.push(`flowform: ${res.status}`);
  } catch (err) {
    errors.push(`flowform: ${err.message}`);
  }

  return { ok: false, errors };
}

function emailLayout(title, intro, rows, buttons, footer) {
  const esc = escHtml;
  const buttonHtml = buttons
    ? buttons
        .map(
          (b) =>
            `<a href="${esc(b.href)}" style="display:inline-block;margin:4px 6px;padding:10px 18px;border-radius:8px;background:${esc(b.bg)};color:#fff;text-decoration:none;font-weight:700">${esc(b.label)}</a>`
        )
        .join('')
    : '';
  const rowsHtml = rows
    ? rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:700">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${esc(v)}</td></tr>`
        )
        .join('')
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · mhzaly</title></head>
  <body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px">
    <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#0f766e;color:#fff;padding:20px 24px">
        <div style="font-size:18px;font-weight:800">mhzaly</div>
        <div style="font-size:12px;opacity:.9;margin-top:2px">${esc(title)}</div>
      </div>
      <div style="padding:20px 24px">
        <p style="margin:0 0 14px;font-size:14px;color:#1e293b">${esc(intro)}</p>
        ${rowsHtml ? `<table style="width:100%;border-collapse:collapse">${rowsHtml}</table>` : ''}
        ${buttonHtml ? `<div style="margin-top:20px">${buttonHtml}</div>` : ''}
        ${footer ? `<p style="margin-top:20px;font-size:12px;color:#64748b">${esc(footer)}</p>` : ''}
      </div>
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 24px;font-size:11px;color:#94a3b8">
        mhzaly · Shop manager · ${esc(new Date().toISOString())}
      </div>
    </div>
  </body></html>`;
}

/* ---------- Routes: auth ---------- */

async function handleRegister(request, env) {
  const ip = getClientIp(request);
  const endpoint = '/api/register';

  const rate = await checkRateLimit(env, ip, endpoint);
  if (!rate.ok) {
    throw new HttpError(429, 'Zyada requests aayi hain — thode der baad dobara koshish karein');
  }

  const locked = await isLockedOut(env, ip, endpoint);
  if (locked) {
    throw new HttpError(423, 'Zyada galti ki wajah se account temporarily block hai — thode baad koshish karein');
  }

  const body = await readJson(request);
  const shopName = String(body.shopName || '').trim();
  const ownerName = String(body.ownerName || '').trim();
  const phone = normalizePhone(body.phone);
  const password = String(body.password || '');
  const givenEmail = String(body.email || '').trim().toLowerCase();
  const shopType = String(body.shopType || DEFAULT_SHOP_TYPE).trim().toLowerCase();

  // Password strength check
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(400, strength.message);
  }

  if (shopName.length < 2 || shopName.length > 60) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(400, 'Shop ka naam 2–60 characters ka hona chahiye');
  }
  if (phone.length < 7 || phone.length > 15) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(400, 'Sahi phone number likhein (misal: 03001234567)');
  }
  if (givenEmail && !isEmail(givenEmail)) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(400, 'Sahi email address likhein');
  }
  if (!SHOP_TYPES[shopType]) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(400, 'Shop category sahi nahi hai');
  }

  let code = slugify(shopName).slice(0, 24) || 'shop';
  const phoneRow = await env.DB.prepare(
    'SELECT id, status, confirm_expires FROM shops WHERE phone = ?'
  )
    .bind(phone)
    .first();
  if (phoneRow) {
    const expired =
      phoneRow.status === 'pending' &&
      phoneRow.confirm_expires &&
      new Date(phoneRow.confirm_expires).getTime() < Date.now();
    if (expired) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM shop_data WHERE shop_id = ?').bind(phoneRow.id),
        env.DB.prepare('DELETE FROM users WHERE shop_id = ?').bind(phoneRow.id),
        env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(phoneRow.id),
        env.DB.prepare('DELETE FROM subscription_payments WHERE shop_id = ?').bind(phoneRow.id),
      ]);
    } else if (phoneRow.status === 'pending') {
      await recordLoginAttempt(env, ip, endpoint, false);
      throw new HttpError(
        409,
        'Is number ki request pehle se approval ke intezaar mein hai.'
      );
    } else {
      await recordLoginAttempt(env, ip, endpoint, false);
      throw new HttpError(409, 'Is phone number se pehle hi shop bani hui hai');
    }
  }

  if (givenEmail) {
    const emailTaken = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(givenEmail).first();
    if (emailTaken) {
      await recordLoginAttempt(env, ip, endpoint, false);
      throw new HttpError(409, 'Ye email pehle se register hai');
    }
  }

  const codeRow = await env.DB.prepare('SELECT id FROM shops WHERE code = ?').bind(code).first();
  if (codeRow) {
    code = `${code.slice(0, 25)}-${randomCodeSuffix()}`;
  }

  const email = givenEmail || `${code}@phone.mhzaly`;
  const shopId = randomId('shop');
  const userId = randomId('user');
  const now = new Date().toISOString();
  const token = randomToken();
  const expires = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();
  const passwordHash = await hashPassword(password);
  const data = defaultData(shopName, ownerName, email, phone, shopType);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO shops (id, name, code, email, phone, shop_type, plan, billing_status,
                          subscription_start, subscription_end, status, confirm_token, confirm_expires, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'trial', 'trial', NULL, NULL, 'pending', ?, ?, ?)`
    ).bind(shopId, shopName, code, email, phone, shopType, token, expires, now),
    env.DB.prepare(
      'INSERT INTO users (id, shop_id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, shopId, email, ownerName, 'owner', passwordHash, now),
    env.DB.prepare('INSERT INTO shop_data (shop_id, data, updated_at) VALUES (?, ?, ?)')
      .bind(shopId, JSON.stringify(data), now),
  ]);

  await logAudit(env, {
    actorType: 'system', actorId: shopId, action: 'register',
    targetType: 'shop', targetId: shopId,
    details: JSON.stringify({ shopName, phone, shopType, email }),
    ip,
  });

  const origin = new URL(request.url).origin;
  const approveUrl = `${origin}/api/confirm?token=${token}&action=approve`;
  const rejectUrl = `${origin}/api/confirm?token=${token}&action=reject`;
  const subject = `mhzaly: Naya shop approval — ${shopName}`;
  const text = [
    'Naya shop registration request aayi hai.',
    '',
    `Shop: ${shopName}`,
    `Category: ${shopTypeInfo(shopType).label}`,
    `Phone: ${phone}`,
    `Code: ${code}`,
    `Time: ${now}`,
    '',
    `Approve: ${approveUrl}`,
    `Reject: ${rejectUrl}`,
  ].join('\n');
  const htmlBody = emailLayout(
    'Naya shop approve karein',
    'Neeche diye gaye shop ne mhzaly par account banane ki request bheji hai.',
    [
      ['Shop name', shopName],
      ['Category', shopTypeInfo(shopType).label],
      ['Phone number', phone],
      ['Shop code', code],
      ['Request time', now],
    ],
    [
      { href: approveUrl, label: '✅ Approve shop', bg: '#0f766e' },
      { href: rejectUrl, label: 'Reject', bg: '#dc2626' },
    ],
    'Agar aap ne ye request nahi maangi, to Reject dabayen. Ye link 7 din tak kaam karega.'
  );

  const mail = await sendOwnerEmail(env, { subject, text, htmlBody });

  await recordLoginAttempt(env, ip, endpoint, true);

  return json({
    pending: true,
    emailSent: mail.ok,
    shop: {
      id: shopId,
      name: shopName,
      code,
      phone,
      shopType,
      shopTypeLabel: shopTypeInfo(shopType).label,
    },
    message: 'Aap ki request bhej di gayi hai. Approval ke baad login kar sakte hain.',
  });
}

function confirmPage({ title, body, color = '#0f766e' }) {
  const esc = escHtml;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · mhzaly</title></head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:20px">
    <div style="max-width:460px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center">
      <div style="width:52px;height:52px;border-radius:14px;background:${color};margin:0 auto 16px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px">✓</div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">${esc(title)}</h1>
      <div style="font-size:13.5px;line-height:1.65;color:#475569">${body}</div>
      <div style="margin-top:20px"><a href="${PUBLIC_APP_URL}" style="display:inline-block;padding:11px 22px;border-radius:9px;background:#0f766e;color:#fff;text-decoration:none;font-size:13px;font-weight:700">Open mhzaly</a></div>
      <div style="margin-top:16px;font-size:11px;color:#94a3b8">mhzaly · Mart &amp; shop manager</div>
    </div>
  </body></html>`;
}

async function handleConfirm(request, env) {
  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '').trim();
  const action = String(url.searchParams.get('action') || 'approve').trim().toLowerCase();
  if (!token) {
    return html(confirmPage({ title: 'Invalid link', body: 'Ye confirmation link sahi nahi hai.', color: '#dc2626' }), 400);
  }

  const shop = await env.DB.prepare(
    'SELECT id, name, code, phone, shop_type, status, confirm_token, confirm_expires FROM shops WHERE confirm_token = ?'
  )
    .bind(token)
    .first();

  if (!shop) {
    return html(
      confirmPage({
        title: 'Link not found',
        body: 'Ye link pehle hi use ho chuka hai ya expire ho gaya hai.',
        color: '#dc2626',
      }),
      404
    );
  }

  if (shop.status !== 'pending') {
    return html(
      confirmPage({
        title: 'Already handled',
        body: `Shop <b>${escHtml(shop.name)}</b> pehle hi ${shop.status} ho chuki hai.`,
      })
    );
  }

  if (shop.confirm_expires && new Date(shop.confirm_expires).getTime() < Date.now()) {
    return html(
      confirmPage({
        title: 'Link expired',
        body: 'Ye approval link 7 din ke baad expire ho gaya hai. Naya account banane ke liye dobara request bhejein.',
        color: '#dc2626',
      }),
      410
    );
  }

  const ip = getClientIp(request);

  if (action === 'reject') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM subscription_payments WHERE shop_id = ?').bind(shop.id),
      env.DB.prepare('DELETE FROM shop_data WHERE shop_id = ?').bind(shop.id),
      env.DB.prepare('DELETE FROM users WHERE shop_id = ?').bind(shop.id),
      env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(shop.id),
    ]);
    await logAudit(env, {
      actorType: 'owner', actorId: 'confirm-link', action: 'reject',
      targetType: 'shop', targetId: shop.id,
      details: JSON.stringify({ shopName: shop.name }),
      ip,
    });
    return html(
      confirmPage({
        title: 'Request rejected',
        body: `Shop <b>${escHtml(shop.name)}</b> ki request reject kar di gayi hai.`,
        color: '#dc2626',
      })
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const trialEnd = addDays(now, TRIAL_DAYS);
  await env.DB.prepare(
    `UPDATE shops SET status = 'active', confirm_token = NULL, confirm_expires = NULL, approved_at = ?,
       plan = COALESCE(plan, 'trial'),
       billing_status = COALESCE(billing_status, 'trial'),
       subscription_start = COALESCE(subscription_start, ?),
       subscription_end = COALESCE(subscription_end, ?)
     WHERE id = ?`
  )
    .bind(nowIso, nowIso, trialEnd, shop.id)
    .run();

  await logAudit(env, {
    actorType: 'owner', actorId: 'confirm-link', action: 'approve',
    targetType: 'shop', targetId: shop.id,
    details: JSON.stringify({ shopName: shop.name, plan: 'trial' }),
    ip,
  });

  const loginUrl = `${PUBLIC_APP_URL}?shop=${encodeURIComponent(shop.code)}`;
  return html(
    confirmPage({
      title: 'Shop approved! ✅',
      body: `Shop <b>${escHtml(shop.name)}</b> (${escHtml(shop.phone || '')}) ab approve ho chuki hai.<br><br>
      Category: <b>${escHtml(shopTypeInfo(shop.shop_type).label)}</b><br><br>
      Ab ye shop apne <b>phone number</b> aur password se login kar sakti hai.<br><br>
      <a href="${escHtml(loginUrl)}" style="color:#0f766e;font-weight:700">${escHtml(loginUrl)}</a>`,
    })
  );
}

async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const key = String(url.searchParams.get('key') || '').trim();
  if (!env.ADMIN_KEY || !safeEqual(key, env.ADMIN_KEY)) {
    return html(confirmPage({ title: 'Not allowed', body: 'Admin key sahi nahi hai.', color: '#dc2626' }), 401);
  }

  const rows = await env.DB.prepare(
    'SELECT id, name, code, phone, shop_type, created_at, confirm_token, confirm_expires FROM shops WHERE status = ? ORDER BY created_at DESC'
  )
    .bind('pending')
    .all();

  const pending = rows.results || [];
  const list = pending.length
    ? pending
        .map((s) => {
          const approve = `/api/confirm?token=${encodeURIComponent(s.confirm_token || '')}&action=approve`;
          const reject = `/api/confirm?token=${encodeURIComponent(s.confirm_token || '')}&action=reject`;
          return `<tr>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0"><b>${escHtml(s.name)}</b><br><span style="font-size:11px;color:#64748b">${escHtml(s.code)} · ${escHtml(shopTypeInfo(s.shop_type).label)}</span></td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escHtml(s.phone || '—')}</td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right">
              <a href="${approve}" style="padding:6px 10px;border-radius:6px;background:#0f766e;color:#fff;text-decoration:none;font-size:12px;font-weight:700">Approve</a>
              <a href="${reject}" style="padding:6px 10px;border-radius:6px;background:#dc2626;color:#fff;text-decoration:none;font-size:12px;font-weight:700;margin-left:4px">Reject</a>
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="3" style="padding:18px;text-align:center;color:#64748b">Koi pending request nahi hai.</td></tr>';

  return html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Pending shops · mhzaly</title></head>
    <body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:22px">
      <div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
        <div style="background:#0f766e;color:#fff;padding:18px 20px">
          <div style="font-size:19px;font-weight:800">mhzaly</div>
          <div style="font-size:12px;opacity:.85">Pending shop approvals</div>
        </div>
        <div style="padding:18px 20px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">${list}</table>
        </div>
      </div>
    </body></html>`);
}

/* ---------- Routes: owner panel ---------- */

async function handleOwnerLogin(request, env) {
  const ip = getClientIp(request);
  const endpoint = '/api/owner/login';
  const rate = await checkRateLimit(env, ip, endpoint);
  if (!rate.ok) throw new HttpError(429, 'Zyada requests — thode baad koshish karein');

  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) throw new HttpError(400, 'Email aur password likhein');

  const locked = await isLockedOut(env, ip, endpoint);
  if (locked) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(423, 'Zyada failed attempts — temporarily block hai');
  }

  const row = await env.DB.prepare(
    'SELECT id, email, name, password_hash FROM admins WHERE email = ?'
  )
    .bind(email)
    .first();
  if (!row) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(401, 'Owner account nahi mila');
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(401, 'Password galat hai');
  }

  await recordLoginAttempt(env, ip, endpoint, true);

  const token = await signToken(
    { aid: row.id, role: 'owner', exp: Math.floor(Date.now() / 1000) + TOKEN_TTL },
    env.AUTH_SECRET
  );
  await logAudit(env, {
    actorType: 'owner', actorId: row.id, action: 'login',
    targetType: 'admin', targetId: row.id,
    details: JSON.stringify({ email }),
    ip,
  });
  return json({
    token,
    owner: { id: row.id, email: row.email, name: row.name || 'Owner' },
  });
}

async function handleOwnerOverview(request, env) {
  await requireOwner(request, env);
  const now = new Date();
  const nowIso = now.toISOString();

  await env.DB.prepare(
    `UPDATE shops SET billing_status = 'expired'
     WHERE status = 'active' AND billing_status IN ('trial', 'active')
       AND subscription_end IS NOT NULL AND subscription_end < ?`
  )
    .bind(nowIso)
    .run()
    .catch(() => {});

  const rows = await env.DB.prepare(
    `SELECT id, name, code, email, phone, shop_type, status, plan, billing_status,
            subscription_start, subscription_end, blocked_at, block_reason,
            last_payment_at, last_payment_amount, created_at
     FROM shops ORDER BY created_at DESC`
  ).all();

  const shops = (rows.results || []).map(ownerShopRow);
  const stats = { total: shops.length, active: 0, trial: 0, expired: 0, blocked: 0, pending: 0 };
  for (const s of shops) {
    if (s.status === 'pending') stats.pending += 1;
    else if (s.billingStatus === 'blocked') stats.blocked += 1;
    else if (s.billingStatus === 'expired') stats.expired += 1;
    else if (s.plan === 'trial' || s.billingStatus === 'trial') stats.trial += 1;
    else stats.active += 1;
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const pay = await env.DB.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM subscription_payments WHERE created_at >= ?'
  )
    .bind(monthStart.toISOString())
    .first();
  stats.revenueThisMonth = Number(pay?.total || 0);

  return json({ stats, shops });
}

async function handleOwnerShopAction(request, env) {
  const auth = await requireOwner(request, env);
  const ip = getClientIp(request);
  const body = await readJson(request);
  const shopId = String(body.shopId || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!shopId) throw new HttpError(400, 'Shop ID required');
  if (!action) throw new HttpError(400, 'Action required');

  const shop = await env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(shopId).first();
  if (!shop) throw new HttpError(404, 'Shop not found');

  const now = new Date();
  const nowIso = now.toISOString();

  if (action === 'approve') {
    const trialEnd = addDays(now, TRIAL_DAYS);
    await env.DB.prepare(
      `UPDATE shops SET status = 'active', confirm_token = NULL, confirm_expires = NULL, approved_at = ?,
         plan = COALESCE(plan, 'trial'),
         billing_status = COALESCE(billing_status, 'trial'),
         subscription_start = COALESCE(subscription_start, ?),
         subscription_end = COALESCE(subscription_end, ?)
       WHERE id = ?`
    )
      .bind(nowIso, nowIso, trialEnd, shopId)
      .run();
    await logAudit(env, {
      actorType: 'owner', actorId: auth.aid, action: 'approve',
      targetType: 'shop', targetId: shopId,
      details: JSON.stringify({ shopName: shop.name }),
      ip,
    });
    return json({ ok: true });
  }

  if (action === 'reject') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM subscription_payments WHERE shop_id = ?').bind(shopId),
      env.DB.prepare('DELETE FROM shop_data WHERE shop_id = ?').bind(shopId),
      env.DB.prepare('DELETE FROM users WHERE shop_id = ?').bind(shopId),
      env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(shopId),
    ]);
    await logAudit(env, {
      actorType: 'owner', actorId: auth.aid, action: 'reject',
      targetType: 'shop', targetId: shopId,
      details: JSON.stringify({ shopName: shop.name }),
      ip,
    });
    return json({ ok: true });
  }

  if (action === 'block') {
    const reason = String(body.reason || '').trim().slice(0, 200);
    await env.DB.prepare(
      "UPDATE shops SET billing_status = 'blocked', blocked_at = ?, block_reason = ? WHERE id = ?"
    )
      .bind(nowIso, reason || null, shopId)
      .run();
    await logAudit(env, {
      actorType: 'owner', actorId: auth.aid, action: 'block',
      targetType: 'shop', targetId: shopId,
      details: JSON.stringify({ reason }),
      ip,
    });
    return json({ ok: true });
  }

  if (action === 'unblock') {
    const plan = shop.plan || DEFAULT_PLAN;
    const info = planInfo(plan);
    let end = shop.subscription_end || null;
    if (!end || new Date(end).getTime() < now.getTime()) {
      end = info.days === null ? null : addDays(now, info.days);
    }
    await env.DB.prepare(
      `UPDATE shops SET billing_status = ?, subscription_start = ?, subscription_end = ?,
         blocked_at = NULL, block_reason = NULL
       WHERE id = ?`
    )
      .bind(plan === 'trial' ? 'trial' : 'active', shop.subscription_start || nowIso, end, shopId)
      .run();
    await logAudit(env, {
      actorType: 'owner', actorId: auth.aid, action: 'unblock',
      targetType: 'shop', targetId: shopId,
      details: JSON.stringify({ plan, end }),
      ip,
    });
    return json({ ok: true });
  }

  if (action === 'set_plan' || action === 'extend') {
    const plan = String(body.plan || (action === 'extend' ? shop.plan : 'monthly'))
      .trim()
      .toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(PLAN_DAYS, plan)) {
      throw new HttpError(400, 'Plan sahi nahi hai');
    }
    const info = planInfo(plan);
    const amount = Math.max(0, Number(body.amount) || 0);
    const method = String(body.method || '').trim().slice(0, 40);
    const note = String(body.note || '').trim().slice(0, 200);

    let start = nowIso;
    let end = info.days === null ? null : addDays(now, info.days);
    if (action === 'extend') {
      const currentEnd = shop.subscription_end ? new Date(shop.subscription_end) : null;
      const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
      start = shop.subscription_start || nowIso;
      end = info.days === null ? null : addDays(base, info.days);
    }

    const lastPaymentAt = amount > 0 ? nowIso : shop.last_payment_at || null;
    const lastPaymentAmount = amount > 0 ? amount : shop.last_payment_amount ?? null;

    await env.DB.prepare(
      `UPDATE shops SET plan = ?, billing_status = ?, subscription_start = ?, subscription_end = ?,
         blocked_at = NULL, block_reason = NULL, last_payment_at = ?, last_payment_amount = ?
       WHERE id = ?`
    )
      .bind(
        plan,
        plan === 'trial' ? 'trial' : 'active',
        start,
        end,
        lastPaymentAt,
        lastPaymentAmount,
        shopId
      )
      .run();

    if (amount > 0 || plan !== 'trial') {
      await env.DB.prepare(
        `INSERT INTO subscription_payments
           (id, shop_id, amount, plan, period_start, period_end, method, note, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          randomId('pay'),
          shopId,
          amount,
          plan,
          start,
          end,
          method,
          note,
          nowIso,
          auth.aid
        )
        .run();
    }

    await logAudit(env, {
      actorType: 'owner', actorId: auth.aid, action,
      targetType: 'shop', targetId: shopId,
      details: JSON.stringify({ plan, amount, method, note, end }),
      ip,
    });
    return json({ ok: true });
  }

  throw new HttpError(400, 'Unknown action');
}

async function handleOwnerPayments(request, env) {
  await requireOwner(request, env);
  const url = new URL(request.url);
  const shopId = String(url.searchParams.get('shopId') || '').trim();
  if (!shopId) throw new HttpError(400, 'Shop ID required');
  const rows = await env.DB.prepare(
    `SELECT id, amount, plan, period_start, period_end, method, note, created_at
     FROM subscription_payments WHERE shop_id = ? ORDER BY created_at DESC LIMIT 100`
  )
    .bind(shopId)
    .all();
  return json({ payments: rows.results || [] });
}

async function handleOwnerAuditLog(request, env) {
  await requireOwner(request, env);
  const rows = await env.DB.prepare(
    `SELECT id, actor_type, actor_id, action, target_type, target_id, details, ip, created_at
     FROM audit_log ORDER BY created_at DESC LIMIT 200`
  ).all();
  return json({ logs: rows.results || [] });
}

async function handleOwnerPassword(request, env) {
  const auth = await requireOwner(request, env);
  const ip = getClientIp(request);
  const body = await readJson(request);
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  if (next.length < PASSWORD_MIN_LENGTH) {
    throw new HttpError(400, `New password kam az kam ${PASSWORD_MIN_LENGTH} characters ka hona chahiye`);
  }
  const row = await env.DB.prepare('SELECT password_hash FROM admins WHERE id = ?')
    .bind(auth.aid)
    .first();
  if (!row) throw new HttpError(404, 'Owner account not found');
  const ok = await verifyPassword(current, row.password_hash);
  if (!ok) throw new HttpError(401, 'Current password is incorrect');
  const hash = await hashPassword(next);
  await env.DB.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').bind(hash, auth.aid).run();
  await logAudit(env, {
    actorType: 'owner', actorId: auth.aid, action: 'change_password',
    targetType: 'admin', targetId: auth.aid,
    details: JSON.stringify({}),
    ip,
  });
  return json({ ok: true });
}

/* ---------- Routes: shop ---------- */

async function handleLogin(request, env) {
  const ip = getClientIp(request);
  const endpoint = '/api/login';
  const rate = await checkRateLimit(env, ip, endpoint);
  if (!rate.ok) throw new HttpError(429, 'Zyada requests — thode baad koshish karein');

  const locked = await isLockedOut(env, ip, endpoint);
  if (locked) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(423, 'Zyada failed attempts — temporarily block hai');
  }

  const body = await readJson(request);
  const identifierRaw = String(body.identifier || '').trim();
  const identifier = identifierRaw.toLowerCase();
  const digitCount = identifierRaw.replace(/[^\d]/g, '').length;
  const phone = digitCount >= 7 ? normalizePhone(identifierRaw) : '__no_phone__';
  const password = String(body.password || '');
  if (!identifierRaw || !password) throw new HttpError(400, 'Phone number/shop code/email aur password likhein');

  const row = await env.DB.prepare(
    `SELECT u.id AS uid, u.shop_id AS sid, u.email AS email, u.name AS user_name, u.password_hash,
            s.name AS shop_name, s.code AS shop_code, s.email AS shop_email, s.phone AS shop_phone,
            s.shop_type AS shop_type, s.status AS shop_status, s.plan AS plan,
            s.billing_status AS billing_status, s.subscription_start AS subscription_start,
            s.subscription_end AS subscription_end
     FROM users u JOIN shops s ON s.id = u.shop_id
     WHERE u.email = ? OR s.code = ? OR s.phone = ?
     LIMIT 1`
  )
    .bind(identifier, identifier, phone)
    .first();

  if (!row) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(401, 'Is phone number / shop code ka koi account nahi mila');
  }

  const access = billingAccess({
    status: row.shop_status,
    billing_status: row.billing_status,
    plan: row.plan,
    subscription_end: row.subscription_end,
  });
  if (!access.ok) {
    if (access.code === 'expired') {
      await env.DB.prepare("UPDATE shops SET billing_status = 'expired' WHERE id = ?")
        .bind(row.sid)
        .run()
        .catch(() => {});
    }
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(403, access.message);
  }

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    await recordLoginAttempt(env, ip, endpoint, false);
    throw new HttpError(401, 'Password galat hai');
  }

  await recordLoginAttempt(env, ip, endpoint, true);

  const dataRow = await env.DB.prepare('SELECT data FROM shop_data WHERE shop_id = ?').bind(row.sid).first();
  const shopType = row.shop_type || DEFAULT_SHOP_TYPE;
  const data = dataRow?.data
    ? JSON.parse(dataRow.data)
    : defaultData(row.shop_name, row.user_name, row.email, row.shop_phone, shopType);

  const token = await signToken(
    { uid: row.uid, sid: row.sid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL },
    env.AUTH_SECRET
  );

  return json({
    token,
    shop: shopPayload({
      id: row.sid,
      name: row.shop_name,
      code: row.shop_code,
      email: row.shop_email,
      phone: row.shop_phone,
      shop_type: row.shop_type,
      plan: row.plan,
      billing_status: row.billing_status,
      subscription_start: row.subscription_start,
      subscription_end: row.subscription_end,
    }),
    data,
  });
}

async function handleBootstrap(request, env) {
  const auth = await requireAuth(request, env);
  const shop = await loadShop(env, auth.sid);
  if (!shop) throw new HttpError(401, 'Shop not found');
  const access = billingAccess(shop);
  if (!access.ok) {
    if (access.code === 'expired') {
      await env.DB.prepare("UPDATE shops SET billing_status = 'expired' WHERE id = ?")
        .bind(auth.sid)
        .run()
        .catch(() => {});
    }
    throw new HttpError(403, access.message);
  }
  const dataRow = await env.DB.prepare('SELECT data, updated_at FROM shop_data WHERE shop_id = ?').bind(auth.sid).first();
  const data = dataRow?.data
    ? JSON.parse(dataRow.data)
    : defaultData(shop.name, '', shop.email, shop.phone, shop.shop_type);
  const payload = {
    shop: shopPayload(shop),
    data,
    updatedAt: dataRow?.updated_at || null,
  };
  // ETag lets the app skip re-downloading an unchanged shop on every open.
  const etag = await makeEtag(JSON.stringify(payload));
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'private, no-cache',
        ...SECURE_HEADERS,
      },
    });
  }
  return json(payload, 200, { ETag: etag, 'Cache-Control': 'private, no-cache' });
}

async function handleSaveData(request, env) {
  const auth = await requireAuth(request, env);
  const shop = await loadShop(env, auth.sid);
  if (!shop) throw new HttpError(401, 'Shop not found');
  const access = billingAccess(shop);
  if (!access.ok) {
    if (access.code === 'expired') {
      await env.DB.prepare("UPDATE shops SET billing_status = 'expired' WHERE id = ?")
        .bind(auth.sid)
        .run()
        .catch(() => {});
    }
    throw new HttpError(403, access.message);
  }

  const body = await readJson(request, MAX_DATA_BYTES + 200000);
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Invalid shop data');
  }
  const text = JSON.stringify(data);
  if (text.length > MAX_DATA_BYTES) throw new HttpError(413, 'Shop data is too large (max 2 MB)');

  const now = new Date().toISOString();
  const shopName = String(data.settings?.shopName || '').trim().slice(0, 60);
  const phone = normalizePhone(data.settings?.phone || '').slice(0, 15);
  const shopType = String(data.settings?.shopType || '').trim().toLowerCase();

  const statements = [
    env.DB.prepare(
      `INSERT INTO shop_data (shop_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(shop_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).bind(auth.sid, text, now),
  ];
  if (shopName) {
    statements.push(env.DB.prepare('UPDATE shops SET name = ? WHERE id = ?').bind(shopName, auth.sid));
  }
  if (phone) {
    const taken = await env.DB.prepare('SELECT id FROM shops WHERE phone = ? AND id != ?')
      .bind(phone, auth.sid)
      .first();
    if (taken) throw new HttpError(409, 'Ye phone number pehle se kisi aur shop ke paas hai');
    statements.push(env.DB.prepare('UPDATE shops SET phone = ? WHERE id = ?').bind(phone, auth.sid));
  }
  if (SHOP_TYPES[shopType]) {
    statements.push(env.DB.prepare('UPDATE shops SET shop_type = ? WHERE id = ?').bind(shopType, auth.sid));
  }
  await env.DB.batch(statements);

  return json({ ok: true, updatedAt: now, bytes: text.length });
}

async function handlePublicShop(request, env) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim().toLowerCase();
  if (!code) throw new HttpError(400, 'Shop code is required');
  const row = await env.DB.prepare(
    "SELECT name, code FROM shops WHERE code = ? AND status = 'active'"
  )
    .bind(code)
    .first();
  if (!row) throw new HttpError(404, 'Shop not found');
  return json(
    { shop: { name: row.name, code: row.code } },
    200,
    { 'Cache-Control': 'public, max-age=60, s-maxage=600' }
  );
}

async function handleChangePassword(request, env) {
  const auth = await requireAuth(request, env);
  const body = await readJson(request);
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  if (next.length < PASSWORD_MIN_LENGTH) throw new HttpError(400, `New password kam az kam ${PASSWORD_MIN_LENGTH} characters ka hona chahiye`);

  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(auth.uid).first();
  if (!row) throw new HttpError(404, 'Account not found');
  const ok = await verifyPassword(current, row.password_hash);
  if (!ok) throw new HttpError(401, 'Current password is incorrect');

  const hash = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, auth.uid).run();
  return json({ ok: true });
}

async function handleAccountDelete(request, env) {
  const auth = await requireAuth(request, env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM subscription_payments WHERE shop_id = ?').bind(auth.sid),
    env.DB.prepare('DELETE FROM shop_data WHERE shop_id = ?').bind(auth.sid),
    env.DB.prepare('DELETE FROM users WHERE shop_id = ?').bind(auth.sid),
    env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(auth.sid),
  ]);
  return json({ ok: true });
}

/* ---------- health ---------- */

async function handleHealth(env) {
  return json({
    ok: true,
    service: 'mhzaly-api',
    version: '2.0.0',
    time: new Date().toISOString(),
    features: ['rate_limit', 'lockout', 'audit_log', 'subscriptions', 'security_headers'],
  });
}

/* ---------- entry ---------- */

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      let response;
      if (path === '/' || path === '/api/health') {
        response = await handleHealth(env);
      } else if (path === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env);
      } else if (path === '/api/login' && request.method === 'POST') {
        response = await handleLogin(request, env);
      } else if (path === '/api/confirm' && (request.method === 'GET' || request.method === 'POST')) {
        response = await handleConfirm(request, env);
      } else if (path === '/api/admin' && request.method === 'GET') {
        response = await handleAdmin(request, env);
      } else if (path === '/api/owner/login' && request.method === 'POST') {
        response = await handleOwnerLogin(request, env);
      } else if (path === '/api/owner/overview' && request.method === 'GET') {
        response = await handleOwnerOverview(request, env);
      } else if (path === '/api/owner/shop' && request.method === 'POST') {
        response = await handleOwnerShopAction(request, env);
      } else if (path === '/api/owner/payments' && request.method === 'GET') {
        response = await handleOwnerPayments(request, env);
      } else if (path === '/api/owner/audit' && request.method === 'GET') {
        response = await handleOwnerAuditLog(request, env);
      } else if (path === '/api/owner/password' && request.method === 'POST') {
        response = await handleOwnerPassword(request, env);
      } else if (path === '/api/bootstrap' && request.method === 'GET') {
        response = await handleBootstrap(request, env);
      } else if (path === '/api/data' && request.method === 'PUT') {
        response = await handleSaveData(request, env);
      } else if (path === '/api/shop' && request.method === 'GET') {
        response = await handlePublicShop(request, env);
      } else if (path === '/api/password' && request.method === 'POST') {
        response = await handleChangePassword(request, env);
      } else if (path === '/api/account' && request.method === 'DELETE') {
        response = await handleAccountDelete(request, env);
      } else {
        response = json({ error: 'Not found' }, 404);
      }

      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
      return response;
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      return json({ error: 'Internal server error' }, 500, cors);
    }
  },
};
