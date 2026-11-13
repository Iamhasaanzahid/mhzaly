-- mhzaly — Enhanced D1 schema with security & subscription support

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  phone TEXT,
  shop_type TEXT NOT NULL DEFAULT 'mart',
  plan TEXT NOT NULL DEFAULT 'trial',
  billing_status TEXT NOT NULL DEFAULT 'trial',
  subscription_start TEXT,
  subscription_end TEXT,
  blocked_at TEXT,
  block_reason TEXT,
  last_payment_at TEXT,
  last_payment_amount REAL,
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

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  plan TEXT,
  period_start TEXT,
  period_end TEXT,
  method TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,      -- 'owner' | 'shop'
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,          -- 'approve' | 'reject' | 'block' | 'unblock' | 'set_plan' | 'extend' | 'login' | 'register'
  target_type TEXT NOT NULL,     -- 'shop' | 'admin' | 'system'
  target_id TEXT,
  details TEXT,                  -- JSON string
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,        -- '/api/login' | '/api/register'
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ip, endpoint)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  PRIMARY KEY (ip, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_shops_code ON shops(code);
CREATE INDEX IF NOT EXISTS idx_shops_phone ON shops(phone);
CREATE INDEX IF NOT EXISTS idx_shops_confirm ON shops(confirm_token);
CREATE INDEX IF NOT EXISTS idx_payments_shop ON subscription_payments(shop_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON subscription_payments(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip ON rate_limits(ip, endpoint);

-- v2.7 scalability indexes (hot paths for large traffic)
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status);
CREATE INDEX IF NOT EXISTS idx_shops_plan ON shops(plan, billing_status);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shop_data_updated ON shop_data(updated_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
