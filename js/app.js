/* ============================================================
   mhzaly — app shell, auth gate & router
   ============================================================ */

import { db, lowStockProducts, totalReceivable, totalSales, totalProfit, configureShop, hydrate, save } from './db.js';
import { icon, esc, initials, toast, openModal, closeModal, linkLabels } from './ui.js';
import {
  getToken, getStoredShop, isDemo, bootstrap, clearSession,
  changePassword, onSyncStatus, getSyncStatus, markSynced,
} from './api.js';
import { resolvedTheme, applyTheme, toggleTheme, watchSystemTheme } from './theme.js';
import { LANGS, initLang, applyLang, setLang, getLang, coverage, t } from './i18n.js';
import { applyLanguageCountry, formatMoney } from './currency.js';
import { applyTaxCountry } from './tax.js';
import { isPharmacy, expiringProducts, productBatches } from './pharmacy.js';

import * as authPage from './pages/auth.js';
import * as dashboard from './pages/dashboard.js';
import * as assistant from './pages/assistant.js';
import * as pos from './pages/pos.js';
import * as products from './pages/products.js';
import * as sales from './pages/sales.js';
import * as purchases from './pages/purchases.js';
import * as customers from './pages/customers.js';
import * as suppliers from './pages/suppliers.js';
import * as expenses from './pages/expenses.js';
import * as reports from './pages/reports.js';
import * as settings from './pages/settings.js';
import * as returns from './pages/returns.js';
import * as restock from './pages/restock.js';
import * as dayclose from './pages/dayclose.js';
import * as leaks from './pages/leaks.js';
import * as billing from './pages/billing.js';

const PAGES = {
  dashboard, assistant, login: authPage, pos, products, sales, purchases, customers, suppliers, expenses, reports, settings, returns, restock, dayclose, leaks,
};

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  assistant: 'AI Assistant',
  pos: 'POS Billing',
  products: 'Products',
  sales: 'Sales',
  purchases: 'Purchases',
  customers: 'Customers',
  suppliers: 'Suppliers',
  expenses: 'Expenses',
  reports: 'Reports',
  settings: 'Settings',
  returns: 'Returns & Refunds',
  restock: 'Smart Restock',
  dayclose: 'Day Close',
  leaks: 'Profit Leak Finder',
};

let currentPage = null;

/* ---------- install prompt & command palette ---------- */
let deferredInstall = null;
let swRegistration = null;
let swRefreshing = false;
let notifTimer = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.hidden = false;
});

function openCommandPalette() {
  const low = lowStockProducts();
  const expiring = isPharmacy() ? expiringProducts(90) : [];

  const actions = [
    { label: 'Ask AI', hint: 'Shop data se sawal poochein', icon: 'sparkle', run: () => {
      navigate('#/assistant');
      setTimeout(() => document.getElementById('aiText')?.focus(), 140);
    } },
    { label: 'New sale (POS)', hint: 'Create an invoice', icon: 'plus', run: () => navigate('#/pos') },
    { label: 'Add product', hint: 'Inventory mein naya item', icon: 'bag', run: () => {
      sessionStorage.setItem('mhzaly_add_product', '1');
      navigate('#/products');
    } },
    { label: 'Add customer', hint: 'Naya udhaar khata', icon: 'bag', run: () => {
      sessionStorage.setItem('mhzaly_add_customer', '1');
      navigate('#/customers');
    } },
    { label: 'Dashboard', hint: 'Today overview', icon: 'calendar', run: () => navigate('#/dashboard') },
    { label: 'Smart Restock', hint: 'Demand forecast', icon: 'alert', run: () => navigate('#/restock') },
    { label: 'Profit Leak Finder', hint: 'Paisa kahan ja raha hai', icon: 'chart', run: () => navigate('#/leaks') },
    { label: 'Day Close', hint: 'Cash reconciliation', icon: 'wallet', run: () => navigate('#/dayclose') },
    { label: 'Products', hint: 'Inventory', icon: 'bag', run: () => navigate('#/products') },
    { label: 'Sales', hint: 'All invoices', icon: 'check', run: () => navigate('#/sales') },
    { label: 'Returns & refunds', hint: 'Return items', icon: 'return', run: () => navigate('#/returns') },
    { label: 'Purchases', hint: 'Supplier stock', icon: 'alert', run: () => navigate('#/purchases') },
    { label: 'Customers', hint: 'Udhaar khata', icon: 'bag', run: () => navigate('#/customers') },
    { label: 'Suppliers', hint: 'Payables', icon: 'bag', run: () => navigate('#/suppliers') },
    { label: 'Expenses', hint: 'Record costs', icon: 'alert', run: () => navigate('#/expenses') },
    { label: 'Reports', hint: 'Profit & summary', icon: 'chart', run: () => navigate('#/reports') },
    { label: 'Settings', hint: 'Shop & backup', icon: 'settings', run: () => navigate('#/settings') },
    { label: 'Keyboard shortcuts', hint: 'Shortcut help', icon: 'settings', run: () => openShortcutsHelp() },
    { label: 'Toggle dark mode', hint: 'Theme', icon: 'moon', run: () => toggleTheme() },
    { label: 'Language', hint: '12 languages · زبان · भाषा', icon: 'globe', run: () => openLanguagePicker() },
  ];

  if (low.length) {
    actions.splice(5, 0, {
      label: `Low stock products (${low.length})`,
      hint: 'Reorder list kholen',
      icon: 'alert',
      run: () => {
        sessionStorage.setItem('mhzaly_product_low', '1');
        navigate('#/products');
      },
    });
  }
  if (expiring.length) {
    const expired = expiring.filter((p) => p._exp.state === 'expired').length;
    actions.splice(6, 0, {
      label: `Expiry alerts (${expiring.length})`,
      hint: expired ? `${expired} expired · baqi 90 din ke andar` : '90 din ke andar expire',
      icon: 'calendar',
      run: () => {
        sessionStorage.setItem('mhzaly_product_expiry', '1');
        navigate('#/products');
      },
    });
  }

  const money = (n) => {
    try { return formatMoney(Number(n) || 0); } catch { return String(n ?? ''); }
  };
  const has = (value, q) => String(value || '').toLowerCase().includes(q);

  function dataResults(q) {
    if (!q) return [];
    const out = [];
    let n = 0;
    for (const p of db.products) {
      if (n >= 6) break;
      const batches = productBatches(p);
      if (
        has(p.name, q) || has(p.sku, q) || has(p.salt, q) || has(p.manufacturer, q) ||
        has(p.category, q) || batches.some((b) => has(b.batch, q))
      ) {
        out.push({
          label: p.name,
          hint: `Product · ${p.stock ?? 0} stock · ${money(p.price)}`,
          icon: 'bag',
          run: () => {
            sessionStorage.setItem('mhzaly_product_search', p.name);
            navigate('#/products');
          },
        });
        n += 1;
      }
    }

    n = 0;
    for (const c of db.customers) {
      if (n >= 5) break;
      if (has(c.name, q) || has(c.phone, q) || has(c.taxNumber, q)) {
        const bal = Number(c.balance) || 0;
        out.push({
          label: c.name,
          hint: `Customer · ${c.phone || 'no phone'}${bal > 0 ? ' · ' + money(bal) + ' udhaar' : ''}`,
          icon: 'wallet',
          run: () => {
            sessionStorage.setItem('mhzaly_customer_search', c.name);
            navigate('#/customers');
          },
        });
        n += 1;
      }
    }

    n = 0;
    for (const s of db.suppliers) {
      if (n >= 4) break;
      if (has(s.name, q) || has(s.phone, q)) {
        const bal = Number(s.balance) || 0;
        out.push({
          label: s.name,
          hint: `Supplier · ${s.phone || 'no phone'}${bal > 0 ? ' · ' + money(bal) + ' payable' : ''}`,
          icon: 'bag',
          run: () => {
            sessionStorage.setItem('mhzaly_supplier_search', s.name);
            navigate('#/suppliers');
          },
        });
        n += 1;
      }
    }

    const sales = db.sales.slice().reverse();
    n = 0;
    for (const sale of sales) {
      if (n >= 5) break;
      if (has(sale.invoiceNo, q) || has(sale.id, q) || has(sale.customerName, q) || has(sale.customerPhone, q)) {
        out.push({
          label: `${sale.invoiceNo || sale.id} · ${sale.customerName || 'Walk-in'}`,
          hint: `Invoice · ${money(sale.total)} · ${new Date(sale.createdAt || 0).toLocaleDateString('en-GB')}`,
          icon: 'check',
          run: () => {
            sessionStorage.setItem('mhzaly_open_sale', sale.id);
            navigate('#/sales');
          },
        });
        n += 1;
      }
    }

    return out;
  }

  openModal({
    title: 'Search mhzaly',
    subtitle: 'Products, customers, suppliers, invoices aur actions · ↑↓ move · Enter open',
    body: `<input class="input" id="cmdInput" placeholder="Product, customer, invoice, ya action…" autocomplete="off" />
      <div class="cmd-list" id="cmdList"></div>`,
    onMount: (bd) => {
      const input = bd.querySelector('#cmdInput');
      const list = bd.querySelector('#cmdList');
      let filtered = actions.slice();
      let active = 0;

      const paint = () => {
        list.innerHTML = filtered.length
          ? filtered.map((a, i) => `<button class="cmd-item ${i === active ? 'active' : ''}" data-i="${i}" type="button">${icon(a.icon)}<span>${esc(a.label)}</span><em>${esc(a.hint || '')}</em></button>`).join('')
          : '<div class="empty-state">Kuch match nahi hua. Doosra naam try karein.</div>';
        const row = list.querySelector('.cmd-item.active');
        if (row) row.scrollIntoView({ block: 'nearest' });
      };
      const refresh = () => {
        const q = String(input.value || '').toLowerCase().trim();
        const matchedActions = q
          ? actions.filter((a) => String(a.label || '').toLowerCase().includes(q) || String(a.hint || '').toLowerCase().includes(q))
          : actions;
        filtered = [...matchedActions, ...dataResults(q)].slice(0, 30);
        active = 0;
        paint();
      };
      const run = (a) => {
        if (!a) return;
        bd.remove();
        a.run();
      };

      input.addEventListener('input', refresh);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          active = Math.min(filtered.length - 1, active + 1);
          paint();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          active = Math.max(0, active - 1);
          paint();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          run(filtered[active] || filtered[0]);
        }
      });
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-i]');
        if (btn) run(filtered[Number(btn.dataset.i)]);
      });
      refresh();
      setTimeout(() => input.focus(), 60);
    },
  });
}

/* ---------- notification center ---------- */

function notifItems() {
  const list = [];
  const low = lowStockProducts();
  if (low.length) {
    list.push({
      tone: low.some((p) => (p.stock ?? 0) === 0) ? 'danger' : 'warn',
      icon: 'bag',
      title: `${low.length} product${low.length === 1 ? '' : 's'} low stock`,
      detail: low.slice(0, 3).map((p) => p.name).join(' · '),
      run: () => {
        sessionStorage.setItem('mhzaly_product_low', '1');
        navigate('#/products');
      },
    });
  }

  if (isPharmacy()) {
    const expiring = expiringProducts(90);
    if (expiring.length) {
      const expired = expiring.filter((p) => p._exp.state === 'expired').length;
      list.push({
        tone: expired ? 'danger' : 'warn',
        icon: 'calendar',
        title: `${expiring.length} expiry alert${expiring.length === 1 ? '' : 's'}`,
        detail: expired ? `${expired} expired · ${expiring.length - expired} 90 din ke andar` : '90 din ke andar expire ho rahi hain',
        run: () => {
          sessionStorage.setItem('mhzaly_product_expiry', '1');
          navigate('#/products');
        },
      });
    }
  }

  const receivable = totalReceivable();
  const withBalance = db.customers.filter((c) => (Number(c.balance) || 0) > 0).length;
  if (receivable > 0) {
    list.push({
      tone: 'warn',
      icon: 'wallet',
      title: `${formatMoney(receivable)} udhaar baqi`,
      detail: `${withBalance} customer${withBalance === 1 ? '' : 's'} se lena hai`,
      run: () => navigate('#/customers'),
    });
  }

  const payable = db.suppliers.reduce((sum, s) => sum + Math.max(0, Number(s.balance) || 0), 0);
  const suppliersWithBalance = db.suppliers.filter((s) => (Number(s.balance) || 0) > 0).length;
  if (payable > 0) {
    list.push({
      tone: 'danger',
      icon: 'wallet',
      title: `${formatMoney(payable)} suppliers ko dena hai`,
      detail: `${suppliersWithBalance} supplier${suppliersWithBalance === 1 ? '' : 's'} ka payable`,
      run: () => navigate('#/suppliers'),
    });
  }

  const status = db.settings._billingStatus || 'active';
  if (status === 'trial' || status === 'expired' || status === 'blocked') {
    list.push({
      tone: status === 'trial' ? 'warn' : 'danger',
      icon: 'sparkle',
      title: status === 'trial' ? 'Trial khatam ho raha hai' : status === 'expired' ? 'Plan expired' : 'Account blocked',
      detail: status === 'trial' ? `${db.settings._daysLeft ?? 0} din baqi — plan renew karein` : 'Owner se rabta karein',
      run: () => navigate('#/settings'),
    });
  }

  if (!isDemo() && (db.products.length || db.sales.length)) {
    const last = localStorage.getItem('mhzaly_last_backup');
    const age = last ? Date.now() - new Date(last).getTime() : Infinity;
    if (!Number.isFinite(age) || age > 7 * 86400000) {
      list.push({
        tone: 'neutral',
        icon: 'download',
        title: 'Backup reminder',
        detail: last ? 'Last backup 7 din se purana hai' : 'Abhi tak backup nahi liya — data safety ke liye backup lein',
        run: () => navigate('#/settings'),
      });
    }
  }

  return list;
}

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const count = notifItems().length;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.hidden = count === 0;
}

function setupNotifications() {
  const wrap = document.getElementById('notifWrap');
  const btn = document.getElementById('notifBtn');
  const panel = document.getElementById('notifPanel');
  if (!wrap || !btn || !panel) return;

  let items = [];
  const close = () => {
    panel.hidden = true;
    document.removeEventListener('click', onDoc, true);
  };
  const onDoc = (e) => {
    if (!wrap.contains(e.target)) close();
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.hidden) { close(); return; }
    items = notifItems();
    panel.innerHTML = `
      <div class="notif-head">
        <b>Notifications</b>
        <span class="badge ${items.length ? 'warn' : 'ok'}">${items.length ? `${items.length} alert${items.length === 1 ? '' : 's'}` : 'All clear'}</span>
      </div>
      ${items.length
        ? `<div class="notif-list">${items.map((n, i) => `<button class="notif-item ${n.tone}" data-notif="${i}" type="button">
            <span class="notif-ico">${icon(n.icon)}</span>
            <span class="grow"><b>${esc(n.title)}</b><span>${esc(n.detail)}</span></span>
          </button>`).join('')}</div>`
        : `<div class="notif-empty">${icon('check')}<b>Sab theek hai</b><span>Koi urgent alert nahi.</span></div>`}
      <button class="notif-foot" data-notif-settings type="button">${icon('settings')} Settings & backup</button>`;
    panel.hidden = false;
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  });

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('[data-notif]');
    if (item) {
      const n = items[Number(item.dataset.notif)];
      close();
      if (n) n.run();
      return;
    }
    if (e.target.closest('[data-notif-settings]')) {
      close();
      navigate('#/settings');
    }
  });

  updateNotifBadge();
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = setInterval(updateNotifBadge, 60000);
}

/* ---------- language picker ---------- */

export function switchLanguage(code) {
  const next = setLang(code);
  try {
    db.settings.language = next;
    // Follow the language's country (currency + number/date format) unless
    // the owner has already picked a country by hand in Settings.
    const profile = applyLanguageCountry(db.settings, next);
    if (profile && profile.tax && profile.tax !== 'OTHER') {
      applyTaxCountry(db.settings, profile.tax);
    }
    save();
  } catch { /* sync not available */ }
  const hash = location.hash || '#/dashboard';
  renderShell();
  navigate(hash);
  applyLang(document);
  const meta = LANGS.find((l) => l.code === next);
  toast(`${meta ? meta.flag + ' ' + meta.native : next}`);
  return next;
}

function openLanguagePicker() {
  const current = getLang();
  openModal({
    title: 'Language',
    subtitle: 'Apni zaban chunein — ye setting aap ke account ke saath save hoti hai',
    body: `<div class="lang-grid">${LANGS.map((l) => `
        <button class="lang-item ${l.code === current ? 'active' : ''}" data-lang="${l.code}" type="button">
          <span class="lang-flag">${l.flag}</span>
          <span class="lang-name"><b>${esc(l.native)}</b><em>${esc(l.name)}</em></span>
          <span class="lang-check">${l.code === current ? icon('check') : ''}</span>
        </button>`).join('')}</div>`,
    onMount: (bd) => {
      applyLang(bd);
      bd.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-lang]');
        if (!btn) return;
        const code = btn.dataset.lang;
        bd.remove();
        switchLanguage(code);
      });
    },
  });
}

function openShortcutsHelp() {  openModal({
    title: 'Keyboard shortcuts',
    subtitle: 'Kaam tez karne ke liye',
    body: `
      <div class="shortcut-list">
        <div><kbd>Ctrl</kbd> + <kbd>K</kbd><span>Universal search — products, customers, invoices, actions</span></div>
        <div><kbd>Ctrl</kbd> + <kbd>/</kbd><span>Search & quick actions</span></div>
        <div><kbd>F2</kbd><span>POS search focus</span></div>
        <div><kbd>F4</kbd><span>POS checkout</span></div>
        <div><kbd>?</kbd><span>Ye shortcut list</span></div>
        <div><kbd>Esc</kbd><span>Modal band karein</span></div>
        <div><kbd>Enter</kbd><span>Search result / form save</span></div>
      </div>
      <p class="small muted" style="margin:12px 0 0">Tip: POS mein barcode scan karne ke liye search box mein scan karein — Enter dabate hi item add ho jata hai.</p>`,
    footer: `<button class="btn btn-primary" data-modal-close>Got it</button>`,
  });
}

function showUpdateBanner(reg) {
  if (document.querySelector('.update-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <div class="update-banner-ico">${icon('sparkle')}</div>
    <div class="grow">
      <b>New version available</b>
      <span>Refresh karein taake latest mhzaly features mil jayein.</span>
    </div>
    <button class="btn btn-ghost btn-sm" data-update-later>Later</button>
    <button class="btn btn-primary btn-sm" data-update-now>Refresh</button>`;
  document.body.appendChild(banner);
  banner.querySelector('[data-update-later]').addEventListener('click', () => banner.remove());
  banner.querySelector('[data-update-now]').addEventListener('click', () => {
    swRefreshing = true;
    const waiting = reg?.waiting || swRegistration?.waiting;
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => {
        if (swRefreshing) {
          swRefreshing = false;
          location.reload();
        }
      }, 900);
    } else {
      location.reload();
    }
  });
}

function renderAuthView() {
  const hash = location.hash.replace(/^#\/?/, '');
  const mode = hash === 'register' ? 'register' : 'login';
  const params = new URLSearchParams(location.search);
  const shopCode = (params.get('shop') || '').trim().toLowerCase();
  document.title = 'mhzaly — Shop Manager';
  authPage.render(document.getElementById('app'), { mode, shopCode });
  linkLabels(document.getElementById('app'));
  applyLang(document);
}

export function init() {
  applyTheme();
  // detect IP‑based country / language on first visit (non‑blocking)
  requestIdleCallback(() => maybeApplyGeo());
  initLang();
  watchSystemTheme((resolved) => {
    const btn = document.getElementById('themeBtn');
    if (btn) btn.innerHTML = icon(resolved === 'dark' ? 'sun' : 'moon');
  });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      swRegistration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
        });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshing) {
        swRefreshing = false;
        location.reload();
      }
    });
  }
  const params = new URLSearchParams(location.search);
  if (params.get('logout') === '1') {
    clearSession();
    history.replaceState(null, '', location.pathname);
    // Force a clean slate: drop the service worker + caches so a stale
    // build can never keep the old login/dashboard around.
    Promise.resolve().then(async () => {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch { /* ignore */ }
    });
  }
  if (isDemo()) {
    configureShop({ demo: true });
    renderShell();
    const hash = location.hash && location.hash !== '#/login' && location.hash !== '#/register' ? location.hash : '#/dashboard';
    if (!location.hash || location.hash === '#/login' || location.hash === '#/register') {
      history.replaceState(null, '', location.pathname + '#/dashboard');
    }
    navigate(hash);
    return;
  }
  const token = getToken();
  if (token) {
    const stored = getStoredShop();
    if (stored) {
      configureShop({ shopId: stored.id });
      bootstrap().then((res) => {
        hydrate(res.data);
        if (res.shop) {
          db.settings._plan = res.shop.plan;
          db.settings._planLabel = res.shop.planLabel;
          db.settings._daysLeft = res.shop.daysLeft;
          db.settings._billingStatus = res.shop.billingStatus;
          save();
        }
        // The shop's saved language wins over this device's choice.
        const remoteLang = res.data && res.data.settings ? res.data.settings.language : '';
        if (remoteLang && remoteLang !== getLang()) {
          setLang(remoteLang, { persist: false });
        } else if (!remoteLang && getLang()) {
          db.settings.language = getLang();
          save();
        }
        markSynced();
        renderShell();
        navigate('#/dashboard');
      }).catch((err) => {
        console.error('bootstrap failed', err);
        if (err && (err.status === 402 || err.status === 403)) {
          document.title = 'mhzaly — Plan activate karein';
          billing.renderLock(document.getElementById('app'), {
            shop: getStoredShop(),
            message: err.message,
          });
          return;
        }
        clearSession();
        location.href = './';
      });
      return;
    }
  }
  renderAuthView();
}

function shell() {
  const shop = db.settings.shopName || 'My Mart';
  document.getElementById('app').innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-logo">${db.settings.logo ? `<img src="${esc(db.settings.logo)}" alt="" />` : icon('bag')}</div>
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
            <button class="icon-btn" id="installBtn" title="Install app" hidden>${icon('download')}</button>
            <button class="icon-btn" id="themeBtn" title="Dark mode">${icon('moon')}</button>
            <button class="icon-btn" id="langBtn" title="Language" aria-label="Language">${icon('globe')}</button>
            <div class="notif-wrap" id="notifWrap">
              <button class="icon-btn notif-btn" id="notifBtn" title="Notifications" aria-label="Notifications">${icon('bell')}<span class="notif-badge" id="notifBadge" hidden>0</span></button>
              <div class="notif-panel" id="notifPanel" hidden></div>
            </div>
            <button class="icon-btn" id="cmdBtn" title="Search & actions (Ctrl+K)" aria-label="Universal search">${icon('search')}</button>
            <button class="icon-btn account-btn" id="accountBtn" title="Shop account">${esc(initials(db.settings.ownerName || shop))}</button>
            <button class="btn btn-ghost btn-sm" id="logoutTopBtn" title="${isDemo() ? 'Exit demo' : 'Logout'}">${isDemo() ? 'Exit' : 'Logout'}</button>
            <button class="btn btn-primary btn-sm" data-nav="pos">${icon('plus')} New Sale</button>
          </div>
        </header>
        <main class="content" id="main"></main>
      </div>

      <button class="ai-fab" id="aiFab" type="button" title="Ask AI" aria-label="Ask AI">
        ${icon('sparkle')} <span>Ask AI</span>
      </button>
    </div>`;

  document.getElementById('todayPill').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  document.getElementById('nav').innerHTML = navHTML('dashboard');

  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  const aiFab = document.getElementById('aiFab');
  if (aiFab) {
    aiFab.addEventListener('click', () => {
      navigate('#/assistant');
      document.getElementById('sidebar').classList.remove('open');
      setTimeout(() => document.getElementById('aiText')?.focus(), 120);
    });
  }
  if (!document.body.dataset.aiShortcut) {
    document.body.dataset.aiShortcut = '1';
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
      if ((e.ctrlKey || e.metaKey) && String(e.key) === '/') {
        e.preventDefault();
        openCommandPalette();
      }
      const tag = (e.target && e.target.tagName) || '';
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.preventDefault();
        openShortcutsHelp();
      }
    });
  }

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    const paintThemeBtn = () => {
      themeBtn.innerHTML = icon(resolvedTheme() === 'dark' ? 'sun' : 'moon');
      themeBtn.title = resolvedTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    };
    paintThemeBtn();
    themeBtn.addEventListener('click', () => {
      toggleTheme();
      paintThemeBtn();
      toast(resolvedTheme() === 'dark' ? 'Dark mode on' : 'Light mode on');
    });
  }

  const cmdBtn = document.getElementById('cmdBtn');
  if (cmdBtn) cmdBtn.addEventListener('click', openCommandPalette);

  setupNotifications();

  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.addEventListener('click', openLanguagePicker);

  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    if (deferredInstall && !window.matchMedia('(display-mode: standalone)').matches) installBtn.hidden = false;
    installBtn.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch { /* ignore */ }
      deferredInstall = null;
      installBtn.hidden = true;
    });
  }

  if (!document.body.dataset.netShortcut) {
    document.body.dataset.netShortcut = '1';
    window.addEventListener('offline', () => paintSyncPill('offline'));
    window.addEventListener('online', () => paintSyncPill(getSyncStatus()));
  }

  document.getElementById('accountBtn').addEventListener('click', openAccountModal);
  document.getElementById('sidebarAccount').addEventListener('click', openAccountModal);
  document.getElementById('logoutTopBtn').addEventListener('click', () => {
    if (isDemo()) {
      clearSession();
      window.location.href = location.pathname;
      return;
    }
    const stored = getStoredShop() || {};
    clearSession();
    window.location.href = stored.code ? `${location.pathname}?shop=${encodeURIComponent(stored.code)}` : location.pathname;
  });

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
  if (!welcome) {
    sessionStorage.setItem('mhzaly_welcome', '1');
  }
}

function navHTML(active) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: icon('calendar') },
    { id: 'assistant', label: 'AI Assistant', icon: icon('sparkle') },
    { id: 'pos', label: 'POS Billing', icon: icon('plus') },
    { id: 'restock', label: 'Smart Restock', icon: icon('alert') },
    { id: 'leaks', label: 'Profit Leaks', icon: icon('chart') },
    { id: 'dayclose', label: 'Day Close', icon: icon('wallet') },
    { id: 'products', label: 'Products', icon: icon('bag') },
    { id: 'sales', label: 'Sales', icon: icon('check') },
    { id: 'returns', label: 'Returns', icon: icon('return') },
    { id: 'purchases', label: 'Purchases', icon: icon('alert') },
    { id: 'customers', label: 'Customers', icon: icon('bag') },
    { id: 'suppliers', label: 'Suppliers', icon: icon('bag') },
    { id: 'expenses', label: 'Expenses', icon: icon('alert') },
    { id: 'reports', label: 'Reports', icon: icon('check') },
    { id: 'settings', label: 'Settings', icon: icon('settings') },
  ];
  return items.map((item) => `
    <button class="nav-item ${item.id === active ? 'active' : ''}" data-nav="${item.id}">
      ${item.icon} ${item.label}
    </button>`).join('');
}

function renderShell() {
  shell();
  window.dispatchEvent(new CustomEvent('shell:rendered'));
}

function paintSyncPill(status) {
  const el = document.getElementById('syncPill');
  if (!el) return;
  const labels = { idle: 'Synced', saving: 'Saving…', saved: 'Saved', offline: 'Offline', error: 'Session Expired' };
  const colors = { idle: 'teal', saving: 'warn', saved: 'ok', offline: 'warn', error: 'danger' };
  el.className = `pill sync-pill ${colors[status] || 'idle'}`;
  el.innerHTML = syncPillHTML(status);
  el.title = isDemo() ? 'Demo shop — data is only on this browser' : 'Cloud sync status';
}

function syncPillHTML(status) {
  const dots = status === 'saving' ? '…' : '';
  return `${icon('check')} ${status}`;
}

function navigate(hash) {
  if (!hash) hash = '#/dashboard';
  const path = hash.slice(2);
  const [page, ...rest] = path.split('/');
  const pageId = page;

  document.getElementById('nav').querySelectorAll('[data-nav]').forEach((b) => {
    b.classList.toggle('active', b.dataset.nav === pageId);
  });

  const titleEl = document.getElementById('pageTitle');
  const subEl = document.getElementById('pageSub');
  titleEl.textContent = PAGE_TITLES[pageId] || pageId;
  subEl.textContent = '';

  const mod = PAGES[pageId];
  if (mod && mod.render) {
    const root = document.getElementById('main');
    mod.render(root, rest.join('/'));
    linkLabels(root);
    applyLang(document);
  } else {
    document.getElementById('main').innerHTML = `<div class="empty-state">Page not found: ${esc(pageId)}</div>`;
  }
  currentPage = pageId;
  document.body.classList.toggle('on-assistant', pageId === 'assistant');
  updateNotifBadge();
  if (location.hash !== hash) history.replaceState(null, '', hash);
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
        <div><div class="lbl">Category</div><div class="val" style="font-size:13px">${esc(db.settings.shopType ? db.settings.shopType : 'mart')}</div></div>
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
          <input class="input" name="next" type="password" required minlength="8" autocomplete="new-password" />
        </div>
        <div class="field mt-sm">
          <label>Confirm new password</label>
          <input class="input" name="confirm" type="password" required minlength="8" autocomplete="new-password" />
        </div>
        <div class="form-actions">
          <button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>
          <button class="btn btn-primary" type="submit">Update password</button>
        </div>
      </form>`,
    onMount: (m) => {
      m.querySelector('#passwordForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const current = String(fd.get('current') || '');
        const next = String(fd.get('next') || '');
        const confirm = String(fd.get('confirm') || '');
        if (next !== confirm) return toast('New passwords match nahi kar rahe', 'error');
        try {
          await changePassword(current, next);
          toast('Password update ho gaya', 'success');
          closeModal();
        } catch (err) {
          toast(err.message || 'Password update nahi ho saka', 'error');
        }
      });
    },
  });
  return modal;
}

function copyText(text) {
  const value = text || '';
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Copied');
    } catch {
      toast('Copy nahi ho saka', 'error');
    }
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(value).then(() => toast('Copied')).catch(fallback);
  } else {
    fallback();
  }
}

window.addEventListener('hashchange', () => {
  if (document.getElementById('main')) navigate(location.hash);
  else renderAuthView();
});
window.addEventListener('session:expired', () => {
  clearSession();
  toast('Session expire ho gaya — dobara login karein', 'error');
  setTimeout(() => { location.href = './'; }, 800);
});

export { shell, navigate };

init();
