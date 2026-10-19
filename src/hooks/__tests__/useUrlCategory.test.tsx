import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useUrlCategory } from '../useUrlCategory'
import { useFiltersStore } from '@/stores/useFiltersStore'

const at = (path: string) =>
  renderHook(() => useUrlCategory(), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  })

const categories = () => [...useFiltersStore.getState().categories]

beforeEach(() => {
  useFiltersStore.getState().reset()
})

describe('useUrlCategory', () => {
  it('applies a valid ?cat= as a single-category filter', () => {
    at('/cities/seattle?cat=playground')
    expect(categories()).toEqual(['playground'])
  })

  it('does nothing when no ?cat= is present', () => {
    at('/cities/seattle')
    expect(categories()).toEqual([])
  })

  it('silently ignores an unknown category value', () => {
    at('/cities/seattle?cat=notacategory')
    expect(categories()).toEqual([])
  })

  it('reads the internal DB value, not the URL slug', () => {
    // The locked rule (plan §3.2): query params carry internal vocabulary.
    // `?cat=splash-pads` (the search-term slug) is NOT a DB category, so it is
    // ignored; the real deep link the city page emits is `?cat=waterplay`.
    at('/cities/seattle?cat=splash-pads')
    expect(categories()).toEqual([])

    useFiltersStore.getState().reset()
    at('/cities/seattle?cat=waterplay')
    expect(categories()).toEqual(['waterplay'])
  })

  it('expands a folded category to its full display group (#323)', () => {
    // The combined "Aquarium/Zoo" chip filters both DB values, so the deep
    // link must too — from either member.
    at('/cities/seattle?cat=aquarium')
    expect(categories().sort()).toEqual(['aquarium', 'zoo'])

    useFiltersStore.getState().reset()
    at('/cities/seattle?cat=zoo')
    expect(categories().sort()).toEqual(['aquarium', 'zoo'])
  })

  it('composes with ?item= — reads cat regardless of the other params', () => {
    at('/cities/seattle?cat=park&item=osm-way-1')
    expect(categories()).toEqual(['park'])
  })
})
