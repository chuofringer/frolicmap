import { useRef, useEffect, useMemo, useCallback } from 'react'
import Map, { type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getBasemapStyle } from '@/config/mapStyle'
import { MIN_ZOOM, MAX_ZOOM } from '@/config/constants'
import { useMetro } from '@/hooks/useMetro'
import { useItems } from '@/hooks/useItems'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { useMapStore } from '@/stores/useMapStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { applyFilters } from '@/utils/filters'
import { trackGoal, setAnalyticsRegion, trackMetroView } from '@/utils/analytics'
import { openItemDetail } from '@/utils/openItem'
import { ItemSource } from './ItemSource'
import { NearbyOverlay } from './NearbyOverlay'
import { SearchMarker } from './SearchMarker'
import { StackedFeatureList } from '@/components/Panel/StackedFeatureList'
import type { Category } from '@shared/types'
import type { StackedFeatureEntry } from '@/stores/useMapStore'

const HOVER_LAYERS = ['unclustered-point', 'unclustered-emoji']
// Pixel radius for the click-time queryRenderedFeatures bbox. A few px
// past the rendered circle radius so nearly-overlapping pins (e.g. same
// venue, multiple event dates) all get picked up in one hit-test.
const STACK_HIT_RADIUS_PX = 6
// Empty-map taps close the open panel/sheet — but the first tap of a
// double-tap zoom is also an empty-map tap, so an immediate close costs the
// user their panel when all they wanted was to zoom. Hold the close this
// long; a dblclick (or a camera already animating when the timer fires)
// cancels it. Kept under typical double-tap detection (~500ms) but long
// enough that a deliberate close doesn't feel laggy.
const CLOSE_ON_TAP_DELAY_MS = 350

export function FunMap() {
  // Viewport comes from the metro registry (#358) rather than the Bay-pinned
  // constants, so /cities/{metro} opens over the right city.
  const metro = useMetro()
  const mapRef = useRef<MapRef | null>(null)
  const hoveredIdRef = useRef<number | string | null>(null)
  const { data } = useItems()
  const filters = useFiltersStore()
  const flyTo = useMapStore((s) => s.flyTo)
  const selectedId = useMapStore((s) => s.selectedId)
  const setSelectedId = useMapStore((s) => s.setSelectedId)
  const setStackedFeatures = useMapStore((s) => s.setStackedFeatures)
  const setMapInstance = useMapStore((s) => s.setMapInstance)
  const basemap = useMapStore((s) => s.basemap)

  const onRef = useCallback((node: MapRef | null) => {
    mapRef.current = node
    setMapInstance(node)
  }, [setMapInstance])

  const pendingCloseRef = useRef<number | null>(null)
  const cancelPendingClose = useCallback(() => {
    if (pendingCloseRef.current !== null) {
      window.clearTimeout(pendingCloseRef.current)
      pendingCloseRef.current = null
    }
  }, [])
  // Clear a scheduled close on unmount (metro switch remounts the map).
  useEffect(() => cancelPendingClose, [cancelPendingClose])

  useEffect(() => {
    if (flyTo && mapRef.current) {
      mapRef.current.flyTo({ center: [flyTo.longitude, flyTo.latitude], zoom: flyTo.zoom })
    }
  }, [flyTo])

  // Per-city analytics (#243). While the map is mounted, tag every `trackGoal`
  // beacon with the current metro so the behavior dashboard can segment by
  // city; fire the once-per-session `metro_view` visit signal. Cleanup resets
  // the region to null so off-metro pages (e.g. /signup) don't inherit it.
  // Keyed on metro.id so a client-side metro switch re-tags and re-fires.
  useEffect(() => {
    setAnalyticsRegion(metro.id)
    trackMetroView(metro.id)
    return () => setAnalyticsRegion(null)
  }, [metro.id])

  const filtered = useMemo(
    () => applyFilters(data?.items ?? [], filters),
    [data, filters]
  )

  // Don't mount the vector source until the session token is minted.
  // MapLibre aggressively caches failed tile responses: if we mounted
  // before `useSession()` finished its first `POST /api/session`, the
  // first N tile requests would 401 and MapLibre would NOT retry
  // them — permanent blank patches on the map. Guarding on
  // `sessionReady` delays tile mount by the <200ms mint RTT.
  const sessionReady = useSessionStore((s) => !!s.token)

  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const map = e.target
    const f = e.features?.[0]
    if (f && (f.layer.id === 'unclustered-point' || f.layer.id === 'unclustered-emoji')) {
      map.getCanvas().style.cursor = 'pointer'
      const fid = f.id
      if (fid !== undefined && fid !== hoveredIdRef.current) {
        if (hoveredIdRef.current !== null) {
          map.setFeatureState({ source: 'items', id: hoveredIdRef.current }, { hover: false })
        }
        hoveredIdRef.current = fid
        map.setFeatureState({ source: 'items', id: fid }, { hover: true })
      }
    }
  }, [])

  const handleMouseLeave = useCallback((e: MapLayerMouseEvent) => {
    const map = e.target
    map.getCanvas().style.cursor = ''
    if (hoveredIdRef.current !== null) {
      map.setFeatureState({ source: 'items', id: hoveredIdRef.current }, { hover: false })
      hoveredIdRef.current = null
    }
  }, [])

  // MapLibre fetches vector tiles directly and has no hook into our
  // TanStack Query / fetch wrappers, so Phase 2c's `Authorization: Bearer`
  // header has to be attached here via MapLibre's `transformRequest` API.
  // Runs per-request inside MapLibre's fetcher so the current token is
  // always used (useSessionStore.getState() reads the live value, not a
  // stale React closure; matches the pattern in src/api/items.ts).
  //
  // Match by URL pathname on our hosts, not by API_BASE prefix — after
  // #194's same-origin flip, API_BASE is the empty string in production,
  // so a `&& API_BASE` short-circuit silently dropped the auth header
  // and the worker returned 401 for every tile (issue: pins disappeared).
  // Basemap tiles from CARTO / OpenFreeMap / Esri use different hosts
  // and paths, so they don't match this filter.
  const transformRequest = useCallback(
    (url: string, resourceType?: string) => {
      if (resourceType === 'Tile') {
        let parsed: URL | null = null
        try { parsed = new URL(url, window.location.origin) } catch { /* leave null */ }
        const isOurTile =
          parsed !== null &&
          parsed.pathname.startsWith('/api/tiles/') &&
          (parsed.hostname === window.location.hostname || parsed.hostname === 'api.funradar.app')
        if (isOurTile) {
          const token = useSessionStore.getState().token
          if (token) {
            return { url, headers: { Authorization: `Bearer ${token}` } }
          }
        }
      }
      return { url }
    },
    [],
  )

  return (
    <Map
      ref={onRef}
      // react-map-gl reads initialViewState ONCE on mount and never again
      // (unlike maxBounds, which is reactive). Keying the map on the metro id
      // remounts it on a client-side metro switch so the camera actually
      // moves — without the key, /cities/a → /cities/b left the camera over A
      // while the bounds snapped to B. A remount is fine here: the entire
      // dataset changes with the metro anyway.
      key={metro.id}
      initialViewState={metro.initialView}
      mapStyle={getBasemapStyle(basemap)}
      maxBounds={metro.viewportBounds}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      transformRequest={transformRequest}
      style={{ width: '100%', height: '100%' }}
      interactiveLayerIds={HOVER_LAYERS}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDblClick={cancelPendingClose}
      onClick={(e) => {
        // Widen the hit-test from the default single pixel to a small
        // bbox so near-coincident pins (multi-date events at the same
        // venue, park + playground within a few metres) are all
        // returned. `e.features` is MapLibre's default 1-px lookup; we
        // re-query here to pick up siblings.
        const map = e.target
        const { x, y } = e.point
        const rendered = map.queryRenderedFeatures(
          [[x - STACK_HIT_RADIUS_PX, y - STACK_HIT_RADIUS_PX], [x + STACK_HIT_RADIUS_PX, y + STACK_HIT_RADIUS_PX]],
          { layers: HOVER_LAYERS },
        )
        // Tap on empty map closes whichever overlay is open — the detail
        // panel / bottom sheet (selectedId) or the stacked-pin mini-list.
        // Deferred by CLOSE_ON_TAP_DELAY_MS so the first tap of a double-tap
        // zoom doesn't dismiss the panel: onDblClick cancels the timer, and
        // `isMoving()` at fire time catches the touch double-tap path where
        // no dblclick event reaches us but the zoom animation is in flight.
        if (rendered.length === 0) {
          const { selectedId, stackedFeatures } = useMapStore.getState()
          if (!selectedId && !stackedFeatures) return
          cancelPendingClose()
          pendingCloseRef.current = window.setTimeout(() => {
            pendingCloseRef.current = null
            if (map.isMoving()) return
            const now = useMapStore.getState()
            if (now.selectedId) setSelectedId(null)
            else if (now.stackedFeatures) setStackedFeatures(null)
          }, CLOSE_ON_TAP_DELAY_MS)
          return
        }
        // A feature click supersedes any close scheduled by a just-preceding
        // empty tap — otherwise that timer would shut the panel this click is
        // about to open.
        cancelPendingClose()

        // Dedupe by id — the same feature shows up once per layer
        // (`unclustered-point` + `unclustered-emoji` both match).
        const seen = new Set<string>()
        const entries: StackedFeatureEntry[] = []
        let anchorLng = e.lngLat.lng
        let anchorLat = e.lngLat.lat
        let anchorSet = false
        for (const f of rendered) {
          const p = f.properties as { id?: string; name?: string; category?: Category; type?: string } | null
          if (!p?.id || seen.has(p.id)) continue
          seen.add(p.id)
          entries.push({ id: p.id, name: p.name ?? '(unnamed)', category: (p.category ?? 'event') as Category, type: p.type })
          if (!anchorSet && f.geometry?.type === 'Point') {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
            anchorLng = lng
            anchorLat = lat
            anchorSet = true
          }
        }

        if (entries.length === 0) return
        if (entries.length === 1) {
          openItemDetail(entries[0])
          return
        }
        // Stack open stays contextless (the item isn't chosen yet — the pick in
        // StackedFeatureList logs its own popup_open with the id). #481
        trackGoal('popup_open')
        setStackedFeatures({ lng: anchorLng, lat: anchorLat, features: entries })
      }}
    >
      {sessionReady && <ItemSource items={filtered} selectedId={selectedId} />}
      <NearbyOverlay />
      <SearchMarker />
      <StackedFeatureList />
    </Map>
  )
}
