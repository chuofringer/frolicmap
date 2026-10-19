import { create } from 'zustand'
import type { MapRef } from 'react-map-gl/maplibre'
import type { BasemapId } from '@/config/mapStyle'
import type { Category } from '@shared/types'

export interface StackedFeatureEntry {
  id: string
  name: string
  category: Category
  // Tile-feature `type` ('place' | 'event') when present — lets click sites
  // run the shared events-gate predicate (isGatedEventKind) on a raw tile
  // feature for the #642 event-intent signal.
  type?: string
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
export type OverlayName = 'faq' | 'basemap' | 'filters' | 'metro' | 'legend' | 'menu' | 'submit' | 'picks'

interface MapStore {
  flyTo: { longitude: number; latitude: number; zoom: number } | null
  setFlyTo: (target: MapStore['flyTo']) => void
  searchMarker: [number, number] | null
  setSearchMarker: (m: [number, number] | null) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  // Map vs. List vs. Calendar view. The consolidated bar's segmented control
  // drives this; ListPanel renders when 'list', CalendarPanel when 'calendar'.
  // URL-synced as ?view=list / ?view=calendar via useUrlView.
  viewMode: 'map' | 'list' | 'calendar'
  setViewMode: (v: 'map' | 'list' | 'calendar') => void
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
  /**
   * Coming-soon waitlist intent (#359). Set when a parent taps a disabled
   * category chip in a metro where that layer isn't live; the slide-in reads
   * it so the signup carries which metro and category were actually wanted —
   * that pairing is the demand signal that picks the next depth metro.
   */
  waitlistIntent: { category: string; metro: string } | null
  openWaitlistForCategory: (intent: { category: string; metro: string }) => void
  clearWaitlistIntent: () => void
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
    const v = localStorage.getItem('funradar.basemap')
    if (v === 'light' || v === 'dark' || v === 'street' || v === 'liberty' || v === 'satellite') return v
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
  setBasemap: (id) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('funradar.basemap', id) } catch { /* private mode — preference just won't persist */ }
    }
    set({ basemap: id })
  },
  mapInstance: null,
  setMapInstance: (mapInstance) => set({ mapInstance }),
  waitlistIntent: null,
  openWaitlistForCategory: (intent) => set({ waitlistIntent: intent }),
  clearWaitlistIntent: () => set({ waitlistIntent: null }),
  overlay: null,
  // Opening an overlay closes the detail panel/sheet and the stacked mini-list.
  openOverlay: (overlay) => set({ overlay, selectedId: null, stackedFeatures: null, lastStackedFeatures: null }),
  // `closeOverlay(name)` only closes if that overlay is the open one (avoids a
  // late close from an unmounting popover clobbering a newly-opened one).
  closeOverlay: (name) => set((s) => (name && s.overlay !== name ? {} : { overlay: null })),
}))
