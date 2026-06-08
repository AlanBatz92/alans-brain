#!/usr/bin/env python3
"""
Train detector — Emmaus Observatory.
Reads the /backyard Icecast stream and uses a two-stage cascade:
  1. A loose, cheap trigger (sustained energy in 300-1500 Hz) decides when to
     grab a candidate clip — high recall, over-triggers on purpose.
  2. The calibrated horn detector (train_horn_detector + horn_profile.json)
     confirms each clip — high precision. Confirmed events are written
     verdict='train' (auto, shown on the page; audio kept private, published=0);
     the rest are verdict='false_positive' (the trigger's noise) and their clip
     is removed. No human pre-vetting — a person only strikes off the rare miss.
If the calibrated detector's deps aren't installed, events are written *pending*
(verdict NULL) and train_confirm.py scores them later.
"""

import time
import sqlite3
import subprocess
import wave
import collections
import os
import sys
import fcntl
import logging
import numpy as np
from datetime import datetime, timezone

# The calibrated horn detector confirms each candidate inline (see confirm_clip).
# Guarded import: if its deps (librosa/scipy) aren't in this venv yet, the service
# still runs and writes candidates as *pending* for train_confirm.py to score later.
try:
    import train_horn_detector as _thd
    _CONFIRM_ERR = None
except Exception as _exc:  # noqa: BLE001
    _thd = None
    _CONFIRM_ERR = _exc

# ── Configuration ─────────────────────────────────────────────────────────────
# Read the same mount the (working) BirdNET pipeline uses. The remote
# 192.168.4.132 mount was returning HTTP 404; Icecast serves /backyard reliably
# on localhost, so we read it there and let ffmpeg decode the MP3.
STREAM_URL      = "http://localhost:8000/backyard"
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


def ensure_train_columns(con):
    """Idempotently add category + published (matches bird_api.ensure_train_schema)."""
    cols = {r[1] for r in con.execute("PRAGMA table_info(train_events)")}
    if "category" not in cols:
        con.execute("ALTER TABLE train_events ADD COLUMN category TEXT")
    if "published" not in cols:
        con.execute("ALTER TABLE train_events ADD COLUMN published INTEGER DEFAULT 0")
        con.execute("UPDATE train_events SET published = 1 WHERE verdict = 'train'")
    con.commit()


def confirm_clip(clip_path):
    """
    Run the calibrated horn detector on a candidate clip.
    Returns 'train' (a horn was confirmed), 'false_positive' (no horn), or None if
    confirmation isn't available (deps missing / no clip / score error) — in which
    case the event is written pending for train_confirm.py to score later.
    """
    if _thd is None or not clip_path:
        return None
    try:
        events = _thd.process_file(clip_path, verbose=False)
        return "train" if events else "false_positive"
    except Exception as exc:  # noqa: BLE001
        log.warning("confirm error for %s: %s", clip_path, exc)
        return None


def db_insert(detected_at, duration_s, peak_db, clip_path, verdict):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """INSERT INTO train_events
           (detected_at, duration_s, peak_db, clip_path, reviewed, verdict, category, published)
           VALUES (?, ?, ?, ?, 0, ?, ?, 0)""",
        (detected_at, duration_s, peak_db, clip_path, verdict,
         "train" if verdict == "train" else None)
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
    Generator: pipes the Icecast MP3 stream through ffmpeg and yields float32
    numpy audio chunks. ffmpeg decodes the MP3 and resamples to mono PCM s16le at
    `sample_rate`, so the bytes we read are real audio samples — the previous
    version read the *encoded* MP3 bytes as int16 PCM (garbage), which is why no
    event ever fired. Reconnects (relaunches ffmpeg) automatically on any failure.
    """
    bytes_per_chunk = int(chunk_seconds * sample_rate * 2)  # 16-bit mono
    while True:
        proc = None
        try:
            log.info("Connecting to stream via ffmpeg: %s", url)
            proc = subprocess.Popen(
                [
                    "ffmpeg", "-loglevel", "error",
                    "-i", url,
                    "-f", "s16le",          # raw PCM out
                    "-acodec", "pcm_s16le",
                    "-ac", "1",             # mono
                    "-ar", str(sample_rate),
                    "pipe:1",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            buf = b""
            while True:
                data = proc.stdout.read(4096)
                if not data:
                    break  # ffmpeg exited (stream dropped) — reconnect below
                buf += data
                while len(buf) >= bytes_per_chunk:
                    raw   = np.frombuffer(buf[:bytes_per_chunk], dtype=np.int16)
                    audio = raw.astype(np.float32) / 32768.0
                    yield audio
                    buf = buf[bytes_per_chunk:]
        except Exception as exc:
            log.warning("Stream error: %s — reconnecting in 15s", exc)
        finally:
            if proc is not None:
                try:
                    proc.kill()
                except Exception:
                    pass
        time.sleep(15)


def run():
    _lock = acquire_singleton_lock()  # held for the life of the process
    log.info("=" * 60)
    log.info("Train detector starting — Emmaus Observatory")
    log.info("Stream: %s", STREAM_URL)
    log.info("DB: %s", DB_PATH)
    log.info("Clip dir: %s", CLIP_DIR)
    log.info("Thresholds: energy=%.2f  loudness=%.0fdB", ENERGY_THRESH, DB_THRESH_DB)

    # Stage 2: load the calibration so inline confirmation matches what was tuned.
    if _thd is not None:
        prof = _thd.DEFAULT_PROFILE_PATH
        if prof.exists():
            try:
                _thd.load_profile(str(prof))
                log.info("Confirm stage: calibrated horn detector (profile %s)", prof)
            except Exception as exc:  # bad/corrupt profile must not crash-loop the service
                log.warning("Confirm stage: couldn't load %s (%s) — using defaults.",
                            prof, exc)
        else:
            log.warning("Confirm stage: no horn_profile.json next to "
                        "train_horn_detector.py — confirming on UNCALIBRATED defaults.")
    else:
        log.warning("Confirm stage unavailable (%s) — writing events PENDING; "
                    "install librosa/scipy and run train_confirm.py to score them.",
                    _CONFIRM_ERR)

    os.makedirs(CLIP_DIR, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    ensure_train_columns(con)
    con.close()

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

                    # Stage 2: confirm the candidate with the calibrated detector.
                    # Rejected clips are kept (hidden) until the weekly purge, so a
                    # recalibration + train_confirm.py --rescore can recover them.
                    verdict = confirm_clip(clip_path)
                    db_insert(ts_iso, round(duration, 1), round(pending_peak, 1),
                              clip_path, verdict)

                    log.info(
                        "Candidate %s: %s | %.1fs | %.1fdB | clip: %s",
                        verdict or "pending", ts_iso, duration, pending_peak,
                        os.path.basename(clip_path) if clip_path else "none"
                    )

                    pending_start       = None
                    pending_peak        = None
                    last_detection_time = None


if __name__ == "__main__":
    run()
