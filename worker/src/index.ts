import { connect } from 'cloudflare:sockets'

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
interface TransactionRow { id: string; user_id: string; account_id: string; type: 'income' | 'expense' | 'transfer'; amount: number; category: string; description: string | null; image_url: string | null; image_key: string | null; transaction_date: string }
interface NotificationRow { user_id: string; gmail_enabled: number; gmail_address: string | null; gmail_app_password_encrypted: string | null; telegram_enabled: number; telegram_bot_token: string | null; telegram_chat_id: string | null; discord_enabled: number; discord_webhook_url: string | null; cron_schedule: string; timezone: string; user_email?: string | null }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const fail = (message: string, status = 400) => json({ error: message }, status)
const id = () => crypto.randomUUID()
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64url(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64(value: string) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function tokenFor(user: AuthUser, secret: string, tokenVersion = 0) {
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = base64url(encoder.encode(JSON.stringify({ ...user, ver: tokenVersion, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 })))
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`))
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`
}

async function authenticate(request: Request, env: Env): Promise<AuthUser | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
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

async function body<T>(request: Request): Promise<T> { return await request.json() as T }

async function passwordHash(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  return `${base64url(salt)}.${base64url(new Uint8Array(bits))}`
}

async function passwordMatches(password: string, encoded: string) {
  const [salt, expected] = encoded.split('.')
  return (await passwordHash(password, fromBase64(salt))).split('.')[1] === expected
}

async function encrypt(value: string, secret: string) {
  const raw = fromBase64(secret)
  if (raw.byteLength !== 32) throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value))
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`
}

async function decrypt(value: string, secret: string) {
  const [iv, ciphertext] = value.split('.')
  const key = await crypto.subtle.importKey('raw', fromBase64(secret), 'AES-GCM', false, ['decrypt'])
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext)))
}

async function resetCodeDigest(userId: string, code: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${userId}:${code}`))
  return base64url(new Uint8Array(digest))
}

async function verifyResetCode(userId: string, code: string, digest: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, fromBase64(digest), encoder.encode(`${userId}:${code}`))
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

function normalizeAccountName(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-_./()]+/g, '')
    .replace(/[^a-z0-9ก-ฮ]/g, '')
}

const bankNameAliases: Record<string, string[]> = {
  'กรุงไทย': ['ktb', 'krungthai', 'kbank', 'krungthai bank'],
  'กสิกรไทย': ['kasikorn', 'kbankthai', 'kasikornbank'],
  'ไทยพาณิชย์': ['scb', 'siamcommercialbank', 'thairath'],
  'ทหารไทย': ['tmb', 'ttb', 'thanachart', 'tmbbank'],
  'กรุงเทพ': ['bangkokbank', 'bbl'],
  'ออมสิน': ['gsb', 'governmentsavingbank'],
  'true money': ['truemoney', 'truemoneywallet', 'truewallet'],
  'e-wallet': ['ewallet', 'wallet', 'วอลเล็ต', 'วอเลต', 'วอลเล็ท', 'กระเป๋าเงินออนไลน์'],
  'promptpay': ['promptpay', 'พร้อมเพย์'],
  'cash': ['เงินสด', 'cash'],
}

function accountAliasVariants(value: string) {
  const variants = new Set<string>([normalizeAccountName(value)])
  const normalized = normalizeAccountName(value)
  for (const [canonical, aliases] of Object.entries(bankNameAliases)) {
    const normalizedCanonical = normalizeAccountName(canonical)
    if (!normalizedCanonical) continue
    if (normalized === normalizedCanonical || aliases.some((alias) => normalizeAccountName(alias) === normalized)) {
      variants.add(normalizedCanonical)
      for (const alias of [canonical, ...aliases]) variants.add(normalizeAccountName(alias))
    }
  }
  return [...variants].filter(Boolean)
}

function scoreAccountMatch(inputName: string, accountName: string) {
  const input = normalizeAccountName(inputName)
  const account = normalizeAccountName(accountName)
  if (!input || !account) return 0
  if (input === account) return 100

  const inputVariants = accountAliasVariants(inputName)
  const accountVariants = accountAliasVariants(accountName)
  if (inputVariants.some((variant) => accountVariants.includes(variant))) return 90

  if (account.includes(input) || input.includes(account)) return 75

  const shortInput = input.slice(0, 3)
  const shortAccount = account.slice(0, 3)
  if (shortInput && shortAccount && (account.includes(shortInput) || input.includes(shortAccount))) return 40

  return 0
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

function signedAmount(type: string, amount: number) { return type === 'income' ? amount : -amount }

function dateInTz(timezone: string, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) }
}

function tzOffsetMinutes(timezone: string) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || ''
    const match = name.match(/GMT([+-])(\d{2}):(\d{2})/)
    if (!match) return 420
    const sign = match[1] === '-' ? -1 : 1
    return sign * (Number(match[2]) * 60 + Number(match[3]))
  } catch { return 420 }
}

async function createTransaction(env: Env, user: AuthUser, data: Omit<TransactionRow, 'id' | 'user_id' | 'image_url' | 'image_key'> & { image_url?: string | null; image_key?: string | null }) {
  const account = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(data.account_id, user.id).first()
  if (!account) throw new Error('Account not found')
  const transactionId = id()
  const batch = await env.DB.batch([
    env.DB.prepare('INSERT INTO transactions (id, user_id, account_id, type, amount, category, description, image_url, image_key, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(transactionId, user.id, data.account_id, data.type, data.amount, data.category, data.description, data.image_url ?? null, data.image_key ?? null, data.transaction_date || new Date().toISOString()),
    env.DB.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND user_id = ?').bind(signedAmount(data.type, data.amount), data.account_id, user.id),
  ])
  if (batch.some((result) => !result.success)) throw new Error('Could not save transaction')
  return env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(transactionId, user.id).first()
}

function cors(response: Response, origin: string) {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  headers.set('access-control-allow-headers', 'Authorization,Content-Type')
  headers.set('vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/$/, '') || '/'
  const method = request.method
  if (path === '/api/health' && method === 'GET') return json({ ok: true })

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
    const user = userRow
    return json({ token: await tokenFor(user, env.JWT_SECRET), user }, 201)
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
    const row = await env.DB.prepare('SELECT id, email, role, password_hash, is_active, token_version FROM users WHERE email = ?').bind(input.email?.trim().toLowerCase()).first<UserRow & { token_version: number }>()
    if (!row || !(await passwordMatches(input.password || '', row.password_hash))) return fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401)
    if (!row.is_active) return fail('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแล', 403)
    const user = { id: row.id, email: row.email, role: row.role }
    return json({ token: await tokenFor(user, env.JWT_SECRET, row.token_version), user })
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
    const [accounts, recent, totals, categories, trend] = await Promise.all([
      env.DB.prepare('SELECT id, name, type, balance, currency FROM accounts WHERE user_id = ? ORDER BY created_at').bind(user.id).all<AccountRow>(),
      env.DB.prepare('SELECT t.*, a.name AS account_name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.user_id = ? ORDER BY t.transaction_date DESC LIMIT 8').bind(user.id).all(),
      env.DB.prepare("SELECT type, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND date(transaction_date, ?) >= ? AND type IN ('income', 'expense') GROUP BY type").bind(user.id, offsetClause, startDate).all<{ type: string; total: number }>(),
      env.DB.prepare("SELECT category, SUM(amount) AS total FROM transactions WHERE user_id = ? AND type = 'expense' AND date(transaction_date, ?) >= ? GROUP BY category ORDER BY total DESC LIMIT 5").bind(user.id, offsetClause, startDate).all(),
      env.DB.prepare("WITH RECURSIVE days(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < ?) SELECT strftime('%d', days.day) AS day, COALESCE(SUM(t.amount), 0) AS total FROM days LEFT JOIN transactions t ON t.user_id = ? AND t.type = 'expense' AND date(t.transaction_date, ?) = days.day GROUP BY days.day ORDER BY days.day").bind(startDate, endDate, user.id, offsetClause).all<{ day: string; total: number }>(),
    ])
    const totalsByType = Object.fromEntries(totals.results.map((row) => [row.type, row.total]))
    return json({ accounts: accounts.results, transactions: recent.results, income: totalsByType.income || 0, expense: totalsByType.expense || 0, categories: categories.results, trend: trend.results, period, balance: accounts.results.reduce((sum, account) => sum + account.balance, 0) })
  }

  if (path === '/api/accounts' && method === 'GET') return json(await env.DB.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at').bind(user.id).all())
  if (path === '/api/accounts' && method === 'POST') {
    const input = await body<{ name: string; type: string; balance?: number }>(request)
    if (!input.name?.trim() || !['bank', 'e_wallet', 'cash', 'other'].includes(input.type)) return fail('ข้อมูลบัญชีไม่ถูกต้อง')
    const accountId = id()
    await env.DB.prepare('INSERT INTO accounts (id, user_id, name, type, balance) VALUES (?, ?, ?, ?, ?)').bind(accountId, user.id, input.name.trim(), input.type, Number(input.balance || 0)).run()
    return json(await env.DB.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').bind(accountId, user.id).first(), 201)
  }
  const accountMatch = path.match(/^\/api\/accounts\/([^/]+)$/)
  if (accountMatch && method === 'PATCH') {
    const input = await body<{ name: string; type: string }>(request)
    const result = await env.DB.prepare('UPDATE accounts SET name = ?, type = ? WHERE id = ? AND user_id = ?').bind(input.name.trim(), input.type, accountMatch[1], user.id).run()
    return result.meta.changes ? json({ ok: true }) : fail('ไม่พบบัญชี', 404)
  }
  if (accountMatch && method === 'DELETE') {
    const rows = await env.DB.prepare('SELECT image_key FROM transactions WHERE account_id = ? AND user_id = ?').bind(accountMatch[1], user.id).all<{ image_key: string | null }>()
    const batch = await env.DB.batch([
      env.DB.prepare('DELETE FROM transactions WHERE account_id = ? AND user_id = ?').bind(accountMatch[1], user.id),
      env.DB.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').bind(accountMatch[1], user.id),
    ])
    if (env.RECEIPTS) {
      for (const row of rows.results) if (row.image_key) await env.RECEIPTS.delete(row.image_key)
    }
    return batch[1]?.meta.changes ? json({ ok: true }) : fail('ไม่พบบัญชี', 404)
  }

  if (path === '/api/transactions' && method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500)
    const rows = await env.DB.prepare('SELECT t.*, a.name AS account_name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.user_id = ? ORDER BY t.transaction_date DESC LIMIT ?').bind(user.id, limit).all()
    return json(rows.results)
  }
  if (path === '/api/transactions' && method === 'POST') {
    const input = await body<{ account_id: string; type: 'income' | 'expense'; amount: number; category: string; description?: string; transaction_date?: string }>(request)
    if (!(input.amount > 0) || !['income', 'expense'].includes(input.type) || !input.category?.trim()) return fail('ข้อมูลรายการไม่ถูกต้อง')
    return json(await createTransaction(env, user, { ...input, description: input.description || '', transaction_date: input.transaction_date || new Date().toISOString() }), 201)
  }
  const transactionMatch = path.match(/^\/api\/transactions\/([^/]+)$/)
  if (transactionMatch && method === 'PATCH') {
    const old = await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(transactionMatch[1], user.id).first<TransactionRow>()
    if (!old) return fail('ไม่พบรายการ', 404)
    const input = await body<Partial<TransactionRow>>(request)
    const next = { account_id: input.account_id || old.account_id, type: input.type || old.type, amount: input.amount ?? old.amount, category: input.category || old.category, description: input.description ?? old.description, transaction_date: input.transaction_date || old.transaction_date }
    if (!(next.amount > 0) || !['income', 'expense'].includes(next.type)) return fail('ข้อมูลรายการไม่ถูกต้อง')
    if (!await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(next.account_id, user.id).first()) return fail('ไม่พบบัญชี', 404)
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ? AND user_id = ?').bind(signedAmount(old.type, old.amount), old.account_id, user.id),
      env.DB.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND user_id = ?').bind(signedAmount(next.type, next.amount), next.account_id, user.id),
      env.DB.prepare('UPDATE transactions SET account_id = ?, type = ?, amount = ?, category = ?, description = ?, transaction_date = ? WHERE id = ? AND user_id = ?').bind(next.account_id, next.type, next.amount, next.category, next.description, next.transaction_date, old.id, user.id),
    ])
    return json(await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(old.id, user.id).first())
  }
  if (transactionMatch && method === 'DELETE') {
    const old = await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(transactionMatch[1], user.id).first<TransactionRow>()
    if (!old) return fail('ไม่พบรายการ', 404)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(old.id, user.id),
      env.DB.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ? AND user_id = ?').bind(signedAmount(old.type, old.amount), old.account_id, user.id),
    ])
    if (old.image_key && env.RECEIPTS) await env.RECEIPTS.delete(old.image_key)
    return json({ ok: true })
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
        const transaction = await createTransaction(env, user, { account_id: accountId, type: type as 'income' | 'expense', amount, category, description, transaction_date: transactionDate ? `${transactionDate}T05:00:00.000Z` : new Date().toISOString(), image_url: key ? `/api/receipts/${encodeURIComponent(key)}` : null, image_key: key })
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
    const recipientEmail = user.email.trim().toLowerCase()
    await env.DB.prepare(`INSERT INTO user_notification_settings (user_id, gmail_enabled, gmail_address, gmail_app_password_encrypted, telegram_enabled, telegram_bot_token, telegram_chat_id, discord_enabled, discord_webhook_url, cron_schedule, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET gmail_enabled=excluded.gmail_enabled, gmail_address=excluded.gmail_address, gmail_app_password_encrypted=excluded.gmail_app_password_encrypted, telegram_enabled=excluded.telegram_enabled, telegram_bot_token=excluded.telegram_bot_token, telegram_chat_id=excluded.telegram_chat_id, discord_enabled=excluded.discord_enabled, discord_webhook_url=excluded.discord_webhook_url, cron_schedule=excluded.cron_schedule, timezone=excluded.timezone, updated_at=CURRENT_TIMESTAMP`)
      .bind(user.id, Number(Boolean(input.gmail_enabled)), recipientEmail, null, Number(Boolean(input.telegram_enabled)), input.telegram_bot_token || previous?.telegram_bot_token || null, input.telegram_chat_id?.trim() || previous?.telegram_chat_id || null, Number(Boolean(input.discord_enabled)), input.discord_webhook_url || previous?.discord_webhook_url || null, schedule, timezone).run()
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

function cronFieldMatches(field: string, value: number, min: number, max: number) {
  return field.split(',').some((part) => {
    const [range, stepText] = part.split('/')
    const step = stepText ? Number(stepText) : 1
    if (!Number.isInteger(step) || step < 1) return false
    let start = min
    let end = max
    if (range !== '*') {
      if (range.includes('-')) {
        const [rangeStart, rangeEnd] = range.split('-').map(Number)
        start = rangeStart
        end = rangeEnd
      } else {
        start = Number(range)
        end = stepText ? max : start
      }
    }
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end && value >= start && value <= end && (value - start) % step === 0
  })
}

function cronMatches(expression: string, date: Date, timezone: string) {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'Asia/Bangkok', minute: 'numeric', hour: 'numeric', hourCycle: 'h23', day: 'numeric', month: 'numeric', weekday: 'short' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const minute = Number(values.minute)
  const hour = Number(values.hour)
  const day = Number(values.day)
  const month = Number(values.month)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  const dayMatches = cronFieldMatches(fields[2], day, 1, 31)
  const weekdayMatches = cronFieldMatches(fields[4], weekday, 0, 6)
  const dateMatches = fields[2] === '*' || fields[4] === '*' ? dayMatches && weekdayMatches : dayMatches || weekdayMatches
  return cronFieldMatches(fields[0], minute, 0, 59) && cronFieldMatches(fields[1], hour, 0, 23) && dateMatches && cronFieldMatches(fields[3], month, 1, 12)
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
  const summary = `สรุปรายรับรายจ่าย${label} ${period}\nรายรับ ${Number(values.income || 0).toLocaleString('th-TH')} บาท\nรายจ่าย ${Number(values.expense || 0).toLocaleString('th-TH')} บาท`
  const tasks: Promise<unknown>[] = []
  if (row.telegram_enabled && row.telegram_bot_token && row.telegram_chat_id) tasks.push(fetch(`https://api.telegram.org/bot${row.telegram_bot_token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: row.telegram_chat_id, text: summary }) }).then((response) => { if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`) }))
  if (row.discord_enabled && row.discord_webhook_url) tasks.push(fetch(row.discord_webhook_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: 'สรุปการเงิน', description: summary, color: 3682504 }] }) }).then((response) => { if (!response.ok) throw new Error(`Discord HTTP ${response.status}`) }))
  if (row.gmail_enabled && (row.gmail_address || row.user_email)) tasks.push(emailSummary(env, row, summary, config))
  const outcomes = await Promise.allSettled(tasks)
  for (const outcome of outcomes) if (outcome.status === 'rejected') console.error('Notification delivery failed:', outcome.reason)
  return outcomes
}

async function runScheduled(env: Env) {
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
      const allowedOrigin = requestOrigin && (
        !env.APP_ORIGIN ||
        env.APP_ORIGIN === '*' ||
        requestOrigin === env.APP_ORIGIN ||
        requestOrigin === url.origin
      ) ? requestOrigin : (env.APP_ORIGIN || url.origin)

      if (requestOrigin && env.APP_ORIGIN && env.APP_ORIGIN !== '*' && requestOrigin !== env.APP_ORIGIN && requestOrigin !== url.origin) {
        return fail('Origin not allowed', 403)
      }
      if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), allowedOrigin)
      try { return cors(await handle(request, env), allowedOrigin) }
      catch (error) { return cors(fail(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในระบบ', 500), allowedOrigin) }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response('Not Found', { status: 404 })
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(runScheduled(env)) },
}