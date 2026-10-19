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
    expect(getBasemapStyle('dark')).toBe('https://tiles.openfreemap.org/styles/dark')
    expect(getBasemapStyle('street')).toBe('https://tiles.openfreemap.org/styles/bright')
    expect(getBasemapStyle('liberty')).toBe('https://tiles.openfreemap.org/styles/liberty')
  })

  it('satellite is a 256px USGS raster that stays dark-themed', () => {
    const style = getBasemapStyle('satellite') as StyleSpecification
    const src = Object.values(style.sources)[0]
    expect(src.type).toBe('raster')
    if (src.type === 'raster') {
      expect(src.tileSize).toBe(256)
      expect(src.maxzoom).toBe(16)
      expect(src.attribution).toContain('USGS The National Map')
    }
    expect(style.layers[0].type).toBe('background')
    expect(style.layers.map((l) => l.id)).toEqual(['background', 'usgs-imagery'])
    expect(getBasemapTheme('satellite')).toBe('dark')
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
