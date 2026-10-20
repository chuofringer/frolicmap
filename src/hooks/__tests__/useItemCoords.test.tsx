import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useItemCoords } from '../useItemCoords'
import { useSessionStore } from '@/stores/useSessionStore'

// `useItemCoords` backs `useUrlItem`'s `?item=<id>` fly-to lookup — see
// that hook's own tests for the URL-state interplay. These tests cover the
// hook/fetch layer in isolation: the token-presence gate, the Authorization
// header, and (the reason this file exists) that a 404 fails fast while
// every other failure gets a bounded retry rather than being misread as
// "item's gone."

const fetchMock = vi.fn()

function renderWithClient(id: string | null) {
  // retryDelay: 0 so the retry-path tests don't wait out the real
  // (1s/2s/…) exponential backoff — `retry` itself is set inside the hook
  // and is what's under test here.
  const qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  return renderHook(() => useItemCoords(id), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useSessionStore.setState({ token: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useItemCoords', () => {
  it('does not fetch when there is no session token yet', async () => {
    renderWithClient('abc')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fetch when id is null', async () => {
    useSessionStore.setState({ token: 'tok' })
    renderWithClient(null)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches with an Authorization header once a token is present, and resolves lat/lng', async () => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ lat: 37.9, lng: -121.7 }) })

    const { result } = renderWithClient('abc')

    await waitFor(() => expect(result.current.data).toEqual({ lat: 37.9, lng: -121.7 }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/items/abc/coords')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('fails fast on a 404 — no retry (stale share link, retrying cannot help)', async () => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    const { result } = renderWithClient('gone')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 401 (e.g. a token mid-refresh) instead of treating it as a stale link', async () => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({ ok: false, status: 401 })

    const { result } = renderWithClient('abc')

    // retry: failureCount < 2 → 1 initial attempt + 2 retries = 3 calls
    // before isError settles.
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries a 429 (shared rate budget) the same as other transient failures', async () => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({ ok: false, status: 429 })

    const { result } = renderWithClient('abc')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
