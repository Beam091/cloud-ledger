-- Migration 0011: Add last_sent_at to user_notification_settings
ALTER TABLE user_notification_settings ADD COLUMN last_sent_at TEXT;
