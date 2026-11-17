/* ============================================================
   mhzaly — referral, commission & approval module
   ------------------------------------------------------------
   Backend logic for:
   - external sales agents (automatons) with referral codes
   - shop lifecycle: pending -> trial -> payment_due -> active
   - Stripe + manual payments
   - 30% net-commission ledger and USDC payout requests
   - price guardrails / quotes
   - owner-only admin API
   - automaton API (X-Api-Key)
   - hourly trial expiry + owner email alerts

   This file is imported by server/worker.js. All Cloudflare
   Worker / D1 primitives are passed in so the worker stays the
   single place that owns auth, responses and email transport.
   ============================================================ */

const PAYMENT_PERIOD_DAYS = 28;
const GATEWAYS = ['stripe', 'jazzcash', 'easypaisa', 'bank', 'cash', 'western_union', 'meezan', 'other'];
const PAYMENT_STATUSES = ['succeeded', 'refunded', 'disputed'];
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

export function createReferral(deps) {
  const {
    json,
    readJson,
    getClientIp,
    requireOwner,
    requireAuth,
    logAudit,
    randomId,
    addDays,
    sendOwnerEmail,
    sendEmailTo,
    defaultOwnerEmail,
    emailLayout,
    escHtml,
    HttpError,
    safeEqual,
    checkRateLimit,
    TRIAL_DAYS,
  } = deps;

  const OWNER_PANEL_URL = 'https://mhzaly.pages.dev/owner.html';

  // Payment-proof uploads: Western Union / Meezan / JazzCash receipts.
  const PROOF_CHANNELS = ['western_union', 'meezan', 'jazzcash', 'other'];
  const PROOF_MAX_BASE64 = 1000000; // ~750 KB decoded; client compresses first
  const PROOF_MIME = ['image/jpeg', 'image/png', 'image/webp'];
  const PAYOUT_DUE_HOURS = 24;
  const PROOF_REMINDER_HOURS = 12;

  /* ---------------- small helpers ---------------- */

  const nowIso = () => new Date().toISOString();

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function text(value, max = 200) {
    return String(value ?? '').trim().slice(0, max);
  }

  function upper(value, max = 3) {
    return text(value, max).toUpperCase();
  }

  function lower(value, max = 40) {
    return text(value, max).toLowerCase();
  }

  function daysLeft(end) {
    if (!end) return null;
    const ms = new Date(end).getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28);
  }

  function normalizeRefCode(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '')
      .slice(0, 32);
  }

  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function newApiKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return `mz_auto_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  function usdRateFor(env, currency, explicit) {
    const cur = upper(currency, 3);
    const given = Number(explicit);
    if (Number.isFinite(given) && given > 0) return given;
    if (cur === 'USD') return 1;
    if (env.USD_RATES) {
      try {
        const map = JSON.parse(env.USD_RATES);
        const rate = Number(map?.[cur]);
        if (Number.isFinite(rate) && rate > 0) return rate;
      } catch {
        /* ignore malformed optional env */
      }
    }
    const fallback = Number(env.USD_RATE_DEFAULT);
    if (Number.isFinite(fallback) && fallback > 0) return fallback;
    // Never silently turn a real payment into 0 USD (and lose the 30%)
    const FALLBACK_RATES = {
      PKR: 0.0036, INR: 0.012, BDT: 0.0084, AED: 0.272, SAR: 0.267,
      GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66, TRY: 0.029,
      MYR: 0.22, IDR: 0.000063, CNY: 0.14, JPY: 0.0064,
    };
    return FALLBACK_RATES[cur] || 0;
  }

  function deriveShopStatus(shop) {
    if (shop.blocked_at || shop.billing_status === 'blocked') return 'blocked';
    if (shop.status === 'pending') return 'pending';
    if (shop.status === 'rejected' || shop.billing_status === 'rejected') return 'rejected';
    if (shop.status !== 'active') return shop.status || 'inactive';
    const bs = shop.billing_status || 'trial';
    if (bs === 'payment_due' || bs === 'expired') return 'payment_due';
    if (shop.subscription_end && new Date(shop.subscription_end).getTime() < Date.now()) {
      return 'payment_due';
    }
    if (bs === 'trial') return 'trial';
    if (bs === 'active') return 'active';
    return bs || 'active';
  }

  function publicShop(shop, automatonMap) {
    const status = deriveShopStatus(shop);
    const auto = shop.referred_by && automatonMap ? automatonMap.get(shop.referred_by) : null;
    return {
      id: shop.id,
      name: shop.name,
      code: shop.code,
      email: shop.email || '',
      phone: shop.phone || '',
      country: shop.country || 'PK',
      shopType: shop.shop_type,
      status,
      billingStatus: shop.billing_status || '',
      plan: shop.plan || 'trial',
      trialDaysLeft: status === 'trial' ? daysLeft(shop.subscription_end) : null,
      paidUntil: status === 'active' ? shop.subscription_end || null : null,
      subscriptionEnd: shop.subscription_end || null,
      blockedAt: shop.blocked_at || null,
      blockReason: shop.block_reason || '',
      referredBy: shop.referred_by || null,
      referredByName: auto ? auto.name : '',
      referredByCode: auto ? auto.ref_code : '',
      lastPaymentAt: shop.last_payment_at || null,
      lastPaymentAmount: shop.last_payment_amount ?? null,
      createdAt: shop.created_at,
    };
  }

  async function getShop(env, shopId) {
    return env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(shopId).first();
  }

  async function getAutomaton(env, autoId) {
    return env.DB.prepare('SELECT * FROM automatons WHERE id = ?').bind(autoId).first();
  }

  async function automatonFinance(env, autoId) {
    const [earned, clawed, requested] = await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(amount_usd),0) AS v FROM commissions WHERE automaton_id = ? AND status = 'earned'")
        .bind(autoId)
        .first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount_usd),0) AS v FROM commissions WHERE automaton_id = ? AND status = 'clawed_back'")
        .bind(autoId)
        .first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount_usd),0) AS v FROM payout_requests WHERE automaton_id = ? AND status IN ('pending','approved','paid')")
        .bind(autoId)
        .first(),
    ]);
    const earnedUsd = round2(earned?.v || 0);
    const requestedUsd = round2(requested?.v || 0);
    return {
      earnedUsd,
      clawedBackUsd: round2(clawed?.v || 0),
      requestedUsd,
      availableUsd: round2(earnedUsd - requestedUsd),
    };
  }

  async function uniqueRefCode(env, desired, excludeId = '') {
    let code = normalizeRefCode(desired);
    if (!code) return '';
    for (let i = 0; i < 5; i += 1) {
      const row = await env.DB.prepare('SELECT id FROM automatons WHERE ref_code = ? AND id != ?')
        .bind(code, excludeId)
        .first();
      if (!row) return code;
      code = `${code.slice(0, 24)}-${crypto.randomUUID().slice(0, 4)}`;
    }
    return `${code.slice(0, 20)}-${Date.now().toString(36)}`;
  }

  async function logEmailOnce(env, { shopId, kind, refId = '' }) {
    const res = await env.DB.prepare(
      'INSERT OR IGNORE INTO email_log (id, shop_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(randomId('mail'), shopId, kind, refId, nowIso())
      .run();
    return Number(res.meta?.changes || 0) > 0;
  }

  async function sendOwnerAlert(env, { subject, intro, rows, buttons, footer }) {
    const safeRows = rows || [];
    const textLines = [
      intro,
      '',
      ...safeRows.map(([k, v]) => `${k}: ${v}`),
      '',
      `Admin panel: ${OWNER_PANEL_URL}`,
    ];
    const htmlBody = emailLayout(
      subject,
      intro,
      safeRows,
      buttons || [{ href: OWNER_PANEL_URL, label: 'Open owner panel', bg: '#0f766e' }],
      footer || 'mhzaly owner alert'
    );
    return sendOwnerEmail(env, { subject, text: textLines.join('\n'), htmlBody });
  }

  async function ownerAudit(env, auth, ip, action, targetType, targetId, details) {
    await logAudit(env, {
      actorType: 'owner',
      actorId: auth.aid,
      action,
      targetType,
      targetId,
      details: JSON.stringify(details || {}),
      ip,
    });
  }

  /* ---------------- payments & commissions ---------------- */

  async function recordPayment(env, opts) {
    const {
      shopId,
      gross,
      gatewayFee = 0,
      currency = 'PKR',
      usdRate,
      gateway = 'bank',
      gatewayRef,
      status = 'succeeded',
      receivedAt,
      actor = 'owner',
      actorId = '',
      note = '',
      plan,
      billingStatus,
      periodStart,
      periodEnd,
    } = opts || {};

    const shop = await getShop(env, shopId);
    if (!shop) throw new HttpError(404, 'Shop not found');

    const grossNum = round2(num(gross));
    if (!(grossNum > 0)) throw new HttpError(400, 'Payment amount 0 se zyada hona chahiye');
    const feeNum = Math.max(0, round2(num(gatewayFee)));
    const cur = upper(currency, 3) || 'PKR';
    const rate = usdRateFor(env, cur, usdRate);
    const gw = GATEWAYS.includes(lower(gateway)) ? lower(gateway) : 'bank';
    const ref = text(gatewayRef, 120) || `manual_${randomId('ref')}`;
    const st = PAYMENT_STATUSES.includes(lower(status)) ? lower(status) : 'succeeded';
    const received = receivedAt ? new Date(receivedAt).toISOString() : nowIso();
    const now = new Date();
    const nowStr = now.toISOString();

    const existing = await env.DB.prepare('SELECT id FROM payments WHERE gateway_ref = ?').bind(ref).first();
    if (existing) {
      return {
        duplicate: true,
        paymentId: existing.id,
        commissionUsd: 0,
        paidUntil: shop.subscription_end || null,
        netUsd: 0,
        usdRate: rate,
      };
    }

    const base = shop.subscription_end && new Date(shop.subscription_end).getTime() > now.getTime()
      ? new Date(shop.subscription_end)
      : now;
    const paidUntil = periodEnd !== undefined ? periodEnd : addDays(base, PAYMENT_PERIOD_DAYS);
    const planValue = plan || (shop.plan === 'lifetime' ? 'lifetime' : 'monthly');
    const nextBilling = billingStatus || 'active';
    const startValue = periodStart || nowStr;
    const paymentId = randomId('pmt');
    const net = Math.max(0, grossNum - feeNum);
    const netUsd = round2(net * rate);

    let commission = null;
    if (st === 'succeeded' && shop.referred_by) {
      const auto = await env.DB.prepare(
        'SELECT id, name, commission_pct, active, wallet_address FROM automatons WHERE id = ?'
      )
        .bind(shop.referred_by)
        .first();
      if (auto && Number(auto.active) === 1) {
        const pct = Math.max(0, Math.min(100, num(auto.commission_pct, 30)));
        commission = {
          id: randomId('com'),
          automatonId: auto.id,
          automatonName: auto.name,
          automatonWallet: auto.wallet_address || '',
          amountUsd: round2((netUsd * pct) / 100),
          pct,
        };
      }
    }

    const statements = [
      env.DB.prepare(
        `INSERT INTO payments
           (id, shop_id, gross, gateway_fee, currency, usd_rate, gateway, gateway_ref, status, received_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(paymentId, shopId, grossNum, feeNum, cur, rate, gw, ref, st, received, nowStr),
      env.DB.prepare(
        `UPDATE shops
         SET status = 'active', billing_status = ?, plan = ?,
             subscription_start = COALESCE(subscription_start, ?), subscription_end = ?,
             blocked_at = NULL, block_reason = NULL, last_payment_at = ?, last_payment_amount = ?
         WHERE id = ?`
      ).bind(nextBilling, planValue, startValue, paidUntil, received, grossNum, shopId),
      env.DB.prepare(
        `INSERT INTO subscription_payments
           (id, shop_id, amount, plan, period_start, period_end, method, note, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        randomId('pay'),
        shopId,
        grossNum,
        planValue,
        startValue,
        paidUntil,
        gw,
        note || `ref:${ref}`,
        nowStr,
        actorId || actor
      ),
    ];

    if (commission && commission.amountUsd > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO commissions (id, payment_id, automaton_id, amount_usd, status, created_at)
           VALUES (?, ?, ?, ?, 'earned', ?)`
        ).bind(commission.id, paymentId, commission.automatonId, commission.amountUsd, nowStr)
      );
    }

    try {
      await env.DB.batch(statements);
    } catch (err) {
      const dup = await env.DB.prepare('SELECT id FROM payments WHERE gateway_ref = ?').bind(ref).first();
      if (dup) {
        return {
          duplicate: true,
          paymentId: dup.id,
          commissionUsd: 0,
          paidUntil: shop.subscription_end || null,
          netUsd: 0,
          usdRate: rate,
        };
      }
      throw err;
    }

    // The automaton's 30% share is owed immediately. Create an approved payout
    // obligation so it shows in the owner panel and the cron can remind the
    // owner if the USDC transfer is forgotten.
    let payoutId = null;
    let payoutDueAt = null;
    if (commission && commission.amountUsd > 0) {
      payoutId = randomId('pout');
      payoutDueAt = new Date(now.getTime() + PAYOUT_DUE_HOURS * 3600000).toISOString();
      try {
        await env.DB.prepare(
          `INSERT INTO payout_requests
             (id, automaton_id, amount_usd, reason, status, created_at, due_at, payment_id, auto)
           VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, 1)`
        )
          .bind(
            payoutId,
            commission.automatonId,
            commission.amountUsd,
            `Auto ${commission.pct}% share — ${shop.name}`,
            nowStr,
            payoutDueAt,
            paymentId
          )
          .run();
      } catch {
        payoutId = null;
        payoutDueAt = null;
      }
    }

    if (await logEmailOnce(env, { shopId, kind: 'payment_received', refId: paymentId })) {
      await sendOwnerAlert(env, {
        subject: `mhzaly: Payment received — ${shop.name}`,
        intro: `Shop ${shop.name} se payment receive hui hai.`,
        rows: [
          ['Shop', shop.name],
          ['Amount', `${grossNum} ${cur}`],
          ['Gateway', gw],
          ['Net (USD)', `$${netUsd}`],
          ['Commission', commission ? `$${commission.amountUsd} (${commission.pct}%)` : '—'],
          ['Paid until', paidUntil || 'lifetime'],
        ],
      }).catch(() => {});
    }

    if (commission && payoutId) {
      await sendOwnerAlert(env, {
        subject: `mhzaly: USDC bhejni hai — ${commission.automatonName} ($${commission.amountUsd})`,
        intro: `Payment approve hui. ${commission.automatonName} ka ${commission.pct}% share USDC mein wallet par bhejein.`,
        rows: [
          ['Automaton', commission.automatonName],
          ['Amount (USDC)', `$${commission.amountUsd}`],
          ['Wallet', commission.automatonWallet || 'wallet set nahi hai'],
          ['Due by', payoutDueAt],
          ['Payment', paymentId],
        ],
        buttons: [
          { href: OWNER_PANEL_URL, label: 'Open Payouts', bg: '#0f766e' },
        ],
      }).catch(() => {});
    }

    return {
      duplicate: false,
      paymentId,
      commissionUsd: commission?.amountUsd || 0,
      paidUntil,
      netUsd,
      usdRate: rate,
      commission,
      payoutId,
      payoutDueAt,
    };
  }

  async function markPaymentStatus(env, { paymentId, gatewayRef, status }) {
    const st = PAYMENT_STATUSES.includes(lower(status)) ? lower(status) : '';
    if (!st) return null;
    let payment = null;
    if (paymentId) {
      payment = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId).first();
    }
    if (!payment && gatewayRef) {
      payment = await env.DB.prepare('SELECT * FROM payments WHERE gateway_ref = ?').bind(gatewayRef).first();
    }
    if (!payment) return null;
    await env.DB.batch([
      env.DB.prepare('UPDATE payments SET status = ? WHERE id = ?').bind(st, payment.id),
      env.DB.prepare("UPDATE commissions SET status = 'clawed_back' WHERE payment_id = ?").bind(payment.id),
    ]);
    return payment;
  }

  /* ---------------- Stripe webhook ---------------- */

  async function verifyStripeSignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    let timestamp = '';
    const signatures = [];
    for (const part of String(signatureHeader).split(',')) {
      const [key, value] = part.split('=');
      if (key === 't' && value) timestamp = value;
      if (key === 'v1' && value) signatures.push(value);
    }
    if (!timestamp || !signatures.length) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`)
    );
    const expected = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
    return signatures.some((value) => safeEqual(value, expected));
  }

  function stripeAmount(value, currency) {
    const raw = num(value, 0);
    return ZERO_DECIMAL.has(upper(currency, 3)) ? raw : raw / 100;
  }

  function stripeShopId(obj) {
    return (
      text(obj?.metadata?.shop_id, 80) ||
      text(obj?.client_reference_id, 80) ||
      text(obj?.subscription_details?.metadata?.shop_id, 80) ||
      text(obj?.parent?.subscription_details?.metadata?.shop_id, 80) ||
      ''
    );
  }

  async function handleStripeWebhook(request, env) {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return json(
        { error: 'Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET with: wrangler secret put STRIPE_WEBHOOK_SECRET' },
        503
      );
    }
    const raw = await request.text();
    const signature = request.headers.get('Stripe-Signature') || '';
    if (!(await verifyStripeSignature(raw, signature, secret))) {
      return json({ error: 'Invalid Stripe signature' }, 400);
    }

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const type = String(event.type || '');
    const obj = event.data?.object || {};

    if (type === 'checkout.session.completed') {
      if (obj.payment_status && obj.payment_status !== 'paid') {
        return json({ received: true, ignored: 'checkout not paid' });
      }
      const shopId = stripeShopId(obj);
      if (!shopId) return json({ received: true, ignored: 'missing metadata.shop_id' });
      const currency = upper(obj.currency, 3) || 'USD';
      await recordPayment(env, {
        shopId,
        gross: stripeAmount(obj.amount_total, currency),
        currency,
        gateway: 'stripe',
        gatewayRef: `stripe_session_${obj.id}`,
        receivedAt: nowIso(),
        actor: 'stripe',
        actorId: 'stripe',
        note: `Stripe checkout ${obj.id}`,
      });
      return json({ received: true });
    }

    if (type === 'payment_intent.succeeded') {
      const shopId = stripeShopId(obj);
      if (!shopId) return json({ received: true, ignored: 'missing metadata.shop_id' });
      const currency = upper(obj.currency, 3) || 'USD';
      await recordPayment(env, {
        shopId,
        gross: stripeAmount(obj.amount_received ?? obj.amount, currency),
        currency,
        gateway: 'stripe',
        gatewayRef: `stripe_pi_${obj.id}`,
        receivedAt: nowIso(),
        actor: 'stripe',
        actorId: 'stripe',
        note: `Stripe payment intent ${obj.id}`,
      });
      return json({ received: true });
    }

    if (type === 'invoice.paid') {
      const shopId = stripeShopId(obj);
      if (!shopId) return json({ received: true, ignored: 'missing metadata.shop_id' });
      const currency = upper(obj.currency, 3) || 'USD';
      await recordPayment(env, {
        shopId,
        gross: stripeAmount(obj.amount_paid, currency),
        currency,
        gateway: 'stripe',
        gatewayRef: `stripe_invoice_${obj.id}`,
        receivedAt: nowIso(),
        actor: 'stripe',
        actorId: 'stripe',
        note: `Stripe invoice ${obj.id}`,
      });
      return json({ received: true });
    }

    if (type === 'charge.refunded') {
      const pi = text(obj.payment_intent, 120);
      const chargeId = text(obj.id, 120);
      const updated =
        (pi && (await markPaymentStatus(env, { gatewayRef: `stripe_pi_${pi}`, status: 'refunded' }))) ||
        (chargeId && (await markPaymentStatus(env, { gatewayRef: `stripe_charge_${chargeId}`, status: 'refunded' }))) ||
        (pi && (await markPaymentStatus(env, { gatewayRef: `stripe_session_${pi}`, status: 'refunded' })));
      return json({ received: true, updated: Boolean(updated) });
    }

    if (type === 'charge.dispute.created') {
      const pi = text(obj.payment_intent, 120);
      const chargeId = text(obj.charge, 120);
      const updated =
        (pi && (await markPaymentStatus(env, { gatewayRef: `stripe_pi_${pi}`, status: 'disputed' }))) ||
        (chargeId && (await markPaymentStatus(env, { gatewayRef: `stripe_charge_${chargeId}`, status: 'disputed' })));
      return json({ received: true, updated: Boolean(updated) });
    }

    return json({ received: true, ignored: type || 'unknown event' });
  }

  /* ---------------- automaton authentication ---------------- */

  async function authAutomaton(request, env) {
    const key = text(request.headers.get('X-Api-Key'), 200);
    if (!key) throw new HttpError(401, 'X-Api-Key header required');
    const hash = await sha256Hex(key);
    const row = await env.DB.prepare(
      'SELECT * FROM automatons WHERE api_key_hash = ? AND active = 1'
    )
      .bind(hash)
      .first();
    if (!row) throw new HttpError(401, 'Invalid or inactive API key');

    const ip = getClientIp(request);
    const limit = await checkRateLimit(env, ip, `automaton:${row.id}`);
    if (!limit.ok) throw new HttpError(429, 'Rate limit exceeded — try again in a minute');
    return row;
  }

  /* ---------------- owner admin endpoints ---------------- */

  async function handleOwnerReferralOverview(request, env) {
    await requireOwner(request, env);

    const [shopsRows, autosRows, quotesRows, limitsRows, payoutRows, paymentRows, proofRows] = await Promise.all([
      env.DB.prepare(
        `SELECT id, name, code, email, phone, shop_type, status, plan, billing_status,
                subscription_start, subscription_end, blocked_at, block_reason,
                last_payment_at, last_payment_amount, created_at, referred_by, country
         FROM shops ORDER BY created_at DESC`
      ).all(),
      env.DB.prepare(
        `SELECT id, name, ref_code, wallet_address, commission_pct, active, created_at
         FROM automatons ORDER BY created_at DESC`
      ).all(),
      env.DB.prepare(
        `SELECT q.*, s.name AS shop_name, s.code AS shop_code, a.name AS automaton_name
         FROM price_quotes q
         LEFT JOIN shops s ON s.id = q.shop_id
         LEFT JOIN automatons a ON a.id = q.automaton_id
         ORDER BY q.created_at DESC LIMIT 200`
      ).all(),
      env.DB.prepare('SELECT * FROM price_limits ORDER BY country, currency').all(),
      env.DB.prepare(
        `SELECT p.*, a.name AS automaton_name
         FROM payout_requests p
         LEFT JOIN automatons a ON a.id = p.automaton_id
         ORDER BY p.created_at DESC LIMIT 200`
      ).all(),
      env.DB.prepare(
        `SELECT p.*, s.name AS shop_name, s.code AS shop_code,
                c.amount_usd AS commission_usd, c.status AS commission_status
         FROM payments p
         LEFT JOIN shops s ON s.id = p.shop_id
         LEFT JOIN commissions c ON c.payment_id = p.id
         ORDER BY p.received_at DESC LIMIT 300`
      ).all(),
      env.DB.prepare(
        `SELECT pr.*, s.name AS shop_name, s.code AS shop_code, s.phone AS shop_phone
         FROM payment_proofs pr
         LEFT JOIN shops s ON s.id = pr.shop_id
         ORDER BY CASE pr.status WHEN 'pending' THEN 0 ELSE 1 END, pr.created_at DESC
         LIMIT 100`
      ).all(),
    ]);

    const autos = autosRows.results || [];
    const autoMap = new Map(autos.map((a) => [a.id, a]));
    const automatons = [];
    for (const a of autos) {
      const finance = await automatonFinance(env, a.id);
      const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM shops WHERE referred_by = ?')
        .bind(a.id)
        .first();
      automatons.push({
        id: a.id,
        name: a.name,
        refCode: a.ref_code,
        walletAddress: a.wallet_address || '',
        commissionPct: num(a.commission_pct, 30),
        active: Number(a.active) === 1,
        createdAt: a.created_at,
        shopsCount: Number(count?.c || 0),
        ...finance,
      });
    }

    const shops = (shopsRows.results || []).map((s) => publicShop(s, autoMap));
    const pendingShops = shops.filter((s) => s.status === 'pending');
    const onTrial = shops.filter((s) => s.status === 'trial').length;
    const paymentDue = shops.filter((s) => s.status === 'payment_due').length;
    const automatonAvailable = round2(
      automatons.reduce((sum, a) => sum + a.availableUsd, 0)
    );

    const quotes = (quotesRows.results || []).map((q) => ({
      id: q.id,
      shopId: q.shop_id,
      shopName: q.shop_name || '',
      shopCode: q.shop_code || '',
      automatonId: q.automaton_id,
      automatonName: q.automaton_name || '',
      amount: num(q.amount),
      currency: q.currency,
      status: q.status,
      createdAt: q.created_at,
      decidedAt: q.decided_at || null,
    }));

    const priceLimits = (limitsRows.results || []).map((l) => ({
      id: l.id,
      country: l.country,
      currency: l.currency,
      minPrice: num(l.min_price),
      maxPrice: num(l.max_price),
      updatedAt: l.updated_at,
    }));

    const payouts = (payoutRows.results || []).map((p) => ({
      id: p.id,
      automatonId: p.automaton_id,
      automatonName: p.automaton_name || '',
      amountUsd: num(p.amount_usd),
      reason: p.reason || '',
      status: p.status,
      txHash: p.tx_hash || '',
      createdAt: p.created_at,
      decidedAt: p.decided_at || null,
    }));

    const payments = (paymentRows.results || []).map((p) => {
      const gross = num(p.gross);
      const fee = num(p.gateway_fee);
      const rate = num(p.usd_rate);
      return {
        id: p.id,
        shopId: p.shop_id,
        shopName: p.shop_name || '',
        shopCode: p.shop_code || '',
        gross,
        gatewayFee: fee,
        currency: p.currency,
        usdRate: rate,
        gateway: p.gateway,
        gatewayRef: p.gateway_ref,
        status: p.status,
        receivedAt: p.received_at,
        net: round2(gross - fee),
        netUsd: round2((gross - fee) * rate),
        commissionUsd: p.commission_usd == null ? null : num(p.commission_usd),
        commissionStatus: p.commission_status || null,
      };
    });

    const proofs = (proofRows.results || []).map((p) => ({
      id: p.id,
      shopId: p.shop_id,
      shopName: p.shop_name || '',
      shopCode: p.shop_code || '',
      shopPhone: p.shop_phone || '',
      amount: num(p.amount),
      currency: p.currency,
      channel: p.channel,
      channelLabel: channelLabel(p.channel),
      senderName: p.sender_name || '',
      reference: p.reference || '',
      note: p.note || '',
      status: p.status,
      rejectReason: p.reject_reason || '',
      paymentId: p.payment_id || '',
      createdAt: p.created_at,
      reviewedAt: p.reviewed_at || null,
    }));

    return json({
      cards: {
        pendingApprovals: pendingShops.length,
        pendingProofs: proofs.filter((p) => p.status === 'pending').length,
        onTrial,
        paymentDue,
        automatonAvailable,
      },
      pendingShops,
      shops,
      quotes,
      priceLimits,
      automatons,
      payouts,
      payments,
      proofs,
    });
  }

  async function handleOwnerReferralShop(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const shopId = text(body.shopId, 80);
    const action = lower(body.action, 30);
    if (!shopId) throw new HttpError(400, 'shopId required');
    if (!action) throw new HttpError(400, 'action required');

    const shop = await getShop(env, shopId);
    if (!shop) throw new HttpError(404, 'Shop not found');
    const now = new Date();
    const nowStr = now.toISOString();

    if (action === 'approve') {
      if (shop.status === 'rejected') {
        throw new HttpError(409, 'Rejected shop ko approve nahi kiya ja sakta — dobara signup karwayein.');
      }
      const trialEnd = addDays(now, TRIAL_DAYS);
      await env.DB.prepare(
        `UPDATE shops
         SET status = 'active', billing_status = 'trial',
             approved_at = COALESCE(approved_at, ?),
             subscription_start = COALESCE(subscription_start, ?), subscription_end = ?,
             confirm_token = NULL, confirm_expires = NULL,
             blocked_at = NULL, block_reason = NULL
         WHERE id = ?`
      )
        .bind(nowStr, nowStr, trialEnd, shopId)
        .run();
      await ownerAudit(env, auth, ip, 'referral_approve', 'shop', shopId, {
        shopName: shop.name,
        trialDays: TRIAL_DAYS,
        trialEnd,
      });
      return json({ ok: true, trialEnd });
    }

    if (action === 'reject') {
      await env.DB.prepare(
        `UPDATE shops
         SET status = 'rejected', billing_status = 'rejected',
             confirm_token = NULL, confirm_expires = NULL
         WHERE id = ?`
      )
        .bind(shopId)
        .run();
      await ownerAudit(env, auth, ip, 'referral_reject', 'shop', shopId, {
        shopName: shop.name,
      });
      return json({ ok: true });
    }

    if (action === 'block') {
      const reason = text(body.reason, 200) || 'Blocked by owner';
      await env.DB.prepare(
        "UPDATE shops SET billing_status = 'blocked', blocked_at = ?, block_reason = ? WHERE id = ?"
      )
        .bind(nowStr, reason, shopId)
        .run();
      await ownerAudit(env, auth, ip, 'referral_block', 'shop', shopId, {
        shopName: shop.name,
        reason,
      });
      return json({ ok: true });
    }

    if (action === 'unblock') {
      let next = 'payment_due';
      if (shop.plan === 'lifetime' || !shop.subscription_end) {
        next = 'active';
      } else if (new Date(shop.subscription_end).getTime() > now.getTime()) {
        next = shop.plan === 'trial' ? 'trial' : 'active';
      }
      await env.DB.prepare(
        'UPDATE shops SET billing_status = ?, blocked_at = NULL, block_reason = NULL WHERE id = ?'
      )
        .bind(next, shopId)
        .run();
      await ownerAudit(env, auth, ip, 'referral_unblock', 'shop', shopId, {
        shopName: shop.name,
        restoredStatus: next,
      });
      return json({ ok: true, billingStatus: next });
    }

    if (action === 'mark_paid' || action === 'record_payment') {
      const result = await recordPayment(env, {
        shopId,
        gross: body.gross ?? body.amount,
        gatewayFee: body.gatewayFee ?? body.fee ?? 0,
        currency: body.currency || 'PKR',
        usdRate: body.usdRate ?? body.usd_rate,
        gateway: body.gateway || body.method || 'bank',
        gatewayRef: body.reference || body.gatewayRef,
        status: 'succeeded',
        receivedAt: nowStr,
        actor: 'owner',
        actorId: auth.aid,
        note: text(body.note, 200),
      });
      await ownerAudit(env, auth, ip, 'referral_mark_paid', 'shop', shopId, {
        shopName: shop.name,
        paymentId: result.paymentId,
        duplicate: Boolean(result.duplicate),
        gross: num(body.gross ?? body.amount),
        currency: upper(body.currency, 3) || 'PKR',
      });
      return json({ ok: true, ...result });
    }

    throw new HttpError(400, 'Unknown shop action');
  }

  async function handleOwnerReferralAutomaton(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const id = text(body.id, 80);
    const name = text(body.name, 80);
    const walletAddress = text(body.walletAddress, 200);
    const commissionPct = Math.max(0, Math.min(100, num(body.commissionPct, 30)));

    if (!name) throw new HttpError(400, 'Automaton name required');

    if (id) {
      const existing = await getAutomaton(env, id);
      if (!existing) throw new HttpError(404, 'Automaton not found');
      let refCode = existing.ref_code;
      if (body.refCode !== undefined) {
        const desired = normalizeRefCode(body.refCode);
        if (desired && desired !== existing.ref_code) {
          refCode = await uniqueRefCode(env, desired, id);
          if (!refCode) throw new HttpError(400, 'refCode sahi nahi hai');
        }
      }
      const active = body.active === undefined ? Number(existing.active) : body.active ? 1 : 0;
      await env.DB.prepare(
        `UPDATE automatons
         SET name = ?, ref_code = ?, wallet_address = ?, commission_pct = ?, active = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(name, refCode, walletAddress, commissionPct, active, nowIso(), id)
        .run();
      await ownerAudit(env, auth, ip, 'referral_automaton_update', 'automaton', id, {
        name,
        refCode,
        commissionPct,
        active,
      });
      return json({ ok: true, automaton: { id, name, refCode, walletAddress, commissionPct, active: active === 1 } });
    }

    const desired = normalizeRefCode(body.refCode) || slugify(name) || 'agent';
    const refCode = await uniqueRefCode(env, desired);
    if (!refCode) throw new HttpError(400, 'refCode sahi nahi hai');
    const apiKey = newApiKey();
    const apiKeyHash = await sha256Hex(apiKey);
    const newId = randomId('auto');
    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO automatons
         (id, name, ref_code, wallet_address, api_key_hash, commission_pct, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(newId, name, refCode, walletAddress, apiKeyHash, commissionPct, ts, ts)
      .run();
    await ownerAudit(env, auth, ip, 'referral_automaton_create', 'automaton', newId, {
      name,
      refCode,
      commissionPct,
    });
    return json(
      {
        ok: true,
        automaton: { id: newId, name, refCode, walletAddress, commissionPct, active: true },
        apiKey,
        warning: 'Ye API key sirf ab dikhegi. Abhi copy karein — dobara nahi milegi.',
      },
      201
    );
  }

  async function handleOwnerReferralAutomatonKey(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const id = text(body.id, 80);
    if (!id) throw new HttpError(400, 'id required');
    const auto = await getAutomaton(env, id);
    if (!auto) throw new HttpError(404, 'Automaton not found');
    const apiKey = newApiKey();
    const hash = await sha256Hex(apiKey);
    await env.DB.prepare('UPDATE automatons SET api_key_hash = ?, updated_at = ? WHERE id = ?')
      .bind(hash, nowIso(), id)
      .run();
    await ownerAudit(env, auth, ip, 'referral_automaton_key_rotate', 'automaton', id, {
      name: auto.name,
    });
    return json({
      ok: true,
      apiKey,
      warning: 'Purani API key ab kaam nahi karegi. Nayi key abhi copy karein.',
    });
  }

  async function handleOwnerReferralPrice(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const country = upper(body.country, 2);
    const currency = upper(body.currency, 3);
    const minPrice = round2(num(body.minPrice ?? body.min_price));
    const maxPrice = round2(num(body.maxPrice ?? body.max_price));

    if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Country 2-letter code hona chahiye (misal PK)');
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency 3-letter code hona chahiye (misal PKR)');
    if (minPrice < 0) throw new HttpError(400, 'Minimum price negative nahi ho sakti');
    if (maxPrice < minPrice) throw new HttpError(400, 'Maximum price minimum se kam nahi ho sakti');

    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO price_limits (id, country, currency, min_price, max_price, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(country, currency) DO UPDATE SET
         min_price = excluded.min_price,
         max_price = excluded.max_price,
         updated_at = excluded.updated_at`
    )
      .bind(randomId('plim'), country, currency, minPrice, maxPrice, ts, ts)
      .run();
    await ownerAudit(env, auth, ip, 'referral_price_save', 'price_limit', `${country}:${currency}`, {
      country,
      currency,
      minPrice,
      maxPrice,
    });
    return json({ ok: true, priceLimit: { country, currency, minPrice, maxPrice } });
  }

  async function handleOwnerReferralQuote(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const id = text(body.id, 80);
    const action = lower(body.action, 20);
    if (!id) throw new HttpError(400, 'id required');
    if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'action approve ya reject hona chahiye');
    const quote = await env.DB.prepare('SELECT * FROM price_quotes WHERE id = ?').bind(id).first();
    if (!quote) throw new HttpError(404, 'Quote not found');
    const status = action === 'approve' ? 'approved' : 'rejected';
    await env.DB.prepare('UPDATE price_quotes SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
      .bind(status, nowIso(), auth.aid, id)
      .run();
    await ownerAudit(env, auth, ip, 'referral_quote_decision', 'price_quote', id, {
      action,
      amount: num(quote.amount),
      currency: quote.currency,
    });
    return json({ ok: true, status });
  }

  async function handleOwnerReferralPayout(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const id = text(body.id, 80);
    const action = lower(body.action, 20);
    if (!id) throw new HttpError(400, 'id required');
    if (!['approve', 'reject', 'paid'].includes(action)) {
      throw new HttpError(400, 'action approve, reject ya paid hona chahiye');
    }
    const payout = await env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(id).first();
    if (!payout) throw new HttpError(404, 'Payout request not found');
    const now = nowIso();

    if (action === 'paid') {
      const txHash = text(body.txHash, 200);
      await env.DB.prepare(
        "UPDATE payout_requests SET status = 'paid', tx_hash = ?, decided_at = ?, decided_by = ? WHERE id = ?"
      )
        .bind(txHash || null, now, auth.aid, id)
        .run();
    } else {
      const status = action === 'approve' ? 'approved' : 'rejected';
      await env.DB.prepare(
        'UPDATE payout_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?'
      )
        .bind(status, now, auth.aid, id)
        .run();
    }
    await ownerAudit(env, auth, ip, `referral_payout_${action}`, 'payout_request', id, {
      amountUsd: num(payout.amount_usd),
      automatonId: payout.automaton_id,
    });
    return json({ ok: true });
  }

  /* ---------------- payment proofs (Western Union / Meezan / JazzCash) ---------------- */

  function channelLabel(channel) {
    const map = {
      western_union: 'Western Union',
      meezan: 'Meezan Bank',
      jazzcash: 'JazzCash',
      other: 'Other',
    };
    return map[channel] || 'Other';
  }

  function parseProofImage(value) {
    let raw = String(value || '').trim();
    if (!raw) throw new HttpError(400, 'Receipt ki image zaroori hai');
    let mime = 'image/jpeg';
    const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i);
    if (match) {
      mime = match[1].toLowerCase();
      raw = match[2];
    }
    raw = raw.replace(/\s+/g, '');
    if (!PROOF_MIME.includes(mime)) throw new HttpError(400, 'Sirf JPG, PNG ya WEBP image chalegi');
    if (raw.length > PROOF_MAX_BASE64) {
      throw new HttpError(413, 'Receipt image bohat bari hai — chhoti image bhejein');
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(raw)) throw new HttpError(400, 'Receipt image sahi nahi hai');
    return { mime, data: raw, bytes: Math.round((raw.length * 3) / 4) };
  }

  async function handleShopProofSubmit(request, env) {
    const auth = await requireAuth(request, env);
    const shop = await getShop(env, auth.sid);
    if (!shop) throw new HttpError(401, 'Shop not found');

    const ip = getClientIp(request);
    const rate = await checkRateLimit(env, ip, 'payment-proof');
    if (!rate.ok) throw new HttpError(429, 'Zyada proofs bhej diye — thodi der baad koshish karein');

    const body = await readJson(request, PROOF_MAX_BASE64 + 200000);
    const amount = round2(num(body.amount));
    if (!(amount > 0)) throw new HttpError(400, 'Payment amount 0 se zyada hona chahiye');
    const currency = upper(body.currency, 3) || 'PKR';
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency sahi nahi hai (misal PKR)');
    const channel = PROOF_CHANNELS.includes(lower(body.channel)) ? lower(body.channel) : 'other';
    const senderName = text(body.senderName, 80);
    const reference = text(body.reference, 120);
    const note = text(body.note, 300);
    const img = parseProofImage(body.image);

    const id = randomId('proof');
    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO payment_proofs
         (id, shop_id, amount, currency, channel, sender_name, reference, note,
          image_mime, image_data, image_bytes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
      .bind(id, shop.id, amount, currency, channel, senderName, reference, note, img.mime, img.data, img.bytes, ts)
      .run();

    await logAudit(env, {
      actorType: 'shop',
      actorId: shop.id,
      action: 'payment_proof_submit',
      targetType: 'payment_proof',
      targetId: id,
      details: JSON.stringify({ amount, currency, channel }),
      ip,
    });

    if (await logEmailOnce(env, { shopId: shop.id, kind: 'proof_submitted', refId: id })) {
      await sendOwnerAlert(env, {
        subject: `mhzaly: Payment proof — ${shop.name} (${amount} ${currency})`,
        intro: 'Naya payment receipt aaya hai. Owner panel se check karke 24 ghante ke andar plan activate karein.',
        rows: [
          ['Shop', shop.name],
          ['Code', shop.code],
          ['Amount', `${amount} ${currency}`],
          ['Channel', channelLabel(channel)],
          ['Sender', senderName || '—'],
          ['Reference', reference || '—'],
          ['Phone', shop.phone || '—'],
        ],
        buttons: [{ href: OWNER_PANEL_URL, label: 'Check proof & activate', bg: '#0f766e' }],
      }).catch(() => {});
    }

    return json(
      {
        ok: true,
        proof: { id, status: 'pending', amount, currency, channel, createdAt: ts },
        message: 'Proof bhej diya gaya. Owner 24 ghante mein check karke plan activate karega.',
      },
      201
    );
  }

  async function handleShopProofs(request, env) {
    const auth = await requireAuth(request, env);
    const rows = await env.DB.prepare(
      `SELECT id, amount, currency, channel, sender_name, reference, note, status,
              reject_reason, created_at, reviewed_at
       FROM payment_proofs WHERE shop_id = ? ORDER BY created_at DESC LIMIT 20`
    )
      .bind(auth.sid)
      .all();
    return json({
      proofs: (rows.results || []).map((p) => ({
        id: p.id,
        amount: num(p.amount),
        currency: p.currency,
        channel: p.channel,
        channelLabel: channelLabel(p.channel),
        senderName: p.sender_name || '',
        reference: p.reference || '',
        note: p.note || '',
        status: p.status,
        rejectReason: p.reject_reason || '',
        createdAt: p.created_at,
        reviewedAt: p.reviewed_at || null,
      })),
    });
  }

  async function handleOwnerProofImage(request, env) {
    await requireOwner(request, env);
    const url = new URL(request.url);
    const id = text(url.searchParams.get('id'), 80);
    if (!id) throw new HttpError(400, 'id required');
    const row = await env.DB.prepare(
      'SELECT image_mime, image_data FROM payment_proofs WHERE id = ?'
    )
      .bind(id)
      .first();
    if (!row) throw new HttpError(404, 'Proof not found');
    return json({ mime: row.image_mime, data: row.image_data });
  }

  async function handleOwnerProofAction(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const id = text(body.id, 80);
    const action = lower(body.action, 20);
    if (!id) throw new HttpError(400, 'id required');
    if (!['approve', 'reject'].includes(action)) {
      throw new HttpError(400, 'action approve ya reject hona chahiye');
    }
    const proof = await env.DB.prepare('SELECT * FROM payment_proofs WHERE id = ?').bind(id).first();
    if (!proof) throw new HttpError(404, 'Proof not found');
    if (proof.status !== 'pending') throw new HttpError(409, 'Ye proof pehle hi review ho chuka hai');

    const now = nowIso();
    if (action === 'reject') {
      const reason = text(body.reason, 200) || 'Owner ne reject kiya';
      await env.DB.prepare(
        "UPDATE payment_proofs SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
      )
        .bind(reason, auth.aid, now, id)
        .run();
      await ownerAudit(env, auth, ip, 'payment_proof_reject', 'payment_proof', id, {
        shopId: proof.shop_id,
        reason,
      });
      return json({ ok: true, status: 'rejected' });
    }

    const amount = round2(num(body.amount ?? proof.amount));
    const currency = upper(body.currency, 3) || proof.currency || 'PKR';
    const refBase = text(body.reference, 100) || proof.reference || '';
    const gatewayRef = text(`proof_${id}${refBase ? `_${refBase}` : ''}`, 120);
    const result = await recordPayment(env, {
      shopId: proof.shop_id,
      gross: amount,
      gatewayFee: body.gatewayFee ?? body.fee ?? 0,
      currency,
      usdRate: body.usdRate ?? body.usd_rate,
      gateway: body.gateway || proof.channel,
      gatewayRef,
      status: 'succeeded',
      receivedAt: now,
      actor: 'owner',
      actorId: auth.aid,
      note: text(body.note, 200) || `Proof ${id} — ${channelLabel(proof.channel)}`,
    });

    await env.DB.prepare(
      "UPDATE payment_proofs SET status = 'approved', payment_id = ?, reject_reason = NULL, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
    )
      .bind(result.paymentId, auth.aid, now, id)
      .run();

    await ownerAudit(env, auth, ip, 'payment_proof_approve', 'payment_proof', id, {
      shopId: proof.shop_id,
      paymentId: result.paymentId,
      amount,
      currency,
      commissionUsd: result.commissionUsd,
    });

    return json({ ok: true, status: 'approved', ...result });
  }

  /* ---------------- AI agent: payment checker & commission guide ---------------- */

  function agentNoIntent(m) {
    return /(nahi|nahin|nai|\bni\b|\bno\b|not received|nahi mila|nahi aya|nahi aayi)/i.test(m);
  }

  function agentYesIntent(m) {
    return /(haan|\bhan\b|\bha\b|\byes\b|yeah|yep|mila|mil gaya|milgaya|aa gayi|aagayi|agyi|received|confirm|theek hai|sahi hai)/i.test(m);
  }

  async function agentSnapshot(env) {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();

    const proofRes = await env.DB.prepare(
      `SELECT pr.id, pr.amount, pr.currency, pr.channel, pr.sender_name, pr.reference,
              pr.note, pr.created_at, pr.shop_id,
              s.name AS shop_name, s.code AS shop_code, s.phone AS shop_phone,
              a.id AS automaton_id, a.name AS automaton_name,
              a.wallet_address, a.commission_pct
         FROM payment_proofs pr
         LEFT JOIN shops s ON s.id = pr.shop_id
         LEFT JOIN automatons a ON a.id = s.referred_by
        WHERE pr.status = 'pending'
        ORDER BY pr.created_at ASC LIMIT 50`
    ).all();

    const payoutRes = await env.DB.prepare(
      `SELECT p.id, p.amount_usd, p.due_at, p.created_at, p.status, p.payment_id,
              a.id AS automaton_id, a.name AS automaton_name, a.wallet_address
         FROM payout_requests p
         LEFT JOIN automatons a ON a.id = p.automaton_id
        WHERE p.status IN ('approved', 'pending')
        ORDER BY p.created_at ASC LIMIT 50`
    ).all();

    const expiringRes = await env.DB.prepare(
      `SELECT id, name, code, subscription_end
         FROM shops
        WHERE status = 'active' AND blocked_at IS NULL
          AND billing_status = 'trial'
          AND subscription_end IS NOT NULL AND subscription_end <= ?
        ORDER BY subscription_end ASC LIMIT 20`
    )
      .bind(soon)
      .all();

    const automatonRes = await env.DB.prepare(
      `SELECT a.id, a.name, a.ref_code, a.active, a.wallet_address, a.commission_pct,
              (SELECT COUNT(*) FROM shops s WHERE s.referred_by = a.id) AS shops,
              (SELECT COUNT(*) FROM shops s WHERE s.referred_by = a.id AND s.status = 'active') AS active_shops,
              (SELECT COALESCE(SUM(c.amount_usd), 0) FROM commissions c
                WHERE c.automaton_id = a.id AND c.status = 'earned') AS earned_usd,
              (SELECT MAX(c.created_at) FROM commissions c WHERE c.automaton_id = a.id) AS last_commission
         FROM automatons a
        ORDER BY a.created_at DESC LIMIT 50`
    ).all();

    const proofs = (proofRes.results || []).map((p) => {
      const rate = usdRateFor(env, p.currency);
      const pct = Math.max(0, Math.min(100, num(p.commission_pct, 30)));
      return {
        id: p.id,
        shopId: p.shop_id,
        shopName: p.shop_name || 'Shop',
        shopCode: p.shop_code || '',
        shopPhone: p.shop_phone || '',
        amount: num(p.amount),
        currency: p.currency || 'PKR',
        channel: p.channel,
        channelLabel: channelLabel(p.channel),
        senderName: p.sender_name || '',
        reference: p.reference || '',
        note: p.note || '',
        createdAt: p.created_at,
        automatonId: p.automaton_id || null,
        automatonName: p.automaton_name || '',
        walletAddress: p.wallet_address || '',
        commissionPct: pct,
        estimatedCommissionUsd: round2((num(p.amount) * rate * pct) / 100),
      };
    });

    const payouts = (payoutRes.results || []).map((p) => ({
      id: p.id,
      amountUsd: num(p.amount_usd),
      dueAt: p.due_at || null,
      createdAt: p.created_at,
      status: p.status,
      paymentId: p.payment_id || '',
      automatonId: p.automaton_id || null,
      automatonName: p.automaton_name || '',
      walletAddress: p.wallet_address || '',
    }));

    const walletMap = new Map();
    for (const p of payouts) {
      if (!p.automatonId) continue;
      const entry = walletMap.get(p.automatonId) || {
        automatonId: p.automatonId,
        automatonName: p.automatonName,
        walletAddress: p.walletAddress,
        amountUsd: 0,
        payoutIds: [],
      };
      entry.amountUsd = round2(entry.amountUsd + p.amountUsd);
      entry.payoutIds.push(p.id);
      if (p.walletAddress) entry.walletAddress = p.walletAddress;
      walletMap.set(p.automatonId, entry);
    }

    const wallets = [...walletMap.values()];
    const unpaidUsd = round2(wallets.reduce((sum, w) => sum + w.amountUsd, 0));

    const automatons = (automatonRes.results || []).map((a) => ({
      id: a.id,
      name: a.name,
      refCode: a.ref_code || '',
      active: Number(a.active) === 1,
      walletAddress: a.wallet_address || '',
      commissionPct: num(a.commission_pct, 30),
      shops: Number(a.shops || 0),
      activeShops: Number(a.active_shops || 0),
      earnedUsd: round2(num(a.earned_usd)),
      lastCommissionAt: a.last_commission || null,
    }));

    return {
      generatedAt: nowIso(),
      summary: {
        pendingProofs: proofs.length,
        pendingPayouts: payouts.length,
        unpaidUsd,
        wallets,
        expiring: (expiringRes.results || []).length,
        automatons: automatons.length,
        automatonsWithIssues: automatons.filter((a) => !a.active || !a.walletAddress || !a.shops).length,
      },
      proofs,
      payouts,
      expiring: (expiringRes.results || []).map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        endsAt: s.subscription_end,
      })),
      automatons,
    };
  }

  function agentWalletReply(snap) {
    if (!snap.summary.wallets.length) {
      if (snap.proofs.length && snap.proofs.some((p) => p.automatonName)) {
        return [
          'Abhi tak koi commission payout bana nahi — pehle payment confirm karein.',
          '',
          ...snap.proofs
            .filter((p) => p.automatonName)
            .map((p) => `• ${p.automatonName}: ~US$ ${p.estimatedCommissionUsd.toFixed(2)} → ${p.walletAddress || 'wallet set nahi'}`),
        ].join('\n');
      }
      return 'Abhi koi USDC wallet pending nahi hai. Jab commission banega, wallet address yahan aa jayega.';
    }
    return [
      '*USDC wallet addresses:*',
      ...snap.summary.wallets.map(
        (w) => `• ${w.automatonName || 'Automaton'} — US$ ${w.amountUsd.toFixed(2)} → ${w.walletAddress || 'wallet set nahi'}`
      ),
      '',
      'USDC bhejne ke baad Payouts tab se "Mark paid" karein.',
    ].join('\n');
  }

  function agentAutomatonReply(snap) {
    const list = snap.automatons || [];
    if (!list.length) {
      return 'Abhi koi automaton nahi bana. Referral → Automatons tab se naya automaton banayein.';
    }
    const lines = ['*Automaton health check:*'];
    for (const a of list) {
      const issues = [];
      if (!a.active) issues.push('inactive');
      if (!a.walletAddress) issues.push('USDC wallet missing');
      if (!a.shops) issues.push('koi shop refer nahi ki');
      lines.push(
        `• ${issues.length ? '⚠️' : '✅'} ${a.name} (${a.refCode || 'no code'}) — ` +
          `${a.active ? 'active' : 'inactive'}, ${a.shops} shop (${a.activeShops} active), ` +
          `earned US$ ${a.earnedUsd.toFixed(2)}, wallet ${a.walletAddress || 'set nahi'}`
      );
      if (issues.length) lines.push(`   → fix: ${issues.join(', ')}`);
    }
    const broken = list.filter((a) => !a.active || !a.walletAddress || !a.shops).length;
    lines.push('');
    lines.push(
      broken
        ? `${broken} automaton(s) mein issue hai — upar fix list dekhein.`
        : 'Sab automatons theek kaam kar rahe hain ✅'
    );
    return lines.join('\n');
  }

  function agentStatusReply(snap) {
    if (!snap.proofs.length && !snap.payouts.length) {
      return 'Abhi koi pending payment ya commission nahi hai. Sab clear hai ✅';
    }
    const lines = [];
    if (snap.proofs.length) {
      lines.push(`*Payment check pending (${snap.proofs.length}):*`);
      snap.proofs.forEach((p, i) => {
        lines.push(
          `${i + 1}. ${p.shopName} — ${p.amount} ${p.currency} (${p.channelLabel})` +
            (p.automatonName ? ` · ${p.automatonName}` : ' · direct shop')
        );
      });
      lines.push('');
      lines.push('Bataiye: paisa mil gaya? "Haan mila" ya "Nahi mila".');
    }
    if (snap.payouts.length) {
      lines.push('');
      lines.push(`*USDC pending (${snap.payouts.length}):*`);
      for (const w of snap.summary.wallets) {
        lines.push(`• ${w.automatonName || 'Automaton'} — US$ ${w.amountUsd.toFixed(2)} → ${w.walletAddress || 'wallet set nahi'}`);
      }
    }
    if (snap.expiring.length) {
      lines.push('');
      lines.push(`*Trial khatam ho raha hai (${snap.expiring.length}):*`);
      snap.expiring.slice(0, 5).forEach((s) => lines.push(`• ${s.name} — ${s.endsAt}`));
    }
    return lines.join('\n');
  }

  async function agentApproveProof(env, auth, ip, proof) {
    const now = nowIso();
    const result = await recordPayment(env, {
      shopId: proof.shopId,
      gross: proof.amount,
      gatewayFee: 0,
      currency: proof.currency,
      gateway: proof.channel,
      gatewayRef: `proof_${proof.id}`,
      status: 'succeeded',
      receivedAt: now,
      actor: 'owner',
      actorId: auth.aid,
      note: `AI agent confirmed — proof ${proof.id}`,
    });

    await env.DB.prepare(
      `UPDATE payment_proofs
          SET status = 'approved', payment_id = ?, reject_reason = NULL, reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND status = 'pending'`
    )
      .bind(result.paymentId, auth.aid, now, proof.id)
      .run();

    await ownerAudit(env, auth, ip, 'agent_payment_confirm', 'payment_proof', proof.id, {
      shopId: proof.shopId,
      paymentId: result.paymentId,
      commissionUsd: result.commissionUsd,
    });

    return result;
  }

  async function sendAgentDigest(env, snap, { force = false } = {}) {
    if (!snap.proofs.length && !snap.payouts.length) return { ok: false, empty: true };
    if (!force) {
      const dateKey = new Date().toISOString().slice(0, 10);
      const inserted = await logEmailOnce(env, { shopId: 'owner', kind: 'agent_daily', refId: dateKey });
      if (!inserted) return { ok: false, deduped: true };
    }

    const rows = [];
    for (const p of snap.proofs.slice(0, 10)) {
      rows.push([
        `Proof — ${p.shopName}`,
        `${p.amount} ${p.currency} · ${p.channelLabel}${p.reference ? ` · ${p.reference}` : ''}`,
      ]);
      if (p.automatonName) {
        rows.push([
          `Commission — ${p.automatonName}`,
          `~US$ ${p.estimatedCommissionUsd.toFixed(2)} → ${p.walletAddress || 'wallet set nahi'}`,
        ]);
      }
    }
    for (const w of snap.summary.wallets) {
      rows.push([
        `USDC pending — ${w.automatonName || 'Automaton'}`,
        `US$ ${w.amountUsd.toFixed(2)} → ${w.walletAddress || 'wallet set nahi'}`,
      ]);
    }

    await sendOwnerAlert(env, {
      subject: `mhzaly AI agent: payment check — ${snap.proofs.length} proof(s), US$ ${snap.summary.unpaidUsd.toFixed(2)} USDC pending`,
      intro:
        'AI agent pooch raha hai: kya ye payments aap ko mil gayi hain? Owner panel → AI Agent mein "Haan mila" ya "Nahi mila" batayein. "Haan" par agent automaton ka wallet address aur exact USDC amount de dega.',
      rows,
      buttons: [{ href: `${OWNER_PANEL_URL}#agent`, label: 'Open AI Agent', bg: '#0f766e' }],
      footer: 'mhzaly AI agent — automatic payment check',
    });
    return { ok: true, provider: 'email' };
  }

  async function handleOwnerAgentState(request, env) {
    await requireOwner(request, env);
    const snap = await agentSnapshot(env);
    return json({ ok: true, ...snap });
  }

  async function handleOwnerAgentAsk(request, env) {
    const auth = await requireOwner(request, env);
    const ip = getClientIp(request);
    const body = await readJson(request);
    const message = text(body.message, 500);
    const action = lower(body.action, 20);
    const proofId = text(body.proofId, 80);
    let snap = await agentSnapshot(env);

    if (action === 'remind' || /(remind|yaad)/i.test(message)) {
      const delivery = await sendAgentDigest(env, snap, { force: true });
      return json({
        ok: true,
        kind: 'remind',
        reply: delivery.ok
          ? 'Reminder email bhej diya ✅ Apna mailbox check karein.'
          : delivery.empty
            ? 'Abhi koi pending item nahi hai — reminder ki zaroorat nahi.'
            : `Reminder email nahi gaya — email service configure nahi hai (RESEND_API_KEY). Error: ${(delivery.errors || []).join(', ') || 'unknown'}`,
        snapshot: snap,
      });
    }

    if (action === 'wallet' || /(wallet|address|usdc)/i.test(message)) {
      return json({ ok: true, kind: 'wallets', reply: agentWalletReply(snap), snapshot: snap });
    }

    if (action === 'automaton' || /(automaton|agent.*kaam|kaam kar)/i.test(message)) {
      return json({ ok: true, kind: 'automaton', reply: agentAutomatonReply(snap), snapshot: snap });
    }

    if (action === 'reject') {
      const proof = (proofId && snap.proofs.find((p) => p.id === proofId)) || snap.proofs[0];
      if (!proof) {
        return json({ ok: true, kind: 'info', reply: 'Koi pending proof nahi hai.', snapshot: snap });
      }
      const reason = text(body.reason, 200) || 'Owner ne agent se reject kiya';
      await env.DB.prepare(
        `UPDATE payment_proofs
            SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ?
          WHERE id = ? AND status = 'pending'`
      )
        .bind(reason, auth.aid, nowIso(), proof.id)
        .run();
      await ownerAudit(env, auth, ip, 'agent_payment_reject', 'payment_proof', proof.id, {
        shopId: proof.shopId,
        reason,
      });
      snap = await agentSnapshot(env);
      return json({
        ok: true,
        kind: 'rejected',
        reply: `Theek hai — ${proof.shopName} ka proof reject kar diya. Reason: ${reason}.`,
        snapshot: snap,
      });
    }

    if (action === 'deny' || agentNoIntent(message)) {
      const proof = (proofId && snap.proofs.find((p) => p.id === proofId)) || snap.proofs[0];
      if (!proof) {
        return json({ ok: true, kind: 'info', reply: 'Koi pending proof nahi hai.', snapshot: snap });
      }
      return json({
        ok: true,
        kind: 'not_received',
        reply:
          `Theek hai — ${proof.shopName} ka payment "nahi mila" note kar liya.\n\n` +
          'Main proof pending rakh raha hoon. Bank / JazzCash / Western Union statement dobara check karein. ' +
          'Agar receipt fake lagti hai to "reject" likh dein.',
        snapshot: snap,
      });
    }

    if (action === 'confirm' || agentYesIntent(message)) {
      const proof = (proofId && snap.proofs.find((p) => p.id === proofId)) || snap.proofs[0];
      if (!proof) {
        return json({
          ok: true,
          kind: 'info',
          reply: 'Koi pending payment proof nahi hai. Jab customer receipt bhejega, main aap se yahan pooch loonga.',
          snapshot: snap,
        });
      }

      const result = await agentApproveProof(env, auth, ip, proof);
      const wallet = result.commission?.automatonWallet || proof.walletAddress || '';
      const lines = [];

      if (result.duplicate) {
        lines.push('Ye payment pehle hi record ho chuki hai — plan active hai.');
      } else {
        lines.push('Shukriya! Payment confirm ho gayi ✅');
        lines.push(`• Shop: ${proof.shopName}`);
        lines.push(`• Amount: ${proof.amount} ${proof.currency}`);
        lines.push(`• Plan active till: ${result.paidUntil || 'lifetime'}`);
        if (result.commissionUsd > 0) {
          lines.push('');
          lines.push('*Ab automaton ko commission bhejein:*');
          lines.push(`• Automaton: ${result.commission?.automatonName || proof.automatonName || '—'}`);
          lines.push(`• Commission: US$ ${result.commissionUsd.toFixed(2)} (${result.commission?.pct || proof.commissionPct}%)`);
          lines.push(`• USDC wallet: ${wallet || 'wallet set nahi hai — Automatons tab mein add karein'}`);
          if (result.payoutDueAt) lines.push(`• Due: ${result.payoutDueAt}`);
          lines.push('');
          lines.push('Payout record ban gaya hai — USDC bhejne ke baad Payouts tab se "Mark paid" karein.');
        } else {
          lines.push('Ye direct shop thi — koi automaton commission nahi.');
        }
      }

      snap = await agentSnapshot(env);
      return json({
        ok: true,
        kind: 'confirmed',
        reply: lines.join('\n'),
        paymentId: result.paymentId,
        commissionUsd: result.commissionUsd,
        automatonName: result.commission?.automatonName || proof.automatonName || '',
        walletAddress: wallet,
        payoutId: result.payoutId || null,
        payoutDueAt: result.payoutDueAt || null,
        snapshot: snap,
      });
    }

    return json({ ok: true, kind: 'info', reply: agentStatusReply(snap), snapshot: snap });
  }

  async function handleOwnerCheckout(request, env) {
    await requireOwner(request, env);
    const body = await readJson(request);
    const shopId = text(body.shopId, 80);
    const amount = round2(num(body.amount));
    const currency = upper(body.currency, 3) || 'PKR';
    if (!shopId) throw new HttpError(400, 'shopId required');
    if (!(amount > 0)) throw new HttpError(400, 'amount 0 se zyada hona chahiye');
    if (!env.STRIPE_SECRET_KEY) {
      throw new HttpError(503, 'Stripe is not configured. Set STRIPE_SECRET_KEY with: wrangler secret put STRIPE_SECRET_KEY');
    }
    const shop = await getShop(env, shopId);
    if (!shop) throw new HttpError(404, 'Shop not found');

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', text(body.successUrl, 500) || `${OWNER_PANEL_URL}?paid=1`);
    params.set('cancel_url', text(body.cancelUrl, 500) || OWNER_PANEL_URL);
    params.set('metadata[shop_id]', shopId);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', currency.toLowerCase());
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)));
    params.set('line_items[0][price_data][product_data][name]', `mhzaly subscription — ${shop.name}`);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpError(502, data?.error?.message || 'Stripe checkout session could not be created');
    }
    return json({ ok: true, id: data.id, url: data.url });
  }

  /* ---------------- automaton API ---------------- */

  async function handleAutomatonStats(request, env) {
    const auto = await authAutomaton(request, env);
    const rows = await env.DB.prepare(
      `SELECT id, name, code, status, plan, billing_status, subscription_end, blocked_at, country, created_at
       FROM shops WHERE referred_by = ? ORDER BY created_at DESC`
    )
      .bind(auto.id)
      .all();
    const shopsRaw = rows.results || [];
    const counts = {
      signups: shopsRaw.length,
      pending: 0,
      trial: 0,
      paymentDue: 0,
      paid: 0,
      blocked: 0,
      rejected: 0,
    };
    const shops = shopsRaw.map((s) => {
      const status = deriveShopStatus(s);
      if (status === 'pending') counts.pending += 1;
      else if (status === 'trial') counts.trial += 1;
      else if (status === 'payment_due') counts.paymentDue += 1;
      else if (status === 'active') counts.paid += 1;
      else if (status === 'blocked') counts.blocked += 1;
      else if (status === 'rejected') counts.rejected += 1;
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        country: s.country || 'PK',
        status,
        trialEndsAt: status === 'trial' ? s.subscription_end || null : null,
        paidUntil: status === 'active' ? s.subscription_end || null : null,
        createdAt: s.created_at,
      };
    });
    const quoteCount = await env.DB.prepare('SELECT COUNT(*) AS c FROM price_quotes WHERE automaton_id = ?')
      .bind(auto.id)
      .first();
    const finance = await automatonFinance(env, auto.id);
    return json({
      automaton: {
        id: auto.id,
        name: auto.name,
        refCode: auto.ref_code,
        commissionPct: num(auto.commission_pct, 30),
        walletAddress: auto.wallet_address || '',
      },
      counts: { ...counts, quotes: Number(quoteCount?.c || 0) },
      earnings: finance,
      shops,
    });
  }

  async function handleAutomatonQuote(request, env) {
    const auto = await authAutomaton(request, env);
    const body = await readJson(request);
    const shopId = text(body.shopId ?? body.shop_id, 80);
    const amount = round2(num(body.amount));
    const currency = upper(body.currency, 3);
    if (!shopId) throw new HttpError(400, 'shopId required');
    if (!(amount > 0)) throw new HttpError(400, 'amount 0 se zyada hona chahiye');
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'currency 3-letter code hona chahiye (misal PKR)');

    const shop = await env.DB.prepare('SELECT id, name, country, referred_by FROM shops WHERE id = ?')
      .bind(shopId)
      .first();
    if (!shop) throw new HttpError(404, 'Shop not found');
    if (shop.referred_by !== auto.id) {
      throw new HttpError(403, 'Ye shop aap ne refer nahi ki — sirf apni shops ke liye quote de sakte hain.');
    }

    const country = shop.country || 'PK';
    const limit = await env.DB.prepare(
      'SELECT * FROM price_limits WHERE country = ? AND currency = ?'
    )
      .bind(country, currency)
      .first();
    if (!limit) {
      throw new HttpError(
        400,
        `Is country (${country}) aur currency (${currency}) ke liye price limit set nahi hai. Owner se rabta karein.`
      );
    }
    const minPrice = num(limit.min_price);
    const maxPrice = num(limit.max_price);
    if (amount < minPrice || amount > maxPrice) {
      throw new HttpError(
        400,
        `Quote ${amount} ${currency} allowed range (${minPrice}–${maxPrice} ${currency}) se bahar hai.`
      );
    }

    const id = randomId('quote');
    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO price_quotes (id, shop_id, automaton_id, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
      .bind(id, shopId, auto.id, amount, currency, ts)
      .run();
    await logAudit(env, {
      actorType: 'automaton',
      actorId: auto.id,
      action: 'automaton_quote_create',
      targetType: 'price_quote',
      targetId: id,
      details: JSON.stringify({ shopId, amount, currency, country }),
      ip: getClientIp(request),
    });
    return json(
      { ok: true, quote: { id, shopId, amount, currency, status: 'pending', createdAt: ts } },
      201
    );
  }

  async function handleAutomatonPayout(request, env) {
    const auto = await authAutomaton(request, env);
    const body = await readJson(request);
    const amount = round2(num(body.amountUsd ?? body.amount_usd));
    if (!(amount > 0)) throw new HttpError(400, 'amount_usd 0 se zyada hona chahiye');
    const reason = text(body.reason, 300) || 'Payout request';
    const id = randomId('pout');
    const ts = nowIso();

    // Race-safe balance check inside the INSERT itself.
    const res = await env.DB.prepare(
      `INSERT INTO payout_requests (id, automaton_id, amount_usd, reason, status, created_at)
       SELECT ?, ?, ?, ?, 'pending', ?
       WHERE ? <= (
         COALESCE((SELECT SUM(amount_usd) FROM commissions WHERE automaton_id = ? AND status = 'earned'), 0)
         - COALESCE((SELECT SUM(amount_usd) FROM payout_requests WHERE automaton_id = ? AND status IN ('pending','approved','paid')), 0)
       )`
    )
      .bind(id, auto.id, amount, reason, ts, amount, auto.id, auto.id)
      .run();

    if (!(Number(res.meta?.changes || 0) > 0)) {
      const finance = await automatonFinance(env, auto.id);
      throw new HttpError(
        400,
        `Requested amount available balance ($${finance.availableUsd.toFixed(2)}) se zyada hai.`
      );
    }

    await logAudit(env, {
      actorType: 'automaton',
      actorId: auto.id,
      action: 'automaton_payout_request',
      targetType: 'payout_request',
      targetId: id,
      details: JSON.stringify({ amountUsd: amount, reason }),
      ip: getClientIp(request),
    });

    if (await logEmailOnce(env, { shopId: auto.id, kind: 'payout_request', refId: id })) {
      await sendOwnerAlert(env, {
        subject: `mhzaly: Payout request — ${auto.name}`,
        intro: `Automaton ${auto.name} ne payout request bheji hai.`,
        rows: [
          ['Automaton', auto.name],
          ['Ref code', auto.ref_code],
          ['Amount (USD)', `$${amount}`],
          ['Reason', reason],
        ],
      }).catch(() => {});
    }

    return json({ ok: true, payout: { id, amountUsd: amount, status: 'pending', createdAt: ts } }, 201);
  }

  /* ---------------- cron: trial expiry ---------------- */

  async function runScheduled(env) {
    const now = new Date();
    const nowStr = now.toISOString();
    const result = { moved: 0, emailed: 0, payoutReminders: 0, proofReminders: 0, agentEmails: 0 };

    /* 1) trial / subscription expiry → payment_due */
    const candidates = await env.DB.prepare(
      `SELECT s.id, s.name, s.code, s.phone, s.plan, s.billing_status, s.subscription_end
       FROM shops s
       WHERE s.status = 'active'
         AND s.blocked_at IS NULL
         AND s.billing_status IN ('trial', 'active')
         AND s.subscription_end IS NOT NULL
         AND s.subscription_end < ?
         AND NOT EXISTS (
           SELECT 1 FROM email_log e
           WHERE e.shop_id = s.id AND e.kind = 'trial_ended' AND e.ref_id = ''
         )`
    )
      .bind(nowStr)
      .all();

    const rows = candidates.results || [];
    if (rows.length) {
      await env.DB.prepare(
        `UPDATE shops SET billing_status = 'payment_due'
         WHERE status = 'active' AND blocked_at IS NULL
           AND billing_status IN ('trial', 'active')
           AND subscription_end IS NOT NULL AND subscription_end < ?`
      )
        .bind(nowStr)
        .run();

      const fresh = [];
      for (const shop of rows) {
        const inserted = await logEmailOnce(env, {
          shopId: shop.id,
          kind: 'trial_ended',
          refId: '',
        });
        if (inserted) fresh.push(shop);
      }

      if (fresh.length) {
        await sendOwnerAlert(env, {
          subject: `mhzaly: ${fresh.length} shop(s) ka trial/subscription khatam`,
          intro: 'In shops ko payment_due par move kar diya gaya hai. Payment receive hone par owner panel se mark paid karein.',
          rows: fresh.map((s) => [
            s.name,
            `${s.code} · ${s.phone || 'no phone'} · ended ${s.subscription_end}`,
          ]),
        }).catch(() => {});
      }
      result.moved = rows.length;
      result.emailed = fresh.length;
    }

    /* 2) commission payout due → owner ko USDC bhejne ka reminder */
    try {
      const dueRows = await env.DB.prepare(
        `SELECT p.id, p.automaton_id, p.amount_usd, p.due_at, a.name AS automaton_name, a.wallet_address
         FROM payout_requests p
         LEFT JOIN automatons a ON a.id = p.automaton_id
         WHERE p.status IN ('approved', 'pending')
           AND p.due_at IS NOT NULL AND p.due_at < ?
         ORDER BY p.due_at ASC LIMIT 50`
      )
        .bind(nowStr)
        .all();

      for (const p of dueRows.results || []) {
        const inserted = await logEmailOnce(env, {
          shopId: p.automaton_id,
          kind: 'payout_due',
          refId: p.id,
        });
        if (!inserted) continue;
        result.payoutReminders += 1;
        await sendOwnerAlert(env, {
          subject: `mhzaly: USDC pending — ${p.automaton_name || 'automaton'} ($${num(p.amount_usd).toFixed(2)})`,
          intro: 'Ye 30% share abhi tak USDC mein nahi bheja gaya. Transfer karke owner panel se "Mark paid" karein.',
          rows: [
            ['Automaton', p.automaton_name || '—'],
            ['Amount (USDC)', `$${num(p.amount_usd).toFixed(2)}`],
            ['Wallet', p.wallet_address || 'wallet set nahi hai'],
            ['Due', p.due_at],
          ],
          buttons: [{ href: OWNER_PANEL_URL, label: 'Open Payouts', bg: '#0f766e' }],
        }).catch(() => {});
      }
    } catch {
      /* reminders must never break the cron */
    }

    /* 3) payment proof pending → owner ko activation reminder */
    try {
      const remindBefore = new Date(now.getTime() - PROOF_REMINDER_HOURS * 3600000).toISOString();
      const proofRows = await env.DB.prepare(
        `SELECT pr.id, pr.shop_id, pr.amount, pr.currency, pr.channel, pr.created_at, s.name AS shop_name
         FROM payment_proofs pr
         LEFT JOIN shops s ON s.id = pr.shop_id
         WHERE pr.status = 'pending' AND pr.created_at < ?
         ORDER BY pr.created_at ASC LIMIT 50`
      )
        .bind(remindBefore)
        .all();

      for (const pr of proofRows.results || []) {
        const inserted = await logEmailOnce(env, {
          shopId: pr.shop_id,
          kind: 'proof_pending',
          refId: pr.id,
        });
        if (!inserted) continue;
        result.proofReminders += 1;
        await sendOwnerAlert(env, {
          subject: `mhzaly: Payment proof pending — ${pr.shop_name || 'shop'}`,
          intro: `Ye receipt ${PROOF_REMINDER_HOURS} ghante se pending hai. Check karke plan activate karein.`,
          rows: [
            ['Shop', pr.shop_name || '—'],
            ['Amount', `${num(pr.amount)} ${pr.currency}`],
            ['Channel', channelLabel(pr.channel)],
            ['Received', pr.created_at],
          ],
          buttons: [{ href: OWNER_PANEL_URL, label: 'Check proof', bg: '#0f766e' }],
        }).catch(() => {});
      }
    } catch {
      /* reminders must never break the cron */
    }

    /* 4) AI agent — daily payment check email to owner */
    try {
      const snap = await agentSnapshot(env);
      const sent = await sendAgentDigest(env, snap);
      if (sent.ok) result.agentEmails = 1;
    } catch {
      /* agent digest must never break the cron */
    }

    return result;
  }

  /* ---------------- route dispatcher ---------------- */

  async function handleReferralRoute(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    if (path === '/api/webhooks/stripe' && method === 'POST') {
      return handleStripeWebhook(request, env);
    }

    if (path === '/api/owner/referral/overview' && method === 'GET') {
      return handleOwnerReferralOverview(request, env);
    }
    if (path === '/api/owner/referral/shop' && method === 'POST') {
      return handleOwnerReferralShop(request, env);
    }
    if (path === '/api/owner/referral/automaton' && method === 'POST') {
      return handleOwnerReferralAutomaton(request, env);
    }
    if (path === '/api/owner/referral/automaton-key' && method === 'POST') {
      return handleOwnerReferralAutomatonKey(request, env);
    }
    if (path === '/api/owner/referral/price' && method === 'POST') {
      return handleOwnerReferralPrice(request, env);
    }
    if (path === '/api/owner/referral/quote' && method === 'POST') {
      return handleOwnerReferralQuote(request, env);
    }
    if (path === '/api/owner/referral/payout' && method === 'POST') {
      return handleOwnerReferralPayout(request, env);
    }
    if (path === '/api/owner/referral/checkout' && method === 'POST') {
      return handleOwnerCheckout(request, env);
    }
    if (path === '/api/owner/referral/proof' && method === 'POST') {
      return handleOwnerProofAction(request, env);
    }
    if (path === '/api/owner/referral/proof-image' && method === 'GET') {
      return handleOwnerProofImage(request, env);
    }
    if (path === '/api/owner/agent/state' && method === 'GET') {
      return handleOwnerAgentState(request, env);
    }
    if (path === '/api/owner/agent/ask' && method === 'POST') {
      return handleOwnerAgentAsk(request, env);
    }

    if (path === '/api/shop/payment-proof' && method === 'POST') {
      return handleShopProofSubmit(request, env);
    }
    if (path === '/api/shop/payment-proofs' && method === 'GET') {
      return handleShopProofs(request, env);
    }

    if (path === '/api/automaton/me/stats' && method === 'GET') {
      return handleAutomatonStats(request, env);
    }
    if (path === '/api/automaton/quotes' && method === 'POST') {
      return handleAutomatonQuote(request, env);
    }
    if (path === '/api/automaton/payout-requests' && method === 'POST') {
      return handleAutomatonPayout(request, env);
    }

    return null;
  }

  return {
    handleReferralRoute,
    runScheduled,
    recordPayment,
    recordEmailLog: logEmailOnce,
    sendOwnerAlert,
  };
}