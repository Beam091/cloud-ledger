-- Migration 0010: Rate limits table and registration_open system setting
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

INSERT OR IGNORE INTO system_settings (key, value) VALUES ('registration_open', '1');
