// HMAC-signed session tokens.
//
// Shape: `<base64url(payload)>.<base64url(hmacSha256(key, payload))>`
// Payload: `{iat: number, exp: number, nonce: string}` (JSON, then UTF-8).
//
// Not JWT on purpose: no header, no alg negotiation, no audience/issuer
// metadata, no key rotation kid. Those complications exist for third-party
// token ecosystems; this token is minted and verified by the same worker.
// Keep the wire format minimal and opaque.
//
// Design choices worth knowing:
// - Tokens are 5-minute TTL with silent client-side refresh 30s before expiry.
//   Stolen tokens age out quickly. No server-side revocation list — if a
//   token is compromised we rotate SESSION_SIGNING_KEY, which nukes every
//   live token instantly.
// - Token lives in memory only (Zustand), never localStorage. XSS → session
//   loss, not persistent account compromise.
// - SubtleCrypto is available on Workers runtime (Web Crypto API), no Node
//   polyfills needed.
// - This module has no I/O — signing key is passed in as an argument so
//   tests don't depend on env bindings.
//
// Enforcement: this file only exports the mint + verify primitives.
// `routes/public.ts` mints via `POST /api/session` and checks
// `Authorization: Bearer` on the data endpoints.

export interface SessionPayload {
  iat: number  // issued-at, seconds since epoch
  exp: number  // expires-at, seconds since epoch
  nonce: string  // opaque value, prevents token linking across mints
}

/** Token lifetime. Short on purpose; the SPA refreshes silently before expiry. */
export const SESSION_TTL_SECONDS = 5 * 60

function base64urlEncode(bytes: Uint8Array): string {
  // btoa is available on Workers; Uint8Array → string is the standard idiom.
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : ''
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importKey(signingKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function generateNonce(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return base64urlEncode(bytes)
}

/**
 * Mint a new session token. Caller must have verified the signing key is set
 * (throws with a clear message if not, so route handlers map this to a 503).
 *
 * @param signingKey - value of `env.SESSION_SIGNING_KEY`. ≥32 chars recommended.
 * @param ttlSeconds - defaults to 300 (5 min). Override for tests.
 * @param now - defaults to `new Date()`. Override for tests.
 */
export async function mintSessionToken(
  signingKey: string | undefined,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  now: Date = new Date(),
): Promise<string> {
  if (!signingKey) throw new Error('SESSION_SIGNING_KEY not configured')
  const iat = Math.floor(now.getTime() / 1000)
  const payload: SessionPayload = {
    iat,
    exp: iat + ttlSeconds,
    nonce: generateNonce(),
  }
  const encoded = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await importKey(signingKey)
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))
  return `${encoded}.${base64urlEncode(new Uint8Array(signature))}`
}

export type VerifyResult =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: 'missing-key' | 'malformed' | 'bad-signature' | 'expired' }

/**
 * Verify a session token. Returns a discriminated union so callers can
 * distinguish "no key configured" (server misconfig) from "expired" (client
 * needs to refresh) from "bad signature" (probably a forgery attempt).
 *
 * The signature check uses `crypto.subtle.verify`, which compares in constant
 * time. No throws on bad tokens — that's a normal 401 path, not an exception
 * path.
 */
export async function verifySessionToken(
  signingKey: string | undefined,
  token: string | undefined,
  now: Date = new Date(),
): Promise<VerifyResult> {
  if (!signingKey) return { valid: false, reason: 'missing-key' }
  if (!token || typeof token !== 'string') return { valid: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 2) return { valid: false, reason: 'malformed' }
  const [payloadB64, sigB64] = parts

  let signatureBytes: Uint8Array
  try { signatureBytes = base64urlDecode(sigB64) } catch { return { valid: false, reason: 'malformed' } }

  let payload: SessionPayload
  try {
    const json = new TextDecoder().decode(base64urlDecode(payloadB64))
    payload = JSON.parse(json) as SessionPayload
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || typeof payload.nonce !== 'string') {
      return { valid: false, reason: 'malformed' }
    }
  } catch { return { valid: false, reason: 'malformed' } }

  const key = await importKey(signingKey)
  const ok = await crypto.subtle.verify(
    'HMAC', key, signatureBytes, new TextEncoder().encode(payloadB64),
  )
  if (!ok) return { valid: false, reason: 'bad-signature' }

  const nowSec = Math.floor(now.getTime() / 1000)
  if (payload.exp <= nowSec) return { valid: false, reason: 'expired' }
  return { valid: true, payload }
}

/**
 * Extract a bearer token from an `Authorization: Bearer <token>` header.
 * Returns `null` when the header is missing or malformed so callers can
 * decide whether to 401 or fall through.
 */
export function bearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  return m ? m[1].trim() : null
}
