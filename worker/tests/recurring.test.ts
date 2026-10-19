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

  it('monthly clamps to the end of shorter months and recovers anchor day', () => {
    expect(advanceRecurringDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28')
    expect(advanceRecurringDate('2026-02-28', 'monthly', 31)).toBe('2026-03-31')
    expect(advanceRecurringDate('2026-03-31', 'monthly', 31)).toBe('2026-04-30')
  })

  it('anchor 31 advances consecutively across 12 months in a non-leap year without date drift', () => {
    let current = '2026-01-31'
    const expected = [
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
    ]
    for (const exp of expected) {
      current = advanceRecurringDate(current, 'monthly', 31)
      expect(current).toBe(exp)
    }
  })

  it('anchor 31 advances consecutively across 12 months in a leap year without date drift', () => {
    let current = '2024-01-31'
    const expected = [
      '2024-02-29', // Leap year 2024 has 29 days in Feb
      '2024-03-31',
      '2024-04-30',
      '2024-05-31',
      '2024-06-30',
      '2024-07-31',
      '2024-08-31',
      '2024-09-30',
      '2024-10-31',
      '2024-11-30',
      '2024-12-31',
      '2025-01-31',
    ]
    for (const exp of expected) {
      current = advanceRecurringDate(current, 'monthly', 31)
      expect(current).toBe(exp)
    }
  })

  it('handles leap years with anchor 29', () => {
    expect(advanceRecurringDate('2028-01-29', 'monthly', 29)).toBe('2028-02-29')
    expect(advanceRecurringDate('2026-01-29', 'monthly', 29)).toBe('2026-02-28')
    expect(advanceRecurringDate('2026-02-28', 'monthly', 29)).toBe('2026-03-29')
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
