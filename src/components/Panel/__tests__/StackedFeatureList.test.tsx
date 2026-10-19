import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ListItem } from '@shared/types'
import { useMapStore } from '@/stores/useMapStore'
import { useAuthStore } from '@/stores/useAuthStore'

// Stacked-pin picker + the events sign-in gate (2026-07-26 operator-found
// leak: this list showed full event names + dates to guests). Contract:
// gated rows blur name + date (aria-hidden) with a lock glyph, stay
// tappable; place rows and signed-in members see everything crisp.

vi.mock('react-map-gl/maplibre', () => ({
  Popup: ({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}))
vi.mock('@/utils/analytics', () => ({ trackGoal: vi.fn() }))

const mk = (over: Partial<ListItem> & Pick<ListItem, 'id' | 'name' | 'category' | 'lat' | 'lng'>): ListItem => ({
  type: 'place', age_min: null, age_max: null, cost: 'free', indoor: 0,
  start_time: null, end_time: null, rrule: null, exdates: null,
  status: 'approved', in_season_now: null, city: null, has_playground: null, name_zh: null, ...over,
})

const EVENT = mk({ id: 'ev-1', name: 'First Friday Nights', category: 'event', type: 'event', lat: 37.5, lng: -122.3, start_time: '2026-08-07T18:00:00-07:00' })
const VENUE_EVENT = mk({ id: 'venue-ev', name: 'County Event Center', category: 'event', type: 'place', lat: 37.5, lng: -122.3 })
const PARK = mk({ id: 'park-1', name: 'Laurel Park', category: 'park', lat: 37.5, lng: -122.3 })
let dataset: ListItem[] = []
vi.mock('@/hooks/useItems', () => ({ useItems: () => ({ data: { items: dataset } }) }))

import { StackedFeatureList } from '../StackedFeatureList'

beforeEach(() => {
  dataset = [EVENT, VENUE_EVENT, PARK]
  useAuthStore.setState({ credential: null, email: null, signedIn: false })
  useMapStore.setState({
    stackedFeatures: {
      lng: -122.3,
      lat: 37.5,
      features: [
        { id: 'ev-1', name: 'First Friday Nights', category: 'event' },
        { id: 'venue-ev', name: 'County Event Center', category: 'event' },
        { id: 'park-1', name: 'Laurel Park', category: 'park' },
      ],
    },
  })
})
afterEach(() => {
  cleanup()
  useMapStore.setState({ stackedFeatures: null })
})

describe('StackedFeatureList events gate', () => {
  it('blurs event rows (dated AND venue-in-event-category) for guests; places stay crisp', () => {
    render(<StackedFeatureList />)
    // Dated event: name + date chip blurred, lock shown.
    const evName = screen.getByText('First Friday Nights')
    expect(evName.className).toContain('blur')
    expect(evName.className).toContain('select-none')
    const evDate = screen.getByText('Aug 7')
    expect(evDate.className).toContain('blur')
    // Venue row in the event category blurs too (the type=place leak).
    expect(screen.getByText('County Event Center').className).toContain('blur')
    // Place row untouched, no lock on its row.
    expect(screen.getByText('Laurel Park').className).not.toContain('blur')
    // Gated rows stay reachable — tapping opens the detail (unlock card).
    expect(screen.getAllByRole('button', { name: 'Event — sign in to unlock' }).length).toBe(2)
  })

  it('renders everything crisp for signed-in members', () => {
    useAuthStore.setState({ credential: 'cred.x', email: 'p@e.com', signedIn: true })
    render(<StackedFeatureList />)
    expect(screen.getByText('First Friday Nights').className).not.toContain('blur')
    expect(screen.getByText('County Event Center').className).not.toContain('blur')
    expect(screen.queryByRole('button', { name: 'Event — sign in to unlock' })).toBeNull()
  })
})
