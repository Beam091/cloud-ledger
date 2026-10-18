-- Convert monetary values from REAL (float baht) to INTEGER satang (1/100 THB)
-- so every stored amount and balance is an exact integer; API responses keep baht decimals.
ALTER TABLE transactions ADD COLUMN amount_satang INTEGER NOT NULL DEFAULT 0;
UPDATE transactions SET amount_satang = CAST(ROUND(amount * 100) AS INTEGER);
ALTER TABLE transactions DROP COLUMN amount;
ALTER TABLE transactions RENAME COLUMN amount_satang TO amount;

ALTER TABLE accounts ADD COLUMN balance_satang INTEGER NOT NULL DEFAULT 0;
UPDATE accounts SET balance_satang = CAST(ROUND(balance * 100) AS INTEGER);
ALTER TABLE accounts DROP COLUMN balance;
ALTER TABLE accounts RENAME COLUMN balance_satang TO balance;

-- Speed up category breakdown queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_category ON transactions(user_id, type, category);
