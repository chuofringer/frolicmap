import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  trackGoal,
  trackOutboundClick,
  setAnalyticsRegion,
  trackMetroView,
  trackSessionStart,
  __clearPendingTelemetryForTest,
} from '../analytics'
import { useSessionStore } from '@/stores/useSessionStore'
import { useEngagementStore } from '@/stores/useEngagementStore'

describe('trackGoal', () => {
  beforeEach(() => {
    delete (window as unknown as { _cfBeam?: unknown })._cfBeam
    __clearPendingTelemetryForTest()
  })

  afterEach(() => {
    // Token-less trackGoal calls in this suite land in the pre-session buffer;
    // drop them so a later suite's token mint doesn't flush stale events.
    __clearPendingTelemetryForTest()
  })

  it('no-ops silently when beacon is not loaded', () => {
    expect(() => trackGoal('filter_chip')).not.toThrow()
  })

  it('forwards eventName to window._cfBeam.event when present', () => {
    const event = vi.fn()
    ;(window as unknown as { _cfBeam: { event: typeof event } })._cfBeam = { event }
    trackGoal('popup_open')
    expect(event).toHaveBeenCalledWith({ eventName: 'popup_open' })
  })

  it('bumps eventIntents on Event chip and calendar toggles, not on other contexts (#642)', () => {
    useEngagementStore.setState({ eventIntents: 0 })
    trackGoal('filter_chip', 'playground')
    trackGoal('view_toggle', 'list')
    trackGoal('popup_open', 'some-id')
    expect(useEngagementStore.getState().eventIntents).toBe(0)
    trackGoal('filter_chip', 'event')
    trackGoal('view_toggle', 'calendar')
    expect(useEngagementStore.getState().eventIntents).toBe(2)
  })

  it('collects distinct opened item ids and ignores contextless popup_open (#652)', () => {
    useEngagementStore.setState({ openedItemIds: new Set() })
    const opened = () => useEngagementStore.getState().openedItemIds
    trackGoal('popup_open') // stacked-pin click without chosen item
    expect(opened().size).toBe(0)
    trackGoal('popup_open', 'item-1')
    expect(opened()).toEqual(new Set(['item-1']))
    trackGoal('popup_open', 'item-1') // repeat open of same item
    expect(opened()).toEqual(new Set(['item-1']))
    trackGoal('popup_open', 'item-2')
    expect(opened()).toEqual(new Set(['item-1', 'item-2']))
  })

  it('swallows errors thrown by the beacon', () => {
    ;(window as unknown as { _cfBeam: { event: () => never } })._cfBeam = {
      event: () => { throw new Error('beacon down') },
    }
    expect(() => trackGoal('outbound_click')).not.toThrow()
  })
})

// #481 — trackGoal also persists the goal to D1 via /api/ui-event.
describe('trackGoal → /api/ui-event (#481)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    delete (window as unknown as { _cfBeam?: unknown })._cfBeam
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: 'test-token-abc', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
  })

  it('posts the goal (no context) with the session token', () => {
    trackGoal('near_me')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/ui-event$/)
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer test-token-abc')
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body)).toEqual({ goal: 'near_me' })
  })

  it('includes context when supplied', () => {
    trackGoal('filter_chip', 'playground')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ goal: 'filter_chip', context: 'playground' })
  })

  it('queues goals fired before the session mint and flushes them when the token lands', () => {
    // welcome_gate_view fires at overlay mount, BEFORE POST /api/session has
    // returned on a cold load — the old "no token → drop" rule silently ate
    // the welcome funnel's denominator (2026-07-26 review fix).
    useSessionStore.setState({ token: null, status: 'loading' })
    trackGoal('welcome_gate_view')
    trackGoal('welcome_gate_guest')
    expect(fetchMock).not.toHaveBeenCalled()

    useSessionStore.getState().setSession('fresh-token', 300)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).goal)
    expect(bodies).toEqual(['welcome_gate_view', 'welcome_gate_guest'])
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer fresh-token')

    // Later goals post directly — the queue drained.
    trackGoal('near_me')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('EXCLUDES outbound_click (it has its own table)', () => {
    trackGoal('outbound_click')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('buffers events fired before the token mints and flushes on mint', () => {
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
    trackGoal('share')
    expect(fetchMock).not.toHaveBeenCalled() // no token yet — buffered, not dropped
    useSessionStore.setState({ token: 'minted-later', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/ui-event$/)
    expect(init.headers.authorization).toBe('Bearer minted-later')
    expect(JSON.parse(init.body)).toEqual({ goal: 'share' })
  })

  it('does not throw when fetch rejects', () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(() => trackGoal('view_toggle')).not.toThrow()
  })
})

// 0021 — per-city attribution + the once-per-session metro_view visit signal.
describe('setAnalyticsRegion + metro_view (0021)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    delete (window as unknown as { _cfBeam?: unknown })._cfBeam
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: 'test-token-abc', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
    sessionStorage.clear()
    setAnalyticsRegion(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
    sessionStorage.clear()
    setAnalyticsRegion(null) // reset module state so other suites see no region
  })

  it('attaches the current region to the beacon payload', () => {
    setAnalyticsRegion('seattle')
    trackGoal('near_me')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ goal: 'near_me', region: 'seattle' })
  })

  it('attaches region alongside context', () => {
    setAnalyticsRegion('bay')
    trackGoal('filter_chip', 'playground')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ goal: 'filter_chip', context: 'playground', region: 'bay' })
  })

  it('omits region when off-metro (null)', () => {
    setAnalyticsRegion(null)
    trackGoal('share')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ goal: 'share' })
  })

  it('fires metro_view once per (session, metro)', () => {
    setAnalyticsRegion('bay')
    trackMetroView('bay')
    trackMetroView('bay') // same metro, same session — deduped
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ goal: 'metro_view', region: 'bay' })
  })

  it('fires metro_view again for a different metro', () => {
    setAnalyticsRegion('bay')
    trackMetroView('bay')
    setAnalyticsRegion('seattle')
    trackMetroView('seattle')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ goal: 'metro_view', region: 'seattle' })
  })

  // The cold-load race that zeroed the city-visit dashboard: metro_view fires
  // on map mount BEFORE the session mint completes. It must be buffered and
  // delivered on mint — dropping it loses the visit for the whole session
  // (the sessionStorage dedupe key is already set by then).
  it('delivers a metro_view fired before the session mints (cold load)', () => {
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
    setAnalyticsRegion('austin')
    trackMetroView('austin')
    expect(fetchMock).not.toHaveBeenCalled()
    useSessionStore.setState({ token: 'minted-later', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ goal: 'metro_view', region: 'austin' })
  })

  it('captures the region at fire time, not at flush time', () => {
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
    setAnalyticsRegion('seattle')
    trackGoal('near_me')
    setAnalyticsRegion(null) // e.g. user navigated off-metro before mint finished
    useSessionStore.setState({ token: 'minted-later', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ goal: 'near_me', region: 'seattle' })
  })
})

// session_start — the per-session denominator for /admin/behavior funnel
// rates (gate views had no sessions baseline: 606 welcome_gate_views, no
// "out of how many sessions"). Same guard pattern as metro_view.
describe('trackSessionStart', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    delete (window as unknown as { _cfBeam?: unknown })._cfBeam
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: 'test-token-abc', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
    sessionStorage.clear()
    setAnalyticsRegion(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
    sessionStorage.clear()
    setAnalyticsRegion(null)
  })

  it('fires session_start once per browser session', () => {
    trackSessionStart()
    trackSessionStart() // re-mount / metro switch within the session — deduped
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/ui-event$/)
    expect(JSON.parse(init.body)).toEqual({ goal: 'session_start' })
  })

  it('attaches the current region when one is set', () => {
    setAnalyticsRegion('bay')
    trackSessionStart()
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ goal: 'session_start', region: 'bay' })
  })

  it('does not fire for likely bots (crawlers must not inflate the denominator)', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })
    trackSessionStart()
    expect(fetchMock).not.toHaveBeenCalled()
    // and the dedupe key was NOT burned — a real UA later still logs
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock)
    trackSessionStart()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Same cold-load race as metro_view: App mounts (and fires) before the
  // session token mints; the event must ride the pre-session buffer, not drop
  // (the sessionStorage dedupe key is already set, so a drop loses the whole
  // session from the denominator).
  it('buffers a session_start fired before the session mints', () => {
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
    trackSessionStart()
    expect(fetchMock).not.toHaveBeenCalled()
    useSessionStore.setState({ token: 'minted-later', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ goal: 'session_start' })
  })
})

describe('trackOutboundClick', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: 'test-token-abc', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __clearPendingTelemetryForTest()
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
  })

  it('extracts host from destUrl and posts to /api/outbound-click', () => {
    trackOutboundClick('item-123', 'https://maps.google.com/?q=Foo+Park&ll=37,-122')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/outbound-click$/)
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer test-token-abc')
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body)).toEqual({ itemId: 'item-123', destHost: 'maps.google.com' })
  })

  it('skips silently when destUrl is unparseable', () => {
    trackOutboundClick('item-123', 'not a url')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('buffers a click fired before the token mints and flushes on mint', () => {
    useSessionStore.setState({ token: null, exp: null, status: 'idle', error: null })
    trackOutboundClick('item-123', 'https://example.com/foo')
    expect(fetchMock).not.toHaveBeenCalled()
    useSessionStore.setState({ token: 'minted-later', exp: Date.now() / 1000 + 300, status: 'ready', error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/outbound-click$/)
    expect(JSON.parse(init.body)).toEqual({ itemId: 'item-123', destHost: 'example.com' })
  })

  it('does not throw when fetch rejects', () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(() => trackOutboundClick('item-123', 'https://example.com/foo')).not.toThrow()
  })
})
