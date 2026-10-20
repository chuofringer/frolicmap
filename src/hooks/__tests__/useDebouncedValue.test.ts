import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from '../useDebouncedValue'

// Debounce exists to keep search-as-you-type off Nominatim's back: the OSM
// usage policy caps clients at 1 req/s and explicitly prohibits raw
// autocomplete traffic. The geocode query must only see the settled value.

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 400))
    expect(result.current).toBe('hello')
  })

  it('holds the old value until the delay elapses, then updates', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(399) })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('ab')
  })

  it('collapses rapid changes to the last value', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 400),
      { initialProps: { value: 'g' } },
    )
    // Simulate typing "golden gate" one keystroke every 100ms — the timer
    // restarts each time, so no intermediate value ever surfaces.
    for (const v of ['go', 'gol', 'gold', 'golden']) {
      act(() => { vi.advanceTimersByTime(100) })
      rerender({ value: v })
    }
    expect(result.current).toBe('g')
    act(() => { vi.advanceTimersByTime(400) })
    expect(result.current).toBe('golden')
  })
})
