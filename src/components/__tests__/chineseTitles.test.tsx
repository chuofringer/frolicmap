import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ListItem } from '@shared/types'
import { i18next, loadLocale } from '@/i18n'
import { useMapStore } from '@/stores/useMapStore'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useAuthStore } from '@/stores/useAuthStore'

/**
 * Chinese item titles, end to end through the components (#692).
 *
 * `displayTitle`'s own unit tests cover the rules; these cover the wiring —
 * that the surfaces actually call it, and that the English name survives where
 * it's supposed to. The split matters because the failure mode is silent: a
 * component still renders `item.name` and simply never shows a translation.
 */
const mk = (over: Partial<ListItem> & Pick<ListItem, 'id' | 'name' | 'category' | 'lat' | 'lng'>): ListItem => ({
  type: 'place', age_min: null, age_max: null, cost: 'free', indoor: 0,
  start_time: null, end_time: null, rrule: null, exdates: null,
  status: 'approved', in_season_now: null, city: null, has_playground: null, name_zh: null, ...over,
})

const GGP = mk({
  id: 'ggp', name: 'Golden Gate Park', name_zh: '金门公园', category: 'park', lat: 0, lng: 0,
})
const UNTRANSLATED = mk({
  id: 'bounce', name: 'Bounce Zone', category: 'playground', lat: 1, lng: 1,
})

vi.mock('@/hooks/useItems', () => ({ useItems: () => ({ data: { items: [GGP, UNTRANSLATED] } }) }))
vi.mock('@/hooks/useDistanceOrigin', () => ({
  useDistanceOrigin: () => [0, 0] as [number, number],
  useDistanceOriginInfo: () => ({ origin: [0, 0] as [number, number], source: 'map' as const }),
}))
vi.mock('@/hooks/useGeocode', () => ({ useGeocodeQuery: () => ({ data: [] }) }))
vi.mock('@/utils/analytics', () => ({
  trackGoal: vi.fn(), trackOutboundClick: vi.fn(), trackRecView: vi.fn(),
}))

import { ListPanel } from '@/components/List/ListPanel'
import { SearchFilterBar } from '@/components/Bar/SearchFilterBar'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const renderBar = () =>
  render(<SearchFilterBar />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/zh']}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  })

beforeEach(() => {
  useFiltersStore.getState().reset()
  useMapStore.setState({ viewMode: 'list', selectedId: null, overlay: null })
  useAuthStore.setState({ credential: null, email: null, signedIn: false })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
})

afterEach(async () => {
  cleanup()
  await i18next.changeLanguage('en')
})

describe('list cards', () => {
  it('show the English name only, in English', () => {
    render(<ListPanel />)
    expect(screen.getByText('Golden Gate Park')).toBeInTheDocument()
    expect(screen.queryByText('金门公园')).toBeNull()
  })

  it('lead with the Chinese title and keep English underneath', async () => {
    await loadLocale('zh')
    render(<ListPanel />)
    expect(screen.getByText('金门公园')).toBeInTheDocument()
    expect(screen.getByText('Golden Gate Park')).toBeInTheDocument()
  })

  it('leave an untranslated row on its English name, with no second line', async () => {
    await loadLocale('zh')
    render(<ListPanel />)
    // One node, not a title + an identical subtitle echoed under it.
    expect(screen.getAllByText('Bounce Zone')).toHaveLength(1)
  })
})

describe('search suggestions', () => {
  const type = (q: string) => {
    fireEvent.change(screen.getByPlaceholderText(/Search|搜索/), { target: { value: q } })
  }

  it('pair both names on one line, since the row can match on either', async () => {
    await loadLocale('zh')
    useMapStore.setState({ viewMode: 'map' })
    renderBar()
    type('金门')
    expect(screen.getByRole('option', { name: /金门公园 \(Golden Gate Park\)/ })).toBeInTheDocument()
  })

  // The reason `titleHaystack` is locale-independent: a Chinese reader may well
  // type the English name off the building's sign.
  it('still match the English name while reading Chinese', async () => {
    await loadLocale('zh')
    useMapStore.setState({ viewMode: 'map' })
    renderBar()
    type('golden gate')
    expect(screen.getByRole('option', { name: /金门公园/ })).toBeInTheDocument()
  })

  it('match the Chinese title while reading English', () => {
    useMapStore.setState({ viewMode: 'map' })
    renderBar()
    type('金门')
    expect(screen.getByRole('option', { name: /Golden Gate Park/ })).toBeInTheDocument()
  })
})
