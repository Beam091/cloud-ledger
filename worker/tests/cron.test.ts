import { describe, expect, it } from 'vitest'
import { cronMatches, isDueInLookbackWindow } from '../src/lib/cron'

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

describe('isDueInLookbackWindow', () => {
  const expr = '0 21 * * *' // 21:00 daily

  it('triggers when called exactly at scheduled time', () => {
    // 21:00 Asia/Bangkok is 14:00 UTC
    const now = new Date('2026-10-18T14:00:00Z')
    const result = isDueInLookbackWindow(expr, now, 'Asia/Bangkok', null, 15)
    expect(result.due).toBe(true)
    expect(result.slotIso).toBe(new Date('2026-10-18T14:00:00.000Z').toISOString())
  })

  it('triggers when called 10 minutes late (catch-up within 15-minute lookback window)', () => {
    const now = new Date('2026-10-18T14:10:00Z')
    const result = isDueInLookbackWindow(expr, now, 'Asia/Bangkok', null, 15)
    expect(result.due).toBe(true)
    expect(result.slotIso).toBe(new Date('2026-10-18T14:00:00.000Z').toISOString())
  })

  it('does not trigger when called after the lookback window (e.g. 16 minutes late)', () => {
    const now = new Date('2026-10-18T14:16:00Z')
    const result = isDueInLookbackWindow(expr, now, 'Asia/Bangkok', null, 15)
    expect(result.due).toBe(false)
  })

  it('does not trigger if already sent for the matching slot (deduplication with last_sent_at)', () => {
    // Exactly at scheduled time
    const slotIso = new Date('2026-10-18T14:00:00.000Z').toISOString()
    const now = new Date('2026-10-18T14:05:00Z')
    const result = isDueInLookbackWindow(expr, now, 'Asia/Bangkok', slotIso, 15)
    expect(result.due).toBe(false)
  })

  it('triggers on next day when last_sent_at is from previous day', () => {
    const yesterdaySlot = new Date('2026-10-17T14:00:00.000Z').toISOString()
    const now = new Date('2026-10-18T14:05:00Z')
    const result = isDueInLookbackWindow(expr, now, 'Asia/Bangkok', yesterdaySlot, 15)
    expect(result.due).toBe(true)
    expect(result.slotIso).toBe(new Date('2026-10-18T14:00:00.000Z').toISOString())
  })

  it('supports half-hour offset timezones such as Asia/Kolkata (+05:30)', () => {
    // 21:00 in Asia/Kolkata (+05:30) is 15:30 UTC
    const exactNow = new Date('2026-10-18T15:30:00Z')
    expect(isDueInLookbackWindow(expr, exactNow, 'Asia/Kolkata', null, 15)).toEqual({
      due: true,
      slotIso: new Date('2026-10-18T15:30:00.000Z').toISOString(),
    })

    // Catch-up 12 minutes later
    const catchupNow = new Date('2026-10-18T15:42:00Z')
    expect(isDueInLookbackWindow(expr, catchupNow, 'Asia/Kolkata', null, 15)).toEqual({
      due: true,
      slotIso: new Date('2026-10-18T15:30:00.000Z').toISOString(),
    })
  })
})

