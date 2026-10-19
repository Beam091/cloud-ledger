import { describe, expect, it } from 'vitest'
import { checkRateLimit, evaluateRateLimit, getClientIp, RATE_LIMITS } from '../src/lib/rateLimit'

describe('getClientIp', () => {
  it('extracts IP from cf-connecting-ip header', () => {
    const req = new Request('https://example.com', {
      headers: { 'cf-connecting-ip': '203.0.113.195' },
    })
    expect(getClientIp(req)).toBe('203.0.113.195')
  })

  it('extracts first IP from x-forwarded-for header', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '198.51.100.22, 10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('198.51.100.22')
  })

  it('falls back to 127.0.0.1 when no header is present', () => {
    const req = new Request('https://example.com')
    expect(getClientIp(req)).toBe('127.0.0.1')
  })
})

describe('evaluateRateLimit', () => {
  it('allows the first request and sets window_start', () => {
    const res = evaluateRateLimit(null, 5, 300, 1000)
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(4)
    expect(res.resetAfterSeconds).toBe(300)
    expect(res.next).toEqual({ window_start: 1000, count: 1 })
  })

  it('increments count within the active window', () => {
    const current = { window_start: 1000, count: 4 }
    const res = evaluateRateLimit(current, 5, 300, 1050)
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(0)
    expect(res.next).toEqual({ window_start: 1000, count: 5 })
  })

  it('rejects requests when count exceeds limit', () => {
    const current = { window_start: 1000, count: 5 }
    const res = evaluateRateLimit(current, 5, 300, 1100)
    expect(res.allowed).toBe(false)
    expect(res.remaining).toBe(0)
    expect(res.resetAfterSeconds).toBe(200)
    expect(res.next).toEqual({ window_start: 1000, count: 6 })
  })

  it('resets window after windowSeconds has passed', () => {
    const current = { window_start: 1000, count: 6 }
    const res = evaluateRateLimit(current, 5, 300, 1301)
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(4)
    expect(res.next).toEqual({ window_start: 1301, count: 1 })
  })
})

describe('checkRateLimit with database', () => {
  it('calls D1 query and returns correct allowed status', async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ count: 3, window_start: 1000 }),
        }),
      }),
    } as unknown as D1Database

    const res = await checkRateLimit(mockDb, 'test-key', 5, 300, 1050)
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(2)
    expect(res.resetAfterSeconds).toBe(250)
  })

  it('flags not allowed when count exceeds limit', async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ count: 6, window_start: 1000 }),
        }),
      }),
    } as unknown as D1Database

    const res = await checkRateLimit(mockDb, 'test-key', 5, 300, 1050)
    expect(res.allowed).toBe(false)
    expect(res.remaining).toBe(0)
  })
})
