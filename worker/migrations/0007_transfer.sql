-- Full-money transfers between two accounts of the same user
ALTER TABLE transactions ADD COLUMN transfer_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
