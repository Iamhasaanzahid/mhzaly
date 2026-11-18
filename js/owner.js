/* ============================================================
   mhzaly — owner panel (subscriptions & shops)
   ============================================================ */

const API_BASE = 'https://mhzaly-api.mhzaly.workers.dev';
const TOKEN_KEY = 'mhzaly_owner_token';
const app = document.getElementById('ownerApp');

const PLAN_DAYS = { trial: 1, monthly: 30, quarterly: 90, annual: 365, lifetime: null };
const PLAN_LABELS = {
  trial: 'Trial',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  lifetime: 'Lifetime',
};

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  owner: null,
  shops: [],
  stats: {},
  view: 'shops',          // 'shops' | 'referral'
  refTab: 'signups',      // signups | shops | quotes | prices | automaton | payments
  referral: null,
  filter: 'all',
  search: '',
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Internet connection nahi hai — please check your network', 0);
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

let toastTimer = null;
function toast(message, type = '') {
  let el = document.querySelector('.owner-toast');
  if (!el) {
    el = document.createElement('div');
    document.body.appendChild(el);
  }
  el.className = `owner-toast ${type}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

/* ---------------- login ---------------- */

function showLogin(message = '') {
  app.innerHTML = `
    <div class="owner-login">
      <div class="owner-login-card">
        <div class="owner-login-logo">m</div>
        <h1>Owner Panel</h1>
        <p>Sirf mhzaly owner ke liye. Shops, subscriptions aur payments manage karein.</p>
        <form id="ownerLoginForm">
          <label>Email</label>
          <input name="email" type="email" required autocomplete="off" spellcheck="false" />
          <label>Password</label>
          <input name="password" type="password" required autocomplete="current-password" />
          <button type="submit">Login</button>
        </form>
        <div id="ownerLoginError" class="owner-error" ${message ? '' : 'hidden'}>${esc(message)}</div>
        <div class="owner-login-note">mhzaly owner panel · private</div>
      </div>
    </div>`;

  const form = app.querySelector('#ownerLoginForm');
  const err = app.querySelector('#ownerLoginError');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      const data = await api('/api/owner/login', { method: 'POST', body: { email, password } });
      state.token = data.token;
      state.owner = data.owner;
      localStorage.setItem(TOKEN_KEY, data.token);
      await refresh();
    } catch (e2) {
      err.hidden = false;
      err.textContent = e2.message;
      btn.disabled = false;
      btn.textContent = 'Login';
    }
  });
}

/* ---------------- dashboard ---------------- */

async function refresh() {
  if (!state.token) return showLogin();
  try {
    const data = await api('/api/owner/overview');
    state.shops = data.shops || [];
    state.stats = data.stats || {};
    renderDashboard();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showLogin('Session expire ho gaya — dobara login karein.');
      return;
    }
    toast(err.message, 'error');
  }
}

const FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['trial', 'Trial'],
  ['active', 'Active'],
  ['expired', 'Expired'],
  ['blocked', 'Blocked'],
];

function statCard(label, value, cls = '') {
  return `<div class="stat-card ${cls}"><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`;
}

function tabsHTML() {
  return FILTERS.map(
    ([id, label]) =>
      `<button class="owner-tab ${state.filter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`
  ).join('');
}

function statusBadge(shop) {
  if (shop.status === 'pending') return '<span class="badge warn">Pending</span>';
  if (shop.billingStatus === 'blocked') return '<span class="badge danger">Blocked</span>';
  if (shop.billingStatus === 'expired') return '<span class="badge danger">Expired</span>';
  if (shop.billingStatus === 'trial') return '<span class="badge warn">Trial</span>';
  return '<span class="badge ok">Active</span>';
}

function endCell(shop) {
  if (shop.plan === 'lifetime') return '<span class="shop-sub">Never</span>';
  if (!shop.subscriptionEnd) return '<span class="shop-sub">—</span>';
  const left = shop.daysLeft == null ? '' : `${shop.daysLeft} din left`;
  return `<div>${esc(fmtDate(shop.subscriptionEnd))}</div><div class="shop-sub">${esc(left)}</div>`;
}

function filteredShops() {
  const q = state.search.trim().toLowerCase();
  return state.shops.filter((s) => {
    if (state.filter === 'pending' && s.status !== 'pending') return false;
    if (state.filter === 'trial' && !(s.status === 'active' && s.billingStatus === 'trial')) return false;
    if (state.filter === 'active' && !(s.status === 'active' && s.billingStatus === 'active')) return false;
    if (state.filter === 'expired' && s.billingStatus !== 'expired') return false;
    if (state.filter === 'blocked' && s.billingStatus !== 'blocked') return false;
    if (q && !`${s.name} ${s.code} ${s.phone} ${s.email}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderTable() {
  const body = app.querySelector('#ownerTableBody');
  if (!body) return;
  const shops = filteredShops();
  if (!shops.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="owner-empty">Koi shop nahi mili.</div></td></tr>';
    return;
  }
  body.innerHTML = shops
    .map(
      (s) => `<tr>
        <td>
          <div class="shop-name">${esc(s.name)}</div>
          <div class="shop-sub mono">${esc(s.code)}</div>
        </td>
        <td><span class="badge neutral">${esc(s.shopTypeLabel)}</span></td>
        <td>
          <div class="shop-contact">${esc(s.phone || '—')}</div>
          <div class="shop-sub">${esc(s.email || '')}</div>
        </td>
        <td><span class="badge teal">${esc(s.planLabel)}</span></td>
        <td>${statusBadge(s)}</td>
        <td>${endCell(s)}</td>
        <td style="text-align:right"><button class="owner-btn sm" data-manage="${esc(s.id)}">Manage</button></td>
      </tr>`
    )
    .join('');
}

function renderDashboard() {
  if (state.view === 'referral') return renderReferralDashboard();
  if (state.view === 'agent') return renderAgent();

  const s = state.stats || {};
  app.innerHTML = `
    <div class="owner-shell">
      <header class="owner-topbar">
        <div class="owner-brand">
          <div class="mark">m</div>
          <div><b>mhzaly</b><span>Owner Panel</span></div>
        </div>
        <div class="owner-actions">
          <span class="owner-email">${esc(state.owner?.email || 'Owner')}</span>
          <button class="owner-btn ghost" data-action="referral">Referral</button>
          <button class="owner-btn ghost" data-action="agent">AI Agent</button>
          <button class="owner-btn ghost" data-action="refresh">Refresh</button>
          <button class="owner-btn ghost" data-action="password">Change password</button>
          <button class="owner-btn danger" data-action="logout">Logout</button>
        </div>
      </header>

      <main class="owner-main">
        <div class="owner-stats">
          ${statCard('Total shops', s.total || 0, 'teal')}
          ${statCard('Active', s.active || 0, 'ok')}
          ${statCard('Trial', s.trial || 0, 'warn')}
          ${statCard('Expired', s.expired || 0, 'danger')}
          ${statCard('Blocked', s.blocked || 0, 'danger')}
          ${statCard('Pending', s.pending || 0, 'warn')}
          ${statCard('This month revenue', `Rs ${fmtMoney(s.revenueThisMonth || 0)}`, 'wide')}
        </div>

        <div class="owner-toolbar">
          <div class="owner-search">
            <input id="ownerSearch" placeholder="Search shop, phone, code..." value="${esc(state.search)}" />
          </div>
          <div class="owner-tabs">${tabsHTML()}</div>
        </div>

        <div class="owner-card">
          <div class="owner-table-wrap">
            <table class="owner-table">
              <thead>
                <tr>
                  <th>Shop</th><th>Category</th><th>Contact</th><th>Plan</th>
                  <th>Status</th><th>Ends</th><th></th>
                </tr>
              </thead>
              <tbody id="ownerTableBody"></tbody>
            </table>
          </div>
        </div>
      </main>
    </div>`;

  app.querySelector('[data-action="referral"]').addEventListener('click', () => {
    state.view = 'referral';
    renderReferralDashboard();
  });
  app.querySelector('[data-action="agent"]').addEventListener('click', () => {
    state.view = 'agent';
    renderAgent();
  });
  app.querySelector('[data-action="refresh"]').addEventListener('click', () => refresh());
  app.querySelector('[data-action="password"]').addEventListener('click', openPassword);
  app.querySelector('[data-action="logout"]').addEventListener('click', () => {
    state.token = '';
    state.owner = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  app.querySelector('#ownerSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderTable();
  });

  app.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      app.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === btn));
      renderTable();
    });
  });

  app.querySelector('#ownerTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-manage]');
    if (btn) openManage(btn.dataset.manage);
  });

  renderTable();
}

/* ---------------- AI agent: payment checker ---------------- */

let agentMessages = [];

/* ---- Ollama brain (real local model; rule-based fallback) ---- */
const BRAIN_KEY = 'mhzaly_agent_brain';
let brainState = { checked: false, endpoint: '', model: '', models: [], error: '', enabled: true };
let brainBusy = false;

function brainConfig() {
  try { return JSON.parse(localStorage.getItem(BRAIN_KEY) || '{}'); } catch { return {}; }
}

function brainSave(patch) {
  const next = { ...brainConfig(), ...patch };
  try { localStorage.setItem(BRAIN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

async function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function brainProbe(force = false) {
  if (brainState.checked && !force) return brainState;
  const cfg = brainConfig();
  const candidates = [cfg.endpoint, 'http://localhost:11435', 'http://localhost:11434', 'http://127.0.0.1:11434', 'http://localhost:1234/v1']
    .filter(Boolean)
    .map((u) => String(u).replace(/\/+$/, ''))
    .filter((u, i, arr) => arr.indexOf(u) === i);

  brainState = { checked: true, endpoint: '', model: cfg.model || '', models: [], error: '', enabled: cfg.enabled !== false };

  for (const base of candidates) {
    try {
      const url = /\/v1$/.test(base) ? `${base}/models` : `${base}/api/tags`;
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 3500);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entries = Array.isArray(data.models)
        ? data.models.map((m) => ({ name: m.name, size: Number(m.size) || 0 }))
        : Array.isArray(data.data)
          ? data.data.map((m) => ({ name: m.id, size: 0 }))
          : [];
      const models = entries
        .filter((e) => e.name)
        .sort((a, b) => (a.size || Number.MAX_SAFE_INTEGER) - (b.size || Number.MAX_SAFE_INTEGER))
        .map((e) => e.name);
      if (!models.length) throw new Error('koi model nahi mila');
      brainState.endpoint = base;
      brainState.models = models;
      brainState.model = models.includes(cfg.model) ? cfg.model : models[0];
      brainState.error = '';
      return brainState;
    } catch (err) {
      brainState.error = `${base}: ${err.message || err}`;
    }
  }
  return brainState;
}

async function brainComplete(messages, { json = false, timeout = 60000 } = {}) {
  if (!brainState.endpoint || !brainState.model) throw new Error('Ollama connected nahi hai');
  const base = brainState.endpoint;
  const isOpenAI = /\/v1$/.test(base);
  const url = isOpenAI ? `${base}/chat/completions` : `${base}/api/chat`;
  const payload = isOpenAI
    ? {
        model: brainState.model,
        messages,
        temperature: 0.1,
        max_tokens: 180,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }
    : {
        model: brainState.model,
        messages,
        stream: false,
        think: false,
        keep_alive: '30m',
        options: { temperature: 0.1, num_predict: 180 },
        ...(json ? { format: 'json' } : {}),
      };
  const res = await fetchWithTimeout(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    timeout
  );
  if (!res.ok) throw new Error(`brain HTTP ${res.status}`);
  const data = await res.json();
  return isOpenAI
    ? String(data.choices?.[0]?.message?.content || '')
    : String(data.message?.content || '');
}

function parseBrainJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* try braces */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

async function brainInterpret(message) {
  const proofs = (state.agent?.proofs || []).map((p, i) => ({
    index: i,
    id: p.id,
    shop: p.shopName,
    amount: p.amount,
    currency: p.currency,
    automaton: p.automatonName || '',
  }));
  const system = `/no_think\nYou are the brain of the mhzaly owner payment agent. Reply with JSON only.
Schema: {"intent":"confirm|deny|wallet|automaton|split|remind|reject|status|question","proofIndex":number|null,"answer":"Roman Urdu answer or empty"}
Rules:
- payment received / haan / mila / aa gayi -> confirm
- nahi / nahi mila / not received -> deny
- wallet / address / usdc -> wallet
- automaton / agent kaam kar raha -> automaton
- split / 70 / 30 / share / commission -> split
- reminder / email bhejo -> remind
- reject / fake receipt -> reject
- summary / status / kitna -> status
- anything else -> question
Pending proofs: ${JSON.stringify(proofs)}
Never invent amounts. Answer under 60 words in Roman Urdu.`;

  const content = await brainComplete(
    [
      { role: 'system', content: system },
      { role: 'user', content: message },
    ],
    { json: true, timeout: 25000 }
  );
  return parseBrainJson(content);
}

async function brainAnswer(message) {
  const snap = state.agent || {};
  const data = {
    summary: snap.summary,
    split: snap.split,
    payout: snap.payout,
    proofs: (snap.proofs || []).map((p) => ({
      shop: p.shopName,
      amount: p.amount,
      currency: p.currency,
      channel: p.channelLabel,
      automaton: p.automatonName,
      estimatedCommissionUsd: p.estimatedCommissionUsd,
      wallet: p.walletAddress,
    })),
    payouts: (snap.payouts || []).map((p) => ({
      automaton: p.automatonName,
      amountUsd: p.amountUsd,
      status: p.status,
      wallet: p.walletAddress,
      dueAt: p.dueAt,
    })),
    automatons: snap.automatons,
  };
  const system = `/no_think\nAap mhzaly ke owner ke payment agent hain. Sirf neeche diye DATA se Roman Urdu mein 1-3 line ka jawab dein. Koi amount ya wallet invent mat karein. Agar jawab data mein nahi hai to likhein: "Ye data mere paas nahi hai."
DATA: ${JSON.stringify(data)}`;
  return brainComplete(
    [
      { role: 'system', content: system },
      { role: 'user', content: message },
    ],
    { timeout: 25000 }
  );
}

function brainRenderControls() {
  const sel = app.querySelector('#brainModel');
  const status = app.querySelector('#brainStatus');
  if (!sel || !status) return;
  if (!brainState.models.length) {
    sel.innerHTML = '<option value="">Rule-based</option>';
    status.textContent = brainState.error ? 'Ollama nahi mila — rule-based mode' : 'Ollama check…';
    status.style.color = '#b45309';
    return;
  }
  sel.innerHTML = [
    '<option value="">Rule-based</option>',
    ...brainState.models.map(
      (m) => `<option value="${esc(m)}"${m === brainState.model && brainState.enabled ? ' selected' : ''}>Ollama · ${esc(m)}</option>`
    ),
  ].join('');
  status.textContent = `Ollama connected ✅ (${brainState.endpoint})`;
  status.style.color = '#047857';
}

function agentBubble(m) {
  const mine = m.role === 'owner';
  return `<div style="display:flex;flex-direction:column;align-items:${mine ? 'flex-end' : 'flex-start'}">
    <div style="max-width:92%;padding:10px 13px;border-radius:12px;white-space:pre-wrap;line-height:1.65;font-size:13px;${mine ? 'background:#0f766e;color:#fff' : 'background:#f1f5f9;color:#0f172a;border:1px solid #e2e8f0'}">${esc(m.text)}</div>
    ${m.wallet ? `<div style="margin-top:6px;font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:8px 10px">
      <span>Wallet: <b class="mono">${esc(m.wallet)}</b></span>
      <button class="owner-btn sm" type="button" data-copy-wallet="${esc(m.wallet)}">Copy</button>
    </div>` : ''}
    ${m.brain ? '<div style="margin-top:4px;font-size:10.5px;color:#64748b">🧠 Ollama brain used</div>' : ''}
  </div>`;
}

function agentChatHTML() {
  if (!agentMessages.length) {
    return '<div class="owner-empty">Agent taiyar hai. Neeche "Status" ya "Haan mila" likhein.</div>';
  }
  return agentMessages.map(agentBubble).join('');
}

function agentPendingHTML(snap) {
  const proofs = snap.proofs || [];
  if (!proofs.length) return '<div class="owner-empty" style="padding:12px">Koi pending payment proof nahi ✅</div>';
  return proofs.map((p) => `<div style="padding:10px 0;border-bottom:1px solid #e2e8f0">
    <div style="display:flex;justify-content:space-between;gap:8px">
      <b style="font-size:13px">${esc(p.shopName)}</b>
      <span class="badge warn">pending</span>
    </div>
    <div style="font-size:12.5px;color:#475569;line-height:1.8">
      ${esc(p.amount)} ${esc(p.currency)} · ${esc(p.channelLabel)}<br/>
      ${p.automatonName ? `Automaton: ${esc(p.automatonName)} · ~${usd(p.estimatedCommissionUsd)}` : 'Direct shop'}
    </div>
    <div class="owner-modal-actions" style="justify-content:flex-start">
      <button class="owner-btn primary sm" type="button" data-agent-confirm="${esc(p.id)}">Haan mila</button>
      <button class="owner-btn sm" type="button" data-agent-deny="${esc(p.id)}">Nahi mila</button>
      <button class="owner-btn sm" type="button" data-agent-view="${esc(p.id)}">Receipt</button>
    </div>
  </div>`).join('');
}

function agentWalletsHTML(snap) {
  const wallets = snap.summary?.wallets || [];
  if (!wallets.length) return '<div class="owner-empty" style="padding:12px">Koi USDC pending nahi.</div>';
  return wallets.map((w) => `<div style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:12.5px">
    <div><b>${esc(w.automatonName || 'Automaton')}</b> — ${usd(w.amountUsd)}</div>
    <div class="mono" style="word-break:break-all;color:#475569">${esc(w.walletAddress || 'wallet set nahi')}</div>
    ${w.walletAddress ? `<button class="owner-btn sm" type="button" data-copy-wallet="${esc(w.walletAddress)}">Copy wallet</button>` : ''}
  </div>`).join('');
}

function agentPaint(snap) {
  if (!snap) return;
  state.agent = snap;
  const stats = app.querySelector('#agentStats');
  if (stats) {
    const s = snap.summary || {};
    const share = snap.split?.lifetime || {};
    stats.innerHTML = [
      statCard('Pending proofs', s.pendingProofs || 0, 'warn'),
      statCard('USDC pending', usd(s.unpaidUsd), 'danger'),
      statCard('Aap ka 70%', usd(share.ownerUsd), 'teal'),
      statCard('Automaton 30%', usd(share.automatonUsd), 'warn'),
      statCard('Payout records', s.pendingPayouts || 0, 'warn'),
      statCard('Trials ending', s.expiring || 0, 'warn'),
    ].join('');
  }
  const mode = app.querySelector('#agentPayoutMode');
  if (mode) {
    const p = snap.payout || {};
    const mail = snap.email || {};
    const parts = [
      p.configured ? `Auto USDC payout ON — ${p.provider}` : 'Auto USDC payout MANUAL — provider configure nahi (PAYOUT_PROVIDER)',
      mail.attachments
        ? `Receipt email attachment ON (${mail.provider})`
        : 'Receipt email attachment OFF — RESEND_API_KEY set karein',
    ];
    mode.textContent = parts.join(' · ');
    mode.style.color = p.configured && mail.attachments ? '#047857' : '#b45309';
  }
  const pending = app.querySelector('#agentPending');
  if (pending) pending.innerHTML = agentPendingHTML(snap);
  const wallets = app.querySelector('#agentWallets');
  if (wallets) wallets.innerHTML = agentWalletsHTML(snap);
}

async function renderAgent() {
  let snap;
  try {
    snap = await api('/api/owner/agent/state');
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showLogin('Session expire ho gaya — dobara login karein.');
      return;
    }
    toast(err.message, 'error');
    return;
  }
  state.agent = snap;

  if (!agentMessages.length) {
    const s = snap.summary || {};
    const lines = ['Assalam o alaikum! Main mhzaly ka AI payment agent hoon.'];
    if (s.pendingProofs) {
      lines.push('');
      lines.push(`${s.pendingProofs} payment proof(s) pending hain. Kya paisa aap ko mil gaya?`);
      lines.push('"Haan mila" likhein to main plan activate karke automaton ka USDC wallet address de doonga.');
    } else {
      lines.push('Abhi koi pending payment proof nahi hai. Jab customer receipt bhejega, main yahan pooch loonga.');
    }
    if (s.pendingPayouts) {
      lines.push('');
      lines.push(`US$ ${Number(s.unpaidUsd || 0).toFixed(2)} USDC abhi bhi bhejni hai — "wallet" likh kar address le lein.`);
    }
    agentMessages.push({ role: 'agent', text: lines.join('\n') });
  }

  app.innerHTML = `
    <div class="owner-shell">
      <header class="owner-topbar">
        <div class="owner-brand"><div class="mark">m</div><div><b>mhzaly</b><span>AI Agent · Payment Checker</span></div></div>
        <div class="owner-actions">
          <span class="owner-email">${esc(state.owner?.email || 'Owner')}</span>
          <button class="owner-btn ghost" data-action="agent-remind">Reminder email</button>
          <button class="owner-btn ghost" data-action="agent-refresh">Refresh</button>
          <button class="owner-btn ghost" data-action="view-shops">Back to shops</button>
        </div>
      </header>
      <main class="owner-main">
        <div class="owner-stats" id="agentStats"></div>
        <div style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:16px;align-items:start">
          <div class="owner-card" style="padding:16px;display:flex;flex-direction:column;min-height:540px">
            <h3 class="owner-section-title">Chat</h3>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:12px;color:#475569">
              <span>Brain:</span>
              <select id="brainModel" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px"></select>
              <button class="owner-btn sm" id="brainRefresh" type="button">Reload</button>
              <button class="owner-btn sm" id="brainConfig" type="button">Endpoint</button>
              <span id="brainStatus">checking…</span>
            </div>
            <div id="agentChat" style="flex:1;display:flex;flex-direction:column;gap:10px;overflow:auto;max-height:460px;padding:4px">${agentChatHTML()}</div>
            <div id="agentChips" style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
              <button class="owner-btn sm" type="button" data-agent-chip="status">Status</button>
              <button class="owner-btn sm" type="button" data-agent-chip="haan mila">Haan mila</button>
              <button class="owner-btn sm" type="button" data-agent-chip="nahi mila">Nahi mila</button>
              <button class="owner-btn sm" type="button" data-agent-chip="wallet">Wallet address</button>
              <button class="owner-btn sm" type="button" data-agent-chip="automaton">Automaton check</button>
              <button class="owner-btn sm" type="button" data-agent-chip="split">30/70 split</button>
              <button class="owner-btn sm" type="button" data-agent-chip="plan strategy">Plan strategy</button>
            </div>
            <form id="agentForm" style="display:flex;gap:8px">
              <input id="agentInput" autocomplete="off" placeholder="Haan mila / Nahi mila / wallet / status..." style="flex:1;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px" />
              <button class="owner-btn primary" type="submit">Send</button>
            </form>
          </div>
          <div>
            <div class="owner-card" style="padding:16px">
              <h3 class="owner-section-title">Pending checks</h3>
              <div id="agentPayoutMode" class="hint" style="margin-bottom:8px"></div>
              <div id="agentPending"></div>
            </div>
            <div class="owner-card" style="padding:16px;margin-top:14px">
              <h3 class="owner-section-title">Automaton wallets</h3>
              <div id="agentWallets"></div>
            </div>
          </div>
        </div>
      </main>
    </div>`;

  app.querySelector('[data-action="agent-refresh"]').addEventListener('click', () => renderAgent());
  app.querySelector('[data-action="view-shops"]').addEventListener('click', () => { state.view = 'shops'; renderDashboard(); });
  app.querySelector('[data-action="agent-remind"]').addEventListener('click', async (btn) => {
    btn.target.disabled = true;
    try {
      const res = await api('/api/owner/agent/ask', { method: 'POST', body: { action: 'remind' } });
      agentMessages.push({ role: 'agent', text: res.reply });
      agentPaint(res.snapshot);
      paintAgentChat();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.target.disabled = false;
    }
  });

  const form = app.querySelector('#agentForm');
  const input = app.querySelector('#agentInput');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    await askAgent({ message });
  });

  app.querySelectorAll('[data-agent-chip]').forEach((btn) => {
    btn.addEventListener('click', () => askAgent({ message: btn.dataset.agentChip }));
  });

  const agentMain = app.querySelector('.owner-main');
  agentMain.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy-wallet]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copyWallet || '');
        toast('Wallet copy ho gaya', 'success');
      } catch {
        toast(copy.dataset.copyWallet || '', 'success');
      }
      return;
    }
    const confirmBtn = e.target.closest('[data-agent-confirm]');
    if (confirmBtn) {
      await askAgent({ message: 'haan mila', action: 'confirm', proofId: confirmBtn.dataset.agentConfirm });
      return;
    }
    const denyBtn = e.target.closest('[data-agent-deny]');
    if (denyBtn) {
      await askAgent({ message: 'nahi mila', action: 'deny', proofId: denyBtn.dataset.agentDeny });
      return;
    }
    const viewBtn = e.target.closest('[data-agent-view]');
    if (viewBtn) {
      const proof = (state.agent?.proofs || []).find((p) => p.id === viewBtn.dataset.agentView);
      if (proof) await openProofReview(proof, { readOnly: true });
    }
  });

  const brainModelSel = app.querySelector('#brainModel');
  brainModelSel?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) {
      brainSave({ enabled: false });
      brainState.enabled = false;
      return;
    }
    brainSave({ enabled: true, model: val, endpoint: brainState.endpoint });
    brainState.enabled = true;
    brainState.model = val;
  });
  app.querySelector('#brainRefresh')?.addEventListener('click', async () => {
    brainState.checked = false;
    await brainProbe(true);
    brainRenderControls();
  });
  app.querySelector('#brainConfig')?.addEventListener('click', async () => {
    const current = brainConfig().endpoint || 'http://localhost:11435';
    const ep = prompt('Ollama / OpenAI-compatible endpoint:', current);
    if (ep === null) return;
    brainSave({ endpoint: String(ep).trim() });
    brainState.checked = false;
    await brainProbe(true);
    brainRenderControls();
  });
  brainProbe().then(brainRenderControls);

  agentPaint(snap);
  paintAgentChat();
}

function paintAgentChat() {
  const chat = app.querySelector('#agentChat');
  if (chat) {
    chat.innerHTML = agentChatHTML();
    chat.scrollTop = chat.scrollHeight;
  }
}

async function askAgent({ message, action, proofId }) {
  agentMessages.push({ role: 'owner', text: message });
  agentMessages = agentMessages.slice(-60);
  paintAgentChat();

  const chat = app.querySelector('#agentChat');
  if (chat) {
    const typing = document.createElement('div');
    typing.style.cssText = 'max-width:92%;padding:10px 13px;border-radius:12px;background:#f1f5f9;color:#64748b;font-size:13px';
    typing.textContent = 'Agent soch raha hai…';
    chat.appendChild(typing);
    chat.scrollTop = chat.scrollHeight;
  }

  let brainQuestion = false;
  let brainUsed = false;
  if (!action && brainState.enabled && brainState.models.length && !brainBusy) {
    brainBusy = true;
    try {
      const parsed = await brainInterpret(message);
      brainUsed = true;
      const intentMap = {
        confirm: 'confirm', deny: 'deny', wallet: 'wallet', automaton: 'automaton',
        split: 'split', remind: 'remind', reject: 'reject', status: 'status',
      };
      if (parsed && intentMap[parsed.intent]) action = intentMap[parsed.intent];
      if (
        parsed &&
        ['confirm', 'deny', 'reject'].includes(parsed.intent) &&
        Number.isInteger(parsed.proofIndex)
      ) {
        proofId = (state.agent?.proofs || [])[parsed.proofIndex]?.id || proofId;
      }
      brainQuestion = parsed?.intent === 'question';
      brainState.error = '';
    } catch (err) {
      brainState.error = String(err.message || err);
    } finally {
      brainBusy = false;
    }
  }

  try {
    const res = await api('/api/owner/agent/ask', {
      method: 'POST',
      body: { message, action, proofId },
    });
    let text = res.reply || '…';
    if (brainQuestion) {
      try {
        const answer = await brainAnswer(message);
        if (answer && answer.trim()) text += '\n\n— Ollama brain —\n' + answer.trim();
      } catch {
        /* factual backend reply hi dikhao */
      }
    }
    agentMessages.push({
      role: 'agent',
      text,
      wallet: res.walletAddress || '',
      brain: brainUsed,
    });
    agentPaint(res.snapshot);
  } catch (err) {
    agentMessages.push({ role: 'agent', text: `Error: ${err.message}` });
  }
  paintAgentChat();
}

/* ---------------- referral dashboard ---------------- */

function usd(n) {
  return `US$ ${Number(n || 0).toFixed(2)}`;
}

function refEmpty(message) {
  return `<div class="owner-card"><div class="owner-empty">${esc(message)}</div></div>`;
}

function refGrid(items) {
  if (!items || !items.length) return '';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px">${items.join('')}</div>`;
}

function refRow(label, valueHtml) {
  return `<div><span style="color:#94a3b8">${esc(label)}:</span> ${valueHtml}</div>`;
}

function refCard(id, title, sub, badgeHtml, rowsHtml, actionsHtml = '') {
  return `<div class="owner-card" data-id="${esc(id)}" style="padding:16px 18px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div>
        <div class="shop-name">${esc(title)}</div>
        ${sub ? `<div class="shop-sub mono">${esc(sub)}</div>` : ''}
      </div>
      ${badgeHtml}
    </div>
    <div style="margin-top:10px;font-size:12.5px;color:#475569;line-height:1.9">${rowsHtml}</div>
    ${actionsHtml ? `<div class="owner-modal-actions">${actionsHtml}</div>` : ''}
  </div>`;
}

function refStatusBadge(s) {
  if (s.blockedAt || s.billingStatus === 'blocked') return '<span class="badge danger">Blocked</span>';
  if (s.status === 'pending') return '<span class="badge warn">Pending</span>';
  if (s.status === 'rejected') return '<span class="badge danger">Rejected</span>';
  if (s.billingStatus === 'trial') return '<span class="badge warn">Trial</span>';
  if (s.billingStatus === 'payment_due') return '<span class="badge danger">Payment due</span>';
  if (s.billingStatus === 'active') return '<span class="badge ok">Active</span>';
  return `<span class="badge neutral">${esc(s.status || '—')}</span>`;
}

function referralBodyHTML(tab, data) {
  if (tab === 'signups') {
    const list = data.pendingShops || [];
    if (!list.length) return refEmpty('Koi pending signup nahi hai. Naye shops signup karte hi yahan aayenge.');
    return refGrid(list.map((s) => refCard(
      s.id,
      s.name,
      s.code,
      '<span class="badge warn">Pending</span>',
      [
        refRow('Email', esc(s.email || '—')),
        refRow('Phone', esc(s.phone || '—')),
        refRow('Country', esc(s.country || '—')),
        refRow('Referred by', s.referredByCode ? `${esc(s.referredByName || '')} (${esc(s.referredByCode)})` : 'Direct'),
        refRow('Signed up', esc(fmtDateTime(s.createdAt))),
      ].join(''),
      '<button class="owner-btn primary sm" data-act="approve-shop">Approve + 1-day demo trial</button><button class="owner-btn danger sm" data-act="reject-shop">Reject</button>'
    )));
  }

  if (tab === 'proofs') {
    const list = data.proofs || [];
    if (!list.length) {
      return refEmpty('Abhi koi payment proof nahi aaya. Customer receipt upload karega to yahan dikhega.');
    }
    return refGrid(list.map((p) => {
      const badge = p.status === 'approved'
        ? '<span class="badge ok">Approved</span>'
        : p.status === 'rejected'
          ? '<span class="badge danger">Rejected</span>'
          : '<span class="badge warn">Pending</span>';
      const actions = ['<button class="owner-btn sm" data-act="proof-view">Receipt dekhein</button>'];
      if (p.status === 'pending') {
        actions.push('<button class="owner-btn primary sm" data-act="proof-approve">Approve + activate</button>');
        actions.push('<button class="owner-btn danger sm" data-act="proof-reject">Reject</button>');
      }
      return refCard(
        p.id,
        p.shopName || 'Unknown shop',
        p.shopCode || '',
        badge,
        [
          refRow('Amount', `<b>${esc(p.amount)} ${esc(p.currency)}</b>`),
          refRow('Method', esc(p.channelLabel || p.channel)),
          refRow('Sender', esc(p.senderName || '—')),
          refRow('Reference', esc(p.reference || '—')),
          refRow('Received', esc(fmtDateTime(p.createdAt))),
          refRow('Note', esc(p.note || '—')),
          p.rejectReason ? refRow('Reject reason', esc(p.rejectReason)) : '',
        ].join(''),
        actions.join('')
      );
    }));
  }

  if (tab === 'shops') {
    const list = data.shops || [];
    if (!list.length) return refEmpty('Abhi koi shop nahi hai.');
    return refGrid(list.map((s) => {
      const actions = [];
      if (s.status === 'pending') {
        actions.push('<button class="owner-btn primary sm" data-act="approve-shop">Approve</button>');
        actions.push('<button class="owner-btn danger sm" data-act="reject-shop">Reject</button>');
      } else if (s.blockedAt || s.billingStatus === 'blocked') {
        actions.push('<button class="owner-btn primary sm" data-act="unblock-shop">Unblock</button>');
        actions.push('<button class="owner-btn sm" data-act="record-payment">Record payment</button>');
      } else {
        actions.push('<button class="owner-btn danger sm" data-act="block-shop">Block</button>');
        actions.push('<button class="owner-btn primary sm" data-act="record-payment">Record payment</button>');
      }
      return refCard(
        s.id,
        s.name,
        s.code,
        refStatusBadge(s),
        [
          refRow('Email', esc(s.email || '—')),
          refRow('Phone', esc(s.phone || '—')),
          refRow('Country', esc(s.country || '—')),
          refRow('Plan', esc(s.plan || '—')),
          refRow('Referred by', s.referredByCode ? `${esc(s.referredByName || '')} (${esc(s.referredByCode)})` : 'Direct'),
          refRow('Trial left', s.trialDaysLeft == null ? '—' : `${esc(s.trialDaysLeft)} din`),
          refRow('Last payment', s.lastPaymentAt ? `${esc(fmtDate(s.lastPaymentAt))} · ${esc(fmtMoney(s.lastPaymentAmount))}` : '—'),
        ].join(''),
        actions.join('')
      );
    }));
  }

  if (tab === 'automatons') {
    const list = data.automatons || [];
    const form = `<div class="owner-card" style="padding:18px;margin-bottom:16px">
      <h3 class="owner-section-title">Naya automaton (sales agent) banao</h3>
      <form id="automatonForm">
        <div class="owner-form-grid">
          <label>Name<input name="name" required maxlength="80" placeholder="e.g. Ali Sales" /></label>
          <label>Ref code (optional)<input name="refCode" maxlength="30" placeholder="ali-sales" /></label>
          <label>USDC wallet (optional)<input name="walletAddress" maxlength="200" placeholder="0x..." /></label>
          <label>Commission %<input name="commissionPct" type="number" min="0" max="100" step="1" value="30" /></label>
        </div>
        <div class="owner-modal-actions"><button class="btn btn-primary" type="submit">Create automaton</button></div>
      </form>
    </div>`;
    const cards = list.map((a) => refCard(
      a.id,
      a.name,
      a.refCode,
      a.active ? '<span class="badge ok">Active</span>' : '<span class="badge neutral">Inactive</span>',
      [
        refRow('Commission', `${esc(a.commissionPct)}%`),
        refRow('Shops', esc(a.shopsCount || 0)),
        refRow('Earned', usd(a.earnedUsd)),
        refRow('24h target', `${usd(a.todayEarnedUsd || 0)} / ${usd(a.dailyTargetUsd || 130)} (min)${(a.remainingTargetUsd || 0) > 0 ? ` · baaki ${usd(a.remainingTargetUsd)}` : ' · achieved ✅'}`),
        refRow('Requested', usd(a.requestedUsd)),
        refRow('Available', `<b style="color:#0f766e">${usd(a.availableUsd)}</b>`),
        refRow('Wallet', a.walletAddress ? `<span class="mono">${esc(a.walletAddress)}</span>` : '—'),
        refRow('Referral link', `<span class="mono">/?ref=${esc(a.refCode)}</span>`),
      ].join(''),
      [
        '<button class="owner-btn sm" data-act="automaton-edit">Edit</button>',
        '<button class="owner-btn sm" data-act="automaton-key">Rotate API key</button>',
        `<button class="owner-btn sm" data-act="automaton-toggle">${a.active ? 'Deactivate' : 'Activate'}</button>`,
      ].join('')
    ));
    return form + (cards.length ? refGrid(cards) : refEmpty('Abhi koi automaton nahi hai. Upar form se pehla banao.'));
  }

  if (tab === 'quotes') {
    const list = data.quotes || [];
    if (!list.length) return refEmpty('Koi price quote nahi hai.');
    return refGrid(list.map((q) => {
      const pending = q.status === 'pending';
      const badge = q.status === 'approved' ? 'ok' : q.status === 'rejected' ? 'danger' : 'warn';
      return refCard(
        q.id,
        q.shopName || 'Unknown shop',
        q.shopCode || '',
        `<span class="badge ${badge}">${esc(q.status)}</span>`,
        [
          refRow('Amount', `${esc(q.amount)} ${esc(q.currency)}`),
          refRow('Automaton', esc(q.automatonName || '—')),
          refRow('Requested', esc(fmtDateTime(q.createdAt))),
        ].join(''),
        pending
          ? '<button class="owner-btn primary sm" data-act="quote-approve">Approve</button><button class="owner-btn danger sm" data-act="quote-reject">Reject</button>'
          : ''
      );
    }));
  }

  if (tab === 'prices') {
    const list = data.priceLimits || [];
    const form = `<div class="owner-card" style="padding:18px;margin-bottom:16px">
      <h3 class="owner-section-title">Price limit set karein</h3>
      <form id="priceForm">
        <div class="owner-form-grid">
          <label>Country (2 letters)<input name="country" maxlength="2" required placeholder="PK" /></label>
          <label>Currency (3 letters)<input name="currency" maxlength="3" required placeholder="PKR" /></label>
          <label>Minimum<input name="minPrice" type="number" min="0" step="0.01" required value="0" /></label>
          <label>Maximum<input name="maxPrice" type="number" min="0" step="0.01" required value="0" /></label>
        </div>
        <div class="owner-modal-actions"><button class="btn btn-primary" type="submit">Save limit</button></div>
      </form>
    </div>`;
    const cards = list.map((p) => refCard(
      p.id,
      `${p.country} · ${p.currency}`,
      '',
      '<span class="badge teal">Limit</span>',
      [
        refRow('Minimum', `${esc(p.minPrice)} ${esc(p.currency)}`),
        refRow('Maximum', `${esc(p.maxPrice)} ${esc(p.currency)}`),
        refRow('Updated', esc(fmtDateTime(p.updatedAt))),
      ].join(''),
      `<button class="owner-btn sm" data-act="price-edit" data-country="${esc(p.country)}" data-currency="${esc(p.currency)}" data-min="${esc(p.minPrice)}" data-max="${esc(p.maxPrice)}">Edit</button>`
    ));
    return form + (cards.length ? refGrid(cards) : refEmpty('Koi price limit set nahi hai.'));
  }

  if (tab === 'payouts') {
    const list = data.payouts || [];
    if (!list.length) return refEmpty('Koi payout request nahi hai.');
    return refGrid(list.map((p) => {
      const badge = p.status === 'paid' ? 'ok' : p.status === 'rejected' ? 'danger' : p.status === 'approved' ? 'teal' : 'warn';
      const actions = [];
      if (p.status === 'pending') actions.push('<button class="owner-btn primary sm" data-act="payout-approve">Approve</button>');
      if (p.status === 'pending' || p.status === 'approved') {
        actions.push('<button class="owner-btn primary sm" data-act="payout-paid">Mark paid</button>');
        actions.push('<button class="owner-btn danger sm" data-act="payout-reject">Reject</button>');
      }
      return refCard(
        p.id,
        p.automatonName || 'Unknown automaton',
        `#${p.id}`,
        `<span class="badge ${badge}">${esc(p.status)}</span>`,
        [
          refRow('Amount', `<b>${usd(p.amountUsd)}</b>`),
          refRow('Reason', esc(p.reason || '—')),
          refRow('Requested', esc(fmtDateTime(p.createdAt))),
          refRow('Tx hash', p.txHash ? `<span class="mono">${esc(p.txHash)}</span>` : '—'),
        ].join(''),
        actions.join('')
      );
    }));
  }

  if (tab === 'payments') {
    const list = data.payments || [];
    if (!list.length) return refEmpty('Koi payment record nahi hai.');
    const rows = list.map((p) => `<tr>
      <td><div class="shop-name">${esc(p.shopName || '—')}</div><div class="shop-sub mono">${esc(p.shopCode || '')}</div></td>
      <td>${esc(fmtDateTime(p.receivedAt))}</td>
      <td>${esc(fmtMoney(p.gross))} ${esc(p.currency)}</td>
      <td>${esc(fmtMoney(p.gatewayFee))} ${esc(p.currency)}</td>
      <td>${usd(p.netUsd)}</td>
      <td>${p.commissionUsd == null ? '—' : usd(p.commissionUsd)}</td>
      <td><span class="badge ${p.commissionStatus === 'clawed_back' ? 'danger' : p.commissionUsd == null ? 'neutral' : 'ok'}">${esc(p.commissionStatus || 'none')}</span></td>
      <td><span class="badge ${p.status === 'succeeded' ? 'ok' : 'warn'}">${esc(p.status)}</span></td>
    </tr>`).join('');
    return `<div class="owner-card"><div class="owner-table-wrap"><table class="owner-table">
      <thead><tr><th>Shop</th><th>Received</th><th>Gross</th><th>Fee</th><th>Net USD</th><th>Commission</th><th>Commission status</th><th>Payment</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
  }

  if (tab === 'chat') {
    const list = data.chatLeads || [];
    if (!list.length) return refEmpty('Abhi koi website chat lead nahi hai. Visitors chat karte hi yahan dikhenge.');
    const rows = list.map((c) => `<tr>
      <td><div class="shop-name">${esc(c.email || c.sessionId || 'Anonymous')}</div><div class="shop-sub mono">${esc(c.shop || '')} ${esc(c.city || '')}</div></td>
      <td>${esc(c.intent || '—')}</td>
      <td>${esc(c.lastMessage || '—')}</td>
      <td><span class="badge ${c.stage === 'paid' ? 'ok' : c.stage === 'trial' ? 'warn' : 'neutral'}">${esc(c.stage || 'new')}</span></td>
      <td>${esc(fmtDateTime(c.updatedAt))}</td>
    </tr>`).join('');
    return `<div class="owner-card"><div class="owner-table-wrap"><table class="owner-table">
      <thead><tr><th>Visitor</th><th>Intent</th><th>Last message</th><th>Stage</th><th>Updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
  }

  return refEmpty('Unknown tab.');
}

async function renderReferralDashboard() {
  let data;
  try {
    data = await api('/api/owner/referral/overview');
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showLogin('Session expire ho gaya — dobara login karein.');
      return;
    }
    toast(err.message, 'error');
    return;
  }
  state.referral = data;
  const cards = data.cards || {};
  const pendingCount = (data.pendingShops || []).length;
  const pendingProofs = Number(cards.pendingProofs || 0);
  const tabs = [
    ['signups', `Signups${pendingCount ? ` (${pendingCount})` : ''}`],
    ['proofs', `Proofs${pendingProofs ? ` (${pendingProofs})` : ''}`],
    ['shops', 'Shops'],
    ['automatons', 'Automatons'],
    ['quotes', 'Quotes'],
    ['prices', 'Prices'],
    ['payouts', 'Payouts'],
    ['payments', 'Payments'],
    ['chat', 'Chat Leads'],
  ];
  app.innerHTML = `
    <div class="owner-shell">
      <header class="owner-topbar">
        <div class="owner-brand"><div class="mark">m</div><div><b>mhzaly</b><span>Referral &amp; Commissions</span></div></div>
        <div class="owner-actions">
          <span class="owner-email">${esc(state.owner?.email || 'Owner')}</span>
          <button class="owner-btn ghost" data-action="refresh-referral">Refresh</button>
          <button class="owner-btn ghost" data-action="view-shops">Back to shops</button>
        </div>
      </header>
      <main class="owner-main">
        <div class="owner-stats">
          ${statCard('Pending approvals', cards.pendingApprovals || 0, 'warn')}
          ${statCard('Payment proofs', cards.pendingProofs || 0, 'warn')}
          ${statCard('On trial', cards.onTrial || 0, 'warn')}
          ${statCard('Payment due', cards.paymentDue || 0, 'danger')}
          ${statCard('Aap ka 70%', usd(cards.ownerShareUsd), 'teal')}
          ${statCard('Automaton 30%', usd(cards.automatonShareUsd), 'warn')}
          ${statCard('Automaton balance', usd(cards.automatonAvailable), 'teal')}
        </div>
        <div class="owner-toolbar">
          <div class="owner-tabs" id="refTabs">
            ${tabs.map(([id, label]) => `<button class="owner-tab ${state.refTab === id ? 'active' : ''}" data-reftab="${id}">${esc(label)}</button>`).join('')}
          </div>
        </div>
        <div id="refBody"></div>
      </main>
    </div>`;

  app.querySelector('[data-action="refresh-referral"]').addEventListener('click', () => renderReferralDashboard());
  app.querySelector('[data-action="view-shops"]').addEventListener('click', () => { state.view = 'shops'; renderDashboard(); });
  app.querySelectorAll('[data-reftab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.refTab = btn.dataset.reftab;
      app.querySelectorAll('[data-reftab]').forEach((b) => b.classList.toggle('active', b === btn));
      paintReferralBody();
    });
  });
  paintReferralBody();
}

function paintReferralBody() {
  const data = state.referral;
  const body = app.querySelector('#refBody');
  if (!data || !body) return;
  body.innerHTML = referralBodyHTML(state.refTab, data);
  bindReferralBody();
}

function bindReferralBody() {
  const body = app.querySelector('#refBody');
  if (!body) return;

  const autoForm = body.querySelector('#automatonForm');
  if (autoForm) {
    autoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(autoForm);
      const payload = {
        name: String(fd.get('name') || '').trim(),
        refCode: String(fd.get('refCode') || '').trim(),
        walletAddress: String(fd.get('walletAddress') || '').trim(),
        commissionPct: Number(fd.get('commissionPct') || 30),
      };
      if (!payload.name) return toast('Automaton ka naam zaroori hai', 'error');
      const btn = autoForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const res = await api('/api/owner/referral/automaton', { method: 'POST', body: payload });
        toast('Automaton ban gaya', 'success');
        if (res.apiKey) showSecret('Automaton API key', res.apiKey);
        await renderReferralDashboard();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  const priceForm = body.querySelector('#priceForm');
  if (priceForm) {
    priceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(priceForm);
      try {
        await api('/api/owner/referral/price', {
          method: 'POST',
          body: {
            country: String(fd.get('country') || '').trim().toUpperCase(),
            currency: String(fd.get('currency') || '').trim().toUpperCase(),
            minPrice: Number(fd.get('minPrice') || 0),
            maxPrice: Number(fd.get('maxPrice') || 0),
          },
        });
        toast('Price limit save ho gayi', 'success');
        await renderReferralDashboard();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.closest('[data-id]')?.dataset.id || '';
    const data = state.referral || {};

    try {
      if (act === 'approve-shop' || act === 'reject-shop' || act === 'block-shop' || act === 'unblock-shop') {
        if (!id) return;
        let reason = '';
        if (act === 'reject-shop' && !confirm('Ye shop reject karni hai? Woh login nahi kar sakega.')) return;
        if (act === 'block-shop') {
          const r = prompt('Block reason (optional):', 'Payment pending');
          if (r === null) return;
          reason = r;
        }
        const action = act.replace('-shop', '');
        await api('/api/owner/referral/shop', { method: 'POST', body: { shopId: id, action, reason } });
        toast('Shop ' + action + ' ho gayi', 'success');
        await renderReferralDashboard();
        return;
      }

      if (act === 'record-payment') {
        const shop = (data.shops || []).find((s) => s.id === id);
        if (shop) openRecordPayment(shop);
        return;
      }

      if (act === 'proof-view') {
        const proof = (data.proofs || []).find((p) => p.id === id);
        if (proof) await openProofReview(proof, { readOnly: true });
        return;
      }

      if (act === 'proof-approve') {
        const proof = (data.proofs || []).find((p) => p.id === id);
        if (proof) await openProofReview(proof, { readOnly: false });
        return;
      }

      if (act === 'proof-reject') {
        if (!id) return;
        const reason = prompt('Reject reason:', 'Receipt clear nahi hai');
        if (reason === null) return;
        await api('/api/owner/referral/proof', {
          method: 'POST',
          body: { id, action: 'reject', reason },
        });
        toast('Proof reject ho gaya', 'success');
        await renderReferralDashboard();
        return;
      }

      if (act === 'automaton-key') {
        if (!id) return;
        if (!confirm('Purani API key band ho jayegi. Nayi key generate karni hai?')) return;
        const res = await api('/api/owner/referral/automaton-key', { method: 'POST', body: { id } });
        if (res.apiKey) showSecret('Nayi automaton API key', res.apiKey);
        toast('API key rotate ho gayi', 'success');
        await renderReferralDashboard();
        return;
      }

      if (act === 'automaton-toggle') {
        const auto = (data.automatons || []).find((a) => a.id === id);
        if (!auto) return;
        await api('/api/owner/referral/automaton', {
          method: 'POST',
          body: {
            id: auto.id,
            name: auto.name,
            refCode: auto.refCode,
            walletAddress: auto.walletAddress || '',
            commissionPct: auto.commissionPct,
            active: !auto.active,
          },
        });
        toast(auto.active ? 'Automaton deactivate ho gaya' : 'Automaton activate ho gaya', 'success');
        await renderReferralDashboard();
        return;
      }

      if (act === 'automaton-edit') {
        const auto = (data.automatons || []).find((a) => a.id === id);
        if (auto) await editAutomaton(auto);
        return;
      }

      if (act === 'quote-approve' || act === 'quote-reject') {
        if (!id) return;
        await api('/api/owner/referral/quote', {
          method: 'POST',
          body: { id, action: act === 'quote-approve' ? 'approve' : 'reject' },
        });
        toast('Quote update ho gaya', 'success');
        await renderReferralDashboard();
        return;
      }

      if (act === 'price-edit') {
        const form = document.querySelector('#refBody #priceForm');
        if (form) {
          form.country.value = btn.dataset.country || '';
          form.currency.value = btn.dataset.currency || '';
          form.minPrice.value = btn.dataset.min || '0';
          form.maxPrice.value = btn.dataset.max || '0';
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          form.country.focus();
        }
        return;
      }

      if (act === 'payout-approve' || act === 'payout-reject') {
        if (!id) return;
        if (act === 'payout-reject' && !confirm('Ye payout request reject karni hai?')) return;
        await api('/api/owner/referral/payout', {
          method: 'POST',
          body: { id, action: act === 'payout-approve' ? 'approve' : 'reject' },
        });
        toast('Payout update ho gaya', 'success');
        await renderReferralDashboard();
        return;
      }

      if (act === 'payout-paid') {
        if (!id) return;
        const txHash = prompt('USDC transaction hash (optional):', '');
        if (txHash === null) return;
        await api('/api/owner/referral/payout', { method: 'POST', body: { id, action: 'paid', txHash } });
        toast('Payout paid mark ho gaya', 'success');
        await renderReferralDashboard();
        return;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function openProofReview(proof, { readOnly = false } = {}) {
  let image = null;
  try {
    image = await api(`/api/owner/referral/proof-image?id=${encodeURIComponent(proof.id)}`);
  } catch (err) {
    toast(err.message || 'Receipt load nahi hui', 'error');
  }

  const modal = document.createElement('div');
  modal.className = 'owner-modal-backdrop';
  const currencyOptions = ['PKR', 'USD', 'AED', 'SAR', 'GBP', 'EUR']
    .map((c) => `<option value="${c}"${c === proof.currency ? ' selected' : ''}>${c}</option>`)
    .join('');
  const gatewayOptions = ['western_union', 'jazzcash', 'meezan', 'bank', 'cash', 'other']
    .map((g) => `<option value="${g}"${g === proof.channel ? ' selected' : ''}>${g}</option>`)
    .join('');

  modal.innerHTML = `
    <div class="owner-modal" style="max-width:760px">
      <div class="owner-modal-head">
        <div>
          <h2>Payment proof — ${esc(proof.shopName || 'Shop')}</h2>
          <p>${esc(proof.channelLabel || proof.channel)}${proof.reference ? ' · ' + esc(proof.reference) : ''}</p>
        </div>
        <button class="owner-modal-close" data-close>×</button>
      </div>
      <div class="owner-modal-body">
        ${image
          ? `<img alt="receipt" style="display:block;max-width:100%;max-height:360px;margin:0 auto 16px;border-radius:10px;border:1px solid #e2e8f0" src="data:${esc(image.mime)};base64,${image.data}" />`
          : '<p style="color:#b91c1c;margin-bottom:12px">Receipt image load nahi hui.</p>'}
        ${readOnly
          ? `<div style="font-size:13px;line-height:2;color:#475569">
              <div><b>Shop:</b> ${esc(proof.shopName || '—')} (${esc(proof.shopCode || '—')})</div>
              <div><b>Phone:</b> ${esc(proof.shopPhone || '—')}</div>
              <div><b>Amount:</b> ${esc(proof.amount)} ${esc(proof.currency)}</div>
              <div><b>Sender:</b> ${esc(proof.senderName || '—')}</div>
              <div><b>Reference:</b> ${esc(proof.reference || '—')}</div>
              <div><b>Note:</b> ${esc(proof.note || '—')}</div>
              <div><b>Status:</b> ${esc(proof.status)}</div>
              ${proof.rejectReason ? `<div><b>Reject reason:</b> ${esc(proof.rejectReason)}</div>` : ''}
            </div>`
          : `<form id="proofReviewForm">
              <div class="owner-form-grid">
                <label>Gross amount<input name="amount" type="number" min="0" step="0.01" required value="${esc(proof.amount)}" /></label>
                <label>Gateway fee<input name="gatewayFee" type="number" min="0" step="0.01" value="0" /></label>
                <label>Currency<select name="currency">${currencyOptions}</select></label>
                <label>USD rate (blank = default)<input name="usdRate" type="number" min="0" step="0.000001" placeholder="auto" /></label>
                <label>Gateway<select name="gateway">${gatewayOptions}</select></label>
                <label>Reference<input name="reference" maxlength="100" value="${esc(proof.reference || '')}" /></label>
                <label>Note<input name="note" maxlength="200" value="${esc(proof.note || '')}" /></label>
              </div>
              <div class="owner-modal-actions">
                <button class="btn btn-primary" type="submit">Approve + activate plan</button>
                <button class="btn btn-danger" type="button" data-reject>Reject</button>
              </div>
            </form>`}
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  if (readOnly) return;

  const form = modal.querySelector('#proofReviewForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const usdRate = Number(fd.get('usdRate') || 0);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api('/api/owner/referral/proof', {
        method: 'POST',
        body: {
          id: proof.id,
          action: 'approve',
          amount: Number(fd.get('amount') || 0),
          gatewayFee: Number(fd.get('gatewayFee') || 0),
          currency: String(fd.get('currency') || proof.currency),
          usdRate: usdRate > 0 ? usdRate : undefined,
          gateway: String(fd.get('gateway') || proof.channel),
          reference: String(fd.get('reference') || ''),
          note: String(fd.get('note') || ''),
        },
      });
      toast(
        `Plan activate ho gaya${res.commissionUsd ? ` · commission ${usd(res.commissionUsd)}` : ''}`,
        'success'
      );
      close();
      await renderReferralDashboard();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  form.querySelector('[data-reject]').addEventListener('click', async () => {
    const reason = prompt('Reject reason:', 'Receipt clear nahi hai');
    if (reason === null) return;
    try {
      await api('/api/owner/referral/proof', {
        method: 'POST',
        body: { id: proof.id, action: 'reject', reason },
      });
      toast('Proof reject ho gaya', 'success');
      close();
      await renderReferralDashboard();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function editAutomaton(auto) {
  const name = prompt('Automaton name:', auto.name);
  if (name === null) return;
  const refCode = prompt('Ref code:', auto.refCode);
  if (refCode === null) return;
  const walletAddress = prompt('USDC wallet:', auto.walletAddress || '');
  if (walletAddress === null) return;
  const pctRaw = prompt('Commission %:', String(auto.commissionPct));
  if (pctRaw === null) return;
  try {
    await api('/api/owner/referral/automaton', {
      method: 'POST',
      body: {
        id: auto.id,
        name: name.trim(),
        refCode: refCode.trim(),
        walletAddress: walletAddress.trim(),
        commissionPct: Number(pctRaw),
        active: auto.active,
      },
    });
    toast('Automaton update ho gaya', 'success');
    await renderReferralDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showSecret(title, secret) {
  const modal = document.createElement('div');
  modal.className = 'owner-modal-backdrop';
  modal.innerHTML = `
    <div class="owner-modal" style="max-width:560px">
      <div class="owner-modal-head">
        <div><h2>${esc(title)}</h2><p>Ye key sirf abhi dikh rahi hai — ab copy karein, dobara nahi milegi.</p></div>
        <button class="owner-modal-close" data-close>×</button>
      </div>
      <div class="owner-modal-body">
        <div class="owner-form-grid" style="grid-template-columns:1fr">
          <label>API key<input id="secretKeyValue" readonly value="${esc(secret)}" /></label>
        </div>
        <div class="owner-modal-actions">
          <button class="btn btn-primary" data-copy>Copy key</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('[data-copy]').addEventListener('click', async () => {
    const input = modal.querySelector('#secretKeyValue');
    try {
      await navigator.clipboard.writeText(secret);
      toast('API key copy ho gayi', 'success');
    } catch {
      input.select();
      document.execCommand('copy');
      toast('API key copy ho gayi', 'success');
    }
  });
}

function openRecordPayment(shop) {
  const modal = document.createElement('div');
  modal.className = 'owner-modal-backdrop';
  modal.innerHTML = `
    <div class="owner-modal" style="max-width:600px">
      <div class="owner-modal-head">
        <div><h2>Record payment — ${esc(shop.name)}</h2><p>Payment save hote hi commission bhi automatically banega.</p></div>
        <button class="owner-modal-close" data-close>×</button>
      </div>
      <div class="owner-modal-body">
        <form id="recordPaymentForm">
          <div class="owner-form-grid">
            <label>Gross amount<input name="gross" type="number" min="0" step="0.01" required value="0" /></label>
            <label>Gateway fee<input name="gatewayFee" type="number" min="0" step="0.01" value="0" /></label>
            <label>Currency
              <select name="currency"><option>PKR</option><option>USD</option><option>AED</option><option>SAR</option><option>GBP</option><option>EUR</option></select>
            </label>
            <label>USD rate (blank = default)<input name="usdRate" type="number" min="0" step="0.000001" placeholder="auto" /></label>
            <label>Gateway
              <select name="gateway"><option>bank</option><option>jazzcash</option><option>easypaisa</option><option>stripe</option><option>usdc</option><option>cash</option></select>
            </label>
            <label>Reference (blank = auto)<input name="reference" maxlength="120" placeholder="auto" /></label>
            <label>Note<input name="note" maxlength="200" /></label>
          </div>
          <div class="owner-modal-actions">
            <button class="btn btn-primary" type="submit">Save payment</button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const form = modal.querySelector('#recordPaymentForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const usdRate = Number(fd.get('usdRate') || 0);
    const reference = String(fd.get('reference') || '').trim();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api('/api/owner/referral/shop', {
        method: 'POST',
        body: {
          shopId: shop.id,
          action: 'mark_paid',
          gross: Number(fd.get('gross') || 0),
          gatewayFee: Number(fd.get('gatewayFee') || 0),
          currency: String(fd.get('currency') || 'PKR'),
          usdRate: usdRate > 0 ? usdRate : undefined,
          gateway: String(fd.get('gateway') || 'bank'),
          reference: reference || undefined,
          note: String(fd.get('note') || ''),
        },
      });
      toast(
        res.duplicate
          ? 'Ye payment pehle se record hai'
          : `Payment save ho gayi${res.commissionUsd ? ` · commission ${usd(res.commissionUsd)}` : ''}`,
        'success'
      );
      close();
      await renderReferralDashboard();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

/* ---------------- manage shop ---------------- */

function planSelectOptions(selected) {
  return Object.entries(PLAN_LABELS)
    .map(([id, label]) => {
      const days = PLAN_DAYS[id];
      const hint = days == null ? 'no expiry' : `${days} days`;
      return `<option value="${id}" ${id === selected ? 'selected' : ''}>${label} — ${hint}</option>`;
    })
    .join('');
}

function paymentsHTML(payments) {
  if (!payments.length) {
    return '<div class="owner-payments"><div class="owner-payment-empty">Koi payment record nahi hai.</div></div>';
  }
  const rows = payments
    .map(
      (p) => `<div class="owner-payment-row">
        <div>${esc(fmtDateTime(p.created_at))}</div>
        <div>${esc(PLAN_LABELS[p.plan] || p.plan || '—')}</div>
        <div>Rs ${esc(fmtMoney(p.amount))}</div>
        <div>${esc(p.method || '—')}</div>
        <div>${esc(p.note || '—')}</div>
      </div>`
    )
    .join('');
  return `<div class="owner-payments">
    <div class="owner-payment-row head"><div>Date</div><div>Plan</div><div>Amount</div><div>Method</div><div>Note</div></div>
    ${rows}
  </div>`;
}

async function openManage(shopId) {
  const shop = state.shops.find((s) => s.id === shopId);
  if (!shop) return;

  let payments = [];
  try {
    const data = await api(`/api/owner/payments?shopId=${encodeURIComponent(shopId)}`);
    payments = data.payments || [];
  } catch (err) {
    toast(err.message, 'error');
  }

  const selectedPlan = Object.prototype.hasOwnProperty.call(PLAN_DAYS, shop.plan) ? shop.plan : 'monthly';
  const modal = document.createElement('div');
  modal.className = 'owner-modal-backdrop';
  modal.innerHTML = `
    <div class="owner-modal">
      <div class="owner-modal-head">
        <div>
          <h2>${esc(shop.name)}</h2>
          <p>${esc(shop.code)} · ${esc(shop.shopTypeLabel)} · ${esc(shop.phone || 'no phone')}</p>
        </div>
        <button class="owner-modal-close" data-close>×</button>
      </div>
      <div class="owner-modal-body">
        <div class="owner-current">
          <div><span>Plan</span><b>${esc(shop.planLabel)}</b></div>
          <div><span>Status</span><b>${statusBadge(shop)}</b></div>
          <div><span>Ends</span><b>${shop.plan === 'lifetime' ? 'Never' : esc(fmtDate(shop.subscriptionEnd))}</b></div>
          <div><span>Days left</span><b>${shop.daysLeft == null ? '—' : `${shop.daysLeft} din`}</b></div>
        </div>

        <h3 class="owner-section-title">Set or extend subscription</h3>
        <form id="ownerPlanForm">
          <div class="owner-form-grid">
            <label>Plan
              <select name="plan">${planSelectOptions(selectedPlan)}</select>
            </label>
            <label>Amount received (Rs)
              <input name="amount" type="number" min="0" step="1" value="0" />
            </label>
            <label>Payment method
              <select name="method">
                <option>Cash</option><option>Bank</option><option>JazzCash</option><option>Easypaisa</option><option>Other</option>
              </select>
            </label>
            <label>Note
              <input name="note" placeholder="e.g. June payment" maxlength="200" />
            </label>
          </div>
          <div class="owner-modal-actions">
            <button class="btn btn-primary" type="submit">Set plan &amp; save payment</button>
            <button class="owner-btn" type="button" data-extend>Extend current plan</button>
          </div>
        </form>

        <div class="owner-divider"></div>
        <div class="owner-modal-actions">
          ${
            shop.status === 'pending'
              ? `<button class="btn btn-primary" data-shop-action="approve">Approve shop</button>
                 <button class="btn btn-danger" data-shop-action="reject">Reject</button>`
              : ''
          }
          ${
            shop.billingStatus === 'blocked'
              ? '<button class="btn btn-primary" data-shop-action="unblock">Unblock account</button>'
              : '<button class="btn btn-danger" data-shop-action="block">Block account</button>'
          }
        </div>

        <div class="owner-divider"></div>
        <h3 class="owner-section-title">Payment history</h3>
        ${paymentsHTML(payments)}
      </div>
    </div>`;

  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  const form = modal.querySelector('#ownerPlanForm');
  const readForm = () => {
    const fd = new FormData(form);
    return {
      plan: String(fd.get('plan') || 'monthly'),
      amount: Number(fd.get('amount') || 0),
      method: String(fd.get('method') || ''),
      note: String(fd.get('note') || ''),
    };
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await runShopAction(shopId, { action: 'set_plan', ...readForm() }, close);
  });

  modal.querySelector('[data-extend]').addEventListener('click', async () => {
    await runShopAction(shopId, { action: 'extend', ...readForm() }, close);
  });

  modal.querySelectorAll('[data-shop-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.shopAction;
      if (action === 'reject' && !confirm('Ye shop request reject karni hai? Is ka data delete ho jayega.')) return;
      if (action === 'block') {
        const reason = prompt('Block reason (optional):', 'Payment pending');
        if (reason === null) return;
        await runShopAction(shopId, { action, reason }, close);
        return;
      }
      await runShopAction(shopId, { action }, close);
    });
  });
}

async function runShopAction(shopId, body, onDone) {
  try {
    await api('/api/owner/shop', { method: 'POST', body: { shopId, ...body } });
    toast('Shop update ho gayi', 'success');
    if (onDone) onDone();
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- password ---------------- */

function openPassword() {
  const modal = document.createElement('div');
  modal.className = 'owner-modal-backdrop';
  modal.innerHTML = `
    <div class="owner-modal" style="max-width:440px">
      <div class="owner-modal-head">
        <div>
          <h2>Change owner password</h2>
          <p>Owner account: ${esc(state.owner?.email || 'Owner')}</p>
        </div>
        <button class="owner-modal-close" data-close>×</button>
      </div>
      <div class="owner-modal-body">
        <form id="ownerPasswordForm">
          <div class="owner-form-grid" style="grid-template-columns:1fr">
            <label>Current password<input name="current" type="password" required autocomplete="current-password" /></label>
            <label>New password<input name="next" type="password" required minlength="8" autocomplete="new-password" /></label>
            <label>Confirm new password<input name="confirm" type="password" required minlength="8" autocomplete="new-password" /></label>
          </div>
          <div class="owner-modal-actions">
            <button class="btn btn-primary" type="submit">Update password</button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  modal.querySelector('#ownerPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const current = String(fd.get('current') || '');
    const next = String(fd.get('next') || '');
    const confirm = String(fd.get('confirm') || '');
    if (next !== confirm) return toast('New passwords match nahi kar rahe', 'error');
    try {
      await api('/api/owner/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      toast('Password update ho gaya', 'success');
      close();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ---------------- start ---------------- */

if (state.token) refresh();
else showLogin();
