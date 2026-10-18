import { base64url, decoder, encoder, fromBase64 } from './encoding'

interface TokenUser { id: string; email: string; role: 'admin' | 'user' }

export async function tokenFor(user: TokenUser, secret: string, tokenVersion = 0) {
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = base64url(encoder.encode(JSON.stringify({ ...user, ver: tokenVersion, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 })))
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`))
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`
}

export async function passwordHash(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  return `${base64url(salt)}.${base64url(new Uint8Array(bits))}`
}

export async function passwordMatches(password: string, encoded: string) {
  const [salt, expected] = encoded.split('.')
  return (await passwordHash(password, fromBase64(salt))).split('.')[1] === expected
}

export async function encrypt(value: string, secret: string) {
  const raw = fromBase64(secret)
  if (raw.byteLength !== 32) throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value))
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`
}

export async function decrypt(value: string, secret: string) {
  const [iv, ciphertext] = value.split('.')
  const key = await crypto.subtle.importKey('raw', fromBase64(secret), 'AES-GCM', false, ['decrypt'])
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext)))
}

// Values may be stored encrypted (new) or as plain text (legacy rows); try decrypting first and fall back to the raw value
export async function maybeDecrypt(value: string | null, secret: string) {
  if (!value) return null
  if (!value.includes('.')) return value
  try { return await decrypt(value, secret) }
  catch { return value }
}

export async function resetCodeDigest(userId: string, code: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${userId}:${code}`))
  return base64url(new Uint8Array(digest))
}

export async function verifyResetCode(userId: string, code: string, digest: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, fromBase64(digest), encoder.encode(`${userId}:${code}`))
}
