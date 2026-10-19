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

// Validates ISO 8601 transaction date strings that are parseable by both JS Date and SQLite date()
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/

export function isValidTransactionDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!ISO_DATE_REGEX.test(value)) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const parts = value.slice(0, 10).split('-')
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10)
  const day = parseInt(parts[2], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return false
  return true
}

export const MAX_AMOUNT_BAHT = 1_000_000_000
export const MAX_CATEGORY_LENGTH = 100
export const MAX_DESCRIPTION_LENGTH = 500
export const MAX_ACCOUNT_NAME_LENGTH = 100

export const ACCOUNT_TYPES = ['bank', 'e_wallet', 'cash', 'other'] as const
export type AccountType = typeof ACCOUNT_TYPES[number]

export function isValidAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)
}

export function isValidAccountName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_ACCOUNT_NAME_LENGTH
}

export function isValidCategory(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_CATEGORY_LENGTH
}

export function isValidDescription(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (typeof value !== 'string') return false
  return value.length <= MAX_DESCRIPTION_LENGTH
}

export function isValidAmount(baht: unknown): boolean {
  if (typeof baht !== 'number' || !Number.isFinite(baht)) return false
  return baht > 0 && baht <= MAX_AMOUNT_BAHT
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
