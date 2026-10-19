import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import type { ListItem } from '@shared/types'
import { useMapStore } from '@/stores/useMapStore'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { usePicksWindowStore } from '@/stores/usePicksWindowStore'
import { restOfWeekend } from '@/utils/picksWindow'

const mk = (over: Partial<ListItem> & Pick<ListItem, 'id' | 'name' | 'category' | 'lat' | 'lng'>): ListItem => ({
  type: 'place', age_min: null, age_max: null, cost: 'free', indoor: 0,
  start_time: null, end_time: null, rrule: null, exdates: null,
  status: 'approved', in_season_now: null, city: null, has_playground: null, name_zh: null, ...over,
})

// Origin is [0,0]; distances grow with |lng|,|lat|.
const ALPHA = mk({ id: 'a', name: 'Alpha', category: 'park', lng: 0, lat: 0 })          // dist 0
const BRAVO = mk({ id: 'b', name: 'Bravo', category: 'playground', lng: 2, lat: 2 })    // dist ~195
const CHARLIE = mk({ id: 'c', name: 'Charlie', category: 'library', lng: 1, lat: 1 })   // dist ~97
const ITEMS = [ALPHA, BRAVO, CHARLIE]

// A large distance-sorted fixture (200 rows) to exercise the 150-card cap.
// Distance grows with lat, so id `big-0` is nearest and `big-199` is farthest.
const BIG_ITEMS: ListItem[] = Array.from({ length: 200 }, (_, i) =>
  mk({ id: `big-${i}`, name: `Big ${i}`, category: 'park', lng: 0, lat: i * 0.01 }),
)

// Swappable dataset so a single mocked useItems can serve both the small and the
// large fixture (mutate `dataset` before render).
let dataset: ListItem[] = ITEMS

vi.mock('@/hooks/useItems', () => ({ useItems: () => ({ data: { items: dataset } }) }))
vi.mock('@/hooks/useDistanceOrigin', () => ({
  useDistanceOrigin: () => [0, 0] as [number, number],
  useDistanceOriginInfo: () => ({ origin: [0, 0] as [number, number], source: 'map' as const }),
}))
vi.mock('@/hooks/useMetro', () => ({
  useMetro: () => ({ timezone: 'America/Los_Angeles' }),
}))
const trackGoal = vi.fn()
vi.mock('@/utils/analytics', () => ({
  trackGoal: (n: string, c?: string) => trackGoal(n, c),
  trackOutboundClick: vi.fn(),
  trackRecView: vi.fn(),
}))

import { ListPanel } from '../ListPanel'

const order = () => Array.from(document.querySelectorAll('[data-item-id]')).map((el) => el.getAttribute('data-item-id'))

beforeEach(() => {
  trackGoal.mockClear()
  dataset = ITEMS
  useFiltersStore.getState().reset()
  // jsdom has no matchMedia → useIsDesktop() is false, i.e. these render as mobile.
  useMapStore.setState({ viewMode: 'list', selectedId: null })
  usePicksWindowStore.setState({ policy: restOfWeekend() })
})
afterEach(() => cleanup())

describe('ListPanel', () => {
  it('renders nothing in map view', () => {
    useMapStore.setState({ viewMode: 'map' })
    const { container } = render(<ListPanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a header count and sorts by distance (only)', () => {
    render(<ListPanel />)
    expect(screen.getByText('3 places near you')).toBeInTheDocument()
    expect(screen.getByText('Sorted by distance')).toBeInTheDocument()
    // No sort menu anymore.
    expect(screen.queryByRole('menuitemradio')).toBeNull()
    expect(order()).toEqual(['a', 'c', 'b']) // Alpha(0) · Charlie(~97) · Bravo(~195)
  })

  it('shows the empty state when no rows match the filters', () => {
    useFiltersStore.getState().setCategories(new Set(['aquarium']))
    render(<ListPanel />)
    expect(screen.getByText('0 places near you')).toBeInTheDocument()
    expect(screen.getByText('No places match your filters.')).toBeInTheDocument()
  })

  it('card click selects the item and fires the popup_open goal (waitlist arming)', () => {
    render(<ListPanel />)
    const alpha = document.querySelector('[data-item-id="a"]') as HTMLElement
    fireEvent.click(within(alpha!).getByText('Alpha'))
    expect(useMapStore.getState().selectedId).toBe('a')
    expect(trackGoal).toHaveBeenCalledWith('popup_open', 'a')
  })

  it('hides the list on mobile while a selection is open (map + sheet take over)', () => {
    useMapStore.setState({ viewMode: 'list', selectedId: 'a' })
    const { container } = render(<ListPanel />)
    // CSS-hidden, NOT unmounted: unmounting reset scrollTop to 0, so closing
    // the sheet dropped the user back at the top of the list every time.
    const panel = container.firstElementChild as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.className).toContain('invisible')
    expect(panel.className).toContain('pointer-events-none')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
  })

  it('list panel is visible (not CSS-hidden) with no selection open', () => {
    useMapStore.setState({ viewMode: 'list', selectedId: null })
    const { container } = render(<ListPanel />)
    const panel = container.firstElementChild as HTMLElement
    expect(panel.className).not.toContain('invisible')
    expect(panel).not.toHaveAttribute('aria-hidden')
  })

  it('swiping the grabber down past the threshold returns to map view', () => {
    render(<ListPanel />)
    const grabber = screen.getByRole('separator', { name: /Drag down to return to map/ })
    fireEvent.pointerDown(grabber, { clientY: 100 })
    fireEvent.pointerMove(grabber, { clientY: 260 })
    fireEvent.pointerUp(grabber, { clientY: 260 })
    expect(useMapStore.getState().viewMode).toBe('map')
  })

  describe('mobile Filters entry point (#483)', () => {
    it('opens the drawer via the overlay coordinator, with a count badge', () => {
      useFiltersStore.getState().setFreeOnly(true)
      render(<ListPanel />)
      // FiltersButton's accessible name is its aria-label ("All filters"),
      // same as the mobile bottom bar's Filters button (its visible label is
      // the shorter "Filters").
      const filtersBtn = screen.getByRole('button', { name: 'All filters' })
      expect(filtersBtn).toHaveTextContent('1')
      fireEvent.click(filtersBtn)
      expect(useMapStore.getState().overlay).toBe('filters')
    })

    it('is CSS-hidden on desktop (md:hidden), same as the ViewToggle beside it — the top bar owns Filters there', () => {
      render(<ListPanel />)
      // FiltersButton's accessible name is its aria-label ("All filters"),
      // same as the mobile bottom bar's Filters button (its visible label is
      // the shorter "Filters").
      const filtersBtn = screen.getByRole('button', { name: 'All filters' })
      expect(filtersBtn.closest('.md\\:hidden')).not.toBeNull()
    })
  })

  it('caps the rendered cards at 150 while the header keeps the total', () => {
    dataset = BIG_ITEMS
    render(<ListPanel />)
    expect(screen.getByText('200 places near you')).toBeInTheDocument() // TOTAL, not the cap
    expect(order()).toHaveLength(150)
    // The nearest are rendered, the farthest are dropped.
    expect(document.querySelector('[data-item-id="big-0"]')).toBeTruthy()
    expect(document.querySelector('[data-item-id="big-149"]')).toBeTruthy()
    expect(document.querySelector('[data-item-id="big-150"]')).toBeNull()
    expect(document.querySelector('[data-item-id="big-199"]')).toBeNull()
  })

  it('shows the "nearest 150 of N" footer only when over the cap', () => {
    render(<ListPanel />) // 3 rows → under the cap
    expect(screen.queryByText(/Showing the nearest/)).toBeNull()
    cleanup()
    dataset = BIG_ITEMS
    render(<ListPanel />)
    expect(screen.getByText('Showing the nearest 150 of 200 — zoom in or filter to narrow')).toBeInTheDocument()
  })

  it('a map selection outside the rendered cap does not scroll or crash', () => {
    // Desktop: the panel stays mounted alongside a selection (mobile hides it),
    // so the scroll-to-selected effect actually runs for this case.
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    dataset = BIG_ITEMS
    // big-199 is the farthest → beyond the 150-card cap, so its card never mounts.
    useMapStore.setState({ viewMode: 'list', selectedId: 'big-199' })
    expect(() => render(<ListPanel />)).not.toThrow()
    const scroller = document.querySelector('.overflow-y-auto') as HTMLElement
    expect(document.querySelector('[data-item-id="big-199"]')).toBeNull()
    expect(scroller.scrollTop).toBe(0) // untouched — the guard made it a no-op
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('reopens fully after swipe-dismiss → map → list (no leftover transform, bug #5)', () => {
    render(<ListPanel />)
    const grabber = screen.getByRole('separator', { name: /Drag down to return to map/ })
    fireEvent.pointerDown(grabber, { clientY: 100 })
    fireEvent.pointerMove(grabber, { clientY: 300 })
    fireEvent.pointerUp(grabber, { clientY: 300 })
    expect(useMapStore.getState().viewMode).toBe('map')

    // Toggle back to list — the panel must render at its rest position, not
    // shoved down by the leftover drag offset.
    act(() => useMapStore.getState().setViewMode('list'))
    const panel = screen.getByText('3 places near you').closest('div[style]') as HTMLElement
    expect(panel).toBeTruthy()
    expect(panel.style.transform).toBe('')
  })

  describe('city + distance origin', () => {
    it('puts the city between the category and the distance when the row has one', () => {
      dataset = [mk({ id: 'w', name: 'Washington Park', category: 'park', lng: 0, lat: 0, city: 'Alameda' })]
      render(<ListPanel />)
      expect(screen.getByText('Park · Alameda · 0.0 mi')).toBeInTheDocument()
    })

    it('omits the city segment (no empty separator) when the row has none', () => {
      render(<ListPanel />) // ALPHA has no city
      expect(screen.getByText('Park · 0.0 mi')).toBeInTheDocument()
    })

    it('treats a blank city as no city', () => {
      dataset = [mk({ id: 'w', name: 'Washington Park', category: 'park', lng: 0, lat: 0, city: '   ' })]
      render(<ListPanel />)
      expect(screen.getByText('Park · 0.0 mi')).toBeInTheDocument()
    })

    it('names the point the distances are measured from', () => {
      render(<ListPanel />)
      // Mocked origin source is 'map' — the default when Near-me is off.
      expect(screen.getByText(/Distances from the map center/)).toBeInTheDocument()
    })

  })

  // #647: a guest's gated event rows collapse into ONE summary card — no more
  // wall of identical blurred "sign in to unlock" rows, and no event name in
  // the DOM at all for guests.
  describe('events sign-in gate — locked-rows collapse (#647)', () => {
    // Future-dated: eventStillRelevant (#647) hides past/dateless events.
    const EVENT = mk({ id: 'ev', name: 'Toddler Storytime', category: 'event', lng: 0, lat: 0, type: 'event', start_time: '2099-07-04T10:00:00-07:00' })
    const EVENT2 = mk({ id: 'ev2', name: 'Puppet Show', category: 'event', lng: 0, lat: 0, type: 'event', start_time: '2099-07-05T10:00:00-07:00' })

    it('collapses all gated rows into one summary card for guests — names never render', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      useAuthStore.setState({ credential: null, email: null, signedIn: false })
      dataset = [EVENT, EVENT2, ALPHA]
      render(<ListPanel />)
      expect(screen.queryByText('Toddler Storytime')).toBeNull()
      expect(screen.queryByText('Puppet Show')).toBeNull()
      const summary = screen.getByText('2 events nearby — sign in to see this weekend')
      expect(summary).toBeInTheDocument()
      // Place cards render normally alongside.
      const alpha = screen.getByText('Alpha')
      expect(alpha).toBeInTheDocument()
      // Pinned to the TOP of the list for exposure (operator call 2026-08-26),
      // ahead of every place card regardless of distance order.
      const buttons = Array.from(document.querySelectorAll('button'))
      expect(buttons.indexOf(summary.closest('button')!)).toBeLessThan(buttons.indexOf(alpha.closest('button')!))
    })

    it('summary tap opens the sign-in gate and counts as event intent (#642)', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      const { useGateRequestStore } = await import('@/stores/useGateRequestStore')
      const { useEngagementStore } = await import('@/stores/useEngagementStore')
      useAuthStore.setState({ credential: null, email: null, signedIn: false })
      useGateRequestStore.setState({ requested: false })
      useEngagementStore.setState({ eventIntents: 0 })
      dataset = [EVENT]
      render(<ListPanel />)
      fireEvent.click(screen.getByText(/sign in to see this weekend/))
      expect(useGateRequestStore.getState().requested).toBe(true)
      expect(useEngagementStore.getState().eventIntents).toBe(1)
    })

    it('a VENUE row in the event category (type=place, dateless) collapses too — the old blur leak surface', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      useAuthStore.setState({ credential: null, email: null, signedIn: false })
      dataset = [mk({ id: 'venue-ev', name: 'San Mateo County Event Center', category: 'event', lng: 0, lat: 0, type: 'place' })]
      render(<ListPanel />)
      expect(screen.queryByText('San Mateo County Event Center')).toBeNull()
      expect(screen.getByText(/1 events nearby/)).toBeInTheDocument()
    })

    it('renders event cards normally for signed-in members — no summary', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      useAuthStore.setState({ credential: 'cred.x', email: 'p@e.com', signedIn: true })
      dataset = [EVENT]
      render(<ListPanel />)
      expect(screen.getByText('Toddler Storytime')).toBeInTheDocument()
      expect(screen.queryByText(/sign in to see this weekend/)).toBeNull()
      useAuthStore.setState({ credential: null, email: null, signedIn: false })
    })
  })

  // #655: the signed-in "Top picks" rail sits above the distance-sorted
  // list. Real integration through ListPanel (see WeekendPicksRail.test.tsx
  // for the component's own unit coverage).
  describe('"Top picks" rail (#655)', () => {
    // Wed local wall-clock -> the upcoming weekend is Fri 08-14 17:00 through
    // Mon 08-17 00:00. A naive (no-offset) start_time is used so the window
    // math is self-consistent regardless of the test machine's real timezone.
    const NOW = new Date(2026, 7, 12, 9, 0, 0)

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })
    afterEach(() => vi.useRealTimers())

    it('does not render when no dataset item falls in the upcoming weekend', () => {
      render(<ListPanel />) // ALPHA/BRAVO/CHARLIE carry no dates
      expect(screen.queryByText('Top picks')).toBeNull()
    })

    it('renders atop the list, above the distance-sorted cards, when a one-off event qualifies', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      useAuthStore.setState({ credential: 'cred', email: 'parent@example.com', signedIn: true })
      const fair = mk({ id: 'fair', name: 'Neighborhood Fair', category: 'event', lng: 0, lat: 0, type: 'event', start_time: '2026-08-15T10:00:00', cost: 'free' })
      const fair2 = mk({ id: 'fair2', name: 'Park Fair', category: 'event', lng: 0.01, lat: 0, type: 'event', start_time: '2026-08-15T11:00:00' })
      const fair3 = mk({ id: 'fair3', name: 'Lawn Fair', category: 'event', lng: 0.02, lat: 0, type: 'event', start_time: '2026-08-15T12:00:00' })
      dataset = [...ITEMS, fair, fair2, fair3]
      render(<ListPanel />)
      expect(screen.getByText('Top picks')).toBeInTheDocument()
      // The rail card is a distinct element (own data attribute) from the
      // list's own card for the same item; it sits in a strip above the
      // scrollable rows, so it precedes every list card in document order —
      // works whether or not the event happens to be gated for this guest.
      const railCard = document.querySelector('[data-pick-id="fair"]') as HTMLElement
      const alphaCard = document.querySelector('[data-item-id="a"]') as HTMLElement
      expect(railCard).toBeTruthy()
      expect(alphaCard).toBeTruthy()
      expect(railCard.compareDocumentPosition(alphaCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })
})
