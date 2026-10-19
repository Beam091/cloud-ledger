import { signedAmount } from './money'

export interface TransactionLike {
  type: string
  amount: number
  account_id: string
  transfer_account_id?: string | null
}

export interface BalanceEffect { account_id: string; delta: number }

// How one transaction row moves balances (amount must already be in satang).
// Income: +amount to its account. Expense: -amount. Transfer: -amount from the
// source account and +amount to the destination account.
export function transactionEffects(transaction: TransactionLike): BalanceEffect[] {
  if (transaction.type === 'transfer') {
    const destination = transaction.transfer_account_id || ''
    return [
      { account_id: transaction.account_id, delta: -transaction.amount },
      ...(destination ? [{ account_id: destination, delta: transaction.amount }] : []),
    ].filter((leg) => leg.account_id)
  }
  return [{ account_id: transaction.account_id, delta: signedAmount(transaction.type, transaction.amount) }]
}

// Net balance change from replacing one transaction with another, merged per
// account so rows touching the same account collapse into a single delta.
export function effectsDelta(before: BalanceEffect[], after: BalanceEffect[]): BalanceEffect[] {
  const net = new Map<string, number>()
  for (const { account_id, delta } of before) net.set(account_id, (net.get(account_id) || 0) - delta)
  for (const { account_id, delta } of after) net.set(account_id, (net.get(account_id) || 0) + delta)
  return [...net.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([account_id, delta]) => ({ account_id, delta }))
}

// When an account is deleted, all its transactions are also removed.
// Any transaction that touched another account (such as a cross-account transfer)
// must have its effect reverted on that other account.
export function accountDeletionReversals(accountIdToDelete: string, transactions: TransactionLike[]): BalanceEffect[] {
  const net = new Map<string, number>()
  for (const tx of transactions) {
    for (const { account_id, delta } of transactionEffects(tx)) {
      if (account_id !== accountIdToDelete) {
        net.set(account_id, (net.get(account_id) || 0) - delta)
      }
    }
  }
  return [...net.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([account_id, delta]) => ({ account_id, delta }))
}
