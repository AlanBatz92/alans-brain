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
    week INTEGER,             -- BirdNET 1-48 week-of-year used for the --week season filter
    battery_voltage_v REAL,
    clip_path TEXT,           -- archived verification clip (life-list-qualifying hits only)
    verified TEXT             -- review label: correct / wrong / unsure (NULL = unreviewed)
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
    date          TEXT NOT NULL,      -- Eastern date, e.g. 2026-06-05
    slot          TEXT NOT NULL DEFAULT 'morning',  -- 'morning' | 'evening' (twice-daily)
    generated_at  TEXT NOT NULL,
    headline      TEXT NOT NULL,
    sections_json TEXT NOT NULL,
    citations_json TEXT,              -- global numbered citation list (added 2026-05-30)
    model         TEXT,
    item_count    INTEGER,
    PRIMARY KEY (date, slot)          -- two briefs per day coexist (2026-06-05)
);

-- ── Migrations ──────────────────────────────────────────────
-- Apply each block once against the live ~/birdnet.db, then leave it here as a
-- record. A fresh DB built from the CREATE statements above is already current.

-- migration 2026-05-30: citations on digests
-- ALTER TABLE feed_digests ADD COLUMN citations_json TEXT;

-- migration 2026-06-02: verifiable lifers (clip archive + review labels)
-- ALTER TABLE detections ADD COLUMN clip_path TEXT;
-- ALTER TABLE detections ADD COLUMN verified  TEXT;
-- birdnet_pipeline.init_db() also applies both idempotently on restart, so a
-- routine `git pull` + `systemctl restart birdnet` migrates the live DB with no
-- manual step. (The `week` column now stores BirdNET's 1-48 week, not ISO week.)

-- migration 2026-06-05: twice-daily digest (morning + evening, windowed "since
-- the last brief"). feed_digests gains a `slot` column and a (date, slot) PK so
-- both briefs coexist. SQLite can't add to a PK in place, so this is a rebuild.
-- pulse_digest.ensure_schema() applies it idempotently on the next run (checks
-- for the `slot` column first), so a plain `git pull` migrates the live DB with
-- no manual step — same pattern as birdnet_pipeline.init_db():
-- ALTER TABLE feed_digests RENAME TO feed_digests_old;
-- CREATE TABLE feed_digests ( ...new schema above... );
-- INSERT INTO feed_digests (date, slot, generated_at, headline, sections_json,
--                           citations_json, model, item_count)
--   SELECT date, 'morning', generated_at, headline, sections_json,
--          citations_json, model, item_count FROM feed_digests_old;
-- DROP TABLE feed_digests_old;
