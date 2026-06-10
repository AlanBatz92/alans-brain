#!/usr/bin/env python3
"""
Emmaus Bird Observatory — BirdNET Pipeline
Captures 15s chunks from Icecast stream, analyzes with BirdNET-Analyzer 2.4.0,
logs detections to SQLite.
"""

import subprocess
import sqlite3
import os
import re
import shutil
import time
import csv
from datetime import datetime
from pathlib import Path

# Config
ICECAST_URL = "http://localhost:8000/backyard"
CHUNK_SECONDS = 15
WAV_PATH = "/tmp/bird_chunk.wav"
RESULT_DIR = "/tmp/birdnet_out"
DB_PATH = os.path.expanduser("~/birdnet.db")
BIRDNET_PYTHON = os.path.expanduser("~/BirdNET-Analyzer/birdnet-env/bin/python3")
LAT = 40.5376
LON = -75.4968
MIN_CONFIDENCE = 0.60            # preserve floor — keep detections at/above this.
                                 # 0.60 (not 0.35, not 0.85) keeps sub-85% *diagnostic*
                                 # hits so the bird cards can show why a species isn't yet
                                 # a lifer, while cutting the worst low-confidence noise.
                                 # The public page filters separately to >= 0.85; old
                                 # < 0.60 rows are cleared by purge_low_confidence.py.
LIFE_LIST_MIN_CONFIDENCE = 0.85  # a hit must clear this to count toward a lifer
LIFE_LIST_MIN_HITS = 3           # ...and a NEW species needs this many such hits
                                 #    within a rolling 24h window to join the life list
LIFE_LIST_INSTANT_CONFIDENCE = 0.995  # ...unless a single hit is this confident
                                      #    (~100%), which lists the species at once
# Cumulative-evidence path: a persistent, moderate-confidence species earns a spot
# once it accumulates LIFE_LIST_CUMULATIVE_HITS detections at or above
# LIFE_LIST_CUMULATIVE_CONFIDENCE — all-time, with NO 24h window. The reasoning:
# the 24h rule misses a real bird that's heard often but never quite hits 0.85
# (e.g. a Downy Woodpecker heard 10× averaging ~76%); many independent moderate
# detections are very unlikely to ALL be misfires, so the weight of evidence lists
# it. The floor sits above the preserve floor (0.60) so pure noise still can't pile up.
LIFE_LIST_CUMULATIVE_CONFIDENCE = 0.70
LIFE_LIST_CUMULATIVE_HITS = 8

# Seasonal filter: pass BirdNET's week-of-year so it filters the species list by
# season as well as by location (lat/lon). Cuts out-of-season false positives.
USE_WEEK_FILTER = True

# Verifiable lifers: archive a short WAV per life-list-qualifying detection
# (>= LIFE_LIST_MIN_CONFIDENCE), capped to one per species per local day, so the
# life list can be spot-checked and BirdNET scores calibrated against truth.
# Clips stay on the box and are NEVER served publicly — like train clips they can
# catch backyard conversation. purge_bird_clips.py ages out the unreviewed ones.
SAVE_LIFE_CLIPS = True
BIRD_CLIP_DIR = os.path.expanduser("~/bird_clips")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Idempotent column adds (each is a no-op once already applied).
    for col, decl in (("battery_voltage_v", "REAL"),
                      ("clip_path", "TEXT"),    # path to the archived verification clip
                      ("verified",  "TEXT")):   # review label: correct / wrong / unsure
        try:
            c.execute(f"ALTER TABLE detections ADD COLUMN {col} {decl}")
        except sqlite3.OperationalError:
            pass
    # lifetime: record HOW/WHEN a species made the life list, so the bird card can
    # state the exact qualifying path — and flag pre-rules "grandfathered" lifers
    # (added before the 0.85 bar) instead of showing them as meeting nothing.
    for col, decl in (("qualified_via", "TEXT"),   # instant_100 / burst_24h / cumulative_70 / grandfathered
                      ("qualified_at",  "TEXT")):   # ISO timestamp of the qualifying hit
        try:
            c.execute(f"ALTER TABLE lifetime ADD COLUMN {col} {decl}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    conn.close()


def birdnet_week(dt):
    """Date → BirdNET's 1–48 'week of year'. The range model treats every month
    as exactly 4 weeks (per BirdNET-Analyzer docs), so week = (month-1)*4 +
    week-of-month. (birdnetlib uses a day-of-year proportional variant; the two
    differ by at most ~1 week near month boundaries — immaterial to the filter.)"""
    return (dt.month - 1) * 4 + min((dt.day - 1) // 7, 3) + 1


def save_life_clip(common_name, now_dt):
    """Copy the just-analyzed 15 s chunk into the clip archive, named by time +
    species. Returns the path, or None on any error. Best-effort — never breaks
    the pipeline."""
    try:
        os.makedirs(BIRD_CLIP_DIR, exist_ok=True)
        ts   = now_dt.strftime("%Y-%m-%dT%H-%M-%S")
        slug = re.sub(r"[^A-Za-z0-9]+", "-", common_name).strip("-") or "bird"
        path = os.path.join(BIRD_CLIP_DIR, f"bird_{ts}_{slug}.wav")
        shutil.copy(WAV_PATH, path)
        return path
    except OSError:
        return None

def get_latest_battery_voltage():
    return None

def capture_chunk():
    result = subprocess.run([
        "ffmpeg", "-y",
        "-i", ICECAST_URL,
        "-t", str(CHUNK_SECONDS),
        "-ar", "48000",
        "-ac", "1",
        "-f", "wav",
        WAV_PATH
    ], capture_output=True, timeout=30)
    return result.returncode == 0

def run_birdnet():
    os.makedirs(RESULT_DIR, exist_ok=True)
    cmd = [
        BIRDNET_PYTHON, "-m", "birdnet_analyzer.analyze",
        WAV_PATH,
        "-o", RESULT_DIR,
        "--lat", str(LAT),
        "--lon", str(LON),
        "--min_conf", str(MIN_CONFIDENCE),
        "--rtype", "csv",
    ]
    # Season filter: restrict the species list to what's expected here this week.
    if USE_WEEK_FILTER:
        cmd += ["--week", str(birdnet_week(datetime.now()))]
    subprocess.run(cmd, capture_output=True, timeout=60)

    # Find the output CSV
    results = list(Path(RESULT_DIR).glob("*.csv"))
    return results[0] if results else None

def parse_and_log(result_file):
    if not result_file or not result_file.exists():
        return 0

    count = 0
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now_dt = datetime.now()
    now = now_dt.isoformat()
    week = birdnet_week(now_dt)   # store the same 1–48 week used for the filter
    battery_v = get_latest_battery_voltage()

    with open(result_file, newline="") as f:
        reader = csv.DictReader(f, delimiter=",")
        for row in reader:
            try:
                common_name = row.get("Common name", "").strip()
                scientific_name = row.get("Scientific name", "").strip()
                confidence = float(row.get("Confidence", 0))

                if not common_name or confidence < MIN_CONFIDENCE:
                    continue

                c.execute(
                    "INSERT INTO detections (timestamp, common_name, scientific_name, confidence, week) VALUES (?,?,?,?,?)",
                    (now, common_name, scientific_name, confidence, week)
                )
                det_id = c.lastrowid

                # Life list gate. Every preserved detection (>= MIN_CONFIDENCE, 0.60)
                # is logged and surfaces on the bird card's diagnostic hit list; the
                # main page shows only the >= 0.85 ones. A species earns a *permanent*
                # lifetime entry once it clears ANY of three paths:
                #   (1) LIFE_LIST_MIN_HITS hits at/above LIFE_LIST_MIN_CONFIDENCE (0.85)
                #       within a rolling 24-hour window — filters one-off mis-IDs;
                #   (2) a single near-certain hit (>= LIFE_LIST_INSTANT_CONFIDENCE,
                #       ~100%) — fast-tracks an unmistakable detection;
                #   (3) LIFE_LIST_CUMULATIVE_HITS hits at/above
                #       LIFE_LIST_CUMULATIVE_CONFIDENCE (0.70) all-time, no window —
                #       persistent moderate evidence (a bird heard often but never quite
                #       at 0.85 is still very unlikely to be repeated noise).
                # The gate is evaluated for any hit that can contribute to path 3, i.e.
                # at/above the cumulative floor (0.70).
                if confidence >= LIFE_LIST_CUMULATIVE_CONFIDENCE:
                    c.execute("SELECT total_detections FROM lifetime WHERE common_name=?", (common_name,))
                    existing = c.fetchone()
                    if existing:
                        # Already a lifer — recompute its tally from the detections
                        # table (this row is already inserted, so it's included)
                        # rather than +1'ing the stored value. A live recount can't
                        # drift, so the life-list total stays truthful even if a past
                        # update was missed or the species predates its lifetime row.
                        c.execute(
                            "UPDATE lifetime SET total_detections="
                            "(SELECT COUNT(*) FROM detections WHERE common_name=? AND confidence>=?) "
                            "WHERE common_name=?",
                            (common_name, LIFE_LIST_MIN_CONFIDENCE, common_name)
                        )
                    else:
                        # New species: count this species' confident hits in the
                        # last 24 hours (this row is already inserted, so it's
                        # counted). datetime() normalizes the stored ISO 'T'+microsecond
                        # timestamps so the comparison against datetime('now') is exact.
                        c.execute(
                            "SELECT COUNT(*) FROM detections "
                            "WHERE common_name=? AND confidence>=? "
                            "AND datetime(timestamp) >= datetime('now','-24 hours')",
                            (common_name, LIFE_LIST_MIN_CONFIDENCE)
                        )
                        hits_24h = c.fetchone()[0]
                        # Cumulative path: all-time hits at/above the cumulative floor.
                        c.execute(
                            "SELECT COUNT(*) FROM detections WHERE common_name=? AND confidence>=?",
                            (common_name, LIFE_LIST_CUMULATIVE_CONFIDENCE)
                        )
                        cumulative = c.fetchone()[0]
                        instant = confidence >= LIFE_LIST_INSTANT_CONFIDENCE
                        if instant or hits_24h >= LIFE_LIST_MIN_HITS or cumulative >= LIFE_LIST_CUMULATIVE_HITS:
                            # Seed the tally with the true all-time count of qualifying
                            # hits (>= life-list display floor), not just the 24h window.
                            c.execute(
                                "SELECT COUNT(*) FROM detections WHERE common_name=? AND confidence>=?",
                                (common_name, LIFE_LIST_MIN_CONFIDENCE)
                            )
                            total_qual = c.fetchone()[0]
                            # Which path tipped it — stored on the row (qualified_via)
                            # so the bird card can state exactly how it qualified, and
                            # so a current qualifier is distinguishable from a pre-rules
                            # grandfathered lifer.
                            if instant:
                                via, why = "instant_100", "instant ~100%"
                            elif hits_24h >= LIFE_LIST_MIN_HITS:
                                via, why = "burst_24h", f"{hits_24h} hits/24h"
                            else:
                                via, why = "cumulative_70", f"{cumulative} hits >= {LIFE_LIST_CUMULATIVE_CONFIDENCE:.0%} (cumulative)"
                            c.execute(
                                "INSERT INTO lifetime (common_name, scientific_name, first_seen, total_detections, qualified_via, qualified_at) "
                                "VALUES (?,?,?,?,?,?)",
                                (common_name, scientific_name, now, total_qual, via, now)
                            )
                            print(f"  *** NEW SPECIES: {common_name} ({why}) ***")

                # Verification clip for life-list-qualifying hits — one per species
                # per local day (keeps storage bounded). The archived chunk lets us
                # later confirm the ID and measure precision. Local-only, never public.
                if SAVE_LIFE_CLIPS and confidence >= LIFE_LIST_MIN_CONFIDENCE:
                    c.execute(
                        "SELECT 1 FROM detections WHERE common_name=? AND clip_path IS NOT NULL "
                        "AND date(timestamp)=date('now','localtime') LIMIT 1",
                        (common_name,)
                    )
                    if c.fetchone() is None:
                        clip_path = save_life_clip(common_name, now_dt)
                        if clip_path:
                            c.execute("UPDATE detections SET clip_path=? WHERE id=?",
                                      (clip_path, det_id))

                print(f"  [{confidence:.0%}] {common_name} ({scientific_name})")
                count += 1
            except (ValueError, KeyError):
                continue

    conn.commit()
    conn.close()

    # Clean up result file for next run
    result_file.unlink(missing_ok=True)
    return count

def main():
    print("Emmaus Bird Observatory pipeline starting...")
    init_db()
    while True:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"\n[{ts}] Capturing {CHUNK_SECONDS}s chunk...")
        if capture_chunk():
            result_file = run_birdnet()
            n = parse_and_log(result_file)
            if n == 0:
                print("  No detections above threshold.")
        else:
            print("  WARNING: Audio capture failed. Is the Pi streaming?")
            time.sleep(10)
        time.sleep(2)

if __name__ == "__main__":
    main()
