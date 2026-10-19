import { describe, it, expect, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { useUrlView } from '../useUrlView'
import { useMapStore } from '@/stores/useMapStore'

function harness(path: string, { strict = false } = {}) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const router = <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    return strict ? <StrictMode>{router}</StrictMode> : router
  }
  return renderHook(
    () => {
      useUrlView()
      const [params] = useSearchParams()
      return params
    },
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  useMapStore.setState({ viewMode: 'map' })
})

describe('useMapStore.viewMode', () => {
  it('defaults to map and can be set', () => {
    expect(useMapStore.getState().viewMode).toBe('map')
    act(() => useMapStore.getState().setViewMode('list'))
    expect(useMapStore.getState().viewMode).toBe('list')
  })
})

describe('useUrlView', () => {
  it('applies ?view=list from the URL to the store', () => {
    harness('/?view=list')
    expect(useMapStore.getState().viewMode).toBe('list')
  })

  it('leaves the default map view when no ?view is present', () => {
    harness('/')
    expect(useMapStore.getState().viewMode).toBe('map')
  })

  it('treats an unknown ?view value as map', () => {
    harness('/?view=grid')
    expect(useMapStore.getState().viewMode).toBe('map')
  })

  it('writes ?view=list to the URL when the store switches to list', () => {
    const { result } = harness('/')
    expect(result.current.get('view')).toBeNull()
    act(() => useMapStore.getState().setViewMode('list'))
    expect(result.current.get('view')).toBe('list')
    act(() => useMapStore.getState().setViewMode('map'))
    expect(result.current.get('view')).toBeNull()
  })

  it('treats an unknown ?view= value (e.g. the retired calendar view) as the map', () => {
    harness('/?view=calendar')
    expect(useMapStore.getState().viewMode).toBe('map')
  })

  // Regression test for #559: React StrictMode double-invokes effects on
  // mount (dev-only). The old `hasSynced` ref-based first-run guard (same
  // pattern as useUrlItem's pre-#543 bug) survived that remount, so the
  // *second* invocation of the state→URL effect no longer counted as
  // "first run" and stripped `?view=` before the store had caught up.
  it('survives a StrictMode double-mount without stripping ?view=list (#559)', () => {
    const { result } = harness('/?view=list', { strict: true })
    expect(useMapStore.getState().viewMode).toBe('list')
    expect(result.current.get('view')).toBe('list')
  })

  it('still syncs view changes to the URL after a StrictMode double-mount', () => {
    const { result } = harness('/', { strict: true })
    expect(result.current.get('view')).toBeNull()
    act(() => useMapStore.getState().setViewMode('list'))
    expect(result.current.get('view')).toBe('list')
    act(() => useMapStore.getState().setViewMode('map'))
    expect(result.current.get('view')).toBeNull()
  })
})
