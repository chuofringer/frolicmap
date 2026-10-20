import { create } from 'zustand'
import type { MapRef } from 'react-map-gl/maplibre'
import { resolveBasemapId, type BasemapId } from '@/config/mapStyle'
import type { Category } from '@shared/types'

export interface StackedFeatureEntry {
  id: string
  name: string
  category: Category
}

export interface StackedFeatureCluster {
  lng: number
  lat: number
  features: StackedFeatureEntry[]
}

// Single-open popover coordinator (revision 3, item 1b). At most one of these
// surfaces is open at a time, and opening any of them closes the detail panel /
// bottom sheet. All render at z-50.
//   'menu' = the mobile ⋯ action sheet (basemap + legend live inline in it).
export type OverlayName = 'faq' | 'basemap' | 'filters' | 'metro' | 'legend' | 'menu'

interface MapStore {
  flyTo: { longitude: number; latitude: number; zoom: number } | null
  setFlyTo: (target: MapStore['flyTo']) => void
  searchMarker: [number, number] | null
  setSearchMarker: (m: [number, number] | null) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  // Map vs. List view. The consolidated bar's segmented control drives this;
  // ListPanel renders when 'list'. URL-synced as ?view=list via useUrlView.
  viewMode: 'map' | 'list'
  setViewMode: (v: 'map' | 'list') => void
  stackedFeatures: StackedFeatureCluster | null
  setStackedFeatures: (c: StackedFeatureCluster | null) => void
  // Remembered when a detail popup is opened from a stacked list, so the
  // popup can render a "← back to list" affordance without the user
  // having to re-click the venue. Cleared on direct pin clicks.
  lastStackedFeatures: StackedFeatureCluster | null
  basemap: BasemapId
  setBasemap: (id: BasemapId) => void
  mapInstance: MapRef | null
  setMapInstance: (m: MapRef | null) => void
  // Single-open popover coordinator (item 1b). Opening any overlay closes the
  // detail panel/sheet and any other overlay; each popover derives its open
  // state from `overlay === '<name>'`.
  overlay: OverlayName | null
  openOverlay: (name: OverlayName) => void
  closeOverlay: (name?: OverlayName) => void
}

const loadBasemap = (): BasemapId => {
  if (typeof window === 'undefined') return 'light'
  try {
    const v = localStorage.getItem('frolicmap.basemap')
    // Validated through the resolver: a retired id (e.g. an old stored value)
    // falls back to the default with one warning instead of rendering blank.
    if (v !== null) return resolveBasemapId(v)
  } catch {
    // localStorage unavailable (private mode / storage disabled) — use the default.
  }
  return 'light'
}

export const useMapStore = create<MapStore>((set) => ({
  flyTo: null,
  setFlyTo: (flyTo) => set({ flyTo }),
  searchMarker: null,
  setSearchMarker: (searchMarker) => set({ searchMarker }),
  selectedId: null,
  // Opening a pin popup implicitly closes any stacked-feature mini-list.
  // If we're transitioning FROM a stacked list, preserve it to
  // lastStackedFeatures so the popup can show a back link. A direct pin
  // click (no list open) clears any stale remembered cluster.
  setSelectedId: (selectedId) =>
    set((s) => {
      if (selectedId === null) {
        return { selectedId: null, stackedFeatures: null, lastStackedFeatures: null }
      }
      // Opening a detail closes any open overlay (mutual exclusivity, item 1b).
      if (s.stackedFeatures) {
        return { selectedId, stackedFeatures: null, lastStackedFeatures: s.stackedFeatures, overlay: null }
      }
      return { selectedId, stackedFeatures: null, lastStackedFeatures: null, overlay: null }
    }),
  viewMode: 'map',
  setViewMode: (viewMode) => set({ viewMode }),
  stackedFeatures: null,
  // Opening the mini-list implicitly closes any open single-item popup,
  // so the two overlays never render at once. Opening a fresh list also
  // clears the back-to-list memory — that memory is only meaningful
  // during a list → detail → back sequence.
  setStackedFeatures: (stackedFeatures) =>
    set(stackedFeatures
      // `overlay: null` for the same mutual exclusivity as setSelectedId —
      // without it a stacked-cluster click with the filters drawer open
      // rendered both "single-open" surfaces at once.
      ? { stackedFeatures, selectedId: null, lastStackedFeatures: null, overlay: null }
      : { stackedFeatures: null }),
  lastStackedFeatures: null,
  basemap: loadBasemap(),
  setBasemap: (requested) => {
    const id = resolveBasemapId(requested)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('frolicmap.basemap', id) } catch { /* private mode — preference just won't persist */ }
    }
    set({ basemap: id })
  },
  mapInstance: null,
  setMapInstance: (mapInstance) => set({ mapInstance }),
  overlay: null,
  // Opening an overlay closes the detail panel/sheet and the stacked mini-list.
  openOverlay: (overlay) => set({ overlay, selectedId: null, stackedFeatures: null, lastStackedFeatures: null }),
  // `closeOverlay(name)` only closes if that overlay is the open one (avoids a
  // late close from an unmounting popover clobbering a newly-opened one).
  closeOverlay: (name) => set((s) => (name && s.overlay !== name ? {} : { overlay: null })),
}))
