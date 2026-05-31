#!/usr/bin/env python3
"""
Emmaus Bird Observatory — FastAPI Server
"""
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

@app.get("/api/detections")
def recent_detections(limit: int = 50):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM detections ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return {"detections": [dict(r) for r in rows]}


@app.get("/api/today")
def today_detections():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM detections WHERE date(timestamp) = date('now', 'localtime') ORDER BY timestamp DESC"
    ).fetchall()
    conn.close()
    return {"detections": [dict(r) for r in rows], "count": len(rows)}


@app.get("/api/lifetime")
def lifetime_list():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM lifetime ORDER BY first_seen ASC"
    ).fetchall()
    conn.close()
    return {"species": [dict(r) for r in rows], "total_species": len(rows)}


@app.get("/api/stats")
def stats():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
    species_count = conn.execute("SELECT COUNT(*) FROM lifetime").fetchone()[0]
    today_count = conn.execute(
        "SELECT COUNT(*) FROM detections WHERE date(timestamp) = date('now', 'localtime')"
    ).fetchone()[0]
    latest = conn.execute(
        "SELECT * FROM detections ORDER BY timestamp DESC LIMIT 1"
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
    conn.close()
    return {
        "total_events": total,
        "today_count":  today_count,
        "unreviewed":   unreviewed
    }


@app.get("/api/trains/recent")
def trains_recent(limit: int = 20):
    conn = get_db()
    rows = conn.execute(
        """SELECT * FROM train_events
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
           WHERE detected_at LIKE ?
           ORDER BY detected_at ASC""",
        (f"{today}%",)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/trains/clips")
def list_clips():
    files = sorted(
        [f for f in os.listdir(CLIP_DIR) if f.endswith(".wav")],
        reverse=True
    )
    return [
        {"filename": f, "url": f"/api/trains/clip/{f}"}
        for f in files
    ]


@app.get("/api/trains/clips/count")
def clips_count():
    files = [f for f in os.listdir(CLIP_DIR) if f.endswith(".wav")]
    return {"count": len(files)}


@app.get("/api/trains/clip/{filename}")
def get_clip(filename: str):
    filename = os.path.basename(filename)  # prevent path traversal
    path     = os.path.join(CLIP_DIR, filename)
    if not os.path.exists(path):
        return {"error": "clip not found"}
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
