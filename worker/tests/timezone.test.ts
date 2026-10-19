import { describe, expect, it } from 'vitest'
import { dateInTz, tzOffsetMinutes } from '../src/lib/timezone'

describe('dateInTz', () => {
  it('rolls the date forward early in UTC', () => {
    // 18:00Z = 01:00 in Bangkok on the next day
    expect(dateInTz('Asia/Bangkok', new Date('2026-10-18T18:00:00Z'))).toBe('2026-10-19')
    expect(dateInTz('UTC', new Date('2026-10-18T18:00:00Z'))).toBe('2026-10-18')
  })

  it('handles big positive offsets', () => {
    // Kiribati is UTC+14: Saturday 12:00Z becomes Sunday 02:00 local
    expect(dateInTz('Pacific/Kiritimati', new Date('2026-10-17T12:00:00Z'))).toBe('2026-10-18')
  })

  it('handles negative offsets', () => {
    // New York (EDT, UTC-4) 02:00Z is still Friday the previous day
    expect(dateInTz('America/New_York', new Date('2026-10-18T02:00:00Z'))).toBe('2026-10-17')
  })

  it('falls back to Bangkok for an unknown timezone', () => {
    expect(dateInTz('Not/AZone', new Date('2026-10-18T00:00:00Z'))).toBe('2026-10-18')
    expect(dateInTz('Not/AZone', new Date('2026-10-18T18:00:00Z'))).toBe('2026-10-19')
  })
})

describe('tzOffsetMinutes', () => {
  it('knows fixed offsets', () => {
    expect(tzOffsetMinutes('UTC')).toBe(0)
    expect(tzOffsetMinutes('Asia/Bangkok')).toBe(420)
    expect(tzOffsetMinutes('Pacific/Kiritimati')).toBe(840)
    expect(tzOffsetMinutes('Pacific/Honolulu')).toBe(-600)
  })

  it('defaults to Bangkok for unknown timezones', () => {
    expect(tzOffsetMinutes('Not/AZone')).toBe(420)
    expect(tzOffsetMinutes('')).toBe(420)
  })

  it('adjusts for daylight saving time (DST) based on reference date', () => {
    // America/New_York is UTC-4 in summer (EDT) and UTC-5 in winter (EST)
    const summerDate = new Date('2026-07-01T12:00:00Z')
    const winterDate = new Date('2026-01-01T12:00:00Z')
    expect(tzOffsetMinutes('America/New_York', summerDate)).toBe(-240) // -4 hours = -240 minutes
    expect(tzOffsetMinutes('America/New_York', winterDate)).toBe(-300) // -5 hours = -300 minutes

    // Europe/London is UTC+1 in summer (BST) and UTC+0 in winter (GMT)
    expect(tzOffsetMinutes('Europe/London', summerDate)).toBe(60)
    expect(tzOffsetMinutes('Europe/London', winterDate)).toBe(0)
  })
})

