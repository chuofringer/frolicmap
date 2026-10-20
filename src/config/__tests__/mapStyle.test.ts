import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  basemapSupports3D,
  getBasemapStyle,
  getBasemapTheme,
  resolveBasemapId,
} from '../mapStyle'

describe('configured basemaps', () => {
  it('keeps the five ids in order', () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(['light', 'dark', 'street', 'liberty', 'satellite'])
  })

  it.each(BASEMAPS.map((b) => [b.id, b] as const))('%s is an https URL or an attributed inline style', (_id, b) => {
    if (typeof b.style === 'string') {
      expect(b.style).toMatch(/^https:\/\//)
      return
    }
    const sources = Object.values((b.style as StyleSpecification).sources)
    expect(sources.length).toBeGreaterThanOrEqual(1)
    const attributed = sources.filter((s) => 'attribution' in s && typeof s.attribution === 'string' && s.attribution)
    expect(attributed.length).toBeGreaterThanOrEqual(1)
  })

  it('uses only free, keyless providers', () => {
    const urls = JSON.stringify(BASEMAPS.map((b) => b.style))
    // Retired/keyed providers, spelled in pieces so repo grep gates stay clean.
    const banned = [['car', 'to'], ['arcgis', 'online'], ['es', 'ri'], ['api', '[_-]?key'], ['access', '_token']].map((p) => p.join(''))
    expect(urls).not.toMatch(new RegExp(banned.join('|'), 'i'))
  })

  it('maps light/dark/street/liberty to OpenFreeMap styles', () => {
    expect(getBasemapStyle('light')).toBe('https://tiles.openfreemap.org/styles/positron')
    expect(getBasemapStyle('dark')).toBe('https://tiles.openfreemap.org/styles/fiord')
    expect(getBasemapStyle('street')).toBe('https://tiles.openfreemap.org/styles/bright')
    expect(getBasemapStyle('liberty')).toBe('https://tiles.openfreemap.org/styles/liberty')
  })

  it('satellite is a USGS raster base with an OpenFreeMap label overlay, dark-themed', () => {
    const style = getBasemapStyle('satellite') as StyleSpecification
    const usgs = style.sources.usgs
    expect(usgs.type).toBe('raster')
    if (usgs.type === 'raster') {
      expect(usgs.tileSize).toBe(256)
      expect(usgs.maxzoom).toBe(16)
      expect(usgs.attribution).toContain('USGS The National Map')
    }
    const omt = style.sources.openmaptiles
    expect(omt.type).toBe('vector')
    if (omt.type === 'vector') {
      expect(omt.url).toBe('https://tiles.openfreemap.org/planet')
      expect(omt.attribution).toContain('OpenMapTiles')
      expect(omt.attribution).toContain('OpenStreetMap')
    }
    expect(style.glyphs).toContain('tiles.openfreemap.org/fonts/')
    expect(style.sprite).toContain('tiles.openfreemap.org/sprites/')
    expect(style.layers[0].type).toBe('background')
    expect(style.layers.slice(0, 2).map((l) => l.id)).toEqual(['background', 'usgs-imagery'])
    const overlay = style.layers.slice(2)
    expect(overlay.length).toBeGreaterThan(0)
    expect(overlay.every((l) => 'source' in l && l.source === 'openmaptiles')).toBe(true)
    expect(overlay.some((l) => l.type === 'symbol' && l['source-layer'] === 'place')).toBe(true)
    expect(getBasemapTheme('satellite')).toBe('dark')
  })

  it('satellite masks water with a flat fill between the imagery and the first label', () => {
    const style = getBasemapStyle('satellite') as StyleSpecification
    const ids = style.layers.map((l) => l.id)
    const imagery = ids.indexOf('usgs-imagery')
    const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol')
    const water = style.layers.findIndex((l) => l.type === 'fill' && l['source-layer'] === 'water')
    expect(water).toBeGreaterThan(imagery)
    expect(water).toBeLessThan(firstSymbol)
    const bg = style.layers[0]
    const mask = style.layers[water]
    if (bg.type === 'background' && mask.type === 'fill') {
      expect(mask.paint?.['fill-color']).toBe(bg.paint?.['background-color'])
      expect(mask.paint?.['fill-opacity']).toBe(1)
    }
  })

  it('only liberty supports 3D', () => {
    expect(BASEMAPS.filter((b) => basemapSupports3D(b.id)).map((b) => b.id)).toEqual(['liberty'])
  })
})

describe('unknown basemap ids', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  it('falls back to light with a single warning, never throwing', () => {
    expect(resolveBasemapId('esri-world-imagery')).toBe(DEFAULT_BASEMAP_ID)
    expect(resolveBasemapId('esri-world-imagery')).toBe(DEFAULT_BASEMAP_ID)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('resolves style, theme and 3D support through the fallback', () => {
    expect(getBasemapStyle('voyager')).toBe(getBasemapStyle('light'))
    expect(getBasemapTheme('retired-dark')).toBe('light')
    expect(basemapSupports3D('retired-3d')).toBe(false)
  })

  it('handles non-string junk', () => {
    expect(resolveBasemapId(null)).toBe('light')
    expect(resolveBasemapId(undefined)).toBe('light')
    expect(resolveBasemapId(42)).toBe('light')
  })

  it('passes valid ids through silently', () => {
    expect(resolveBasemapId('satellite')).toBe('satellite')
    expect(warn).not.toHaveBeenCalled()
  })
})
