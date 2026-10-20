import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useItemDetail } from '../useItemDetail'
import { ItemFetchError } from '@/api/items'
import { useSessionStore } from '@/stores/useSessionStore'

// Hook/fetch layer for the detail panel's lazy fetch: token gate, auth
// header, and that only a real 404 (or the events-gate 401) fails fast while
// other failures get a bounded retry — mirrors useItemCoords.test.tsx.

const fetchMock = vi.fn()

function renderWithClient(id: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  return renderHook(() => useItemDetail(id), {
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

describe('useItemDetail', () => {
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

  it('fetches with an Authorization header and resolves the item', async () => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ item: { id: 'abc' } }) })

    const { result } = renderWithClient('abc')

    await waitFor(() => expect(result.current.data).toEqual({ id: 'abc' }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/items/abc')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('fails fast on a 404 with an ItemFetchError carrying the status', async () => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })

    const { result } = renderWithClient('gone')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeInstanceOf(ItemFetchError)
    expect((result.current.error as ItemFetchError).status).toBe(404)
  })

  it.each([401, 429, 503])('retries a %i (bounded) instead of treating it as gone', async (status) => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) })

    const { result } = renderWithClient('abc')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('tolerates a non-JSON error body', async () => {
    useSessionStore.setState({ token: 'tok' })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })

    const { result } = renderWithClient('abc')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ItemFetchError).status).toBe(502)
  })
})
