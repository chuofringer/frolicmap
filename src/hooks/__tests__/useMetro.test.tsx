import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useMetro } from '../useMetro'
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
    for (const p of ['/terms', '/privacy', '/anything', '/cities']) {
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

describe('useMetro follows router navigation (no page load)', () => {
  it('re-derives the metro when the app navigates between city paths', () => {
    // The picker, the city list and the home redirect all move with
    // `navigate(...)`; the map and the items query key off this value.
    const { result } = renderHook(() => ({ metro: useMetro(), navigate: useNavigate() }), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={['/cities/seattle']}>{children}</MemoryRouter>,
    })
    expect(result.current.metro.id).toBe('seattle')
    act(() => result.current.navigate('/cities/chicago'))
    expect(result.current.metro.id).toBe('chicago')
    act(() => result.current.navigate('/cities'))
    expect(result.current.metro.id).toBe('bay')
  })

  it('resolves the metro under a /zh basename from the unprefixed router path', () => {
    const { result } = renderHook(() => ({ metro: useMetro(), navigate: useNavigate() }), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/zh/cities/seattle']} basename="/zh">{children}</MemoryRouter>
      ),
    })
    expect(result.current.metro.id).toBe('seattle')
    act(() => result.current.navigate('/cities/chicago'))
    expect(result.current.metro.id).toBe('chicago')
  })
})
