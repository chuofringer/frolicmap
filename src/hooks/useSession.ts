import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/stores/useSessionStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { mintSession, SessionUnavailableError } from '@/api/session'

// Schedule the next refresh 30s BEFORE token expiry, matching the
// data-protection-plan.md spec. Worker TTL is 300s, so refresh window is
// ~270s post-mint.
const REFRESH_LEAD_SECONDS = 30

// A returning tab (visibility/pageshow/online) whose token expires within this
// window — or is already gone — is treated as stale and re-minted immediately.
// Same 30s lead as the scheduled refresh: the point at which the current token
// can no longer be trusted for the tiles a wake will re-request.
const STALE_THRESHOLD_MS = REFRESH_LEAD_SECONDS * 1000

/**
 * Boots the session lifecycle for the SPA (data-protection Phase 2c).
 * Called ONCE near the root of the app tree (`App.tsx`).
 *
 * Behaviour:
 * - On mount, mints a token via `POST /api/session` → stores in Zustand.
 * - Schedules a silent refresh `REFRESH_LEAD_SECONDS` before expiry.
 * - On refresh failure, retries with exponential backoff (5s → 20s → 60s)
 *   up to 3 attempts, then surfaces `status = 'failed'`. Map still works
 *   (list endpoint is public); popup detail fetches will 401 and show
 *   the "Details unavailable" fallback.
 * - On `503` (worker secret not set), sets `status = 'unavailable'` and
 *   does NOT retry — operator action required.
 *
 * Does not return anything. Reads via `useSessionStore(s => s.token)`
 * or `getSessionToken()` (non-hook).
 */
export function useSession(): void {
  const setSession = useSessionStore((s) => s.setSession)
  const setStatus = useSessionStore((s) => s.setStatus)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    // Guards against two mints racing — e.g. a `pageshow` + `visibilitychange`
    // firing back-to-back on a bfcache restore, or a wake landing mid-refresh.
    let inFlight = false

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const scheduleRefresh = (ttlSeconds: number) => {
      clearTimer()
      const waitMs = Math.max(1, ttlSeconds - REFRESH_LEAD_SECONDS) * 1000
      timerRef.current = setTimeout(() => { void mintAndSchedule() }, waitMs)
    }

    const backoffMs = (attempt: number): number => {
      // 5s, 20s, 60s. Attempts past 3 stop.
      const table = [5_000, 20_000, 60_000]
      return table[Math.min(attempt, table.length - 1)]
    }

    async function mintAndSchedule(): Promise<void> {
      if (cancelled) return
      if (inFlight) return
      inFlight = true
      setStatus('loading')
      try {
        const { token, ttl_seconds, member } = await mintSession()
        if (cancelled) return
        setSession(token, ttl_seconds, member === true)
        attemptRef.current = 0
        scheduleRefresh(ttl_seconds)
      } catch (err) {
        if (cancelled) return
        if (err instanceof SessionUnavailableError) {
          // Server misconfig — retrying won't help until operator fixes.
          setStatus('unavailable', err.message)
          return
        }
        attemptRef.current += 1
        const msg = err instanceof Error ? err.message : String(err)
        setStatus('failed', msg)
        // Past 3 attempts we stop the *backoff* timer — but a later wake event
        // (visibility/pageshow/online) resets the counter and re-mints, so a
        // laptop that slept through the retry window still recovers.
        if (attemptRef.current < 3) {
          clearTimer()
          timerRef.current = setTimeout(() => { void mintAndSchedule() }, backoffMs(attemptRef.current - 1))
        }
      } finally {
        inFlight = false
      }
    }

    // Wake handler: a tab returning to the foreground, restored from bfcache,
    // or reconnecting may be holding an expired token. MapLibre attaches that
    // dead Bearer per tile and does NOT retry the 401s until the map moves, so
    // we proactively re-mint when the token is missing, near/at expiry, or the
    // session had given up.
    const recoverIfStale = () => {
      if (cancelled) return
      const { token, expiresAt, status } = useSessionStore.getState()
      const stale =
        !token ||
        expiresAt == null ||
        expiresAt - Date.now() < STALE_THRESHOLD_MS
      if (stale || status === 'failed') {
        // Reset the retry counter first so a previously given-up session
        // ('failed' after 3 tries) mints again instead of staying dead.
        attemptRef.current = 0
        clearTimer()
        void mintAndSchedule()
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') recoverIfStale()
    }
    // `pageshow` fires on every load AND on bfcache restore (back-navigation
    // between /cities/{slug} pages); we validate on both rather than gating on
    // `event.persisted`.
    const onPageShow = () => recoverIfStale()
    const onOnline = () => recoverIfStale()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)

    // Real sign-in (2026-07-26): a credential change — sign-in on this tab,
    // sign-in synced from another tab via the storage event, or a
    // sign-out — must re-mint IMMEDIATELY so the session's tier matches. The
    // current token may be minutes from its scheduled refresh, and until the
    // re-mint lands, event-detail fetches would 401 `signin-required`.
    const unsubAuth = useAuthStore.subscribe((state, prev) => {
      if (state.credential === prev.credential) return
      attemptRef.current = 0
      clearTimer()
      void mintAndSchedule()
    })

    void mintAndSchedule()

    return () => {
      cancelled = true
      clearTimer()
      unsubAuth()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
    }
    // setSession / setStatus are stable Zustand actions — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
