import { API_BASE } from '@/config/constants'

export interface SessionMintResponse {
  token: string
  ttl_seconds: number
}

/**
 * Mint a new session token via `POST /api/session`.
 *
 * Throws on non-2xx. The store sets `status = 'unavailable'` when the
 * backend returns 503 (SESSION_SIGNING_KEY not configured), so callers
 * can distinguish "server not set up" from "transient failure."
 */
export async function mintSession(): Promise<SessionMintResponse> {
  const res = await fetch(`${API_BASE}/api/session`, { method: 'POST' })
  if (res.status === 503) {
    throw new SessionUnavailableError('session auth not configured on worker')
  }
  if (!res.ok) throw new Error(`session mint failed: ${res.status}`)
  return (await res.json()) as SessionMintResponse
}

export class SessionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionUnavailableError'
  }
}
