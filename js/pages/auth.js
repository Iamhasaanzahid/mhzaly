/* ============================================================
   mhzaly — login / create shop
   ============================================================ */

import {
  login, register, publicShop, setDemo, clearSession, flushNow,
} from '../api.js';
import { configureShop, hydrate, seedCommonProducts, loadSampleData, exportDb } from '../db.js';
import { icon, esc, toast } from '../ui.js';

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
}

function goToApp() {
  history.replaceState(null, '', location.pathname + '#/dashboard');
  location.reload();
}

function showError(message) {
  const box = document.querySelector('#authError');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `${icon('alert')}<span>${esc(message)}</span>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() {
  const box = document.querySelector('#authError');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
}

export function render(root, { mode = 'login', shopCode = '' } = {}) {
  const isRegister = mode === 'register';
  root.innerHTML = `
    <div class="auth">
      <section class="auth-side">
        <div class="auth-logo">
          <span class="brand-logo">${icon('bag')}</span>
          <span>mhzaly</span>
        </div>
        <div class="auth-pitch">
          <span class="auth-eyebrow">Mart &amp; shop management</span>
          <h1>Your whole shop,<br /><em>in one place.</em></h1>
          <p>Billing, stock, udhaar khata, purchases aur profit — itna simple ke har shopkeeper use kar sakay.</p>
          <ul class="auth-points">
            <li>${icon('check')}<div><b>Fast POS billing</b><span>Barcode, cash, card and udhaar</span></div></li>
            <li>${icon('check')}<div><b>Inventory that stays right</b><span>Stock, low-stock alerts and purchases</span></div></li>
            <li>${icon('check')}<div><b>Har shop ka apna account</b><span>Alag login, alag data — cloud mein safe</span></div></li>
            <li>${icon('check')}<div><b>Works on any device</b><span>Shop PC, laptop or mobile — same data</span></div></li>
          </ul>
        </div>
        <div class="auth-side-foot">Cloud synced · Offline ready · No setup cost</div>
      </section>

      <section class="auth-main">
        <div class="auth-card">
          <div class="auth-card-top">
            <div class="brand-logo">${icon('bag')}</div>
            <div>
              <h2 id="authTitle">${isRegister ? 'Create your shop' : 'Welcome back'}</h2>
              <p id="authSub">${isRegister ? 'Free account — start in a minute' : 'Login to your shop'}</p>
            </div>
          </div>

          <div id="shopBrand" class="shop-brand" hidden></div>

          <div class="auth-tabs">
            <button type="button" data-mode="login" class="${isRegister ? '' : 'active'}">Login</button>
            <button type="button" data-mode="register" class="${isRegister ? 'active' : ''}">Create a shop</button>
          </div>

          <div id="authError" class="auth-error" hidden></div>

          <form id="loginForm" ${isRegister ? 'hidden' : ''} autocomplete="on">
            <div class="field">
              <label>Shop code or email</label>
              <input class="input" name="identifier" id="loginIdentifier" required placeholder="e.g. al-madina or you@email.com" value="${esc(shopCode)}" autocomplete="username" />
            </div>
            <div class="field" style="margin-top:12px">
              <label>Password</label>
              <input class="input" name="password" type="password" required minlength="6" placeholder="Your password" autocomplete="current-password" />
            </div>
            <button class="btn btn-lg btn-block" style="margin-top:16px" id="loginBtn" type="submit">Login</button>
          </form>

          <form id="registerForm" ${isRegister ? '' : 'hidden'} autocomplete="on">
            <div class="form-grid">
              <div class="field full">
                <label>Shop name *</label>
                <input class="input" name="shopName" id="shopName" required placeholder="e.g. Al-Madina Mart" maxlength="60" />
              </div>
              <div class="field">
                <label>Your name</label>
                <input class="input" name="ownerName" placeholder="e.g. Ahmed" maxlength="50" />
              </div>
              <div class="field">
                <label>Email *</label>
                <input class="input" name="email" type="email" required placeholder="you@email.com" autocomplete="email" />
              </div>
              <div class="field">
                <label>Shop code</label>
                <input class="input" name="shopCode" id="shopCodeInput" placeholder="al-madina" pattern="[a-z0-9-]{3,30}" />
                <span class="hint">Aap ka login page: /?shop=your-code</span>
              </div>
              <div class="field">
                <label>Password *</label>
                <input class="input" name="password" type="password" required minlength="6" placeholder="At least 6 characters" autocomplete="new-password" />
              </div>
            </div>
            <button class="btn btn-lg btn-block" style="margin-top:16px" id="registerBtn" type="submit">Create shop account</button>
            <p class="auth-legal" style="text-align:left;margin-top:10px">Common grocery products (rice, oil, milk, tea…) will be added automatically. Aap baad mein apni items bhi add kar sakte hain.</p>
          </form>

          <div class="auth-or"><span>or</span></div>
          <button type="button" class="auth-demo" id="demoBtn">${icon('sparkle')} Try a demo shop — no account needed</button>

          <p class="auth-legal">Secure login · Aap ka data sirf aap ke shop account ke saath cloud mein save hota hai.</p>
        </div>
        <div class="auth-bottom-note">mhzaly · Mart &amp; shop manager for every dukaan</div>
      </section>
    </div>`;

  const loginForm = root.querySelector('#loginForm');
  const registerForm = root.querySelector('#registerForm');
  const loginBtn = root.querySelector('#loginBtn');
  const registerBtn = root.querySelector('#registerBtn');
  const title = root.querySelector('#authTitle');
  const sub = root.querySelector('#authSub');

  function setMode(next) {
    const reg = next === 'register';
    loginForm.hidden = reg;
    registerForm.hidden = !reg;
    title.textContent = reg ? 'Create your shop' : 'Welcome back';
    sub.textContent = reg ? 'Free account — start in a minute' : 'Login to your shop';
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === next));
    history.replaceState(null, '', location.pathname + location.search + `#/${next}`);
    clearError();
  }

  root.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );

  // auto-suggest shop code from the shop name
  const shopName = root.querySelector('#shopName');
  const codeInput = root.querySelector('#shopCodeInput');
  let codeTouched = false;
  codeInput.addEventListener('input', () => { codeTouched = true; });
  shopName.addEventListener('input', () => {
    if (!codeTouched) codeInput.value = slugify(shopName.value);
  });

  // branded login page: /?shop=al-madina
  if (shopCode) {
    publicShop(shopCode)
      .then(({ shop }) => {
        const el = root.querySelector('#shopBrand');
        el.hidden = false;
        el.innerHTML = `<div class="brand-logo">${icon('bag')}</div><div><b>${esc(shop.name)}</b><span>Shop code: ${esc(shop.code)}</span></div>`;
        document.title = `${shop.name} · Login | mhzaly`;
      })
      .catch(() => {
        showError('Is shop code ka koi account nahi mila. Aap email se login kar sakte hain.');
      });
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const fd = new FormData(loginForm);
    const identifier = String(fd.get('identifier') || '').trim();
    const password = String(fd.get('password') || '');
    if (!identifier || !password) return showError('Email/shop code aur password likhein');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in…';
    try {
      const res = await login(identifier, password);
      configureShop({ shopId: res.shop.id });
      hydrate(res.data);
      goToApp();
    } catch (err) {
      showError(err.message || 'Login nahi ho saka');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const fd = new FormData(registerForm);
    const shopNameVal = String(fd.get('shopName') || '').trim();
    const ownerName = String(fd.get('ownerName') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const shopCodeVal = String(fd.get('shopCode') || '').trim().toLowerCase();

    if (shopNameVal.length < 2) return showError('Shop ka naam likhein');
    if (password.length < 6) return showError('Password kam az kam 6 characters ka hona chahiye');
    if (shopCodeVal && !/^[a-z0-9-]{3,30}$/.test(shopCodeVal)) {
      return showError('Shop code mein sirf a–z, 0–9 aur dash use karein');
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Creating your shop…';
    try {
      const res = await register({
        shopName: shopNameVal,
        ownerName,
        email,
        password,
        shopCode: shopCodeVal || undefined,
      });
      configureShop({ shopId: res.shop.id });
      hydrate(res.data);
      const added = seedCommonProducts();
      try {
        await flushNow(exportDb());
      } catch {
        /* will sync on the next change */
      }
      sessionStorage.setItem('mhzaly_welcome', String(added));
      goToApp();
    } catch (err) {
      showError(err.message || 'Account nahi ban saka');
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create shop account';
    }
  });

  root.querySelector('#demoBtn').addEventListener('click', () => {
    clearSession();
    setDemo(true);
    configureShop({ demo: true });
    loadSampleData();
    history.replaceState(null, '', location.pathname + '#/dashboard');
    location.reload();
  });

  const first = isRegister ? shopName : root.querySelector('#loginIdentifier');
  setTimeout(() => first?.focus(), 80);
}
