import { describe, expect, it } from 'vitest'
import { advanceRecurringDate, isValidFrequency } from '../src/lib/recurring'

describe('advanceRecurringDate', () => {
  it('daily moves one date at a time across month boundaries', () => {
    expect(advanceRecurringDate('2026-02-28', 'daily')).toBe('2026-03-01')
    expect(advanceRecurringDate('2026-12-31', 'daily')).toBe('2027-01-01')
  })

  it('weekly always steps exactly 7 days', () => {
    expect(advanceRecurringDate('2026-10-18', 'weekly')).toBe('2026-10-25')
    expect(advanceRecurringDate('2026-02-27', 'weekly')).toBe('2026-03-06')
  })

  it('monthly keeps the day of month', () => {
    expect(advanceRecurringDate('2026-01-25', 'monthly')).toBe('2026-02-25')
    expect(advanceRecurringDate('2026-05-25', 'monthly')).toBe('2026-06-25')
    expect(advanceRecurringDate('2027-01-25', 'monthly')).toBe('2027-02-25')
  })

  it('monthly clamps to the end of shorter months', () => {
    expect(advanceRecurringDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(advanceRecurringDate('2026-03-31', 'monthly')).toBe('2026-04-30')
    // back to 31 in a longer month afterwards
    expect(advanceRecurringDate('2026-02-28', 'monthly')).toBe('2026-03-28')
  })

  it('handles leap years', () => {
    expect(advanceRecurringDate('2028-01-29', 'monthly')).toBe('2028-02-29')
    expect(advanceRecurringDate('2026-01-29', 'monthly')).toBe('2026-02-28')
  })

  it('rejects malformed dates', () => {
    expect(() => advanceRecurringDate('not-a-date', 'daily')).toThrow()
    expect(() => advanceRecurringDate('2026-02-31', 'monthly')).toThrow()
  })
})

describe('isValidFrequency', () => {
  it('accepts only known frequencies', () => {
    expect(isValidFrequency('daily')).toBe(true)
    expect(isValidFrequency('weekly')).toBe(true)
    expect(isValidFrequency('monthly')).toBe(true)
    expect(isValidFrequency('yearly')).toBe(false)
    expect(isValidFrequency('')).toBe(false)
    expect(isValidFrequency(null)).toBe(false)
  })
})
