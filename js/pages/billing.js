/* ============================================================
   mhzaly — plan activation & payment proof (Western Union /
   Meezan Bank / JazzCash receipt upload)
   ============================================================ */

import { submitPaymentProof, listPaymentProofs, clearSession } from '../api.js';
import { icon, esc, toast, openModal, closeModal } from '../ui.js';

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Image read nahi hui'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load nahi hui'));
    img.src = src;
  });
}

/* Receipt screenshots ko browser mein hi chhota kar dete hain, taake
   D1 row limit ke andar aaye aur upload fast rahe. */
async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Sirf image file chunein (receipt ka screenshot)');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Image 12 MB se bari hai — chhoti screenshot lein');
  }
  const original = await readFileAsDataURL(file);
  const img = await loadImage(original);
  let max = 1280;
  for (const quality of [0.72, 0.62, 0.52, 0.42]) {
    const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || 1) * scale));
    const height = Math.max(1, Math.round((img.height || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= 900000) return out;
    max = 1024;
  }
  throw new Error('Image bohat bari hai — dobara screenshot lein');
}

function proofFormHTML() {
  return `<form id="proofForm">
    <p class="hint" style="margin:0 0 12px">Pakistan: monthly Rs 2,500 · quarterly Rs 6,500 · annual Rs 20,000. International: $19/month · $49/quarter · $149/year. Lifetime $2,000 (major countries only).</p>
    <div class="form-grid">
      <div class="field">
        <label>Amount</label>
        <input class="input" name="amount" type="number" min="1" step="0.01" required placeholder="e.g. 5000" />
      </div>
      <div class="field">
        <label>Currency</label>
        <select class="input" name="currency">
          <option>PKR</option><option>USD</option><option>AED</option><option>SAR</option><option>GBP</option><option>EUR</option>
        </select>
      </div>
      <div class="field">
        <label>Payment method</label>
        <select class="input" name="channel">
          <option value="western_union">Western Union</option>
          <option value="jazzcash">JazzCash</option>
          <option value="meezan">Meezan Bank</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field">
        <label>Sender name</label>
        <input class="input" name="senderName" maxlength="80" placeholder="Jisne paisa bheja" />
      </div>
      <div class="field">
        <label>Reference / MTCN</label>
        <input class="input" name="reference" maxlength="120" placeholder="Tracking number" />
      </div>
      <div class="field">
        <label>Note (optional)</label>
        <input class="input" name="note" maxlength="300" placeholder="Koi extra detail" />
      </div>
      <div class="field full">
        <label>Receipt screenshot</label>
        <input class="input" name="image" type="file" accept="image/*" required />
        <span class="hint">Receipt ki clear photo ya screenshot. Automatic compress ho jayegi.</span>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('upload')} Proof bhejein</button>
    </div>
  </form>`;
}

/* Owner ke receiving accounts — customer ko yahan se pay karna hai. */
const PAYMENT_DETAILS = [
  {
    id: 'western-union',
    channel: 'Western Union',
    note: 'International payment — receiver ke naam par bhejein',
    fields: [
      ['Receiver name', 'MUHAMMAD HASSAAN ZAHID'],
      ['Country', 'Pakistan'],
      ['CNIC / ID number', '3540489166637'],
    ],
  },
  {
    id: 'jazzcash',
    channel: 'JazzCash',
    note: 'Pakistan ke andar — JazzCash app ya agent se',
    fields: [
      ['Account title', 'Muhammad Hassaan Zahid'],
      ['JazzCash number', '03321141889'],
    ],
  },
];

function copyFieldHTML(value) {
  return `<button type="button" class="btn btn-ghost" data-copy="${esc(value)}" style="padding:4px 10px;font-size:12px">Copy</button>`;
}

function paymentInstructionsHTML() {
  return `<div class="card" style="margin-bottom:14px">
    <div class="card-head"><h3>${icon('wallet')} Payment kahan bhejein</h3></div>
    <div class="card-pad">
      ${PAYMENT_DETAILS.map((d) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <b>${esc(d.channel)}</b>
          <span class="hint">· ${esc(d.note)}</span>
        </div>
        ${d.fields.map(([label, value]) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;padding:2px 0">
          <span><span class="hint">${esc(label)}:</span> <b>${esc(value)}</b></span>
          ${copyFieldHTML(value)}
        </div>`).join('')}
      </div>`).join('')}
      <p class="hint" style="margin-top:10px">Paisa bhejne ke baad neeche receipt ka screenshot upload karein. Owner 24 ghante mein check karke plan activate karega.</p>
    </div>
  </div>`;
}

function bindCopyButtons(root) {
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(value);
        toast('Copy ho gaya', 'success');
      } catch {
        toast(value, 'success');
      }
    });
  });
}

function proofBadge(status) {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'danger';
  return 'warn';
}

function historyHTML(proofs) {
  if (!proofs || !proofs.length) return '';
  const rows = proofs
    .map(
      (p) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">
        <div>
          <b>${esc(p.amount)} ${esc(p.currency)}</b>
          <span class="hint"> · ${esc(p.channelLabel || p.channel)}</span>
          <div class="hint">${esc(new Date(p.createdAt).toLocaleString())}${p.reference ? ' · ' + esc(p.reference) : ''}${p.rejectReason ? ' · ' + esc(p.rejectReason) : ''}</div>
        </div>
        <span class="badge ${proofBadge(p.status)}">${esc(p.status)}</span>
      </div>`
    )
    .join('');
  return `<div class="card mt">
    <div class="card-head"><h3>Mere payment proofs</h3></div>
    <div class="card-pad">${rows}</div>
  </div>`;
}

function bindProofForm(root, { onDone } = {}) {
  const form = root.querySelector('#proofForm');
  if (!form) return;
  const fileInput = form.querySelector('input[name="image"]');
  const preview = root.querySelector('#proofPreview');
  let compressed = '';

  fileInput?.addEventListener('change', async () => {
    compressed = '';
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      if (preview) preview.hidden = true;
      return;
    }
    try {
      compressed = await compressImage(file);
      if (preview) {
        preview.src = compressed;
        preview.hidden = false;
      }
    } catch (err) {
      toast(err.message, 'error');
      fileInput.value = '';
      if (preview) preview.hidden = true;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (!file) throw new Error('Receipt screenshot chunein');
      if (!compressed) compressed = await compressImage(file);
      const res = await submitPaymentProof({
        amount: Number(fd.get('amount') || 0),
        currency: String(fd.get('currency') || 'PKR'),
        channel: String(fd.get('channel') || 'other'),
        senderName: String(fd.get('senderName') || ''),
        reference: String(fd.get('reference') || ''),
        note: String(fd.get('note') || ''),
        image: compressed,
      });
      toast(res.message || 'Proof bhej diya gaya', 'success');
      form.reset();
      compressed = '';
      if (preview) preview.hidden = true;
      if (onDone) await onDone();
    } catch (err) {
      toast(err.message || 'Proof nahi gaya — dobara koshish karein', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/* Full-screen activation page shown when the plan is expired / blocked. */
export function renderLock(root, { shop, message } = {}) {
  const name = shop?.name || 'Aap ki shop';
  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg-soft,#f8fafc)">
      <div style="width:100%;max-width:660px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
          <span class="brand-logo">${icon('bag')}</span>
          <div>
            <div class="brand-name">mhzaly</div>
            <div class="brand-sub">${esc(name)}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Plan activate karein</h3></div>
          <div class="card-pad">
            <div class="alert-box" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412">
              ${icon('alert')}
              <div>${esc(message || 'Aap ka trial ya plan khatam ho gaya hai.')} Payment proof bhejein — owner 24 ghante mein check karke activate karega.</div>
            </div>
            <p class="hint" style="margin:12px 0">
              1) Neeche diye account par payment bhejein. 2) Receipt ka screenshot upload karein. 3) Owner 24 ghante mein activate karega.
            </p>
            ${paymentInstructionsHTML()}
            <img id="proofPreview" alt="Receipt preview" style="display:none;max-width:100%;max-height:220px;border-radius:10px;border:1px solid var(--line);margin-bottom:12px" />
            ${proofFormHTML()}
          </div>
        </div>

        <div id="proofHistory"></div>

        <div style="text-align:center;margin-top:14px">
          <button class="btn btn-ghost" id="lockLogout" type="button">Logout</button>
        </div>
      </div>
    </div>`;

  async function loadHistory() {
    const box = root.querySelector('#proofHistory');
    if (!box) return;
    try {
      const res = await listPaymentProofs();
      box.innerHTML = historyHTML(res.proofs || []);
    } catch {
      /* history optional hai */
    }
  }

  bindProofForm(root, { onDone: loadHistory });
  bindCopyButtons(root);
  root.querySelector('#lockLogout')?.addEventListener('click', () => {
    clearSession();
    location.href = './';
  });
  loadHistory();
}

/* Modal version used from Settings while the plan is still active. */
export function openProofModal({ onDone } = {}) {
  const backdrop = openModal({
    title: 'Payment proof bhejein',
    subtitle: 'Western Union / Meezan Bank / JazzCash receipt upload karein',
    body: `${paymentInstructionsHTML()}
      <img id="proofPreview" alt="Receipt preview" style="display:none;max-width:100%;max-height:220px;border-radius:10px;border:1px solid var(--line);margin-bottom:12px" />
      ${proofFormHTML()}`,
    footer: '<button class="btn btn-ghost" type="button" data-modal-close>Close</button>',
    onMount: (el) => {
      bindCopyButtons(el);
      bindProofForm(el, {
        onDone: async () => {
          closeModal();
          if (onDone) await onDone();
        },
      });
    },
  });
  return backdrop;
}
