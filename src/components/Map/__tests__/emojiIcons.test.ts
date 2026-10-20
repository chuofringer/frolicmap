import { describe, it, expect, vi, afterEach } from 'vitest'
import { CATEGORIES } from '@/config/categories'
import {
  EMOJI_ICON_FALLBACK_ID,
  EMOJI_ICON_FONT_PX,
  emojiForIconId,
  emojiIconId,
  inkBounds,
  installEmojiIcons,
  rasterizeEmoji,
} from '../emojiIcons'
import type { Map as MapLibreMap } from 'maplibre-gl'

describe('emoji icon ids', () => {
  it('round-trips every category and the fallback', () => {
    for (const [cat, meta] of Object.entries(CATEGORIES)) {
      expect(emojiForIconId(emojiIconId(cat as keyof typeof CATEGORIES))).toBe(meta.emoji)
    }
    expect(emojiForIconId(EMOJI_ICON_FALLBACK_ID)).toBe('❓')
  })

  it('ignores ids that are not ours (basemap sprite names, prototype keys)', () => {
    expect(emojiForIconId('poi_museum')).toBeNull()
    expect(emojiForIconId('emoji-nope')).toBeNull()
    expect(emojiForIconId('emoji-constructor')).toBeNull()
  })

  it('keeps the colour-emoji glyph intact for the canvas (U+FE0F is the browser\'s job)', () => {
    expect(emojiForIconId(emojiIconId('museum'))).toContain('️')
  })
})

describe('inkBounds', () => {
  it('finds the opaque rectangle and ignores anti-aliasing fringe', () => {
    const w = 10, h = 6
    const data = new Uint8ClampedArray(w * h * 4)
    const set = (x: number, y: number, a: number) => { data[(y * w + x) * 4 + 3] = a }
    for (let y = 2; y <= 4; y++) for (let x = 3; x <= 7; x++) set(x, y, 255)
    set(0, 0, 10) // faint fringe pixel must not count
    expect(inkBounds(data, w, h)).toEqual({ minX: 3, minY: 2, maxX: 7, maxY: 4 })
  })

  it('is null when nothing was drawn', () => {
    expect(inkBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBeNull()
  })
})

// jsdom has no 2D canvas, so the rasteriser is exercised against a fake that
// "draws" an off-centre blob and records how the output canvas was composed.
// The thing under test is the centring arithmetic, not the browser's text
// engine.
function fakeCanvases(blob: { x: number; y: number; w: number; h: number } | null) {
    const drawImageCalls: number[][] = []
    const fonts: string[] = []
    let nth = 0
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') throw new Error('unexpected element ' + tag)
      const isScratch = nth++ === 0
      const ctx = {
        set font(v: string) { fonts.push(v) },
        textAlign: 'left',
        textBaseline: 'alphabetic',
        fillText: () => {},
        drawImage: (...args: unknown[]) => { drawImageCalls.push(args.slice(1) as number[]) },
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4)
          if (isScratch && blob) {
            for (let y = blob.y; y < blob.y + blob.h; y++) {
              for (let x = blob.x; x < blob.x + blob.w; x++) data[(y * w + x) * 4 + 3] = 255
            }
          }
          return { data, width: w, height: h }
        },
      }
      const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
      return canvas
    }) as typeof document.createElement)
    return { drawImageCalls, fonts }
}

describe('rasterizeEmoji', () => {
  afterEach(() => vi.restoreAllMocks())

  it('crops to the ink and centres it on a square image at the given pixel ratio', () => {
    // A 20×12 blob drawn well off the scratch centre.
    const { drawImageCalls, fonts } = fakeCanvases({ x: 5, y: 40, w: 20, h: 12 })
    const icon = rasterizeEmoji('🏛️', 2)
    expect(icon).not.toBeNull()
    expect(fonts[0]).toMatch(new RegExp(`^${EMOJI_ICON_FONT_PX * 2}px .*Apple Color Emoji`))
    // Square, big enough for the longer side plus padding, pixelRatio echoed.
    expect(icon!.width).toBe(icon!.height)
    expect(icon!.width).toBeGreaterThanOrEqual(20)
    expect(icon!.pixelRatio).toBe(2)
    expect(icon!.data.length).toBe(icon!.width * icon!.height * 4)
    // drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh): source rect is exactly
    // the ink, destination rect is centred on the output canvas.
    expect(drawImageCalls).toHaveLength(1)
    const [sx, sy, sw, sh, dx, dy, dw, dh] = drawImageCalls[0]
    expect([sx, sy, sw, sh]).toEqual([5, 40, 20, 12])
    expect([dw, dh]).toEqual([20, 12])
    const side = icon!.width
    expect(dx + sw / 2).toBeCloseTo(side / 2)
    expect(dy + sh / 2).toBeCloseTo(side / 2)
  })

  it('returns null when the font drew nothing (no emoji font on the platform)', () => {
    fakeCanvases(null)
    expect(rasterizeEmoji('🏛️', 1)).toBeNull()
  })
})

// MapLibre ≥ 6 awaits `setMissingStyleImageResolver` BEFORE a tile's image
// lookup; the `styleimagemissing` event fires only after the lookup failed, so
// an image added from the event misses the tile that asked (pins drew with no
// glyph on the first deploy). The resolver must be the registration path.
describe('installEmojiIcons', () => {
  afterEach(() => vi.restoreAllMocks())

  function fakeMap() {
    const images = new Map<string, { pixelRatio?: number }>()
    let resolver: ((id: string) => void | Promise<void>) | null = null
    const map = {
      setMissingStyleImageResolver: vi.fn((r: typeof resolver) => { resolver = r }),
      on: vi.fn(),
      hasImage: (id: string) => images.has(id),
      addImage: vi.fn((id: string, _img: unknown, opts?: { pixelRatio?: number }) => { images.set(id, opts ?? {}) }),
    }
    return { map: map as unknown as MapLibreMap, images, resolve: (id: string) => resolver!(id) }
  }

  it('registers a resolver (not only the late event) and rasterises our ids on demand', () => {
    fakeCanvases({ x: 10, y: 10, w: 20, h: 20 })
    const { map, images, resolve } = fakeMap()
    installEmojiIcons(map)
    expect(map.setMissingStyleImageResolver).toHaveBeenCalledTimes(1)
    resolve(emojiIconId('museum'))
    expect(images.has('emoji-museum')).toBe(true)
    expect(images.get('emoji-museum')!.pixelRatio).toBeGreaterThanOrEqual(1)
  })

  it('ignores foreign ids and never re-adds an existing image; installs once per map', () => {
    fakeCanvases({ x: 10, y: 10, w: 20, h: 20 })
    const { map, resolve } = fakeMap()
    installEmojiIcons(map)
    installEmojiIcons(map)
    expect(map.setMissingStyleImageResolver).toHaveBeenCalledTimes(1)
    resolve('poi_museum')
    expect(map.addImage).not.toHaveBeenCalled()
    resolve('emoji-park')
    resolve('emoji-park')
    expect(map.addImage).toHaveBeenCalledTimes(1)
  })
})
