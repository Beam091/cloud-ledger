export interface RateLimitConfig {
  limit: number
  windowSeconds: number
}

export const RATE_LIMITS = {
  LOGIN: { limit: 5, windowSeconds: 300 }, // 5 attempts per 5 minutes per IP+email
  PASSWORD_RESET: { limit: 3, windowSeconds: 900 }, // 3 attempts per 15 minutes per IP+email
  REGISTER: { limit: 5, windowSeconds: 3600 }, // 5 registrations per hour per IP
  AI: { limit: 30, windowSeconds: 3600 }, // 30 AI requests per hour per user
} as const

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAfterSeconds: number
}

export interface RateLimitEntry {
  window_start: number
  count: number
}

export function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || '127.0.0.1'
}

export function evaluateRateLimit(
  current: RateLimitEntry | null | undefined,
  limit: number,
  windowSeconds: number,
  nowSeconds: number
): { next: RateLimitEntry; allowed: boolean; remaining: number; resetAfterSeconds: number } {
  let next: RateLimitEntry
  if (!current || (nowSeconds - current.window_start >= windowSeconds)) {
    next = { window_start: nowSeconds, count: 1 }
  } else {
    next = { window_start: current.window_start, count: current.count + 1 }
  }
  const allowed = next.count <= limit
  const remaining = Math.max(0, limit - next.count)
  const resetAfterSeconds = Math.max(0, (next.window_start + windowSeconds) - nowSeconds)
  return { next, allowed, remaining, resetAfterSeconds }
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<RateLimitResult> {
  const row = await db.prepare(`
    INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN ? - window_start >= ? THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END
    RETURNING count, window_start
  `).bind(key, nowSeconds, nowSeconds, windowSeconds, nowSeconds, windowSeconds, nowSeconds)
    .first<{ count: number; window_start: number }>()

  if (!row) {
    return { allowed: true, remaining: limit, resetAfterSeconds: windowSeconds }
  }

  const allowed = row.count <= limit
  const remaining = Math.max(0, limit - row.count)
  const resetAfterSeconds = Math.max(0, (row.window_start + windowSeconds) - nowSeconds)
  return { allowed, remaining, resetAfterSeconds }
}
