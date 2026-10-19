# Cloudflare setup runbook

For an operator whose domain (`frolicmap.app`) is already on Cloudflare. Follow
the steps in order. Commands run from the repository root unless a step says
`cd worker`.

**What needs the Cloudflare dashboard and cannot be scripted from this repo:**
creating the API token (step 7), attaching the Pages custom domain and the `www`
redirect (step 6), the placeholder DNS record for `api` if your zone has none
(step 5), and the optional `funradar.app` redirect rule (step 10). Everything
else is a command below. Nothing in this repository calls Cloudflare on its own:
every command is run by you, and GitHub Actions runs only the two deploy
workflows.

## 1. Log in

```bash
cd worker
npm ci
npx wrangler login        # opens a browser; choose the Cloudflare account that owns frolicmap.app
npx wrangler whoami       # note the Account ID, you need it in step 7
```

## 2. Create the D1 database

```bash
npx wrangler d1 create frolicmap-prod
```

Copy the `database_id` it prints into `worker/wrangler.toml`, replacing
`<set after wrangler d1 create>`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "frolicmap-prod"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Commit that change. (A D1 id is an identifier, not a secret.)

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
`frolicmap.app/api/*` (zone `frolicmap.app`), the two rate-limit bindings and the
`RateLimiterDO` Durable Object (created by the `v1-rate-limiter-do` migration
inside the same deploy).

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

## 7. GitHub secrets

In the GitHub repository: Settings > Secrets and variables > Actions > New
repository secret.

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

# 3. Optional extra sources for the same metro (each writes SQL, then apply it
#    the same way). IMLS needs the CSV downloaded first; NPS needs NPS_API_KEY.
cd ..
node worker/scripts/seed-parkserve.mjs --metro seattle
(cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ../data/parkserve/seattle.sql)

# 4. De-duplicate across sources (reads remote D1, writes SQL, then apply it).
node worker/scripts/dedup-national.mjs --metro seattle --remote
(cd worker && npx wrangler d1 execute frolicmap-prod --remote --file ../data/dedup/seattle.sql)

# 5. QA gate: read-only, exits non-zero if the metro is not ready.
node worker/scripts/qa-metro.mjs --metro seattle --remote
```

The API serves a metro only when it is `published: true` in `shared/metros.ts`,
and its `/cities/{slug}` page is generated only when it also has at least 50
approved places. To publish another
metro, run `node worker/scripts/promote-metro.mjs --metro <id> --remote --yes`
(it runs the QA gate and edits `shared/metros.ts`), then commit and push.

Finally rebuild the city pages from the new data: Actions > *Deploy Pages* >
Run workflow (or `gh workflow run "Deploy Pages"`).

The Bay Area (`bay`) is skipped by the import scripts unless you pass
`--include-bay`; use it for the OSM step above (`--metro bay --include-bay`) to
load it.

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

If `/api/session` answers 503, the secret from step 4 is not set. If the tile
request returns 200 with an empty body, no approved rows fall inside that tile.

## 10. Redirect the old site (funradar.app to frolicmap.app)

Do this **only when the new site is live and verified** (all of step 9 passes).
Until then the old site keeps running unchanged.

**Dashboard step.** Select the `funradar.app` zone > Rules > Redirect Rules >
*Create rule* (Single Redirect):

- Filter expression:
  `http.host eq "funradar.app" or http.host eq "www.funradar.app"`
- Then: type *Dynamic*, expression
  `concat("https://frolicmap.app", http.request.uri.path)`
- Status code: **301**, *Preserve query string* on.

This keeps the path, so `https://funradar.app/cities/seattle` lands on
`https://frolicmap.app/cities/seattle`. Both `funradar.app` and `www.funradar.app`
need a proxied DNS record in that zone for the rule to fire. To roll back,
disable the rule.
