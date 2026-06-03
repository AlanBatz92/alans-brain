#!/usr/bin/env python3
"""
Emmaus Bird Observatory — FastAPI Server
"""
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from datetime import datetime, timezone
from pydantic import BaseModel
import sqlite3
import os
import json

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
#                      or one ~100% hit.
# Keep these in sync with the pipeline.
PRESERVE_MIN_CONFIDENCE  = 0.60
LIFE_LIST_MIN_CONFIDENCE = 0.85
LIFE_LIST_MIN_HITS = 3

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
    # Life-list progress: this species' qualifying hits (>= the life-list floor)
    # within the rolling 24h window the writer uses, and whether it's listed yet.
    hits_24h = conn.execute(
        "SELECT COUNT(*) FROM detections "
        "WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ? "
        "AND datetime(timestamp) >= datetime('now','-24 hours')",
        (common, scientific, LIFE_LIST_MIN_CONFIDENCE)
    ).fetchone()[0]
    on_life_list = conn.execute(
        "SELECT 1 FROM lifetime WHERE common_name = ? OR scientific_name = ? LIMIT 1",
        (common, scientific)
    ).fetchone() is not None
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
        "on_life_list":       on_life_list,
    }


@app.get("/api/detections/grouped")
def detections_grouped(start: str, end: str, min_confidence: float = 0.85):
    """Species grouped by UTC datetime range; powers the period selector in the Observatory.
    start / end are full UTC datetime strings ("YYYY-MM-DD HH:MM:SS") sent by the
    front-end after converting Eastern midnight → UTC, so late-night detections
    (e.g. 10 PM Eastern = 2 AM UTC next day) fall in the correct Eastern day."""
    conn = get_db()
    rows = conn.execute(
        """SELECT common_name, scientific_name,
                  COUNT(*) AS count,
                  MAX(confidence) AS best_confidence,
                  MIN(timestamp) AS first_heard,
                  MAX(timestamp) AS last_heard
           FROM detections
           WHERE timestamp >= ? AND timestamp < ?
             AND confidence >= ?
           GROUP BY common_name
           ORDER BY MAX(timestamp) DESC""",
        (start, end, min_confidence)
    ).fetchall()
    conn.close()
    return {"species": [dict(r) for r in rows], "start": start, "end": end}


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
# Train Detection Endpoints
# ─────────────────────────────────────────────────────────────

@app.get("/api/trains/stats")
def trains_stats():
    today = datetime.now(timezone.utc).date().isoformat()
    conn  = get_db()
    total = conn.execute("SELECT COUNT(*) FROM train_events").fetchone()[0]
    today_count = conn.execute(
        "SELECT COUNT(*) FROM train_events WHERE detected_at LIKE ?",
        (f"{today}%",)
    ).fetchone()[0]
    unreviewed = conn.execute(
        "SELECT COUNT(*) FROM train_events WHERE reviewed = 0"
    ).fetchone()[0]
    # Approved-only counts for the public page (a human marked verdict='train').
    approved_total = conn.execute(
        "SELECT COUNT(*) FROM train_events WHERE verdict = 'train'"
    ).fetchone()[0]
    approved_today = conn.execute(
        "SELECT COUNT(*) FROM train_events WHERE verdict = 'train' AND detected_at LIKE ?",
        (f"{today}%",)
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
    today = datetime.now(timezone.utc).date().isoformat()
    conn  = get_db()
    rows  = conn.execute(
        """SELECT * FROM train_events
           WHERE detected_at LIKE ? AND verdict = 'train'
           ORDER BY detected_at ASC""",
        (f"{today}%",)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


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
    # Privacy gate: only serve a clip that belongs to a human-approved train
    # event. Un-reviewed / false-positive clips (which can contain conversation
    # the mic picked up) are never downloadable, even with a direct URL.
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM train_events WHERE clip_path LIKE ? AND verdict = 'train' LIMIT 1",
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
    conn = get_db()
    row = conn.execute(
        """SELECT date, generated_at, headline, sections_json, citations_json
           FROM feed_digests ORDER BY date DESC LIMIT 1"""
    ).fetchone()
    conn.close()
    if not row:
        return {}
    return {
        "date":         row["date"],
        "generated_at": row["generated_at"],
        "headline":     row["headline"],
        "sections":     json.loads(row["sections_json"]),
        "citations":    json.loads(row["citations_json"]) if row["citations_json"] else [],
    }
