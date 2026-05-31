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
LIFE_LIST_MIN_CONFIDENCE = 0.70  # stricter gate before a species joins the life list

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

                # Life list: only confident detections earn a lifetime entry, so
                # low-confidence noise (e.g. a 40% "Carolina Wren") never creates a
                # lifer. The detections table still keeps everything >= MIN_CONFIDENCE.
                if confidence >= LIFE_LIST_MIN_CONFIDENCE:
                    c.execute("SELECT total_detections FROM lifetime WHERE common_name=?", (common_name,))
                    existing = c.fetchone()
                    if existing:
                        c.execute("UPDATE lifetime SET total_detections=? WHERE common_name=?",
                                  (existing[0] + 1, common_name))
                    else:
                        c.execute("INSERT INTO lifetime (common_name, scientific_name, first_seen, total_detections) VALUES (?,?,?,1)",
                                  (common_name, scientific_name, now))
                        print(f"  *** NEW SPECIES: {common_name} ***")

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
