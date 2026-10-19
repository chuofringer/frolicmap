import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { makeDetailData } from './panelFixture'
import type { DetailData } from '../useDetailData'
import { useMapStore } from '@/stores/useMapStore'

const holder = vi.hoisted(() => ({ data: null as DetailData | null }))
vi.mock('../useDetailData', () => ({ useDetailData: () => holder.data }))

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
    expect(screen.getByRole('link', { name: 'Report an issue' })).toBeInTheDocument()
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

  it('closes on the × button and on Escape', () => {
    render(<DetailPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useMapStore.getState().selectedId).toBeNull()

    useMapStore.setState({ selectedId: 'pg-1' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useMapStore.getState().selectedId).toBeNull()
  })

  it('Report an issue is a mailto link carrying the item id, name and URL', () => {
    render(<DetailPanel />)
    const link = screen.getByRole('link', { name: 'Report an issue' })
    const href = link.getAttribute('href') ?? ''
    expect(href.startsWith('mailto:frolicmap.official@gmail.com?')).toBe(true)
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    expect(params.get('subject')).toBe('frolicmap report: pg-1')
    const body = params.get('body') ?? ''
    expect(body).toContain('?item=pg-1')
    // Opening the link must not close the panel or open any form.
    expect(screen.queryByRole('heading', { name: 'Report a problem' })).toBeNull()
    expect(useMapStore.getState().selectedId).toBe('pg-1')
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

  it('has no sign-in, newsletter or affiliate surfaces', () => {
    render(<DetailPanel />)
    expect(screen.queryByText(/sign in/i)).toBeNull()
    expect(screen.queryByText(/affiliate/i)).toBeNull()
    expect(screen.queryByText(/newsletter|weekly email/i)).toBeNull()
    // Directions, share and report are always available.
    expect(screen.getByRole('link', { name: 'Google Maps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Report an issue' })).toBeInTheDocument()
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
