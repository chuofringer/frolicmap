import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { metroViewbox, withinMetro, useGeocodeQuery } from '../useGeocode'
import { getMetro } from '@shared/metros'

const bay = getMetro('bay')!
const seattle = getMetro('seattle')!

describe('geocode scoping follows the current metro', () => {
  it('builds a viewbox from the metro, not a hardcoded California bbox', () => {
    // The bug: every metro searched inside CA, so address autocomplete
    // returned nothing at all on the 11 published non-CA metro pages.
    const box = metroViewbox(seattle).split(',').map(Number)
    const [[w, s], [e, n]] = seattle.viewportBounds
    expect(box[0]).toBeCloseTo(w - 0.15, 5)   // west
    expect(box[1]).toBeCloseTo(n + 0.15, 5)   // north
    expect(box[2]).toBeCloseTo(e + 0.15, 5)   // east
    expect(box[3]).toBeCloseTo(s - 0.15, 5)   // south
    expect(metroViewbox(bay)).not.toBe(metroViewbox(seattle))
  })

  it('accepts an in-metro address and rejects an out-of-metro one', () => {
    expect(withinMetro(seattle, 47.62, -122.35)).toBe(true)   // downtown Seattle
    expect(withinMetro(seattle, 37.77, -122.42)).toBe(false)  // San Francisco
    expect(withinMetro(bay, 37.77, -122.42)).toBe(true)
    expect(withinMetro(bay, 47.62, -122.35)).toBe(false)
  })

  it('does not reject a Washington address the old state filter would have dropped', () => {
    // Old post-filter required address.state === 'California'; every Seattle
    // result failed it regardless of coordinates.
    expect(withinMetro(seattle, 47.61, -122.20)).toBe(true)
  })
})

describe('Nominatim request shape', () => {
  afterEach(() => vi.unstubAllGlobals())

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    )

  it('sends limit=5 and the contact email, and nothing for a too-short query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useGeocodeQuery('ab'), { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()

    renderHook(() => useGeocodeQuery('123 Main St'), { wrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.hostname).toBe('nominatim.openstreetmap.org')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('email')).toBe('frolicmap.official@gmail.com')
    expect(url.searchParams.get('q')).toBe('123 Main St')
    expect(url.searchParams.get('viewbox')).toBeTruthy()
  })
})
