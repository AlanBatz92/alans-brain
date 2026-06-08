"""
train_horn_detector.py
======================
Emmaus Observatory — P2 Freight Train Acoustic Study
Detects train horn/whistle events in AudioMoth recordings.

Strategy:
  - Primary signal: sustained tonal energy in the 250–600 Hz band
  - Confirmation: 2+ horn blasts within a 90-second window = train event
  - Mic is ~1500–1700 ft from tracks; rumble is unreliable, horn is the target

The detection thresholds below start as educated guesses. Once you have a
labeled corpus, run `build_horn_profile.py` against it — it writes a
`horn_profile.json` that this script loads at startup (via --profile or by
finding it next to this file), overriding the guesses with values measured
from real horns at this exact mic placement.

Dependencies:
  pip install librosa numpy scipy

Usage:
  # Scan a single file
  python train_horn_detector.py path/to/recording.WAV

  # Scan a directory of AudioMoth recordings
  python train_horn_detector.py path/to/recordings/

  # Output results to a CSV log
  python train_horn_detector.py path/to/recordings/ --output detections.csv

  # Tune sensitivity (default: medium)
  python train_horn_detector.py path/to/recordings/ --sensitivity high

  # Use a calibration profile produced by build_horn_profile.py
  python train_horn_detector.py path/to/recordings/ --profile horn_profile.json
"""

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

import librosa
import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import find_peaks


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# AudioMoth filename format: YYYYMMDD_HHMMSS.WAV
AUDIOMOTH_FILENAME_PATTERN = "%Y%m%d_%H%M%S"

# Frequency band of interest — train horn fundamentals cluster here
HORN_FREQ_LOW_HZ = 250
HORN_FREQ_HIGH_HZ = 600

# A horn blast must be tonal (narrow spectral peak), not broadband (wind/thunder).
# This ratio = energy in horn band / energy in surrounding broadband window.
# Sirens/horns are tonal → high ratio. Thunder/wind → low ratio.
TONALITY_RATIO_THRESHOLD = {
    "low":    2.5,   # more sensitive, more false positives
    "medium": 3.5,   # recommended starting point
    "high":   5.0,   # stricter, may miss distant/faint horns
}

# Minimum RMS energy in the horn band to consider a frame active
# (filters out quiet background hum that passes the tonality check)
RMS_THRESHOLD_PERCENTILE = 85  # top 15% of frames by horn-band RMS

# A single horn blast: sustained above threshold for at least this long
BLAST_MIN_DURATION_SEC = 1.5
BLAST_MAX_DURATION_SEC = 10.0  # longer than this is probably not a horn

# Confirmation window: 2+ blasts within this many seconds = train event
CONFIRMATION_WINDOW_SEC = 90.0
MIN_BLASTS_FOR_CONFIRMATION = 2

# Merge blasts that are very close together (same horn note held/released)
BLAST_MERGE_GAP_SEC = 0.8

# Audio loading: downsample for speed (22050 is AudioMoth native, fine to keep)
TARGET_SR = 22050


# ---------------------------------------------------------------------------
# Runtime calibration profile
# ---------------------------------------------------------------------------
# build_horn_profile.py measures the constants above from a labeled corpus and
# writes them to horn_profile.json. load_profile() folds that file back in so
# the deployed detector runs on values tuned for *this* mic, not the defaults.

# Maps a key in horn_profile.json → the module-level constant it overrides.
PROFILE_KEYS = {
    "horn_freq_low_hz":           "HORN_FREQ_LOW_HZ",
    "horn_freq_high_hz":          "HORN_FREQ_HIGH_HZ",
    "tonality_ratio_threshold":   "TONALITY_RATIO_THRESHOLD",
    "rms_threshold_percentile":   "RMS_THRESHOLD_PERCENTILE",
    "blast_min_duration_sec":     "BLAST_MIN_DURATION_SEC",
    "blast_max_duration_sec":     "BLAST_MAX_DURATION_SEC",
    "confirmation_window_sec":    "CONFIRMATION_WINDOW_SEC",
    "min_blasts_for_confirmation": "MIN_BLASTS_FOR_CONFIRMATION",
    "blast_merge_gap_sec":        "BLAST_MERGE_GAP_SEC",
}

# Profile auto-discovered next to this script when --profile isn't given.
DEFAULT_PROFILE_PATH = Path(__file__).with_name("horn_profile.json")


def load_profile(path: str) -> List[tuple]:
    """
    Override the module-level detection constants from a horn_profile.json.

    Returns a list of (constant_name, old_value, new_value) tuples for the
    values that actually changed, so the caller can report what was applied.
    Only keys present in the file are touched; TONALITY_RATIO_THRESHOLD is
    *merged* (a profile may set only "medium" and keep the other tiers).
    """
    with open(path) as f:
        data = json.load(f)

    changes = []
    g = globals()
    for json_key, const_name in PROFILE_KEYS.items():
        if json_key not in data:
            continue
        new_value = data[json_key]
        old_value = g[const_name]

        # Merge dicts (tonality tiers) rather than replacing wholesale.
        if isinstance(old_value, dict) and isinstance(new_value, dict):
            merged = dict(old_value)
            merged.update(new_value)
            new_value = merged

        if new_value != old_value:
            g[const_name] = new_value
            changes.append((const_name, old_value, new_value))

    return changes


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class HornBlast:
    """A single candidate horn blast."""
    start_sec: float
    end_sec: float
    peak_tonality: float
    peak_rms: float

    @property
    def duration(self) -> float:
        return self.end_sec - self.start_sec

    @property
    def midpoint(self) -> float:
        return (self.start_sec + self.end_sec) / 2


@dataclass
class TrainEvent:
    """A confirmed train passage: 2+ horn blasts within the window."""
    blasts: List[HornBlast] = field(default_factory=list)
    source_file: str = ""
    file_start_time: Optional[datetime] = None  # parsed from filename if available

    @property
    def first_blast_sec(self) -> float:
        return self.blasts[0].start_sec

    @property
    def last_blast_sec(self) -> float:
        return self.blasts[-1].end_sec

    @property
    def span_sec(self) -> float:
        return self.last_blast_sec - self.first_blast_sec

    @property
    def blast_count(self) -> int:
        return len(self.blasts)

    @property
    def wall_clock_time(self) -> Optional[datetime]:
        """Absolute timestamp of first horn blast, if filename is parseable."""
        if self.file_start_time is None:
            return None
        return self.file_start_time + timedelta(seconds=self.first_blast_sec)

    def summary(self) -> str:
        ts = self.wall_clock_time
        ts_str = ts.strftime("%Y-%m-%d %H:%M:%S") if ts else "unknown time"
        return (
            f"TRAIN @ {ts_str} | "
            f"file: {Path(self.source_file).name} | "
            f"{self.blast_count} blasts over {self.span_sec:.1f}s | "
            f"first blast: {self.first_blast_sec:.1f}s into file"
        )


# ---------------------------------------------------------------------------
# Core detection logic
# ---------------------------------------------------------------------------

def parse_audiomoth_timestamp(filepath: str) -> Optional[datetime]:
    """
    AudioMoth names files YYYYMMDD_HHMMSS.WAV.
    Returns a datetime or None if the filename doesn't match.
    """
    stem = Path(filepath).stem
    try:
        return datetime.strptime(stem, AUDIOMOTH_FILENAME_PATTERN)
    except ValueError:
        return None


def extract_horn_band_features(
    y: np.ndarray,
    sr: int,
    low_hz: Optional[float] = None,
    high_hz: Optional[float] = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Returns (rms_envelope, tonality_ratio) arrays, one value per STFT frame.

    tonality_ratio = energy in horn band / energy in broadband reference window.
    High values = tonal (horn-like). Low values = broadband noise.

    `low_hz`/`high_hz` override the module horn band for that call without
    mutating the globals — build_horn_profile.py uses this to evaluate
    candidate bands. They default to the module constants.
    """
    # STFT with a frame size that gives ~23ms resolution at 22050 Hz
    n_fft = 1024
    hop_length = 512

    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # Horn band mask
    low = HORN_FREQ_LOW_HZ if low_hz is None else low_hz
    high = HORN_FREQ_HIGH_HZ if high_hz is None else high_hz
    horn_mask = (freqs >= low) & (freqs <= high)

    # Broadband reference: wider window around horn band (100–1200 Hz)
    broad_mask = (freqs >= 100) & (freqs <= 1200)

    # Per-frame energy in each band
    horn_energy = S[horn_mask, :].mean(axis=0)
    broad_energy = S[broad_mask, :].mean(axis=0)

    # Tonality ratio. Divide only where the denominator is non-trivial (silent
    # frames have ~0 broadband energy); np.where would still evaluate the full
    # division first and emit a spurious "invalid value in divide" warning.
    tonality = np.divide(
        horn_energy, broad_energy,
        out=np.zeros_like(horn_energy),
        where=broad_energy > 1e-8,
    )

    # RMS in horn band per frame
    rms = horn_energy  # mean amplitude in horn band, proportional to RMS

    return rms, tonality


def find_horn_blasts(
    rms: np.ndarray,
    tonality: np.ndarray,
    sr: int,
    hop_length: int,
    sensitivity: str = "medium",
) -> List[HornBlast]:
    """
    Identifies individual horn blasts from the feature arrays.
    Returns a list of HornBlast objects with time positions in seconds.
    """
    tonality_thresh = TONALITY_RATIO_THRESHOLD[sensitivity]

    # RMS threshold: top percentile of horn-band energy in this file
    rms_thresh = np.percentile(rms, RMS_THRESHOLD_PERCENTILE)

    # Active frames: both tonal AND loud enough
    active = (tonality >= tonality_thresh) & (rms >= rms_thresh)

    # Smooth briefly to fill tiny gaps within a blast
    smoothed = uniform_filter1d(active.astype(float), size=5) > 0.3

    # Convert frame indices to seconds
    def frames_to_sec(f):
        return librosa.frames_to_time(f, sr=sr, hop_length=hop_length)

    # Walk the boolean array to find contiguous active regions
    blasts = []
    in_blast = False
    blast_start = 0

    for i, val in enumerate(smoothed):
        if val and not in_blast:
            in_blast = True
            blast_start = i
        elif not val and in_blast:
            in_blast = False
            start_sec = frames_to_sec(blast_start)
            end_sec = frames_to_sec(i)
            duration = end_sec - start_sec

            if BLAST_MIN_DURATION_SEC <= duration <= BLAST_MAX_DURATION_SEC:
                blast_rms = rms[blast_start:i].max()
                blast_ton = tonality[blast_start:i].max()
                blasts.append(HornBlast(
                    start_sec=start_sec,
                    end_sec=end_sec,
                    peak_tonality=blast_ton,
                    peak_rms=blast_rms,
                ))

    # Handle blast that runs to end of file
    if in_blast:
        start_sec = frames_to_sec(blast_start)
        end_sec = frames_to_sec(len(smoothed))
        duration = end_sec - start_sec
        if BLAST_MIN_DURATION_SEC <= duration <= BLAST_MAX_DURATION_SEC:
            blasts.append(HornBlast(
                start_sec=start_sec,
                end_sec=end_sec,
                peak_tonality=tonality[blast_start:].max(),
                peak_rms=rms[blast_start:].max(),
            ))

    # Merge blasts with very small gaps (same note held with brief drop)
    merged = []
    for blast in blasts:
        if merged and (blast.start_sec - merged[-1].end_sec) < BLAST_MERGE_GAP_SEC:
            prev = merged[-1]
            merged[-1] = HornBlast(
                start_sec=prev.start_sec,
                end_sec=blast.end_sec,
                peak_tonality=max(prev.peak_tonality, blast.peak_tonality),
                peak_rms=max(prev.peak_rms, blast.peak_rms),
            )
        else:
            merged.append(blast)

    return merged


def confirm_train_events(
    blasts: List[HornBlast],
    source_file: str,
) -> List[TrainEvent]:
    """
    Groups blasts into confirmed train events using a sliding window.
    Any 2+ blasts within CONFIRMATION_WINDOW_SEC = one train event.
    """
    if not blasts:
        return []

    file_time = parse_audiomoth_timestamp(source_file)
    events = []
    used = [False] * len(blasts)

    for i, anchor in enumerate(blasts):
        if used[i]:
            continue

        # Find all blasts within the confirmation window of this anchor
        group = [anchor]
        used[i] = True

        for j in range(i + 1, len(blasts)):
            if blasts[j].start_sec - anchor.start_sec <= CONFIRMATION_WINDOW_SEC:
                if not used[j]:
                    group.append(blasts[j])
                    used[j] = True
            else:
                break  # blasts are in order, no need to continue

        if len(group) >= MIN_BLASTS_FOR_CONFIRMATION:
            events.append(TrainEvent(
                blasts=group,
                source_file=source_file,
                file_start_time=file_time,
            ))

    return events


def process_file(
    filepath: str,
    sensitivity: str = "medium",
    verbose: bool = True,
) -> List[TrainEvent]:
    """
    Full pipeline for a single audio file.
    Returns a list of confirmed TrainEvent objects.
    """
    if verbose:
        print(f"  Processing: {Path(filepath).name}", end="", flush=True)

    try:
        y, sr = librosa.load(filepath, sr=TARGET_SR, mono=True)
    except Exception as e:
        print(f" — LOAD ERROR: {e}")
        return []

    hop_length = 512
    rms, tonality = extract_horn_band_features(y, sr)
    blasts = find_horn_blasts(rms, tonality, sr, hop_length, sensitivity)
    events = confirm_train_events(blasts, filepath)

    if verbose:
        if events:
            print(f" — {len(events)} train event(s), {len(blasts)} total blasts")
        else:
            print(f" — no events ({len(blasts)} blast candidate(s))")

    return events


# ---------------------------------------------------------------------------
# Batch processing and output
# ---------------------------------------------------------------------------

def scan_directory(
    dirpath: str,
    sensitivity: str = "medium",
    extensions: tuple = (".wav", ".WAV"),
) -> List[TrainEvent]:
    """Recursively scan a directory for audio files and process each."""
    audio_files = sorted([
        str(p) for p in Path(dirpath).rglob("*")
        if p.suffix in extensions
    ])

    if not audio_files:
        print(f"No audio files found in {dirpath}")
        return []

    print(f"Found {len(audio_files)} audio file(s). Scanning...\n")
    all_events = []

    for f in audio_files:
        events = process_file(f, sensitivity=sensitivity)
        all_events.extend(events)

    return all_events


def write_csv(events: List[TrainEvent], output_path: str):
    """Write detection results to a CSV for downstream schedule analysis."""
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "wall_clock_time",
            "source_file",
            "first_blast_sec",
            "last_blast_sec",
            "span_sec",
            "blast_count",
            "peak_tonality",
            "peak_rms",
        ])
        for event in events:
            writer.writerow([
                event.wall_clock_time.strftime("%Y-%m-%d %H:%M:%S") if event.wall_clock_time else "",
                Path(event.source_file).name,
                f"{event.first_blast_sec:.2f}",
                f"{event.last_blast_sec:.2f}",
                f"{event.span_sec:.2f}",
                event.blast_count,
                f"{max(b.peak_tonality for b in event.blasts):.3f}",
                f"{max(b.peak_rms for b in event.blasts):.6f}",
            ])
    print(f"\nResults written to: {output_path}")


def print_summary(events: List[TrainEvent]):
    print(f"\n{'='*60}")
    print(f"DETECTION SUMMARY — {len(events)} confirmed train event(s)")
    print(f"{'='*60}")
    for event in events:
        print(f"  {event.summary()}")
    if not events:
        print("  No train events detected.")
    print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Detect train horn events in AudioMoth recordings."
    )
    parser.add_argument(
        "path",
        help="Path to a single audio file or a directory of recordings.",
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Path to write CSV output (optional).",
    )
    parser.add_argument(
        "--sensitivity", "-s",
        choices=["low", "medium", "high"],
        default="medium",
        help="Detection sensitivity. Start with 'medium', tune from there.",
    )
    parser.add_argument(
        "--profile", "-p",
        default=None,
        help="Path to a horn_profile.json from build_horn_profile.py. If omitted, "
             "a horn_profile.json next to this script is used when present.",
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress per-file progress output.",
    )
    args = parser.parse_args()

    # Apply a calibration profile before any detection runs. An explicit
    # --profile must exist; the auto-discovered one is silently skipped if absent.
    profile_path = args.profile or (
        str(DEFAULT_PROFILE_PATH) if DEFAULT_PROFILE_PATH.exists() else None
    )
    if profile_path:
        if not os.path.exists(profile_path):
            print(f"Error: profile not found: {profile_path}")
            sys.exit(1)
        changes = load_profile(profile_path)
        if not args.quiet:
            print(f"Loaded calibration profile: {profile_path}")
            for name, old, new in changes:
                print(f"  {name}: {old} → {new}")
            print()

    target = Path(args.path)
    if not target.exists():
        print(f"Error: path not found: {args.path}")
        sys.exit(1)

    if target.is_dir():
        events = scan_directory(str(target), sensitivity=args.sensitivity)
    else:
        events = process_file(str(target), sensitivity=args.sensitivity, verbose=not args.quiet)

    print_summary(events)

    if args.output:
        write_csv(events, args.output)


if __name__ == "__main__":
    main()
