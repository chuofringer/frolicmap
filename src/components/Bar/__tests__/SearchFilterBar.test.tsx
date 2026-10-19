import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ListItem } from '@shared/types'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useMapStore } from '@/stores/useMapStore'

// Fixed items catalog for the search-suggestion tests (chip tests don't read
// item data). Geocode is stubbed empty so no debounce/network is in play.
const mkItem = (over: Partial<ListItem> & Pick<ListItem, 'id' | 'name' | 'category' | 'lat' | 'lng'>): ListItem => ({
  type: 'place', age_min: null, age_max: null, cost: 'free', indoor: 0,
  status: 'approved', city: null, has_playground: null, name_zh: null, ...over,
})
vi.mock('@/hooks/useItems', () => ({
  useItems: () => ({
    data: {
      items: [
        mkItem({ id: 'lib-2', name: 'First Branch Library', category: 'library', lat: 37.5, lng: -122.3, cost: 'free', indoor: 1 }),
        mkItem({ id: 'pg-1', name: 'First Street Park', category: 'park', lat: 37.5, lng: -122.3 }),
        // Issue #212 fixtures: no "trampoline"/"storytime"/etc. in the name —
        // these only surface via the Activities (category/synonym) match.
        mkItem({ id: 'pg-2', name: 'Bounce Zone', category: 'playground', lat: 37.5, lng: -122.3 }),
        mkItem({ id: 'lib-1', name: 'Downtown Branch', category: 'library', lat: 37.5, lng: -122.3, cost: 'free', indoor: 1 }),
      ],
    },
  }),
}))
// Mutable so the keyboard-navigation tests can opt into geocode results
// without a per-test debounce/network round trip; reset in beforeEach below.
const geoResults = vi.hoisted(() => ({ current: [] as { lat: number; lng: number; label: string }[] }))
vi.mock('@/hooks/useGeocode', () => ({ useGeocodeQuery: () => ({ data: geoResults.current }) }))

import { SearchFilterBar } from '../SearchFilterBar'

// jsdom lacks matchMedia; stub it to a fixed match value so useIsDesktop /
// useMediaQuery resolve — true = desktop layout (with the chip row), false =
// the mobile bottom control bar.
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

// Per-query stub for the desktop width tiers: desktop (768px) matches but the
// pill-fit queries don't — the compact stacked layout territory.
function stubMatchMediaPerQuery(matcher: (query: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: matcher(query), addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const renderAt = (path: string) =>
  render(<SearchFilterBar />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  })

const categories = () => [...useFiltersStore.getState().categories]

beforeEach(() => {
  useFiltersStore.getState().reset()
  useMapStore.setState({ selectedId: null, viewMode: 'map', overlay: null })
  geoResults.current = []
})
afterEach(() => cleanup())

describe('SearchField combobox keyboard navigation (#482)', () => {
  beforeEach(() => stubMatchMedia(true))

  const type = (q: string) => {
    const input = screen.getByPlaceholderText(/Search playgrounds/)
    fireEvent.change(input, { target: { value: q } })
    return input
  }

  it('exposes combobox/listbox roles and tracks aria-activedescendant as the active option', () => {
    renderAt('/')
    const input = type('first')
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).not.toHaveAttribute('aria-activedescendant')

    const listbox = screen.getByRole('listbox')
    const first = screen.getByRole('option', { name: /First Branch Library/ })
    expect(listbox).toContainElement(first)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', first.id)
    expect(first).toHaveAttribute('aria-selected', 'true')
  })

  it('moves aria-activedescendant across both item and geocode results as one flat list, wrapping at the ends', () => {
    geoResults.current = [{ lat: 37.6, lng: -122.4, label: '123 Main St' }]
    renderAt('/')
    const input = type('first')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('First Branch Library'),
      expect.stringContaining('First Street Park'),
      expect.stringContaining('123 Main St'),
    ])

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[2].id)
    // Wraps back to the first option past the end.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    // Wraps to the last option going up from the first.
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveAttribute('aria-activedescendant', options[2].id)
  })

  it('first ArrowUp with no active option lands on the LAST option (APG)', () => {
    geoResults.current = [{ lat: 37.6, lng: -122.4, label: '123 Main St' }]
    renderAt('/')
    const input = type('first')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveAttribute('aria-activedescendant', options[2].id)
  })

  it('ignores arrow/Enter keydowns fired during IME composition', () => {
    renderAt('/')
    const input = type('first')
    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true })
    expect(input).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    // Composition Enter must not select — the listbox stays open.
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(useMapStore.getState().selectedId).toBeNull()
  })

  it('Enter selects the active item result', () => {
    renderAt('/')
    const input = type('first')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // → First Branch Library
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMapStore.getState().selectedId).toBe('lib-2')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Enter selects the active geocode result', () => {
    geoResults.current = [{ lat: 37.6, lng: -122.4, label: '123 Main St' }]
    renderAt('/')
    const input = type('first')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // → First Branch Library (item)
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // → First Street Park (item)
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // → 123 Main St (geocode)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMapStore.getState().searchMarker).toEqual([-122.4, 37.6])
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Escape still closes the dropdown without selecting', () => {
    renderAt('/')
    const input = type('first')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(useMapStore.getState().selectedId).toBeNull()
  })

  it('mousedown selection still works alongside keyboard navigation', () => {
    renderAt('/')
    type('first')
    fireEvent.mouseDown(screen.getByRole('option', { name: /First Street Park/ }))
    expect(useMapStore.getState().selectedId).toBe('pg-1')
  })

  it('resets the active option when the query changes', () => {
    renderAt('/')
    const input = type('first')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
    fireEvent.change(input, { target: { value: 'firstf' } })
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('ArrowDown reopens a closed-but-populated dropdown', () => {
    renderAt('/')
    const input = type('first')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
})

describe('activity keyword search (issue #212)', () => {
  beforeEach(() => stubMatchMedia(true))

  const type = (q: string) => {
    const input = screen.getByPlaceholderText(/Search playgrounds/)
    fireEvent.change(input, { target: { value: q } })
    return input
  }

  it('finds a playground row via "trampoline" even though it is not in the name', () => {
    renderAt('/')
    type('trampoline')
    expect(screen.getByRole('option', { name: /Bounce Zone/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Downtown Branch/ })).toBeNull()
  })

  it('finds library rows via "storytime"', () => {
    renderAt('/')
    type('storytime')
    expect(screen.getByRole('option', { name: /Downtown Branch/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /First Branch Library/ })).toBeInTheDocument()
  })

  it('finds playground/park rows via "climbing"', () => {
    renderAt('/')
    type('climbing')
    expect(screen.getByRole('option', { name: /Bounce Zone/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /First Street Park/ })).toBeInTheDocument()
  })

  it('"free indoor" ANDs both predicates, matching the free+indoor library row only', () => {
    renderAt('/')
    type('free indoor')
    expect(screen.getByRole('option', { name: /Downtown Branch/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Bounce Zone/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /First Street Park/ })).toBeNull()
  })

  it('groups results under Activities/Places headers and a literal name match wins the Places slot, not Activities', () => {
    renderAt('/')
    // "park" is both a literal name-substring hit ("First Street Park") and a
    // category label — it must not double-list under both groups.
    type('park')
    const options = screen.getAllByRole('option', { name: /Park/ })
    expect(options).toHaveLength(1)
    expect(screen.getByText('Places')).toBeInTheDocument()
  })

  it('keeps arrow-key navigation working across the Activities group', () => {
    renderAt('/')
    const input = type('trampoline')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Bounce Zone')])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMapStore.getState().selectedId).toBe('pg-2')
  })
})

describe('SearchFilterBar desktop chip row', () => {
  beforeEach(() => stubMatchMedia(true))

  it('shows exactly the four inline categories', () => {
    renderAt('/')
    for (const name of ['Playground', 'Park', 'Museum', 'Library']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // Other categories are no longer inline chips.
    expect(screen.queryByRole('button', { name: 'Beach' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Water Play' })).toBeNull()
  })

  it('toggles a live category via the store (toggleCategory semantics)', () => {
    renderAt('/')
    expect(categories()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Park' }))
    expect(categories()).toEqual(['park'])
    fireEvent.click(screen.getByRole('button', { name: 'Park' }))
    expect(categories()).toEqual([])
  })

  it('every category is a live filter in a wave metro too (no coming-soon chips)', () => {
    renderAt('/cities/chicago')
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(categories()).toEqual(['library'])
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(categories()).toEqual([])
    expect(screen.queryByText(/coming soon/i)).toBeNull()
  })

  it('shows the Free-only chip only when the free filter is active, and clears it on click', () => {
    renderAt('/')
    expect(screen.queryByRole('button', { name: /Free only/ })).toBeNull()
    useFiltersStore.getState().setFreeOnly(true)
    cleanup()
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: /Free only/ }))
    expect(useFiltersStore.getState().freeOnly).toBe(false)
  })

  it('opens the FiltersDrawer from All filters (via the overlay coordinator) with a count badge', () => {
    useFiltersStore.getState().setFreeOnly(true)
    useFiltersStore.getState().setIndoorOutdoor('indoor')
    renderAt('/')
    const allFilters = screen.getByRole('button', { name: 'All filters' })
    expect(allFilters).toHaveTextContent('2')
    fireEvent.click(allFilters)
    expect(useMapStore.getState().overlay).toBe('filters')
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
  })

  it('switches viewMode from the desktop toggle', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(useMapStore.getState().viewMode).toBe('list')
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(useMapStore.getState().viewMode).toBe('map')
  })
})

describe('SearchFilterBar desktop layout tiers (icon-row clearance, 2026-08-08 overlap fix)', () => {
  // Only min-width 768 (desktop) matches; both fit queries fail → stacked.
  const desktopNarrow = () => stubMatchMediaPerQuery((q) => q === '(min-width: 768px)')

  it('reserves the top-right icon row footprint in the full pill track (with and without a panel)', () => {
    stubMatchMedia(true)
    const { container } = renderAt('/')
    const track = container.querySelector('div.absolute.top-3.z-30') as HTMLElement
    expect(track.style.right).toBe('220px') // icons end 212px from the right + breathing room
    cleanup()
    useMapStore.setState({ selectedId: 'pg-1' }) // detail panel open → icon row shifts 392px left
    const { container: c2 } = renderAt('/')
    const track2 = c2.querySelector('div.absolute.top-3.z-30') as HTMLElement
    expect(track2.style.right).toBe('612px')
  })

  // The clearance and the fit breakpoint have to move together: the breakpoint
  // exists purely to say "the pill still fits between the clearances". When the
  // envelope button was retired the clearance kept its stale 5-button value, so
  // the breakpoint it had been derived from stranded 1400–1439px viewports in
  // the stacked layout with a panel open. Assert the arithmetic, not a literal.
  it('derives the with-panel fit breakpoint from the clearances actually reserved', () => {
    stubMatchMedia(true)
    const queried: string[] = []
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => {
        queried.push(query)
        return { matches: true, addEventListener: () => {}, removeEventListener: () => {} }
      },
    })
    useMapStore.setState({ selectedId: 'pg-1' })
    const { container } = renderAt('/')
    const track = container.querySelector('div.absolute.top-3.z-30') as HTMLElement
    const reserved = parseInt(track.style.left, 10) + parseInt(track.style.right, 10)
    const fit = queried.map((q) => /\(min-width: (\d+)px\)/.exec(q)).find((m) => m && +m[1] > 1000)
    // Whatever room the breakpoint leaves the pill must be at least its
    // ~541px floor (search input collapsed to ~150px) and not wildly more.
    const room = Number(fit![1]) - reserved
    expect(room).toBeGreaterThanOrEqual(541)
    expect(room).toBeLessThan(641)
  })

  it('drops to the compact stacked layout on a narrow desktop even without a panel open', () => {
    desktopNarrow()
    const { container } = renderAt('/')
    const stacked = container.querySelector('div.absolute.z-30') as HTMLElement
    expect(stacked.className).toContain('top-[116px]')
    expect(stacked.className).toContain('right-3')
    expect(screen.getByPlaceholderText(/Search playgrounds/)).toBeInTheDocument()
  })

  it('keeps the stacked layout clear of an open detail panel', () => {
    desktopNarrow()
    useMapStore.setState({ selectedId: 'pg-1' })
    const { container } = renderAt('/')
    const stacked = container.querySelector('div.absolute.z-30') as HTMLElement
    expect(stacked.className).toContain('right-[396px]')
  })
})

describe('SearchFilterBar mobile bottom bar', () => {
  beforeEach(() => stubMatchMedia(false))

  it('has no category chips (legend covers categories) but keeps Near me + Filters', () => {
    renderAt('/')
    expect(screen.queryByRole('button', { name: 'Park' })).toBeNull()
    expect(screen.getByTitle('Near me')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All filters' })).toBeInTheDocument()
  })

  it('expands the search input from the icon and collapses again', () => {
    renderAt('/')
    expect(screen.queryByPlaceholderText(/Search playgrounds/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByPlaceholderText(/Search playgrounds/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(screen.queryByPlaceholderText(/Search playgrounds/)).toBeNull()
  })

  it('hides the whole bar while the list panel owns the screen', () => {
    useMapStore.setState({ viewMode: 'list' })
    const { container } = renderAt('/')
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    expect(container.querySelector('[title="Near me"]')).toBeNull()
  })

  it('surfaces "Permission denied" from the labeled Near me button', () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1 } as GeolocationPositionError) },
    })
    renderAt('/')
    fireEvent.click(screen.getByTitle('Near me'))
    expect(screen.getByTitle('Near me')).toHaveTextContent('Permission denied')
  })
})
