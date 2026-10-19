import { describe, it, expect, beforeEach } from 'vitest'
import { useMapStore } from '../useMapStore'

// Item 1b — single-open overlay coordinator + mutual exclusivity with the
// detail panel/sheet. (The visible-FAQ half is IconBar rendering FAQOverlay when
// `overlay === 'faq'`; here we lock down the state machine that drives it.)
beforeEach(() => {
  useMapStore.setState({ selectedId: null, overlay: null, stackedFeatures: null })
})

describe('overlay coordinator', () => {
  it('opening an overlay closes the detail panel (open detail → open FAQ → detail closed, FAQ open)', () => {
    useMapStore.getState().setSelectedId('pg-1')
    expect(useMapStore.getState().selectedId).toBe('pg-1')

    useMapStore.getState().openOverlay('faq')
    expect(useMapStore.getState().selectedId).toBeNull()
    expect(useMapStore.getState().overlay).toBe('faq')
  })

  it('opening a detail closes any open overlay', () => {
    useMapStore.getState().openOverlay('metro')
    useMapStore.getState().setSelectedId('pg-2')
    expect(useMapStore.getState().overlay).toBeNull()
    expect(useMapStore.getState().selectedId).toBe('pg-2')
  })

  it('only one overlay is open at a time (opening one replaces the other)', () => {
    useMapStore.getState().openOverlay('basemap')
    expect(useMapStore.getState().overlay).toBe('basemap')
    useMapStore.getState().openOverlay('filters')
    expect(useMapStore.getState().overlay).toBe('filters')
  })

  it('closeOverlay(name) only closes when that overlay is the open one', () => {
    useMapStore.getState().openOverlay('legend')
    // A late close from a different (unmounting) popover is a no-op.
    useMapStore.getState().closeOverlay('basemap')
    expect(useMapStore.getState().overlay).toBe('legend')
    useMapStore.getState().closeOverlay('legend')
    expect(useMapStore.getState().overlay).toBeNull()
  })
})
