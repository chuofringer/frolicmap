# CLAUDE.md

## What this is

frolicmap.app is a free, read-only map of kids activities (playgrounds, parks,
libraries, museums, beaches, water play) for US metros. React 19 + TypeScript
(strict) + Vite + MapLibre SPA, served by a Cloudflare Worker (Hono) that reads
Cloudflare D1. Code is MIT; data is not (see the README table).

## Architecture

- `src/`: SPA. Map pins come from session-gated vector tiles; filters and detail
  come from the Worker's read-only `/api/*` endpoints.
- `worker/`: read-only API (items, tiles, session) plus offline import/SEO
  scripts in `worker/scripts/` run by hand or in CI.
- `shared/`: types and the metro registry (`shared/metros.ts`) used by both.
- Docs: `docs/basemaps.md`, `docs/setup-cloudflare.md`, `docs/carve-out-manifest.md`.

## Commands

- Root: `npm ci`, `npm run dev`, `npm run lint && npx tsc -b && npm run test:run`, `npm run build`
- Worker (`cd worker`): `npx tsc --noEmit && npm run test:run && npm run test:mjs`

## Invariants (do not break)

- No admin, no cron, no user accounts, no email. Read-only by design.
- Data is not MIT: keep each source's licence and attribution.
- Keep the "© OpenStreetMap contributors" attribution on the map and every generated page.
- Free/open basemaps only (OpenFreeMap, USGS; see `docs/basemaps.md`). Never
  add a keyed provider or any basemap that needs an account or API key.
- Nominatim is called only when the user presses Enter, never as-you-type.
- `.dev.vars` and any secrets are never committed.
- Never touch Cloudflare resources from an automated session; deploys go through CI.
