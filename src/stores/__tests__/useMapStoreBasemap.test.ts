import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('stored basemap id', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('restores a valid stored id', async () => {
    localStorage.setItem('frolicmap.basemap', 'satellite')
    const { useMapStore } = await import('../useMapStore')
    expect(useMapStore.getState().basemap).toBe('satellite')
  })

  it('falls back to light with one warning for a retired stored id', async () => {
    localStorage.setItem('frolicmap.basemap', 'esri')
    const { useMapStore } = await import('../useMapStore')
    expect(useMapStore.getState().basemap).toBe('light')
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('defaults to light when nothing is stored', async () => {
    const { useMapStore } = await import('../useMapStore')
    expect(useMapStore.getState().basemap).toBe('light')
    expect(console.warn).not.toHaveBeenCalled()
  })
})
