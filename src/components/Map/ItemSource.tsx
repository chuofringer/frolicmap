import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import type { ListItem } from '@shared/types'
import { API_BASE } from '@/config/constants'
import { useSessionStore } from '@/stores/useSessionStore'
import { CATEGORY_COLOR_EXPR, EMOJI_ICON_EXPR } from './pinExpressions'
import { EMOJI_ICON_FONT_PX } from './emojiIcons'

interface Props { items: ListItem[]; selectedId?: string | null }

export function ItemSource({ items, selectedId }: Props) {
  // The allow-list of ids that should render on the map. Tiles from the
  // worker contain every approved row in the tile bbox (including anything
  // the current filter drawer would hide); the MapLibre layer filter below
  // narrows to just the ones that pass `applyFilters` upstream.
  const allowedIds = useMemo(() => items.map((i) => i.id), [items])

  // Filter expression: `id ∈ allowedIds`. MapLibre evaluates this per
  // feature per render; for our ~5k-row dataset this is cheap enough that
  // no perf optimization is warranted yet.
  //
  // One edge: vector-tile features are only loaded when MapLibre requests
  // their tile. So a pin whose id is in `allowedIds` but whose tile hasn't
  // been fetched yet won't appear — this is the normal "tile loading"
  // behaviour, not a filter bug.
  //
  // Type note: `['in', ..., ['literal', string[]]]` is a valid MapLibre
  // expression but its TypeScript type surface from @types/mapbox-gl is
  // narrower than reality. Cast is isolated to this file.
  const filter = useMemo(
    () => ['in', ['get', 'id'], ['literal', allowedIds]] as unknown as never,
    [allowedIds],
  )

  // Tile URL template. Must be ABSOLUTE — MapLibre constructs tiles via
  // `new Request(url)` (not `fetch(url)`), and the Request constructor
  // rejects relative URLs with "Failed to parse URL from /api/tiles/...".
  // After #194 cleared VITE_API_BASE, API_BASE became '' and the SPA
  // emitted a relative template `/api/tiles/...` that broke pin
  // rendering on prod. Falling back to `window.location.origin` keeps
  // the same-origin path absolute. In legacy/dev modes API_BASE is the
  // explicit base. SSR-safety: typeof window check defaults to '' so
  // tsc + tests don't crash; this component never renders without
  // window in practice (it lives inside the Map react-tree).
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const tileUrl = `${API_BASE || origin}/api/tiles/{z}/{x}/{y}.pbf`

  // Remount the vector source on a RECOVERY session mint (a fresh token after
  // the previous one expired — see useSessionStore). MapLibre never retries a
  // tile that 401'd with the dead Bearer until the map moves; keying on the
  // recovery `epoch` forces the source to drop and refetch those tiles with
  // the new token. A routine refresh leaves `epoch` unchanged, so a valid
  // session never triggers a remount (no flicker every ~4.5 min).
  const epoch = useSessionStore((s) => s.epoch)

  // Selected-pin styling (design handoff pin states): the selected pin enlarges
  // with a white border and an amber halo (a translucent circle rendered on its
  // own layer beneath the points). `sel` is a sentinel when nothing is selected
  // so `['==', ['get','id'], sel]` is simply false for every feature.
  const sel = selectedId ?? '__none__'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isSelected: any = ['==', ['get', 'id'], sel]
  // Halo renders only for the selected id (and only if it passes the allow-list
  // filter, so a filtered-out selection shows no orphan halo).
  const haloFilter = useMemo(
    () => ['all', ['in', ['get', 'id'], ['literal', allowedIds]], ['==', ['get', 'id'], sel]] as unknown as never,
    [allowedIds, sel],
  )

  return (
    <Source
      key={epoch}
      id="items"
      type="vector"
      tiles={[tileUrl]}
      // Worker caps each tile at 10000 rows; by z=12 the bbox query returns
      // well below that for our data density, so a deeper tile grid buys
      // nothing. Setting maxzoom keeps MapLibre from fetching progressively
      // more granular tiles at deeper zooms — it overzooms from z=12, which
      // is visually identical for point features.
      maxzoom={12}
      promoteId="id"
    >
      {/* Amber halo beneath the selected pin — the "0 0 0 4px rgba(245,158,11,.35)"
          selection ring from the handoff, done as a second circle layer. */}
      <Layer
        id="selected-halo"
        type="circle"
        source-layer="items"
        filter={haloFilter}
        paint={{
          'circle-color': '#f59e0b',
          'circle-opacity': 0.35,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, 11, 12, 13, 15, 17, 18, 21,
          ],
        }}
      />
      <Layer
        id="unclustered-point"
        type="circle"
        source-layer="items"
        filter={filter}
        paint={{
          'circle-color': CATEGORY_COLOR_EXPR,
          // Selected pins render enlarged (design handoff: 26px → 38px); hover
          // keeps its existing bump for everything else.
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, ['case', isSelected, 7, ['case', ['boolean', ['feature-state', 'hover'], false], 7, 4]],
            12, ['case', isSelected, 9, ['case', ['boolean', ['feature-state', 'hover'], false], 10, 6]],
            15, ['case', isSelected, 12, ['case', ['boolean', ['feature-state', 'hover'], false], 13, 8]],
            18, ['case', isSelected, 15, ['case', ['boolean', ['feature-state', 'hover'], false], 17, 11]],
          ],
          'circle-stroke-width': ['case', isSelected, 3, ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5]],
          'circle-stroke-color': '#ffffff',
        }}
      />
      <Layer
        id="unclustered-emoji"
        type="symbol"
        source-layer="items"
        filter={filter}
        minzoom={13}
        layout={{
          // Icon images, not text: MapLibre lays an emoji `text-field` out
          // with Latin line metrics and it lands up-and-left of the circle
          // centre (see emojiIcons.ts). The `emoji-*` images are rasterised
          // on demand by `installEmojiIcons` (FunMap) with the glyph's real
          // ink centred, so `icon-anchor: center` puts it on the circle.
          'icon-image': EMOJI_ICON_EXPR,
          // Same on-screen size the old `text-size` 9→14 px ramp gave.
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 9 / EMOJI_ICON_FONT_PX, 18, 14 / EMOJI_ICON_FONT_PX],
          'icon-anchor': 'center',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        }}
      />
    </Source>
  )
}
