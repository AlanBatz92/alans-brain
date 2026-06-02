#!/usr/bin/env python3
"""
Emmaus Bird Observatory — BirdNET Pipeline
Captures 15s chunks from Icecast stream, analyzes with BirdNET-Analyzer 2.4.0,
logs detections to SQLite.
"""

import subprocess
import sqlite3
import os
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
MIN_CONFIDENCE = 0.35            # log a detection at/above this confidence
LIFE_LIST_MIN_CONFIDENCE = 0.85  # a hit must clear this to count toward a lifer
LIFE_LIST_MIN_HITS = 3           # ...and a NEW species needs this many such hits
                                 #    within a rolling 24h window to join the life list
LIFE_LIST_INSTANT_CONFIDENCE = 0.995  # ...unless a single hit is this confident
                                      #    (~100%), which lists the species at once

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        c.execute("ALTER TABLE detections ADD COLUMN battery_voltage_v REAL")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()

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
    subprocess.run([
        BIRDNET_PYTHON, "-m", "birdnet_analyzer.analyze",
        WAV_PATH,
        "-o", RESULT_DIR,
        "--lat", str(LAT),
        "--lon", str(LON),
        "--min_conf", str(MIN_CONFIDENCE),
        "--rtype", "csv"
    ], capture_output=True, timeout=60)

    # Find the output CSV
    results = list(Path(RESULT_DIR).glob("*.csv"))
    return results[0] if results else None

def parse_and_log(result_file):
    if not result_file or not result_file.exists():
        return 0

    count = 0
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now().isoformat()
    week = int(datetime.now().strftime("%V"))
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

                # Life list gate. Every detection above MIN_CONFIDENCE is still
                # logged (and visualized on the Observatory page once >= 0.75),
                # but a species only earns a *permanent* lifetime entry once it
                # clears the stricter life-list gate: LIFE_LIST_MIN_HITS hits at
                # or above LIFE_LIST_MIN_CONFIDENCE within a rolling 24-hour
                # window, OR a single near-certain hit (>= LIFE_LIST_INSTANT_
                # CONFIDENCE, ~100%). The multi-hit rule filters one-off mis-IDs;
                # the instant rule fast-tracks a near-certain detection.
                if confidence >= LIFE_LIST_MIN_CONFIDENCE:
                    c.execute("SELECT total_detections FROM lifetime WHERE common_name=?", (common_name,))
                    existing = c.fetchone()
                    if existing:
                        # Already a lifer — just keep its running tally current.
                        c.execute("UPDATE lifetime SET total_detections=? WHERE common_name=?",
                                  (existing[0] + 1, common_name))
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
                        instant = confidence >= LIFE_LIST_INSTANT_CONFIDENCE
                        if instant or hits_24h >= LIFE_LIST_MIN_HITS:
                            c.execute(
                                "INSERT INTO lifetime (common_name, scientific_name, first_seen, total_detections) VALUES (?,?,?,?)",
                                (common_name, scientific_name, now, hits_24h)
                            )
                            why = "instant ~100%" if instant else f"{hits_24h} hits/24h"
                            print(f"  *** NEW SPECIES: {common_name} ({why}) ***")

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
