import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IconBar } from '../IconBar'
import { useMapStore } from '@/stores/useMapStore'

const trackGoal = vi.fn()
vi.mock('@/utils/analytics', () => ({ trackGoal: (n: string) => trackGoal(n), trackOutboundClick: vi.fn() }))

const SUPPORT_HREF = 'https://buymeacoffee.com/funradar.app'
const COFFEE_LABEL = 'Support funradar — Buy Me a Coffee'

// Mobile layout (matches:false → useIsDesktop false). Pass a function to
// answer per query — e.g. desktop (min-width: 768px) true but the panel-shift
// fit query (min-width: 900px) false for the narrow-desktop band.
function stubMatchMedia(matches: boolean | ((query: string) => boolean)) {
  const match = typeof matches === 'function' ? matches : () => matches
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: match(query), addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

const renderBar = () =>
  render(<IconBar />, { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> })

beforeEach(() => {
  stubMatchMedia(false)
  trackGoal.mockClear()
  useMapStore.setState({ overlay: null, selectedId: null, viewMode: 'map' })
})
afterEach(() => cleanup())

describe('IconBar mobile ⋯ expander (revision 5)', () => {
  it('expands and collapses via the overlay coordinator', () => {
    renderBar()
    const dots = screen.getByRole('button', { name: 'More options' })
    fireEvent.click(dots)
    expect(useMapStore.getState().overlay).toBe('menu')
    fireEvent.click(dots)
    expect(useMapStore.getState().overlay).toBeNull()
  })

  it('collapses on Escape and on outside-click', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useMapStore.getState().overlay).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.mouseDown(document.body)
    expect(useMapStore.getState().overlay).toBeNull()
  })

  it('has exactly [map style][FAQ][3D] in the expander row', () => {
    renderBar()
    expect(screen.getByRole('button', { name: 'Toggle 3D view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map style' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Help/ })).toBeInTheDocument() // FAQButton
    expect(screen.queryByRole('button', { name: /suggest/i })).toBeNull()
  })

  it('renders no newsletter envelope link (retired 2026-08-09 — opt-in moved to the sign-in gates)', () => {
    renderBar()
    expect(screen.queryByRole('link', { name: /newsletter/i })).toBeNull()
    // The coffee link is the standalone always-visible button below ⋯ now.
    expect(screen.getByRole('link', { name: COFFEE_LABEL })).toBeInTheDocument()
  })

  it('opening the map-style overlay from the row collapses the menu (mutual exclusivity)', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Map style' }))
    expect(useMapStore.getState().overlay).toBe('basemap')
  })

  it('opening a detail closes the ⋯ expander', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    useMapStore.getState().setSelectedId('pg-1')
    expect(useMapStore.getState().overlay).toBeNull()
  })
})

describe('IconBar vs full-screen surfaces (mobile)', () => {
  // The coffee link sits in a pointer-events-auto wrapper inside the column
  // (the column itself is pointer-events-none — metro-picker ✕ fix), so walk
  // up to the positioned column container rather than the direct parent.
  const column = () => screen.getByRole('link', { name: COFFEE_LABEL }).closest('div.absolute') as HTMLElement

  it('keeps the mobile column mounted while a detail sheet is open, dropped below the z-40 sheet', () => {
    stubMatchMedia(false)
    renderBar()
    expect(column().className).toContain('z-50')
    act(() => useMapStore.setState({ selectedId: 'pg-1' }))
    // Still present (visible beside the peek/half sheet over the map)…
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument()
    // …but below the sheet so the full snap covers it instead of the buttons
    // floating over the card (invisible on a dark basemap, burying its ✕).
    expect(column().className).toContain('z-30')
    expect(column().className).not.toContain('z-50')
  })

  it('hides the mobile column in list and calendar views (panels start above the column bottom)', () => {
    stubMatchMedia(false)
    for (const viewMode of ['list', 'calendar'] as const) {
      useMapStore.setState({ viewMode })
      renderBar()
      expect(screen.queryByRole('button', { name: 'More options' })).toBeNull()
      cleanup()
    }
  })

  it('keeps the desktop icon row mounted while a detail panel is open, shifted aside on wide viewports', () => {
    stubMatchMedia(true)
    useMapStore.setState({ selectedId: 'pg-1' })
    renderBar()
    const row = screen.getByRole('link', { name: COFFEE_LABEL }).parentElement!
    expect(row.className).toContain('-translate-x-[392px]')
    expect(row.className).toContain('z-50')
  })

  it('narrow desktop (768–900px): the row stays put and yields to the panel instead of shifting onto the brand', () => {
    stubMatchMedia((q) => q === '(min-width: 768px)')
    useMapStore.setState({ selectedId: 'pg-1' })
    renderBar()
    const row = screen.getByRole('link', { name: COFFEE_LABEL }).parentElement!
    expect(row.className).not.toContain('-translate-x-[392px]')
    expect(row.className).toContain('z-30')
  })
})

describe('IconBar Buy Me a Coffee support link', () => {
  it('renders the coffee link (external, new-tab, correct href) in the mobile top-right column', () => {
    stubMatchMedia(false) // mobile
    renderBar()
    const coffee = screen.getByRole('link', { name: COFFEE_LABEL })
    expect(coffee).toBeInTheDocument()
    expect(coffee).toHaveAttribute('href', SUPPORT_HREF)
    expect(coffee).toHaveAttribute('target', '_blank')
    expect(coffee).toHaveAttribute('rel', 'noopener noreferrer')
    expect(coffee).toHaveAttribute('title', COFFEE_LABEL)
  })

  it('renders the coffee link first in the desktop icon row (md+)', () => {
    stubMatchMedia(true) // desktop
    renderBar()
    const coffee = screen.getByRole('link', { name: COFFEE_LABEL })
    expect(coffee).toBeInTheDocument()
    expect(coffee).toHaveAttribute('href', SUPPORT_HREF)
    // Leads the row now that the envelope button is gone (2026-08-09).
    expect(coffee.parentElement!.firstElementChild).toBe(coffee)
  })

  it('fires the support_click goal on click (mobile)', () => {
    stubMatchMedia(false)
    renderBar()
    fireEvent.click(screen.getByRole('link', { name: COFFEE_LABEL }))
    expect(trackGoal).toHaveBeenCalledWith('support_click')
  })

  it('fires the support_click goal on click (desktop)', () => {
    stubMatchMedia(true)
    renderBar()
    fireEvent.click(screen.getByRole('link', { name: COFFEE_LABEL }))
    expect(trackGoal).toHaveBeenCalledWith('support_click')
  })
})

describe('IconBar submission entry point', () => {
  it.each([
    ['mobile', false],
    ['desktop', true],
  ] as const)('does not render the submission button on %s', (_layout, desktop) => {
    stubMatchMedia(desktop)
    renderBar()
    expect(screen.queryByRole('button', { name: /suggest/i })).toBeNull()
  })
})
