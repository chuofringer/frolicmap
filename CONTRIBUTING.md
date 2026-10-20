# Contributing to frolicmap

Thanks for helping. The code is MIT; **the data is not** (see below).
Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Run the checks

```bash
# root (frontend)
npm ci
npm run lint && npx tsc -b && npm run test:run

# worker
cd worker && npm ci
npx tsc --noEmit && npm run test:run && npm run test:mjs
```

## Branch and PR flow

Branch off `main` (never commit to it directly), keep changes focused, run the
checks above, and open a pull request against `main`. The PR template asks for
a summary, the checks you ran and a data-licence confirmation.

## Data is not MIT

Place data comes from OpenStreetMap (ODbL), IMLS, the National Park Service and
others, each under its own terms (see the README table). Do not add a data
source without checking that its licence allows redistribution, and keep the
OpenStreetMap attribution visible. Use free, open, keyless basemaps only.

## Proposing a new metro

Edit `shared/metros.ts` (id, label, timezone, bounds, initial view), run
`node worker/scripts/qa-metro.mjs --metro <id>` (see `docs/setup-cloudflare.md`),
and open a PR with its output.

## By design

frolicmap is read-only: there is no admin, no cron, no user accounts and no
email. Please do not propose features that need them.

## Bugs and wrong places

Use the issue templates; for a missing, mislocated or wrong place use "Wrong
place" and include a source link.
