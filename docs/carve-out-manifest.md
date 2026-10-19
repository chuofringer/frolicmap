# Carve-out manifest: funradar-app → frolicmap

This repository is a fresh-history, static-places-only cut of the private
`funradar-app` codebase. Source checkout for the carve-out:
`/home/user/funradar-app` (branch `main`). Tracking ticket:
chuofringer/funradar-app#723.

**Product.** A map of fun places for families (playgrounds, parks, libraries,
museums, aquariums, zoos, beaches, waterplay, hiking, campgrounds) sourced from
OpenStreetMap, IMLS, ParkServe and NPS, served as session-gated vector tiles
from a Cloudflare Worker + D1, with a minimal curator admin. Open source, MIT
for code; data is not MIT (see §5).

**Decisions (2026-10-19).**
- Name: **frolicmap** (domain frolicmap.app, repo chuofringer/frolicmap,
  email frolicmap.official@gmail.com). Replace every `funradar`/`funradar.app`/
  `funradar-app` string with the frolicmap equivalent as files are copied.
- Fresh history is mandatory: the source repo's history carries ~255 MB of
  harvested extract JSON. Never `git fetch` from the source repo.
- Minimal admin kept: list, approve, reject, edit (incl. photo and Chinese
  title), reports queue, ingestion log, run-OSM. Behavior, waitlist,
  submissions, stats, approve-all go.
- Everything event-related, aggregator/LLM-related, sign-in, newsletter,
  submissions, affiliate, weather, U-Pick is OUT.
- The old site keeps running unchanged until this one deploys.

All paths below are relative to the source repo unless stated. Line numbers
are from the source tree at the time of writing; verify before editing.

## 1. KEEP (copy as-is)

**shared/**
- `shared/metros.ts` — metro registry, bboxes, `timezone`, `liveCategories`, `metroForCoords`, publish ledger. (Modify: see §2.)
- `shared/osm.ts` — Overpass query builder, `overpassElementToItem`, `parseOverpassResponse`, bbox split, `resolvePhotoCandidateFromTags`.
- `shared/photoHost.ts` — Commons-only `photo_url` allow-list.
- `shared/categorySlugs.ts` — slug/plural/colour/fold maps (also imported by `worker/scripts/lib/seoPages.mjs`).
- `shared/qualityGate.ts` + `data/quality/source-accuracy.json` — admin approve gate.
- `shared/__tests__/photoHost.test.ts`.

**worker/src**
- `index.ts` (modify §2), `env.ts` (modify §2).
- `routes/public.ts` — keep `/api/session`, `/api/items.json`, `/api/items/:id`, `/api/items/:id/coords`, `/api/tiles/*`, `/api/report` (the correction channel auto-approved rows rely on), `sessionGuard`, `sessionPayloadOf`, CORS helpers, `ATTRIBUTION`.
- `utils/tile.ts`, `utils/session.ts`, `utils/globalRateLimit.ts` + `do/RateLimiterDO.ts`, `utils/originGuard.ts`, `utils/enumerationGuard.ts` + `db/enumerationWatch.ts`, `utils/cache.ts`, `utils/bbox.ts`, `utils/cityFromAddress.ts`, `utils/nearestCity.ts`, `utils/slug.ts`, `utils/cronHealth.ts` (trim `CRON_CADENCES` to `osm`).
- `db/items.ts` (modify: drop `pendingEventCountsBySource`, crop/time columns in `upsert`), `db/ingestionLog.ts`, `db/reports.ts`.
- `ingest/osm.ts` — quarterly Overpass ingest (set `confidence: 'medium'`; trusted-source Tier C).
- `middleware/cfAccess.ts`.
- Tests: `worker/test/{tile,session,globalRateLimit,enumerationGuard,cfAccess,same-origin,osm,osm-integration,osmNational,boundedFetch,nearestCity,cityFromAddress,backfillPhotos,backfillAddresses,imls,nps,parkserve,dedupPlaces,dedupCluster,qaChecks,qualitySample,publishMetro,publishGate,seoPages,zhSeoPages,prerenderShell,seedSql,wranglerExec,normalizeAddress,ingest-osm-national,name-waterplay,waterplayCategory,hikingCampground,nameZh,migrationNumbers}.test.*`, `worker/test/helpers/*`, `worker/test/fixtures/{nps-parks.json,overpass-waterplay-seattle.json}`.

**worker/scripts** (static pipeline) — `ingest-osm-national.mjs`, `seed-imls-libraries.mjs`, `seed-imls-museums.mjs`, `seed-parkserve.mjs`, `seed-nps.mjs`, `dedup-national.mjs`, `find-duplicate-items.mjs`, `qa-metro.mjs`, `promote-metro.mjs`, `build-seo-pages.mjs`, `backfill-photos.mjs`, `backfill-addresses.mjs`, `name-waterplay.mjs`, `regeocode-d1.mjs`, `snap-coords-from-d1.mjs`, `run-osm.md`. Their closed lib set: `lib/{seedSql,csv,imls,parkserve,nps,dedupPlaces,dedupCluster,qaChecks,publishMetro,seoPages,prerenderShell,wranglerExec,localeCopy,htmlEscape,backfillPhotos,backfillAddresses,normalizeAddress,nameWaterplay,validateCoords,coordSnap,googleGeocode,cityBbox,qualitySample,applySafetyDefaults}.mjs`.

**src/** — `App.tsx` (modify), `main.tsx` (modify), `index.css`, `App.css`, `sw.ts`, `pwa/*`, `test-setup.ts`, `vite-env.d.ts`, `types/index.ts`; `components/Map/{FunMap,ItemSource,NearbyOverlay,SearchMarker}.tsx`; `components/Bar/{SearchFilterBar,ViewToggle}.tsx`; `components/Filters/{AgeSlider,CategoryChips,FreeToggle,useCategoryChipState}`; `components/Layout/{BasemapButton,Brand,FAQButton,FAQOverlay,FiltersButton,FiltersDrawer,IconBar,LegendButton,LegendList,MapControls,MetroPicker,NetworkErrorBanner}.tsx`; `components/Legal/*` (rewrite copy); `components/List/ListPanel.tsx`; `components/Panel/{BottomSheet,DetailOverlay,DetailPanel,ReportModal,StackedFeatureList,detailHelpers,useDetailData}`; `components/Search/SearchBar.tsx`; `components/Distance/*`; `components/I18n/*`; `config/{categories,constants,mapStyle,metroNames}.ts`; `hooks/{use3DToggle,useActiveFilterCount,useDebouncedValue,useDistanceOrigin,useDragToDismiss,useFocusTrap,useGeocode,useItemCoords,useItemDetail,useItems,useMediaQuery,useMetro,useSession,useUrlCategory,useUrlItem,useUrlView}.ts`; `stores/{useMapStore,useFiltersStore,useSessionStore}.ts`; `utils/{analytics,bot,displayTitle,distance,filters,geoMetro,mapsUrls,openItem,place,sameNameFuzzy,searchMatch}.ts`; `pages/{CitiesPage,lazyPages}.tsx`; `i18n/{index,locale}.ts` + en/zh slices `bar,categories,common,detail,faq,filters,legend,list,map,metro,pages,search` (edit per §2); `api/{items,session,admin}.ts`; `admin/{AdminApp,ItemEditor,PendingQueue,...}` minus the dropped views.
- Root config: `package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`, `index.html` (modify), `public/*` (replace icons/og-image/sitemap/robots), `worker/{package.json,package-lock.json,tsconfig.json,vitest.config.ts,wrangler.toml}` (modify), `.github/workflows/{ci,deploy-pages,deploy-worker}.yml` (modify).

## 2. KEEP BUT MODIFY

- **`worker/src/routes/public.ts`** — delete handlers `/api/auth/google`, `/api/auth/delete-account`, `/api/outbound-click`, `/api/ui-event`, `/api/submissions` + `/mine`, `/api/signup`, `/api/unsubscribe`, `/api/weather` (and `RainyDayBanner`/`useWeather`/`api/weather.ts` on the SPA side), helpers `signupCityFor`/`insertGateSignup`/`insertOptInSignup`, `resolveSignupSource/City`, `isHttpsUrl/isValidIso`. In `/api/items/:id`: delete the member gate block and the `applyAffiliateToItem` wrap (return `c.json({ item })`). In `/api/session`: drop the credential→member exchange (`mintSessionToken(key)` with no member arg). In `/api/tiles/*`: drop the upick `resolvePrimaryCropEmoji` branch. Drop imports: `db/submissions`, `uiEventGoals`, `signupSource`, `eventsGate`, `authTokens`, `googleIdToken`, `email`, `weather`, `affiliate`. Trim `ATTRIBUTION` to OSM + IMLS/NPS/ParkServe entries.
- **`worker/src/index.ts`** — keep only the `'0 3 1 */3 *'` cron branch + `alertOnRepeatedFailure` (log-only); drop imports of `archiveExpired`, `structuredFeeds`, `operatorDigest`, `email`. Root `/` redirect → `https://frolicmap.app/`.
- **`worker/wrangler.toml`** — `name = "frolicmap-api"`; routes `api.frolicmap.app/*` and `frolicmap.app/api/*` with `zone_name = "frolicmap.app"`; `FRONTEND_URL = "https://frolicmap.app"`; `crons` → one entry; delete `[ai]`, `RESEND_FROM_EMAIL`, `EVENTS_REQUIRE_MEMBER`, `GOOGLE_CLIENT_ID`, `CF_ACCOUNT_ID`, `ALERT_EMAIL`, affiliate comments, `INTERNAL_RATE_LIMITER`, and the whole `[env.preview]` block. D1 binding: `database_name = "frolicmap-prod"`, `database_id = "<set after wrangler d1 create>"`. Rate-limiter `namespace_id`s: fresh integers (e.g. 2026101901..), never the source ones.
- **`worker/src/env.ts`** — drop `AI`, `INTERNAL_RATE_LIMITER`, `RESEND_*`, `EMAIL_LIVE_SENDS`, `GOOGLE_CLIENT_ID`, `EVENTS_REQUIRE_MEMBER`, `ALERT_EMAIL`, `CF_ACCOUNT_ID`, `BROWSER_RENDERING_API_TOKEN`, `PREVIEW_WRITE_ORIGIN`, `EVENTBRITE_*`, `GETYOURGUIDE_*`, `SESSION_SIGNING_KEY_PREVIOUS`. `worker/vitest.config.ts` bindings: drop `RESEND_API_KEY`, `EMAIL_LIVE_SENDS`, `EVENTS_REQUIRE_MEMBER`, `GOOGLE_CLIENT_ID`.
- **`worker/src/routes/admin.ts`** — keep `ping`, items list/get, `approve`/`reject`, `PUT items/:id`, `reports`, `ingestion-log`/`observability`, `run/osm` (only the `osm` branch). Delete `submissions/*`, `stats`, `behavior`, `waitlist`, `approve-all`. Drop imports `db/submissions`, `signupSource`, `archiveExpired`, `structuredFeeds`. CORS origin → `https://frolicmap.app`. SPA: `src/admin/AdminApp.tsx` keep Pending/ItemEditor/Reports/Ingestion tabs only; delete `SubmissionsQueue`, `WaitlistView`, `BehaviorView`, `StatsView` (+ tests); `ItemEditor.tsx`/`PendingQueue.tsx` lose event time fields and `venueTime` imports.
- **`shared/types.ts`** — `ItemType` → `'place'` only; `ALL_CATEGORIES` remove `event`, `upick`, `birthday_party`, `restaurant`; `SourceType` → `osm|imls|parkserve|nps|manual`; `Item` drop `start_time,end_time,rrule,exdates,crops,crops_state,in_season_now,affiliate`; delete `Submission`/`SubmissionStatus`; `ListItem`/`LIST_ITEM_FIELDS` drop the four time fields + `in_season_now`; `Filters` drop `timeWindow`, `inSeasonNow`.
- **`shared/metros.ts`** — `BAY_LIVE_CATEGORIES` → `STATIC_PLACE_CATEGORIES`; strip `'event'` from every `liveCategories`; `shared/__tests__/metros.test.ts` publish-ledger expectations follow. `shared/osm.ts`: drop `event`/`upick` keys in `CATEGORY_QUERY` if present.
- **`src/config/categories.ts`** — remove `event`, `upick`, `birthday_party`, `restaurant` from `CATEGORIES`/`CATEGORY_ORDER`, delete `PARKED_CATEGORIES` and `getCategoryEmoji`'s upick branch (drop `seasonalEmoji` import). `shared/categorySlugs.ts` maps lose the same four keys.
- **`src/utils/filters.ts`** — delete `wallDayNumber`, `eventStillRelevant`, `isOpenNow`, the `timeWindow` branch, the `inSeasonNow` check, and the `isClosureEventName` line; drop imports `rrule`, `venueTime`, `closureEvents`. `useFiltersStore.ts`: drop `setTime`/`toggleInSeasonNow`. `FiltersDrawer.tsx`: drop `TimeChips`/`InSeasonChip`.
- **Components** — `ListPanel.tsx`: drop imports of `eventsGate`, `useAuthStore`, `useEngagementStore`, `pickEarliestPerSource`, `useGateRequestStore`, `WeekendPicksRail` and the blurred-title/gated branches. `DetailPanel.tsx`/`BottomSheet.tsx`: drop `UpickSeasonStrip`, `SiblingDatesStrip`, `EventUnlockCard`, `ItemPopupSignupCTA`. `useDetailData.ts`: drop the `gated`/siblings logic. `StackedFeatureList.tsx`: drop the time-parse block. `detailHelpers.ts`: delete `formatEventTiming`/`nextOccurrence` and the `rrule`/`venueTime` imports (keep `intlLocale`, address/hours/price formatting). `SearchFilterBar.tsx`: drop `useAuthStore`, `eventsGate`, `PicksLauncher`, `PicksOverlay` and the calendar `ViewToggle` option. `IconBar.tsx`: drop `CoffeeButton` and `SubmitModal`. `FAQOverlay.tsx`: drop `useAuthStore`/`api/auth` and the delete-account section. `ItemSource.tsx`: drop `pickEarliestPerSource` — allowed-ids become plain filter output. `App.tsx`: drop `WelcomeGate`, `WaitlistSlideIn`, `RainyDayBanner`, `SignInToast`, `CalendarPanel`. `main.tsx`: drop `/signup` and `/unsubscribe` routes. `useSession.ts`: drop `useAuthStore` and the credential re-mint. `useSessionStore.ts`: drop `member`. `useMapStore.ts`: `OverlayName` loses `'submit' | 'picks'`; `viewMode` loses `'calendar'`. `utils/analytics.ts`: drop `useEngagementStore` and the D1 `ui-event` POST; keep `trackGoal` as a CF-beacon-only no-op. `shared/uiEventGoals.ts` goes with it.
- **i18n** — delete slices `auth`, `calendar`, `signup`, `submit`, `time` (en+zh) and their keys in `en/index.ts`/`zh/index.ts`; prune event/upick/sign-in strings from `list.ts`, `faq.ts` (buymeacoffee, `deleteError`, `contactEmail` → frolicmap.official@gmail.com), `detail.ts`, `pages.ts`, `categories.ts`, `filters.ts`. The `Translation` type guard will flag every stray key. Brand name in copy: **frolicmap** (lowercase, one word).
- **`index.html`** — rewrite title/description/OG/JSON-LD for frolicmap, keep the `%VITE_CF_BEAM_TOKEN%` beacon placeholder (`vite.config.ts` strips it when unset).
- **Migrations** — collapse the source's 35 files into one `worker/migrations/0001_init.sql`:
  - `items(id PK, type CHECK('place'), name, name_zh, description, category CHECK(playground,park,library,museum,aquarium,zoo,beach,waterplay,hiking,campground), lat, lng, address, age_min, age_max, cost CHECK, price_usd, indoor CHECK, opening_hours, photo_url, photo_attribution, website, source_url NOT NULL, source_type CHECK(osm,imls,parkserve,nps,manual), confidence CHECK, status CHECK, last_verified, created_at, updated_at, region NOT NULL, city, attributes, slug, has_playground CHECK)` — drop `start_time,end_time,rrule,exdates,crops,crops_state,in_season_now`. Indexes: `idx_items_status_lat_lng`, `idx_items_category`, `idx_items_region`, `idx_items_park_has_playground`, unique slug index.
  - `ingestion_log`, `reports` (+`idx_reports_resolved`), `id_fetch_watch`. Drop `sources`, `outbound_clicks`, `waitlist_signups`, `ui_events`, `users`, `submissions`.
  - Rewrite `worker/test/helpers/migrations.ts` + `nationalMigration.test.ts` against the single file; `migrationNumbers.test.mjs` loses its allow-list.

## 3. DROP entirely

- `worker/src/ingest/{feeds/,structuredFeeds.ts,llm.ts}`, `worker/src/{archiveExpired,operatorDigest}.ts`, `worker/src/routes/internal.ts`, `worker/src/utils/{affiliate,authTokens,email,googleIdToken,weather,tz,validate,boundedFetch}.ts`, `worker/src/db/submissions.ts`.
- `worker/scripts/{merge-*.mjs,aggregator-sources.mjs,fetch-bakf-urls.mjs,build-digest.mjs,verify-event-times.mjs,gate-readout.mjs,gsc-ctr-log.mjs,top-venues-by-clicks.mjs,sample-approved-events.mjs,migrate-aggregator-ids.mjs,migrate-bibliocommons-coords.mjs,bootstrap-bibliocommons-branches.mjs,audit-north-bay-coverage.mjs,audit-manual-scraped-coords.mjs,normalize-w21.mjs,normalize-w28.mjs,patch-upick-seed.mjs,verify-upick-coords.mjs,validate-seed-*.mjs,local-cityparks-ingest.mjs,verify-museums.mjs}` and every `*.sql` in `worker/scripts/`. `worker/scripts/lib/{staleDateGuard,eventTimes,canonicalId,manualRejects,digest,gateReadout,gscCtr,topVenues,northBayCoverage,archiveDemoted}.mjs`.
- `data/{aggregator-extracts,bakf-extracts,reverify-extracts,bibliocommons-branches-rejected.json}`; `scripts/` (repo-ops).
- `docs/` — nothing from the source `docs/` is carried over (771 brand hits, all history). This repo gets a fresh README and this manifest only.
- `.github/workflows/{aggregators-merge,bakf-merge,reverify-merge,upick-merge,waterplay-seed,apply-sql,deploy-worker-preview}.yml`.
- `shared/{eventsGate,signupSource,closureEvents,seasonalEmoji,uiEventGoals}.ts`.
- `src/components/{Auth/,Calendar/,Picks/,Submit/}`, `Layout/{CoffeeButton,SignInToast,WaitlistSlideIn,RainyDayBanner}.tsx`, `Panel/{EventUnlockCard,ItemPopupSignupCTA,SiblingDatesStrip,UpickSeasonStrip}.tsx`, `List/WeekendPicksRail.tsx`, `Filters/{TimeChips,InSeasonChip}.tsx`; `src/stores/{useAuthStore,useEngagementStore,useGateRequestStore,useLastGateSourceStore,usePicksWindowStore}.ts`; `src/utils/{rrule,venueTime,siblings,pickEarliestPerSource,agenda,weekendPicks,picksWindow,time}.ts` (venueTime is only imported by event/upick/sibling code and the time-window branch of filters.ts); `src/hooks/{useRecommendedEvents,useWeather}.ts`; `src/pages/{SignupRedirect,UnsubscribePage}.tsx`; `src/api/{auth,signup,submissions,weather}.ts`; `src/admin/{SubmissionsQueue,WaitlistView,BehaviorView,StatsView}.tsx`; `src/assets/hero.png`.
- `worker/package.json`: drop deps `ical.js`, `jose`. Root `package.json`: keep all (`parse-address` is used by `cityFromAddress`).

## 4. STRIP (never copy these values)

- `worker/wrangler.toml`: worker `name`, routes + `zone_name`, `FRONTEND_URL`, Resend senders (`hello@funradar.app`, `preview@mail.funradar.app`), Google OAuth client id (`465734743855-…apps.googleusercontent.com`), D1 `funradar-prod` / `database_id = "af5d0539-…"`, rate-limiter `namespace_id`s (2026041801/2026042001/2026082201/2026082202–04), preview DB.
- `src/config/constants.ts`: `GOOGLE_CLIENT_ID` literal; `ADMIN_API_BASE` → `https://api.frolicmap.app`.
- `worker/src/utils/originGuard.ts` `ALLOWED_ORIGINS`; `worker/src/routes/admin.ts` CORS origin; `worker/src/utils/cache.ts` `api.funradar.app`; `worker/src/index.ts` `/` redirect.
- `src/components/Layout/CoffeeButton.tsx` buymeacoffee; `hello@funradar.app` in `i18n/en/faq.ts`, `en/pages.ts`, `Legal/TermsPage.tsx`, `Legal/PrivacyPage.tsx` → `frolicmap.official@gmail.com`.
- `index.html` brand/OG/canonical; `.github/workflows/deploy-pages.yml` `--project-name` → `frolicmap`.
- `public/site.webmanifest`, `public/sitemap.xml`, `public/robots.txt`, `public/og-image.png` + icons → frolicmap versions (placeholder icons are fine for now).
- No Sentry DSN, account id literal, or Resend key exists in the source tree; `CLOUDFLARE_*` come from GitHub secrets.
- Brand-string counts in the source for the rename: `src` 146, `worker/src` 47, `worker/scripts` 103, `worker/test` 91, `wrangler.toml` 23, `.github` 15, `index.html` 12, `worker/package.json` 6, `public` 4, `package.json` 1, `vite.config.ts` 1, `shared` 0.

## 5. LICENSE / attribution

- **Code: MIT** (`LICENSE` at root, copyright "frolicmap contributors"); add `"license": "MIT"` to both `package.json` files. README states **data is not MIT**: rows carry `source_type` and are redistributed under each source's terms.
- **OSM (ODbL 1.0)** — add a MapLibre `AttributionControl` with "© OpenStreetMap contributors" linking to openstreetmap.org/copyright on every basemap (`src/config/mapStyle.ts`; the source map has NO attribution control today), plus a README "Data" section.
- **IMLS** — US federal public domain; credit "Institute of Museum and Library Services".
- **NPS** — public domain; the NPS API terms require a free key and attribution to "National Park Service".
- **TPL ParkServe** — terms not recorded in the source repo; ship the importer, note in README that ParkServe data terms must be checked before redistributing a ParkServe-derived dataset.
- **CARTO basemaps** — free tiles are non-commercial; document that production deployers need their own basemap or a CARTO plan. Esri World Imagery attribution string already present.
- **Wikimedia Commons photos** — `photo_attribution` column + `shared/photoHost.ts`; README states per-photo CC licence attribution is rendered from that column.

## 6. ORDER OF WORK

1. **Init + copy (foundation).** Root/worker config, workflows (ci, deploy-pages, deploy-worker), `LICENSE`, `.gitignore`, `README.md` stub, this manifest. Copy the §1 KEEP set verbatim (including files marked "modify" — the modifications come in later stages). Apply §4 strip and the brand rename to config files only. Single `0001_init.sql`. `shared/` edits per §2.
2. **Worker.** `index.ts`, `env.ts`, `public.ts`, `admin.ts`, `db/items.ts`, `ingest/osm.ts`, `wrangler.toml`; delete §3 worker files; `tsc --noEmit` green; worker tests green.
3. **Scripts.** Static pipeline + libs; strip `event`/`upick` branches in `seoPages.mjs`, `prerenderShell.mjs`, `localeCopy.mjs`, `dedupPlaces.mjs`; `npm run test:mjs` green.
4. **Frontend.** Delete §3 components/stores/utils; apply §2 edits; i18n prune; `index.html`/`public/`; attribution control; `tsc -b`, lint, vitest green.
5. **README + deploy smoke.** Data/licence table, quarterly cron, setup steps; D1 create + migrate, one metro end to end, Pages deploy.
