import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { makeDetailData } from './panelFixture'
import type { DetailData } from '../useDetailData'
import { useMapStore } from '@/stores/useMapStore'

const holder = vi.hoisted(() => ({ data: null as DetailData | null }))
vi.mock('../useDetailData', () => ({ useDetailData: () => holder.data }))

import { BottomSheet } from '../BottomSheet'

beforeEach(() => {
  holder.data = makeDetailData()
  useMapStore.setState({ selectedId: 'pg-1' })
})
afterEach(() => cleanup())

describe('BottomSheet a11y contract', () => {
  it('is a dialog labelled by the item name', () => {
    render(<BottomSheet />)
    expect(screen.getByRole('dialog', { name: "Koret Children's Playground" })).toBeInTheDocument()
  })

  it('exposes a draggable grabber (role separator) and the eyebrow line', () => {
    render(<BottomSheet />)
    expect(screen.getByRole('separator', { name: 'Drag to resize' })).toBeInTheDocument()
    // Eyebrow is CSS-uppercased; the DOM text keeps the legend's original case.
    expect(screen.getByText(/Playground · 0\.8 mi/)).toBeInTheDocument()
  })

  it('closes on the × button and on Escape', () => {
    render(<BottomSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useMapStore.getState().selectedId).toBeNull()

    useMapStore.setState({ selectedId: 'pg-1' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useMapStore.getState().selectedId).toBeNull()
  })

  it('shows the Open · until chip only when openUntil is set', () => {
    render(<BottomSheet />)
    expect(screen.getByText('Open · until 6 PM')).toBeInTheDocument()
    cleanup()

    holder.data = makeDetailData({ openUntil: null })
    render(<BottomSheet />)
    expect(screen.queryByText(/Open · until/)).toBeNull()
  })

  it('renders a lazy-loaded 140px photo block with attribution when present', () => {
    holder.data = makeDetailData({
      // @ts-expect-error partial detail is fine for this render path
      detail: { photo_url: 'https://cdn/x.jpg', photo_attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)' },
    })
    render(<BottomSheet />)
    const img = screen.getByRole('dialog').querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(screen.getByText('Photo: Jane Doe / Wikimedia Commons (CC BY-SA 4.0)')).toBeInTheDocument()
  })

  it('hides the photo block on an image load error (dead/expired URL never shows a broken-image icon)', () => {
    holder.data = makeDetailData({
      // @ts-expect-error partial detail is fine for this render path
      detail: { photo_url: 'https://cdn/dead.jpg', photo_attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)' },
    })
    render(<BottomSheet />)
    const img = screen.getByRole('dialog').querySelector('img')!
    fireEvent.error(img)
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    expect(screen.queryByText(/^Photo:/)).toBeNull()
  })

  it('renders no photo block and no attribution when photo_url is null', () => {
    render(<BottomSheet />)
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    expect(screen.queryByText(/^Photo:/)).toBeNull()
  })

  it('renders the sticky Google Maps / Apple Maps / Website / Share action row', () => {
    render(<BottomSheet />)
    expect(screen.getByRole('link', { name: 'Google Maps' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apple Maps' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Website' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
  })

  it('collapses to peek on a user map gesture, but not on programmatic moves', () => {
    // A fake MapRef whose getMap() exposes just the on/off surface the sheet
    // subscribes to. Captures the movestart handler so the test can fire it.
    const handlers: Record<string, (e: { originalEvent?: unknown }) => void> = {}
    const fakeMap = {
      on: (ev: string, cb: (e: { originalEvent?: unknown }) => void) => { handlers[ev] = cb },
      off: (ev: string) => { delete handlers[ev] },
    }
    useMapStore.setState({
      mapInstance: { getMap: () => fakeMap } as unknown as ReturnType<typeof useMapStore.getState>['mapInstance'],
    })

    render(<BottomSheet />)
    const sheet = screen.getByRole('dialog', { name: "Koret Children's Playground" })
    const translateY = (el: HTMLElement) =>
      Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? NaN)
    const halfTranslate = translateY(sheet)

    // Programmatic camera move (flyTo — no originalEvent): sheet must not move.
    act(() => handlers['movestart']({}))
    expect(translateY(sheet)).toBe(halfTranslate)

    // User gesture (originalEvent present): sheet yields to peek, i.e. it
    // translates further down than the half snap.
    act(() => handlers['movestart']({ originalEvent: new Event('touchstart') }))
    expect(translateY(sheet)).toBeGreaterThan(halfTranslate)

    useMapStore.setState({ mapInstance: null })
  })

  it('keeps the action row on-screen at the default half snap (counter-translate)', () => {
    // The sheet snaps by translating down with a constant height, so its
    // bottom — where the action row lives — sits below the viewport at
    // peek/half. The row must counter-translate by exactly the sheet's offset
    // or the maps buttons render off-screen (the pre-fix mobile bug).
    render(<BottomSheet />)
    const sheet = screen.getByRole('dialog', { name: "Koret Children's Playground" })
    // Google Maps link → flex row → action-row container.
    const actionRow = screen.getByRole('link', { name: 'Google Maps' }).parentElement!.parentElement!
    const translateY = (el: HTMLElement) =>
      Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? NaN)
    expect(translateY(sheet)).toBeGreaterThan(0)
    expect(translateY(actionRow)).toBe(-translateY(sheet))
  })

  it('has no sign-in or affiliate surfaces; directions, share and report are always available', () => {
    render(<BottomSheet />)
    expect(screen.queryByText(/sign in/i)).toBeNull()
    expect(screen.queryByText(/affiliate/i)).toBeNull()
    expect(screen.getByRole('link', { name: 'Google Maps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report an issue' })).toBeInTheDocument()
  })

  it('shows a try-again button for transient detail failures and retries on click', () => {
    const retryDetail = vi.fn()
    holder.data = makeDetailData({ detailFailed: true, detailRetryable: true, retryDetail })
    render(<BottomSheet />)
    expect(screen.getByText(/Couldn’t load details/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retryDetail).toHaveBeenCalledTimes(1)
  })

  it('keeps the static unavailable line (no retry button) for a non-transient failure', () => {
    holder.data = makeDetailData({ detailFailed: true, detailRetryable: false })
    render(<BottomSheet />)
    expect(screen.getByText(/Details unavailable right now/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})
