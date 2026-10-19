import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSession } from '../useSession'
import { useSessionStore } from '@/stores/useSessionStore'

// Mock the network mint. Each test controls what a mint resolves to and counts
// how often it's invoked. SessionUnavailableError must stay a real class so the
// hook's `instanceof` branch keeps working.
const mintSession = vi.fn()
vi.mock('@/api/session', () => ({
  mintSession: () => mintSession(),
  SessionUnavailableError: class SessionUnavailableError extends Error {},
}))

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
}

// Flush pending microtasks + any 0ms timers under fake timers.
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  mintSession.mockReset()
  mintSession.mockResolvedValue({ token: 'tok', ttl_seconds: 300 })
  setVisibility('visible')
  useSessionStore.setState({
    token: null,
    exp: null,
    expiresAt: null,
    epoch: 0,
    status: 'idle',
    error: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSession wake recovery', () => {
  it('re-mints on a visibilitychange when the token is expired', async () => {
    const { unmount } = renderHook(() => useSession())
    await flush() // let the mount mint resolve
    expect(mintSession).toHaveBeenCalledTimes(1)

    // Token expired while the tab was backgrounded.
    useSessionStore.setState({ token: 'stale', status: 'ready', expiresAt: Date.now() - 1_000 })
    mintSession.mockClear()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(mintSession).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('does NOT re-mint on a visibilitychange when the token is still valid', async () => {
    const { unmount } = renderHook(() => useSession())
    await flush()
    expect(mintSession).toHaveBeenCalledTimes(1)

    // Comfortably valid — well past the 30s stale threshold.
    useSessionStore.setState({ token: 'good', status: 'ready', expiresAt: Date.now() + 300_000 })
    mintSession.mockClear()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(mintSession).not.toHaveBeenCalled()
    unmount()
  })

  it('recovers a failed session back to ready on a wake event (retry counter reset)', async () => {
    // First three mints reject → session gives up at status 'failed'.
    mintSession.mockRejectedValue(new Error('boom'))
    const { unmount } = renderHook(() => useSession())
    await flush()
    // Drain the backoff retries (5s, 20s).
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(useSessionStore.getState().status).toBe('failed')

    // Network is back; a wake event should recover despite the given-up state.
    mintSession.mockReset()
    mintSession.mockResolvedValue({ token: 'fresh', ttl_seconds: 300 })
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(mintSession).toHaveBeenCalledTimes(1)
    expect(useSessionStore.getState().status).toBe('ready')
    expect(useSessionStore.getState().token).toBe('fresh')
    unmount()
  })

  it('re-mints on a pageshow (bfcache restore) when the token is gone', async () => {
    const { unmount } = renderHook(() => useSession())
    await flush()
    useSessionStore.setState({ token: null, status: 'ready', expiresAt: null })
    mintSession.mockClear()

    window.dispatchEvent(new Event('pageshow'))
    await flush()

    expect(mintSession).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('removes its listeners on unmount', async () => {
    const { unmount } = renderHook(() => useSession())
    await flush()
    unmount()

    useSessionStore.setState({ token: null, status: 'ready', expiresAt: null })
    mintSession.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pageshow'))
    window.dispatchEvent(new Event('online'))
    await flush()

    expect(mintSession).not.toHaveBeenCalled()
  })
})
