# frolicmap

A free map of fun places for families: playgrounds, parks, libraries, museums,
aquariums and zoos, beaches, water play, hiking and campgrounds, across 16 US
metros. Every place comes from open data (OpenStreetMap, IMLS, the National Park
Service, Trust for Public Land ParkServe); nothing is user-submitted.

Live demo: **https://frolicmap.app**

## Architecture

1. **Cloudflare Pages SPA.** React 19, Vite, MapLibre GL, Tailwind; English and
   Simplified Chinese (`/zh`).
2. **Read-only Cloudflare Worker + D1.** Hono. The only routes are
   `POST /api/session`, `GET /api/items.json`, `GET /api/items/:id`,
   `GET /api/items/:id/coords` and `GET /api/tiles/{z}/{x}/{y}.pbf` (plus a
   redirect at `/`). It never writes to D1 except a small per-IP
   enumeration-guard table.
3. **Session-gated vector tiles.** The SPA mints a 5-minute HMAC-signed token
   from `/api/session`; tiles, the list and the detail endpoints require it, and
   are rate-limited per IP and globally (Durable Object).
4. **Offline import scripts.** `worker/scripts/*.mjs` fetch the open datasets on
   your machine, dedupe them and emit SQL files, which you apply to D1 yourself
   with `wrangler d1 execute`.
5. **Prerendered city pages.** `build-seo-pages.mjs` reads D1 at deploy time and
   writes `/cities`, `/cities/{slug}` (the SPA shell with a rewritten head and a
   crawlable fallback), their `/zh` twins and sitemaps into the Pages build.

### No cron, no admin, no accounts

The deployed Worker has no scheduled handler, no admin routes or UI, no email and
no user accounts or sign-in. Data is refreshed by re-running the import scripts by
hand and re-running the *Deploy Pages* workflow; corrections are made with a
hand-written SQL `UPDATE` applied with `wrangler d1 execute`. "Report an issue" on
a place opens a pre-filled `mailto:` link; nothing is posted to the Worker.

## Data sources and licences

| Source | What we use it for | Licence / terms |
| --- | --- | --- |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass API) | Playgrounds, parks, museums, aquariums, zoos, beaches, water play, hiking, campgrounds, some libraries | **ODbL 1.0.** Attribution required: "© OpenStreetMap contributors", linked to the copyright page (shown on the map and in every generated page's footer). Derived databases must stay ODbL. |
| [IMLS](https://www.imls.gov) Public Libraries Survey and Museum Data Files | Libraries and museums | US federal data, public domain. Credit "Institute of Museum and Library Services". The museum files are a retired 2018 snapshot, so those rows default to `pending`. |
| [National Park Service](https://www.nps.gov/subjects/developer/) API | National park units | Public domain. Needs a free API key; credit "National Park Service". |
| [Trust for Public Land ParkServe](https://www.tpl.org/parkserve) | Park polygons and names | Check the ParkServe terms before redistributing a derived dataset. |
| [Wikimedia Commons](https://commons.wikimedia.org) | Optional place photos | Per-photo licence; attribution is stored in `photo_attribution` and shown with the photo. Only Commons hosts are accepted (`shared/photoHost.ts`). |
| CARTO basemap / Esri World Imagery | Map background | CARTO's free tiles are for non-commercial use: a commercial deployment needs its own basemap or a CARTO plan. Esri imagery carries its own attribution string. |

Code is MIT; data is not. Each row carries a `source_type`, and the data is
redistributed under its source's terms, not under the MIT licence.

## Run locally

Needs Node 22.6 or newer (the scripts import the TypeScript in `shared/` directly).

```bash
npm ci                      # frontend dependencies
cd worker && npm ci         # worker + scripts dependencies

# Local D1 (stored under worker/.wrangler). Run from worker/.
npx wrangler d1 migrations apply frolicmap-prod --local

# Local session key: any random string.
echo "SESSION_SIGNING_KEY=$(openssl rand -hex 32)" > .dev.vars

# Terminal 1 (worker/): the API on :8787
npm run dev

# Terminal 2 (repo root): the SPA on :5173, which proxies /api to :8787
cd .. && npm run dev
```

### Import one metro locally

```bash
# Seattle's OpenStreetMap places, fetched from Overpass into the local D1
# (serial and throttled, so allow a while; be polite to Overpass).
node worker/scripts/ingest-osm-national.mjs --metro seattle --apply-local
```

Then open http://localhost:5173/cities/seattle. Only *published* metros
(`published: true` in `shared/metros.ts`) are served by the API. The Bay Area is
skipped by every script unless you pass `--include-bay`.

Checks, the same ones CI runs:

```bash
npm run lint && npx tsc -b && npm run test:run     # repo root
cd worker && npx tsc --noEmit && npm run test:run && npm run test:mjs
```

## Load data

The scripts live in `worker/scripts/`. **Each one only writes files**; it never
changes a database. The SQL it emits is applied by you with
`npx wrangler d1 execute frolicmap-prod --local|--remote --file <file>` (run from
`worker/`; each script prints the exact command when it finishes). Run them in
this order:

1. **`ingest-osm-national.mjs`** queries Overpass per metro and category and writes one
   SQL file per metro under `data/osm-national/`. Resumable. Rows land
   `approved` at confidence `medium`.
2. **`seed-imls-libraries.mjs`** and **`seed-imls-museums.mjs`** turn the IMLS CSV
   downloads (`--csv <file>`) into SQL (`data/imls/`). Museum rows are `pending`
   unless you pass `--status approved`.
3. **`seed-parkserve.mjs`** queries the ParkServe ArcGIS feature service per metro and writes
   park SQL (`data/parkserve/`).
4. **`seed-nps.mjs`** fetches NPS park units (`NPS_API_KEY` or `--json <file>`) into
   `data/nps/nps.sql`.
5. **`dedup-national.mjs`** reads a D1 (`--local` or `--remote`) and writes SQL that
   archives cross-source duplicates and marks places confirmed by two sources.
6. **`qa-metro.mjs`** read-only sanity checks on a metro's rows (coordinates in bounds,
   centroid pile-ups, category floors, name quality, page thresholds). Exits non-zero on failure.
7. **`promote-metro.mjs`** runs QA, then (with `--yes`) flips `published: true` for the
   metro in `shared/metros.ts`. Commit and push to deploy.
8. **`build-seo-pages.mjs`** (`npm run seo:remote` after `npm run build`) reads
   published metros from D1 and writes the city pages and sitemaps into `dist/`.
   In production the *Deploy Pages* workflow runs it.

Optional clean-ups: `name-waterplay.mjs` (names for unnamed splash pads),
`backfill-photos.mjs` (Commons photos) and `backfill-addresses.mjs` (reverse
geocoding; see the policy note at the top of that file, a bulk run needs a
self-hosted Nominatim via `NOMINATIM_URL`).

## Deploy

Operator runbook for a domain already on Cloudflare: [docs/setup-cloudflare.md](docs/setup-cloudflare.md).

## Contact

frolicmap.official@gmail.com

## Licence

Code: MIT, Copyright (c) 2026 frolicmap contributors (see [LICENSE](LICENSE)).
Data: not MIT, see the table above.

The original carve-out plan is kept as history in
[docs/carve-out-manifest.md](docs/carve-out-manifest.md).
