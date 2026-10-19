import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openItemDetail } from '../openItem'
import { useEngagementStore } from '@/stores/useEngagementStore'
import { useMapStore } from '@/stores/useMapStore'
import { trackGoal } from '@/utils/analytics'

// Contract of the shared open-item sequence (#652): every surface gets all
// three steps by construction, and a `passive` open (the `?item=` deep link
// applied on page load) still selects + counts but is bot-guarded and is
// never event intent (#642). The counter side of `trackGoal` is covered in
// analytics.test.ts; here it's mocked so the calls themselves are visible.
vi.mock('@/utils/analytics', () => ({ trackGoal: vi.fn() }))

const trackGoalMock = vi.mocked(trackGoal)

const place = { id: 'pg-1', type: 'place', category: 'playground' } as const
const event = { id: 'ev-1', type: 'event', category: 'event' } as const

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

beforeEach(() => {
  trackGoalMock.mockReset()
  useEngagementStore.setState({ openedItemIds: new Set(), eventIntents: 0 })
  useMapStore.setState({ selectedId: null })
})
afterEach(() => {
  // Drop the instance override so the prototype getter is back in charge.
  Reflect.deleteProperty(navigator, 'userAgent')
})

describe('openItemDetail', () => {
  it('interactive open: logs popup_open with the id, bumps intent for a gated event, selects', () => {
    openItemDetail(event)
    expect(trackGoalMock).toHaveBeenCalledWith('popup_open', 'ev-1')
    expect(useEngagementStore.getState().eventIntents).toBe(1)
    expect(useMapStore.getState().selectedId).toBe('ev-1')
  })

  it('interactive open of a place is not event intent', () => {
    openItemDetail(place)
    expect(trackGoalMock).toHaveBeenCalledWith('popup_open', 'pg-1')
    expect(useEngagementStore.getState().eventIntents).toBe(0)
    expect(useMapStore.getState().selectedId).toBe('pg-1')
  })

  it('passive open (deep link): still counts the popup_open and selects, never bumps event intent', () => {
    openItemDetail(event, { passive: true })
    expect(trackGoalMock).toHaveBeenCalledWith('popup_open', 'ev-1')
    expect(useEngagementStore.getState().eventIntents).toBe(0)
    expect(useMapStore.getState().selectedId).toBe('ev-1')
  })

  it('passive open under a crawler UA skips the goal but still selects', () => {
    setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
    openItemDetail(place, { passive: true })
    expect(trackGoalMock).not.toHaveBeenCalled()
    expect(useMapStore.getState().selectedId).toBe('pg-1')
  })
})
