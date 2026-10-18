import { describe, expect, it } from 'vitest'
import { cronMatches } from '../src/lib/cron'

const bangkok = (iso: string) => new Date(iso)

describe('cronMatches', () => {
  it('daily schedule 21:00 Bangkok (14:00 UTC)', () => {
    const expr = '0 21 * * *'
    expect(cronMatches(expr, bangkok('2026-10-18T14:00:00Z'), 'Asia/Bangkok')).toBe(true)
    expect(cronMatches(expr, bangkok('2026-10-18T13:59:59Z'), 'Asia/Bangkok')).toBe(false)
    expect(cronMatches(expr, bangkok('2026-10-18T14:30:00Z'), 'Asia/Bangkok')).toBe(false)
  })

  it('weekly schedule respects day-of-week in the target timezone', () => {
    const expr = '0 21 * * 1' // Monday 21:00 Bangkok
    // 2024-01-08 is Monday; 13:00Z = 20:00 BKK -> no, 14:00Z = 21:00 -> yes
    expect(cronMatches(expr, bangkok('2024-01-08T14:00:00Z'), 'Asia/Bangkok')).toBe(true)
    expect(cronMatches(expr, bangkok('2024-01-08T13:30:00Z'), 'Asia/Bangkok')).toBe(false)
    // 2024-01-07 is Sunday
    expect(cronMatches(expr, bangkok('2024-01-07T14:00:00Z'), 'Asia/Bangkok')).toBe(false)
  })

  it('monthly schedule matches the 1st of each month only', () => {
    const expr = '0 21 1 * *'
    expect(cronMatches(expr, bangkok('2026-03-01T14:00:00Z'), 'Asia/Bangkok')).toBe(true)
    expect(cronMatches(expr, bangkok('2026-03-02T14:00:00Z'), 'Asia/Bangkok')).toBe(false)
  })

  it('every 15 minutes', () => {
    const expr = '*/15 * * * *'
    expect(cronMatches(expr, bangkok('2026-10-18T04:00:00Z'), 'UTC')).toBe(true)
    expect(cronMatches(expr, bangkok('2026-10-18T04:15:00Z'), 'UTC')).toBe(true)
    expect(cronMatches(expr, bangkok('2026-10-18T04:10:00Z'), 'UTC')).toBe(false)
  })

  it('ranges, lists and steps', () => {
    expect(cronMatches('0 8-10 * * *', bangkok('2026-10-18T09:00:00Z'), 'UTC')).toBe(true)
    expect(cronMatches('0 8-10 * * *', bangkok('2026-10-18T12:00:00Z'), 'UTC')).toBe(false)
    expect(cronMatches('0 9 * * 1,3,5', bangkok('2026-10-21T09:00:00Z'), 'UTC')).toBe(true) // Wednesday
    expect(cronMatches('0 9 * * 1,3,5', bangkok('2026-10-18T09:00:00Z'), 'UTC')).toBe(false) // Sunday
    expect(cronMatches('0 9 1-5 3 *', bangkok('2026-03-03T09:00:00Z'), 'UTC')).toBe(true)
    expect(cronMatches('0 9 1-5 3 *', bangkok('2026-03-06T09:00:00Z'), 'UTC')).toBe(false)
  })

  it('day-of-month and day-of-week combine with the standard OR rule', () => {
    // day=15 or Monday
    expect(cronMatches('0 21 15 * 1', bangkok('2026-10-19T14:00:00Z'), 'Asia/Bangkok')).toBe(true) // Monday the 19th
    expect(cronMatches('0 21 15 * 1', bangkok('2026-10-15T14:00:00Z'), 'Asia/Bangkok')).toBe(true) // Thursday the 15th
    expect(cronMatches('0 21 15 * 1', bangkok('2026-10-20T14:00:00Z'), 'Asia/Bangkok')).toBe(false)
  })

  it('rejects malformed expressions', () => {
    expect(cronMatches('', new Date(), 'Asia/Bangkok')).toBe(false)
    expect(cronMatches('0 21 * *', new Date(), 'Asia/Bangkok')).toBe(false)
    expect(cronMatches('0 21 * * * *', new Date(), 'Asia/Bangkok')).toBe(false)
    expect(cronMatches('0 25 * * *', bangkok('2026-10-18T18:00:00Z'), 'Asia/Bangkok')).toBe(false)
    expect(cronMatches('61 21 * * *', new Date(), 'Asia/Bangkok')).toBe(false)
    expect(cronMatches('0 21 32 * *', new Date(), 'Asia/Bangkok')).toBe(false)
    expect(cronMatches('0 21 * 13 *', new Date(), 'Asia/Bangkok')).toBe(false)
  })

  it('falls back to Bangkok when the timezone is blank', () => {
    expect(cronMatches('0 21 * * *', bangkok('2026-10-18T14:00:00Z'), '')).toBe(true)
  })
})
