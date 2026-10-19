import { describe, it, expect } from 'vitest'
import {
  nextEnumerationState,
  hashIp,
  EMPTY_ENUMERATION_STATE,
  STREAK_THRESHOLD,
  BLOCK_MINUTES,
  type EnumerationState,
} from '../src/utils/enumerationGuard'

const NOW = new Date('2026-08-22T12:00:00Z')

describe('nextEnumerationState', () => {
  it('first fetch from an IP starts a streak of 1 with no direction and never blocks', () => {
    const { next, blockedUntil } = nextEnumerationState(EMPTY_ENUMERATION_STATE, 'item-5', NOW)
    expect(next).toEqual({ lastId: 'item-5', streak: 1, direction: null })
    expect(blockedUntil).toBeNull()
  })

  it('an ascending id continues an ascending streak', () => {
    const prev: EnumerationState = { lastId: 'item-5', streak: 3, direction: 'asc' }
    const { next } = nextEnumerationState(prev, 'item-9', NOW)
    expect(next).toEqual({ lastId: 'item-9', streak: 4, direction: 'asc' })
  })

  it('a descending id continues a descending streak', () => {
    const prev: EnumerationState = { lastId: 'item-9', streak: 3, direction: 'desc' }
    const { next } = nextEnumerationState(prev, 'item-5', NOW)
    expect(next).toEqual({ lastId: 'item-5', streak: 4, direction: 'desc' })
  })

  it('a direction reversal resets the streak to 1 instead of blocking', () => {
    const prev: EnumerationState = { lastId: 'item-9', streak: 8, direction: 'asc' }
    const { next, blockedUntil } = nextEnumerationState(prev, 'item-3', NOW)
    expect(next).toEqual({ lastId: 'item-3', streak: 1, direction: 'desc' })
    expect(blockedUntil).toBeNull()
  })

  it('random click order (no sustained direction) never accumulates a long streak', () => {
    // Simulates an organic session: tap pins in map order, not id order.
    const ids = ['item-c', 'item-a', 'item-f', 'item-b', 'item-e', 'item-a', 'item-d']
    let state = EMPTY_ENUMERATION_STATE
    for (const id of ids) {
      const verdict = nextEnumerationState(state, id, NOW)
      expect(verdict.blockedUntil).toBeNull()
      state = verdict.next
    }
    expect(state.streak).toBeLessThan(STREAK_THRESHOLD)
  })

  it('refetching the same id (SPA remount) does not touch the streak', () => {
    const prev: EnumerationState = { lastId: 'item-5', streak: 6, direction: 'asc' }
    const { next, blockedUntil } = nextEnumerationState(prev, 'item-5', NOW)
    expect(next).toEqual(prev)
    expect(blockedUntil).toBeNull()
  })

  it('trips the block once the streak reaches STREAK_THRESHOLD, with a BLOCK_MINUTES cooldown', () => {
    let state: EnumerationState = EMPTY_ENUMERATION_STATE
    let blockedUntil: Date | null = null
    // Walk ids in strict lexicographic order — the exact pattern a scraper
    // replaying a sorted/harvested id list would produce.
    const ids = Array.from({ length: STREAK_THRESHOLD + 2 }, (_, i) => `item-${String(i).padStart(4, '0')}`)
    for (const id of ids) {
      const verdict = nextEnumerationState(state, id, NOW)
      state = verdict.next
      if (verdict.blockedUntil) blockedUntil = verdict.blockedUntil
    }
    expect(state.streak).toBeGreaterThanOrEqual(STREAK_THRESHOLD)
    expect(blockedUntil).not.toBeNull()
    expect(blockedUntil!.getTime() - NOW.getTime()).toBe(BLOCK_MINUTES * 60_000)
  })

  it('blockedUntil is only set on the exact request that crosses the threshold', () => {
    const prev: EnumerationState = { lastId: 'item-0013', streak: STREAK_THRESHOLD - 1, direction: 'asc' }
    const tripped = nextEnumerationState(prev, 'item-0014', NOW)
    expect(tripped.blockedUntil).not.toBeNull()

    // The request right before it must not have blocked.
    const untripped = nextEnumerationState(
      { lastId: 'item-0012', streak: STREAK_THRESHOLD - 2, direction: 'asc' },
      'item-0013',
      NOW,
    )
    expect(untripped.blockedUntil).toBeNull()
  })
})

describe('hashIp', () => {
  it('is deterministic for the same input', async () => {
    const a = await hashIp('203.0.113.4')
    const b = await hashIp('203.0.113.4')
    expect(a).toBe(b)
  })

  it('differs across inputs and looks like a hex SHA-256 digest', async () => {
    const a = await hashIp('203.0.113.4')
    const b = await hashIp('203.0.113.5')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
