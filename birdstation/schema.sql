-- birdnet.db — canonical schema for the Emmaus Bird Observatory / Pulse box.
-- Source of truth for table structure. The live DB at ~/birdnet.db is migrated
-- by hand; record each change as a dated "-- migration" block at the bottom and
-- in the repo's Build History.md.
--
-- Imported 2026-05-30 from `sqlite3 ~/birdnet.db .schema` (as deployed).

CREATE TABLE detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    common_name TEXT NOT NULL,
    scientific_name TEXT NOT NULL,
    confidence REAL NOT NULL,
    week INTEGER,
    battery_voltage_v REAL
);

CREATE TABLE lifetime (
    common_name TEXT PRIMARY KEY,
    scientific_name TEXT,
    first_seen TEXT,
    total_detections INTEGER DEFAULT 1
);

CREATE TABLE train_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at TEXT NOT NULL,
    duration_s  REAL,
    peak_db     REAL,
    clip_path   TEXT,
    reviewed    INTEGER DEFAULT 0,
    verdict     TEXT
);

CREATE TABLE solar_telemetry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT NOT NULL,
    voltage_v  REAL,
    current_ma REAL,
    power_mw   REAL,
    state      TEXT
);

-- ── Pulse (Lehigh Valley news) ──────────────────────────────
CREATE TABLE feed_sources (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    url         TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_status TEXT,
    last_count  INTEGER DEFAULT 0,
    last_fetch  TEXT
);

-- NOTE: feed_items has NO integer id/link column. The PK is `url` (which is
-- the article link); code references the implicit `rowid` as the item id.
CREATE TABLE feed_items (
    url        TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source     TEXT NOT NULL,
    published  INTEGER,
    fetched_at TEXT NOT NULL,
    summary         TEXT,
    category        TEXT,
    ai_summary      TEXT,
    enriched_at     TEXT,
    enrich_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_feed_items_pub ON feed_items(published DESC);
CREATE INDEX idx_feed_items_fetched ON feed_items(fetched_at);

CREATE TABLE feed_digests (
    date          TEXT PRIMARY KEY,   -- local date, e.g. 2026-05-30
    generated_at  TEXT NOT NULL,
    headline      TEXT NOT NULL,
    sections_json TEXT NOT NULL,
    model         TEXT,
    item_count    INTEGER
);

-- ── Migrations ──────────────────────────────────────────────
-- (none yet; the citations column lands in the next commit)
