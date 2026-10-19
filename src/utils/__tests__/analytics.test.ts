import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { trackGoal, trackMetroView, trackSessionStart } from '../analytics'

type Beam = { event: ReturnType<typeof vi.fn> }

function setBeam(beam: Beam | undefined) {
  const w = window as unknown as { _cfBeam?: Beam }
  if (beam) w._cfBeam = beam
  else delete w._cfBeam
}

describe('trackGoal', () => {
  beforeEach(() => setBeam(undefined))

  it('no-ops silently when the beacon is not loaded', () => {
    expect(() => trackGoal('filter_chip')).not.toThrow()
  })

  it('forwards eventName to window._cfBeam.event when present', () => {
    const event = vi.fn()
    setBeam({ event })
    trackGoal('popup_open')
    expect(event).toHaveBeenCalledWith({ eventName: 'popup_open' })
  })

  it('swallows errors thrown by the beacon', () => {
    setBeam({
      event: vi.fn(() => {
        throw new Error('beacon blew up')
      }),
    })
    expect(() => trackGoal('filter_chip')).not.toThrow()
  })

  it('never makes a network request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    trackGoal('near_me')
    trackGoal('share')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('trackMetroView', () => {
  let event: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    event = vi.fn()
    setBeam({ event })
  })

  afterEach(() => setBeam(undefined))

  it('fires metro_view once per metro per session', () => {
    trackMetroView('bay')
    trackMetroView('bay')
    expect(event).toHaveBeenCalledTimes(1)
    expect(event).toHaveBeenCalledWith({ eventName: 'metro_view' })
  })

  it('fires again for a different metro', () => {
    trackMetroView('bay')
    trackMetroView('seattle')
    expect(event).toHaveBeenCalledTimes(2)
  })
})

describe('trackSessionStart', () => {
  let event: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    event = vi.fn()
    setBeam({ event })
  })

  afterEach(() => setBeam(undefined))

  it('fires session_start once per browser session', () => {
    trackSessionStart()
    trackSessionStart()
    expect(event).toHaveBeenCalledTimes(1)
    expect(event).toHaveBeenCalledWith({ eventName: 'session_start' })
  })

  it('still fires when sessionStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    trackSessionStart()
    expect(event).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
