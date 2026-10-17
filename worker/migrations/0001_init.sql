PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('ai_provider', 'gemini'),
  ('ai_model', 'gemini-3.5-flash-lite'),
  ('ai_api_key', ''),
  ('image_retention_policy', 'auto_cleanup'),
  ('image_retention_days', '90');

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bank' CHECK(type IN ('bank', 'e_wallet', 'cash', 'other')),
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'THB',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer')),
  amount REAL NOT NULL CHECK(amount > 0),
  category TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  image_key TEXT,
  transaction_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gmail_enabled INTEGER NOT NULL DEFAULT 0,
  gmail_address TEXT,
  gmail_app_password_encrypted TEXT,
  telegram_enabled INTEGER NOT NULL DEFAULT 0,
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  discord_enabled INTEGER NOT NULL DEFAULT 0,
  discord_webhook_url TEXT,
  cron_schedule TEXT NOT NULL DEFAULT '0 21 * * *',
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);