-- mhzaly Website Chat Agent — lead capture (no phone number required)
CREATE TABLE IF NOT EXISTS chat_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  shop TEXT,
  city TEXT,
  intent TEXT,
  referred_by TEXT,
  last_message TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_leads_session ON chat_leads(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_leads_stage ON chat_leads(stage);
