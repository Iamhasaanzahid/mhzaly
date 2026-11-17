-- ============================================================
-- mhzaly — referral, commission & approval schema
-- Cloudflare D1 (SQLite). Run once against the remote database:
--   npx wrangler d1 execute mhzaly --remote --file=server/schema-referral.sql
-- Safe to re-run for the CREATE TABLE / CREATE INDEX statements.
-- The two ALTER TABLE statements only need to be run once; if the
-- columns already exist D1 will report "duplicate column name" and
-- you can ignore that single statement.
-- ============================================================

-- Existing shops table gets two new optional columns.
ALTER TABLE shops ADD COLUMN referred_by TEXT;
ALTER TABLE shops ADD COLUMN country TEXT DEFAULT 'PK';

-- External AI sales agents ("automatons")
CREATE TABLE IF NOT EXISTS automatons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ref_code TEXT NOT NULL UNIQUE,
  wallet_address TEXT,
  api_key_hash TEXT,
  commission_pct REAL NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every real payment received from a shop (Stripe or manual)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  gross REAL NOT NULL DEFAULT 0,
  gateway_fee REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  usd_rate REAL NOT NULL DEFAULT 1,
  gateway TEXT NOT NULL DEFAULT 'bank',
  gateway_ref TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'succeeded',   -- succeeded | refunded | disputed
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One commission row per successful payment (payment_id is UNIQUE)
CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  automaton_id TEXT NOT NULL,
  amount_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'earned',      -- earned | clawed_back
  created_at TEXT NOT NULL
);

-- Owner-controlled price guardrails, per country + currency (28-day price)
CREATE TABLE IF NOT EXISTS price_limits (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  currency TEXT NOT NULL,
  min_price REAL NOT NULL DEFAULT 0,
  max_price REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(country, currency)
);

-- Quotes proposed by automatons; only approved quotes count
CREATE TABLE IF NOT EXISTS price_quotes (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  automaton_id TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

-- Payout requests from automatons
CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  automaton_id TEXT NOT NULL,
  amount_usd REAL NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | paid | rejected
  tx_hash TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

-- Email de-duplication. ref_id lets one shop receive many payment emails
-- while still guaranteeing one signup / trial-ended email per shop.
CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- signup | trial_ended | payment_received | payout_request
  ref_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(shop_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_ref_shops_referred ON shops(referred_by);
CREATE INDEX IF NOT EXISTS idx_ref_shops_country ON shops(country);
CREATE INDEX IF NOT EXISTS idx_ref_payments_shop ON payments(shop_id);
CREATE INDEX IF NOT EXISTS idx_ref_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_ref_payments_received ON payments(received_at);
CREATE INDEX IF NOT EXISTS idx_ref_commissions_automaton ON commissions(automaton_id, status);
CREATE INDEX IF NOT EXISTS idx_ref_quotes_shop ON price_quotes(shop_id);
CREATE INDEX IF NOT EXISTS idx_ref_quotes_status ON price_quotes(status);
CREATE INDEX IF NOT EXISTS idx_ref_payouts_automaton ON payout_requests(automaton_id, status);
CREATE INDEX IF NOT EXISTS idx_ref_email_shop ON email_log(shop_id, kind);