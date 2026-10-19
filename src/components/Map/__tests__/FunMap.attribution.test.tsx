import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The licence requirement under test: OpenStreetMap (ODbL) must be credited with
// a link to openstreetmap.org/copyright on the map, on every basemap. react-map-gl
// needs WebGL, so the map primitives are replaced with probes that record the
// props FunMap hands them.
const probe = vi.hoisted(() => ({
  mapProps: null as Record<string, unknown> | null,
  attribution: null as { position?: string; compact?: boolean; customAttribution?: string[] } | null,
}))

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    probe.mapProps = props
    return <div data-testid="map">{props.children}</div>
  },
  AttributionControl: (props: { position?: string; compact?: boolean; customAttribution?: string[] }) => {
    probe.attribution = props
    return <div data-testid="attribution" />
  },
  Popup: () => null,
  Marker: () => null,
  Source: () => null,
  Layer: () => null,
}))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
vi.mock('@/hooks/useItems', () => ({ useItems: () => ({ data: { items: [] } }) }))
vi.mock('../ItemSource', () => ({ ItemSource: () => null }))
vi.mock('../NearbyOverlay', () => ({ NearbyOverlay: () => null }))
vi.mock('../SearchMarker', () => ({ SearchMarker: () => null }))
vi.mock('@/components/Panel/StackedFeatureList', () => ({ StackedFeatureList: () => null }))

import { FunMap, OSM_ATTRIBUTION } from '../FunMap'

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

const renderMap = () =>
  render(<FunMap />, { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> })

beforeEach(() => {
  probe.mapProps = null
  probe.attribution = null
})
afterEach(() => cleanup())

describe('FunMap attribution (ODbL credit)', () => {
  it('replaces the default control with a custom AttributionControl', () => {
    stubMatchMedia(true)
    const { getByTestId } = renderMap()
    expect(probe.mapProps?.attributionControl).toBe(false)
    expect(getByTestId('attribution')).toBeInTheDocument()
  })

  it('credits OpenStreetMap contributors with a link to the OSM copyright page', () => {
    stubMatchMedia(true)
    renderMap()
    expect(OSM_ATTRIBUTION).toContain('https://www.openstreetmap.org/copyright')
    expect(OSM_ATTRIBUTION).toContain('© OpenStreetMap contributors')
    expect(probe.attribution?.customAttribution).toEqual([OSM_ATTRIBUTION])
  })

  it('is expanded on desktop and compact on mobile', () => {
    stubMatchMedia(true)
    renderMap()
    expect(probe.attribution?.compact).toBe(false)
    cleanup()

    stubMatchMedia(false)
    renderMap()
    expect(probe.attribution?.compact).toBe(true)
  })
})
