import { describe, it, expect, afterEach } from 'vitest'
import { boundedFetch, BoundedFetchError } from '../src/utils/boundedFetch'

// Issue #422: `boundedFetch` replaces `fetch(url, { redirect: 'follow' })` +
// unbounded `res.text()` on a caller-controlled URL. These are unit tests
// against a stubbed `globalThis.fetch` — no real network calls.

const realFetch = globalThis.fetch

function stubFetch(handler: (url: string) => Response) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    return Promise.resolve(handler(url))
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('boundedFetch', () => {
  it('returns the body text on a plain 200', async () => {
    stubFetch(() => new Response('hello world'))
    const { res, text } = await boundedFetch('https://example.com/page')
    expect(res.status).toBe(200)
    expect(text).toBe('hello world')
  })

  it('follows a redirect chain under the cap', async () => {
    stubFetch((url) => {
      if (url === 'https://example.com/a') {
        return new Response(null, { status: 302, headers: { location: 'https://example.com/b' } })
      }
      if (url === 'https://example.com/b') {
        return new Response('final page')
      }
      throw new Error(`unexpected url ${url}`)
    })
    const { res, text } = await boundedFetch('https://example.com/a')
    expect(res.status).toBe(200)
    expect(text).toBe('final page')
  })

  it('resolves a relative Location header against the redirecting URL', async () => {
    stubFetch((url) => {
      if (url === 'https://example.com/a') {
        return new Response(null, { status: 301, headers: { location: '/b' } })
      }
      if (url === 'https://example.com/b') {
        return new Response('relative target')
      }
      throw new Error(`unexpected url ${url}`)
    })
    const { text } = await boundedFetch('https://example.com/a')
    expect(text).toBe('relative target')
  })

  it('throws when the redirect chain exceeds maxRedirects', async () => {
    let hops = 0
    stubFetch(() => {
      hops++
      return new Response(null, { status: 302, headers: { location: 'https://example.com/next' } })
    })
    await expect(boundedFetch('https://example.com/start', { maxRedirects: 2 }))
      .rejects.toThrow(BoundedFetchError)
    // maxRedirects=2 allows the initial fetch + 2 follow-ups = 3 fetch calls
    // before the loop gives up on the 3rd redirect it sees.
    expect(hops).toBe(3)
  })

  it('throws on a redirect response with no Location header', async () => {
    stubFetch(() => new Response(null, { status: 302 }))
    await expect(boundedFetch('https://example.com/a')).rejects.toThrow(BoundedFetchError)
  })

  it('throws once the response body exceeds maxBytes, even without a Content-Length hint', async () => {
    stubFetch(() => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          // Keep enqueuing forever — a hostile/streaming upstream with no
          // Content-Length at all. The cap must stop us regardless.
          controller.enqueue(new Uint8Array(1024).fill(65))
        },
      })
      return new Response(stream)
    })
    await expect(boundedFetch('https://example.com/huge', { maxBytes: 2048 }))
      .rejects.toThrow(BoundedFetchError)
  })

  it('does not throw for a body right at the cap', async () => {
    stubFetch(() => new Response(new Uint8Array(10).fill(97)))
    const { text } = await boundedFetch('https://example.com/exact', { maxBytes: 10 })
    expect(text).toBe('a'.repeat(10))
  })
})
