import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { makeDetailData } from './panelFixture'
import type { DetailData } from '../useDetailData'
import { useMapStore } from '@/stores/useMapStore'

const holder = vi.hoisted(() => ({ data: null as DetailData | null }))
vi.mock('../useDetailData', () => ({ useDetailData: () => holder.data }))
// The real card needs QueryClientProvider + Router (its own test covers it);
// here we only assert the panel's gated layout.
vi.mock('../EventUnlockCard', () => ({
  EventUnlockCard: () => <div data-testid="event-unlock-card" />,
}))

import { DetailPanel } from '../DetailPanel'

beforeEach(() => {
  holder.data = makeDetailData()
  useMapStore.setState({ selectedId: 'pg-1', lastStackedFeatures: null })
})
afterEach(() => cleanup())

describe('DetailPanel', () => {
  it('renders as a labelled dialog with the item name and no photo header', () => {
    render(<DetailPanel />)
    const dialog = screen.getByRole('dialog', { name: "Koret Children's Playground" })
    expect(dialog).toBeInTheDocument()
    // No photo in the fixture → compact badge row, no <img>.
    expect(dialog.querySelector('img')).toBeNull()
    // Category badge + title still render.
    expect(screen.getByRole('heading', { name: "Koret Children's Playground" })).toBeInTheDocument()
    expect(screen.getByText('Playground')).toBeInTheDocument()
  })

  it('renders a 200px photo header when photo_url is present', () => {
    holder.data = makeDetailData({
      // @ts-expect-error partial detail is fine for this render path
      detail: { photo_url: 'https://cdn/x.jpg' },
    })
    render(<DetailPanel />)
    const img = screen.getByRole('dialog').querySelector('img')
    expect(img).not.toBeNull()
    // Lazy-loaded: never blocks the panel's initial render on the network.
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('renders the attribution line when photo_attribution is present', () => {
    holder.data = makeDetailData({
      // @ts-expect-error partial detail is fine for this render path
      detail: { photo_url: 'https://cdn/x.jpg', photo_attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)' },
    })
    render(<DetailPanel />)
    expect(screen.getByText('Photo: Jane Doe / Wikimedia Commons (CC BY-SA 4.0)')).toBeInTheDocument()
  })

  it('hides the photo header on an image load error (dead/expired URL never shows a broken-image icon)', () => {
    holder.data = makeDetailData({
      // @ts-expect-error partial detail is fine for this render path
      detail: { photo_url: 'https://cdn/dead.jpg', photo_attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)' },
    })
    render(<DetailPanel />)
    const img = screen.getByRole('dialog').querySelector('img')!
    fireEvent.error(img)
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    expect(screen.queryByText(/^Photo:/)).toBeNull()
  })

  it('omits the attribution line when photo_attribution is absent', () => {
    holder.data = makeDetailData({
      // @ts-expect-error partial detail is fine for this render path
      detail: { photo_url: 'https://cdn/x.jpg', photo_attribution: null,
    has_playground: null },
    })
    render(<DetailPanel />)
    expect(screen.queryByText(/^Photo:/)).toBeNull()
  })

  it('shows both map buttons up front plus Website/Share and a visible Report (no overflow menu)', () => {
    render(<DetailPanel />)
    expect(screen.getByRole('link', { name: 'Google Maps' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apple Maps' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Website' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report an issue' })).toBeInTheDocument()
    // The ⋯ overflow menu is gone.
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull()
  })

  it('keeps both map buttons + Share available with no photo and unresolved detail', () => {
    // Map buttons only need the list item (lat/lng/name); Share always works.
    holder.data = makeDetailData({ detail: undefined, website: null })
    render(<DetailPanel />)
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: 'Google Maps' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apple Maps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    // Website only appears once the lazy detail resolves.
    expect(screen.queryByRole('link', { name: 'Website' })).toBeNull()
  })

  it('shows the affiliate disclosure only when the item carries a tagged link (#254)', () => {
    render(<DetailPanel />)
    // Default fixture: no affiliate rewrite → no disclosure.
    expect(
      screen.queryByText(/Some links are affiliate links/)
    ).toBeNull()
    cleanup()

    holder.data = makeDetailData({ affiliateTagged: true })
    render(<DetailPanel />)
    expect(
      screen.getByText('Some links are affiliate links — funradar may earn a small commission, at no extra cost to you.')
    ).toBeInTheDocument()
  })

  it('closes on the × button and on Escape', () => {
    render(<DetailPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useMapStore.getState().selectedId).toBeNull()

    useMapStore.setState({ selectedId: 'pg-1' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useMapStore.getState().selectedId).toBeNull()
  })

  it('ESC closes the Report modal first without discarding the panel', () => {
    render(<DetailPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }))
    expect(screen.getByRole('heading', { name: 'Report a problem' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    // Report closed, panel (and selection) still open.
    expect(screen.queryByRole('heading', { name: 'Report a problem' })).toBeNull()
    expect(useMapStore.getState().selectedId).toBe('pg-1')
  })

  it('renders the Upcoming dates strip for 2+ siblings', () => {
    holder.data = makeDetailData({
      siblings: [
        { ...makeDetailData().listItem, id: 'pg-1', start_time: '2026-04-11T13:00:00Z' },
        { ...makeDetailData().listItem, id: 'pg-2', start_time: '2026-04-18T13:00:00Z' },
      ],
    })
    render(<DetailPanel />)
    expect(screen.getByText('Upcoming dates')).toBeInTheDocument()
  })

  it('renders a Back to list row when a stacked cluster is remembered', () => {
    useMapStore.setState({
      lastStackedFeatures: { lng: 0, lat: 0, features: [
        { id: 'a', name: 'A', category: 'playground' },
        { id: 'b', name: 'B', category: 'park' },
      ] },
    })
    render(<DetailPanel />)
    expect(screen.getByRole('button', { name: /Back to list \(2 items\)/ })).toBeInTheDocument()
  })

  it('hides the Good to know grid when there are no real facts', () => {
    holder.data = makeDetailData({ goodToKnow: [] })
    render(<DetailPanel />)
    expect(screen.queryByText('Good to know')).toBeNull()
  })

  it('gated event: shows the unlock card, blurs title/WHEN, hides actions/source/siblings', () => {
    // Events sign-in gate (2026-07-26): the footer's actions and the
    // sibling-dates strip would leak the value the card withholds, and the
    // identifying teaser (title, WHEN) renders blurred + aria-hidden.
    holder.data = makeDetailData({
      gated: true,
      listItem: { ...makeDetailData().listItem, type: 'event', name: 'Toddler Storytime' },
      hoursLabel: 'WHEN',
      hoursValue: 'Sat, Aug 1 · 10:00 AM',
      siblings: [
        { ...makeDetailData().listItem, id: 'ev-1', start_time: '2026-08-01T10:00:00-07:00' },
        { ...makeDetailData().listItem, id: 'ev-2', start_time: '2026-08-08T10:00:00-07:00' },
      ],
    })
    render(<DetailPanel />)
    expect(screen.getByTestId('event-unlock-card')).toBeInTheDocument()
    // The dialog label doesn't leak the name to assistive tech either.
    expect(screen.getByRole('dialog', { name: 'Event — sign in to unlock' })).toBeInTheDocument()
    // Title + WHEN render but blurred, unselectable, and aria-hidden.
    const title = screen.getByText('Toddler Storytime')
    expect(title.parentElement!.className).toContain('blur')
    expect(title.parentElement!.className).toContain('select-none')
    expect(screen.getByText('Sat, Aug 1 · 10:00 AM').parentElement!.className).toContain('blur')
    // Withheld: footer actions, source line, sibling dates.
    expect(screen.queryByRole('link', { name: 'Google Maps' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Report an issue' })).toBeNull()
    expect(screen.queryByText('Upcoming dates')).toBeNull()
  })

  it('ungated render never mounts the unlock card', () => {
    render(<DetailPanel />)
    expect(screen.queryByTestId('event-unlock-card')).toBeNull()
  })

  it('shows a try-again button for transient detail failures and retries on click', () => {
    const retryDetail = vi.fn()
    holder.data = makeDetailData({ detailFailed: true, detailRetryable: true, retryDetail })
    render(<DetailPanel />)
    expect(screen.getByText(/Couldn’t load details/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retryDetail).toHaveBeenCalledTimes(1)
  })

  it('disables the try-again button while a retry is in flight', () => {
    holder.data = makeDetailData({ detailFailed: true, detailRetryable: true, detailRetrying: true })
    render(<DetailPanel />)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  })

  it('keeps the static unavailable line (no retry button) for a non-transient failure', () => {
    holder.data = makeDetailData({ detailFailed: true, detailRetryable: false })
    render(<DetailPanel />)
    expect(screen.getByText(/Details unavailable right now/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})
