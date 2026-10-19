import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LegendButton } from '../LegendButton'
import { useMapStore } from '@/stores/useMapStore'
import { useFiltersStore } from '@/stores/useFiltersStore'

const trackGoal = vi.fn()
vi.mock('@/utils/analytics', () => ({ trackGoal: (n: string) => trackGoal(n) }))

// `/` boots the Bay Area metro (every category live); `/cities/seattle` boots a
// wave metro where U-Pick is coming-soon.
const renderAt = (path = '/') =>
  render(<LegendButton />, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  })

const openLegend = (path = '/') => {
  renderAt(path)
  fireEvent.click(screen.getByRole('button', { name: 'Map legend' }))
}

beforeEach(() => {
  trackGoal.mockClear()
  useMapStore.setState({ overlay: null, selectedId: null, waitlistIntent: null })
  useFiltersStore.setState({ categories: new Set() })
})
afterEach(() => cleanup())

describe('LegendButton (revision 4 — standalone on all sizes)', () => {
  it('opens the legend popover through the overlay coordinator', () => {
    renderAt()
    expect(screen.queryByText('Categories')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Map legend' }))
    expect(useMapStore.getState().overlay).toBe('legend')
    expect(screen.getByText('Categories')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Playground' })).toBeInTheDocument()
  })

  it('closes other overlays and the detail panel when opened', () => {
    useMapStore.setState({ overlay: 'faq', selectedId: 'pg-1' })
    renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Map legend' }))
    expect(useMapStore.getState().overlay).toBe('legend')
    expect(useMapStore.getState().selectedId).toBeNull()
  })

  it('toggles closed on a second tap', () => {
    renderAt()
    const btn = screen.getByRole('button', { name: 'Map legend' })
    fireEvent.click(btn)
    expect(useMapStore.getState().overlay).toBe('legend')
    fireEvent.click(btn)
    expect(useMapStore.getState().overlay).toBeNull()
  })
})

describe('LegendButton — tappable category filters (revision 6)', () => {
  it('shows the "Tap to filter" affordance hint in the header', () => {
    openLegend()
    expect(screen.getByText('Tap to filter')).toBeInTheDocument()
  })

  it('a row tap toggles the category and fires the filter_chip goal', () => {
    openLegend()
    const playground = screen.getByRole('button', { name: 'Playground' })
    // Empty set = every category on.
    expect(playground).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(playground)
    expect(useFiltersStore.getState().categories.has('playground')).toBe(true)
    expect(trackGoal).toHaveBeenCalledWith('filter_chip')
  })

  it('aria-pressed reflects the toggled-off filter state', () => {
    // Only 'park' selected → 'playground' is toggled off.
    useFiltersStore.setState({ categories: new Set(['park']) })
    openLegend()
    expect(screen.getByRole('button', { name: 'Park' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Playground' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the popover open across row toggles (users toggle several at once)', () => {
    openLegend()
    fireEvent.click(screen.getByRole('button', { name: 'Playground' }))
    fireEvent.click(screen.getByRole('button', { name: 'Park' }))
    expect(useMapStore.getState().overlay).toBe('legend')
    expect(screen.getByText('Categories')).toBeInTheDocument()
  })

  it('a coming-soon row arms the waitlist (does not toggle a filter)', () => {
    // Seattle: U-Pick is not a live category → coming-soon treatment.
    openLegend('/cities/seattle')
    const upick = screen.getByRole('button', { name: /U-Pick Farm — coming soon/ })
    fireEvent.click(upick)
    expect(trackGoal).toHaveBeenCalledWith('coming_soon_tap')
    expect(useMapStore.getState().waitlistIntent).toEqual({ category: 'upick', metro: 'seattle' })
    expect(useFiltersStore.getState().categories.has('upick')).toBe(false)
  })
})

// #643 — first-mobile-visit auto-peek. jsdom's matchMedia never matches
// `(min-width: 768px)`, so these tests run as the mobile breakpoint.
describe('LegendButton — first-visit auto-peek (#643)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('peeks the legend once after the delay, then folds back to the button', () => {
    renderAt()
    expect(screen.queryByText('Categories')).toBeNull()
    act(() => vi.advanceTimersByTime(1_600))
    expect(screen.getByText('Categories')).toBeInTheDocument()
    // Not a real open — the overlay coordinator stays unclaimed.
    expect(useMapStore.getState().overlay).toBeNull()
    act(() => vi.advanceTimersByTime(7_100))
    expect(screen.queryByText('Categories')).toBeNull()
  })

  it('only ever peeks once per device (localStorage flag)', () => {
    renderAt()
    act(() => vi.advanceTimersByTime(7_000))
    cleanup()
    renderAt()
    act(() => vi.advanceTimersByTime(7_000))
    expect(screen.queryByText('Categories')).toBeNull()
  })

  it('the peek is compact: live rows only, no coming-soon rows, no tap-to-filter hint', () => {
    // Seattle: U-Pick is coming-soon there — the peek must not list it.
    renderAt('/cities/seattle')
    act(() => vi.advanceTimersByTime(1_600))
    expect(screen.getByText('Categories')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Playground' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /coming soon/ })).toBeNull()
    expect(screen.queryByText('Tap to filter')).toBeNull()
  })

  it('a tap on the peeked panel promotes it to a real legend open', () => {
    renderAt()
    act(() => vi.advanceTimersByTime(1_600))
    fireEvent.pointerDown(screen.getByText('Categories'))
    expect(useMapStore.getState().overlay).toBe('legend')
    // The auto-collapse no longer applies once promoted.
    act(() => vi.advanceTimersByTime(6_000))
    expect(screen.getByText('Categories')).toBeInTheDocument()
  })

  it('never peeks on top of an open detail view', () => {
    useMapStore.setState({ selectedId: 'pg-1' })
    renderAt()
    act(() => vi.advanceTimersByTime(7_000))
    expect(screen.queryByText('Categories')).toBeNull()
  })
})
