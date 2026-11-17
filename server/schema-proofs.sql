-- ============================================================
-- mhzaly — payment proofs (Western Union / Meezan / JazzCash)
-- + AI agent support columns
--
-- Run once against an existing database:
--   wrangler d1 execute mhzaly --remote --file server/schema-proofs.sql
-- Statements are idempotent except the ALTER TABLE lines, which
-- will report "duplicate column name" if already applied.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_proofs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  channel TEXT NOT NULL DEFAULT 'other',      -- western_union | meezan | jazzcash | other
  sender_name TEXT,
  reference TEXT,
  note TEXT,
  image_mime TEXT,
  image_data TEXT,                            -- base64 (client compresses to < 900 KB)
  image_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reject_reason TEXT,
  payment_id TEXT,
  reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_ref_proofs_shop ON payment_proofs(shop_id, status);

-- Payout obligations created automatically when a commission is earned.
ALTER TABLE payout_requests ADD COLUMN due_at TEXT;
ALTER TABLE payout_requests ADD COLUMN payment_id TEXT;
ALTER TABLE payout_requests ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payout_requests ADD COLUMN provider TEXT;
ALTER TABLE payout_requests ADD COLUMN auto_error TEXT;
