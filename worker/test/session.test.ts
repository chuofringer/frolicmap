import { describe, it, expect } from 'vitest'
import { mintSessionToken, verifySessionToken, bearerToken } from '../src/utils/session'

const KEY = 'test-key-must-be-at-least-32-chars-long-for-hmac'

describe('session HMAC tokens', () => {
  describe('mintSessionToken', () => {
    it('returns a 2-part `<payload>.<signature>` string', async () => {
      const token = await mintSessionToken(KEY)
      const parts = token.split('.')
      expect(parts).toHaveLength(2)
      // Base64url alphabet only (A-Z a-z 0-9 - _)
      expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('throws if signing key is missing', async () => {
      await expect(mintSessionToken(undefined)).rejects.toThrow(/SESSION_SIGNING_KEY/)
    })

    it('embeds iat/exp matching the TTL', async () => {
      const now = new Date('2026-04-20T12:00:00Z')
      const token = await mintSessionToken(KEY, 300, now)
      const res = await verifySessionToken(KEY, token, now)
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.payload.iat).toBe(Math.floor(now.getTime() / 1000))
        expect(res.payload.exp).toBe(Math.floor(now.getTime() / 1000) + 300)
        expect(typeof res.payload.nonce).toBe('string')
        expect(res.payload.nonce.length).toBeGreaterThan(0)
      }
    })

    it('produces different nonces on each mint', async () => {
      const a = await mintSessionToken(KEY)
      const b = await mintSessionToken(KEY)
      expect(a).not.toBe(b)
    })
  })

  describe('verifySessionToken', () => {
    it('accepts a freshly-minted token', async () => {
      const token = await mintSessionToken(KEY)
      const res = await verifySessionToken(KEY, token)
      expect(res.valid).toBe(true)
    })

    it('rejects a token signed with a different key', async () => {
      const token = await mintSessionToken(KEY)
      const res = await verifySessionToken('a-completely-different-signing-key-abc123', token)
      expect(res).toEqual({ valid: false, reason: 'bad-signature' })
    })

    it('rejects an expired token', async () => {
      const iat = new Date('2026-04-20T12:00:00Z')
      const later = new Date('2026-04-20T12:10:00Z') // 10 min later, TTL is 5
      const token = await mintSessionToken(KEY, 300, iat)
      const res = await verifySessionToken(KEY, token, later)
      expect(res).toEqual({ valid: false, reason: 'expired' })
    })

    it('rejects a token exactly at its expiry (> not >=)', async () => {
      const iat = new Date('2026-04-20T12:00:00Z')
      const atExpiry = new Date('2026-04-20T12:05:00Z') // exactly TTL seconds later
      const token = await mintSessionToken(KEY, 300, iat)
      const res = await verifySessionToken(KEY, token, atExpiry)
      expect(res).toEqual({ valid: false, reason: 'expired' })
    })

    it('rejects a token with a tampered payload', async () => {
      const token = await mintSessionToken(KEY)
      const [, sig] = token.split('.')
      // Swap payload for something else; signature no longer matches.
      const tampered = 'eyJpYXQiOjEsImV4cCI6OTk5OTk5OTk5OSwibm9uY2UiOiJ4In0.' + sig
      const res = await verifySessionToken(KEY, tampered)
      expect(res.valid).toBe(false)
      // Either bad-signature (most likely) or malformed depending on what the
      // garbage payload parses as — we care that it's rejected, not which.
      if (!res.valid) expect(['bad-signature', 'malformed']).toContain(res.reason)
    })

    it('reports malformed for unparseable tokens', async () => {
      expect(await verifySessionToken(KEY, 'not-a-token')).toEqual({ valid: false, reason: 'malformed' })
      expect(await verifySessionToken(KEY, 'one.two.three')).toEqual({ valid: false, reason: 'malformed' })
      expect(await verifySessionToken(KEY, '')).toEqual({ valid: false, reason: 'malformed' })
      expect(await verifySessionToken(KEY, undefined)).toEqual({ valid: false, reason: 'malformed' })
    })

    it('reports missing-key when signing key is not set', async () => {
      const token = await mintSessionToken(KEY) // valid token
      const res = await verifySessionToken(undefined, token)
      expect(res).toEqual({ valid: false, reason: 'missing-key' })
    })
  })

  describe('bearerToken', () => {
    it('extracts the token from a well-formed header', () => {
      expect(bearerToken('Bearer abc.def')).toBe('abc.def')
      expect(bearerToken('bearer abc.def')).toBe('abc.def')  // case-insensitive
      expect(bearerToken('  Bearer   abc.def  ')).toBe('abc.def')  // trim + inner spaces
    })

    it('returns null for missing or malformed headers', () => {
      expect(bearerToken(undefined)).toBeNull()
      expect(bearerToken('')).toBeNull()
      expect(bearerToken('abc.def')).toBeNull()  // no "Bearer " prefix
      expect(bearerToken('Basic abc.def')).toBeNull()  // wrong scheme
    })
  })
})
