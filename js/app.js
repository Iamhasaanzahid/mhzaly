/* ============================================================
   mhzaly — app shell, auth gate & router
   ============================================================ */

import { db, lowStockProducts, totalReceivable, configureShop, hydrate } from './db.js';
import { icon, esc, initials, navigate, toast, openModal, closeModal } from './ui.js';
import {
  getToken, getStoredShop, isDemo, bootstrap, clearSession,
  changePassword, onSyncStatus, getSyncStatus, markSynced,
} from './api.js';
import * as authPage from './pages/auth.js';

import * as dashboard from './pages/dashboard.js';
import * as pos from './pages/pos.js';
import * as products from './pages/products.js';
import * as sales from './pages/sales.js';
import * as purchases from './pages/purchases.js';
import * as customers from './pages/customers.js';
import * as suppliers from './pages/suppliers.js';
import * as expenses from './pages/expenses.js';
import * as reports from './pages/reports.js';
import * as settings from './pages/settings.js';

const PAGES = {
  dashboard, pos, products, sales, purchases, customers, suppliers, expenses, reports, settings,
};

const NAV = [
  { section: 'Store' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'pos', label: 'New Sale', icon: 'cart' },
  { id: 'products', label: 'Products', icon: 'box' },
  { id: 'sales', label: 'Sales', icon: 'receipt' },
  { id: 'purchases', label: 'Purchases', icon: 'truck' },
  { section: 'People' },
  { id: 'customers', label: 'Customers', icon: 'users' },
  { id: 'suppliers', label: 'Suppliers', icon: 'supplier' },
  { section: 'Business' },
  { id: 'expenses', label: 'Expenses', icon: 'wallet' },
  { id: 'reports', label: 'Reports', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

let bootInfo = { shop: null, offline: false };

function navHTML(active) {
  const low = lowStockProducts().length;
  const due = totalReceivable();
  return NAV.map((item) => {
    if (item.section) return `<div class="nav-label">${esc(item.section)}</div>`;
    let badge = '';
    if (item.id === 'products' && low > 0) badge = `<span class="nav-badge">${low}</span>`;
    if (item.id === 'customers' && due > 0) {
      const short = due >= 1000000 ? (due / 1000000).toFixed(1) + 'M' : due >= 1000 ? (due / 1000).toFixed(1) + 'k' : Math.round(due);
      badge = `<span class="nav-badge red">${db.settings.currency || 'Rs'} ${short}</span>`;
    }
    return `<button class="nav-item ${item.id === active ? 'active' : ''}" data-nav="${item.id}">
      ${icon(item.icon)}<span>${esc(item.label)}</span>${badge}
    </button>`;
  }).join('');
}

function syncPillHTML(status) {
  if (isDemo()) return `${icon('sparkle')}<span>Demo mode</span>`;
  const map = {
    idle: { ic: 'check', label: 'Cloud' },
    saving: { ic: 'clock', label: 'Saving…' },
    saved: { ic: 'check', label: 'Saved' },
    offline: { ic: 'alert', label: 'Offline' },
    error: { ic: 'alert', label: 'Login again' },
  };
  const s = map[status] || map.idle;
  return `${icon(s.ic)}<span>${s.label}</span>`;
}

function paintSyncPill(status) {
  const el = document.getElementById('syncPill');
  if (!el) return;
  const effective = bootInfo.offline && status === 'idle' ? 'offline' : status;
  el.className = `pill sync-pill ${effective}`;
  el.innerHTML = syncPillHTML(effective);
  el.title = isDemo() ? 'Demo shop — data is only on this browser' : 'Cloud sync status';
}

function shell() {
  const shop = db.settings.shopName || 'My Mart';
  document.getElementById('app').innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-logo">${icon('bag')}</div>
          <div>
            <div class="brand-name">mhzaly</div>
            <div class="brand-sub">${esc(shop)}</div>
          </div>
        </div>
        <nav class="nav" id="nav"></nav>
        <button class="sidebar-foot" id="sidebarAccount" type="button">
          <div class="avatar">${esc(initials(db.settings.ownerName || shop))}</div>
          <div class="grow" style="text-align:left">
            <div class="who">${esc(db.settings.ownerName || 'Shop Owner')}</div>
            <div class="role">${isDemo() ? 'Demo — not synced' : 'Cloud synced'}</div>
          </div>
          ${icon('settings', 'foot-icon')}
        </button>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu">${icon('menu')}</button>
          <div>
            <h1 id="pageTitle">Dashboard</h1>
            <div class="sub" id="pageSub"></div>
          </div>
          <div class="topbar-right">
            <span class="pill sync-pill idle" id="syncPill">${syncPillHTML('idle')}</span>
            <span class="pill date-pill">${icon('calendar')}<span id="todayPill"></span></span>
            <button class="icon-btn account-btn" id="accountBtn" title="Shop account">${esc(initials(db.settings.ownerName || shop))}</button>
            <button class="btn btn-sm" data-nav="pos">${icon('plus')} New Sale</button>
          </div>
        </header>
        <main class="content" id="main"></main>
      </div>
    </div>`;

  document.getElementById('todayPill').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  document.getElementById('nav').innerHTML = navHTML('dashboard');

  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.getElementById('accountBtn').addEventListener('click', openAccountModal);
  document.getElementById('sidebarAccount').addEventListener('click', openAccountModal);

  document.body.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      navigate('#/' + navBtn.dataset.nav);
      document.getElementById('sidebar').classList.remove('open');
      return;
    }
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) {
      navigate('#/' + goBtn.dataset.go);
    }
  });

  onSyncStatus(paintSyncPill);
  paintSyncPill(getSyncStatus());

  const welcome = sessionStorage.getItem('mhzaly_welcome');
  if (welcome && Number(welcome) > 0) {
    sessionStorage.removeItem('mhzaly_welcome');
    setTimeout(() => {
      toast(`${welcome} common products added — set your stock and start selling!`, 'success', 5200);
    }, 500);
  }
  if (bootInfo.offline) {
    setTimeout(() => toast('Offline mode — aap ka cached data use ho raha hai', 'warn', 4200), 600);
  }
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast('Login link copied'),
    () => toast('Copy nahi ho saka', 'error')
  );
}

function openAccountModal() {
  const stored = getStoredShop() || {};
  const demo = isDemo();
  const code = stored.code || '';
  const link = code ? `${location.origin}${location.pathname}?shop=${code}` : '';

  const modal = openModal({
    title: 'Shop account',
    subtitle: stored.name || db.settings.shopName || 'mhzaly shop',
    body: `
      <div class="stat-strip">
        <div><div class="lbl">Shop code</div><div class="val mono" style="font-size:14px">${esc(code || 'demo')}</div></div>
        <div><div class="lbl">Login email</div><div class="val" style="font-size:13px;word-break:break-all">${esc(stored.email || '—')}</div></div>
        <div><div class="lbl">Mode</div><div class="val" style="font-size:14px">${demo ? 'Demo' : 'Cloud'}</div></div>
      </div>
      ${
        link
          ? `<div class="field mt">
              <label>Your shop's login page</label>
              <div class="flex">
                <input class="input mono input-sm" id="shopLoginLink" readonly value="${esc(link)}" />
                <button class="btn btn-ghost btn-sm" id="copyLoginLink" type="button">${icon('download')} Copy</button>
              </div>
              <span class="hint">Send this link to your staff or open it on another device to log in with your password.</span>
            </div>`
          : ''
      }
      ${
        demo
          ? `<div class="alert-box mt">${icon('sparkle')}<div>You are exploring a demo shop. Data is saved only in this browser. Create an account to keep your shop online and synced.</div></div>`
          : `<div class="alert-box mt" style="background:#f0fdfa;border-color:#99f6e4;color:#115e59">${icon('check')}<div>Your shop data is synced to mhzaly cloud and available on any device after login.</div></div>`
      }`,
    footer: `
      ${demo ? `<button class="btn btn-ghost" id="createFromDemo">Create my shop</button>` : `<button class="btn btn-ghost" id="changePasswordBtn">Change password</button>`}
      <button class="btn btn-ghost" data-modal-close>Close</button>
      <button class="btn btn-danger" id="logoutBtn">${demo ? 'Exit demo' : 'Logout'}</button>`,
    onMount: (m) => {
      m.querySelector('#copyLoginLink')?.addEventListener('click', () => copyText(link));
      m.querySelector('#logoutBtn').addEventListener('click', () => {
        if (demo) {
          clearSession();
          window.location.href = location.pathname;
          return;
        }
        clearSession();
        window.location.href = code ? `${location.pathname}?shop=${encodeURIComponent(code)}` : location.pathname;
      });
      m.querySelector('#createFromDemo')?.addEventListener('click', () => {
        clearSession();
        window.location.href = location.pathname + '#/register';
      });
      m.querySelector('#changePasswordBtn')?.addEventListener('click', () => {
        closeModal();
        setTimeout(openChangePassword, 60);
      });
    },
  });
  return modal;
}

function openChangePassword() {
  const modal = openModal({
    title: 'Change password',
    subtitle: 'Keep your shop account secure',
    body: `
      <form id="passwordForm">
        <div class="field">
          <label>Current password</label>
          <input class="input" name="current" type="password" required autocomplete="current-password" />
        </div>
        <div class="field mt-sm">
          <label>New password</label>
          <input class="input" name="next" type="password" required minlength="6" autocomplete="new-password" />
        </div>
        <div class="field mt-sm">
          <label>Confirm new password</label>
          <input class="input" name="confirm" type="password" required minlength="6" autocomplete="new-password" />
        </div>
        <div class="form-actions">
          <button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>
          <button class="btn" type="submit">Update password</button>
        </div>
      </form>`,
  });
  modal.querySelector('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const current = String(fd.get('current') || '');
    const next = String(fd.get('next') || '');
    const confirm = String(fd.get('confirm') || '');
    if (next !== confirm) return toast('New passwords match nahi kar rahe', 'error');
    try {
      await changePassword(current, next);
      closeModal();
      toast('Password updated');
    } catch (err) {
      toast(err.message || 'Password update nahi ho saka', 'error');
    }
  });
}

function currentId() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  return PAGES[raw] ? raw : 'dashboard';
}

function renderPage() {
  const id = currentId();
  const page = PAGES[id];
  const main = document.getElementById('main');
  if (!main) return;

  document.getElementById('pageTitle').textContent = page.meta.title;
  const sub = document.getElementById('pageSub');
  if (sub) sub.textContent = page.meta.subtitle || '';
  document.title = `${page.meta.title} · mhzaly`;

  const nav = document.getElementById('nav');
  if (nav) nav.innerHTML = navHTML(id);

  main.innerHTML = '';
  try {
    page.render(main);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card card-pad"><h3>Something went wrong</h3>
      <p class="muted mt-sm">${esc(err.message || String(err))}</p>
      <button class="btn mt" onclick="location.hash='#/dashboard'">Back to dashboard</button></div>`;
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderAuthView() {
  const hash = location.hash.replace(/^#\/?/, '');
  const mode = hash === 'register' ? 'register' : 'login';
  const params = new URLSearchParams(location.search);
  const shopCode = (params.get('shop') || '').trim().toLowerCase();
  document.title = shopCode ? `Login · mhzaly` : 'Login · mhzaly';
  authPage.render(document.getElementById('app'), { mode, shopCode });
}

async function initSession() {
  if (isDemo()) {
    configureShop({ demo: true });
    return { demo: true, shop: null, offline: false };
  }
  const shop = getStoredShop();
  const token = getToken();
  if (!shop || !token) return null;

  configureShop({ shopId: shop.id });
  try {
    const res = await bootstrap();
    hydrate(res.data);
    markSynced();
    bootInfo = { shop: res.shop, offline: false };
    return bootInfo;
  } catch (err) {
    if (err.status === 401) {
      clearSession();
      return null;
    }
    bootInfo = { shop, offline: true };
    return bootInfo;
  }
}

window.addEventListener('hashchange', () => {
  if (document.getElementById('main')) renderPage();
  else renderAuthView();
});
window.addEventListener('app:refresh', renderPage);
window.addEventListener('session:expired', () => {
  toast('Session expired — please login again', 'error');
  clearSession();
  setTimeout(() => {
    window.location.href = location.pathname;
  }, 1200);
});

document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const session = await initSession();
  if (!session) {
    renderAuthView();
    return;
  }

  if (location.hash === '#/login' || location.hash === '#/register' || !location.hash) {
    history.replaceState(null, '', location.pathname + '#/dashboard');
  }

  shell();
  renderPage();
});
