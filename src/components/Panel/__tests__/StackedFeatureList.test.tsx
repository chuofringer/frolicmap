import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ListItem } from '@shared/types'
import { useMapStore } from '@/stores/useMapStore'

// Stacked-pin picker: 2+ overlapping pins surface as a mini-list so every
// one stays reachable.

vi.mock('react-map-gl/maplibre', () => ({
  Popup: ({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}))
vi.mock('@/utils/analytics', () => ({ trackGoal: vi.fn() }))

const mk = (over: Partial<ListItem> & Pick<ListItem, 'id' | 'name' | 'category' | 'lat' | 'lng'>): ListItem => ({
  type: 'place', age_min: null, age_max: null, cost: 'free', indoor: 0,
  status: 'approved', city: null, has_playground: null, name_zh: null, ...over,
})

const PARK = mk({ id: 'park-1', name: 'Laurel Park', category: 'park', lat: 37.5, lng: -122.3 })
const PLAYGROUND = mk({ id: 'pg-1', name: 'Alder Playground', category: 'playground', lat: 37.5, lng: -122.3 })
let dataset: ListItem[] = []
vi.mock('@/hooks/useItems', () => ({ useItems: () => ({ data: { items: dataset } }) }))

import { StackedFeatureList } from '../StackedFeatureList'

beforeEach(() => {
  dataset = [PARK, PLAYGROUND]
  useMapStore.setState({
    stackedFeatures: {
      lng: -122.3,
      lat: 37.5,
      features: [
        { id: 'park-1', name: 'Laurel Park', category: 'park' },
        { id: 'pg-1', name: 'Alder Playground', category: 'playground' },
      ],
    },
    selectedId: null,
  })
})
afterEach(() => {
  cleanup()
  useMapStore.setState({ stackedFeatures: null, selectedId: null })
})

describe('StackedFeatureList', () => {
  it('lists every stacked place, alphabetically', () => {
    render(<StackedFeatureList />)
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual([expect.stringContaining('Alder Playground'), expect.stringContaining('Laurel Park')])
    expect(screen.getByText('2 items here')).toBeInTheDocument()
  })

  it('opens the tapped place', () => {
    render(<StackedFeatureList />)
    fireEvent.click(screen.getByText('Laurel Park'))
    expect(useMapStore.getState().selectedId).toBe('park-1')
  })
})
