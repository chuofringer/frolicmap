import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LegendButton } from '../LegendButton'
import { useMapStore } from '@/stores/useMapStore'
import { useFiltersStore } from '@/stores/useFiltersStore'

const trackGoal = vi.fn()
vi.mock('@/utils/analytics', () => ({ trackGoal: (n: string) => trackGoal(n) }))

// `/` boots the Bay Area metro; `/cities/seattle` boots a wave metro. Every
// category is live in both.
const renderAt = (path = '/') =>
  render(<LegendButton />, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  })

const openLegend = (path = '/') => {
  renderAt(path)
  fireEvent.click(screen.getByRole('button', { name: 'Map legend' }))
}

// Everything that determines the popup's size: panel + row class lists, the
// header/hint text and the row labels. jsdom cannot measure layout, so equal
// snapshots are the testable proxy for "same size every open".
function legendSnapshot() {
  const panel = screen.getByText('Categories').closest('div.absolute') as HTMLElement
  return {
    panelClass: panel.className,
    header: panel.firstElementChild?.textContent,
    rows: Array.from(panel.querySelectorAll('li > button')).map((b) => ({
      cls: b.className,
      text: b.textContent,
    })),
  }
}

beforeEach(() => {
  trackGoal.mockClear()
  useMapStore.setState({ overlay: null, selectedId: null })
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

  it('renders an identical popup on every open (stable size)', () => {
    localStorage.setItem('frolicmap:legend-peeked', '1') // no auto-peek in this test
    renderAt('/cities/seattle')
    const btn = screen.getByRole('button', { name: 'Map legend' })
    fireEvent.click(btn)
    const first = legendSnapshot()
    expect(first.rows).toHaveLength(9)
    expect(first.header).toContain('Tap to filter')
    fireEvent.click(btn)
    expect(screen.queryByText('Categories')).toBeNull()
    fireEvent.click(btn)
    expect(legendSnapshot()).toEqual(first)
    // Row transitions must not animate geometry (`transition-all` did).
    expect(first.rows.every((r) => !/\btransition-all\b/.test(r.cls))).toBe(true)
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

  it('lists every category in a wave metro too (no coming-soon rows)', () => {
    openLegend('/cities/seattle')
    expect(screen.getByRole('button', { name: 'Water Play' })).toBeInTheDocument()
    expect(screen.queryByText(/soon/i)).toBeNull()
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

  it('the peek has the same structure and geometry classes as the opened legend', () => {
    renderAt('/cities/seattle')
    act(() => vi.advanceTimersByTime(1_600))
    const peekSnap = legendSnapshot()
    act(() => vi.advanceTimersByTime(7_100)) // folds away
    expect(screen.queryByText('Categories')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Map legend' }))
    expect(legendSnapshot()).toEqual(peekSnap)
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
