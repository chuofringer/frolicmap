import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WELCOME_KEY, welcomeSeen, dismissWelcome, isLikelyBot } from '../bot'

describe('welcome storage helpers', () => {
  beforeEach(() => {
    localStorage.removeItem(WELCOME_KEY)
  })

  it('welcomeSeen is false when key absent', () => {
    expect(welcomeSeen()).toBe(false)
  })

  it('dismissWelcome round-trips under the frolicmap key', () => {
    dismissWelcome()
    expect(welcomeSeen()).toBe(true)
    expect(localStorage.getItem(WELCOME_KEY)).toBe('1')
    expect(WELCOME_KEY.startsWith('frolicmap')).toBe(true)
  })
})

describe('isLikelyBot', () => {
  afterEach(() => vi.restoreAllMocks())

  it('flags crawler user agents', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (compatible; Googlebot/2.1)')
    expect(isLikelyBot()).toBe(true)
  })

  it('does not flag a normal browser', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    expect(isLikelyBot()).toBe(false)
  })
})
