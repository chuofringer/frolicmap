// Shared origin/referer guard (extracted from routes/public.ts so the
// internal router — issue #422 — can pair its secret-gated endpoints with
// the same protection every public write endpoint already gets, instead of
// inventing a second mechanism).

// Exact prod/dev allowlist. Read-only endpoints in public.ts additionally
// accept CF Pages preview origins via their own `isAllowedOrigin` layered on
// top of this — that widening is public-endpoint-specific and stays local
// to public.ts.
export const ALLOWED_ORIGINS = ['https://funradar.app', 'http://localhost:5173']

// `extra` is #248 Phase 2's preview-env hook: the preview worker sets
// `PREVIEW_WRITE_ORIGIN` (in `wrangler.toml`'s `[env.preview]` vars) to its
// own CF Pages preview origin, so end-to-end write-path testing (waitlist
// signup, reports, ui-event, …) can run against `funradar-preview` D1
// without loosening prod's write allowlist — prod never sets this var, so
// `extra` is always undefined there and this reduces to the old exact-match
// check.
export function isProdOrigin(origin: string, extra?: string): boolean {
  return ALLOWED_ORIGINS.includes(origin) || (!!extra && origin === extra)
}

// Reject requests whose Origin or Referer is present but on a foreign host.
// Missing is allowed (bookmarks, direct nav, cold-load before SPA boots a
// fetch with an Origin header — and, for the internal router, a plain curl
// call with no Origin/Referer at all). Not strong protection — trivially
// spoofable by a real attacker — but eliminates drive-by scraping from the
// wrong domain and makes intentional curl use stand out in logs.
//
// Referer check uses `new URL(ref).origin` so query-string-only or
// fragment-only referers (e.g. `https://funradar.app?share=X`) compare
// correctly. Prefix-matching `startsWith(a + '/')` missed those.
//
// `isOriginOk` defaults to the exact-allowlist rule (`isProdOrigin`, plus the
// per-request `PREVIEW_WRITE_ORIGIN` env var — #248 Phase 2) so write paths
// keep their pre-#248 behavior with no call-site change in prod, where that
// var is unset. Callers on the read-only surface (public.ts's
// `isAllowedOrigin`) pass their own predicate to additionally accept CF
// Pages preview origins on BOTH the Origin and the Referer-origin check
// (#248 Phase 1).
export function originGuard(
  c: { req: { header: (n: string) => string | undefined }; env: { PREVIEW_WRITE_ORIGIN?: string } },
  isOriginOk: (origin: string) => boolean = (origin) => isProdOrigin(origin, c.env.PREVIEW_WRITE_ORIGIN),
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
