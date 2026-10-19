import { describe, it, expect, beforeEach } from 'vitest'
import {
  WAITLIST_DISMISSED_KEY,
  WAITLIST_SUBMITTED_KEY,
  waitlistDismissed,
  dismissWaitlist,
  waitlistSubmitted,
  markWaitlistSubmitted,
} from '../bot'

describe('waitlist storage helpers', () => {
  beforeEach(() => {
    localStorage.removeItem(WAITLIST_DISMISSED_KEY)
    localStorage.removeItem(WAITLIST_SUBMITTED_KEY)
  })

  it('waitlistDismissed is false when key absent', () => {
    expect(waitlistDismissed()).toBe(false)
  })

  it('dismissWaitlist sets a future timestamp ~30 days out', () => {
    const now = 1_700_000_000_000
    dismissWaitlist(now)
    const stored = Number(localStorage.getItem(WAITLIST_DISMISSED_KEY))
    expect(stored).toBe(now + 30 * 24 * 60 * 60 * 1000)
    expect(waitlistDismissed(now + 1)).toBe(true)
    expect(waitlistDismissed(stored - 1)).toBe(true)
    expect(waitlistDismissed(stored)).toBe(false)
    expect(waitlistDismissed(stored + 1)).toBe(false)
  })

  it('waitlistDismissed returns false for non-numeric stored value', () => {
    localStorage.setItem(WAITLIST_DISMISSED_KEY, 'garbage')
    expect(waitlistDismissed()).toBe(false)
  })

  it('waitlistSubmitted round-trips', () => {
    expect(waitlistSubmitted()).toBe(false)
    markWaitlistSubmitted()
    expect(waitlistSubmitted()).toBe(true)
    expect(localStorage.getItem(WAITLIST_SUBMITTED_KEY)).toBe('1')
  })
})
