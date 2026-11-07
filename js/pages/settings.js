/* ============================================================
   Settings & data management
   ============================================================ */

import {
  db, save, exportDb, importDb, clearAll, loadSampleData, defaultSettings,
} from '../db.js';
import {
  getStoredShop, isDemo, clearSession, deleteAccount, changePassword,
} from '../api.js';
import {
  icon, esc, initials, toast, refresh, confirmDialog, downloadFile, emptyState,
  openModal, closeModal,
} from '../ui.js';

export const meta = { title: 'Settings', subtitle: 'Shop details, backup and preferences' };

const VERSION = '1.0.0';

function syncShell() {
  const shop = db.settings.shopName || 'My Mart';
  const brandSub = document.querySelector('.brand-sub');
  if (brandSub) brandSub.textContent = shop;
  const who = document.querySelector('.sidebar-foot .who');
  if (who) who.textContent = db.settings.ownerName || 'Shop Owner';
  const avatar = document.querySelector('.sidebar-foot .avatar');
  if (avatar) avatar.textContent = initials(db.settings.ownerName || shop);
}

function storageSize() {
  try {
    const bytes = new Blob([exportDb()]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } catch {
    return '—';
  }
}

function loginLink() {
  const shop = getStoredShop() || {};
  return shop.code ? `${location.origin}${location.pathname}?shop=${shop.code}` : '';
}

function openChangePasswordModal() {
  if (isDemo()) return toast('Demo mode mein password nahi hota', 'error');
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
    if (next !== String(fd.get('confirm') || '')) return toast('New passwords match nahi kar rahe', 'error');
    try {
      await changePassword(current, next);
      closeModal();
      toast('Password updated');
    } catch (err) {
      toast(err.message || 'Password update nahi ho saka', 'error');
    }
  });
}

export function render(root) {
  const s = db.settings;
  const demo = isDemo();
  const shop = getStoredShop() || {};
  const link = loginLink();
  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Settings</h2>
        <p>Shop information, billing preferences and your data</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Account &amp; cloud sync</h3>
        <div class="right">${demo ? '<span class="badge amber">Demo mode</span>' : '<span class="badge teal">Cloud synced</span>'}</div>
      </div>
      <div class="card-pad">
        ${
          demo
            ? `<p class="small muted" style="max-width:760px">Aap is waqt demo shop dekh rahe hain. Demo ka data sirf is browser mein rehta hai. Apna shop account banayein taake data cloud mein mehfooz rahe aur kisi bhi device se login ho sakay.</p>
               <div class="flex flex-wrap mt" style="gap:9px">
                 <button class="btn" id="createShopBtn">${icon('sparkle')} Create my shop</button>
                 <button class="btn btn-ghost" id="exitDemoBtn">${icon('logout')} Exit demo</button>
               </div>`
            : `<div class="stat-strip">
                 <div><div class="lbl">Shop code</div><div class="val mono" style="font-size:15px">${esc(shop.code || '—')}</div></div>
                 <div><div class="lbl">Login email</div><div class="val" style="font-size:13px;word-break:break-all">${esc(shop.email || '—')}</div></div>
                 <div><div class="lbl">Cloud data</div><div class="val" style="font-size:13px">${db.products.length} products · ${db.sales.length} sales</div></div>
               </div>
               <div class="field mt">
                 <label>Your shop's login page</label>
                 <div class="flex">
                   <input class="input mono input-sm" id="shopLoginLink" readonly value="${esc(link)}" />
                   <button class="btn btn-ghost btn-sm" id="copyShopLink" type="button">${icon('download')} Copy</button>
                 </div>
                 <span class="hint">Is link ko kisi bhi device par khol kar apne password se login karein. Staff ke saath share bhi kar sakte hain.</span>
               </div>
               <div class="flex flex-wrap mt" style="gap:9px">
                 <button class="btn btn-ghost" id="changePassBtn" type="button">${icon('settings')} Change password</button>
                 <button class="btn btn-ghost" id="logoutBtn" type="button">${icon('logout')} Logout</button>
               </div>
               <div class="divider"></div>
               <div class="flex-between flex-wrap" style="gap:12px">
                 <div>
                   <b class="small">Delete account</b>
                   <div class="hint">Aap ka account, products, sales aur poori shop data cloud se permanently delete ho jayegi.</div>
                 </div>
                 <button class="btn btn-danger btn-sm" id="deleteAccountBtn" type="button">${icon('trash')} Delete account</button>
               </div>`
        }
      </div>
    </div>

    <div class="grid k2 mt">
      <div class="card">
        <div class="card-head"><h3>Shop details</h3><div class="right"><span class="hint">Shown on receipts</span></div></div>
        <div class="card-pad">
          <form id="shopForm">
            <div class="form-grid">
              <div class="field full">
                <label>Shop name</label>
                <input class="input" name="shopName" value="${esc(s.shopName)}" placeholder="My Mart" />
              </div>
              <div class="field">
                <label>Owner name</label>
                <input class="input" name="ownerName" value="${esc(s.ownerName)}" placeholder="Your name" />
              </div>
              <div class="field">
                <label>Phone</label>
                <input class="input" name="phone" value="${esc(s.phone)}" placeholder="03xx-xxxxxxx" />
              </div>
              <div class="field full">
                <label>Address</label>
                <input class="input" name="address" value="${esc(s.address)}" placeholder="Shop address" />
              </div>
              <div class="field full">
                <label>Receipt footer note</label>
                <input class="input" name="receiptNote" value="${esc(s.receiptNote)}" placeholder="Thank you!" />
              </div>
            </div>
            <div class="form-actions"><button class="btn" type="submit">${icon('check')} Save shop details</button></div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Billing preferences</h3></div>
        <div class="card-pad">
          <form id="prefForm">
            <div class="form-grid">
              <div class="field">
                <label>Currency symbol</label>
                <input class="input" name="currency" value="${esc(s.currency)}" maxlength="4" placeholder="Rs" />
              </div>
              <div class="field">
                <label>Tax / GST rate (%)</label>
                <input class="input" name="taxRate" type="number" min="0" max="100" step="any" value="${esc(s.taxRate)}" />
              </div>
              <div class="field full">
                <label>Default low-stock alert level</label>
                <input class="input" name="lowStock" type="number" min="0" step="any" value="${esc(s.lowStock)}" />
                <span class="hint">Used for new products. Each product can have its own level.</span>
              </div>
            </div>
            <div class="form-actions"><button class="btn" type="submit">${icon('check')} Save preferences</button></div>
          </form>
        </div>
      </div>
    </div>

    <div class="grid k2 mt">
      <div class="card">
        <div class="card-head"><h3>Backup & restore</h3><div class="right"><span class="badge">${storageSize()}</span></div></div>
        <div class="card-pad">
          <p class="small muted">Your data is saved to your shop account and cached in this browser for offline use. Download a backup now and then — it is a full copy of your shop.</p>
          <div class="flex flex-wrap mt" style="gap:9px">
            <button class="btn" id="exportBackup">${icon('download')} Download backup</button>
            <button class="btn btn-ghost" id="importBackup">${icon('upload')} Restore backup</button>
            <input type="file" id="backupFile" accept="application/json,.json" hidden />
          </div>
          <div class="alert-box mt" style="background:#f0fdfa;border-color:#99f6e4;color:#115e59">
            ${icon('alert')}
            <div>Cloud sync keeps your shop on every device you log in from. A backup file is an extra safety copy you can restore at any time.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Demo & reset</h3></div>
        <div class="card-pad">
          <p class="small muted">Want to try the app with sample products and sales? Load the demo shop. This replaces your current data, so take a backup first.</p>
          <div class="flex flex-wrap mt" style="gap:9px">
            <button class="btn btn-ghost" id="loadDemo">${icon('sparkle')} Load demo data</button>
            <button class="btn btn-danger" id="clearData">${icon('trash')} Clear all data</button>
          </div>
          <div class="divider"></div>
          <div class="flex-between small">
            <span class="muted">Products</span><strong>${db.products.length}</strong>
          </div>
          <div class="flex-between small mt-sm">
            <span class="muted">Invoices</span><strong>${db.sales.length}</strong>
          </div>
          <div class="flex-between small mt-sm">
            <span class="muted">Customers</span><strong>${db.customers.length}</strong>
          </div>
          <div class="flex-between small mt-sm">
            <span class="muted">Suppliers</span><strong>${db.suppliers.length}</strong>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head"><h3>About mhzaly</h3><div class="right"><span class="badge teal">v${VERSION}</span></div></div>
      <div class="card-pad">
        <p class="small muted" style="max-width:760px">
          mhzaly is a simple online shop manager for marts, kiryana stores and general stores.
          Har shop ka apna login aur alag data hota hai — inventory, POS billing, purchases, customer khata,
          supplier payments, expenses and profit reports, sab ek jagah.
        </p>
        <div class="flex flex-wrap mt" style="gap:8px">
          <span class="badge">Multi-shop accounts</span>
          <span class="badge">POS billing</span>
          <span class="badge">Barcode ready</span>
          <span class="badge">Udhaar khata</span>
          <span class="badge">Purchases</span>
          <span class="badge">Reports</span>
          <span class="badge">Cloud sync</span>
          <span class="badge">Offline + backup</span>
        </div>
      </div>
    </div>`;

  root.querySelector('#shopForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    db.settings.shopName = String(fd.get('shopName') || '').trim() || 'My Mart';
    db.settings.ownerName = String(fd.get('ownerName') || '').trim();
    db.settings.phone = String(fd.get('phone') || '').trim();
    db.settings.address = String(fd.get('address') || '').trim();
    db.settings.receiptNote = String(fd.get('receiptNote') || '').trim();
    save();
    syncShell();
    toast('Shop details saved');
    refresh();
  });

  root.querySelector('#prefForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const tax = Number(fd.get('taxRate'));
    const low = Number(fd.get('lowStock'));
    db.settings.currency = String(fd.get('currency') || 'Rs').trim() || 'Rs';
    db.settings.taxRate = Number.isFinite(tax) && tax >= 0 && tax <= 100 ? tax : 0;
    db.settings.lowStock = Number.isFinite(low) && low >= 0 ? low : 5;
    save();
    toast('Preferences saved');
    refresh();
  });

  root.querySelector('#exportBackup').addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`mart-manager-backup-${stamp}.json`, exportDb());
    toast('Backup downloaded');
  });

  const fileInput = root.querySelector('#backupFile');
  root.querySelector('#importBackup').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const ok = await confirmDialog({
        title: 'Restore this backup?',
        message: 'Your current data will be replaced by the contents of the backup file.',
        confirmText: 'Restore backup',
        danger: true,
      });
      if (!ok) return;
      importDb(text);
      syncShell();
      toast('Backup restored');
      refresh();
    } catch (err) {
      toast(err.message || 'Could not read this backup file', 'error');
    } finally {
      fileInput.value = '';
    }
  });

  root.querySelector('#loadDemo').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Load demo data?',
      message: 'This will replace all current products, sales and customers with sample demo data.',
      confirmText: 'Load demo data',
      danger: true,
    });
    if (!ok) return;
    loadSampleData();
    syncShell();
    toast('Demo shop loaded');
    refresh();
  });

  root.querySelector('#clearData').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Clear all data?',
      message: 'Every product, sale, customer, supplier and expense will be permanently deleted from this browser. Download a backup first if you need it.',
      confirmText: 'Yes, delete everything',
      danger: true,
    });
    if (!ok) return;
    clearAll();
    syncShell();
    toast('All data cleared');
    refresh();
  });

  /* ---------- account actions ---------- */

  root.querySelector('#copyShopLink')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(link).then(
      () => toast('Login link copied'),
      () => toast('Copy nahi ho saka', 'error')
    );
  });

  root.querySelector('#changePassBtn')?.addEventListener('click', openChangePasswordModal);

  root.querySelector('#logoutBtn')?.addEventListener('click', () => {
    clearSession();
    window.location.href = shop.code ? `${location.pathname}?shop=${encodeURIComponent(shop.code)}` : location.pathname;
  });

  root.querySelector('#createShopBtn')?.addEventListener('click', () => {
    clearSession();
    window.location.href = location.pathname + '#/register';
  });

  root.querySelector('#exitDemoBtn')?.addEventListener('click', () => {
    clearSession();
    window.location.href = location.pathname;
  });

  root.querySelector('#deleteAccountBtn')?.addEventListener('click', async () => {
    const first = await confirmDialog({
      title: 'Delete this shop account?',
      message: 'Your account and ALL shop data (products, sales, customers, purchases, expenses) will be permanently deleted from the cloud. This cannot be undone. Download a backup first!',
      confirmText: 'Continue',
      danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'Are you absolutely sure?',
      message: 'Yeh action wapas nahi ho sakta. Aap ka shop account hamesha ke liye delete ho jayega.',
      confirmText: 'Yes, delete my account',
      danger: true,
    });
    if (!second) return;
    try {
      await deleteAccount();
      clearSession();
      toast('Account deleted');
      setTimeout(() => { window.location.href = location.pathname; }, 700);
    } catch (err) {
      toast(err.message || 'Account delete nahi ho saka', 'error');
    }
  });
}
