import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openItemDetail } from '../openItem'
import { useMapStore } from '@/stores/useMapStore'
import { trackGoal } from '@/utils/analytics'

// Contract of the shared open-item sequence: every surface logs the goal and
// selects, and a `passive` open (the `?item=` deep link applied on page load)
// still selects but is bot-guarded. `trackGoal` is mocked so the calls are
// visible.
vi.mock('@/utils/analytics', () => ({ trackGoal: vi.fn() }))

const trackGoalMock = vi.mocked(trackGoal)

const place = { id: 'pg-1' }

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

beforeEach(() => {
  trackGoalMock.mockReset()
  useMapStore.setState({ selectedId: null })
})
afterEach(() => {
  // Drop the instance override so the prototype getter is back in charge.
  Reflect.deleteProperty(navigator, 'userAgent')
})

describe('openItemDetail', () => {
  it('interactive open: logs popup_open and selects', () => {
    openItemDetail(place)
    expect(trackGoalMock).toHaveBeenCalledWith('popup_open')
    expect(useMapStore.getState().selectedId).toBe('pg-1')
  })

  it('passive open (deep link): still counts the popup_open and selects', () => {
    openItemDetail(place, { passive: true })
    expect(trackGoalMock).toHaveBeenCalledWith('popup_open')
    expect(useMapStore.getState().selectedId).toBe('pg-1')
  })

  it('passive open under a crawler UA skips the goal but still selects', () => {
    setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
    openItemDetail(place, { passive: true })
    expect(trackGoalMock).not.toHaveBeenCalled()
    expect(useMapStore.getState().selectedId).toBe('pg-1')
  })
})
