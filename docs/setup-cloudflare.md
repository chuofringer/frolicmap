# Cloudflare setup runbook

For an operator whose domain (`frolicmap.app`) is already on Cloudflare. Follow
the steps in order. Commands run from the repository root unless a step says
`cd worker`.

**What needs the Cloudflare dashboard and cannot be scripted from this repo:**
creating the API token and the `production` GitHub environment (step 7),
attaching the Pages custom domain and the `www` redirect (step 6), the
placeholder DNS record for `api` if your zone has none (step 5). Everything else is a command below. Nothing in this repository calls
Cloudflare on its own: every command is run by you, and the only things that run
automatically are the GitHub Actions workflows (CI, plus the two deploy
workflows).

## 1. Log in

```bash
cd worker
npm ci
npx wrangler login        # opens a browser; choose the Cloudflare account that owns frolicmap.app
npx wrangler whoami       # note the Account ID, you need it in step 7
```

## 2. The D1 database

The `frolicmap-prod` database already exists for this deployment, and its
`database_id` is committed in `worker/wrangler.toml` (a D1 id is an identifier,
not a secret), so there is nothing to create or paste. If you are running your
own fork, create your own database and replace the id:

```bash
npx wrangler d1 create frolicmap-prod
```

Copy the `database_id` it prints over the existing one in `worker/wrangler.toml`
and commit the change:

```toml
[[d1_databases]]
binding = "DB"
database_name = "frolicmap-prod"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## 3. Apply the schema

```bash
cd worker        # skip if you are already in worker/
npx wrangler d1 migrations apply frolicmap-prod --remote
```

This creates `items` and `id_fetch_watch` (single migration `0001_init.sql`).
The *Deploy Worker* workflow runs the same command on every push to `main` that
touches the worker, so later schema changes ship by adding a new numbered file
to `worker/migrations/`.

## 4. Set the session signing key

The Worker mints and verifies 5-minute session tokens with an HMAC key. Until it
is set, `POST /api/session` answers 503 and the map shows no pins.

```bash
openssl rand -hex 32 | npx wrangler secret put SESSION_SIGNING_KEY
```

The Worker does not exist yet on a first run, so wrangler asks whether to create
a Worker called `frolicmap-api` to hold the secret: answer yes. Step 5 then
deploys the code to it.

Rotating the key later logs every open browser tab out of its session (they
re-mint within seconds); there is no stored user state to lose.

## 5. Deploy the Worker and give it DNS

```bash
npx wrangler deploy
```

`wrangler.toml` declares two routes, `api.frolicmap.app/*` and
`frolicmap.app/api/*` (zone `frolicmap.app`), the four rate-limit bindings
(`ITEMS_RATE_LIMITER`, `ITEMS_DETAIL_RATE_LIMITER`, `ITEMS_TILES_RATE_LIMITER`
and `SESSION_RATE_LIMITER`, one budget per endpoint family) and the
`RateLimiterDO` Durable Object (created by the `v1-rate-limiter-do` migration
inside the same deploy).

`workers_dev = false` and `preview_urls = false` are set, so the Worker has no
`*.workers.dev` hostname and no per-version preview URLs: those two routes are the
only way in. That is why the DNS record below matters, and why a smoke check
against a `workers.dev` URL will not work.

**Dashboard step (DNS).** A Workers route only receives traffic for a hostname
that has a *proxied* (orange cloud) DNS record. In the dashboard open
DNS > Records for `frolicmap.app` and check:

- `api`: if the zone has no `api` record, add a proxied placeholder, either
  `AAAA api 100::` or `A api 192.0.2.1`. The address is never contacted; the
  Worker answers at the edge.
- the apex `frolicmap.app`: it gets its proxied record automatically in step 6
  when you attach the Pages custom domain. Until then `frolicmap.app/api/*` will
  not resolve.

## 6. Create the Pages project and attach the domain

Create the project once. It is a direct-upload project: do **not** connect it to
Git in the dashboard, because a Git-integration build would race the workflow
and its output has none of the generated city pages (the Pages build container
cannot read D1).

```bash
npx wrangler pages project create frolicmap --production-branch main
```

The *Deploy Pages* workflow (`.github/workflows/deploy-pages.yml`) builds the
SPA, generates the city pages from remote D1 and uploads `dist/` with
`wrangler pages deploy`. It runs on every push to `main` and by hand
(Actions > Deploy Pages > Run workflow); there is no schedule.

**Dashboard step (custom domain).** Workers & Pages > `frolicmap` > Custom
domains > *Set up a custom domain*: add `frolicmap.app`, then add `www.frolicmap.app`.
Cloudflare creates the proxied DNS records.

**Dashboard step (www redirect).** Rules > Redirect Rules > *Create rule*
(Single Redirect), custom filter expression `http.host eq "www.frolicmap.app"`,
type *Dynamic*, expression
`concat("https://frolicmap.app", http.request.uri.path)`, status code 301,
*Preserve query string* on.

`public/_headers` is copied into `dist/` by the build and gives Cloudflare Pages
the security headers for every response, including a Content-Security-Policy
that allow-lists the basemap, geocoder, photo and analytics hosts the app uses;
add a host there if you add a new external one.

HSTS (`Strict-Transport-Security: max-age=31536000`, without
`includeSubDomains` or `preload`) is set by that same `_headers` file, so no
zone-level HSTS setting in the Cloudflare dashboard is required. Leave the
zone-level setting off unless you deliberately want it to cover other
subdomains.

## 7. GitHub secrets and the `production` environment

Both deploy workflows run their deploy job in a GitHub environment named
`production` (`environment: production`), and only on `main`. **The environment
must exist before the first deploy.** Create it in the GitHub repository under
Settings > Environments > *New environment* > `production`, then under
*Deployment branches and tags* choose *Selected branches and tags* and add
`main`. GitHub creates a missing environment on first use, but without the
branch restriction. Only the owner can do this; nothing in the repository
creates it.

Then add the secrets: Settings > Secrets and variables > Actions > New
repository secret (or, to scope them to deploys only, add them as environment
secrets on `production`).

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The Account ID from `wrangler whoami` (or the dashboard sidebar). |
| `CLOUDFLARE_API_TOKEN` | A token created in the dashboard (My Profile > API Tokens > Create Token > *Create Custom Token*) with **Account** permissions: *Workers Scripts: Edit*, *D1: Edit*, *Cloudflare Pages: Edit*, *Account Settings: Read*. Scope it to this account. |
| `VITE_CF_BEAM_TOKEN` | Optional. The Cloudflare Web Analytics beacon token. If unset, the build strips the beacon tag. |

Because `wrangler.toml` declares routes, `wrangler deploy` also calls the zone's
Workers Routes API. If *Deploy Worker* fails with an authentication error on the
routes step, add **Zone** permissions *Workers Routes: Edit* and *Zone: Read* for
the `frolicmap.app` zone to the same token.

Pushing to `main` then runs *CI*, *Deploy Worker* (migrations, then
`wrangler deploy`) and *Deploy Pages*. The first push needs the data from step 8
before the city pages have anything to show.

## 8. First data load, one metro end to end

Seattle is used as the example (it is `published: true` in `shared/metros.ts`).
Needs Node 22.6 or newer. Every script only writes SQL files under `data/`; you
apply them.

```bash
# From the repository root.
npm ci && (cd worker && npm ci)

# 1. OpenStreetMap places for the metro (serial and throttled; allow a while).
node worker/scripts/ingest-osm-national.mjs --metro seattle
#    -> writes data/osm-national/seattle.sql and prints the apply command

# 2. Apply it to the REMOTE database. Review the SQL first: rows land approved.
cd worker
npx wrangler d1 execute frolicmap-prod --remote --file ../data/osm-national/seattle.sql

# 3. Optional extra sources for the same metro (seed-imls-*.mjs, seed-nps.mjs;
#    each writes SQL, then apply it the same way). IMLS needs the CSV downloaded
#    first; NPS needs NPS_API_KEY.
cd ..

# 4. De-duplicate across sources (reads remote D1, writes SQL, then apply it).
node worker/scripts/dedup-national.mjs --metro seattle --remote
(cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ../data/dedup/seattle.sql)

# 5. QA gate: read-only, exits non-zero if the metro is not ready.
node worker/scripts/qa-metro.mjs --metro seattle --remote
```

The API serves a metro only when it is `published: true` in `shared/metros.ts`,
and its `/cities/{slug}` page is generated only when it also has at least 50
approved places. To publish another metro, run `node worker/scripts/promote-metro.mjs --metro <id> --remote --yes`
(it runs the QA gate and edits `shared/metros.ts`), then commit and push.

Finally rebuild the city pages from the new data: Actions > *Deploy Pages* >
Run workflow (or `gh workflow run "Deploy Pages"`).

## 9. Smoke checks

```bash
# A session token (expect 200 and {"token":"...","ttl_seconds":300}).
curl -s -X POST https://frolicmap.app/api/session

# The same through the dedicated host.
curl -s -X POST https://api.frolicmap.app/api/session

# A vector tile (Seattle at zoom 10) with the token: expect 200 and
# content-type application/vnd.mapbox-vector-tile.
TOKEN=$(curl -s -X POST https://frolicmap.app/api/session | sed -E 's/.*"token":"([^"]+)".*/\1/')
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $TOKEN" https://frolicmap.app/api/tiles/10/164/357.pbf

# Without a token the data endpoints refuse (expect 401).
curl -s -o /dev/null -w '%{http_code}\n' https://frolicmap.app/api/items.json

# The prerendered city page (expect 200, a <title> naming Seattle, and the
# OpenStreetMap attribution footer).
curl -s https://frolicmap.app/cities/seattle | grep -o '<title>[^<]*</title>'
curl -s https://frolicmap.app/cities/seattle | grep -c 'openstreetmap.org/copyright'
```

Then, in a browser, open https://frolicmap.app and switch through all five
basemaps (Light, Dark, Street, Liberty, Satellite): each must render. Also open
`/cities` and confirm the city cards show their map snapshots (OpenFreeMap
Positron; the USGS mosaic is the fallback when JavaScript is off). Finally check
the response headers:

```bash
curl -sI https://frolicmap.app/ | grep -i -E 'strict-transport-security|content-security-policy'
```

If `/api/session` answers 503, the secret from step 4 is not set. If the tile
request returns 200 with an empty body, no approved rows fall inside that tile.
