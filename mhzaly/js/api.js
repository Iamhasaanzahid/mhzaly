/* ============================================================
   mhzaly — cloud API client, session & sync
   ============================================================ */

export const API_BASE = 'https://mhzaly-api.mhzaly.workers.dev';

const TOKEN_KEY = 'mhzaly_token';
const SHOP_KEY = 'mhzaly_shop';
const DEMO_KEY = 'mhzaly_demo';

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch {} }
export function getStoredShop() {
  try { return JSON.parse(localStorage.getItem(SHOP_KEY) || 'null'); } catch { return null; }
}
export function setStoredShop(shop) { try { localStorage.setItem(SHOP_KEY, JSON.stringify(shop)); } catch {} }
export function isDemo() { return localStorage.getItem(DEMO_KEY) === '1'; }
export function setDemo(on) {
  if (on) localStorage.setItem(DEMO_KEY, '1');
  else localStorage.removeItem(DEMO_KEY);
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SHOP_KEY);
  localStorage.removeItem(DEMO_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Internet connection nahi hai — please check your network', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

export async function register(payload) {
  return request('/api/register', { method: 'POST', body: payload, auth: false });
}
export async function login(identifier, password) {
  const res = await request('/api/login', { method: 'POST', body: { identifier, password }, auth: false });
  setToken(res.token);
  setStoredShop(res.shop);
  return res;
}
export async function ownerLogin(email, password) {
  const res = await request('/api/owner/login', { method: 'POST', body: { email, password }, auth: false });
  setToken(res.token);
  return res;
}
export function bootstrap() {
  return request('/api/bootstrap');
}
export function publicShop(code) {
  return request(`/api/shop?code=${encodeURIComponent(code)}`, { auth: false });
}
export function saveData(data) {
  return request('/api/data', { method: 'PUT', body: { data } });
}
export function changePassword(currentPassword, newPassword) {
  return request('/api/password', { method: 'POST', body: { currentPassword, newPassword } });
}
export async function ownerAction(path, body) {
  return request(path, { method: 'POST', body });
}
export function ownerOverview() {
  return request('/api/owner/overview');
}
export function ownerPayments(shopId) {
  return request(`/api/owner/payments?shopId=${encodeURIComponent(shopId)}`);
}
export function ownerAudit() {
  return request('/api/owner/audit');
}

/* ---------------- cloud sync ---------------- */

let syncTimer = null;
let pendingJson = null;
let syncStatus = 'idle';
const statusListeners = new Set();

function setStatus(next) {
  syncStatus = next;
  statusListeners.forEach((fn) => { try { fn(next); } catch {} });
}
export function getSyncStatus() { return syncStatus; }
export function onSyncStatus(fn) {
  statusListeners.add(fn);
  fn(syncStatus);
  return () => statusListeners.delete(fn);
}
export function scheduleSync(json) {
  if (isDemo() || !getToken()) return;
  pendingJson = json;
  setStatus('saving');
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(flush, 700);
}
async function flush() {
  syncTimer = null;
  if (!pendingJson || !getToken() || isDemo()) return;
  const json = pendingJson;
  pendingJson = null;
  try {
    await saveData(JSON.parse(json));
    setStatus(pendingJson ? 'saving' : 'saved');
  } catch (err) {
    if (err.status === 401) {
      setStatus('error');
      window.dispatchEvent(new CustomEvent('session:expired'));
      return;
    }
    pendingJson = json;
    setStatus('offline');
  }
}
export async function flushNow(json) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  pendingJson = null;
  await saveData(JSON.parse(json));
  setStatus('saved');
}
window.addEventListener('online', () => { if (pendingJson) flush(); });
setInterval(() => { if (pendingJson && getToken() && !isDemo()) flush(); }, 3000);
