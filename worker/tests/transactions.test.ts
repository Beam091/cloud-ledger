import { describe, expect, it } from 'vitest'
import { effectsDelta, transactionEffects } from '../src/lib/transactions'

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
