import { describe, it, expect } from 'vitest'
import {
  samplePoints, wrapThumb, renderThumbsScript,
  MAX_THUMB_POINTS, THUMB_STYLE_URL,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/citiesThumbs.mjs'

describe('samplePoints', () => {
  it('maps pins to [lng, lat, colour] with the legend colour and amber fallback', () => {
    const pts = samplePoints([
      { lat: 37.123456, lng: -122.987654, category: 'museum' },
      { lat: 1, lng: 2, category: 'mystery' },
    ])
    expect(pts).toEqual([[-122.9877, 37.1235, '#8b5cf6'], [2, 1, '#f59e0b']])
  })

  it('caps at 300 and drops non-finite coordinates', () => {
    const pins = Array.from({ length: 500 }, (_, i) => ({ lat: 40 + i / 1e4, lng: -100, category: 'park' }))
    expect(MAX_THUMB_POINTS).toBe(300)
    expect(samplePoints(pins)).toHaveLength(300)
    expect(samplePoints([{ lat: NaN, lng: 1, category: 'park' }, { lat: null, lng: 1, category: 'park' }])).toEqual([])
  })
})

describe('wrapThumb', () => {
  it('emits data-bbox west,south,east,north and single-quoted JSON data-points around the fallback', () => {
    const html = wrapThumb({
      bbox: { west: -1, south: 2, east: 3, north: 4 },
      points: [[1, 2, '#fff']],
      fallbackHtml: '<div class="citymap"></div>',
    })
    expect(html).toBe(
      `<div class="thumb" data-bbox="-1,2,3,4" data-points='[[1,2,"#fff"]]'><div class="citymap"></div></div>`,
    )
  })
})

describe('renderThumbsScript', () => {
  const js = renderThumbsScript({ maplibreChunk: '/assets/maplibre-gl-XYZ.js' })

  it('imports the site’s own MapLibre chunk and the positron style, never a CDN', () => {
    expect(js).toContain('"/assets/maplibre-gl-XYZ.js"')
    expect(js).toContain(THUMB_STYLE_URL)
    expect(THUMB_STYLE_URL).toBe('https://tiles.openfreemap.org/styles/positron')
    expect(js).not.toMatch(/unpkg|jsdelivr|cdnjs/)
  })

  it('builds a non-interactive, attribution-free map from the card bbox', () => {
    expect(js).toContain('interactive: false')
    expect(js).toContain('attributionControl: false')
    expect(js).toContain('fadeDuration: 0')
    expect(js).toContain('IntersectionObserver')
    expect(js).toContain("type: 'circle'")
  })

  it('snapshots each map to a static <img> and frees the WebGL context', () => {
    expect(js).toContain('preserveDrawingBuffer: true')
    expect(js).toContain("toDataURL('image/png')")
    expect(js).toContain("img.className = 'thumb-img'")
    expect(js.indexOf('map.remove()')).toBeGreaterThan(-1)
    // The snapshot happens on the first idle, after the points layer is added.
    expect(js.indexOf("map.addLayer")).toBeLessThan(js.indexOf("map.once('idle', snap)"))
  })

  it('processes cards one at a time from a queue; the observer only enqueues', () => {
    expect(js).toContain('queue.push(en.target)')
    expect(js).toContain('await upgrade(thumb, await getLib())')
    // upgrade() never constructs a map outside the sequential drain loop.
    expect((js.match(/new maplibregl\.Map\(/g) ?? []).length).toBe(1)
    expect(js).not.toMatch(/io\.unobserve\(en\.target\)\s*\n\s*getLib\(\)\.then\(\(ml\) => upgrade/)
  })

  it('leaves the fallback in place on failure (finish() without an image only removes the map box)', () => {
    expect(js).toContain('box.remove()')
    expect(js).toContain('setTimeout(() => finish(), 15000)')
  })
})
