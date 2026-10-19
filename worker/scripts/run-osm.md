# Ad-hoc OSM ingest

frolicmap has a single Worker cron: the quarterly OSM ingest (`0 3 1 */3 *`,
03:00 UTC on the 1st of Jan/Apr/Jul/Oct, `runOsmIngest`). To run it by hand
against local D1:

```bash
cd worker
npx wrangler dev --test-scheduled --local &
sleep 6
# Trigger the quarterly cron
curl "http://127.0.0.1:8787/__scheduled?cron=0+3+1+*%2F3+*"
# Takes 30-90s: one Overpass query per category.
```

For metros outside the Bay depth region, use the national bootstrap script
instead (`node worker/scripts/ingest-osm-national.mjs --help`); it emits
reviewable SQL files under `data/` that you apply explicitly.

Verify:

```bash
npx wrangler d1 execute frolicmap-prod --local --command \
  "SELECT category, COUNT(*) AS n FROM items WHERE status='pending' GROUP BY category;"
```

## Waterplay naming pass

Run **after** any OSM waterplay import + dedup, per metro. Splash pads and
spray grounds are usually mapped as unnamed features, so the importer ships
them with a generic fallback name ("Splash pad" / "Water park", see
`shared/osm.ts::fallbackName`). This pass renames each generic row from the
nearest named park/playground within 250 m — "Splash pad" → "Splash pad at
Volunteer Park" — leaving rows with no nearby donor untouched.

```bash
# Preview counts (read-only, writes nothing):
node worker/scripts/name-waterplay.mjs --wave --remote --dry-run

# Emit reviewable SQL per metro into data/waterplay-names/<metro>.sql:
node worker/scripts/name-waterplay.mjs --metro chicago --remote
```

The script never writes to D1. Review the emitted `data/waterplay-names/*.sql`
(one guarded `UPDATE ... WHERE status='approved'` per row, with a comment
showing the donor id + distance), then apply with the printed
`wrangler d1 execute ... --file` command. The `bay` region is hand-excluded —
its waterplay layer is curated with real names.
