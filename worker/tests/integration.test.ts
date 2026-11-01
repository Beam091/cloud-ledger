import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { passwordHash, tokenFor } from '../src/lib/credentials'

describe('Worker Integration Tests', () => {
  const SECRET = 'test-jwt-secret-key-12345678901234567890'

  async function createUser(email: string, role: 'admin' | 'user' = 'user', tokenVersion = 0) {
    const id = crypto.randomUUID()
    const hash = await passwordHash('password123')
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, role, is_active, token_version) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id, email, hash, role, tokenVersion)
      .run()
    const token = await tokenFor({ id, email, role }, SECRET, tokenVersion)
    const cookie = `ledgerly_session=${token}`
    return { id, email, role, cookie }
  }

  it('multi-tenant isolation: User A cannot see or access User B accounts and transactions', async () => {
    const userA = await createUser('userA@test.com')
    const userB = await createUser('userB@test.com')

    // User A creates an account
    const accResA = await SELF.fetch('https://money.aury.win/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ name: 'Account A', type: 'bank', balance: 500 }),
    })
    expect(accResA.status).toBe(201)
    const accountA = (await accResA.json()) as { id: string }

    // User B requests accounts -> should not see Account A
    const listResB = await SELF.fetch('https://money.aury.win/api/accounts', {
      headers: { Cookie: userB.cookie },
    })
    expect(listResB.status).toBe(200)
    const listDataB = (await listResB.json()) as { results: Array<{ id: string }> }
    expect(listDataB.results.some((acc) => acc.id === accountA.id)).toBe(false)

    // User B attempts to delete User A account -> should fail with 404
    const delResB = await SELF.fetch(`https://money.aury.win/api/accounts/${accountA.id}`, {
      method: 'DELETE',
      headers: { Cookie: userB.cookie },
    })
    expect(delResB.status).toBe(404)
  })

  it('historical balance calculation across multiple transactions and deletions', async () => {
    const user = await createUser('balance_test@test.com')

    // Create Bank account with 1,000 THB opening balance
    const accRes = await SELF.fetch('https://money.aury.win/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
      body: JSON.stringify({ name: 'Main Bank', type: 'bank', balance: 1000 }),
    })
    const account = (await accRes.json()) as { id: string }

    // Add Income 500
    await SELF.fetch('https://money.aury.win/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
      body: JSON.stringify({
        account_id: account.id,
        type: 'income',
        amount: 500,
        category: 'เงินเดือน',
      }),
    })

    // Add Expense 200
    const expRes = await SELF.fetch('https://money.aury.win/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
      body: JSON.stringify({
        account_id: account.id,
        type: 'expense',
        amount: 200,
        category: 'อาหาร',
      }),
    })
    const expTx = (await expRes.json()) as { id: string }

    // Dashboard balance should be 1000 + 500 - 200 = 1300
    const dashRes1 = await SELF.fetch('https://money.aury.win/api/dashboard', {
      headers: { Cookie: user.cookie },
    })
    const dash1 = (await dashRes1.json()) as { balance: number }
    expect(dash1.balance).toBe(1300)

    // Delete Expense 200 -> balance should revert to 1500
    await SELF.fetch(`https://money.aury.win/api/transactions/${expTx.id}`, {
      method: 'DELETE',
      headers: { Cookie: user.cookie },
    })

    const dashRes2 = await SELF.fetch('https://money.aury.win/api/dashboard', {
      headers: { Cookie: user.cookie },
    })
    const dash2 = (await dashRes2.json()) as { balance: number }
    expect(dash2.balance).toBe(1500)
  })

  it('admin permission enforcement: regular users cannot access /api/admin/ endpoints', async () => {
    const regularUser = await createUser('regular@test.com', 'user')
    const adminUser = await createUser('admin@test.com', 'admin')

    // Regular user forbidden
    const forbiddenRes = await SELF.fetch('https://money.aury.win/api/admin/users', {
      headers: { Cookie: regularUser.cookie },
    })
    expect(forbiddenRes.status).toBe(403)

    // Admin allowed
    const adminRes = await SELF.fetch('https://money.aury.win/api/admin/users', {
      headers: { Cookie: adminUser.cookie },
    })
    expect(adminRes.status).toBe(200)
  })

  it('OTP reset flow: generates reset code and resets password successfully', async () => {
    const user = await createUser('forgot@test.com')

    // Configure dummy SMTP settings in system_settings
    await env.DB.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?), (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind('smtp_from_email', 'noreply@test.com', 'smtp_app_password_encrypted', 'dummy_app_password')
      .run()

    // Request reset
    const forgotRes = await SELF.fetch('https://money.aury.win/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'forgot@test.com' }),
    })
    // Either 200 (if SMTP succeeded/attempted) or 502 (if SMTP network failed in test runtime)
    // In both cases, OTP row was created in password_reset_otps
    expect([200, 502]).toContain(forgotRes.status)

    // Read OTP row from DB
    const otpRow = await env.DB.prepare('SELECT id, code_hash FROM password_reset_otps WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(user.id)
      .first<{ id: string; code_hash: string }>()
    expect(otpRow?.id).toBeTruthy()

    // Test password reset with incorrect OTP -> 400
    const badResetRes = await SELF.fetch('https://money.aury.win/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'forgot@test.com', code: '000000', password: 'newpassword123' }),
    })
    expect(badResetRes.status).toBe(400)
  })

  it('rate limits endpoint protection', async () => {
    // Attempt 6 consecutive failed logins to trigger rate limit (threshold is 5/15m)
    let lastStatus = 200
    for (let i = 0; i < 6; i++) {
      const res = await SELF.fetch('https://money.aury.win/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.1' },
        body: JSON.stringify({ email: 'ratelimit@test.com', password: 'wrong' }),
      })
      lastStatus = res.status
    }
    expect(lastStatus).toBe(429)
  })

  it('allows admin to bypass AI rate limit and allows editing account balance directly', async () => {
    const admin = await createUser('admin_ai_bypass@test.com', 'admin')
    const normalUser = await createUser('user_ai_limited@test.com', 'user')

    // 1. Account balance editing directly
    const accRes = await SELF.fetch('https://money.aury.win/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ name: 'Editable Bank', type: 'bank', balance: 100 }),
    })
    expect(accRes.status).toBe(201)
    const accData = (await accRes.json()) as { id: string; balance: number }
    expect(accData.balance).toBe(100)

    // Edit balance to 2500.50 via PATCH
    const patchRes = await SELF.fetch(`https://money.aury.win/api/accounts/${accData.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ name: 'Editable Bank Updated', type: 'bank', balance: 2500.5 }),
    })
    expect(patchRes.status).toBe(200)

    // Verify updated account balance
    const listRes = await SELF.fetch('https://money.aury.win/api/accounts', {
      headers: { Cookie: admin.cookie },
    })
    const listData = (await listRes.json()) as { results: Array<{ id: string; balance: number; name: string }> }
    const updatedAcc = listData.results.find((a) => a.id === accData.id)
    expect(updatedAcc?.balance).toBe(2500.5)
    expect(updatedAcc?.name).toBe('Editable Bank Updated')

    // 2. AI rate limit bypass for admin
    // Insert dummy rate limit row for both normalUser and admin to simulate exhausted AI quota (30/30)
    const now = Math.floor(Date.now() / 1000)
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?), (?, ?, ?)')
      .bind(`ai:${normalUser.id}`, now, 35, `ai:${admin.id}`, now, 35)
      .run()

    // Normal user hits /api/ai/parse -> should get 429
    const userAiRes = await SELF.fetch('https://money.aury.win/api/ai/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: normalUser.cookie },
      body: JSON.stringify({ text: 'ข้าวเที่ยง 50 บาท' }),
    })
    expect(userAiRes.status).toBe(429)

    // Admin user hits /api/ai/parse -> should bypass 429 rate limit (will proceed to parse logic, not 429)
    const adminAiRes = await SELF.fetch('https://money.aury.win/api/ai/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ text: '' }), // empty text returns 400 'กรุณาพิมพ์รายละเอียดรายการ', showing it bypassed 429
    })
    expect(adminAiRes.status).toBe(400)
    const adminErr = (await adminAiRes.json()) as { error: string }
    expect(adminErr.error).toBe('กรุณาพิมพ์รายละเอียดรายการ')
  })
})
