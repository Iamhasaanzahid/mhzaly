/* ============================================================
   mhzaly API — Cloudflare Worker + D1
   Multi-shop auth (email or shop code + password), cloud data sync
   ============================================================ */

const PBKDF2_ITERATIONS = 60000;
const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
const MAX_DATA_BYTES = 2 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------------- helpers ---------------- */

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed =
    origin === 'https://iamhasaanzahid.github.io' ||
    /^https:\/\/[a-z0-9-]+\.mhzaly\.pages\.dev$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
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
      ...extra,
    },
  });
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
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
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

/* ---------------- password hashing ---------------- */

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

/* ---------------- session tokens ---------------- */

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

/* ---------------- shop data ---------------- */

function defaultData(shopName, ownerName, email) {
  return {
    version: 1,
    settings: {
      shopName,
      ownerName: ownerName || '',
      phone: '',
      address: '',
      currency: 'Rs',
      taxRate: 0,
      lowStock: 5,
      receiptNote: 'Thank you for shopping with us!',
      email,
    },
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

async function loadShop(env, shopId) {
  return env.DB.prepare('SELECT id, name, code, email, created_at FROM shops WHERE id = ?')
    .bind(shopId)
    .first();
}

/* ---------------- routes ---------------- */

async function handleRegister(request, env) {
  const body = await readJson(request);
  const shopName = String(body.shopName || '').trim();
  const ownerName = String(body.ownerName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  let code = String(body.shopCode || '').trim().toLowerCase();

  if (shopName.length < 2 || shopName.length > 60) throw new HttpError(400, 'Shop name must be 2–60 characters');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (code) {
    if (!/^[a-z0-9-]{3,30}$/.test(code)) {
      throw new HttpError(400, 'Shop code can use a–z, 0–9 and dashes (3–30 characters)');
    }
  } else {
    code = slugify(shopName).slice(0, 24);
    if (code.length < 3) code = 'shop';
  }

  const emailTaken = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (emailTaken) throw new HttpError(409, 'This email is already registered — please log in');

  const codeRow = await env.DB.prepare('SELECT id FROM shops WHERE code = ?').bind(code).first();
  if (codeRow) {
    if (body.shopCode) throw new HttpError(409, 'This shop code is already taken');
    code = `${code.slice(0, 25)}-${randomCodeSuffix()}`;
  }

  const shopId = randomId('shop');
  const userId = randomId('user');
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const data = defaultData(shopName, ownerName, email);

  await env.DB.batch([
    env.DB.prepare('INSERT INTO shops (id, name, code, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(shopId, shopName, code, email, now),
    env.DB.prepare('INSERT INTO users (id, shop_id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userId, shopId, email, ownerName, 'owner', passwordHash, now),
    env.DB.prepare('INSERT INTO shop_data (shop_id, data, updated_at) VALUES (?, ?, ?)')
      .bind(shopId, JSON.stringify(data), now),
  ]);

  const token = await signToken(
    { uid: userId, sid: shopId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL },
    env.AUTH_SECRET
  );

  return json({
    token,
    shop: { id: shopId, name: shopName, code, email },
    data,
  });
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  const identifier = String(body.identifier || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!identifier || !password) throw new HttpError(400, 'Enter your email/shop code and password');

  const row = await env.DB.prepare(
    `SELECT u.id AS uid, u.shop_id AS sid, u.email AS email, u.name AS user_name, u.password_hash,
            s.name AS shop_name, s.code AS shop_code, s.email AS shop_email
     FROM users u JOIN shops s ON s.id = u.shop_id
     WHERE u.email = ? OR s.code = ?
     LIMIT 1`
  )
    .bind(identifier, identifier)
    .first();

  if (!row) throw new HttpError(401, 'No account found for this email or shop code');
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new HttpError(401, 'Incorrect password');

  const dataRow = await env.DB.prepare('SELECT data FROM shop_data WHERE shop_id = ?').bind(row.sid).first();
  const data = dataRow?.data ? JSON.parse(dataRow.data) : defaultData(row.shop_name, row.user_name, row.email);

  const token = await signToken(
    { uid: row.uid, sid: row.sid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL },
    env.AUTH_SECRET
  );

  return json({
    token,
    shop: { id: row.sid, name: row.shop_name, code: row.shop_code, email: row.shop_email },
    data,
  });
}

async function handleBootstrap(request, env) {
  const auth = await requireAuth(request, env);
  const shop = await loadShop(env, auth.sid);
  if (!shop) throw new HttpError(401, 'Shop not found');
  const dataRow = await env.DB.prepare('SELECT data, updated_at FROM shop_data WHERE shop_id = ?').bind(auth.sid).first();
  const data = dataRow?.data ? JSON.parse(dataRow.data) : defaultData(shop.name, '', shop.email);
  return json({
    shop: { id: shop.id, name: shop.name, code: shop.code, email: shop.email },
    data,
    updatedAt: dataRow?.updated_at || null,
  });
}

async function handleSaveData(request, env) {
  const auth = await requireAuth(request, env);
  const body = await readJson(request, MAX_DATA_BYTES + 200000);
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Invalid shop data');
  }
  const text = JSON.stringify(data);
  if (text.length > MAX_DATA_BYTES) throw new HttpError(413, 'Shop data is too large (max 2 MB)');

  const now = new Date().toISOString();
  const shopName = String(data.settings?.shopName || '').trim().slice(0, 60);

  const statements = [
    env.DB.prepare(
      `INSERT INTO shop_data (shop_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(shop_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).bind(auth.sid, text, now),
  ];
  if (shopName) {
    statements.push(env.DB.prepare('UPDATE shops SET name = ? WHERE id = ?').bind(shopName, auth.sid));
  }
  await env.DB.batch(statements);

  return json({ ok: true, updatedAt: now, bytes: text.length });
}

async function handlePublicShop(request, env) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim().toLowerCase();
  if (!code) throw new HttpError(400, 'Shop code is required');
  const row = await env.DB.prepare('SELECT name, code FROM shops WHERE code = ?').bind(code).first();
  if (!row) throw new HttpError(404, 'Shop not found');
  return json({ shop: { name: row.name, code: row.code } });
}

async function handleChangePassword(request, env) {
  const auth = await requireAuth(request, env);
  const body = await readJson(request);
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  if (next.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');

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
    env.DB.prepare('DELETE FROM shop_data WHERE shop_id = ?').bind(auth.sid),
    env.DB.prepare('DELETE FROM users WHERE shop_id = ?').bind(auth.sid),
    env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(auth.sid),
  ]);
  return json({ ok: true });
}

/* ---------------- entry ---------------- */

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      let response;
      if (path === '/' || path === '/api/health') {
        response = json({ ok: true, service: 'mhzaly-api', time: new Date().toISOString() });
      } else if (path === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env);
      } else if (path === '/api/login' && request.method === 'POST') {
        response = await handleLogin(request, env);
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
      console.error('Unhandled error:', err?.stack || err);
      return json({ error: 'Something went wrong on the server' }, 500, cors);
    }
  },
};
