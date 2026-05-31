#!/usr/bin/env python3
"""
Train whistle detector — Emmaus Observatory P1 addon.
Reads the /backyard Icecast stream, detects sustained tonal events
in the 300-1500 Hz band characteristic of train whistles, saves a
WAV clip for each event, and logs to birdnet.db.
"""

import time
import sqlite3
import urllib.request
import wave
import collections
import os
import sys
import fcntl
import logging
import numpy as np
from datetime import datetime, timezone

# ── Configuration ─────────────────────────────────────────────────────────────
STREAM_URL      = "http://192.168.4.132:8000/backyard"
DB_PATH         = "/home/alan/birdnet.db"
CLIP_DIR        = "/home/alan/train_clips"
LOG_PATH        = "/home/alan/train_detector.log"
LOCK_PATH       = "/home/alan/train_detector.lock"   # single-instance guard

SAMPLE_RATE     = 22050   # resample target — sufficient for whistle detection
CHUNK_SECONDS   = 2       # analyse in 2-second windows

WHISTLE_LOW_HZ  = 300     # bottom of whistle detection band
WHISTLE_HIGH_HZ = 1500    # top of whistle detection band
ENERGY_THRESH   = 0.10    # fraction of spectral energy that must fall in band
                          # raise → fewer false positives; lower → catch quieter events
DB_THRESH_DB    = -20     # minimum loudness in dBFS — filters silence and distant noise
                          # raise → only log loud/close whistles; lower → catch distant ones

MERGE_GAP_S     = 30      # detections within this window are merged into one event
CLIP_PRE_S      = 10      # seconds of audio to include before the whistle started
CLIP_POST_S     = 10      # seconds of audio to include after the whistle ended
# ──────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)
log = logging.getLogger(__name__)


def acquire_singleton_lock():
    """
    Take an exclusive, non-blocking lock so only one detector runs at a time.
    If another instance already holds it (e.g. a stray duplicate unit), log and
    exit cleanly rather than double-reading the stream and double-writing events.
    Returns the open file handle, which must stay referenced for the process
    lifetime to keep the lock held.
    """
    lock_file = open(LOCK_PATH, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.warning("Another train_detector instance is already running — exiting.")
        sys.exit(0)
    return lock_file


def db_insert(detected_at, duration_s, peak_db, clip_path):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """INSERT INTO train_events
           (detected_at, duration_s, peak_db, clip_path)
           VALUES (?, ?, ?, ?)""",
        (detected_at, duration_s, peak_db, clip_path)
    )
    con.commit()
    con.close()


def is_whistle_chunk(audio):
    """
    Returns (True, peak_db) if this chunk looks like a train whistle.
    Two conditions must both be true:
      1. Loud enough  — RMS above DB_THRESH_DB
      2. Tonal enough — enough spectral energy concentrated in the whistle band
    """
    if len(audio) < SAMPLE_RATE * 0.5:
        return False, None

    rms = np.sqrt(np.mean(audio ** 2))
    if rms < 1e-6:
        return False, None

    peak_db = float(20 * np.log10(rms))
    if peak_db < DB_THRESH_DB:
        return False, None

    fft_mag      = np.abs(np.fft.rfft(audio))
    freqs        = np.fft.rfftfreq(len(audio), d=1.0 / SAMPLE_RATE)
    band         = (freqs >= WHISTLE_LOW_HZ) & (freqs <= WHISTLE_HIGH_HZ)
    band_energy  = float(np.sum(fft_mag[band] ** 2))
    total_energy = float(np.sum(fft_mag ** 2))

    if total_energy == 0:
        return False, None

    ratio = band_energy / total_energy
    return (ratio >= ENERGY_THRESH), peak_db


def save_clip(audio_buffer, event_start, event_end):
    """
    Pulls the relevant window from the rolling audio buffer and writes a WAV file.
    Returns the clip path, or None if no audio was available.
    """
    clip_start = event_start - CLIP_PRE_S
    clip_end   = event_end   + CLIP_POST_S

    chunks = [a for (t, a) in audio_buffer if clip_start <= t <= clip_end]
    if not chunks:
        return None

    audio_data  = np.concatenate(chunks)
    audio_int16 = (np.clip(audio_data, -1.0, 1.0) * 32767).astype(np.int16)

    ts_str    = datetime.fromtimestamp(event_start, tz=timezone.utc) \
                        .strftime("%Y-%m-%dT%H-%M-%S")
    clip_path = os.path.join(CLIP_DIR, f"train_{ts_str}.wav")

    with wave.open(clip_path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_int16.tobytes())

    return clip_path


def stream_chunks(url, chunk_seconds, sample_rate):
    """
    Generator: opens the Icecast MP3 stream and yields float32 numpy audio chunks.
    Reconnects automatically on any failure.
    """
    bytes_per_chunk = int(chunk_seconds * sample_rate * 2)  # 16-bit mono
    while True:
        try:
            log.info("Connecting to stream: %s", url)
            with urllib.request.urlopen(url, timeout=15) as resp:
                buf = b""
                while True:
                    data = resp.read(4096)
                    if not data:
                        break
                    buf += data
                    while len(buf) >= bytes_per_chunk:
                        raw   = np.frombuffer(buf[:bytes_per_chunk], dtype=np.int16)
                        audio = raw.astype(np.float32) / 32768.0
                        yield audio
                        buf = buf[bytes_per_chunk:]
        except Exception as exc:
            log.warning("Stream error: %s — reconnecting in 15s", exc)
            time.sleep(15)


def run():
    _lock = acquire_singleton_lock()  # held for the life of the process
    log.info("=" * 60)
    log.info("Train detector starting — Emmaus Observatory")
    log.info("Stream: %s", STREAM_URL)
    log.info("DB: %s", DB_PATH)
    log.info("Clip dir: %s", CLIP_DIR)
    log.info("Thresholds: energy=%.2f  loudness=%.0fdB", ENERGY_THRESH, DB_THRESH_DB)

    os.makedirs(CLIP_DIR, exist_ok=True)

    # Rolling audio buffer: keeps last (CLIP_PRE_S + 90s) of audio
    max_chunks   = int((CLIP_PRE_S + 90) / CHUNK_SECONDS)
    audio_buffer = collections.deque(maxlen=max_chunks)

    pending_start       = None
    pending_peak        = None
    last_detection_time = None

    for audio_chunk in stream_chunks(STREAM_URL, CHUNK_SECONDS, SAMPLE_RATE):
        now = time.time()
        audio_buffer.append((now, audio_chunk.copy()))

        whistle, peak_db = is_whistle_chunk(audio_chunk)

        if whistle:
            if pending_start is None:
                pending_start = now
                pending_peak  = peak_db
                log.info("Whistle candidate started (%.1fdB)", peak_db)
            else:
                if peak_db is not None and peak_db > pending_peak:
                    pending_peak = peak_db
            last_detection_time = now

        else:
            if pending_start is not None:
                gap = now - last_detection_time
                if gap > MERGE_GAP_S:
                    duration  = last_detection_time - pending_start
                    ts_iso    = datetime.fromtimestamp(
                                    pending_start, tz=timezone.utc
                                ).isoformat()

                    clip_path = save_clip(audio_buffer, pending_start, last_detection_time)
                    db_insert(ts_iso, round(duration, 1), round(pending_peak, 1), clip_path)

                    log.info(
                        "Train event logged: %s | %.1fs | %.1fdB | clip: %s",
                        ts_iso, duration, pending_peak,
                        os.path.basename(clip_path) if clip_path else "none"
                    )

                    pending_start       = None
                    pending_peak        = None
                    last_detection_time = None


if __name__ == "__main__":
    run()
