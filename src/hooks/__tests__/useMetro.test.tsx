import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useMetro, isCategoryLive } from '../useMetro'
import { getMetro } from '@shared/metros'

const at = (path: string) =>
  renderHook(() => useMetro(), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  }).result.current

describe('useMetro', () => {
  it('keeps / as the Bay Area map, exactly as before', () => {
    // Plan §3.2: "/ stays the Bay map". Any regression here changes the
    // production homepage.
    expect(at('/').id).toBe('bay')
  })

  it('treats every non-/cities path as the Bay Area', () => {
    // The /cities index itself has no slug, so it falls back to Bay too — it's
    // a static page in production, but the SPA must still boot sanely on it.
    for (const p of ['/signup', '/terms', '/admin', '/anything', '/cities']) {
      expect(at(p).id, p).toBe('bay')
    }
  })

  it('falls back to the Bay Area for an unpublished metro', () => {
    // Detroit (fast-follow) has data loaded but has not passed promote-metro,
    // so the SPA must not present it as live. The API gates it independently
    // (#371), so a hand-typed URL can't reveal the data either way.
    // (Seattle graduated from this fixture when the wave published, #362.)
    expect(getMetro('detroit')!.published).toBe(false)
    expect(at('/cities/detroit').id).toBe('bay')
  })

  it('resolves the wave metros now that they are published (#362)', () => {
    expect(at('/cities/seattle').id).toBe('seattle')
    expect(at('/cities/new-york').id).toBe('new-york')
  })

  it('falls back to the Bay Area for an unknown slug', () => {
    expect(at('/cities/atlantis').id).toBe('bay')
    expect(at('/cities/').id).toBe('bay')
  })

  it('resolves a published metro by its URL slug, not its region id', () => {
    // `bay` is the region id; `bay-area` is the slug. Only the slug appears
    // in a URL.
    expect(at('/cities/bay-area').id).toBe('bay')
    expect(at('/cities/bay').id).toBe('bay')
  })

  it('tolerates a trailing slash', () => {
    expect(at('/cities/bay-area/').id).toBe('bay')
  })
})

describe('isCategoryLive', () => {
  const bay = getMetro('bay')!
  const seattle = getMetro('seattle')!

  it('reports the Bay Area dynamic layers as live', () => {
    for (const c of ['event', 'upick', 'waterplay', 'park']) {
      expect(isCategoryLive(bay, c), c).toBe(true)
    }
  })

  it('reports upick as coming-soon outside Bay; waterplay + Seattle events are live', () => {
    // upick stays a "coming soon" chip outside the depth metro (needs the
    // #436 verification model). waterplay went national 2026-07-21 (#435);
    // 'event' went live in Seattle after the first aggregator batch (#437).
    expect(isCategoryLive(seattle, 'upick')).toBe(false)
    // waterplay went national via the OSM bootstrap (#435).
    expect(isCategoryLive(seattle, 'waterplay')).toBe(true)
    expect(isCategoryLive(seattle, 'event')).toBe(true)
    expect(isCategoryLive(seattle, 'park')).toBe(true)
    // A metro with no approved events keeps the coming-soon chip.
    const detroit = getMetro('detroit')!
    expect(isCategoryLive(detroit, 'event')).toBe(false)
  })
})
