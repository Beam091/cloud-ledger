import { connect } from 'cloudflare:sockets'
import { base64url, decoder, encoder, fromBase64 } from './lib/encoding'
import { sumBalances, toBaht, toSatang } from './lib/money'
import { dateInTz, tzOffsetMinutes } from './lib/timezone'
import { cronMatches } from './lib/cron'
import { tokenFor } from './lib/credentials'
import { decrypt, encrypt, maybeDecrypt, passwordHash, passwordMatches, resetCodeDigest, verifyResetCode } from './lib/credentials'
import { accountAliasVariants, normalizeAccountName, scoreAccountMatch } from './lib/accountMatch'
import { accountDeletionReversals, effectsDelta, isValidTransactionDate, transactionEffects } from './lib/transactions'
import { advanceRecurringDate, isValidFrequency, isValidRecurringDate } from './lib/recurring'

interface Env {
  DB: D1Database
  RECEIPTS?: R2Bucket
  JWT_SECRET: string
  ENCRYPTION_KEY: string
  APP_ORIGIN: string
  ASSETS?: Fetcher
}

interface AuthUser { id: string; email: string; role: 'admin' | 'user' }
interface UploadedFile { type: string; size: number; name: string; stream(): ReadableStream; arrayBuffer(): Promise<ArrayBuffer> }
interface UserRow extends AuthUser { password_hash: string; is_active: number }
interface AccountRow { id: string; user_id: string; name: string; type: string; balance: number; currency: string }
interface TransactionRow { id: string; user_id: string; account_id: string; transfer_account_id: string | null; type: 'income' | 'expense' | 'transfer'; amount: number; category: string; description: string | null; image_url: string | null; image_key: string | null; transaction_date: string }
interface NotificationRow { user_id: string; gmail_enabled: number; gmail_address: string | null; gmail_app_password_encrypted: string | null; telegram_enabled: number; telegram_bot_token: string | null; telegram_chat_id: string | null; discord_enabled: number; discord_webhook_url: string | null; cron_schedule: string; timezone: string; user_email?: string | null }
interface RecurringRow { id: string; user_id: string; account_id: string; transfer_account_id: string | null; type: 'income' | 'expense' | 'transfer'; amount: number; category: string; description: string; frequency: 'daily' | 'weekly' | 'monthly'; next_run_date: string; anchor_day?: number | null; is_active: number }
interface BudgetRow { id: string; user_id: string; category: string; amount: number }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const fail = (message: string, status = 400) => json({ error: message }, status)
const id = () => crypto.randomUUID()

const SESSION_COOKIE = 'ledgerly_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 14

// The session JWT lives in an httpOnly cookie so page scripts can never read it.
// The Bearer header is still accepted as a fallback for sessions created before
// this change (legacy localStorage tokens) until the next login.
function sessionCookie(request: Request, token: string | null) {
  const ownOrigin = new URL(request.url).origin
  const localDev = [ownOrigin, request.headers.get('origin') || ''].some((origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
  const expires = `Max-Age=${token ? SESSION_MAX_AGE : 0}`
  return `${SESSION_COOKIE}=${token || ''}; Path=/; ${expires}; HttpOnly; Secure; SameSite=${localDev ? 'None' : 'Strict'}`
}

async function sessionResponse(request: Request, env: Env, user: AuthUser, tokenVersion: number, status = 200) {
  const response = json({ user }, status)
  response.headers.append('set-cookie', sessionCookie(request, await tokenFor(user, env.JWT_SECRET, tokenVersion)))
  return response
}

async function authenticate(request: Request, env: Env): Promise<AuthUser | null> {
  const cookieToken = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`))?.[1]
  const token = cookieToken || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!token) return null
  try {
    const [header, payload, signature] = token.split('.')
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64(signature), encoder.encode(`${header}.${payload}`))
    const claims = JSON.parse(decoder.decode(fromBase64(payload))) as AuthUser & { exp: number; ver: number }
    if (!valid || claims.exp < Date.now() / 1000) return null
    const user = await env.DB.prepare('SELECT id, email, role, is_active, token_version FROM users WHERE id = ?').bind(claims.id).first<{ id: string; email: string; role: 'admin' | 'user'; is_active: number; token_version: number }>()
    return user?.is_active && claims.ver === user.token_version ? { id: user.id, email: user.email, role: user.role } : null
  } catch { return null }
}

async function body<T>(request: Request): Promise<T> {
  try { return await request.json() as T }
  catch { return {} as T }
}

function toClientAccount<T extends { balance: number }>(row: T) { return { ...row, balance: toBaht(row.balance) } }
function toClientTransaction<T extends { amount: number }>(row: T) { return { ...row, amount: toBaht(row.amount) } }

// Monthly spend per budget category (in satang), used by the dashboard, notifications and exports
async function budgetSummary(env: Env, userId: string, offsetClause: string, monthStart: string, asOfDate: string) {
  const rows = await env.DB.prepare("SELECT b.id, b.category, b.amount AS budget_satang, COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS spent_satang FROM budgets b LEFT JOIN transactions t ON t.user_id = b.user_id AND t.category = b.category AND date(t.transaction_date, ?) BETWEEN ? AND ? WHERE b.user_id = ? GROUP BY b.id ORDER BY b.category")
    .bind(offsetClause, monthStart, asOfDate, userId).all<{ id: string; category: string; budget_satang: number; spent_satang: number }>()
  return rows.results
}

async function settings(env: Env) {
  const result = await env.DB.prepare('SELECT key, value FROM system_settings').all<{ key: string; value: string }>()
  return Object.fromEntries(result.results.map((row) => [row.key, row.value]))
}

function normalizedAiBaseUrl(value: string) {
  const url = new URL(value)
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) throw new Error('AI base URL must use HTTPS')
  if (url.username || url.password || url.search || url.hash) throw new Error('AI base URL must not contain credentials, query, or fragment')
  return url.toString().replace(/\/+$/, '')
}

async function findBestAccountForText(env: Env, userId: string, accountName?: string, inputText = '') {
  const rows = await env.DB.prepare('SELECT id, name, type FROM accounts WHERE user_id = ? ORDER BY created_at').bind(userId).all<{ id: string; name: string; type: string }>()
  if (!rows.results.length) return null
  const fallback = rows.results[0]
  const normalizedText = normalizeAccountName(inputText)
  const explicitlyNamed = rows.results.filter((account) => accountAliasVariants(account.name).some((variant) => variant.length >= 3 && normalizedText.includes(variant)))
  if (explicitlyNamed.length === 1) return explicitlyNamed[0]
  const accountTypeKeywords: Record<string, string[]> = {
    e_wallet: ['wallet', 'e-wallet', 'วอลเล็ต', 'วอเลต', 'วอลเล็ท', 'กระเป๋าเงินออนไลน์'],
    cash: ['เงินสด', 'cash'],
  }
  const typedMatches = rows.results.filter((account) => accountTypeKeywords[account.type]?.some((keyword) => normalizedText.includes(normalizeAccountName(keyword))))
  if (typedMatches.length === 1) return typedMatches[0]
  const target = String(accountName || '').trim()
  if (!target) return fallback

  let bestMatch = fallback
  let bestScore = 0
  for (const account of rows.results) {
    const score = scoreAccountMatch(target, account.name)
    if (score > bestScore) {
      bestScore = score
      bestMatch = account
    }
  }
  return bestScore >= 40 ? bestMatch : fallback
}

async function parseWithAI(env: Env, input: string, image?: { mimeType: string; data: string }, accountNames: string[] = []) {
  const config = await settings(env)
  const apiKey = config.ai_api_key || ''
  if (!apiKey) throw new Error('AI API key is not configured by the administrator')
  const baseUrl = normalizedAiBaseUrl(config.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai')
  const model = config.ai_model || 'gemini-3.5-flash-lite'
  const prompt = `Extract one personal finance transaction. Return a JSON object with amount (number), type (income or expense), category (string), account_name (string), description (string), transaction_date (ISO 8601 string). Read the amount exactly as written or shown; do not add or remove zeros. Infer income/expense from the wording and infer conservatively. Choose account_name only from this user's accounts, returning the exact account name; use an empty string if unclear: ${JSON.stringify(accountNames)}. Match Thai phrases such as wallet/วอเลต to e-Wallet accounts and เงินสด to cash accounts. Input: ${input}`
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } })
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], response_format: { type: 'json_object' } }),
  })
  if (!response.ok) throw new Error(`AI request failed (${response.status})`)
  const result = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> }
  const messageContent = result.choices?.[0]?.message?.content
  const text = typeof messageContent === 'string' ? messageContent : messageContent?.map((part) => part.text || '').join('')
  if (!text) throw new Error('AI returned an empty response')
  return JSON.parse(text) as { amount: number; type: 'income' | 'expense'; category: string; account_name?: string; description: string; transaction_date?: string }
}

async function createTransaction(env: Env, user: AuthUser, data: Omit<TransactionRow, 'id' | 'user_id' | 'image_url' | 'image_key'> & { image_url?: string | null; image_key?: string | null }) {
  const amountSatang = toSatang(data.amount)
  if (!Number.isInteger(amountSatang) || amountSatang <= 0) throw new Error('จำนวนเงินไม่ถูกต้อง')
  if (!['income', 'expense', 'transfer'].includes(data.type)) throw new Error('ประเภทรายการไม่ถูกต้อง')
  if (data.type === 'transfer' && (!data.transfer_account_id || data.transfer_account_id === data.account_id)) throw new Error('กรุณาเลือกบัญชีปลายทางที่ต่างจากบัญชีต้นทาง')
  const source = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(data.account_id, user.id).first()
  if (!source) throw new Error('Account not found')
  if (data.type === 'transfer' && !await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(data.transfer_account_id!, user.id).first()) throw new Error('Account not found')
  const transactionId = id()
  const statements = [
    env.DB.prepare('INSERT INTO transactions (id, user_id, account_id, transfer_account_id, type, amount, category, description, image_url, image_key, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(transactionId, user.id, data.account_id, data.type === 'transfer' ? data.transfer_account_id! : null, data.type, amountSatang, data.category, data.description, data.image_url ?? null, data.image_key ?? null, data.transaction_date || new Date().toISOString()),
    ...transactionEffects({ ...data, amount: amountSatang }).map((effect) => env.DB.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND user_id = ?').bind(effect.delta, effect.account_id, user.id)),
  ]
  const batch = await env.DB.batch(statements)
  if (batch.some((result) => !result.success)) throw new Error('Could not save transaction')
  const row = await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(transactionId, user.id).first<{ amount: number } & Record<string, unknown>>()
  return row ? toClientTransaction(row) : row
}

function cors(response: Response, origin: string) {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  headers.set('access-control-allow-headers', 'Authorization,Content-Type')
  headers.set('access-control-allow-credentials', 'true')
  headers.set('vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/$/, '') || '/'
  const method = request.method
  if (path === '/api/health' && method === 'GET') return json({ ok: true })

  // Public: clearing the session cookie does not require a valid session
  if (path === '/api/auth/logout' && method === 'POST') {
    const response = json({ ok: true })
    response.headers.append('set-cookie', sessionCookie(request, null))
    return response
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const input = await body<{ email: string; password: string }>(request)
    const email = input.email?.trim().toLowerCase()
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !input.password || input.password.length < 8) return fail('กรุณากรอกอีเมลและรหัสผ่านอย่างน้อย 8 ตัวอักษร')
    if (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) return fail('อีเมลนี้ถูกใช้งานแล้ว', 409)
    const newId = id()
    try {
      await env.DB.prepare("INSERT INTO users (id, email, password_hash, role) SELECT ?, ?, ?, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'admin' ELSE 'user' END")
        .bind(newId, email, await passwordHash(input.password)).run()
    }
    catch (error) {
      console.error('Register error:', error)
      return fail('ไม่สามารถสร้างบัญชีได้ กรุณาลองอีกครั้ง', 409)
    }
    const userRow = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(newId).first<AuthUser>()
    if (!userRow) return fail('ไม่สามารถสร้างบัญชีได้ กรุณาลองอีกครั้ง', 500)
    return sessionResponse(request, env, userRow, 0, 201)
  }

  if (path === '/api/auth/forgot-password' && method === 'POST') {
    const input = await body<{ email: string }>(request)
    const email = input.email?.trim().toLowerCase()
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return fail('กรุณากรอกอีเมลให้ถูกต้อง')
    const config = await settings(env)
    if (!config.smtp_from_email || !config.smtp_app_password_encrypted) return fail('ระบบยังไม่ได้ตั้งค่าอีเมลส่ง OTP กรุณาติดต่อผู้ดูแลระบบ', 503)
    const generic = { message: 'หากอีเมลนี้มีบัญชีอยู่ ระบบจะส่งรหัส OTP ให้ภายในไม่กี่นาที' }
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ? AND is_active = 1').bind(email).first<{ id: string; email: string }>()
    if (!user) return json(generic)
    const recent = await env.DB.prepare("SELECT id FROM password_reset_otps WHERE user_id = ? AND created_at > datetime('now', '-60 seconds') LIMIT 1").bind(user.id).first()
    if (recent) return json(generic)
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
    const codeId = id()
    await env.DB.prepare('UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').bind(user.id).run()
    await env.DB.prepare("INSERT INTO password_reset_otps (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+10 minutes'))").bind(codeId, user.id, await resetCodeDigest(user.id, code, env.JWT_SECRET)).run()
    try {
      await sendSmtpMail(env, config.smtp_from_email, config.smtp_app_password_encrypted, user.email, 'รหัส OTP สำหรับตั้งรหัสผ่านใหม่', `รหัส OTP ของคุณคือ ${code}\nรหัสนี้ใช้ได้ 10 นาที และใช้ได้ครั้งเดียว\nหากคุณไม่ได้ร้องขอ สามารถละเว้นอีเมลฉบับนี้ได้`)
      return json(generic)
    } catch {
      await env.DB.prepare('UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(codeId).run()
      return fail('ส่งอีเมล OTP ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ', 502)
    }
  }

  if (path === '/api/auth/reset-password' && method === 'POST') {
    const input = await body<{ email: string; code: string; password: string }>(request)
    const email = input.email?.trim().toLowerCase()
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(input.code || '') || !input.password || input.password.length < 8) return fail('กรุณาตรวจสอบอีเมล, OTP 6 หลัก และรหัสผ่านอย่างน้อย 8 ตัวอักษร')
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND is_active = 1').bind(email).first<{ id: string }>()
    if (!user) return fail('OTP ไม่ถูกต้องหรือหมดอายุ', 400)
    const reset = await env.DB.prepare("SELECT id, code_hash FROM password_reset_otps WHERE user_id = ? AND used_at IS NULL AND attempts < 5 AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 1").bind(user.id).first<{ id: string; code_hash: string }>()
    if (!reset) return fail('OTP ไม่ถูกต้องหรือหมดอายุ', 400)
    if (!await verifyResetCode(user.id, input.code, reset.code_hash, env.JWT_SECRET)) {
      await env.DB.prepare('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL').bind(reset.id).run()
      return fail('OTP ไม่ถูกต้องหรือหมดอายุ', 400)
    }
    const claimed = await env.DB.prepare("UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL AND attempts < 5 AND expires_at > CURRENT_TIMESTAMP").bind(reset.id).run()
    if (!claimed.meta.changes) return fail('OTP ไม่ถูกต้องหรือหมดอายุ', 400)
    const changed = await env.DB.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND is_active = 1').bind(await passwordHash(input.password), user.id).run()
    if (!changed.meta.changes) return fail('ไม่สามารถเปลี่ยนรหัสผ่านได้', 400)
    await env.DB.prepare('UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').bind(user.id).run()
    return json({ message: 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง' })
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const input = await body<{ email: string; password: string }>(request)
    const row = await env.DB.prepare('SELECT id, email, role, password_hash, is_active, token_version FROM users WHERE email = ?').bind(input.email?.trim().toLowerCase() || '').first<UserRow & { token_version: number }>()
    if (!row || !(await passwordMatches(input.password || '', row.password_hash))) return fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401)
    if (!row.is_active) return fail('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแล', 403)
    return sessionResponse(request, env, { id: row.id, email: row.email, role: row.role }, row.token_version)
  }

  const user = await authenticate(request, env)
  if (!user) return fail('กรุณาเข้าสู่ระบบ', 401)
  if (path === '/api/auth/me' && method === 'GET') return json({ user })

  if (path === '/api/dashboard' && method === 'GET') {
    const period = ['day', 'week', 'month'].includes(url.searchParams.get('period') || '') ? (url.searchParams.get('period') as 'day' | 'week' | 'month') : 'month'
    const notificationRow = await env.DB.prepare('SELECT timezone FROM user_notification_settings WHERE user_id = ?').bind(user.id).first<{ timezone: string }>()
    const timezone = notificationRow?.timezone || 'Asia/Bangkok'
    const offsetClause = `+${tzOffsetMinutes(timezone)} minutes`
    const endDate = dateInTz(timezone)
    const start = new Date(`${endDate}T00:00:00Z`)
    if (period === 'day') {
      // start of day
    } else if (period === 'week') {
      start.setUTCDate(start.getUTCDate() - 6)
    } else {
      start.setUTCDate(1)
    }
    const startDate = start.toISOString().slice(0, 10)
    const monthStart = (() => { const monthDate = new Date(`${endDate}T00:00:00Z`); monthDate.setUTCDate(1); return monthDate.toISOString().slice(0, 10) })()
    const [accounts, recent, totals, categories, trend, budgets] = await Promise.all([
      env.DB.prepare('SELECT id, name, type, balance, currency FROM accounts WHERE user_id = ? ORDER BY created_at').bind(user.id).all<AccountRow>(),
      env.DB.prepare('SELECT t.*, a.name AS account_name, ta.name AS transfer_account_name FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.transfer_account_id WHERE t.user_id = ? ORDER BY t.transaction_date DESC LIMIT 8').bind(user.id).all<{ amount: number } & Record<string, unknown>>(),
      env.DB.prepare("SELECT type, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND date(transaction_date, ?) >= ? AND type IN ('income', 'expense') GROUP BY type").bind(user.id, offsetClause, startDate).all<{ type: string; total: number }>(),
      env.DB.prepare("SELECT category, SUM(amount) AS total FROM transactions WHERE user_id = ? AND type = 'expense' AND date(transaction_date, ?) >= ? GROUP BY category ORDER BY total DESC LIMIT 5").bind(user.id, offsetClause, startDate).all(),
      env.DB.prepare("WITH RECURSIVE days(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < ?) SELECT strftime('%d', days.day) AS day, COALESCE(SUM(t.amount), 0) AS total FROM days LEFT JOIN transactions t ON t.user_id = ? AND t.type = 'expense' AND date(t.transaction_date, ?) = days.day GROUP BY days.day ORDER BY days.day").bind(startDate, endDate, user.id, offsetClause).all<{ day: string; total: number }>(),
      budgetSummary(env, user.id, offsetClause, monthStart, endDate),
    ])
    const totalsByType = Object.fromEntries(totals.results.map((row) => [row.type, row.total]))
    return json({
      accounts: accounts.results.map(toClientAccount),
      transactions: recent.results.map(toClientTransaction),
      income: toBaht(totalsByType.income || 0),
      expense: toBaht(totalsByType.expense || 0),
      categories: categories.results.map((row) => ({ category: String(row.category), total: toBaht(Number(row.total)) })),
      trend: trend.results.map((row) => ({ day: row.day, total: toBaht(row.total) })),
      budgets: budgets.map((row) => ({ category: row.category, limit: toBaht(row.budget_satang), spent: toBaht(row.spent_satang) })),
      period,
      balance: sumBalances(accounts.results),
    })
  }

  if (path === '/api/accounts' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at').bind(user.id).all<AccountRow & Record<string, unknown>>()
    return json({ ...rows, results: rows.results.map(toClientAccount) })
  }
  if (path === '/api/accounts' && method === 'POST') {
    const input = await body<{ name: string; type: string; balance?: number }>(request)
    if (!input.name?.trim() || !['bank', 'e_wallet', 'cash', 'other'].includes(input.type)) return fail('ข้อมูลบัญชีไม่ถูกต้อง')
    const openingBalance = Number(input.balance || 0)
    if (!Number.isFinite(openingBalance)) return fail('ยอดเงินเริ่มต้นไม่ถูกต้อง')
    const accountId = id()
    await env.DB.prepare('INSERT INTO accounts (id, user_id, name, type, balance) VALUES (?, ?, ?, ?, ?)').bind(accountId, user.id, input.name.trim(), input.type, toSatang(openingBalance)).run()
    const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').bind(accountId, user.id).first<{ balance: number } & Record<string, unknown>>()
    return json(row ? toClientAccount(row) : null, 201)
  }
  const accountMatch = path.match(/^\/api\/accounts\/([^/]+)$/)
  if (accountMatch && method === 'PATCH') {
    const input = await body<{ name: string; type: string }>(request)
    const result = await env.DB.prepare('UPDATE accounts SET name = ?, type = ? WHERE id = ? AND user_id = ?').bind(input.name.trim(), input.type, accountMatch[1], user.id).run()
    return result.meta.changes ? json({ ok: true }) : fail('ไม่พบบัญชี', 404)
  }
  if (accountMatch && method === 'DELETE') {
    const rows = await env.DB.prepare('SELECT id, type, amount, account_id, transfer_account_id, image_key FROM transactions WHERE (account_id = ? OR transfer_account_id = ?) AND user_id = ?').bind(accountMatch[1], accountMatch[1], user.id).all<{ id: string; type: string; amount: number; account_id: string; transfer_account_id: string | null; image_key: string | null }>()
    const reversals = accountDeletionReversals(accountMatch[1], rows.results)
    const batch = await env.DB.batch([
      ...reversals.map((effect) => env.DB.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND user_id = ?').bind(effect.delta, effect.account_id, user.id)),
      env.DB.prepare('DELETE FROM transactions WHERE (account_id = ? OR transfer_account_id = ?) AND user_id = ?').bind(accountMatch[1], accountMatch[1], user.id),
      env.DB.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').bind(accountMatch[1], user.id),
    ])
    if (env.RECEIPTS) {
      for (const row of rows.results) if (row.image_key) await env.RECEIPTS.delete(row.image_key)
    }
    const accountDeleteResult = batch[batch.length - 1]
    return accountDeleteResult?.meta.changes ? json({ ok: true }) : fail('ไม่พบบัญชี', 404)
  }

  if (path === '/api/transactions' && method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500)
    const rows = await env.DB.prepare('SELECT t.*, a.name AS account_name, ta.name AS transfer_account_name FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.transfer_account_id WHERE t.user_id = ? ORDER BY t.transaction_date DESC LIMIT ?').bind(user.id, limit).all<{ amount: number } & Record<string, unknown>>()
    return json({ ...rows, results: rows.results.map(toClientTransaction) })
  }
  if (path === '/api/transactions' && method === 'POST') {
    const input = await body<{ account_id: string; transfer_account_id?: string; type: 'income' | 'expense' | 'transfer'; amount: number; category: string; description?: string; transaction_date?: string }>(request)
    if (!(input.amount > 0) || !['income', 'expense', 'transfer'].includes(input.type) || !input.category?.trim()) return fail('ข้อมูลรายการไม่ถูกต้อง')
    if (input.transaction_date !== undefined && !isValidTransactionDate(input.transaction_date)) return fail('วันที่รายการไม่ถูกต้อง')
    try {
      return json(await createTransaction(env, user, { account_id: input.account_id, transfer_account_id: input.transfer_account_id || null, type: input.type, amount: input.amount, category: input.category, description: input.description || '', transaction_date: input.transaction_date || new Date().toISOString() }), 201)
    } catch (error) {
      console.error('Create transaction failed:', error)
      return fail('ไม่สามารถบันทึกรายการได้ กรุณาตรวจสอบบัญชีที่เลือก', 422)
    }
  }
  const transactionMatch = path.match(/^\/api\/transactions\/([^/]+)$/)
  if (transactionMatch && method === 'PATCH') {
    const old = await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(transactionMatch[1], user.id).first<TransactionRow>()
    if (!old) return fail('ไม่พบรายการ', 404)
    const input = await body<Partial<TransactionRow>>(request)
    if (input.transaction_date !== undefined && !isValidTransactionDate(input.transaction_date)) return fail('วันที่รายการไม่ถูกต้อง')
    const nextAmount = input.amount === undefined ? Number(old.amount) : toSatang(input.amount)
    const nextType = input.type || old.type
    const nextTransferAccount = nextType === 'transfer'
      ? (input.transfer_account_id === undefined ? old.transfer_account_id : (input.transfer_account_id || null))
      : null
    const next = { account_id: input.account_id || old.account_id, type: nextType, amount: nextAmount, category: input.category || old.category, description: input.description ?? old.description, transaction_date: input.transaction_date || old.transaction_date, transfer_account_id: nextTransferAccount }
    if (!(next.amount > 0) || !Number.isInteger(next.amount) || !['income', 'expense', 'transfer'].includes(next.type)) return fail('ข้อมูลรายการไม่ถูกต้อง')
    if (next.type === 'transfer' && (!next.transfer_account_id || next.transfer_account_id === next.account_id)) return fail('กรุณาเลือกบัญชีปลายทางที่ต่างจากบัญชีต้นทาง')
    if (!await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(next.account_id, user.id).first()) return fail('ไม่พบบัญชี', 404)
    if (next.type === 'transfer' && !await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(next.transfer_account_id!, user.id).first()) return fail('ไม่พบบัญชีปลายทาง', 404)
    const balanceUpdates = effectsDelta(transactionEffects(old), transactionEffects(next)).map((effect) => env.DB.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND user_id = ?').bind(effect.delta, effect.account_id, user.id))
    await env.DB.batch([
      env.DB.prepare('UPDATE transactions SET account_id = ?, transfer_account_id = ?, type = ?, amount = ?, category = ?, description = ?, transaction_date = ? WHERE id = ? AND user_id = ?').bind(next.account_id, nextTransferAccount, next.type, next.amount, next.category, next.description, next.transaction_date, old.id, user.id),
      ...balanceUpdates,
    ])
    const row = await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(old.id, user.id).first<{ amount: number } & Record<string, unknown>>()
    return json(row ? toClientTransaction(row) : row)
  }
  if (transactionMatch && method === 'DELETE') {
    const old = await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(transactionMatch[1], user.id).first<TransactionRow>()
    if (!old) return fail('ไม่พบรายการ', 404)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(old.id, user.id),
      ...transactionEffects(old).map((effect) => env.DB.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ? AND user_id = ?').bind(effect.delta, effect.account_id, user.id)),
    ])
    if (old.image_key && env.RECEIPTS) await env.RECEIPTS.delete(old.image_key)
    return json({ ok: true })
  }

  if (path === '/api/recurring' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT r.*, a.name AS account_name, ta.name AS transfer_account_name FROM recurring_transactions r JOIN accounts a ON a.id = r.account_id LEFT JOIN accounts ta ON ta.id = r.transfer_account_id WHERE r.user_id = ? ORDER BY r.created_at DESC').bind(user.id).all<{ amount: number } & Record<string, unknown>>()
    return json({ ...rows, results: rows.results.map(toClientTransaction) })
  }
  if (path === '/api/recurring' && method === 'POST') {
    const input = await body<{ account_id: string; transfer_account_id?: string; type: string; amount: number; category: string; description?: string; frequency: string; start_date?: string }>(request)
    if (!['income', 'expense', 'transfer'].includes(input.type) || !isValidFrequency(input.frequency)) return fail('ข้อมูลรายการประจำไม่ถูกต้อง')
    const amountSatang = toSatang(input.amount)
    if (!(amountSatang > 0) || !input.category?.trim()) return fail('ข้อมูลรายการประจำไม่ถูกต้อง')
    if (!await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(input.account_id, user.id).first()) return fail('ไม่พบบัญชี', 404)
    let destination: string | null = null
    if (input.type === 'transfer') {
      destination = input.transfer_account_id || ''
      if (!destination || destination === input.account_id) return fail('กรุณาเลือกบัญชีปลายทางที่ต่างจากบัญชีต้นทาง')
      if (!await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(destination, user.id).first()) return fail('ไม่พบบัญชีปลายทาง', 404)
    }
    if (input.start_date !== undefined && !isValidRecurringDate(input.start_date)) return fail('วันที่เริ่มต้นไม่ถูกต้อง')
    const nextRun = input.start_date || dateInTz('Asia/Bangkok')
    const anchorDay = parseInt(nextRun.slice(8, 10), 10)
    const rowId = id()
    await env.DB.prepare('INSERT INTO recurring_transactions (id, user_id, account_id, transfer_account_id, type, amount, category, description, frequency, next_run_date, anchor_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(rowId, user.id, input.account_id, destination, input.type, amountSatang, input.category.trim(), input.description || '', input.frequency, nextRun, anchorDay).run()
    const row = await env.DB.prepare('SELECT id, account_id, transfer_account_id, type, amount, category, description, frequency, next_run_date, anchor_day, is_active FROM recurring_transactions WHERE id = ? AND user_id = ?').bind(rowId, user.id).first<{ amount: number } & Record<string, unknown>>()
    return json(row ? toClientTransaction(row) : row, 201)
  }
  const recurringMatch = path.match(/^\/api\/recurring\/([^/]+)$/)
  if (recurringMatch && (method === 'PATCH' || method === 'DELETE')) {
    const old = await env.DB.prepare('SELECT * FROM recurring_transactions WHERE id = ? AND user_id = ?').bind(recurringMatch[1], user.id).first<RecurringRow>()
    if (!old) return fail('ไม่พบรายการประจำ', 404)
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM recurring_transactions WHERE id = ? AND user_id = ?').bind(old.id, user.id).run()
      return json({ ok: true })
    }
    const input = await body<Partial<RecurringRow>>(request)
    const next = {
      account_id: input.account_id || old.account_id,
      type: input.type || old.type,
      amount: input.amount === undefined ? Number(old.amount) : toSatang(input.amount),
      category: input.category || old.category,
      description: input.description ?? old.description,
      frequency: isValidFrequency(input.frequency) ? input.frequency : old.frequency,
      next_run_date: input.next_run_date === undefined ? old.next_run_date : input.next_run_date,
      is_active: input.is_active === undefined ? old.is_active : (input.is_active ? 1 : 0),
    }
    if (!(next.amount > 0) || !Number.isFinite(next.amount) || !Number.isInteger(next.amount) || !['income', 'expense', 'transfer'].includes(next.type)) return fail('ข้อมูลรายการประจำไม่ถูกต้อง')
    if (input.next_run_date !== undefined && !isValidRecurringDate(input.next_run_date)) return fail('วันที่เริ่มต้นไม่ถูกต้อง')
    if (next.type === 'transfer' && (!input.transfer_account_id && !old.transfer_account_id)) return fail('กรุณาเลือกบัญชีปลายทาง')
    const destination = next.type === 'transfer' ? (input.transfer_account_id ?? old.transfer_account_id ?? '') : null
    if (next.type === 'transfer' && (!destination || destination === next.account_id)) return fail('กรุณาเลือกบัญชีปลายทางที่ต่างจากบัญชีต้นทาง')
    if (!await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(next.account_id, user.id).first()) return fail('ไม่พบบัญชี', 404)
    if (next.type === 'transfer' && !await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(destination!, user.id).first()) return fail('ไม่พบบัญชีปลายทาง', 404)
    const nextAnchor = input.next_run_date !== undefined
      ? parseInt(input.next_run_date.slice(8, 10), 10)
      : (old.anchor_day ?? parseInt(old.next_run_date.slice(8, 10), 10))
    const updates = await env.DB.prepare('UPDATE recurring_transactions SET account_id = ?, transfer_account_id = ?, type = ?, amount = ?, category = ?, description = ?, frequency = ?, next_run_date = ?, anchor_day = ?, is_active = ? WHERE id = ? AND user_id = ?')
      .bind(next.account_id, destination, next.type, next.amount, next.category, next.description, next.frequency, next.next_run_date, nextAnchor, next.is_active, old.id, user.id).run()
    return updates.meta.changes ? json({ ok: true }) : fail('แก้ไขรายการประจำไม่สำเร็จ')
  }

  if (path === '/api/budgets' && method === 'PUT') {
    const input = await body<{ category: string; amount: number }>(request)
    const category = input.category?.trim()
    if (!category || category.length > 60) return fail('กรุณาระบุหมวดหมู่งบประมาณ')
    const amountSatang = toSatang(input.amount)
    if (!Number.isFinite(amountSatang) || amountSatang < 0) return fail('ยอดงบประมาณไม่ถูกต้อง')
    if (!amountSatang) {
      await env.DB.prepare('DELETE FROM budgets WHERE user_id = ? AND category = ?').bind(user.id, category).run()
      return json({ ok: true, removed: true })
    }
    await env.DB.prepare('INSERT INTO budgets (id, user_id, category, amount) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, category) DO UPDATE SET amount = excluded.amount')
      .bind(id(), user.id, category, amountSatang).run()
    return json({ ok: true })
  }

  if (path === '/api/export' && method === 'GET') {
    const [accounts, transactions, recurring, budgets] = await Promise.all([
      env.DB.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at').bind(user.id).all<AccountRow>(),
      env.DB.prepare('SELECT t.*, a.name AS account_name, ta.name AS transfer_account_name FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.transfer_account_id WHERE t.user_id = ? ORDER BY t.transaction_date').bind(user.id).all<{ amount: number } & Record<string, unknown>>(),
      env.DB.prepare('SELECT r.*, a.name AS account_name, ta.name AS transfer_account_name FROM recurring_transactions r JOIN accounts a ON a.id = r.account_id LEFT JOIN accounts ta ON ta.id = r.transfer_account_id WHERE r.user_id = ? ORDER BY r.created_at').bind(user.id).all<{ amount: number } & Record<string, unknown>>(),
      env.DB.prepare('SELECT category, amount FROM budgets WHERE user_id = ? ORDER BY category').bind(user.id).all<BudgetRow>(),
    ])
    const stamp = new Date().toISOString().slice(0, 10)
    if (url.searchParams.get('format') === 'csv') {
      const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
      const lines = ['วันที่,ประเภท,หมวดหมู่,รายละเอียด,บัญชี,บัญชีปลายทาง,จำนวนเงิน (บาท)']
      for (const row of transactions.results) {
        const client = toClientTransaction(row)
        lines.push([row.transaction_date, row.type, row.category, row.description, row.account_name, row.transfer_account_name || '', client.amount].map(escape).join(','))
      }
      // BOM so Thai text opens correctly in Excel
      return new Response(`\uFEFF${lines.join('\r\n')}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ledgerly-transactions-${stamp}.csv"` } })
    }
    const payload = {
      exported_at: new Date().toISOString(),
      accounts: accounts.results.map(toClientAccount),
      transactions: transactions.results.map(toClientTransaction),
      recurring: recurring.results.map(toClientTransaction),
      budgets: budgets.results.map((row) => ({ ...row, amount: toBaht(row.amount) })),
    }
    return new Response(JSON.stringify(payload, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="ledgerly-backup-${stamp}.json"` } })
  }

  if (path === '/api/ai/parse' && method === 'POST') {
    const input = await body<{ text: string }>(request)
    if (!input.text?.trim()) return fail('กรุณาพิมพ์รายละเอียดรายการ')
    try {
      const accounts = await env.DB.prepare('SELECT name FROM accounts WHERE user_id = ? ORDER BY created_at').bind(user.id).all<{ name: string }>()
      const parsed = await parseWithAI(env, input.text, undefined, accounts.results.map((account) => account.name))
      const account = await findBestAccountForText(env, user.id, parsed.account_name, input.text)
      if (!account) return fail('กรุณาเพิ่มบัญชีก่อนบันทึกรายการ', 422)
      return json({ parsed, account_id: account.id, account_name: account.name })
    } catch (error) { return fail(error instanceof Error ? error.message : 'AI ประมวลผลไม่สำเร็จ', 502) }
  }
  if ((path === '/api/ai/slip/preview' || path === '/api/ai/slip') && method === 'POST') {
    const previewOnly = path.endsWith('/preview')
    const form = await request.formData()
    const upload = form.get('file')
    if (!upload || typeof upload === 'string') return fail('กรุณาเลือกไฟล์รูปภาพ')
    const file = upload as unknown as UploadedFile
    if (!file.type.startsWith('image/')) return fail('กรุณาเลือกไฟล์รูปภาพ')
    if (file.size > 8 * 1024 * 1024) return fail('รูปภาพต้องมีขนาดไม่เกิน 8 MB')
    try {
      let parsed: Awaited<ReturnType<typeof parseWithAI>> | undefined
      let account: Awaited<ReturnType<typeof findBestAccountForText>>
      if (previewOnly) {
        const accounts = await env.DB.prepare('SELECT name FROM accounts WHERE user_id = ? ORDER BY created_at').bind(user.id).all<{ name: string }>()
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        parsed = await parseWithAI(env, 'Read the transaction details from this receipt or bank transfer slip. Read every digit carefully and return the amount exactly as shown.', { mimeType: file.type, data: btoa(binary) }, accounts.results.map((item) => item.name))
        account = await findBestAccountForText(env, user.id, parsed.account_name)
        if (!account) throw new Error('กรุณาเพิ่มบัญชีก่อนบันทึกรายการ')
        return json({ parsed, account_id: account.id, account_name: account.name })
      }

      const accountId = String(form.get('account_id') || '')
      const type = String(form.get('type') || '')
      const amount = Number(form.get('amount'))
      const category = String(form.get('category') || '').trim()
      const description = String(form.get('description') || '').trim()
      const transactionDate = String(form.get('transaction_date') || '')
      if (!(amount > 0) || !Number.isFinite(amount) || !['income', 'expense'].includes(type) || !category) return fail('กรุณาตรวจสอบประเภท จำนวนเงิน และหมวดหมู่ก่อนบันทึก')
      if (transactionDate && !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) return fail('วันที่รายการไม่ถูกต้อง')
      const config = await settings(env)
      const keepImage = Boolean(env.RECEIPTS && config.image_retention_policy !== 'data_only')
      const key = keepImage ? `${user.id}/${id()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}` : null
      if (key && env.RECEIPTS) await env.RECEIPTS.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
      try {
        const transaction = await createTransaction(env, user, { account_id: accountId, transfer_account_id: null, type: type as 'income' | 'expense', amount, category, description, transaction_date: transactionDate ? `${transactionDate}T05:00:00.000Z` : new Date().toISOString(), image_url: key ? `/api/receipts/${encodeURIComponent(key)}` : null, image_key: key })
        return json({ transaction }, 201)
      } catch (error) {
        if (key && env.RECEIPTS) await env.RECEIPTS.delete(key)
        throw error
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'อ่านรูปภาพไม่สำเร็จ', 422)
    }
  }
  const receiptMatch = path.match(/^\/api\/receipts\/(.+)$/)
  if (receiptMatch && method === 'GET') {
    if (!env.RECEIPTS) return fail('ไม่พบรูปภาพ (ยังไม่ได้เปิดใช้ R2)', 404)
    const key = decodeURIComponent(receiptMatch[1])
    if (!await env.DB.prepare('SELECT id FROM transactions WHERE image_key = ? AND user_id = ?').bind(key, user.id).first()) return fail('ไม่พบรูปภาพ', 404)
    const object = await env.RECEIPTS.get(key)
    if (!object) return fail('ไม่พบรูปภาพ', 404)
    const headers = new Headers({ 'cache-control': 'private, max-age=300' })
    object.writeHttpMetadata(headers)
    return new Response(object.body, { headers })
  }

  if (path === '/api/notifications' && method === 'GET') {
    const row = await env.DB.prepare('SELECT gmail_enabled, gmail_address, telegram_enabled, telegram_chat_id, CASE WHEN telegram_bot_token IS NOT NULL THEN 1 ELSE 0 END AS telegram_token_set, discord_enabled, CASE WHEN discord_webhook_url IS NOT NULL THEN 1 ELSE 0 END AS discord_webhook_set, cron_schedule, timezone FROM user_notification_settings WHERE user_id = ?').bind(user.id).first()
    return json({
      ...(row || { gmail_enabled: 0, gmail_address: '', telegram_enabled: 0, telegram_token_set: 0, discord_enabled: 0, discord_webhook_set: 0, cron_schedule: '0 21 * * *', timezone: 'Asia/Bangkok' }),
      gmail_address: row?.gmail_address || user.email,
    })
  }
  if (path === '/api/notifications' && method === 'PUT') {
    const input = await body<{ gmail_enabled?: boolean; gmail_address?: string; telegram_enabled?: boolean; telegram_bot_token?: string; telegram_chat_id?: string; discord_enabled?: boolean; discord_webhook_url?: string; cron_schedule?: string; timezone?: string }>(request)
    const previous = await env.DB.prepare('SELECT * FROM user_notification_settings WHERE user_id = ?').bind(user.id).first<NotificationRow>()
    const schedule = (input.cron_schedule || previous?.cron_schedule || '0 21 * * *').trim()
    const allowedSchedules = new Set(['0 21 * * *', '0 21 * * 1', '0 21 1 * *'])
    if (!allowedSchedules.has(schedule)) return fail('เลือกส่งสรุปเป็นรายวัน, รายสัปดาห์ หรือ รายเดือนเท่านั้น')
    if (input.gmail_enabled) {
      const config = await settings(env)
      if (!config.smtp_from_email || !config.smtp_app_password_encrypted) return fail('ผู้ดูแลระบบต้องตั้งค่า Gmail sender ก่อนเปิดการแจ้งเตือน', 503)
    }
    const timezone = input.timezone || previous?.timezone || 'Asia/Bangkok'
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) }
    catch { return fail('เขตเวลาไม่ถูกต้อง') }
    let telegramToken: string | null
    let discordWebhook: string | null
    try {
      if (input.telegram_bot_token !== undefined) telegramToken = input.telegram_bot_token?.trim() ? await encrypt(input.telegram_bot_token.trim(), env.ENCRYPTION_KEY) : null
      else telegramToken = previous?.telegram_bot_token ?? null
      if (input.discord_webhook_url !== undefined) discordWebhook = input.discord_webhook_url?.trim() ? await encrypt(input.discord_webhook_url.trim(), env.ENCRYPTION_KEY) : null
      else discordWebhook = previous?.discord_webhook_url ?? null
    } catch (error) {
      console.error('Notification credential encryption failed:', error)
      return fail('ไม่สามารถบันทึกข้อมูลการแจ้งเตือนได้ กรุณาตรวจ ENCRYPTION_KEY ของระบบ', 500)
    }
    const recipientEmail = user.email.trim().toLowerCase()
    await env.DB.prepare(`INSERT INTO user_notification_settings (user_id, gmail_enabled, gmail_address, gmail_app_password_encrypted, telegram_enabled, telegram_bot_token, telegram_chat_id, discord_enabled, discord_webhook_url, cron_schedule, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET gmail_enabled=excluded.gmail_enabled, gmail_address=excluded.gmail_address, gmail_app_password_encrypted=excluded.gmail_app_password_encrypted, telegram_enabled=excluded.telegram_enabled, telegram_bot_token=excluded.telegram_bot_token, telegram_chat_id=excluded.telegram_chat_id, discord_enabled=excluded.discord_enabled, discord_webhook_url=excluded.discord_webhook_url, cron_schedule=excluded.cron_schedule, timezone=excluded.timezone, updated_at=CURRENT_TIMESTAMP`)
      .bind(user.id, Number(Boolean(input.gmail_enabled)), recipientEmail, null, Number(Boolean(input.telegram_enabled)), telegramToken, input.telegram_chat_id?.trim() || previous?.telegram_chat_id || null, Number(Boolean(input.discord_enabled)), discordWebhook, schedule, timezone).run()
    return json({ ok: true })
  }

  if (path.startsWith('/api/admin/')) {
    if (user.role !== 'admin') return fail('ต้องเป็นผู้ดูแลระบบ', 403)
    if (path === '/api/admin/users' && method === 'GET') return json(await env.DB.prepare('SELECT id, email, role, is_active, created_at FROM users ORDER BY created_at DESC').all())
    if (path.match(/^\/api\/admin\/users\/[^/]+$/) && method === 'PATCH') {
      const targetId = path.split('/').at(-1)!
      const input = await body<{ role?: string; is_active?: boolean }>(request)
      if (targetId === user.id && input.is_active === false) return fail('ไม่สามารถปิดใช้งานบัญชีของตัวเองได้')
      if (input.role && !['admin', 'user'].includes(input.role)) return fail('role ไม่ถูกต้อง')
      if (targetId === user.id && input.role && input.role !== user.role) return fail('ไม่สามารถเปลี่ยนบทบาทของบัญชีตัวเองได้')
      if (input.role === 'user' || input.is_active === false) {
        const target = await env.DB.prepare('SELECT role, is_active FROM users WHERE id = ?').bind(targetId).first<{ role: string; is_active: number }>()
        if (target?.role === 'admin' && (input.role === 'user' || (input.is_active === false && target.is_active))) {
          const admins = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").first<{ count: number }>()
          if ((admins?.count || 0) <= 1) return fail('ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อยหนึ่งบัญชี')
        }
      }
      await env.DB.prepare('UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?').bind(input.role || null, input.is_active === undefined ? null : Number(input.is_active), targetId).run()
      return json({ ok: true })
    }
    if (path === '/api/admin/ai/models' && method === 'POST') {
      const input = await body<{ base_url?: string; api_key?: string }>(request)
      let baseUrl: string
      try { baseUrl = normalizedAiBaseUrl(input.base_url || '') }
      catch (error) { return fail(error instanceof Error ? error.message : 'AI base URL ไม่ถูกต้อง') }
      const config = await settings(env)
      const apiKey = input.api_key?.trim() || config.ai_api_key
      if (!apiKey) return fail('กรุณากรอก API key ก่อนโหลดโมเดล')
      let response: Response
      try {
        response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } })
      } catch { return fail('เชื่อมต่อ AI base URL ไม่สำเร็จ', 502) }
      if (!response.ok) return fail(`โหลดรายชื่อโมเดลไม่สำเร็จ (${response.status})`, 502)
      const result = await response.json() as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string }> }
      const models = (result.data || result.models || []).map((model) => (model.id || model.name || '').replace(/^models\//, '')).filter(Boolean)
      return json({ models })
    }
    if (path === '/api/admin/settings/test-email' && method === 'POST') {
      const config = await settings(env)
      if (!config.smtp_from_email || !config.smtp_app_password_encrypted) return fail('กรุณาบันทึก Gmail sender และ App Password ก่อนส่งอีเมลทดสอบ', 422)
      try {
        await sendSmtpMail(env, config.smtp_from_email, config.smtp_app_password_encrypted, user.email, 'ทดสอบอีเมลจาก Ledgerly', 'การตั้งค่า Gmail sender ของเว็บไซต์ทำงานแล้ว')
        return json({ ok: true })
      } catch { return fail('ส่งอีเมลทดสอบไม่สำเร็จ กรุณาตรวจ Gmail sender และ App Password', 502) }
    }
    if (path === '/api/admin/settings' && method === 'GET') {
      const config = await settings(env)
      return json({ ...config, ai_api_key: undefined, smtp_app_password_encrypted: undefined, ai_key_set: Boolean(config.ai_api_key), smtp_app_password_set: Boolean(config.smtp_app_password_encrypted) })
    }
    if (path === '/api/admin/settings' && method === 'PUT') {
      const input = await body<Record<string, string>>(request)
      const allowed = ['ai_provider', 'ai_base_url', 'ai_model', 'ai_api_key', 'image_retention_policy', 'image_retention_days']
      if (input.image_retention_policy && !['full', 'auto_cleanup', 'data_only'].includes(input.image_retention_policy)) return fail('นโยบายรูปภาพไม่ถูกต้อง')
      let aiBaseUrl: string | undefined
      if (input.ai_base_url !== undefined) {
        try { aiBaseUrl = normalizedAiBaseUrl(input.ai_base_url) }
        catch (error) { return fail(error instanceof Error ? error.message : 'AI base URL ไม่ถูกต้อง') }
      }
      for (const key of allowed) if (input[key] !== undefined) await env.DB.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP').bind(key, key === 'ai_base_url' ? aiBaseUrl : input[key]).run()
      if (input.smtp_from_email !== undefined) {
        if (input.smtp_from_email && !/^\S+@\S+\.\S+$/.test(input.smtp_from_email)) return fail('อีเมลสำหรับส่ง OTP ไม่ถูกต้อง')
        await env.DB.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP').bind('smtp_from_email', input.smtp_from_email.trim().toLowerCase()).run()
      }
      if (input.smtp_app_password) {
        if (!/^[A-Za-z0-9]{16}$/.test(input.smtp_app_password)) return fail('Gmail App Password ต้องมี 16 ตัวอักษร')
        const encryptedPassword = await encrypt(input.smtp_app_password, env.ENCRYPTION_KEY)
        await env.DB.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP').bind('smtp_app_password_encrypted', encryptedPassword).run()
      }
      return json({ ok: true })
    }
  }
  return fail('ไม่พบ endpoint', 404)
}

async function sendSmtpMail(env: Env, from: string, encryptedPassword: string, to: string, subjectText: string, content: string) {
  if (!/^\S+@\S+\.\S+$/.test(from) || !/^\S+@\S+\.\S+$/.test(to)) throw new Error('SMTP email address is invalid')
  const socket = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on', allowHalfOpen: false })
  const writer = socket.writable.getWriter()
  const reader = socket.readable.getReader()
  const readResponse = async () => {
    let output = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      output += decoder.decode(value, { stream: true })
      if (output.split('\r\n').some((line) => /^\d{3} /.test(line))) break
    }
    return output
  }
  const send = async (command: string, expected: string) => {
    await writer.write(encoder.encode(`${command}\r\n`))
    const reply = await readResponse()
    if (!reply.startsWith(expected)) throw new Error(`SMTP error: ${reply.trim()}`)
  }
  try {
    if (!(await readResponse()).startsWith('220')) throw new Error('SMTP service unavailable')
    await send('EHLO ledgerly.local', '250')
    await send('AUTH LOGIN', '334')
    await send(btoa(from), '334')
    await send(btoa(await decrypt(encryptedPassword, env.ENCRYPTION_KEY)), '235')
    await send(`MAIL FROM:<${from}>`, '250')
    await send(`RCPT TO:<${to}>`, '250')
    await send('DATA', '354')
    const subject = btoa(unescape(encodeURIComponent(subjectText)))
    const text = content.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..')
    const message = `From: ${from}\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${subject}?=\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n.`
    await writer.write(encoder.encode(`${message}\r\n`))
    if (!(await readResponse()).startsWith('250')) throw new Error('SMTP message was rejected')
    await send('QUIT', '221')
  } finally {
    await writer.close().catch(() => undefined)
    await reader.cancel().catch(() => undefined)
    socket.close()
  }
}

async function emailSummary(env: Env, row: NotificationRow, summary: string, config: Record<string, string>) {
  const recipient = row.gmail_address || row.user_email
  if (!recipient) return
  if (!config.smtp_from_email || !config.smtp_app_password_encrypted) throw new Error('เว็บไซต์ยังไม่ได้ตั้งค่า Gmail sender')
  const subject = summary.includes('ประจำเดือน') ? 'สรุปการเงินประจำเดือน' : summary.includes('ประจำสัปดาห์') ? 'สรุปการเงินประจำสัปดาห์' : 'สรุปการเงินประจำวัน'
  await sendSmtpMail(env, config.smtp_from_email, config.smtp_app_password_encrypted, recipient, subject, summary)
}

async function dispatchNotification(env: Env, row: NotificationRow) {
  const config = await settings(env)
  const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone || 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]))
  const endDate = `${dateValues.year}-${dateValues.month}-${dateValues.day}`
  const fields = row.cron_schedule.trim().split(/\s+/)
  const scheduleType = fields[4] !== '*' && fields[2] === '*' ? 'weekly' : fields[2] !== '*' && fields[4] === '*' ? 'monthly' : 'daily'
  const start = new Date(`${endDate}T00:00:00Z`)
  if (scheduleType === 'weekly') start.setUTCDate(start.getUTCDate() - 6)
  if (scheduleType === 'monthly') {
    start.setUTCDate(1)
  }
  const startDate = start.toISOString().slice(0, 10)
  const totals = await env.DB.prepare('SELECT type, SUM(amount) AS total FROM transactions WHERE user_id = ? AND date(transaction_date, ?) BETWEEN ? AND ? GROUP BY type').bind(row.user_id, `+${tzOffsetMinutes(row.timezone)} minutes`, startDate, endDate).all<{ type: string; total: number }>()
  const values = Object.fromEntries(totals.results.map((item) => [item.type, item.total]))
  const formatDate = (value: string) => new Intl.DateTimeFormat('th-TH', { timeZone: row.timezone || 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`))
  const period = scheduleType === 'weekly' ? `${formatDate(startDate)} - ${formatDate(endDate)}` : scheduleType === 'monthly' ? `${formatDate(startDate)} - ${formatDate(endDate)}` : formatDate(endDate)
  const label = scheduleType === 'daily' ? 'ประจำวัน' : scheduleType === 'weekly' ? 'ประจำสัปดาห์' : 'ประจำเดือน'
  const bahtLabel = (value: unknown) => (Number(value || 0) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  let summary = `สรุปรายรับรายจ่าย${label} ${period}\nรายรับ ${bahtLabel(values.income)} บาท\nรายจ่าย ${bahtLabel(values.expense)} บาท`
  const monthStart = (() => { const monthDate = new Date(`${endDate}T00:00:00Z`); monthDate.setUTCDate(1); return monthDate.toISOString().slice(0, 10) })()
  try {
    const budgetRows = await budgetSummary(env, row.user_id, `+${tzOffsetMinutes(row.timezone)} minutes`, monthStart, endDate)
    if (budgetRows.length) {
      const lines = budgetRows.map((budget) => {
        const percent = budget.budget_satang > 0 ? Math.round((budget.spent_satang / budget.budget_satang) * 100) : 0
        return `${percent >= 90 ? '⚠️' : '•'} ${budget.category}: ${bahtLabel(budget.spent_satang)} / ${bahtLabel(budget.budget_satang)} บาท (${percent}%)`
      })
      summary += `\n\nงบประมาณรายเดือน\n${lines.join('\n')}`
    }
  } catch (error) { console.error('Budget summary failed:', error) }
  const telegramToken = await maybeDecrypt(row.telegram_bot_token, env.ENCRYPTION_KEY)
  const discordWebhookUrl = await maybeDecrypt(row.discord_webhook_url, env.ENCRYPTION_KEY)
  const tasks: Promise<unknown>[] = []
  if (row.telegram_enabled && telegramToken && row.telegram_chat_id) tasks.push(fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: row.telegram_chat_id, text: summary }) }).then((response) => { if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`) }))
  if (row.discord_enabled && discordWebhookUrl) tasks.push(fetch(discordWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: 'สรุปการเงิน', description: summary, color: 3682504 }] }) }).then((response) => { if (!response.ok) throw new Error(`Discord HTTP ${response.status}`) }))
  if (row.gmail_enabled && (row.gmail_address || row.user_email)) tasks.push(emailSummary(env, row, summary, config))
  const outcomes = await Promise.allSettled(tasks)
  for (const outcome of outcomes) if (outcome.status === 'rejected') console.error('Notification delivery failed:', outcome.reason)
  return outcomes
}

// Claiming the due date and applying its transaction share one D1 batch, so a
// failed or interrupted write cannot skip the occurrence or duplicate it.
async function materializeRecurring(env: Env) {
  const rows = await env.DB.prepare('SELECT r.*, n.timezone AS timezone FROM recurring_transactions r JOIN users u ON u.id = r.user_id LEFT JOIN user_notification_settings n ON n.user_id = r.user_id WHERE r.is_active = 1 AND u.is_active = 1').all<RecurringRow & { timezone?: string }>()
  for (const row of rows.results) {
    const today = dateInTz(row.timezone || 'Asia/Bangkok')
    let next = row.next_run_date
    let guard = 0
    const anchor = row.anchor_day ?? parseInt(row.next_run_date.slice(8, 10), 10)
    while (next <= today && guard < 400) {
      guard++
      const following = advanceRecurringDate(next, row.frequency, anchor)
      try {
        const transactionId = id()
        const statements = [
          env.DB.prepare('UPDATE recurring_transactions SET next_run_date = ? WHERE id = ? AND user_id = ? AND next_run_date = ?').bind(following, row.id, row.user_id, next),
          env.DB.prepare('INSERT INTO transactions (id, user_id, account_id, transfer_account_id, type, amount, category, description, image_url, image_key, transaction_date) SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ? WHERE changes() = 1')
            .bind(transactionId, row.user_id, row.account_id, row.type === 'transfer' ? row.transfer_account_id : null, row.type, row.amount, row.category, row.description || '', `${next}T05:00:00.000Z`),
          ...transactionEffects(row).map((effect) => env.DB.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND user_id = ?)').bind(effect.delta, effect.account_id, row.user_id, transactionId, row.user_id)),
        ]
        const result = await env.DB.batch(statements)
        if (result.some((statement) => !statement.success)) throw new Error('Could not materialize recurring transaction')
      } catch (error) {
        console.error(`Recurring transaction ${row.id} failed; it will retry:`, error)
        break
      }
      next = following
    }
  }
}

async function runScheduled(env: Env) {
  await materializeRecurring(env)
  const users = await env.DB.prepare('SELECT n.*, u.email AS user_email FROM user_notification_settings n JOIN users u ON u.id = n.user_id WHERE u.is_active = 1 AND (n.gmail_enabled = 1 OR n.telegram_enabled = 1 OR n.discord_enabled = 1)').all<NotificationRow>()
  const now = new Date()
  await Promise.allSettled(users.results.filter((row) => cronMatches(row.cron_schedule, now, row.timezone)).map((row) => dispatchNotification(env, row)))
  const config = await settings(env)
  if (config.image_retention_policy === 'auto_cleanup' && env.RECEIPTS) {
    const days = Math.max(1, Number(config.image_retention_days || 90))
    const expired = await env.DB.prepare("SELECT id, user_id, image_key FROM transactions WHERE image_key IS NOT NULL AND transaction_date < datetime('now', ?) ").bind(`-${days} days`).all<{ id: string; user_id: string; image_key: string }>()
    for (const row of expired.results) await env.RECEIPTS.delete(row.image_key)
    if (expired.results.length) await env.DB.batch(expired.results.map((row) => env.DB.prepare('UPDATE transactions SET image_url = NULL, image_key = NULL WHERE id = ? AND user_id = ?').bind(row.id, row.user_id)))
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const requestOrigin = request.headers.get('origin')
      // Always allow browser dev servers (localhost) so local development keeps working
      const localOrigin = Boolean(requestOrigin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin))
      const allowedOrigin = requestOrigin && (
        localOrigin ||
        !env.APP_ORIGIN ||
        env.APP_ORIGIN === '*' ||
        requestOrigin === env.APP_ORIGIN ||
        requestOrigin === url.origin
      ) ? requestOrigin : (env.APP_ORIGIN || url.origin)

      if (requestOrigin && !localOrigin && env.APP_ORIGIN && env.APP_ORIGIN !== '*' && requestOrigin !== env.APP_ORIGIN && requestOrigin !== url.origin) {
        return fail('Origin not allowed', 403)
      }
      if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), allowedOrigin)
      try { return cors(await handle(request, env), allowedOrigin) }
      catch (error) {
        console.error('Unhandled API error:', error)
        return cors(fail('เกิดข้อผิดพลาดในระบบ กรุณาลองอีกครั้ง', 500), allowedOrigin)
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response('Not Found', { status: 404 })
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(runScheduled(env)) },
}