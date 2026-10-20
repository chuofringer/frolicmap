import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '../useSessionStore'

// Reset to the pristine initial state (including epoch) before each test so
// the monotonic counter starts from a known zero.
beforeEach(() => {
  useSessionStore.setState({
    token: null,
    exp: null,
    expiresAt: null,
    epoch: 0,
    status: 'idle',
    error: null,
  })
})

describe('useSessionStore.setSession', () => {
  it('stores expiresAt as epoch milliseconds from the ttl', () => {
    const before = Date.now()
    useSessionStore.getState().setSession('tok', 300)
    const { expiresAt, exp, token, status } = useSessionStore.getState()
    expect(token).toBe('tok')
    expect(status).toBe('ready')
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000)
    // exp stays unix seconds for the existing consumers.
    expect(exp).toBeCloseTo(Math.floor(before / 1000) + 300, -1)
  })

  it('bumps epoch on the first mint (recovering from idle)', () => {
    expect(useSessionStore.getState().epoch).toBe(0)
    useSessionStore.getState().setSession('t1', 300)
    expect(useSessionStore.getState().epoch).toBe(1)
  })

  it('does NOT bump epoch on a routine refresh of a still-valid token', () => {
    useSessionStore.getState().setSession('t1', 300) // idle → recovery, epoch 1
    expect(useSessionStore.getState().epoch).toBe(1)
    // Token still valid, status 'ready' — a routine refresh.
    useSessionStore.getState().setSession('t2', 300)
    expect(useSessionStore.getState().epoch).toBe(1)
    expect(useSessionStore.getState().token).toBe('t2')
  })

  it('bumps epoch when the previous token had already expired (recovery mint)', () => {
    useSessionStore.getState().setSession('t1', 300) // epoch 1
    useSessionStore.getState().setSession('t2', 300) // routine, epoch 1
    expect(useSessionStore.getState().epoch).toBe(1)
    // Simulate the token expiring while the tab was backgrounded.
    useSessionStore.setState({ expiresAt: Date.now() - 1 })
    useSessionStore.getState().setSession('t3', 300)
    expect(useSessionStore.getState().epoch).toBe(2)
  })

  it('bumps epoch when reviving a failed session even if the old expiry is still future', () => {
    useSessionStore.getState().setSession('t1', 300) // epoch 1
    useSessionStore.setState({ status: 'failed', expiresAt: Date.now() + 999_999 })
    useSessionStore.getState().setSession('t2', 300)
    expect(useSessionStore.getState().epoch).toBe(2)
    expect(useSessionStore.getState().status).toBe('ready')
  })
})
