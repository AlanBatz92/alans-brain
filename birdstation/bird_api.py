#!/usr/bin/env python3
"""
Emmaus Bird Observatory — FastAPI Server
"""
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
import sqlite3
import os
import json

# Pure compute for /api/trains/analytics (FastAPI-free, unit-tested). Works whether
# the service runs from birdstation/ (uvicorn's cwd) or the repo root.
try:
    from train_analytics import compute_train_analytics
except ImportError:  # pragma: no cover
    from birdstation.train_analytics import compute_train_analytics

app = FastAPI(title="Emmaus Bird Observatory API")

ALLOWED_ORIGINS = [
    "https://www.alansbrain.com",
    "https://alansbrain.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

DB_PATH  = os.path.expanduser("~/birdnet.db")
CLIP_DIR = "/home/alan/train_clips"

# Confidence floors — mirror birdnet_pipeline.py (the pipeline is the writer;
# this is read-only). Three tiers:
#   PRESERVE  (0.60) — what the box keeps; the bird card's diagnostic hit list
#                      shows down to here (sub-85% hits explain non-lifers).
#   DISPLAY   (0.85) — what the public page/analytics show (front-end passes it).
#   LIFE-LIST (0.85 + count rule) — a new species lists after LIFE_LIST_MIN_HITS
#                      hits at/above LIFE_LIST_MIN_CONFIDENCE within a rolling 24h,
#                      one ~100% hit, OR (cumulative path) LIFE_LIST_CUMULATIVE_HITS
#                      hits at/above LIFE_LIST_CUMULATIVE_CONFIDENCE all-time.
# Keep these in sync with the pipeline.
PRESERVE_MIN_CONFIDENCE  = 0.60
LIFE_LIST_MIN_CONFIDENCE = 0.85
LIFE_LIST_MIN_HITS = 3
LIFE_LIST_CUMULATIVE_CONFIDENCE = 0.70
LIFE_LIST_CUMULATIVE_HITS = 8

# ── Eastern-time bucketing (analytics) ───────────────────────
# The observatory lives in Emmaus, PA and the box stores *naive UTC* timestamps,
# so any "hour of day" / "per day" analytic must be folded into America/New_York
# to read correctly (e.g. the dawn chorus lands at ~5–6 AM Eastern, not ~9–10 UTC).
# We aggregate to UTC (date, hour) buckets in SQL — a bounded set — then convert
# each bucket to Eastern in Python, so the conversion is cheap and DST-correct
# without a per-row scan. zoneinfo is used when available (the box runs on a full
# Linux install with tzdata); a self-contained US-Eastern rule is the fallback.
try:
    from zoneinfo import ZoneInfo
    _EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover — only if tzdata is missing
    _EASTERN = None


def _nth_sunday(year, month, n):
    """Day-of-month of the nth Sunday (weekday()==6) of year/month."""
    first = datetime(year, month, 1)
    first_sunday = 1 + (6 - first.weekday()) % 7
    return first_sunday + (n - 1) * 7


def _is_us_edt(dt_utc):
    """True if a UTC instant falls in US Eastern Daylight Time (post-2007 rule):
    2nd Sunday of March 02:00 EST (07:00 UTC) → 1st Sunday of November 02:00 EDT
    (06:00 UTC). Only used as the zoneinfo fallback."""
    y = dt_utc.year
    start = datetime(y, 3, _nth_sunday(y, 3, 2), 7, tzinfo=timezone.utc)
    end   = datetime(y, 11, _nth_sunday(y, 11, 1), 6, tzinfo=timezone.utc)
    return start <= dt_utc < end


def eastern_parts(uy, um, ud, uh):
    """Map a UTC (year, month, day, hour) to the (Eastern date "YYYY-MM-DD",
    Eastern hour 0–23) it falls in."""
    dt = datetime(uy, um, ud, uh, tzinfo=timezone.utc)
    if _EASTERN is not None:
        e = dt.astimezone(_EASTERN)
    else:
        e = dt + timedelta(hours=(-4 if _is_us_edt(dt) else -5))
    return e.strftime("%Y-%m-%d"), e.hour

# ── API key auth (write routes only) ─────────────────────────
_API_KEY = os.environ.get("BIRD_API_KEY", "")

def require_key(x_api_key: str = Header(None)):
    if not _API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured on server")
    if x_api_key != _API_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing API key")
# ─────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_train_schema():
    """
    Idempotently add the train_events columns the vetting bridge writes:
      category  — fine class (train / plane / vehicle / gunshot / ...) for analytics
      published — 1 = clip audio is publicly servable; 0 = count the event but keep
                  the backyard audio private (the default for new verdicts)
    Runs at startup so a plain `git pull` + restart migrates the live DB (same
    pattern as birdnet_pipeline.init_db). Existing approved trains are set
    published=1 so their clips stay reachable — only *new* verdicts default to
    private (count, don't serve).
    """
    try:
        conn = get_db()
        cols = {r[1] for r in conn.execute("PRAGMA table_info(train_events)")}
        if "category" not in cols:
            conn.execute("ALTER TABLE train_events ADD COLUMN category TEXT")
        if "published" not in cols:
            conn.execute("ALTER TABLE train_events ADD COLUMN published INTEGER DEFAULT 0")
            conn.execute("UPDATE train_events SET published = 1 WHERE verdict = 'train'")
        conn.commit()
        conn.close()
    except Exception:
        pass  # never block API startup on a migration hiccup


ensure_train_schema()


def ensure_life_schema():
    """
    Idempotently add the lifetime columns that record HOW/WHEN a species made the
    life list:
      qualified_via — instant_100 / burst_24h / cumulative_70 / grandfathered
      qualified_at  — ISO timestamp of the qualifying hit
    Runs at startup so a plain `git pull` + restart migrates the live DB (same
    pattern as ensure_train_schema / birdnet_pipeline.init_db). Existing lifers are
    labelled by the one-shot backfill_qualified_via.py; new ones the pipeline writes.
    """
    try:
        conn = get_db()
        cols = {r[1] for r in conn.execute("PRAGMA table_info(lifetime)")}
        if "qualified_via" not in cols:
            conn.execute("ALTER TABLE lifetime ADD COLUMN qualified_via TEXT")
        if "qualified_at" not in cols:
            conn.execute("ALTER TABLE lifetime ADD COLUMN qualified_at TEXT")
        conn.commit()
        conn.close()
    except Exception:
        pass  # never block API startup on a migration hiccup


ensure_life_schema()


def ensure_events_schema():
    """
    Idempotently create the Pulse `events` table (Lehigh Valley "What's On") so a
    plain `git pull` + `systemctl restart birdapi` migrates the live DB — same
    pattern as ensure_train_schema / ensure_life_schema. Rows come from the
    paste-to-capture pipeline (pulse_add.py / event_parser.py) and, later, feed
    adapters. The dedup_key UNIQUE index makes re-inserts a no-op.
    """
    try:
        conn = get_db()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                kind        TEXT NOT NULL DEFAULT 'event',
                starts_at   TEXT NOT NULL,
                ends_at     TEXT,
                all_day     INTEGER NOT NULL DEFAULT 0,
                venue       TEXT,
                location    TEXT,
                url         TEXT,
                description TEXT,
                source      TEXT NOT NULL DEFAULT 'manual',
                source_key  TEXT,
                dedup_key   TEXT UNIQUE,
                added_at    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
            CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
            """
        )
        conn.commit()
        conn.close()
    except Exception:
        pass  # never block API startup on a migration hiccup


ensure_events_schema()


# ─────────────────────────────────────────────────────────────
# Bird Detection Endpoints
# ─────────────────────────────────────────────────────────────

# NB: `min_confidence` defaults to 0.0 so existing callers are unaffected.
# The Observatory front-end passes 0.85 (the display floor) to keep sub-85% hits
# off the public page/analytics, even though the box *preserves* down to 0.60 so
# the bird card can still show those lower hits as diagnostics. The life list adds
# a count rule on top (LIFE_LIST_MIN_HITS hits within a rolling 24h, or one ~100%
# hit); these view filters are independent of that.

@app.get("/api/detections")
def recent_detections(limit: int = 50, min_confidence: float = 0.0):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM detections WHERE confidence >= ? "
        "ORDER BY timestamp DESC LIMIT ?",
        (min_confidence, limit)
    ).fetchall()
    conn.close()
    return {"detections": [dict(r) for r in rows]}


@app.get("/api/today")
def today_detections(min_confidence: float = 0.0):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM detections "
        "WHERE date(timestamp) = date('now', 'localtime') AND confidence >= ? "
        "ORDER BY timestamp DESC",
        (min_confidence,)
    ).fetchall()
    conn.close()
    return {"detections": [dict(r) for r in rows], "count": len(rows)}


@app.get("/api/lifetime")
def lifetime_list():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM lifetime ORDER BY first_seen ASC"
    ).fetchall()
    # `total_detections` is derived live from the detections table rather than read
    # from the stored counter on `lifetime`. The stored counter is incrementally
    # maintained by the pipeline and can drift (it misses hits logged before a
    # species was listed, and never self-corrects), so the life list could show a
    # tally lower than what "today" already shows. Counting >= the life-list floor
    # here keeps the life-list total consistent with the page's other ≥0.85 views
    # and always truthful. (N+1 COUNTs, but N = lifer count, so it's cheap.)
    species = []
    for r in rows:
        d = dict(r)
        d["total_detections"] = conn.execute(
            "SELECT COUNT(*) FROM detections "
            "WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ?",
            (d.get("common_name"), d.get("scientific_name"), LIFE_LIST_MIN_CONFIDENCE)
        ).fetchone()[0]
        # Best-ever confidence (no floor, so a single ~100% instant-add hit shows),
        # so the front-end can offer a "100% only" filter on the life list — mirroring
        # the species grid's toggle. Falls back to 0 if (impossibly) the lifer has no rows.
        d["best_confidence"] = conn.execute(
            "SELECT MAX(confidence) FROM detections "
            "WHERE (common_name = ? OR scientific_name = ?)",
            (d.get("common_name"), d.get("scientific_name"))
        ).fetchone()[0] or 0
        species.append(d)
    conn.close()
    return {"species": species, "total_species": len(species)}


@app.get("/api/species/{name}")
def species_history(name: str, min_confidence: float = 0.85):
    """Per-species detection history for bird cards: count, first/last heard,
    confidence series, per-hour histogram, the last 10 hits (newest first), and
    life-list progress (qualifying hits in the last 24h + whether it's listed).
    Summary stats use `min_confidence` (the 0.85 display floor); the recent-hits
    list reaches down to the 0.60 preserve floor so sub-85% diagnostics show.
    Matches common_name OR scientific_name."""
    conn = get_db()
    rows = conn.execute(
        """SELECT timestamp, confidence, common_name, scientific_name
           FROM detections
           WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ?
           ORDER BY timestamp ASC""",
        (name, name, min_confidence)
    ).fetchall()
    if not rows:
        conn.close()
        raise HTTPException(status_code=404, detail="species not found or no detections above threshold")
    by_hour = [0] * 24
    confidences = []
    for r in rows:
        confidences.append(round(r["confidence"], 3))
        try:
            hour = int(r["timestamp"][11:13])
            by_hour[hour] += 1
        except (ValueError, IndexError):
            pass
    common     = rows[0]["common_name"]
    scientific = rows[0]["scientific_name"]
    # Recent hits — the last 10 detections down to the PRESERVE floor (0.60), newest
    # first, so the card can show sub-85% *diagnostic* hits (e.g. why a species isn't
    # yet a lifer) even though the page filters at the higher display floor.
    recent_rows = conn.execute(
        """SELECT timestamp, confidence FROM detections
           WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ?
           ORDER BY timestamp DESC LIMIT 10""",
        (common, scientific, PRESERVE_MIN_CONFIDENCE)
    ).fetchall()
    recent = [
        {"timestamp": r["timestamp"], "confidence": round(r["confidence"], 3)}
        for r in recent_rows
    ]
    # Life-list progress, both paths the writer uses:
    #   • hits_24h     — qualifying hits (>= the 0.85 floor) within the rolling 24h
    #   • hits_cumulative — all-time hits at/above the cumulative floor (0.70), the
    #                    persistent-moderate-evidence path (no time window)
    # plus whether it's listed yet. The bird card shows whichever path is closer.
    hits_24h = conn.execute(
        "SELECT COUNT(*) FROM detections "
        "WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ? "
        "AND datetime(timestamp) >= datetime('now','-24 hours')",
        (common, scientific, LIFE_LIST_MIN_CONFIDENCE)
    ).fetchone()[0]
    hits_cumulative = conn.execute(
        "SELECT COUNT(*) FROM detections "
        "WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ?",
        (common, scientific, LIFE_LIST_CUMULATIVE_CONFIDENCE)
    ).fetchone()[0]
    # Life-list row (if any) — SELECT * + dict().get() so a DB that predates the
    # qualified_* columns simply yields None rather than erroring. qualified_via tells
    # the card exactly how it qualified (and flags a grandfathered, pre-rules lifer).
    life_row = conn.execute(
        "SELECT * FROM lifetime WHERE common_name = ? OR scientific_name = ? LIMIT 1",
        (common, scientific)
    ).fetchone()
    life_d = dict(life_row) if life_row else {}
    on_life_list = life_row is not None
    conn.close()
    return {
        "common_name":        common,
        "scientific_name":    scientific,
        "total_detections":   len(rows),
        "first_heard":        rows[0]["timestamp"],
        "last_heard":         rows[-1]["timestamp"],
        "confidence_series":  confidences,
        "by_hour":            by_hour,
        "recent":             recent,
        "hits_24h":           hits_24h,
        "life_list_min_hits": LIFE_LIST_MIN_HITS,
        "hits_cumulative":         hits_cumulative,
        "life_list_cumulative_hits": LIFE_LIST_CUMULATIVE_HITS,
        "life_list_cumulative_confidence": LIFE_LIST_CUMULATIVE_CONFIDENCE,
        "on_life_list":       on_life_list,
        "qualified_via":      life_d.get("qualified_via"),
        "qualified_at":       life_d.get("qualified_at"),
    }


@app.get("/api/detections/grouped")
def detections_grouped(start: str, end: str, min_confidence: float = 0.85):
    """Species grouped by UTC datetime range; powers the period selector in the Observatory.
    start / end are full UTC datetime strings ("YYYY-MM-DD HH:MM:SS") sent by the
    front-end after converting Eastern midnight → UTC, so late-night detections
    (e.g. 10 PM Eastern = 2 AM UTC next day) fall in the correct Eastern day.
    The comparison wraps the stored timestamp in datetime() so the ISO 'T' separator
    and microseconds (e.g. "2026-06-03T17:35:00.123456") are normalized to the same
    "YYYY-MM-DD HH:MM:SS" shape as the boundaries — a raw string compare would mis-sort
    at the boundary because 'T' (chr 84) sorts after the space (chr 32)."""
    conn = get_db()
    rows = conn.execute(
        """SELECT common_name, scientific_name,
                  COUNT(*) AS count,
                  MAX(confidence) AS best_confidence,
                  MIN(timestamp) AS first_heard,
                  MAX(timestamp) AS last_heard
           FROM detections
           WHERE datetime(timestamp) >= datetime(?) AND datetime(timestamp) < datetime(?)
             AND confidence >= ?
           GROUP BY common_name
           ORDER BY MAX(timestamp) DESC""",
        (start, end, min_confidence)
    ).fetchall()
    conn.close()
    return {"species": [dict(r) for r in rows], "start": start, "end": end}


@app.get("/api/analytics")
def analytics(start: str, end: str, min_confidence: float = 0.85, top: int = 12):
    """Pre-aggregated bird analytics over a UTC datetime range — powers the
    Observatory's Analytics tab. start / end are full UTC datetime strings
    ("YYYY-MM-DD HH:MM:SS"), the same Eastern→UTC day boundaries the period
    selector already sends to /api/detections/grouped (end exclusive).

    All distributions are bucketed in **Eastern** (Emmaus, PA): the box stores
    naive-UTC timestamps, so we GROUP BY the UTC (date, hour) prefix in SQL — a
    bounded intermediate (≤ ~24×days×species rows) — and fold each bucket into
    Eastern hour/day buckets in Python (DST-correct, no per-row SQL scan).

    Returns:
      by_hour[24]      — detections per Eastern hour-of-day (the "dawn chorus")
      species_hours[]  — top `top` species, each {common_name, scientific_name,
                         total, hours[24]} → the species×hour heatmap
      top_species[]    — full leaderboard {common_name, scientific_name, count}
      by_day[]         — {date, count, species} per Eastern day (volume + diversity)
      totals + busiest_hour (0–23) + peak_day
    The timestamp prefix substr(timestamp,1,13) = "YYYY-MM-DDtHH" works for both
    the "T"-separated ISO timestamps the pipeline writes and space-separated ones."""
    conn = get_db()
    rows = conn.execute(
        """SELECT substr(timestamp, 1, 13) AS hbucket,
                  common_name,
                  MAX(scientific_name) AS scientific_name,
                  COUNT(*) AS n
           FROM detections
           WHERE datetime(timestamp) >= datetime(?) AND datetime(timestamp) < datetime(?)
             AND confidence >= ?
           GROUP BY hbucket, common_name""",
        (start, end, min_confidence)
    ).fetchall()
    conn.close()

    by_hour = [0] * 24
    by_day  = {}     # eastern date -> {"count": int, "species": set()}
    sp_total = {}    # common_name -> total count
    sp_sci   = {}    # common_name -> scientific_name
    sp_hours = {}    # common_name -> [24] eastern-hour counts
    for r in rows:
        hb = r["hbucket"]
        try:
            uy, um, ud, uh = int(hb[0:4]), int(hb[5:7]), int(hb[8:10]), int(hb[11:13])
        except (ValueError, IndexError):
            continue
        edate, ehour = eastern_parts(uy, um, ud, uh)
        n = r["n"]
        common = r["common_name"]
        by_hour[ehour] += n
        day = by_day.setdefault(edate, {"count": 0, "species": set()})
        day["count"] += n
        day["species"].add(common)
        sp_total[common] = sp_total.get(common, 0) + n
        sp_sci.setdefault(common, r["scientific_name"])
        sp_hours.setdefault(common, [0] * 24)[ehour] += n

    total_detections = sum(sp_total.values())
    ranked = sorted(sp_total.items(), key=lambda kv: kv[1], reverse=True)
    top_species = [
        {"common_name": c, "scientific_name": sp_sci.get(c), "count": n}
        for c, n in ranked
    ]
    species_hours = [
        {"common_name": c, "scientific_name": sp_sci.get(c),
         "total": sp_total[c], "hours": sp_hours[c]}
        for c, _ in ranked[:top]
    ]
    by_day_list = [
        {"date": d, "count": v["count"], "species": len(v["species"])}
        for d, v in sorted(by_day.items())
    ]
    busiest_hour = max(range(24), key=lambda i: by_hour[i]) if total_detections else None
    peak_day = max(by_day_list, key=lambda d: d["count"]) if by_day_list else None

    return {
        "start": start, "end": end,
        "total_detections": total_detections,
        "total_species":    len(sp_total),
        "active_days":      len(by_day_list),
        "by_hour":          by_hour,
        "species_hours":    species_hours,
        "top_species":      top_species,
        "by_day":           by_day_list,
        "busiest_hour":     busiest_hour,
        "peak_day":         peak_day,
    }


@app.get("/api/stats")
def stats(min_confidence: float = 0.0):
    conn = get_db()
    total = conn.execute(
        "SELECT COUNT(*) FROM detections WHERE confidence >= ?", (min_confidence,)
    ).fetchone()[0]
    species_count = conn.execute("SELECT COUNT(*) FROM lifetime").fetchone()[0]
    today_count = conn.execute(
        "SELECT COUNT(*) FROM detections "
        "WHERE date(timestamp) = date('now', 'localtime') AND confidence >= ?",
        (min_confidence,)
    ).fetchone()[0]
    latest = conn.execute(
        "SELECT * FROM detections WHERE confidence >= ? ORDER BY timestamp DESC LIMIT 1",
        (min_confidence,)
    ).fetchone()
    conn.close()
    return {
        "total_detections": total,
        "total_species":    species_count,
        "detections_today": today_count,
        "latest_detection": dict(latest) if latest else None
    }


# ─────────────────────────────────────────────────────────────
# Solar Telemetry Endpoints — DISABLED
#
# Solar node (Pi Zero + Waveshare) is not deployed yet.
# The Pi and AudioMoth are currently running on indoor mains power.
# These endpoints are commented out until solar hardware is live.
# When re-enabling: add dependencies=[Depends(require_key)] to POST /api/solar.
#
# class SolarReading(BaseModel):
#     voltage_v:  float
#     current_ma: float
#     power_mw:   float
#     state:      str   # "CHARGING", "DISCHARGING", or "FLOAT"
#
# @app.post("/api/solar", dependencies=[Depends(require_key)])
# def ingest_solar(reading: SolarReading):
#     conn = get_db()
#     conn.execute(
#         """INSERT INTO solar_telemetry (timestamp, voltage_v, current_ma, power_mw, state)
#            VALUES (datetime('now'), ?, ?, ?, ?)""",
#         (reading.voltage_v, reading.current_ma, reading.power_mw, reading.state)
#     )
#     conn.commit()
#     conn.close()
#     return {"status": "ok"}
#
# @app.get("/api/solar/latest")
# def solar_latest():
#     conn = get_db()
#     row = conn.execute(
#         "SELECT * FROM solar_telemetry ORDER BY timestamp DESC LIMIT 1"
#     ).fetchone()
#     conn.close()
#     return dict(row) if row else {"error": "no data yet"}
#
# @app.get("/api/solar/history")
# def solar_history(hours: int = 24):
#     conn = get_db()
#     rows = conn.execute(
#         """SELECT * FROM solar_telemetry
#            WHERE timestamp > datetime('now', ? || ' hours')
#            ORDER BY timestamp ASC""",
#         (f"-{hours}",)
#     ).fetchall()
#     conn.close()
#     return {"readings": [dict(r) for r in rows], "count": len(rows)}
# ─────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────
# Pulse Feed (Lehigh Valley news) — populated by pulse_fetcher.py
# ─────────────────────────────────────────────────────────────

@app.get("/api/feed")
def get_feed(limit: int = 80):
    conn = get_db()
    items = conn.execute(
        """SELECT url AS link, title, source, source_key AS sourceKey,
                  published, category, ai_summary
           FROM feed_items
           ORDER BY (published IS NULL), published DESC
           LIMIT ?""",
        (limit,)
    ).fetchall()
    sources = conn.execute(
        """SELECT key, label, last_status, last_count, last_fetch
           FROM feed_sources WHERE enabled = 1 ORDER BY label"""
    ).fetchall()
    conn.close()
    return {
        "items":   [dict(r) for r in items],
        "sources": [dict(r) for r in sources],
    }

# ─────────────────────────────────────────────────────────────
# Pulse events / civic "What's On" Endpoints
# ─────────────────────────────────────────────────────────────

_EVENT_COLS = ("title", "kind", "starts_at", "ends_at", "all_day", "venue",
               "location", "url", "description", "source", "source_key",
               "dedup_key", "added_at")


def _eastern_today_date():
    """Today's date (YYYY-MM-DD) in Eastern, so 'upcoming' follows the venue clock
    rather than the box's UTC day."""
    if _EASTERN is not None:
        return datetime.now(_EASTERN).date().isoformat()
    return datetime.now(timezone.utc).date().isoformat()


@app.get("/api/events")
def get_events(kind: str = None, limit: int = 100, include_past: int = 0):
    """Public reader for the 'What's On' surface. Returns upcoming events
    (starts_at on/after today, Eastern) ordered soonest-first; `kind=event|civic`
    filters to one section. `include_past=1` returns everything (admin/debug)."""
    where, params = [], []
    if not include_past:
        where.append("substr(starts_at, 1, 10) >= ?")
        params.append(_eastern_today_date())
    if kind in ("event", "civic"):
        where.append("kind = ?")
        params.append(kind)
    sql = "SELECT " + ", ".join(_EVENT_COLS) + " FROM events"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY starts_at ASC LIMIT ?"
    params.append(max(1, min(limit, 500)))
    conn = get_db()
    try:
        rows = conn.execute(sql, tuple(params)).fetchall()
    except sqlite3.OperationalError:
        conn.close()
        return {"events": []}  # table not migrated yet — degrade quietly
    conn.close()
    return {"events": [dict(r) for r in rows]}


@app.post("/api/events", dependencies=[Depends(require_key)])
def add_events(body: dict):
    """Key-guarded writer: insert already-reviewed events (a list of row dicts, the
    shape event_parser.normalize() emits). dedup_key UNIQUE makes re-sends no-ops.
    Used by remote/web entry paths; the box CLI (pulse_add.py) writes the DB directly."""
    items = body.get("events") if isinstance(body, dict) else None
    if not isinstance(items, list) or not items:
        return {"error": "body must be {events: [ ... ]}"}
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    added = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        title = (it.get("title") or "").strip()
        starts_at = (it.get("starts_at") or "").strip()
        if not title or len(starts_at) < 10:
            continue
        kind = it.get("kind") if it.get("kind") in ("event", "civic") else "event"
        dk = (it.get("dedup_key") or "").strip() or "|".join(
            (title.lower(), starts_at[:10], (it.get("venue") or "").lower()))
        row = {
            "title": title, "kind": kind, "starts_at": starts_at,
            "ends_at": it.get("ends_at"), "all_day": 1 if it.get("all_day") else 0,
            "venue": it.get("venue"), "location": it.get("location"),
            "url": it.get("url"), "description": it.get("description"),
            "source": it.get("source") or "manual", "source_key": it.get("source_key"),
            "dedup_key": dk, "added_at": it.get("added_at") or now,
        }
        cur = conn.execute(
            "INSERT OR IGNORE INTO events (" + ", ".join(_EVENT_COLS) + ") VALUES ("
            + ", ".join("?" for _ in _EVENT_COLS) + ")",
            tuple(row[c] for c in _EVENT_COLS),
        )
        added += cur.rowcount
    conn.commit()
    conn.close()
    return {"ok": True, "added": added, "received": len(items)}

# ─────────────────────────────────────────────────────────────
# Train Detection Endpoints
# ─────────────────────────────────────────────────────────────

def eastern_today_bounds():
    """UTC ISO bounds [start, end) for 'today' in America/New_York, so train
    counts follow the page's Eastern day rather than the box's UTC day (evening-
    Eastern events are already next-day UTC and would otherwise drop off). train
    detected_at is tz-aware UTC ISO; compare with SQLite datetime() on both sides."""
    if _EASTERN is not None:
        start = (datetime.now(_EASTERN)
                 .replace(hour=0, minute=0, second=0, microsecond=0)
                 .astimezone(timezone.utc))
    else:
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


@app.get("/api/trains/stats")
def trains_stats():
    start, end = eastern_today_bounds()
    conn  = get_db()
    total = conn.execute("SELECT COUNT(*) FROM train_events").fetchone()[0]
    today_count = conn.execute(
        "SELECT COUNT(*) FROM train_events "
        "WHERE datetime(detected_at) >= datetime(?) AND datetime(detected_at) < datetime(?)",
        (start, end)
    ).fetchone()[0]
    unreviewed = conn.execute(
        "SELECT COUNT(*) FROM train_events WHERE reviewed = 0"
    ).fetchone()[0]
    # Approved-only counts for the public page (verdict='train', auto or verified).
    approved_total = conn.execute(
        "SELECT COUNT(*) FROM train_events WHERE verdict = 'train'"
    ).fetchone()[0]
    approved_today = conn.execute(
        "SELECT COUNT(*) FROM train_events WHERE verdict = 'train' "
        "AND datetime(detected_at) >= datetime(?) AND datetime(detected_at) < datetime(?)",
        (start, end)
    ).fetchone()[0]
    conn.close()
    return {
        "total_events":   total,
        "today_count":    today_count,
        "unreviewed":     unreviewed,
        "approved_total": approved_total,
        "approved_today": approved_today,
    }


@app.get("/api/trains/recent")
def trains_recent(limit: int = 20, approved: int = 0):
    # approved=1 → only human-confirmed trains (what the public page asks for, so
    # un-reviewed clips that may contain conversation never leave the box). The
    # default stays unfiltered for the authenticated review UI.
    conn = get_db()
    where = "WHERE verdict = 'train'" if approved else ""
    rows = conn.execute(
        f"""SELECT * FROM train_events
           {where}
           ORDER BY detected_at DESC LIMIT ?""",
        (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/trains/today")
def trains_today():
    start, end = eastern_today_bounds()
    conn  = get_db()
    rows  = conn.execute(
        """SELECT * FROM train_events
           WHERE verdict = 'train'
             AND datetime(detected_at) >= datetime(?) AND datetime(detected_at) < datetime(?)
           ORDER BY detected_at ASC""",
        (start, end)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/trains/analytics")
def trains_analytics(pass_gap_min: float = 5.0, start: str = None, end: str = None):
    """
    Approved train events grouped into *passes* — clips within `pass_gap_min`
    minutes are the same train (one pass can fire several clips) — then bucketed
    by Eastern hour-of-day, calendar day, and day-of-week×hour, plus the median
    *headway* (typical wait between passes). Counts are PASSES, not raw clips.

    Optional `start`/`end` (full UTC datetime strings, end exclusive — the same
    Eastern→UTC window the period selector sends to /api/analytics) scope the
    period buckets; `passes_today` stays the absolute Eastern-today count so the
    "Today" card is meaningful at any period. No window = all-time (unchanged).
    The compute lives in train_analytics.compute_train_analytics (FastAPI-free,
    unit-tested in test_trains_analytics.py).
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT detected_at, duration_s, peak_db FROM train_events "
        "WHERE verdict = 'train' ORDER BY detected_at ASC"
    ).fetchall()
    conn.close()
    today_start, today_end = eastern_today_bounds()
    return compute_train_analytics(
        rows, pass_gap_min=pass_gap_min, start=start, end=end,
        today_start=today_start, today_end=today_end,
    )


@app.get("/api/trains/clips", dependencies=[Depends(require_key)])
def list_clips():
    # Reviewer-only: lists every clip on disk (including un-vetted ones), so it's
    # behind the API key. The public page never calls this.
    files = sorted(
        [f for f in os.listdir(CLIP_DIR) if f.endswith(".wav")],
        reverse=True
    )
    return [
        {"filename": f, "url": f"/api/trains/clip/{f}"}
        for f in files
    ]


@app.get("/api/trains/clips/count", dependencies=[Depends(require_key)])
def clips_count():
    files = [f for f in os.listdir(CLIP_DIR) if f.endswith(".wav")]
    return {"count": len(files)}


@app.get("/api/trains/clip/{filename}")
def get_clip(filename: str):
    filename = os.path.basename(filename)  # prevent path traversal
    path     = os.path.join(CLIP_DIR, filename)
    if not os.path.exists(path):
        return JSONResponse({"error": "clip not found"}, status_code=404)
    # Privacy gate: only serve a clip for a human-approved train event that has
    # also been explicitly published (published=1). Un-reviewed, false-positive,
    # or count-only ("private") clips — which can contain conversation the mic
    # picked up — are never downloadable, even with a direct URL.
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM train_events "
        "WHERE clip_path LIKE ? AND verdict = 'train' AND published = 1 LIMIT 1",
        (f"%{filename}",)
    ).fetchone()
    conn.close()
    if row is None:
        return JSONResponse({"error": "clip not available"}, status_code=403)
    return FileResponse(path, media_type="audio/wav")


@app.post("/api/trains/{event_id}/verdict", dependencies=[Depends(require_key)])
def set_verdict(event_id: int, body: dict):
    verdict = body.get("verdict", "").strip()
    if verdict not in ("train", "false_positive", "unsure"):
        return {"error": "verdict must be: train, false_positive, or unsure"}
    conn = get_db()
    conn.execute(
        "UPDATE train_events SET reviewed = 1, verdict = ? WHERE id = ?",
        (verdict, event_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": event_id, "verdict": verdict}

@app.get("/api/digest")
def get_digest():
    # Returns the most recent brief by generated_at (morning or evening — pulse_digest
    # now writes two per day). Tolerant of the pre-2026-06-05 schema with no `slot`
    # column, so the API doesn't depend on the digest migration having run yet.
    conn = get_db()
    has_slot = any(r[1] == "slot" for r in
                   conn.execute("PRAGMA table_info(feed_digests)").fetchall())
    cols = "date, generated_at, headline, sections_json, citations_json" + \
           (", slot" if has_slot else "")
    row = conn.execute(
        f"SELECT {cols} FROM feed_digests ORDER BY generated_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return {}
    return {
        "date":         row["date"],
        "slot":         row["slot"] if has_slot else "morning",
        "generated_at": row["generated_at"],
        "headline":     row["headline"],
        "sections":     json.loads(row["sections_json"]),
        "citations":    json.loads(row["citations_json"]) if row["citations_json"] else [],
    }
