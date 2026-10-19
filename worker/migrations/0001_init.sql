-- 0001_init.sql
--
-- frolicmap initial schema: static places only. Collapsed from the 35
-- migrations of the private codebase this repo was carved out of, keeping the
-- final shape of `items`, `ingestion_log`, `reports` and `id_fetch_watch`.
-- Event, crop, sign-in, newsletter, submission and analytics tables and
-- columns are not carried over (see docs/carve-out-manifest.md).
--
-- Notes for the D1 migration runner: it splits on semicolon-at-end-of-line, so
-- keep comments free of statement-like endings, and do not leave a trailing
-- comment block after the final statement (it becomes an empty statement,
-- which fails applyD1Migrations for the whole suite).

CREATE TABLE items (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('place')),
  name            TEXT NOT NULL,
  name_zh         TEXT,
  description     TEXT,
  category        TEXT NOT NULL CHECK (category IN (
    'playground','park','library','museum','aquarium','zoo','beach',
    'waterplay','hiking','campground'
  )),
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  address         TEXT,
  age_min         INTEGER,
  age_max         INTEGER,
  cost            TEXT CHECK (cost IN ('free','paid') OR cost IS NULL),
  price_usd       REAL,
  indoor          INTEGER CHECK (indoor IN (0,1) OR indoor IS NULL),
  opening_hours   TEXT,
  photo_url       TEXT,
  photo_attribution TEXT,
  website         TEXT,
  source_url      TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN (
    'osm','imls','parkserve','nps','manual'
  )),
  confidence      TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','archived')),
  last_verified   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  -- Metro id from shared/metros.ts. The default is the depth metro's id and
  -- only matters for writers that predate region-aware imports.
  region          TEXT NOT NULL DEFAULT 'bay',
  city            TEXT,
  -- JSON blob: fenced, shaded, restrooms, splashpad, photo_candidate...
  attributes      TEXT,
  -- Stable URL slug, assigned at import time and never rewritten by upserts.
  slug            TEXT,
  has_playground  INTEGER CHECK (has_playground IN (0,1))
);

CREATE INDEX idx_items_status         ON items(status);
CREATE INDEX idx_items_category       ON items(category);
CREATE INDEX idx_items_geo            ON items(lat, lng);
CREATE INDEX idx_items_status_lat_lng ON items(status, lat, lng);
CREATE INDEX idx_items_region_status  ON items(region, status);
CREATE UNIQUE INDEX idx_items_slug    ON items(slug) WHERE slug IS NOT NULL;
CREATE INDEX idx_items_park_has_playground ON items(category, has_playground) WHERE has_playground = 1;

CREATE TABLE ingestion_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  fetched     INTEGER,
  inserted    INTEGER,
  updated     INTEGER,
  errors      TEXT
);

CREATE TABLE reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  resolved   INTEGER DEFAULT 0
);

CREATE INDEX idx_reports_resolved ON reports(resolved);

-- Per-IP sequential-ID enumeration watch. Keyed on a SHA-256 hash of the
-- caller's IP, never the raw IP. See worker/src/utils/enumerationGuard.ts and
-- worker/src/db/enumerationWatch.ts.
CREATE TABLE id_fetch_watch (
  ip_hash       TEXT PRIMARY KEY,
  last_id       TEXT NOT NULL,
  streak        INTEGER NOT NULL,
  direction     TEXT CHECK (direction IN ('asc','desc') OR direction IS NULL),
  updated_at    TEXT NOT NULL,
  blocked_until TEXT
);

CREATE INDEX idx_id_fetch_watch_updated_at ON id_fetch_watch(updated_at);

