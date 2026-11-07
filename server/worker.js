/* ============================================================
   mhzaly API — Cloudflare Worker + D1
   Multi-shop auth (phone / email / shop code + password), owner
   approval by email, cloud data sync.
   ============================================================ */

const PBKDF2_ITERATIONS = 60000;
const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
const MAX_DATA_BYTES = 2 * 1024 * 1024;
const OWNER_EMAIL_DEFAULT = 'mhzcyb@gmail.com';
const CONFIRM_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const PUBLIC_APP_URL = 'https://mhzaly.pages.dev/';

const COMMON_PRODUCTS = [
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
    origin === 'https://mhzaly.pages.dev' ||
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

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
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

/** Keep only digits; turn +92xxxxxxxxxx into 0xxxxxxxxxx for easy login. */
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

function defaultData(shopName, ownerName, email, phone) {
  const now = new Date().toISOString();
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
    },
    products: COMMON_PRODUCTS.map((item, i) => ({
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
    'SELECT id, name, code, email, phone, status, created_at FROM shops WHERE id = ?'
  )
    .bind(shopId)
    .first();
}

function shopPayload(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone || '',
  };
}

/* ---------------- email ---------------- */

async function sendOwnerEmail(env, { subject, text, htmlBody }) {
  const owner = env.OWNER_EMAIL || OWNER_EMAIL_DEFAULT;
  const errors = [];

  // 1) Resend (best option — add RESEND_API_KEY as a Worker secret)
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
      errors.push(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      errors.push(`resend: ${err.message}`);
    }
  }

  // 2) Optional custom webhook (Zapier / Make / n8n / your own relay)
  if (env.MAIL_WEBHOOK_URL) {
    try {
      const res = await fetch(env.MAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: owner, subject, text, html: htmlBody }),
      });
      if (res.ok) return { ok: true, provider: 'webhook' };
      errors.push(`webhook ${res.status}`);
    } catch (err) {
      errors.push(`webhook: ${err.message}`);
    }
  }

  // 3) FlowForm (no signup needed, generic mode)
  try {
    const res = await fetch(`https://flowform.to/${encodeURIComponent(owner)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: subject,
        name: 'mhzaly',
        email: owner,
        message: text,
      }),
    });
    if (res.ok) return { ok: true, provider: 'flowform' };
    errors.push(`flowform ${res.status}`);
  } catch (err) {
    errors.push(`flowform: ${err.message}`);
  }

  // 4) FormSubmit (no signup needed, but the service is sometimes down)
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(owner)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: subject,
        _template: 'basic',
        _captcha: 'false',
        message: text,
      }),
    });
    if (res.ok) return { ok: true, provider: 'formsubmit' };
    errors.push(`formsubmit ${res.status}`);
  } catch (err) {
    errors.push(`formsubmit: ${err.message}`);
  }

  console.error('Owner email could not be sent:', errors.join(' | '));
  return { ok: false, errors };
}

function emailLayout(title, intro, details, actions, footer) {
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">${escHtml(label)}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;text-align:right">${escHtml(value)}</td></tr>`
    )
    .join('');
  const buttons = actions
    .map(
      (a) =>
        `<a href="${escHtml(a.href)}" style="display:inline-block;padding:11px 20px;border-radius:9px;background:${a.bg};color:#fff;text-decoration:none;font-size:13px;font-weight:700;margin:4px 6px 4px 0">${escHtml(a.label)}</a>`
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <div style="max-width:520px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
    <div style="background:#0f766e;padding:18px 22px;color:#fff">
      <div style="font-size:19px;font-weight:800;letter-spacing:-.02em">mhzaly</div>
      <div style="font-size:12px;opacity:.85;margin-top:2px">Shop registration approval</div>
    </div>
    <div style="padding:22px">
      <h2 style="margin:0 0 6px;font-size:17px;color:#0f172a">${escHtml(title)}</h2>
      <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#475569">${escHtml(intro)}</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${rows}</table>
      <div style="margin-top:18px">${buttons}</div>
      <p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:#94a3b8">${escHtml(footer)}</p>
    </div>
  </div>
</body></html>`;
}

/* ---------------- routes ---------------- */

async function handleRegister(request, env) {
  const body = await readJson(request);
  const shopName = String(body.shopName || '').trim();
  const ownerName = String(body.ownerName || '').trim();
  const phone = normalizePhone(body.phone);
  const password = String(body.password || '');
  const givenEmail = String(body.email || '').trim().toLowerCase();
  let code = String(body.shopCode || '').trim().toLowerCase();

  if (shopName.length < 2 || shopName.length > 60) {
    throw new HttpError(400, 'Shop ka naam 2–60 characters ka hona chahiye');
  }
  if (phone.length < 7 || phone.length > 15) {
    throw new HttpError(400, 'Sahi phone number likhein (misal: 03001234567)');
  }
  if (password.length < 6) {
    throw new HttpError(400, 'Password kam az kam 6 characters ka hona chahiye');
  }
  if (givenEmail && !isEmail(givenEmail)) {
    throw new HttpError(400, 'Sahi email address likhein');
  }
  if (code) {
    if (!/^[a-z0-9-]{3,30}$/.test(code)) {
      throw new HttpError(400, 'Shop code can use a–z, 0–9 and dashes (3–30 characters)');
    }
  } else {
    code = slugify(shopName).slice(0, 24);
    if (code.length < 3) code = 'shop';
  }

  const phoneTaken = await env.DB.prepare('SELECT id FROM shops WHERE phone = ?').bind(phone).first();
  if (phoneTaken) {
    throw new HttpError(409, 'Is phone number se pehle hi shop bani hui hai — login karein ya doosra number use karein');
  }

  if (givenEmail) {
    const emailTaken = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(givenEmail).first();
    if (emailTaken) throw new HttpError(409, 'This email is already registered — please log in');
  }

  const codeRow = await env.DB.prepare('SELECT id FROM shops WHERE code = ?').bind(code).first();
  if (codeRow) {
    if (body.shopCode) throw new HttpError(409, 'This shop code is already taken');
    code = `${code.slice(0, 25)}-${randomCodeSuffix()}`;
  }

  const email = givenEmail || `${code}@phone.mhzaly`;
  const shopId = randomId('shop');
  const userId = randomId('user');
  const now = new Date().toISOString();
  const token = randomToken();
  const expires = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();
  const passwordHash = await hashPassword(password);
  const data = defaultData(shopName, ownerName, email, phone);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO shops (id, name, code, email, phone, status, confirm_token, confirm_expires, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).bind(shopId, shopName, code, email, phone, token, expires, now),
    env.DB.prepare(
      'INSERT INTO users (id, shop_id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, shopId, email, ownerName, 'owner', passwordHash, now),
    env.DB.prepare('INSERT INTO shop_data (shop_id, data, updated_at) VALUES (?, ?, ?)')
      .bind(shopId, JSON.stringify(data), now),
  ]);

  const origin = new URL(request.url).origin;
  const approveUrl = `${origin}/api/confirm?token=${token}&action=approve`;
  const rejectUrl = `${origin}/api/confirm?token=${token}&action=reject`;
  const subject = `mhzaly: Naya shop approval — ${shopName}`;
  const text = [
    'Naya shop registration request aayi hai.',
    '',
    `Shop: ${shopName}`,
    `Phone: ${phone}`,
    `Code: ${code}`,
    `Time: ${now}`,
    '',
    `Approve karne ke liye: ${approveUrl}`,
    `Reject karne ke liye: ${rejectUrl}`,
    '',
    'Approve karne ke baad shop owner apne phone number aur password se login kar sakta hai.',
  ].join('\n');
  const htmlBody = emailLayout(
    'Naya shop approve karein',
    'Neeche diye gaye shop ne mhzaly par account banane ki request bheji hai. Approve karne ke baad hi ye shop login kar sakegi.',
    [
      ['Shop name', shopName],
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

  return json({
    pending: true,
    emailSent: mail.ok,
    shop: { id: shopId, name: shopName, code, phone },
    message: 'Aap ki request bhej di gayi hai. Approval ke baad login kar sakte hain.',
  });
}

function confirmPage({ title, body, color = '#0f766e' }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(title)} · mhzaly</title></head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:20px">
    <div style="max-width:460px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center">
      <div style="width:52px;height:52px;border-radius:14px;background:${color};margin:0 auto 16px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px">✓</div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">${escHtml(title)}</h1>
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
    'SELECT id, name, code, phone, status, confirm_token, confirm_expires FROM shops WHERE confirm_token = ?'
  )
    .bind(token)
    .first();

  if (!shop) {
    return html(
      confirmPage({
        title: 'Link not found',
        body: 'Ye link pehle hi use ho chuka hai ya expire ho gaya hai. <br><br>Owner panel se dobara check karein.',
        color: '#dc2626',
      }),
      404
    );
  }

  if (shop.status !== 'pending') {
    return html(
      confirmPage({
        title: 'Already handled',
        body: `Shop <b>${escHtml(shop.name)}</b> pehle hi approve ho chuki hai.`,
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

  if (action === 'reject') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM shop_data WHERE shop_id = ?').bind(shop.id),
      env.DB.prepare('DELETE FROM users WHERE shop_id = ?').bind(shop.id),
      env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(shop.id),
    ]);
    return html(
      confirmPage({
        title: 'Request rejected',
        body: `Shop <b>${escHtml(shop.name)}</b> ki request reject kar di gayi hai. Ab ye login nahi kar sakti.`,
        color: '#dc2626',
      })
    );
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE shops SET status = 'active', confirm_token = NULL, confirm_expires = NULL, approved_at = ? WHERE id = ?"
  )
    .bind(now, shop.id)
    .run();

  const loginUrl = `${PUBLIC_APP_URL}?shop=${encodeURIComponent(shop.code)}`;
  return html(
    confirmPage({
      title: 'Shop approved! ✅',
      body: `Shop <b>${escHtml(shop.name)}</b> (${escHtml(shop.phone || '')}) ab approve ho chuki hai.<br><br>
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
    'SELECT id, name, code, phone, created_at, confirm_token, confirm_expires FROM shops WHERE status = ? ORDER BY created_at DESC'
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
            <td style="padding:10px;border-bottom:1px solid #e2e8f0"><b>${escHtml(s.name)}</b><br><span style="font-size:11px;color:#64748b">${escHtml(s.code)}</span></td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escHtml(s.phone || '—')}<br><span style="font-size:11px;color:#64748b">${escHtml(s.created_at)}</span></td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">
              <a href="${approve}" style="display:inline-block;padding:7px 12px;border-radius:7px;background:#0f766e;color:#fff;text-decoration:none;font-size:12px;font-weight:700">Approve</a>
              <a href="${reject}" style="display:inline-block;padding:7px 12px;border-radius:7px;background:#dc2626;color:#fff;text-decoration:none;font-size:12px;font-weight:700;margin-left:4px">Reject</a>
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
          <p style="margin:0 0 14px;font-size:13px;color:#475569">Neeche pending shops hain. Approve karne par wo turant login kar sakengi.</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">${list}</table>
        </div>
      </div>
    </body></html>`);
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  const identifierRaw = String(body.identifier || '').trim();
  const identifier = identifierRaw.toLowerCase();
  const digitCount = identifierRaw.replace(/[^\d]/g, '').length;
  const phone = digitCount >= 7 ? normalizePhone(identifierRaw) : '__no_phone__';
  const password = String(body.password || '');
  if (!identifierRaw || !password) throw new HttpError(400, 'Phone number/shop code aur password likhein');

  const row = await env.DB.prepare(
    `SELECT u.id AS uid, u.shop_id AS sid, u.email AS email, u.name AS user_name, u.password_hash,
            s.name AS shop_name, s.code AS shop_code, s.email AS shop_email, s.phone AS shop_phone,
            s.status AS shop_status
     FROM users u JOIN shops s ON s.id = u.shop_id
     WHERE u.email = ? OR s.code = ? OR s.phone = ?
     LIMIT 1`
  )
    .bind(identifier, identifier, phone)
    .first();

  if (!row) throw new HttpError(401, 'Is phone number / shop code ka koi account nahi mila');
  if (row.shop_status !== 'active') {
    throw new HttpError(
      403,
      'Aap ka account abhi approve nahi hua. Owner ke email par approval request bheji gayi hai — approve hone ke baad login karein.'
    );
  }

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new HttpError(401, 'Password galat hai');

  const dataRow = await env.DB.prepare('SELECT data FROM shop_data WHERE shop_id = ?').bind(row.sid).first();
  const data = dataRow?.data
    ? JSON.parse(dataRow.data)
    : defaultData(row.shop_name, row.user_name, row.email, row.shop_phone);

  const token = await signToken(
    { uid: row.uid, sid: row.sid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL },
    env.AUTH_SECRET
  );

  return json({
    token,
    shop: {
      id: row.sid,
      name: row.shop_name,
      code: row.shop_code,
      email: row.shop_email,
      phone: row.shop_phone || '',
    },
    data,
  });
}

async function handleBootstrap(request, env) {
  const auth = await requireAuth(request, env);
  const shop = await loadShop(env, auth.sid);
  if (!shop) throw new HttpError(401, 'Shop not found');
  if (shop.status !== 'active') throw new HttpError(403, 'Shop abhi approve nahi hui');
  const dataRow = await env.DB.prepare('SELECT data, updated_at FROM shop_data WHERE shop_id = ?').bind(auth.sid).first();
  const data = dataRow?.data
    ? JSON.parse(dataRow.data)
    : defaultData(shop.name, '', shop.email, shop.phone);
  return json({
    shop: shopPayload(shop),
    data,
    updatedAt: dataRow?.updated_at || null,
  });
}

async function handleSaveData(request, env) {
  const auth = await requireAuth(request, env);
  const shop = await loadShop(env, auth.sid);
  if (!shop) throw new HttpError(401, 'Shop not found');
  if (shop.status !== 'active') throw new HttpError(403, 'Shop abhi approve nahi hui');

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
      } else if (path === '/api/confirm' && (request.method === 'GET' || request.method === 'POST')) {
        response = await handleConfirm(request, env);
      } else if (path === '/api/admin' && request.method === 'GET') {
        response = await handleAdmin(request, env);
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
