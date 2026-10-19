// Shared origin/referer guard for the public router's read-only endpoints
// (session, list, detail, coords, tiles). The Worker has no write path.

// Exact prod/dev allowlist. Read-only endpoints in public.ts additionally
// accept Cloudflare Pages preview origins (`https://<label>.frolicmap.pages.dev`,
// see `PAGES_PREVIEW_ORIGIN_RE` there) via their own `isAllowedOrigin` layered
// on top of this. That widening is public-endpoint-specific and stays local
// to public.ts: write paths never accept preview origins.
export const ALLOWED_ORIGINS = ['https://frolicmap.app', 'http://localhost:5173']

export function isProdOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin)
}

// Reject requests whose Origin or Referer is present but on a foreign host.
// Missing is allowed (bookmarks, direct nav, cold-load before SPA boots a
// fetch with an Origin header, or a plain curl call with no Origin/Referer). Not strong protection — trivially
// spoofable by a real attacker — but eliminates drive-by scraping from the
// wrong domain and makes intentional curl use stand out in logs.
//
// Referer check uses `new URL(ref).origin` so query-string-only or
// fragment-only referers (e.g. `https://frolicmap.app?share=X`) compare
// correctly. Prefix-matching `startsWith(a + '/')` missed those.
//
// `isOriginOk` defaults to the exact-allowlist rule (`isProdOrigin`). Callers
// on the read-only surface (public.ts's `isAllowedOrigin`) pass their own
// predicate to additionally accept CF Pages preview origins on BOTH the
// Origin and the Referer-origin check.
export function originGuard(
  c: { req: { header: (n: string) => string | undefined } },
  isOriginOk: (origin: string) => boolean = isProdOrigin,
): Response | null {
  const origin = c.req.header('origin')
  if (origin && !isOriginOk(origin)) {
    return new Response(JSON.stringify({ error: 'foreign origin' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }
  const referer = c.req.header('referer')
  if (referer) {
    let refererOrigin: string
    try {
      refererOrigin = new URL(referer).origin
    } catch {
      // Unparseable referer — treat as foreign.
      return new Response(JSON.stringify({ error: 'malformed referer' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (!isOriginOk(refererOrigin)) {
      return new Response(JSON.stringify({ error: 'foreign referer' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }
  }
  return null
}
