import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Category } from '@shared/types'
import { CATEGORIES } from '@/config/categories'

// Map pin glyphs as ICON IMAGES, not `text-field` glyphs.
//
// MapLibre has no colour-font text path: an emoji in a `text-field` is handed to
// TinySDF, which rasterises the system emoji font to a monochrome distance
// field, and the shaper then places that glyph with Latin line metrics (a 1.2em
// line box, an alphabetic baseline, horizontal centring by the font's advance
// width). Emoji ink does not sit where a Latin letter's would — it is taller,
// hangs below the baseline, and its advance is wider than its ink — so every
// category drew visibly up-and-left of its circle centre (museum 🏛️ and
// library 📚 worst). Stripping U+FE0F (the earlier fix) helped one symptom but
// could not fix the metrics mismatch.
//
// Here each category's emoji is drawn once on a canvas with the browser's own
// text engine, the drawn pixels are scanned for their real ink bounds, and the
// ink is re-centred on a square image that is registered with
// `map.addImage`. Centring is then exact on every platform (Apple, Noto,
// Segoe) because it measures what was actually drawn, and the pins pick up the
// same full-colour glyph the legend and list cards show in the DOM.

export const EMOJI_ICON_PREFIX = 'emoji-'
export const EMOJI_ICON_FALLBACK_ID = `${EMOJI_ICON_PREFIX}fallback`
const FALLBACK_EMOJI = '❓'

/**
 * The em size (CSS px) the icon images are drawn at. `icon-size` on the layer
 * is `desired px / EMOJI_ICON_FONT_PX`, which keeps the on-screen glyph the
 * same size the old `text-size` ramp gave it.
 */
export const EMOJI_ICON_FONT_PX = 24

// Every mainstream colour emoji font, then a generic fallback so *something*
// draws (and gets measured) on an exotic platform.
const EMOJI_FONT_FAMILY =
  '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", "Android Emoji", sans-serif'

// Alpha below this is anti-aliasing fringe, not ink. Keeps a faint halo from
// biasing the measured bounds.
const INK_ALPHA_THRESHOLD = 24

export function emojiIconId(cat: Category): string {
  return `${EMOJI_ICON_PREFIX}${cat}`
}

/** The emoji an icon id stands for, or null if the id is not one of ours. */
export function emojiForIconId(id: string): string | null {
  if (!id.startsWith(EMOJI_ICON_PREFIX)) return null
  if (id === EMOJI_ICON_FALLBACK_ID) return FALLBACK_EMOJI
  const cat = id.slice(EMOJI_ICON_PREFIX.length)
  return Object.prototype.hasOwnProperty.call(CATEGORIES, cat)
    ? CATEGORIES[cat as Category].emoji
    : null
}

export interface EmojiIcon {
  width: number
  height: number
  data: Uint8ClampedArray
  /** Device pixels per CSS pixel the image was drawn at (for `addImage`). */
  pixelRatio: number
}

/** Real ink bounds of an RGBA buffer, or null when nothing was drawn. */
export function inkBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > INK_ALPHA_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY }
}

/**
 * Draws `emoji` at `fontPx * pixelRatio` device px and returns a square image
 * whose centre is the centre of the glyph's ink. Null when the canvas is
 * unavailable or the font drew nothing (MapLibre then keeps the pin's circle,
 * just without a glyph).
 */
export function rasterizeEmoji(
  emoji: string,
  pixelRatio: number,
  fontPx: number = EMOJI_ICON_FONT_PX,
): EmojiIcon | null {
  if (typeof document === 'undefined') return null
  const font = fontPx * pixelRatio
  // Generous scratch area: emoji ink can overhang its em box on every side.
  const scratchSide = Math.ceil(font * 3)
  const scratch = document.createElement('canvas')
  scratch.width = scratchSide
  scratch.height = scratchSide
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.font = `${font}px ${EMOJI_FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, scratchSide / 2, scratchSide / 2)

  const bounds = inkBounds(ctx.getImageData(0, 0, scratchSide, scratchSide).data, scratchSide, scratchSide)
  if (!bounds) return null
  const inkW = bounds.maxX - bounds.minX + 1
  const inkH = bounds.maxY - bounds.minY + 1

  // Square output so `icon-size` scales uniformly; the ink's centre lands on
  // the image centre (fractional offsets are fine — the canvas resamples).
  const pad = Math.ceil(2 * pixelRatio)
  const side = Math.max(inkW, inkH) + 2 * pad
  const out = document.createElement('canvas')
  out.width = side
  out.height = side
  const octx = out.getContext('2d', { willReadFrequently: true })
  if (!octx) return null
  octx.drawImage(
    scratch,
    bounds.minX, bounds.minY, inkW, inkH,
    (side - inkW) / 2, (side - inkH) / 2, inkW, inkH,
  )
  return { width: side, height: side, data: octx.getImageData(0, 0, side, side).data, pixelRatio }
}

function devicePixelRatioClamped(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.min(Math.max(dpr, 1), 3)
}

const installed = new WeakSet<MapLibreMap>()

/**
 * Supplies the `emoji-*` icon images on demand.
 *
 * Registered through `setMissingStyleImageResolver`, NOT the `styleimagemissing`
 * event: MapLibre ≥ 6 awaits the resolver *before* a symbol tile's image lookup,
 * whereas the event fires only after that lookup has already failed — an image
 * added from the event is too late for the tile that asked, which then renders
 * its pins with no glyph. The resolver is kept on the Map (not the Style), so
 * it survives basemap switches, which reload the style and drop its images.
 */
export function installEmojiIcons(map: MapLibreMap): void {
  if (installed.has(map)) return
  installed.add(map)
  map.setMissingStyleImageResolver((id: string) => {
    const emoji = emojiForIconId(id)
    if (emoji === null || map.hasImage(id)) return
    const icon = rasterizeEmoji(emoji, devicePixelRatioClamped())
    if (icon) map.addImage(id, icon, { pixelRatio: icon.pixelRatio })
  })
}
