import { describe, expect, it } from 'vitest'
import {
  accountDeletionReversals,
  effectsDelta,
  isValidAccountName,
  isValidAccountType,
  isValidAmount,
  isValidCategory,
  isValidDescription,
  isValidTransactionDate,
  transactionEffects,
  escapeLikeWildcards,
} from '../src/lib/transactions'

describe('transactionEffects', () => {
  it('income and expense affect a single account', () => {
    expect(transactionEffects({ type: 'income', amount: 1500, account_id: 'a1' })).toEqual([{ account_id: 'a1', delta: 1500 }])
    expect(transactionEffects({ type: 'expense', amount: 1500, account_id: 'a1' })).toEqual([{ account_id: 'a1', delta: -1500 }])
  })

  it('transfer moves money from source to destination', () => {
    expect(transactionEffects({ type: 'transfer', amount: 5000, account_id: 'a1', transfer_account_id: 'a2' })).toEqual([
      { account_id: 'a1', delta: -5000 },
      { account_id: 'a2', delta: 5000 },
    ])
  })

  it('transfer without a destination only debits the source (defensive)', () => {
    expect(transactionEffects({ type: 'transfer', amount: 5000, account_id: 'a1' })).toEqual([{ account_id: 'a1', delta: -5000 }])
  })

  it('transfer with the same source and destination yields a self-cancelling pair', () => {
    expect(transactionEffects({ type: 'transfer', amount: 5000, account_id: 'a1', transfer_account_id: 'a1' })).toEqual([
      { account_id: 'a1', delta: -5000 },
      { account_id: 'a1', delta: 5000 },
    ])
  })
})

describe('effectsDelta', () => {
  it('produces no delta when nothing changes', () => {
    expect(effectsDelta(
      transactionEffects({ type: 'expense', amount: 9900, account_id: 'a1' }),
      transactionEffects({ type: 'expense', amount: 9900, account_id: 'a1' }),
    )).toEqual([])
  })

  it('an amount change nets to the difference on a single account', () => {
    expect(effectsDelta(
      transactionEffects({ type: 'expense', amount: 1000, account_id: 'a1' }),
      transactionEffects({ type: 'expense', amount: 101300, account_id: 'a1' }),
    )).toEqual([{ account_id: 'a1', delta: -100300 }])
  })

  it('switching the account reverts one and applies to the other', () => {
    expect(effectsDelta(
      transactionEffects({ type: 'expense', amount: 2000, account_id: 'a1' }),
      transactionEffects({ type: 'expense', amount: 2000, account_id: 'a2' }),
    )).toEqual([
      { account_id: 'a1', delta: 2000 },
      { account_id: 'a2', delta: -2000 },
    ])
  })

  it('editing a transfer amount adjusts both legs', () => {
    expect(effectsDelta(
      transactionEffects({ type: 'transfer', amount: 5000, account_id: 'a1', transfer_account_id: 'a2' }),
      transactionEffects({ type: 'transfer', amount: 7000, account_id: 'a1', transfer_account_id: 'a2' }),
    )).toEqual([
      { account_id: 'a1', delta: -2000 },
      { account_id: 'a2', delta: 2000 },
    ])
  })

  it('retargeting a transfer handles source, destination and amount at once', () => {
    expect(effectsDelta(
      transactionEffects({ type: 'transfer', amount: 10000, account_id: 'a1', transfer_account_id: 'a2' }),
      transactionEffects({ type: 'transfer', amount: 250000, account_id: 'a3', transfer_account_id: 'a4' }),
    )).toEqual([
      { account_id: 'a1', delta: 10000 },
      { account_id: 'a2', delta: -10000 },
      { account_id: 'a3', delta: -250000 },
      { account_id: 'a4', delta: 250000 },
    ])
  })

  it('converting a transfer back to an expense clears the second leg', () => {
    expect(effectsDelta(
      transactionEffects({ type: 'transfer', amount: 10000, account_id: 'a1', transfer_account_id: 'a2' }),
      transactionEffects({ type: 'expense', amount: 10000, account_id: 'a1' }),
    )).toEqual([{ account_id: 'a2', delta: -10000 }])
  })

  it('merges repeated touches of the same account', () => {
    expect(effectsDelta(
      transactionEffects({ type: 'transfer', amount: 2500, account_id: 'a1', transfer_account_id: 'a1' }),
      transactionEffects({ type: 'expense', amount: 0, account_id: 'a1' }),
    )).toEqual([])
  })
})

describe('accountDeletionReversals', () => {
  it('reverts transfer destination balance when source account is deleted (A -> B, delete A)', () => {
    // 100 THB transferred from A to B: B gained 10000 satang (+10000)
    // Deleting A must revert B by -10000
    const tx = { type: 'transfer', amount: 10000, account_id: 'A', transfer_account_id: 'B' }
    expect(accountDeletionReversals('A', [tx])).toEqual([
      { account_id: 'B', delta: -10000 },
    ])
  })

  it('reverts transfer source balance when destination account is deleted (B -> A, delete A)', () => {
    // 100 THB transferred from B to A: B lost 10000 satang (-10000)
    // Deleting A must revert B by +10000
    const tx = { type: 'transfer', amount: 10000, account_id: 'B', transfer_account_id: 'A' }
    expect(accountDeletionReversals('A', [tx])).toEqual([
      { account_id: 'B', delta: 10000 },
    ])
  })

  it('income and expense in deleted account do not affect other accounts', () => {
    const txs = [
      { type: 'income', amount: 50000, account_id: 'A' },
      { type: 'expense', amount: 20000, account_id: 'A' },
    ]
    expect(accountDeletionReversals('A', txs)).toEqual([])
  })

  it('handles multiple transfers across multiple accounts', () => {
    const txs = [
      { type: 'transfer', amount: 10000, account_id: 'A', transfer_account_id: 'B' }, // B: -10000
      { type: 'transfer', amount: 4000, account_id: 'B', transfer_account_id: 'A' },  // B: +4000 (net B: -6000)
      { type: 'transfer', amount: 20000, account_id: 'A', transfer_account_id: 'C' }, // C: -20000
      { type: 'income', amount: 5000, account_id: 'A' },
    ]
    expect(accountDeletionReversals('A', txs)).toEqual([
      { account_id: 'B', delta: -6000 },
      { account_id: 'C', delta: -20000 },
    ])
  })
})

describe('isValidTransactionDate', () => {
  it('accepts valid ISO 8601 strings parseable by SQLite date()', () => {
    expect(isValidTransactionDate('2026-10-19')).toBe(true)
    expect(isValidTransactionDate('2026-10-19T10:00:00Z')).toBe(true)
    expect(isValidTransactionDate('2026-10-19T10:00:00.000Z')).toBe(true)
    expect(isValidTransactionDate('2026-10-19 10:00:00')).toBe(true)
    expect(isValidTransactionDate('2026-10-19T10:00:00+07:00')).toBe(true)
    expect(isValidTransactionDate('2026-10-19T10:00:00-05:00')).toBe(true)
    expect(isValidTransactionDate('2026-10-19T10:00')).toBe(true)
    expect(isValidTransactionDate('2024-02-29')).toBe(true) // Leap year
  })

  it('rejects invalid or non-ISO dates where SQLite date() returns NULL or JS Date is NaN', () => {
    expect(isValidTransactionDate('invalid')).toBe(false)
    expect(isValidTransactionDate('')).toBe(false)
    expect(isValidTransactionDate('2026/10/19')).toBe(false) // Slash not allowed in SQLite date()
    expect(isValidTransactionDate('10-19-2026')).toBe(false)
    expect(isValidTransactionDate('2026-10-19T10:00:00+0700')).toBe(false) // Missing colon in TZ offset
    expect(isValidTransactionDate('2026-10-19T')).toBe(false)
    expect(isValidTransactionDate('2026-10-19T25:00:00')).toBe(false)
    expect(isValidTransactionDate('2026-02-30')).toBe(false)
    expect(isValidTransactionDate('2026-02-29')).toBe(false) // Non-leap year
    expect(isValidTransactionDate(null)).toBe(false)
    expect(isValidTransactionDate(undefined)).toBe(false)
    expect(isValidTransactionDate(123456789)).toBe(false)
  })
})

describe('account input validation', () => {
  it('validates account names', () => {
    expect(isValidAccountName('Main Bank')).toBe(true)
    expect(isValidAccountName('a'.repeat(100))).toBe(true)
    expect(isValidAccountName('a'.repeat(101))).toBe(false)
    expect(isValidAccountName('')).toBe(false)
    expect(isValidAccountName('   ')).toBe(false)
    expect(isValidAccountName(null)).toBe(false)
  })

  it('validates account types', () => {
    expect(isValidAccountType('bank')).toBe(true)
    expect(isValidAccountType('e_wallet')).toBe(true)
    expect(isValidAccountType('cash')).toBe(true)
    expect(isValidAccountType('other')).toBe(true)
    expect(isValidAccountType('crypto')).toBe(false)
    expect(isValidAccountType('')).toBe(false)
    expect(isValidAccountType(undefined)).toBe(false)
  })
})

describe('transaction and recurring validation limits', () => {
  it('validates category length and presence', () => {
    expect(isValidCategory('Food')).toBe(true)
    expect(isValidCategory('c'.repeat(100))).toBe(true)
    expect(isValidCategory('c'.repeat(101))).toBe(false)
    expect(isValidCategory('')).toBe(false)
    expect(isValidCategory('   ')).toBe(false)
    expect(isValidCategory(null)).toBe(false)
  })

  it('validates description length limit', () => {
    expect(isValidDescription('')).toBe(true)
    expect(isValidDescription(undefined)).toBe(true)
    expect(isValidDescription(null)).toBe(true)
    expect(isValidDescription('Normal description')).toBe(true)
    expect(isValidDescription('d'.repeat(500))).toBe(true)
    expect(isValidDescription('d'.repeat(501))).toBe(false)
    expect(isValidDescription(123)).toBe(false)
  })

  it('validates amount limits up to ceiling 1,000,000,000 THB', () => {
    expect(isValidAmount(0.01)).toBe(true)
    expect(isValidAmount(1000)).toBe(true)
    expect(isValidAmount(1_000_000_000)).toBe(true)
    expect(isValidAmount(1_000_000_000.01)).toBe(false)
    expect(isValidAmount(0)).toBe(false)
    expect(isValidAmount(-100)).toBe(false)
    expect(isValidAmount(NaN)).toBe(false)
    expect(isValidAmount(Infinity)).toBe(false)
    expect(isValidAmount('100')).toBe(false)
  })
})

describe('escapeLikeWildcards', () => {
  it('escapes %, _, and \\ characters for SQL LIKE query', () => {
    expect(escapeLikeWildcards('50%')).toBe('50\\%')
    expect(escapeLikeWildcards('user_name')).toBe('user\\_name')
    expect(escapeLikeWildcards('c:\\path')).toBe('c:\\\\path')
    expect(escapeLikeWildcards('100%_sale\\test')).toBe('100\\%\\_sale\\\\test')
    expect(escapeLikeWildcards('normal string')).toBe('normal string')
  })
})

