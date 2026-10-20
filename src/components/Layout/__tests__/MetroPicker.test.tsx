import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getMetro, type Metro } from '@shared/metros'

// useMetro is the picker's only source of "current metro". Mock it via a
// mutable holder (default Bay) so a test can force a non-Bay current — the one
// input that makes the geolocation *navigate* branch reachable while Bay is the
// only published metro. publishedMetros() / metroForCoords stay real, so the
// listed set and the geo resolution track the actual registry.
const holder = vi.hoisted(() => ({ current: null as Metro | null }))
vi.mock('@/hooks/useMetro', () => ({
  useMetro: () => holder.current,
}))

import { MetroPicker } from '../MetroPicker'
import { useMapStore } from '@/stores/useMapStore'

const BAY = getMetro('bay')!
const SEATTLE = getMetro('seattle')!

const geoError = (code: number) => ({
  code,
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
})

const getCurrentPosition = vi.fn()
const assign = vi.fn()

beforeEach(() => {
  holder.current = BAY
  // The picker's open state is the shared overlay coordinator; reset it so a
  // prior test that left it open doesn't make the next render start open.
  useMapStore.setState({ overlay: null })
  getCurrentPosition.mockReset()
  assign.mockReset()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
  })
})

afterEach(() => cleanup())

const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: /Current city/ }))
}

describe('MetroPicker trigger', () => {
  it('shows the current metro name (short form) in the box', () => {
    render(<MetroPicker />)
    // Bay Area's full label is too long for the box, so it carries a
    // `shortLabel` the trigger prefers; the full name still rides the
    // aria-label for screen readers.
    const trigger = screen.getByRole('button', { name: /Current city: San Francisco Bay Area/ })
    expect(trigger).toHaveTextContent('SF Bay Area')
    expect(trigger).not.toHaveTextContent('Choose your city')
  })

  it('shows a metro without a shortLabel by its full label, and announces it via aria-label', () => {
    holder.current = SEATTLE // Seattle has no shortLabel → falls back to label
    render(<MetroPicker />)
    const trigger = screen.getByRole('button', { name: /Current city: Seattle/ })
    expect(trigger).toHaveTextContent('Seattle')
  })

  it('opens the picker dialog on click', () => {
    render(<MetroPicker />)
    expect(screen.queryByRole('dialog')).toBeNull()
    openPanel()
    expect(screen.getByRole('dialog', { name: 'Choose your city' })).toBeInTheDocument()
  })

  it('renders the dialog at z-50 so it sits above the bar/list/detail surfaces', () => {
    render(<MetroPicker />)
    openPanel()
    // Regression for the visual-pass z-order fix: the dropdown opened under the
    // new z-40 surfaces; it must be z-50 (same tier as FiltersDrawer/ReportModal).
    expect(screen.getByRole('dialog', { name: 'Choose your city' }).className).toContain('z-50')
  })
})

describe('MetroPicker list', () => {
  it('lists only published metros — wave metros present, unpublished Detroit absent', () => {
    render(<MetroPicker />)
    openPanel()
    expect(screen.getByRole('link', { name: /San Francisco Bay Area/ })).toBeInTheDocument()
    // Wave metros are published as of #362.
    expect(screen.getByRole('link', { name: /Seattle/ })).toBeInTheDocument()
    // Detroit (fast-follow) is unpublished; it must never appear in this list.
    expect(screen.queryByText('Detroit')).toBeNull()
  })

  it('renders metro entries as plain <a href> anchors, not router links', () => {
    render(<MetroPicker />)
    openPanel()
    const link = screen.getByRole('link', { name: /San Francisco Bay Area/ })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/cities/bay-area')
  })

  it('caps the panel height and makes only the metro list scroll (footer stays reachable)', () => {
    // Regression for the desktop overflow bug: with 13+ published metros the
    // panel outgrew common desktop viewport heights, pushing the "Browse all
    // cities" footer below the fold on a map page that has no page scroll, so
    // the footer link became unreachable. The fix caps the panel and scrolls
    // ONLY the list. jsdom can't measure layout / actually scroll, so we assert
    // the class contract that produces the behavior rather than pixel heights.
    render(<MetroPicker />)
    openPanel()
    const panel = screen.getByRole('dialog', { name: 'Choose your city' })
    // Panel is height-capped and a flex column so the list can flex-scroll.
    expect(panel.className).toMatch(/max-h-/)
    // The list itself is the scroll region.
    const list = screen.getByRole('link', { name: /San Francisco Bay Area/ }).closest('ul')!
    expect(list.className).toContain('overflow-y-auto')
    expect(list.className).toContain('min-h-0')
  })

  it('keeps the /cities link and drops the coming-soon line once multiple metros are published', () => {
    // The "More cities soon" line was the single-metro affordance;
    // with the wave published (#362) it should be gone, while the browse-all
    // link stays as the permanent path to the index.
    render(<MetroPicker />)
    openPanel()
    expect(screen.queryByText(/More cities soon/)).toBeNull()
    const browse = screen.getByRole('link', { name: /Browse all cities/ })
    expect(browse.getAttribute('href')).toBe('/cities')
  })
})

describe('MetroPicker dismissal', () => {
  it('closes on the close button', () => {
    render(<MetroPicker />)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close city picker' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape', () => {
    render(<MetroPicker />)
    openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('MetroPicker focus trap', () => {
  it('wraps Tab from the last focusable element back to the first, instead of walking out to the map', async () => {
    const user = userEvent.setup()
    render(<MetroPicker />)
    openPanel()
    const dialog = screen.getByRole('dialog', { name: 'Choose your city' })
    const focusable = dialog.querySelectorAll('a[href], button:not([disabled])')
    const last = focusable[focusable.length - 1] as HTMLElement
    const first = focusable[0] as HTMLElement
    last.focus()
    expect(document.activeElement).toBe(last)
    await user.tab()
    expect(document.activeElement).toBe(first)
  })

  it('wraps Shift+Tab from the first focusable element back to the last', async () => {
    const user = userEvent.setup()
    render(<MetroPicker />)
    openPanel()
    const dialog = screen.getByRole('dialog', { name: 'Choose your city' })
    const focusable = dialog.querySelectorAll('a[href], button:not([disabled])')
    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    first.focus()
    expect(document.activeElement).toBe(first)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(last)
  })
})

describe('MetroPicker geolocation', () => {
  it('navigates to a published metro that is not the current one', () => {
    // Force a non-Bay current so a Bay coordinate resolves to a *different*
    // published metro — the navigate path.
    holder.current = SEATTLE
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 37.55, longitude: -122.33 } } as GeolocationPosition),
    )
    render(<MetroPicker />)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(assign).toHaveBeenCalledWith('/cities/bay-area')
  })

  it('just closes when the location is the current metro (no navigation)', () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 37.55, longitude: -122.33 } } as GeolocationPosition),
    )
    render(<MetroPicker />)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(assign).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the Bay Area fallback for a location outside every published metro', () => {
    // Detroit coordinates resolve to the unpublished Detroit metro → fallback.
    // (Seattle graduated from this fixture at the wave launch, #362.)
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 42.33, longitude: -83.05 } } as GeolocationPosition),
    )
    render(<MetroPicker />)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByText(/couldn’t match your location/)).toBeInTheDocument()
    // Dialog stays open so they can pick Bay or browse all cities.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows a message and does not nag when permission is denied', () => {
    getCurrentPosition.mockImplementation((_success: PositionCallback, error: PositionErrorCallback) =>
      error(geoError(1) as GeolocationPositionError),
    )
    render(<MetroPicker />)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByText(/permission was denied/)).toBeInTheDocument()
  })
})

describe('MetroPicker remembers the explicit choice (#17)', () => {
  beforeEach(() => localStorage.removeItem('frolicmap.metro'))

  it('writes the clicked metro slug to frolicmap.metro', () => {
    render(<MetroPicker />)
    openPanel()
    const link = screen.getByRole('link', { name: 'Seattle' })
    link.addEventListener('click', (e) => e.preventDefault()) // jsdom: no real navigation
    fireEvent.click(link)
    expect(localStorage.getItem('frolicmap.metro')).toBe('seattle')
  })

  it('writes the slug when "Use my location" navigates to another metro', () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 47.6, longitude: -122.33 } } as GeolocationPosition),
    )
    render(<MetroPicker />)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(assign).toHaveBeenCalledWith('/cities/seattle')
    expect(localStorage.getItem('frolicmap.metro')).toBe('seattle')
  })
})
