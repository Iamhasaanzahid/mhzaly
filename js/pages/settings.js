/* ============================================================
   mhzaly — Settings & data management
   ============================================================ */

import { db, save, exportDb, importDb, clearAll, loadSampleData, SHOP_TYPES } from '../db.js';
import { icon, esc, toast, confirmDialog, downloadFile, linkLabels } from '../ui.js';
import { getThemeChoice, setThemeChoice } from '../theme.js';
import { printReceipt } from '../receipt-share.js';
import { TAX_SYSTEMS, taxSystem } from '../tax.js';

export const meta = { title: 'Settings', subtitle: 'Shop details, backup and preferences' };

const VERSION = '2.3.0';

function syncShell() {
  const shop = db.settings.shopName || 'My Mart';
  const brandSub = document.querySelector('.brand-sub');
  if (brandSub) brandSub.textContent = shop;
  const who = document.querySelector('.sidebar-foot .who');
  if (who) who.textContent = db.settings.ownerName || 'Shop Owner';
  const brandLogo = document.querySelector('.brand-logo');
  if (brandLogo) {
    brandLogo.innerHTML = db.settings.logo
      ? `<img src="${esc(db.settings.logo)}" alt="" />`
      : icon('bag');
  }
}

function sampleSale() {
  return {
    invoiceNo: 'PREVIEW-001',
    createdAt: new Date().toISOString(),
    customerName: 'Walk-in',
    items: [
      { name: 'Sample item A', qty: 2, price: 120 },
      { name: 'Sample item B', qty: 1, price: 250 },
    ],
    subtotal: 490,
    discount: 0,
    tax: 0,
    total: 490,
    paymentMethod: 'Cash',
  };
}

export function render(root) {
  const s = db.settings;
  const shop = s.shopName || 'My Mart';
  let logoData = s.logo || '';

  root.innerHTML = `
    <div class="page-head">
      <div class="grow">
        <h2>Settings</h2>
        <p>Manage your shop details, billing, data and security.</p>
      </div>
    </div>

    <div class="grid k2 mt">
      <div class="card">
        <div class="card-head"><h3>Shop details</h3><div class="right"><span class="hint">Shown on receipts</span></div></div>
        <div class="card-pad">
          <div class="logo-upload">
            <div class="logo-preview" id="logoPreview">${logoData ? `<img src="${esc(logoData)}" alt="" />` : icon('bag')}</div>
            <div class="grow">
              <div class="logo-actions">
                <label class="btn btn-ghost btn-sm" for="logoFile">${icon('upload')} Upload logo</label>
                <button class="btn btn-ghost btn-sm" type="button" id="logoRemove">Remove</button>
              </div>
              <span class="hint">PNG/JPG, max 2MB. Logo receipt aur sidebar par show hoga. Save shop details dabayein.</span>
              <input type="file" id="logoFile" accept="image/*" hidden />
            </div>
          </div>
          <form id="shopForm">
            <div class="form-grid">
              <div class="field full">
                <label>Shop name</label>
                <input class="input" name="shopName" value="${esc(s.shopName)}" placeholder="My Mart" />
              </div>
              <div class="field full">
                <label>Shop category</label>
                <select class="input" name="shopType">
                  ${SHOP_TYPES.map((type) => `<option value="${type.id}" ${type.id === (s.shopType || 'mart') ? 'selected' : ''}>${esc(type.label)}</option>`).join('')}
                </select>
                <span class="hint">Category sirf label badalti hai — existing products wohi rahenge.</span>
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
              <div class="field full">
                <label>Receipt terms / policy (optional)</label>
                <textarea class="input" name="receiptTerms" rows="2" placeholder="e.g. Exchange within 7 days with receipt.">${esc(s.receiptTerms || '')}</textarea>
              </div>
            </div>
            <div class="alert-box mt" style="background:#f8fafc;border-color:#e2e8f0;color:#334155">
              ${icon('alert')}
              <div><b>Current Plan:</b> ${esc(db.settings._planLabel || '—')}</div>
              <div><b>Status:</b> ${esc(db.settings._billingStatus || '—')}</div>
              <div><b>Days Left:</b> ${esc(db.settings._daysLeft == null ? 'Lifetime' : db.settings._daysLeft + ' din')}</div>
            </div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')} Save shop details</button></div>
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
              <div class="field full">
                <label>Default low-stock alert level</label>
                <input class="input" name="lowStock" type="number" min="0" step="any" value="${esc(s.lowStock)}" />
                <span class="hint">Used for new products. Each product can have its own level.</span>
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn-ghost" type="button" id="previewReceipt">${icon('eye')} Receipt preview</button>
              <button class="btn btn-primary" type="submit">${icon('check')} Save preferences</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head">
        <h3>Tax &amp; compliance</h3>
        <div class="right"><span class="badge teal" id="taxCountryBadge">${esc(taxSystem(s.taxCountry || 'PK').countryName)}</span></div>
      </div>
      <div class="card-pad">
        <p class="small muted" style="margin-top:0">Receipt par seller aur buyer ka tax number, tax rate aur QR code show hota hai. Pakistan default hai — apna NTN/STRN likhein.</p>
        <form id="taxForm">
          <div class="form-grid">
            <div class="field">
              <label>Country / tax system</label>
              <select class="input" name="taxCountry" id="taxCountry">
                ${TAX_SYSTEMS.map((t) => `<option value="${t.country}" ${t.country === (s.taxCountry || 'PK') ? 'selected' : ''}>${esc(t.countryName)} — ${esc(t.system)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Tax name</label>
              <input class="input" name="taxSystem" id="taxSystem" value="${esc(s.taxSystem || 'GST')}" placeholder="GST / VAT / Sales Tax" />
            </div>
            <div class="field">
              <label id="taxNumberLabel">${esc(taxSystem(s.taxCountry || 'PK').numberLabel)}</label>
              <input class="input" name="taxNumber" id="taxNumber" value="${esc(s.taxNumber || '')}" placeholder="${esc(taxSystem(s.taxCountry || 'PK').example || 'Tax number')}" />
            </div>
            <div class="field">
              <label>Default tax rate (%)</label>
              <div class="input-group">
                <input class="input" name="taxRate" id="taxRate" type="number" min="0" max="100" step="any" value="${esc(s.taxRate)}" />
                <button class="btn btn-ghost btn-sm" type="button" id="useRecommendedTax">Use ${esc(taxSystem(s.taxCountry || 'PK').rate)}%</button>
              </div>
            </div>
            <div class="field full">
              <label class="check-inline"><input type="checkbox" name="receiptQr" ${s.receiptQr !== false ? 'checked' : ''} /> Receipt par tax QR code show karein</label>
              <span class="hint">QR offline generate hota hai — internet ki zaroorat nahi. Scan karne par invoice, tax numbers aur total nazar aayega.</span>
            </div>
          </div>
          <div class="alert-box mt" id="taxHint" style="background:#f0fdfa;border-color:#99f6e4;color:#115e59">
            ${icon('alert')}
            <div>${esc(taxSystem(s.taxCountry || 'PK').hint)}</div>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')} Save tax settings</button></div>
        </form>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head"><h3>Appearance</h3><div class="right"><span class="hint">Light, dark ya device ke mutabiq</span></div></div>
      <div class="card-pad">
        <div class="theme-choices" id="themeChoices">
          <button class="theme-choice ${getThemeChoice() === 'light' ? 'active' : ''}" type="button" data-theme-choice="light">
            ${icon('sun')}<b>Light</b><span>Din wali bright look</span>
          </button>
          <button class="theme-choice ${getThemeChoice() === 'dark' ? 'active' : ''}" type="button" data-theme-choice="dark">
            ${icon('moon')}<b>Dark</b><span>Raat wali soft look</span>
          </button>
          <button class="theme-choice ${getThemeChoice() === 'system' ? 'active' : ''}" type="button" data-theme-choice="system">
            ${icon('settings')}<b>System</b><span>Device ke theme ke mutabiq</span>
          </button>
        </div>
        <p class="small muted mt-sm" style="margin-bottom:0">Login page hamesha waisa hi rehta hai — ye choice sirf app ke andar lagti hai.</p>
      </div>
    </div>

    <div class="grid k2 mt">
      <div class="card">
        <div class="card-head"><h3>Backup & restore</h3><div class="right"><span class="badge">${storageSize()}</span></div></div>
        <div class="card-pad">
          <p class="small muted">Your data is saved to your shop account and cached in this browser for offline use. Download a backup now and then — it is a full copy of your shop.</p>
          <div class="flex flex-wrap mt" style="gap:9px">
            <button class="btn btn-primary" id="exportBackup">${icon('download')} Download backup</button>
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
          mhzaly is a simple online shop manager for marts, mobile shops, pharmacies, clothing stores,
          electronics, hardware and general stores. Har shop ka apna login aur alag data hota hai —
          inventory, POS billing, purchases, customer khata, supplier payments, expenses and profit reports, sab ek jagah.
        </p>
        <div class="flex flex-wrap mt" style="gap:8px">
          <span class="badge">Multi-shop accounts</span>
          <span class="badge">POS billing</span>
          <span class="badge">Barcode ready</span>
          <span class="badge">Returns & refunds</span>
          <span class="badge">Hold bills</span>
          <span class="badge">Udhaar khata</span>
          <span class="badge">Customer statements</span>
          <span class="badge">CSV import / export</span>
          <span class="badge">Receipt logo & tax</span>
          <span class="badge">Purchases</span>
          <span class="badge">Reports</span>
          <span class="badge">Cloud sync</span>
          <span class="badge">Offline + backup</span>
        </div>
      </div>
    </div>`;

  syncShell();
  const rerender = () => { render(root); linkLabels(root); };

  function updateLogoPreview() {
    const el = root.querySelector('#logoPreview');
    if (!el) return;
    el.innerHTML = logoData ? `<img src="${esc(logoData)}" alt="" />` : icon('bag');
  }

  root.querySelector('#logoFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast('Sirf image file choose karein', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('Logo 2MB se chhota hona chahiye', 'error');
      return;
    }
    try {
      logoData = await resizeImage(file, 240);
      updateLogoPreview();
      toast('Logo ready — Save shop details dabayein', 'success');
    } catch (err) {
      toast(err.message || 'Logo load nahi ho saka', 'error');
    }
  });

  root.querySelector('#logoRemove').addEventListener('click', () => {
    logoData = '';
    updateLogoPreview();
    toast('Logo remove hoga — Save shop details dabayein');
  });

  root.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const choice = btn.dataset.themeChoice;
      setThemeChoice(choice);
      root.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.toggle('active', b === btn));
      toast(choice === 'system' ? 'Theme: device ke mutabiq' : `Theme: ${choice === 'dark' ? 'Dark' : 'Light'} mode`, 'success');
    });
  });

  root.querySelector('#shopForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    db.settings.shopName = String(fd.get('shopName') || '').trim() || 'My Mart';
    db.settings.shopType = String(fd.get('shopType') || 'mart');
    db.settings.ownerName = String(fd.get('ownerName') || '').trim();
    db.settings.phone = String(fd.get('phone') || '').trim();
    db.settings.address = String(fd.get('address') || '').trim();
    db.settings.receiptNote = String(fd.get('receiptNote') || '').trim();
    db.settings.receiptTerms = String(fd.get('receiptTerms') || '').trim();
    db.settings.logo = logoData;
    save();
    syncShell();
    toast('Shop details saved');
    rerender();
  });

  root.querySelector('#prefForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const low = Number(fd.get('lowStock'));
    db.settings.currency = String(fd.get('currency') || 'Rs').trim() || 'Rs';
    db.settings.lowStock = Number.isFinite(low) && low >= 0 ? low : 5;
    save();
    toast('Preferences saved');
    rerender();
  });

  root.querySelector('#taxCountry').addEventListener('change', (e) => {
    const t = taxSystem(e.target.value);
    root.querySelector('#taxSystem').value = t.system;
    root.querySelector('#taxNumberLabel').textContent = t.numberLabel;
    root.querySelector('#taxCountryBadge').textContent = t.countryName;
    root.querySelector('#taxHint').innerHTML = `${icon('alert')}<div>${esc(t.hint)}</div>`;
    root.querySelector('#taxNumber').placeholder = t.example || 'Tax number';
    root.querySelector('#useRecommendedTax').textContent = `Use ${t.rate}%`;
  });

  root.querySelector('#useRecommendedTax').addEventListener('click', () => {
    const t = taxSystem(root.querySelector('#taxCountry').value);
    root.querySelector('#taxRate').value = t.rate;
    toast(`Recommended ${t.system} rate: ${t.rate}%`, 'success');
  });

  root.querySelector('#taxForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rate = Number(fd.get('taxRate'));
    db.settings.taxCountry = String(fd.get('taxCountry') || 'PK');
    db.settings.taxSystem = String(fd.get('taxSystem') || '').trim() || taxSystem(db.settings.taxCountry).system;
    db.settings.taxNumber = String(fd.get('taxNumber') || '').trim();
    db.settings.taxRate = Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0;
    db.settings.receiptQr = fd.get('receiptQr') === 'on';
    save();
    toast('Tax settings saved');
    rerender();
  });

  root.querySelector('#previewReceipt').addEventListener('click', () => {
    const latest = db.sales[db.sales.length - 1];
    printReceipt(latest || sampleSale());
  });

  root.querySelector('#exportBackup').addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadFile(`mhzaly-backup-${shop}-${stamp}.json`, exportDb());
    toast('Backup downloaded');
  });

  root.querySelector('#importBackup').addEventListener('click', () => {
    root.querySelector('#backupFile').click();
  });

  root.querySelector('#backupFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        importDb(ev.target.result);
        toast('Backup restored');
        rerender();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    reader.readAsText(file);
  });

  root.querySelector('#loadDemo').addEventListener('click', () => {
    confirmDialog('Sample products load kiye jayenge (mojooda data safe rahega). Pehle backup le lein.', () => {
      loadSampleData();
      toast('Sample products loaded');
      rerender();
    });
  });

  root.querySelector('#clearData').addEventListener('click', () => {
    confirmDialog('Poori data delete ho jayegi — ye step undo nahi kiya ja sakta. Backup zaroor le lein.', () => {
      clearAll();
      toast('All data cleared');
      rerender();
    });
  });
}

function resizeImage(file, maxSize = 240) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas support nahi hai'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Image load nahi ho saki'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('File read nahi ho saki'));
    reader.readAsDataURL(file);
  });
}

function storageSize() {
  try {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mhzaly_db')) {
        bytes += new Blob([localStorage.getItem(key) || '']).size;
      }
    }
    return (bytes / 1024).toFixed(1) + ' KB';
  } catch { return '0 KB'; }
}

function refresh() {
  if (typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('settings:changed'));
  }
}

export { syncShell, refresh };
