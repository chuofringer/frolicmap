import { create } from 'zustand'

// Session token state (data-protection Phase 2c). Held in memory only —
// never localStorage. XSS loses the session, not a persistent credential.
//
// `status`:
//   'idle'       → initial, mint hasn't fired yet
//   'loading'    → mint or refresh in flight
//   'ready'      → `token` + `exp` are valid, requests should use them
//   'failed'     → last mint errored; data fetches that require a token
//                  will 401; UI shows a fallback. `bootstrap()` can retry.
//   'unavailable'→ server returned 503 (SESSION_SIGNING_KEY not configured
//                  in worker). Distinct from 'failed' because retrying is
//                  pointless — operator needs to set the secret.
export type SessionStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'

interface SessionStore {
  token: string | null
  /** Unix seconds. Null when no valid token. */
  exp: number | null
  /**
   * Absolute expiry as epoch **milliseconds** (`Date.now()` + ttl). The wake
   * handlers in `useSession()` compare this against `Date.now()` to decide
   * whether a returning tab holds a still-live or an already-stale token.
   */
  expiresAt: number | null
  /**
   * Monotonic counter bumped ONLY on a *recovery* mint — one that replaces an
   * already-expired token or revives a `failed`/`idle` session. A routine
   * refresh (old token still valid) leaves it untouched. The vector `<Source>`
   * keys on it so a recovery remounts the source and refetches the tiles that
   * 401'd with the dead token, while a routine refresh causes no remount (no
   * flicker every ~4.5 min).
   */
  epoch: number
  status: SessionStatus
  /**
   * True when the current token was minted at member tier (a valid member
   * credential rode the mint — real sign-in, 2026-07-26). Event detail
   * fetches gate on this: a guest-tier token would just 401 `signin-required`
   * server-side, so firing the fetch before the member re-mint lands is a
   * wasted request.
   */
  member: boolean
  /** Last error message for debugging / `details unavailable` UI copy. */
  error: string | null
  setSession: (token: string, ttlSeconds: number, member?: boolean) => void
  setStatus: (status: SessionStatus, error?: string) => void
  clear: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  token: null,
  exp: null,
  expiresAt: null,
  epoch: 0,
  status: 'idle',
  member: false,
  error: null,
  setSession: (token, ttlSeconds, member = false) => {
    const now = Date.now()
    const exp = Math.floor(now / 1000) + ttlSeconds
    const expiresAt = now + ttlSeconds * 1000
    set((state) => {
      // A recovery mint is one where the token we're replacing was already
      // dead: no prior expiry, an expiry already in the past, or a session
      // that had given up ('failed') or never started ('idle'). Only those
      // bump `epoch`; a refresh of a still-valid token must not.
      const isRecovery =
        state.expiresAt == null ||
        state.expiresAt <= now ||
        state.status === 'failed' ||
        state.status === 'idle'
      return {
        token,
        exp,
        expiresAt,
        status: 'ready',
        member,
        error: null,
        epoch: isRecovery ? state.epoch + 1 : state.epoch,
      }
    })
  },
  setStatus: (status, error) => set({ status, error: error ?? null }),
  clear: () => set({ token: null, exp: null, expiresAt: null, status: 'idle', member: false, error: null }),
}))

/** Snapshot read for API helpers (non-hook consumers). */
export function getSessionToken(): string | null {
  return useSessionStore.getState().token
}
