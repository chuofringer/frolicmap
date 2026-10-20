import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { forwardRef } from 'react'
import type { MapProps, MapRef } from 'react-map-gl/maplibre'

// Regression: the map wrapper reads the camera on every `move`/`zoom`/`pitch`
// event. MapLibre 6 removed the public `map.transform` property, so a wrapper
// release that still dereferenced it threw "Cannot read properties of
// undefined (reading 'center')" on each camera event. This mounts the REAL
// wrapper (not a probe) over a fake MapLibre that, like v6, exposes the camera
// only through getters and has no `transform`, then fires camera events.
const fake = vi.hoisted(() => {
  type Listener = (e: Record<string, unknown>) => void
  const instances: unknown[] = []
  const camera = { lng: -122.25, lat: 47.55, zoom: 10, pitch: 0, bearing: 0 }
  class FakeMap {
    private listeners = new Map<string, Listener[]>()
    private container: HTMLElement
    constructor(options: { container: HTMLElement }) {
      this.container = options.container
      instances.push(this)
    }
    on(type: string, fn: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
      return this
    }
    once() { return this }
    off(type: string, fn: Listener) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== fn))
      return this
    }
    emit(type: string): Record<string, unknown> {
      const event: Record<string, unknown> = { type, target: this }
      for (const l of this.listeners.get(type) ?? []) l(event)
      return event
    }
    // v6-style camera getters; deliberately no `transform` property.
    getCenter() { return { lng: camera.lng, lat: camera.lat } }
    getZoom() { return camera.zoom }
    getPitch() { return camera.pitch }
    getBearing() { return camera.bearing }
    getPadding() { return { top: 0, bottom: 0, left: 0, right: 0 } }
    getCenterElevation() { return 0 }
    setTransformCameraUpdate() {}
    setMissingStyleImageResolver() {}
    getCanvas() { return document.createElement('canvas') }
    getContainer() { return this.container }
    getLight() { return undefined }
    getSky() { return undefined }
    getProjection() { return undefined }
    getTerrain() { return undefined }
    getLayer() { return undefined }
    getSource() { return undefined }
    setPadding() {}
    setMaxBounds() {}
    setMinZoom() {}
    setMaxZoom() {}
    setMinPitch() {}
    setMaxPitch() {}
    setStyle() {}
    isMoving() { return false }
    isStyleLoaded() { return false }
    resize() {}
    redraw() {}
    jumpTo() {}
    remove() {}
    hasImage() { return false }
    addImage() {}
    addControl() {}
    removeControl() {}
    hasControl() { return false }
    queryRenderedFeatures() { return [] }
    project() { return { x: 0, y: 0 } }
    unproject() { return { lng: 0, lat: 0 } }
  }
  class FakeAttributionControl {
    onAdd() { return document.createElement('div') }
    onRemove() {}
  }
  return {
    instances,
    camera,
    FakeMap,
    FakeAttributionControl,
  }
})

// The wrapper loads MapLibre with a dynamic import that the test runner cannot
// intercept, so hand the real wrapper the fake through its public `mapLib` prop.
vi.mock('react-map-gl/maplibre', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-map-gl/maplibre')>()
  const Real = actual.default
  const WithFakeLib = forwardRef<MapRef, MapProps>((props, ref) => (
    <Real {...props} mapLib={Promise.resolve({ Map: fake.FakeMap, AttributionControl: fake.FakeAttributionControl }) as unknown as MapProps['mapLib']} ref={ref} />
  ))
  return { ...actual, default: WithFakeLib }
})
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
vi.mock('../maplibreWorker', () => ({}))
vi.mock('@/hooks/useItems', () => ({ useItems: () => ({ data: { items: [] } }) }))
vi.mock('../ItemSource', () => ({ ItemSource: () => null }))
vi.mock('../NearbyOverlay', () => ({ NearbyOverlay: () => null }))
vi.mock('../SearchMarker', () => ({ SearchMarker: () => null }))
vi.mock('@/components/Panel/StackedFeatureList', () => ({ StackedFeatureList: () => null }))

import { FunMap } from '../FunMap'
import { useMapStore } from '@/stores/useMapStore'

interface FakeMapApi {
  emit: (type: string) => { viewState?: Record<string, unknown> }
}

beforeEach(() => {
  fake.instances.length = 0
  Object.assign(fake.camera, { lng: -122.25, lat: 47.55, zoom: 10, pitch: 0, bearing: 0 })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
})
afterEach(() => {
  cleanup()
  useMapStore.setState({ mapInstance: null })
})

describe('FunMap camera events (MapLibre 6 transform removal)', () => {
  it('reads the camera from getters on move without throwing', async () => {
    render(<FunMap />, { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> })
    await waitFor(() => expect(fake.instances).toHaveLength(1))
    const map = fake.instances[0] as FakeMapApi
    await waitFor(() => expect(useMapStore.getState().mapInstance).not.toBeNull())

    // The map moved (drag / zoom / pitch). Each event must carry the live
    // camera and must not throw.
    fake.camera.lng = -122.1
    fake.camera.lat = 47.6
    fake.camera.zoom = 12.5
    for (const type of ['movestart', 'move', 'zoom', 'pitch', 'moveend']) {
      let event: { viewState?: Record<string, unknown> } = {}
      expect(() => { event = map.emit(type) }, type).not.toThrow()
      expect(event.viewState, type).toMatchObject({ longitude: -122.1, latitude: 47.6, zoom: 12.5 })
    }
  })
})
