import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, maybeDecrypt, passwordHash, passwordMatches, resetCodeDigest, tokenFor, verifyResetCode } from '../src/lib/credentials'

// base64 of 32 arbitrary bytes
const SECRET = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
const WRONG_SECRET = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWf='

describe('AES encrypt/decrypt', () => {
  it('round-trips secrets', async () => {
    const value = 'https://discord.com/api/webhooks/9998887776/token'
    const stored = await encrypt(value, SECRET)
    expect(stored).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(await decrypt(stored, SECRET)).toBe(value)
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    expect(await encrypt('same', SECRET)).not.toBe(await encrypt('same', SECRET))
  })

  it('refuses keys that are not exactly 32 bytes', async () => {
    await expect(encrypt('x', 'c2hvcnQ=')).rejects.toThrow('ENCRYPTION_KEY')
  })

  it('cannot be decrypted with another key', async () => {
    const stored = await encrypt('top-secret', SECRET)
    await expect(decrypt(stored, WRONG_SECRET)).rejects.toThrow()
  })
})

describe('maybeDecrypt', () => {
  it('passes null and plain (legacy) values straight through', async () => {
    expect(await maybeDecrypt(null, SECRET)).toBeNull()
    expect(await maybeDecrypt('123456789:PLAINTEXT-LEGACY-TOKEN', SECRET)).toBe('123456789:PLAINTEXT-LEGACY-TOKEN')
  })

  it('decrypts stored values', async () => {
    const stored = await encrypt('my bot token', SECRET)
    expect(await maybeDecrypt(stored, SECRET)).toBe('my bot token')
  })

  it('falls back to the raw value when decryption fails', async () => {
    expect(await maybeDecrypt('garbage.ivcipher', SECRET)).toBe('garbage.ivcipher')
  })
})

describe('password hash', () => {
  it('verifies the right password and rejects wrong ones', async () => {
    const encoded = await passwordHash('correct horse battery')
    expect(await passwordMatches('correct horse battery', encoded)).toBe(true)
    expect(await passwordMatches('wrong horse', encoded)).toBe(false)
  })

  it('salts every hash differently', async () => {
    expect(await passwordHash('same')).not.toBe(await passwordHash('same'))
  })
})

describe('token', () => {
  it('signs an HS256 JWT with a 14 day expiry', async () => {
    const token = await tokenFor({ id: 'u1', email: 'u1@test.com', role: 'user' }, 'jwt-secret', 3)
    const [header, payload, signature] = token.split('.')
    expect(JSON.parse(atob(header.replaceAll('-', '+').replaceAll('/', '_')))).toEqual({ alg: 'HS256', typ: 'JWT' })
    const claims = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('/', '_')))
    expect(claims.ver).toBe(3)
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 13)
    expect(signature.length).toBeGreaterThan(20)
  })

  it('defaults token version to 0', async () => {
    const [, payload] = (await tokenFor({ id: 'u1', email: 'u1@test.com', role: 'user' }, 'jwt-secret')).split('.')
    expect(JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('/', '_'))).ver).toBe(0)
  })
})

describe('reset code digest', () => {
  it('is verifiable only for the same user + code', async () => {
    const userId = randomUUID()
    const digest = await resetCodeDigest(userId, '123456', SECRET)
    expect(await verifyResetCode(userId, '123456', digest, SECRET)).toBe(true)
    expect(await verifyResetCode(userId, '654321', digest, SECRET)).toBe(false)
    expect(await verifyResetCode(randomUUID(), '123456', digest, SECRET)).toBe(false)
  })
})
