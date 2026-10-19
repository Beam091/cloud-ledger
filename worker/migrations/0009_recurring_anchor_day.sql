-- Migration 0009: Add anchor_day to recurring_transactions
ALTER TABLE recurring_transactions ADD COLUMN anchor_day INTEGER;
UPDATE recurring_transactions SET anchor_day = CAST(SUBSTR(next_run_date, 9, 2) AS INTEGER) WHERE anchor_day IS NULL;
