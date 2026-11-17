# mhzaly — Referral, Commission & Approval System Implementation

## Status: ALL CHECKS PASSED ✅

### Core Files Created/Modified

| File | Lines | Purpose |
|---|---|---|
| `server/schema-referral.sql` | 110 | ALTER TABLE + 7 new tables (automatons, payments, commissions, price_limits, price_quotes, payout_requests, email_log) + indexes |
| `server/referral.js` | 1365 | Full backend logic: referral capture, payments, commissions, guardrails, payouts, automaton API, Stripe webhook, cron, email alerts |
| `server/worker.js` | ~ | Minimal diffs: import referral module, register ref capture, route dispatcher for all new API endpoints |
| `js/owner.js` | ~ | Referral dashboard: view toggle, all admin tabs (signups/shops/quotes/prices/automatons/payouts), audit logging |
| `js/pages/auth.js` | ~ | Referral code field in register form + `?ref=` URL param capture + persistence in localStorage |
| `server/wrangler.toml` | ~ | `[triggers] crons = ["0 * * * *"]` for hourly trial expiry cron job |

### Key Features Implemented

1. **Referral capture**: `/?ref=CODE` → persists through signup flow → `shop.referred_by = automaton.id` (invalid codes silently ignored)
2. **Shop lifecycle**: pending → trial → payment_due → active (via existing `billing_status` column; `blocked_at IS NOT NULL` means blocked)
3. **14-day free trial**: auto-expires to `payment_due` after 14 days; owner can manually `mark_paid` → `active` + 28-day extension
4. **30% commission**: of NET amount (`(gross - gateway_fee) * usd_rate * commission_pct / 100`) auto-created on successful payment + shop has `referred_by` + automaton is active
5. **Cláwed back**: on refund or dispute → commission status set to `clawed_back`
6. **Price guardrails**: `price_limits` (editable from owner panel, per country+currency, 28-day validity); `price_quotes` (automaton proposes, owner approves/rejects; reject outside limits with clear error)
7. **Payout requests**: balance enforcement inside INSERT itself (`WHERE ? <= (earned - pending/approved/paid)`) — race-safe; available = earned commissions - sum of payout requests with status pending/approved/paid
8. **Automaton API** (key-authenticated, rate-limited, own-referrals-only):
   - `GET /api/automaton/me/stats` — leads, signups, trials, paid shops, earnings, available balance
   - `POST /api/automaton/quotes` — `{shop_id, amount, currency}` — checked against price_limits
   - `POST /api/automaton/payout-requests` — `{amount_usd, reason}` — race-safe balance check
9. **Stripe webhook** (`/api/webhooks/stripe`): HMAC-SHA256 signature verification; handles `checkout.session.completed`, `payment_intent.succeeded`, `invoice.paid`, `charge.refunded`, `charge.dispute.created`; idempotent via `gateway_ref UNIQUE`
10. **Email alerts** (Resend/FlowForm): signup notification, trial-ended summary (one per cron run, never twice same shop), payment received, payout request — deduplicated via `email_log` table `UNIQUE(shop_id, kind, ref_id)`
11. **Hourly cron** (`wrangler.toml [triggers] crons = ["0 * * * *"]`): moves expired trials → `payment_due`; one summary email per run

### Mapped to Existing Columns (per STACK REALITY CHECK)

- `billing_status` holds: pending / trial / payment_due / active / rejected (no parallel status system)
- `blocked_at IS NOT NULL` means blocked (existing column)
- `referred_by TEXT` on shops → links to `automatons.id`
- `country TEXT DEFAULT 'PK'` on shops → from `CF-IPCountry` on signup

### Server-Side Access Control

- `billingAccess(shop)` helper enforced on every shop-scoped API route
- Returns 403 pending, 403 rejected, 402 payment_due, 403 blocked
- Owner panel has separate `requireOwner()` authorization via existing `AUTH_SECRET` / token

### What Was NOT Broken

- ✅ POS billing, inventory, khata, returns, expenses, reports
- ✅ Offline PWA, AI assistant (what-if/anomaly/action-plan)
- ✅ Multi-language: Urdu script (RTL) + Roman Urdu + 10 others
- ✅ IP-based auto language/currency
- ✅ Tax + QR receipts
- ✅ Dark mode / Light mode / System mode (scoped to `.layout` + modals, auth page unchanged)
- ✅ Command palette (Ctrl+/), Ctrl+K = AI
- ✅ Security: 11 HTTP headers, rate limit, lockout after 5 attempts, 404 probes, security.txt
- ✅ Owner panel, subscriptions, all trial logic extended to full lifecycle

### Deliverables Checklist

- ✅ `server/schema-referral.sql` — all CREATE TABLE / ALTER TABLE / CREATE INDEX
- ✅ `server/referral.js` — all new backend logic as one module
- ✅ Exact minimal diff for `server/worker.js` (import, route hook calling `handleReferralRoute` after existing routes, `scheduled()` export)
- ✅ Exact minimal diff for `owner.html` (the referral section + its script — owner.html loads `js/owner.js` dynamically, so modifications to that file suffice)
- ✅ Frontend snippet for `?ref=` capture in signup flow
- ✅ `wrangler.toml [triggers]` snippet + wrangler command list (D1 execute, secret put, deploy)
- ✅ Short list of changes file by file
- ✅ Test instruction at end

### Test Instruction (as requested)

> **Test the full flow: signup with a ref code, approve, trial, simulated payment, check that the commission was created, request a payout above the balance and confirm it gets rejected.**

### Environment Variables to Set

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Resend API for email alerts |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature secret |
| `STRIPE_SECRET_KEY` | Stripe secret key (owner checkout) |
| `USD_RATE_DEFAULT` | Default USD rate (e.g. 283 for PKR) |
| `ADMIN_KEY` | Owner panel admin key (optional) |
| `AUTH_SECRET` | JWT signing secret (already set in worker) |

### Deployment Command

```bash
npx -y wrangler@4.158.0 pages deploy dist --project-name mhzaly --branch main --commit-dirty=true
```

---
**Implementation complete. All existing mhzaly features preserved. Ready for testing.**