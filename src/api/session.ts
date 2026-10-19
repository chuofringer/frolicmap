import { API_BASE } from '@/config/constants'
import { getMemberCredential, useAuthStore } from '@/stores/useAuthStore'

export interface SessionMintResponse {
  token: string
  ttl_seconds: number
  /** True when the worker honored a member credential on this mint (real
   *  sign-in, 2026-07-26). Absent from pre-auth worker deploys → false. */
  member?: boolean
}

/**
 * Mint a new session token via `POST /api/session`. Phase 2c.
 *
 * Real sign-in (2026-07-26): when a member credential exists it rides the
 * mint body, upgrading the session to member tier — that's what unlocks
 * event details server-side. A credential the worker rejects (key rotation,
 * expiry) comes back `member: false`; we drop it so the UI shows the gate
 * again instead of silently browsing as a guest who looks signed in.
 *
 * Throws on non-2xx. The store sets `status = 'unavailable'` when the
 * backend returns 503 (SESSION_SIGNING_KEY not configured), so callers
 * can distinguish "server not set up" from "transient failure."
 */
export async function mintSession(): Promise<SessionMintResponse> {
  const credential = getMemberCredential()
  const res = await fetch(`${API_BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(credential ? { body: JSON.stringify({ credential }) } : {}),
  })
  if (res.status === 503) {
    throw new SessionUnavailableError('session auth not configured on worker')
  }
  if (!res.ok) throw new Error(`session mint failed: ${res.status}`)
  const data = (await res.json()) as SessionMintResponse
  if (credential && data.member === false) {
    useAuthStore.getState().signOut()
  }
  return data
}

export class SessionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionUnavailableError'
  }
}
