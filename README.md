<p align="center"><img src="public/logo.png" alt="frolicmap logo" width="120"></p>

# frolicmap

A free map of kids' activities across 15 US metros: playgrounds, parks,
libraries, museums, zoos and aquariums, beaches, water play, hiking and
campgrounds. Live at **https://frolicmap.app**.

Developed by [vibemapper](https://vibemapper.dev).

## What it is

- Read-only. No accounts, no admin, no cron, no email, no user submissions.
- Every place comes from open data (see the table below).
- Free and open basemaps only (OpenFreeMap, USGS). No API keys, no keyed providers. See [docs/basemaps.md](docs/basemaps.md).
- Address search calls Nominatim only when the user presses Enter, never as you type.
- Code is MIT. The data is not.

## Architecture

1. **Cloudflare Pages SPA.** React 19, Vite, MapLibre GL, Tailwind. English, plus a Simplified Chinese version at `/zh`.
2. **Read-only Worker + D1.** Hono. Serves `/api/*` (session, items, tiles) and never writes place data.
3. **Session-gated vector tiles.** The SPA gets a short-lived signed token from `/api/session`. Tiles and item endpoints require it and are rate-limited.
4. **Offline import scripts.** `worker/scripts/*.mjs` fetch open datasets and write SQL. You apply the SQL to D1 yourself.
5. **Prerendered city pages.** `build-seo-pages.mjs` writes `/cities/{slug}`, their `/zh` twins and sitemaps at deploy time.

## Data sources and licences

| Source | What we use it for | Licence / terms |
| --- | --- | --- |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass API) | Playgrounds, parks, museums, aquariums, zoos, beaches, water play, hiking, campgrounds, some libraries | **ODbL 1.0.** Attribution required: "© OpenStreetMap contributors", linked to the copyright page (shown on the map and in every generated page's footer). Derived databases must stay ODbL. |
| [IMLS](https://www.imls.gov) Public Libraries Survey and Museum Data Files | Libraries and museums | US federal data, public domain. Credit "Institute of Museum and Library Services". The museum files are a retired 2018 snapshot, so those rows default to `pending`. |
| [National Park Service](https://www.nps.gov/subjects/developer/) API | National park units | Public domain. Needs a free API key; credit "National Park Service". |
| [Wikimedia Commons](https://commons.wikimedia.org) | Optional place photos | Per-photo licence; attribution is stored in `photo_attribution` and shown with the photo; each credit links to the Commons file page and the photo's licence. |
| [OpenFreeMap](https://openfreemap.org) | Map background (Light, Dark, Street, Liberty 3D) and the labels, roads and water mask on the Satellite hybrid | OpenMapTiles schema; data © OpenStreetMap contributors (ODbL). Free, no key, [self-hostable](docs/basemaps.md). Attribution shown on the map. |
| [USGS The National Map](https://www.usgs.gov/core-science-systems/national-geospatial-program/national-map) imagery | Satellite basemap and city-card thumbnails | US government work, public domain; no key. Credit "USGS The National Map" shown on the map. |

Code is MIT; data is not. Each row has a `source_type` and is redistributed
under its source's terms.

ParkServe (Trust for Public Land) is not used: its terms allow personal, non-commercial use only and forbid redistribution without written consent.

### Data and ODbL

The database is rebuilt from the open sources above by the import scripts in
this repository. OpenStreetMap-derived rows remain under the ODbL, and the
import scripts are the reproducible way to obtain them. Bulk extracts are not
published separately.

## Run locally

Needs Node 22.6 or newer.

```bash
npm ci                      # frontend
cd worker && npm ci         # worker and scripts

# Local D1, then a random session key (run from worker/)
npx wrangler d1 migrations apply frolicmap-prod --local
echo "SESSION_SIGNING_KEY=$(openssl rand -hex 32)" > .dev.vars

npm run dev                 # worker/: API on :8787
cd .. && npm run dev        # repo root: SPA on :5173, proxies /api to :8787
```

Load one metro to see pins (slow and throttled; be polite to Overpass):

```bash
node worker/scripts/ingest-osm-national.mjs --metro seattle --apply-local
```

Open http://localhost:5173/cities/seattle. Only metros with `published: true`
in `shared/metros.ts` are served.

Checks, the same ones CI runs:

```bash
npm run lint && npx tsc -b && npm run test:run                    # repo root
cd worker && npx tsc --noEmit && npm run test:run && npm run test:mjs
```

## Load data

Each script in `worker/scripts/` only writes files. Apply the SQL it emits with
`npx wrangler d1 execute frolicmap-prod --local|--remote --file <file>` from
`worker/`; each script prints the exact command when it finishes. In order:

1. `ingest-osm-national.mjs`: OpenStreetMap places per metro (`--metro <id>` or `--wave`).
2. `seed-imls-libraries.mjs`, `seed-imls-museums.mjs`: IMLS CSVs (`--csv <file>`).
3. `seed-nps.mjs`: NPS park units (`NPS_API_KEY` or `--json <file>`).
4. `dedup-national.mjs`: SQL that archives cross-source duplicates (reads D1 via `--local` or `--remote`).
5. `qa-metro.mjs`: read-only sanity checks on a metro. Exits non-zero on failure.
6. `promote-metro.mjs`: runs QA, then with `--yes` sets `published: true` in `shared/metros.ts`. Commit and push to publish.

```bash
node worker/scripts/promote-metro.mjs --metro seattle --remote --yes
```

Optional: `name-waterplay.mjs`, `backfill-photos.mjs`, `backfill-addresses.mjs`
(read its header first: bulk geocoding needs a self-hosted Nominatim).

OpenStreetMap-derived places are a Derived Database under the ODbL 1.0: `node worker/scripts/export-odbl.mjs [--remote]` writes every approved OSM row to `data/export/items-osm.csv` with a `README.txt` carrying the ODbL notice and the '© OpenStreetMap contributors' attribution.

## Deploy

GitHub Actions deploys on push to `main`. After loading data
into D1, regenerate the city pages by running **Deploy Pages** by hand
(Actions > Deploy Pages > Run workflow). First-time setup:
[docs/setup-cloudflare.md](docs/setup-cloudflare.md). Basemaps:
[docs/basemaps.md](docs/basemaps.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Contact

frolicmap.official@gmail.com

## Licence

Code: MIT, Copyright (c) 2026 frolicmap contributors (see [LICENSE](LICENSE)).
Data: not MIT; see the table above.
