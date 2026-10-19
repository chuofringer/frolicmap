import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { useUrlItem } from '../useUrlItem'
import { useMapStore } from '@/stores/useMapStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useEngagementStore } from '@/stores/useEngagementStore'

// Mock useItemCoords — we control exactly when the `/api/items/:id/coords`
// fetch settles so we can reproduce the race from #543 deterministically.
// `useUrlItem` mounts once for the app's lifetime (`App.tsx`); every harness
// below starts with a pending (`data: undefined, isError: false`) query and
// only introduces a result via a later `rerender()`, matching how a real
// TanStack Query fetch resolves on a subsequent render.
vi.mock('@/hooks/useItemCoords', () => ({
  useItemCoords: vi.fn(),
}))

import { useItemCoords } from '@/hooks/useItemCoords'

const mockUseItemCoords = vi.mocked(useItemCoords)

function pending() {
  return { data: undefined, isError: false } as unknown as ReturnType<typeof useItemCoords>
}
function resolved(lat: number, lng: number) {
  return { data: { lat, lng }, isError: false } as unknown as ReturnType<typeof useItemCoords>
}
function failed() {
  return { data: undefined, isError: true } as unknown as ReturnType<typeof useItemCoords>
}

function harness(path: string, { strict = false } = {}) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const router = <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    return strict ? <StrictMode>{router}</StrictMode> : router
  }
  return renderHook(
    () => {
      useUrlItem()
      const [params] = useSearchParams()
      return params
    },
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  useMapStore.setState({ selectedId: null, flyTo: null })
  useSessionStore.setState({ token: null })
  useEngagementStore.setState({ openedItemIds: new Set(), filterToggles: 0, eventIntents: 0 })
  mockUseItemCoords.mockReset()
  mockUseItemCoords.mockReturnValue(pending())
})

describe('useUrlItem', () => {
  it('leaves ?item=<id> untouched while the coords fetch is still in flight', () => {
    const { result } = harness('/?item=abc')
    expect(useMapStore.getState().selectedId).toBeNull()
    // The deep link must survive — this is what the state→URL effect must
    // not wipe before the URL→state effect gets a chance to read it.
    expect(result.current.get('item')).toBe('abc')
  })

  it('applies ?item=<id> once its coords resolve', () => {
    const { result, rerender } = harness('/?item=abc')
    expect(result.current.get('item')).toBe('abc')

    mockUseItemCoords.mockReturnValue(resolved(37.9, -121.7))
    rerender()

    expect(useMapStore.getState().selectedId).toBe('abc')
    expect(useEngagementStore.getState().openedItemIds).toEqual(new Set(['abc']))
    expect(useMapStore.getState().flyTo).toEqual({ longitude: -121.7, latitude: 37.9, zoom: 14 })
    expect(result.current.get('item')).toBe('abc')
  })

  it('treats a deep link to a gated event as a passive open — no event intent (#642)', () => {
    // Arriving on a shared event link is not a tap: it must count as a
    // popup_open (funnel denominator) but never arm the sign-in nudge, or a
    // guest would get the unlock card and then the nudge after zero taps.
    // The coords endpoint returns no category/type at all — irrelevant here,
    // since a passive open skips the gated-event check regardless.
    const { rerender } = harness('/?item=ev-1')
    mockUseItemCoords.mockReturnValue(resolved(37.9, -121.7))
    rerender()

    expect(useMapStore.getState().selectedId).toBe('ev-1')
    expect(useEngagementStore.getState().openedItemIds).toEqual(new Set(['ev-1']))
    expect(useEngagementStore.getState().eventIntents).toBe(0)
  })

  // Regression test for #543: React StrictMode double-invokes effects on
  // mount (dev-only). The old `hasSynced` ref-based first-run guard
  // survived that remount, so the *second* invocation of the state→URL
  // effect no longer counted as "first run" and deleted `?item=` while
  // `selectedId` was still null and no session token had arrived yet.
  it('survives a StrictMode double-mount while the coords fetch is still in flight (#543)', () => {
    const { result } = harness('/?item=abc', { strict: true })
    expect(useMapStore.getState().selectedId).toBeNull()
    expect(result.current.get('item')).toBe('abc')
  })

  it('applies the deep link after a StrictMode double-mount once coords resolve (#543)', () => {
    const { result, rerender } = harness('/?item=abc', { strict: true })
    expect(result.current.get('item')).toBe('abc')

    mockUseItemCoords.mockReturnValue(resolved(37.9, -121.7))
    rerender()

    expect(useMapStore.getState().selectedId).toBe('abc')
    expect(useEngagementStore.getState().openedItemIds).toEqual(new Set(['abc']))
    expect(useMapStore.getState().flyTo).toEqual({ longitude: -121.7, latitude: 37.9, zoom: 14 })
    expect(result.current.get('item')).toBe('abc')
  })

  it('drops a stale ?item=<id> whose coords fetch 404s', () => {
    const { result, rerender } = harness('/?item=nonexistent')
    mockUseItemCoords.mockReturnValue(failed())
    rerender()
    expect(useMapStore.getState().selectedId).toBeNull()
    expect(result.current.get('item')).toBeNull()
  })

  it('writes selectedId to the URL when set after a session token has arrived', () => {
    const { result, rerender } = harness('/')
    useSessionStore.setState({ token: 'tok' })
    rerender()
    expect(result.current.get('item')).toBeNull()

    act(() => useMapStore.getState().setSelectedId('abc'))
    rerender()
    expect(result.current.get('item')).toBe('abc')
  })

  // Regression test for #587: pins select from vector tiles, not a
  // pre-loaded catalog, so a click can set `selectedId` before a session
  // token arrives. The state→URL effect can't write `?item=` yet (gated on
  // `token`), and the old URL→state effect then treated the still-empty
  // `?item=` as "user has no selection" once the token arrived, silently
  // clearing it.
  it('keeps a selection made before the session token arrives, and backfills the URL once it does (#587)', () => {
    const { result, rerender } = harness('/')
    expect(result.current.get('item')).toBeNull()

    // Simulate a vector-tile pin click racing the session token — selectedId
    // is set directly on the store, the way FunMap.tsx does it, with no
    // token yet.
    act(() => useMapStore.getState().setSelectedId('abc'))
    rerender()
    expect(useMapStore.getState().selectedId).toBe('abc')
    expect(result.current.get('item')).toBeNull()

    useSessionStore.setState({ token: 'tok' })
    rerender()

    expect(useMapStore.getState().selectedId).toBe('abc')
    expect(result.current.get('item')).toBe('abc')
  })
})
