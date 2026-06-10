#!/usr/bin/env python3
"""
build_horn_profile.py — calibrate train_horn_detector.py from a labeled corpus.

Emmaus Observatory — P2 Freight Train Acoustic Study.

train_horn_detector.py ships with educated-guess thresholds (250–600 Hz horn
band, tonality ratio 3.5, etc.). This is the one-time profiling pass that
replaces those guesses with values measured from real recordings at *this* mic
placement (~1500–1700 ft from the tracks), where only the part of the horn that
survives the distance matters.

Point it at two folders — confirmed train horns, and confirmed no-train audio —
and it does two things:

  1. SPECTRAL ANALYSIS — finds the frequency band where the positives carry
     energy the negatives don't. That contrast band is the real horn signature
     here; it may be narrower than the 250–600 Hz default. Plots the positive vs
     negative average spectra (band shaded) and an onset-aligned average horn
     spectrogram so the signature is visually obvious.

  2. THRESHOLD CALIBRATION — runs the detector's own feature math over every
     file and compares positives against negatives for tonality ratio, blast
     duration, inter-blast gap, and horn-band RMS. Plots each distribution pair,
     picks thresholds that sit in the separation gap, and reports the
     precision/recall they'd give on this corpus.

It prints a ready-to-paste parameter block for train_horn_detector.py and (unless
--no-json) writes horn_profile.json, which the detector loads at runtime — so the
calibration flows straight into the deployed detector with no hand-editing.

Calibrations are measured against the detector's actual functions (imported, not
re-implemented), so the numbers reflect what the deployed code will really do.

Dependencies:
  pip install librosa numpy scipy matplotlib

Corpus layout (the easy way) — one folder, a subfolder per sound class:
  corpus/
    trains/         <- confirmed horns (the positives)
    vehicles/       <- everything else = a labeled negative class
    planes/
    gunshots/
    construction/
    unsure/         <- skipped (parking lot for "not sure yet")

Usage:
  # Am I ready? (census + verdict, no calibration — run it while still sorting)
  python3 build_horn_profile.py --corpus ./corpus --check

  # Full calibration (derives the band, picks thresholds, validates end-to-end)
  python3 build_horn_profile.py --corpus ./corpus

  # Or point at the two classes explicitly (negatives can be several dirs):
  python3 build_horn_profile.py -p ./trains -n ./planes ./vehicles ./gunshots
"""

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional

import numpy as np
import librosa

# Calibrate against the detector's real math — import its feature functions and
# current constants rather than re-deriving them, so the profile reflects what
# the deployed detector actually computes.
from train_horn_detector import (
    extract_horn_band_features,
    find_horn_blasts,
    TARGET_SR,
    HORN_FREQ_LOW_HZ,
    HORN_FREQ_HIGH_HZ,
    TONALITY_RATIO_THRESHOLD,
    RMS_THRESHOLD_PERCENTILE,
    BLAST_MIN_DURATION_SEC,
    BLAST_MAX_DURATION_SEC,
    CONFIRMATION_WINDOW_SEC,
    BLAST_MERGE_GAP_SEC,
    MIN_BLASTS_FOR_CONFIRMATION,
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# STFT geometry — must match the detector so calibrated frames line up.
N_FFT = 1024
HOP_LENGTH = 512

# Normalization reference (matches the detector's broadband window). Each file's
# representative spectrum is scaled so its mean energy here = 1, so spectra from
# loud and quiet recordings are compared by *shape*, not absolute level.
BROAD_LOW_HZ = 100
BROAD_HIGH_HZ = 1200

# "Loud" frames (where a horn would be) for building a file's representative
# spectrum — measured over a band wide enough to include horn + neighbours.
LOUD_BAND_LOW_HZ = 100
LOUD_BAND_HIGH_HZ = 2000
LOUD_FRAME_PERCENTILE = 90      # top 10% of frames by in-band loudness

# Horn-band search: where to look for the positives-vs-negatives contrast peak.
# Bounded so we lock onto the fundamental cluster, not a high harmonic or hum.
SEARCH_LOW_HZ = 120
SEARCH_HIGH_HZ = 1100
SPECTRUM_SMOOTH_BINS = 3        # light smoothing before taking the contrast
BAND_HALF_MAX_FRAC = 0.5        # band edges = where contrast falls to half its peak
BAND_MIN_CONTRAST = 1.10        # need >=10% positive excess to trust a band
BAND_MIN_WIDTH_HZ = 60          # widen a too-narrow band to at least this

# Per-file tonality statistic: the tonality the detector would threshold on is
# the tonality during the file's loudest frames (it gates on top-RMS frames).
TONALITY_PERCENTILE = 95

# Threshold-picking targets for the low/high tonality tiers. medium is the
# best-F1 split; low reaches toward the negatives (sensitive, a few more FPs),
# high reaches up into the positives (strict, rejects the faintest horns).
LOW_PRECISION_TARGET = 0.90     # "low" (sensitive): most sensitive split still this precise
HIGH_RECALL_FLOOR = 0.75        # "high" (strict): strictest split still catching this share

# Onset-aligned average spectrogram window.
SPEC_PRE_SEC = 0.5
SPEC_WINDOW_SEC = 4.0
SPEC_MAX_FREQ_HZ = 2000

WAV_EXTENSIONS = (".wav", ".WAV")

# Corpus layout for --corpus mode: one subfolder per sound class. The positive
# folder holds confirmed horns; every other folder is a labeled negative class
# (vehicles, planes, gunshots, construction, ...). These folder names are skipped
# when collecting negatives (work-in-progress / tooling, not sound classes).
DEFAULT_POSITIVE_LABEL = "trains"
CORPUS_EXCLUDE = {"unsure", "_review", "horn_profile_out"}

# Snapshot the detector's current constants so the parameter block can show
# "was X" next to each measured value.
DEFAULTS = {
    "horn_freq_low_hz": HORN_FREQ_LOW_HZ,
    "horn_freq_high_hz": HORN_FREQ_HIGH_HZ,
    "tonality_ratio_threshold": dict(TONALITY_RATIO_THRESHOLD),
    "rms_threshold_percentile": RMS_THRESHOLD_PERCENTILE,
    "blast_min_duration_sec": BLAST_MIN_DURATION_SEC,
    "blast_max_duration_sec": BLAST_MAX_DURATION_SEC,
    "confirmation_window_sec": CONFIRMATION_WINDOW_SEC,
    "blast_merge_gap_sec": BLAST_MERGE_GAP_SEC,
    "min_blasts_for_confirmation": MIN_BLASTS_FOR_CONFIRMATION,
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def pct(values, q: float, default: float = 0.0) -> float:
    """np.percentile that tolerates empty input."""
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return default
    return float(np.percentile(arr, q))


def list_wavs(dirpath: str) -> List[str]:
    """Sorted list of WAV files under a directory (recursive)."""
    return sorted(
        str(p) for p in Path(dirpath).rglob("*") if p.suffix in WAV_EXTENSIONS
    )


def load_audio(path: str, sr: int) -> Optional[np.ndarray]:
    """Load mono audio at the target rate, or None on failure."""
    try:
        y, _ = librosa.load(path, sr=sr, mono=True)
        if y.size < N_FFT:
            return None
        return y
    except Exception as exc:  # noqa: BLE001 — one bad file shouldn't stop the run
        print(f"    ! load error ({Path(path).name}): {exc}")
        return None


def smooth(arr: np.ndarray, bins: int) -> np.ndarray:
    """Centered moving average over `bins` frequency bins."""
    if bins <= 1:
        return arr
    kernel = np.ones(bins) / bins
    return np.convolve(arr, kernel, mode="same")


# ---------------------------------------------------------------------------
# Spectral analysis — find the real horn band
# ---------------------------------------------------------------------------

def representative_spectrum(y: np.ndarray, sr: int):
    """
    A file's spectrum during its loudest frames — i.e. when a horn (or, for a
    negative, the strongest competing sound) is present. Returns (spectrum,
    freqs) with the spectrum normalized so its mean over the broadband
    reference = 1 (shape, not level).
    """
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)

    loud_band = (freqs >= LOUD_BAND_LOW_HZ) & (freqs <= LOUD_BAND_HIGH_HZ)
    loudness = S[loud_band, :].mean(axis=0)
    if loudness.size == 0:
        return None, freqs

    thresh = np.percentile(loudness, LOUD_FRAME_PERCENTILE)
    sel = loudness >= thresh
    if sel.sum() < 3:  # tiny file — fall back to the 3 loudest frames
        sel = np.zeros_like(loudness, dtype=bool)
        sel[np.argsort(loudness)[-3:]] = True

    spectrum = S[:, sel].mean(axis=1)

    ref = (freqs >= BROAD_LOW_HZ) & (freqs <= BROAD_HIGH_HZ)
    ref_level = spectrum[ref].mean()
    if ref_level > 1e-12:
        spectrum = spectrum / ref_level
    return spectrum, freqs


def median_spectrum(files: List[str], sr: int, label: str):
    """Median representative spectrum across a corpus (robust to outliers)."""
    specs = []
    freqs = None
    for f in files:
        y = load_audio(f, sr)
        if y is None:
            continue
        spec, freqs = representative_spectrum(y, sr)
        if spec is not None:
            specs.append(spec)
    if not specs:
        print(f"    ! no usable {label} spectra")
        return None, freqs
    return np.median(np.vstack(specs), axis=0), freqs


def derive_horn_band(pos_spec, neg_spec, freqs):
    """
    The horn band = the frequency range where the positive spectrum exceeds the
    negative one. Returns (low_hz, high_hz, peak_hz, peak_contrast, contrast,
    confident).

    Falls back to the detector's default band (low confidence) when the corpus
    shows no clear positive excess.
    """
    pos = smooth(pos_spec, SPECTRUM_SMOOTH_BINS)
    neg = smooth(neg_spec, SPECTRUM_SMOOTH_BINS)
    contrast = pos / np.maximum(neg, 1e-9)

    search = (freqs >= SEARCH_LOW_HZ) & (freqs <= SEARCH_HIGH_HZ)
    idx = np.where(search)[0]
    if idx.size == 0:
        return (HORN_FREQ_LOW_HZ, HORN_FREQ_HIGH_HZ, None, 0.0, contrast, False)

    peak_rel = np.argmax(contrast[idx])
    peak_i = idx[peak_rel]
    peak_contrast = float(contrast[peak_i])
    peak_hz = float(freqs[peak_i])

    if peak_contrast < BAND_MIN_CONTRAST:
        # No real separation — keep the default band but flag it.
        return (HORN_FREQ_LOW_HZ, HORN_FREQ_HIGH_HZ, peak_hz,
                peak_contrast, contrast, False)

    # Walk out from the peak until the contrast drops to half its height (but
    # never below "barely any excess").
    level = max(peak_contrast * BAND_HALF_MAX_FRAC, BAND_MIN_CONTRAST)
    lo_i = peak_i
    while lo_i > idx[0] and contrast[lo_i - 1] >= level:
        lo_i -= 1
    hi_i = peak_i
    while hi_i < idx[-1] and contrast[hi_i + 1] >= level:
        hi_i += 1

    low_hz = float(freqs[lo_i])
    high_hz = float(freqs[hi_i])

    # Round outward to tidy 10 Hz edges, then enforce a minimum width.
    low_hz = float(np.floor(low_hz / 10.0) * 10.0)
    high_hz = float(np.ceil(high_hz / 10.0) * 10.0)
    if high_hz - low_hz < BAND_MIN_WIDTH_HZ:
        pad = (BAND_MIN_WIDTH_HZ - (high_hz - low_hz)) / 2.0
        low_hz = max(SEARCH_LOW_HZ, low_hz - pad)
        high_hz = min(SEARCH_HIGH_HZ, high_hz + pad)

    return (low_hz, high_hz, peak_hz, peak_contrast, contrast, True)


# ---------------------------------------------------------------------------
# Threshold calibration — run the detector's features over the corpus
# ---------------------------------------------------------------------------

def collect_tonality(files: List[str], sr: int, low_hz: float, high_hz: float,
                     label: str):
    """
    Per-file tonality + peak RMS over the derived band — what the tier selection
    and the distribution plots run on. The tonality stat is the 95th-percentile
    tonality among the file's loudest frames, mirroring the detector's gate (it
    only fires on top-RMS frames). Returns (tonality_array, peak_rms_array).
    """
    tons, rmss = [], []
    for f in files:
        y = load_audio(f, sr)
        if y is None:
            continue
        rms, tonality = extract_horn_band_features(y, sr, low_hz=low_hz, high_hz=high_hz)
        if rms.size == 0:
            continue
        loud = rms >= np.percentile(rms, RMS_THRESHOLD_PERCENTILE)
        ton_loud = tonality[loud] if loud.any() else tonality
        tons.append(pct(ton_loud, TONALITY_PERCENTILE))
        rmss.append(float(rms.max()))
    print(f"    {label}: {len(tons)} file(s)")
    return np.array(tons, dtype=float), np.array(rmss, dtype=float)


def measure_blasts_at(files: List[str], sr: int, low_hz: float, high_hz: float,
                      tonality_thresh: float):
    """
    Measure positive blast durations + inter-blast gaps **at the operating
    threshold** the detector will actually run (the derived `medium` tonality),
    with the detector's own blast finder but its duration filter opened wide — so
    the raw run-length distribution isn't censored by the very bounds we're
    trying to choose. (Measuring at a looser threshold over-estimates durations,
    which is what made an early BLAST_MAX clip real horns.) Returns
    (durations, gaps) as arrays of seconds.
    """
    import train_horn_detector as thd
    saved = (thd.BLAST_MIN_DURATION_SEC, thd.BLAST_MAX_DURATION_SEC,
             thd.TONALITY_RATIO_THRESHOLD)
    durations, gaps = [], []
    try:
        thd.BLAST_MIN_DURATION_SEC = 0.0
        thd.BLAST_MAX_DURATION_SEC = float("inf")
        thd.TONALITY_RATIO_THRESHOLD = dict(saved[2], medium=tonality_thresh)
        for f in files:
            y = load_audio(f, sr)
            if y is None:
                continue
            rms, ton = thd.extract_horn_band_features(y, sr, low_hz=low_hz, high_hz=high_hz)
            blasts = thd.find_horn_blasts(rms, ton, sr, HOP_LENGTH, "medium")
            durations += [b.duration for b in blasts]
            gaps += [blasts[i + 1].start_sec - blasts[i].end_sec
                     for i in range(len(blasts) - 1)]
    finally:
        (thd.BLAST_MIN_DURATION_SEC, thd.BLAST_MAX_DURATION_SEC,
         thd.TONALITY_RATIO_THRESHOLD) = saved
    return np.array(durations, dtype=float), np.array(gaps, dtype=float)


def blast_counts(files, sr, low_hz, high_hz, tonality_thresh, dur_min, dur_max,
                 merge_gap):
    """
    Blasts found per clip at the full operating config (derived band + medium
    tonality + the chosen duration bounds + merge gap). This is what decides how
    many blasts a clip yields, which the 2-blast confirmation rule then gates on.
    Returns a list of (path, count) for each loadable file.
    """
    import train_horn_detector as thd
    saved = (thd.BLAST_MIN_DURATION_SEC, thd.BLAST_MAX_DURATION_SEC,
             thd.BLAST_MERGE_GAP_SEC, thd.TONALITY_RATIO_THRESHOLD)
    pairs = []
    try:
        thd.BLAST_MIN_DURATION_SEC = dur_min
        thd.BLAST_MAX_DURATION_SEC = dur_max
        thd.BLAST_MERGE_GAP_SEC = merge_gap
        thd.TONALITY_RATIO_THRESHOLD = dict(saved[3], medium=tonality_thresh)
        for f in files:
            y = load_audio(f, sr)
            if y is None:
                continue
            rms, ton = thd.extract_horn_band_features(y, sr, low_hz=low_hz, high_hz=high_hz)
            pairs.append((f, len(thd.find_horn_blasts(rms, ton, sr, HOP_LENGTH, "medium"))))
    finally:
        (thd.BLAST_MIN_DURATION_SEC, thd.BLAST_MAX_DURATION_SEC,
         thd.BLAST_MERGE_GAP_SEC, thd.TONALITY_RATIO_THRESHOLD) = saved
    return pairs


def recommend_min_blasts(pos_counts, neg_counts, override=None):
    """
    Decide MIN_BLASTS_FOR_CONFIRMATION from blasts-per-clip. The corpus is usually
    individual event-clips (often a single blast), while the 2-blast rule is built
    for scanning continuous audio — so on clips a high bar tanks recall. We score
    k = 1/2/3 on this corpus (recall = positives with >=k blasts; precision from
    negatives) and pick the best F1 (smaller k wins ties). `override` forces k.
    Returns (k, table) with table rows (k, recall, precision, f1).
    """
    n_pos = len(pos_counts)
    table = []
    for k in (1, 2, 3):
        tp = sum(1 for c in pos_counts if c >= k)
        fp = sum(1 for c in neg_counts if c >= k)
        recall = tp / n_pos if n_pos else 0.0
        precision = tp / (tp + fp) if (tp + fp) else 1.0
        f1 = (2 * precision * recall / (precision + recall)
              if (precision + recall) else 0.0)
        table.append((k, round(recall, 3), round(precision, 3), round(f1, 3)))
    if override in (1, 2, 3):
        return override, table
    best = max(table, key=lambda r: (r[3], -r[0]))  # best F1, prefer smaller k
    return best[0], table


def parse_clip_time(path):
    """Best-effort timestamp from a clip filename. Handles the live detector's
    `train_2026-06-01T08-30-00.wav` and AudioMoth `20260601_083000.WAV`. None if
    unparseable (e.g. a renamed clip)."""
    stem = Path(path).stem
    candidates = []
    if stem.startswith("train_"):
        candidates.append((stem[len("train_"):], "%Y-%m-%dT%H-%M-%S"))
        candidates.append((stem[len("train_"):], "%Y-%m-%dT%H:%M:%S"))
    candidates.append((stem, "%Y%m%d_%H%M%S"))
    for text, fmt in candidates:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def pass_recall(pos_pairs, gap_min):
    """
    Group positive clips into train *passes* — clips within `gap_min` minutes of
    each other are the same train — and report recall at the pass level (a pass
    counts as detected if ANY of its clips yielded >=1 blast). This is the number
    that matters: catching a train once is catching it. Returns a dict, or None if
    too few clips carry parseable timestamps.
    """
    timed = [(parse_clip_time(p), c >= 1) for p, c in pos_pairs]
    timed = [(t, det) for t, det in timed if t is not None]
    untimed = len(pos_pairs) - len(timed)
    if len(timed) < 2:
        return None
    timed.sort(key=lambda x: x[0])
    passes = []                      # one bool per pass: was it detected?
    cur_det, last_t = timed[0][1], timed[0][0]
    for t, det in timed[1:]:
        if (t - last_t).total_seconds() <= gap_min * 60:
            cur_det = cur_det or det
        else:
            passes.append(cur_det)
            cur_det = det
        last_t = t
    passes.append(cur_det)
    detected = sum(passes)
    return {
        "gap_min": gap_min,
        "n_passes": len(passes),
        "detected": detected,
        "recall": round(detected / len(passes), 3) if passes else 0.0,
        "n_clips_timed": len(timed),
        "untimed": untimed,
    }


def sweep_threshold(pos: np.ndarray, neg: np.ndarray):
    """
    Sweep tonality thresholds and score each on this corpus. Returns a list of
    (threshold, precision, recall, f1) rows over a fine grid spanning both sets.
    """
    if pos.size == 0:
        return []
    lo = float(min(pos.min(), neg.min() if neg.size else pos.min()))
    hi = float(max(pos.max(), neg.max() if neg.size else pos.max()))
    grid = np.linspace(lo, hi, 200)
    rows = []
    n_pos = pos.size
    for t in grid:
        tp = int((pos >= t).sum())
        fp = int((neg >= t).sum()) if neg.size else 0
        precision = tp / (tp + fp) if (tp + fp) else 1.0
        recall = tp / n_pos
        f1 = (2 * precision * recall / (precision + recall)
              if (precision + recall) else 0.0)
        rows.append((float(t), precision, recall, f1))
    return rows


def pick_tonality_thresholds(pos: np.ndarray, neg: np.ndarray):
    """
    Choose low/medium/high tonality thresholds from the sweep:
      medium = best F1 (the separation sweet spot)
      high   = strictest threshold still hitting the precision target (fewest FPs)
      low    = most sensitive threshold still hitting the recall target
    Returns (tiers_dict, medium_precision, medium_recall, confident).
    """
    rows = sweep_threshold(pos, neg)
    if not rows:
        return dict(DEFAULTS["tonality_ratio_threshold"]), 0.0, 0.0, False

    # medium: maximise F1, breaking ties toward the stricter (higher) threshold —
    # the statistically optimal split between horns and false candidates.
    best = max(rows, key=lambda r: (r[3], r[0]))
    medium, med_p, med_r = best[0], best[1], best[2]

    # low (sensitive): the *most sensitive* threshold that's still fairly precise,
    # so faint/distant horns scoring near the noise floor are still caught.
    low_candidates = [r for r in rows if r[1] >= LOW_PRECISION_TARGET and r[2] > 0]
    low = min(low_candidates, key=lambda r: r[0])[0] if low_candidates \
        else min(r[0] for r in rows)

    # high (strict): the *strictest* threshold that still catches most horns,
    # rejecting the faintest positives to cut false positives.
    high_candidates = [r for r in rows if r[2] >= HIGH_RECALL_FLOOR]
    high = max(high_candidates, key=lambda r: r[0])[0] if high_candidates \
        else max(r[0] for r in rows)

    low, medium, high = (round(low, 1), round(medium, 1), round(high, 1))
    # Clamp around medium so the tiers always read low <= medium <= high.
    low = min(low, medium)
    high = max(high, medium)

    confident = bool(neg.size and (med_p >= 0.8 or med_r >= 0.8))
    tiers = {"low": low, "medium": medium, "high": high}
    return tiers, med_p, med_r, confident


# ---------------------------------------------------------------------------
# Onset-aligned average spectrogram
# ---------------------------------------------------------------------------

def aligned_spectrogram(files: List[str], sr: int, low_hz: float, high_hz: float):
    """
    Average power spectrogram of positives, each aligned to its strongest blast
    onset, so the horn signature stacks coherently in time. Returns
    (mean_db, freqs, times) or (None, None, None) if it can't be built.
    """
    win_len = int(SPEC_WINDOW_SEC * sr)
    pre_len = int(SPEC_PRE_SEC * sr)
    stack = None
    count = 0
    freqs = None
    for f in files:
        y = load_audio(f, sr)
        if y is None:
            continue
        rms, tonality = extract_horn_band_features(y, sr, low_hz=low_hz, high_hz=high_hz)
        blasts = find_horn_blasts(rms, tonality, sr, HOP_LENGTH, sensitivity="low")
        if blasts:
            onset = max(blasts, key=lambda b: b.peak_rms).start_sec
        elif rms.size:
            onset = librosa.frames_to_time(int(np.argmax(rms)), sr=sr, hop_length=HOP_LENGTH)
        else:
            continue

        start = max(0, int(onset * sr) - pre_len)
        window = y[start:start + win_len]
        if window.size < win_len:
            window = np.pad(window, (0, win_len - window.size))

        S = np.abs(librosa.stft(window, n_fft=N_FFT, hop_length=HOP_LENGTH)) ** 2
        freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
        if stack is None:
            stack = np.zeros_like(S)
        # Guard against off-by-one frame counts from padding.
        n = min(stack.shape[1], S.shape[1])
        stack[:, :n] += S[:, :n]
        count += 1

    if stack is None or count == 0:
        return None, None, None
    mean_power = stack / count
    mean_db = librosa.power_to_db(mean_power, ref=np.max)
    times = librosa.frames_to_time(
        np.arange(mean_db.shape[1]), sr=sr, hop_length=HOP_LENGTH
    ) - SPEC_PRE_SEC
    return mean_db, freqs, times


# ---------------------------------------------------------------------------
# Plotting (matplotlib, headless Agg backend)
# ---------------------------------------------------------------------------

def make_plots(outdir: Path, spectra: dict, band: dict, posm: dict, negm: dict,
               tiers: dict, dur_rec: dict, spec_img):
    """Render the diagnostic plots. Best-effort: a failure here never aborts
    the run (the numbers and JSON are the real deliverable)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    saved = []

    def save(fig, name):
        path = outdir / name
        fig.savefig(path, dpi=120, bbox_inches="tight")
        plt.close(fig)
        saved.append(name)

    freqs = spectra["freqs"]

    # 1. Spectrum overlay — the horn signature.
    try:
        fig, ax = plt.subplots(figsize=(9, 4.5))
        ax.semilogy(freqs, spectra["pos"], color="#1f9d55", lw=1.8,
                    label=f"positives (n={spectra['n_pos']})")
        ax.semilogy(freqs, spectra["neg"], color="#b03a3a", lw=1.4,
                    alpha=0.85, label=f"negatives (n={spectra['n_neg']})")
        ax.axvspan(band["low"], band["high"], color="#1f9d55", alpha=0.12,
                   label=f"derived band {band['low']:.0f}–{band['high']:.0f} Hz")
        ax.axvspan(DEFAULTS["horn_freq_low_hz"], DEFAULTS["horn_freq_high_hz"],
                   color="#888", alpha=0.08, label="default 250–600 Hz")
        if band["peak_hz"]:
            ax.axvline(band["peak_hz"], color="#0b7", ls="--", lw=1,
                       label=f"peak {band['peak_hz']:.0f} Hz")
        ax.set_xlim(0, SPEC_MAX_FREQ_HZ)
        ax.set_xlabel("Frequency (Hz)")
        ax.set_ylabel("Normalized energy (log)")
        ax.set_title("Horn signature — positive vs negative average spectrum")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.2)
        save(fig, "spectrum_overlay.png")
    except Exception as exc:  # noqa: BLE001
        print(f"    ! spectrum plot failed: {exc}")

    # 2. Onset-aligned average spectrogram.
    if spec_img and spec_img[0] is not None:
        try:
            mean_db, sfreqs, stimes = spec_img
            fmask = sfreqs <= SPEC_MAX_FREQ_HZ
            fig, ax = plt.subplots(figsize=(9, 4.5))
            im = ax.pcolormesh(stimes, sfreqs[fmask], mean_db[fmask, :],
                               shading="auto", cmap="magma")
            ax.axhspan(band["low"], band["high"], color="#1f9d55", alpha=0.0)
            ax.axhline(band["low"], color="#0f9", ls="--", lw=1)
            ax.axhline(band["high"], color="#0f9", ls="--", lw=1)
            ax.axvline(0, color="w", ls=":", lw=1, alpha=0.7)
            ax.set_xlabel("Time relative to blast onset (s)")
            ax.set_ylabel("Frequency (Hz)")
            ax.set_title("Average horn spectrogram (onset-aligned across positives)")
            fig.colorbar(im, ax=ax, label="dB (rel. max)")
            save(fig, "avg_spectrogram.png")
        except Exception as exc:  # noqa: BLE001
            print(f"    ! spectrogram plot failed: {exc}")

    # 3. Tonality distributions + chosen tiers.
    try:
        fig, ax = plt.subplots(figsize=(9, 4.5))
        bins = np.linspace(
            0,
            max(posm["tonality"].max(initial=1), negm["tonality"].max(initial=1)) * 1.05,
            30,
        )
        ax.hist(negm["tonality"], bins=bins, color="#b03a3a", alpha=0.55,
                label=f"negatives (n={negm['tonality'].size})")
        ax.hist(posm["tonality"], bins=bins, color="#1f9d55", alpha=0.65,
                label=f"positives (n={posm['tonality'].size})")
        for tier, color in (("low", "#888"), ("medium", "#0b7"), ("high", "#06c")):
            ax.axvline(tiers[tier], color=color, ls="--", lw=1.4,
                       label=f"{tier} = {tiers[tier]}")
        ax.set_xlabel("Tonality ratio (per-file, loud frames)")
        ax.set_ylabel("Files")
        ax.set_title("Tonality ratio — positives vs negatives")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.2)
        save(fig, "tonality_hist.png")
    except Exception as exc:  # noqa: BLE001
        print(f"    ! tonality plot failed: {exc}")

    # 4. Blast duration distribution (positives).
    try:
        if posm["durations"].size:
            fig, ax = plt.subplots(figsize=(9, 4.5))
            ax.hist(posm["durations"], bins=20, color="#1f9d55", alpha=0.7)
            ax.axvline(dur_rec["min"], color="#06c", ls="--", lw=1.4,
                       label=f"min = {dur_rec['min']}s")
            ax.axvline(dur_rec["max"], color="#c60", ls="--", lw=1.4,
                       label=f"max = {dur_rec['max']}s")
            ax.set_xlabel("Blast duration (s)")
            ax.set_ylabel("Blasts")
            ax.set_title("Horn blast duration — positives")
            ax.legend(fontsize=8)
            ax.grid(True, alpha=0.2)
            save(fig, "duration_hist.png")
    except Exception as exc:  # noqa: BLE001
        print(f"    ! duration plot failed: {exc}")

    # 5. Inter-blast gaps (positives).
    try:
        if posm["gaps"].size:
            fig, ax = plt.subplots(figsize=(9, 4.5))
            ax.hist(posm["gaps"], bins=20, color="#1f9d55", alpha=0.7)
            ax.set_xlabel("Inter-blast gap (s)")
            ax.set_ylabel("Gaps")
            ax.set_title("Gap between consecutive horn blasts — positives")
            ax.grid(True, alpha=0.2)
            save(fig, "gap_hist.png")
    except Exception as exc:  # noqa: BLE001
        print(f"    ! gap plot failed: {exc}")

    # 6. Horn-band peak RMS distributions.
    try:
        fig, ax = plt.subplots(figsize=(9, 4.5))
        hi = max(posm["peak_rms"].max(initial=1), negm["peak_rms"].max(initial=1))
        bins = np.linspace(0, hi * 1.05, 30)
        ax.hist(negm["peak_rms"], bins=bins, color="#b03a3a", alpha=0.55,
                label="negatives")
        ax.hist(posm["peak_rms"], bins=bins, color="#1f9d55", alpha=0.65,
                label="positives")
        ax.set_xlabel("Peak horn-band RMS (per file)")
        ax.set_ylabel("Files")
        ax.set_title("Horn-band RMS — positives vs negatives")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.2)
        save(fig, "rms_hist.png")
    except Exception as exc:  # noqa: BLE001
        print(f"    ! rms plot failed: {exc}")

    return saved


# ---------------------------------------------------------------------------
# Recommendation assembly
# ---------------------------------------------------------------------------

def recommend_durations(pos_durations: np.ndarray) -> dict:
    """
    Blast-duration bounds with headroom so they reject non-horn tones WITHOUT
    clipping real horns: min ~30% below the 5th-percentile blast, max ~20% above
    the longest. (A tight max once failed real multi-blast horns the 2-blast
    confirmation, so the bounds deliberately stay generous toward keeping horns.)
    """
    if pos_durations.size < 3:
        return {"min": DEFAULTS["blast_min_duration_sec"],
                "max": DEFAULTS["blast_max_duration_sec"], "from_data": False}
    lo = max(0.4, round(pct(pos_durations, 5) * 0.7, 1))
    dmax = max(pct(pos_durations, 99), float(pos_durations.max()))
    hi = float(np.ceil(dmax * 1.2 * 2) / 2)  # +20% headroom, rounded up to 0.5
    hi = min(hi, 15.0)
    if hi <= lo:
        hi = lo + 1.0
    return {"min": lo, "max": hi, "from_data": True}


def recommend_window(pos_gaps: np.ndarray) -> dict:
    """
    Confirmation window from the observed inter-blast spacing (so a real
    multi-blast pattern lands inside the window), plus a merge gap.

    Merge gap is a different scale — it stitches a single held note that briefly
    dips, which shows up as a *sub-second* gap. Seconds-long inter-blast gaps say
    nothing about it, so we only retune it from genuinely small gaps; otherwise
    the default stands.
    """
    if pos_gaps.size < 2:
        return {"window": DEFAULTS["confirmation_window_sec"],
                "merge": DEFAULTS["blast_merge_gap_sec"], "from_data": False}
    window = float(np.ceil(pct(pos_gaps, 95) / 5.0) * 5.0)  # nearest 5s, rounded up
    window = float(min(max(window, 30.0), 180.0))

    sub_second = pos_gaps[pos_gaps < 1.5]
    if sub_second.size >= 2:
        merge = round(float(min(pct(sub_second, 75), 1.5)), 1)
    else:
        merge = DEFAULTS["blast_merge_gap_sec"]
    return {"window": window, "merge": merge, "from_data": True}


def build_parameter_block(profile: dict, notes: List[str]) -> str:
    """The ready-to-paste Python block for train_horn_detector.py."""
    d = DEFAULTS
    tiers = profile["tonality_ratio_threshold"]
    lines = [
        f"# Derived from {profile['n_positives']} confirmed positives + "
        f"{profile['n_negatives']} negatives — {profile['generated']}",
        f"HORN_FREQ_LOW_HZ = {profile['horn_freq_low_hz']:.0f}"
        f"        # was {d['horn_freq_low_hz']}",
        f"HORN_FREQ_HIGH_HZ = {profile['horn_freq_high_hz']:.0f}"
        f"       # was {d['horn_freq_high_hz']}",
        "TONALITY_RATIO_THRESHOLD = {",
        f"    \"low\":    {tiers['low']},"
        f"            # was {d['tonality_ratio_threshold']['low']}",
        f"    \"medium\": {tiers['medium']},"
        f"            # was {d['tonality_ratio_threshold']['medium']}",
        f"    \"high\":   {tiers['high']},"
        f"            # was {d['tonality_ratio_threshold']['high']}",
        "}",
        f"BLAST_MIN_DURATION_SEC = {profile['blast_min_duration_sec']}"
        f"   # was {d['blast_min_duration_sec']}",
        f"BLAST_MAX_DURATION_SEC = {profile['blast_max_duration_sec']}"
        f"  # was {d['blast_max_duration_sec']}",
        f"BLAST_MERGE_GAP_SEC = {profile['blast_merge_gap_sec']}"
        f"      # was {d['blast_merge_gap_sec']}",
        f"CONFIRMATION_WINDOW_SEC = {profile['confirmation_window_sec']:.0f}"
        f"     # was {d['confirmation_window_sec']:.0f}",
        f"MIN_BLASTS_FOR_CONFIRMATION = {profile['min_blasts_for_confirmation']}"
        f" # was {d['min_blasts_for_confirmation']}",
    ]
    block = "\n".join(lines)
    if notes:
        block += "\n\n# Notes:\n" + "\n".join(f"#   - {n}" for n in notes)
    return block


# ---------------------------------------------------------------------------
# Corpus gathering, readiness, and end-to-end validation
# ---------------------------------------------------------------------------

def gather_corpus(args):
    """
    Resolve positives and *labeled* negative classes from either a --corpus root
    (one subfolder per sound class; `trains/` = positives, every other folder = a
    negative class) or explicit --positives / --negatives dirs.

    Returns (pos_files, neg_groups) where neg_groups maps class name → file list.
    """
    neg_groups: dict = {}
    if args.corpus:
        root = Path(args.corpus)
        if not root.is_dir():
            sys.exit(f"--corpus is not a directory: {root}")
        pos_dir = root / args.positive_label
        if not pos_dir.is_dir():
            sys.exit(
                f"No '{args.positive_label}/' folder in {root}. Put confirmed "
                f"horns there; every other subfolder becomes a negative class."
            )
        pos_files = list_wavs(str(pos_dir))
        out_resolved = Path(args.output_dir).resolve()
        for sub in sorted(p for p in root.iterdir() if p.is_dir()):
            name = sub.name
            if (name == args.positive_label or name in CORPUS_EXCLUDE
                    or name.startswith((".", "_"))
                    or sub.resolve() == out_resolved):
                continue
            files = list_wavs(str(sub))
            if files:
                neg_groups[name] = files
    else:
        if not args.positives or not args.negatives:
            sys.exit("Give either --corpus ROOT, or both --positives and "
                     "--negatives (one or more dirs).")
        pos_files = list_wavs(args.positives)
        for nd in args.negatives:
            files = list_wavs(nd)
            if files:
                neg_groups.setdefault(Path(nd).name or nd, []).extend(files)
    return pos_files, neg_groups


def corpus_census(pos_files, neg_groups):
    """Print the file counts per class; return (n_positives, total_negatives)."""
    total_neg = sum(len(v) for v in neg_groups.values())
    print(f"  {'trains (positives)':<22}{len(pos_files):>5}")
    if neg_groups:
        for name, files in sorted(neg_groups.items(), key=lambda kv: -len(kv[1])):
            print(f"  {name + ' (negative)':<22}{len(files):>5}")
        print(f"  {'— total negatives':<22}{total_neg:>5}")
    else:
        print("  (no negative classes found)")
    return len(pos_files), total_neg


def readiness_verdict(n_pos, neg_groups):
    """A plain-English read on whether the corpus is strong enough to trust."""
    total_neg = sum(len(v) for v in neg_groups.values())
    n_cats = len(neg_groups)
    msgs = []
    if n_pos >= 20 and total_neg >= 30 and n_cats >= 3:
        level, headline = "GOOD", "Solid dataset — calibrate away."
    elif n_pos >= 10 and total_neg >= 15:
        level, headline = "OK", ("Workable — it'll calibrate; more clips "
                                 "(especially negatives) will firm up the numbers.")
    else:
        level, headline = "THIN", ("Thin — fine to experiment, but gather more "
                                   "before trusting the numbers.")
    if n_pos < 15:
        msgs.append(f"Only {n_pos} train clip(s) — aim for 20+ so recall means something.")
    if total_neg < 20:
        msgs.append(f"Only {total_neg} negative(s) — aim for 30+ across a few classes.")
    if neg_groups:
        biggest = max(neg_groups.values(), key=len)
        if total_neg and len(biggest) / total_neg > 0.8 and n_cats > 1:
            msgs.append("Negatives are mostly one class — add variety so the "
                        "detector learns what ISN'T a horn from several angles.")
    if n_cats < 2 and total_neg:
        msgs.append("Add a second kind of negative (planes, vehicles, gunshots…).")
    return level, headline, msgs


def validate_detector(pos_files, neg_groups, profile_path):
    """
    The truest accuracy check: apply the freshly-built profile and run the REAL
    detector (full multi-blast confirmation) over the labeled corpus end to end.
    Returns recall on positives plus a per-class false-alarm breakdown.
    """
    import train_horn_detector as thd
    thd.load_profile(str(profile_path))  # apply derived constants to the detector

    def fires(path):
        try:
            return len(thd.process_file(path, sensitivity="medium", verbose=False)) > 0
        except Exception:  # noqa: BLE001 — a bad file shouldn't abort validation
            return False

    n_pos = len(pos_files)
    pos_hit = sum(1 for f in pos_files if fires(f))

    by_cat, total_neg, total_fp = [], 0, 0
    for name, files in sorted(neg_groups.items(), key=lambda kv: -len(kv[1])):
        fp = sum(1 for f in files if fires(f))
        by_cat.append({"category": name, "n": len(files), "false_alarms": fp,
                       "rate": round(fp / len(files), 3) if files else 0.0})
        total_neg += len(files)
        total_fp += fp

    return {
        "n_positives": n_pos,
        "positives_detected": pos_hit,
        "recall": round(pos_hit / n_pos, 3) if n_pos else 0.0,
        "n_negatives": total_neg,
        "false_alarms": total_fp,
        "false_alarm_rate": round(total_fp / total_neg, 3) if total_neg else 0.0,
        "precision": round(pos_hit / (pos_hit + total_fp), 3)
        if (pos_hit + total_fp) else 1.0,
        "by_category": by_cat,
    }


CONFUSABLE_RATE = 0.30  # a negative class fooling the detector this often = worth flagging


def accuracy_lines(v: dict) -> List[str]:
    """Plain-English accuracy summary lines (shared by console + report)."""
    lines = []
    if "blast_level_recall" in v:
        lines.append(
            f"  Horn found (≥1 blast):  {v['blast_level_recall']:.0%} of trains"
            f"   — the blast detector's reach, before the ≥{v.get('min_blasts', 2)}-blast rule")
    lines += [
        f"  Trains confirmed:  {v['positives_detected']}/{v['n_positives']}"
        f"   ({v['recall']:.0%} recall, at ≥{v.get('min_blasts', 2)} blast(s))",
        f"  False alarms:   {v['false_alarms']}/{v['n_negatives']}"
        f"   ({v['false_alarm_rate']:.0%}  →  {v['precision']:.0%} precision)",
    ]
    if "pass_level_recall" in v:
        lines.append(
            f"  Train passes caught:  {v['pass_level_recall']:.0%} "
            f"(of {v['n_passes']} time-grouped passes — the number that matters)")
    for c in v["by_category"]:
        flag = "   <- most confusable" if (c["rate"] >= CONFUSABLE_RATE
                                           and c["false_alarms"]) else ""
        lines.append(f"    {c['category']:<14}{c['false_alarms']:>3}/{c['n']:<4}"
                     f" ({c['rate']:.0%}){flag}")
    return lines


def accuracy_verdict(v: dict) -> str:
    """One-line read on whether this profile is good enough. Uses pass-level recall
    when available — catching a train in any one of its clips is catching it, so
    that's the real-world recall; clip-level under-rates a clip corpus."""
    r = v.get("pass_level_recall", v["recall"])
    p = v["precision"]
    if r >= 0.85 and p >= 0.90:
        return "Strong — this profile is ready to use."
    if r >= 0.70 and p >= 0.80:
        return "Decent — usable; watch the confusable class(es) above."
    return ("Needs work — gather more/varied clips, or the horn just isn't "
            "separable from these sounds at this distance.")


def missed_dominant_freqs(files, sr):
    """
    For each missed positive (no horn detected), the frequency where its loudest
    tonal moment sits — searched over 100–1500 Hz. If these cluster outside the
    chosen horn band, the band is too narrow for that kind of horn; if they're
    in-band, the clip is faint/short or mislabeled. Returns [(path, freq_hz)].
    """
    out = []
    for f in files:
        y = load_audio(f, sr)
        if y is None:
            continue
        S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH))
        fr = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
        band = (fr >= 100) & (fr <= 1500)
        if not band.any() or S.shape[1] == 0:
            continue
        loud = int(np.argmax(S[band, :].sum(axis=0)))   # loudest frame in-range
        bidx = np.where(band)[0]
        peak = bidx[int(np.argmax(S[bidx, loud]))]
        out.append((f, float(fr[peak])))
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Windows consoles can default to cp1252, which chokes on the arrows/emoji in
    # the summaries. Force UTF-8 on stdout/stderr where supported (file writes
    # below pass encoding="utf-8" explicitly).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    ap = argparse.ArgumentParser(
        description="Calibrate train_horn_detector.py from a labeled corpus.",
    )
    # Easy mode: one corpus folder with a subfolder per sound class.
    ap.add_argument("--corpus", "-c", default=None,
                    help="Corpus root with one subfolder per sound class: "
                         "'trains/' = positives, every OTHER folder = a negative "
                         "class (vehicles, planes, gunshots, construction...).")
    # Or point at the two classes explicitly.
    ap.add_argument("--positives", "-p", default=None,
                    help="Directory of confirmed horn WAVs (instead of --corpus).")
    ap.add_argument("--negatives", "-n", nargs="+", default=None,
                    help="One or more dirs of no-train WAVs (instead of --corpus).")
    ap.add_argument("--positive-label", default=DEFAULT_POSITIVE_LABEL,
                    help=f"Corpus subfolder holding positives (default "
                         f"'{DEFAULT_POSITIVE_LABEL}').")
    ap.add_argument("--output-dir", "-o", default="horn_profile_out",
                    help="Where to write plots, horn_profile.json, and the report "
                         "(default: ./horn_profile_out).")
    ap.add_argument("--sr", type=int, default=TARGET_SR,
                    help=f"Resample rate (default {TARGET_SR}, the detector's).")
    ap.add_argument("--check", action="store_true",
                    help="Just census the corpus and say if it's strong enough — "
                         "no calibration. Fast; use it while you're still sorting.")
    ap.add_argument("--min-blasts", type=int, choices=[1, 2, 3], default=None,
                    help="Force MIN_BLASTS_FOR_CONFIRMATION (default: auto from the "
                         "data). 1 = a single horn blast confirms (best for clips); "
                         "2 = needs a multi-blast pattern (safer on continuous audio).")
    ap.add_argument("--pass-gap-min", type=float, default=5.0,
                    help="Clips within this many minutes count as one train pass "
                         "(default 5) — used for pass-level recall.")
    ap.add_argument("--band", nargs=2, type=float, metavar=("LOW", "HIGH"), default=None,
                    help="Force the horn band (Hz) instead of auto-deriving it — e.g. "
                         "--band 180 640 to widen and catch horns the auto band misses. "
                         "Watch the validation recall/precision tradeoff.")
    ap.add_argument("--no-plots", action="store_true",
                    help="Skip the diagnostic plots (no matplotlib needed).")
    ap.add_argument("--no-validate", action="store_true",
                    help="Skip the end-to-end detector validation pass (faster).")
    ap.add_argument("--no-json", action="store_true",
                    help="Don't keep horn_profile.json after the run.")
    args = ap.parse_args()

    pos_files, neg_groups = gather_corpus(args)
    if not pos_files:
        sys.exit("No positive (train) WAVs found — nothing to calibrate.")

    # --- Corpus census + readiness (always shown) ----------------------------
    print("Corpus census:")
    n_pos, n_neg = corpus_census(pos_files, neg_groups)
    level, headline, msgs = readiness_verdict(n_pos, neg_groups)
    print(f"\nReadiness: {level} — {headline}")
    for m in msgs:
        print(f"  • {m}")
    print()

    if args.check:
        return  # census-only; nothing written

    if not neg_groups:
        sys.exit("No negative WAVs found — calibration needs both classes "
                 "(add some non-train folders / dirs).")

    neg_files = [f for files in neg_groups.values() for f in files]
    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"Output dir: {outdir}\n")

    # --- 1. Spectral analysis ------------------------------------------------
    print("[1/4] Spectral analysis — finding the horn band...")
    pos_spec, freqs = median_spectrum(pos_files, args.sr, "positive")
    neg_spec, _ = median_spectrum(neg_files, args.sr, "negative")
    if pos_spec is None or neg_spec is None:
        sys.exit("Could not build spectra — check the audio files.")

    low_hz, high_hz, peak_hz, peak_contrast, contrast, band_ok = \
        derive_horn_band(pos_spec, neg_spec, freqs)
    if args.band:
        # Manual override — experiment with a wider band to catch missed horns,
        # then watch the validation recall/precision tradeoff.
        low_hz, high_hz, band_ok = float(args.band[0]), float(args.band[1]), True
        print(f"    forced band: {low_hz:.0f}–{high_hz:.0f} Hz (--band; "
              f"auto would have been around {peak_hz:.0f} Hz peak)\n")
    else:
        print(f"    derived band: {low_hz:.0f}–{high_hz:.0f} Hz "
              f"(peak {peak_hz:.0f} Hz, contrast {peak_contrast:.2f}×)"
              f"{'' if band_ok else '  [low confidence — kept default band]'}\n")

    # --- 2. Threshold calibration -------------------------------------------
    print("[2/4] Threshold calibration — running detector features over corpus...")
    pos_ton, pos_rms = collect_tonality(pos_files, args.sr, low_hz, high_hz, "positives")
    neg_ton, neg_rms = collect_tonality(neg_files, args.sr, low_hz, high_hz, "negatives")

    tiers, med_p, med_r, ton_ok = pick_tonality_thresholds(pos_ton, neg_ton)

    # Measure blast geometry AT the chosen operating threshold (derived medium),
    # so the duration/window bounds match how the detector will really run.
    pos_dur, pos_gap = measure_blasts_at(pos_files, args.sr, low_hz, high_hz,
                                         tiers["medium"])
    dur_rec = recommend_durations(pos_dur)
    win_rec = recommend_window(pos_gap)
    posm = {"tonality": pos_ton, "peak_rms": pos_rms,
            "durations": pos_dur, "gaps": pos_gap}
    negm = {"tonality": neg_ton, "peak_rms": neg_rms,
            "durations": np.array([]), "gaps": np.array([])}
    print(f"    tonality tiers: {tiers}  "
          f"(medium → precision {med_p:.0%}, recall {med_r:.0%})")
    print(f"    blast duration: {dur_rec['min']}–{dur_rec['max']}s"
          f"{'' if dur_rec['from_data'] else '  [default — too few blasts]'}")
    print(f"    confirmation window: {win_rec['window']:.0f}s, "
          f"merge gap {win_rec['merge']}s"
          f"{'' if win_rec['from_data'] else '  [default — too few gaps]'}")

    # How many blasts each clip yields at this config — the 2-blast confirmation
    # rule gates on this. A clip corpus is often single-blast, so requiring 2
    # silently tanks recall; measure it and pick the requirement from the data.
    pos_pairs = blast_counts(pos_files, args.sr, low_hz, high_hz, tiers["medium"],
                             dur_rec["min"], dur_rec["max"], win_rec["merge"])
    neg_pairs = blast_counts(neg_files, args.sr, low_hz, high_hz, tiers["medium"],
                             dur_rec["min"], dur_rec["max"], win_rec["merge"])
    pos_counts = [c for _, c in pos_pairs]
    neg_counts = [c for _, c in neg_pairs]
    min_blasts, mb_table = recommend_min_blasts(pos_counts, neg_counts, args.min_blasts)
    n_found = sum(1 for c in pos_counts if c >= 1)
    blast_recall = n_found / len(pos_counts) if pos_counts else 0.0
    median_pos_blasts = float(np.median(pos_counts)) if pos_counts else 0.0
    print(f"    horn found (≥1 blast) in {n_found}/{len(pos_counts)} positives "
          f"({blast_recall:.0%}); median {median_pos_blasts:.0f} blast(s)/clip")
    print("    blasts required to confirm a train (recall / precision on this corpus):")
    for k, rec, prec, _ in mb_table:
        star = "   ← chosen" if k == min_blasts else ""
        print(f"      ≥{k} blast(s):  recall {rec:.0%}   precision {prec:.0%}{star}")
    if args.min_blasts:
        print(f"    (forced to {min_blasts} via --min-blasts)")

    # Group clips into train *passes* by time — catching a pass once = caught it.
    pass_info = pass_recall(pos_pairs, args.pass_gap_min)
    if pass_info:
        print(f"    train passes (clips within {pass_info['gap_min']} min = one train): "
              f"{pass_info['detected']}/{pass_info['n_passes']} caught "
              f"({pass_info['recall']:.0%} pass-level recall)")
        if pass_info["untimed"]:
            print(f"      ({pass_info['untimed']} clip(s) had no parseable timestamp "
                  f"— excluded from grouping)")
    else:
        print("    (couldn't time-group clips — filenames lack parseable timestamps)")

    # The positives where no horn was found — diagnose WHERE their loudest tone
    # sits, so a too-narrow band is obvious (and a wider --band is suggested).
    missed = [p for p, c in pos_pairs if c == 0]
    if missed:
        mfreqs = missed_dominant_freqs(missed, args.sr)
        below = sum(1 for _, fq in mfreqs if fq < low_hz)
        above = sum(1 for _, fq in mfreqs if fq > high_hz)
        inband = len(mfreqs) - below - above
        suggestion = None
        if mfreqs and (below + above) >= max(3, len(mfreqs) // 3):
            fqs = sorted(fq for _, fq in mfreqs)
            sug_lo = min(low_hz, float(np.floor(pct(fqs, 10) / 10) * 10))
            sug_hi = max(high_hz, float(np.ceil(pct(fqs, 90) / 10) * 10))
            suggestion = (sug_lo, sug_hi)

        missed_path = outdir / "missed_positives.txt"
        with open(missed_path, "w", encoding="utf-8") as fh:
            fh.write(f"# {len(missed)} positive clip(s) with no horn blast detected "
                     f"(band {low_hz:.0f}-{high_hz:.0f} Hz, tonality >= {tiers['medium']})\n")
            fh.write("# 'peak_hz' = where each clip's loudest tone sits (100-1500 Hz "
                     "search). Outside the band -> the band is too narrow for that horn; "
                     "in-band -> too faint/short, or mislabeled. Give them a listen.\n")
            fmap = dict(mfreqs)
            for p in missed:
                fq = fmap.get(p)
                fh.write(f"{Path(p).name}\t{('%.0f Hz' % fq) if fq else '?'}\n")

        print(f"    {len(missed)} positive(s) had no detected horn → wrote "
              f"{missed_path.name}")
        if mfreqs:
            print(f"      loudest tone sits: {below} below {low_hz:.0f}Hz · "
                  f"{inband} in band · {above} above {high_hz:.0f}Hz")
            if suggestion:
                print(f"      → many missed horns peak OUTSIDE the band. Re-run with "
                      f"--band {suggestion[0]:.0f} {suggestion[1]:.0f} to test catching them.")
            else:
                print("      → mostly in-band: likely too faint/short, or mislabeled "
                      "(listen + remove any non-horns from trains/).")
    print()

    # Collect any caveats worth surfacing in the report / block.
    notes = []
    if min_blasts != DEFAULTS["min_blasts_for_confirmation"]:
        notes.append(
            f"MIN_BLASTS_FOR_CONFIRMATION set to {min_blasts} (was "
            f"{DEFAULTS['min_blasts_for_confirmation']}): your clips are single "
            f"events, so requiring 2 blasts missed real horns. For scanning long "
            f"*continuous* recordings, 2 is safer against lone-blip false positives "
            f"— re-run with --min-blasts 2 to compare.")
    if not band_ok:
        notes.append("Weak positive/negative spectral separation — band kept at "
                     "the default; gather more contrasting negatives.")
    if not ton_ok:
        notes.append("Tonality separation is weak on this corpus — treat the "
                     "tiers as provisional.")
    if not dur_rec["from_data"]:
        notes.append("Too few detected blasts to calibrate duration — kept "
                     "defaults.")
    if not win_rec["from_data"]:
        notes.append("Too few multi-blast files to calibrate the confirmation "
                     "window — kept default.")

    # --- assemble the profile (validation added after step 4) ----------------
    profile = {
        "generated": date.today().isoformat(),
        "detector": "train_horn_detector.py",
        "n_positives": len(pos_files),
        "n_negatives": n_neg,
        "negative_categories": {k: len(v) for k, v in neg_groups.items()},
        "horn_freq_low_hz": round(low_hz),
        "horn_freq_high_hz": round(high_hz),
        "peak_freq_hz": round(peak_hz) if peak_hz else None,
        "tonality_ratio_threshold": tiers,
        "rms_threshold_percentile": DEFAULTS["rms_threshold_percentile"],
        "blast_min_duration_sec": dur_rec["min"],
        "blast_max_duration_sec": dur_rec["max"],
        "blast_merge_gap_sec": win_rec["merge"],
        "confirmation_window_sec": win_rec["window"],
        "min_blasts_for_confirmation": min_blasts,
        "calibration": {
            "band_peak_contrast": round(peak_contrast, 3),
            "band_confident": band_ok,
            "tonality_medium_precision": round(med_p, 3),
            "tonality_medium_recall": round(med_r, 3),
            "tonality_confident": ton_ok,
            "n_pos_blasts": int(posm["durations"].size),
            "n_pos_gaps": int(posm["gaps"].size),
            "pos_peak_rms_median": round(pct(posm["peak_rms"], 50), 6),
            "neg_peak_rms_median": round(pct(negm["peak_rms"], 50), 6),
            "blast_level_recall": round(blast_recall, 3),
            "median_pos_blasts": median_pos_blasts,
            "min_blasts_table": [
                {"k": k, "recall": rec, "precision": prec, "f1": f1}
                for k, rec, prec, f1 in mb_table
            ],
            "pass_level": pass_info,
            "n_missed_positives": len(missed),
            "notes": notes,
        },
        "source": ({"corpus": str(Path(args.corpus).resolve()),
                    "positive_label": args.positive_label}
                   if args.corpus else
                   {"positives": str(Path(args.positives).resolve()),
                    "negatives": [str(Path(d).resolve()) for d in args.negatives]}),
    }

    # --- 3. Plots ------------------------------------------------------------
    saved_plots = []
    if args.no_plots:
        print("[3/4] Plots skipped (--no-plots).\n")
    else:
        print("[3/4] Rendering diagnostic plots...")
        spectra = {
            "freqs": freqs, "pos": pos_spec, "neg": neg_spec,
            "n_pos": len(pos_files), "n_neg": n_neg,
        }
        band = {"low": low_hz, "high": high_hz, "peak_hz": peak_hz}
        try:
            spec_img = aligned_spectrogram(pos_files, args.sr, low_hz, high_hz)
        except Exception as exc:  # noqa: BLE001
            print(f"    ! aligned spectrogram failed: {exc}")
            spec_img = (None, None, None)
        try:
            saved_plots = make_plots(outdir, spectra, band, posm, negm,
                                     tiers, dur_rec, spec_img)
            print(f"    saved {len(saved_plots)} plot(s): {', '.join(saved_plots)}\n")
        except ImportError:
            print("    ! matplotlib not installed — skipping plots "
                  "(rerun with --no-plots to silence)\n")

    # --- write horn_profile.json (needed for the validation pass) ------------
    json_path = outdir / "horn_profile.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2)

    # --- 4. End-to-end validation -------------------------------------------
    validation = None
    if args.no_validate:
        print("[4/4] Validation skipped (--no-validate).\n")
    else:
        print("[4/4] Validating — running the real detector over your corpus...")
        validation = validate_detector(pos_files, neg_groups, json_path)
        validation["blast_level_recall"] = round(blast_recall, 3)
        validation["min_blasts"] = min_blasts
        if pass_info:
            validation["pass_level_recall"] = pass_info["recall"]
            validation["n_passes"] = pass_info["n_passes"]
        profile["calibration"]["validation"] = validation
        for c in validation["by_category"]:
            if c["rate"] >= CONFUSABLE_RATE and c["false_alarms"]:
                notes.append(f"'{c['category']}' triggers the detector "
                             f"{c['rate']:.0%} of the time — your most confusable "
                             f"class; more such clips will help separate it.")
        with open(json_path, "w", encoding="utf-8") as f:  # re-dump w/ validation
            json.dump(profile, f, indent=2)
        print()

    # --- report + parameter block + console ----------------------------------
    block = build_parameter_block(profile, notes)

    report_path = outdir / "calibration_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("Emmaus Observatory — train horn detector calibration\n")
        f.write(f"Generated {profile['generated']}\n\n")
        f.write(f"Corpus: {n_pos} trains, {n_neg} negatives "
                f"across {len(neg_groups)} class(es)\n")
        for name, files in sorted(neg_groups.items(), key=lambda kv: -len(kv[1])):
            f.write(f"  {name}: {len(files)}\n")
        f.write(f"Readiness: {level} — {headline}\n\n")
        if validation:
            f.write("Accuracy on your corpus (real detector, this profile):\n")
            f.write("\n".join(accuracy_lines(validation)) + "\n")
            f.write(f"Verdict: {accuracy_verdict(validation)}\n\n")
        f.write("Parameter block for train_horn_detector.py:\n\n")
        f.write(block + "\n\n")
        f.write("Full profile (horn_profile.json):\n\n")
        f.write(json.dumps(profile, indent=2) + "\n")

    if args.no_json:
        json_path.unlink(missing_ok=True)
    else:
        print(f"Wrote {json_path}")
    print(f"Wrote {report_path}")
    if saved_plots:
        print(f"Plots in {outdir}/")

    # --- console: the accuracy verdict + the pasteable block -----------------
    if validation:
        print("\n" + "=" * 64)
        print("ACCURACY ON YOUR CORPUS  (real detector, this profile)")
        print("=" * 64)
        print("\n".join(accuracy_lines(validation)))
        print(f"\n  Verdict: {accuracy_verdict(validation)}")

    print("\n" + "=" * 64)
    print("CALIBRATED PARAMETER BLOCK  (paste into train_horn_detector.py,")
    print("or just keep horn_profile.json next to it — the detector loads it)")
    print("=" * 64 + "\n")
    print(block)
    print()


if __name__ == "__main__":
    main()
