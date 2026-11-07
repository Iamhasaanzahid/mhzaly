-- mhzaly — D1 schema
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  phone TEXT,
  shop_type TEXT NOT NULL DEFAULT 'mart',
  status TEXT NOT NULL DEFAULT 'active',
  confirm_token TEXT,
  confirm_expires TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'owner',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_data (
  shop_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_shops_code ON shops(code);
CREATE INDEX IF NOT EXISTS idx_shops_phone ON shops(phone);
CREATE INDEX IF NOT EXISTS idx_shops_confirm ON shops(confirm_token);
