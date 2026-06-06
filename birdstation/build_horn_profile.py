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

Usage (on the box):
  python3 build_horn_profile.py --positives ./positives --negatives ./negatives
  python3 build_horn_profile.py -p ./pos -n ./neg -o ./profile_out
  python3 build_horn_profile.py -p ./pos -n ./neg --no-plots   # numbers only
"""

import argparse
import json
import sys
from datetime import date
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

def file_metrics(y: np.ndarray, sr: int, low_hz: float, high_hz: float) -> dict:
    """
    Per-file calibration metrics, computed with the detector's own functions
    over the derived horn band:
      - tonality: the 95th-percentile tonality among the file's loudest frames
        (what the detector gates on — it only fires on top-RMS frames)
      - rms: peak horn-band RMS
      - durations / gaps: from the detector's blast finder at low sensitivity
    """
    rms, tonality = extract_horn_band_features(y, sr, low_hz=low_hz, high_hz=high_hz)
    if rms.size == 0:
        return {"tonality": 0.0, "peak_rms": 0.0, "durations": [], "gaps": []}

    loud = rms >= np.percentile(rms, RMS_THRESHOLD_PERCENTILE)
    ton_loud = tonality[loud] if loud.any() else tonality
    file_tonality = pct(ton_loud, TONALITY_PERCENTILE)

    # Enumerate blasts permissively so durations/gaps reflect real horns, not a
    # threshold we're still trying to choose.
    blasts = find_horn_blasts(rms, tonality, sr, HOP_LENGTH, sensitivity="low")
    durations = [b.duration for b in blasts]
    gaps = [
        blasts[i + 1].start_sec - blasts[i].end_sec
        for i in range(len(blasts) - 1)
    ]
    return {
        "tonality": file_tonality,
        "peak_rms": float(rms.max()),
        "durations": durations,
        "gaps": gaps,
    }


def collect_metrics(files: List[str], sr: int, low_hz: float, high_hz: float,
                    label: str) -> dict:
    """Aggregate per-file metrics across a corpus."""
    tonalities, peak_rms, durations, gaps = [], [], [], []
    n_blasts_files = 0
    for f in files:
        y = load_audio(f, sr)
        if y is None:
            continue
        m = file_metrics(y, sr, low_hz, high_hz)
        tonalities.append(m["tonality"])
        peak_rms.append(m["peak_rms"])
        durations.extend(m["durations"])
        gaps.extend(m["gaps"])
        if m["durations"]:
            n_blasts_files += 1
    print(f"    {label}: {len(tonalities)} files, "
          f"{len(durations)} blast(s), {len(gaps)} inter-blast gap(s)")
    return {
        "tonality": np.array(tonalities, dtype=float),
        "peak_rms": np.array(peak_rms, dtype=float),
        "durations": np.array(durations, dtype=float),
        "gaps": np.array(gaps, dtype=float),
        "n_blast_files": n_blasts_files,
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
    """Blast-duration bounds from the positive blasts (5th / 97th percentile)."""
    if pos_durations.size < 3:
        return {"min": DEFAULTS["blast_min_duration_sec"],
                "max": DEFAULTS["blast_max_duration_sec"], "from_data": False}
    lo = max(0.5, round(pct(pos_durations, 5), 1))
    hi = round(pct(pos_durations, 97) * 2) / 2  # nearest 0.5
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
    ]
    block = "\n".join(lines)
    if notes:
        block += "\n\n# Notes:\n" + "\n".join(f"#   - {n}" for n in notes)
    return block


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Calibrate train_horn_detector.py from a labeled corpus.",
    )
    ap.add_argument("--positives", "-p", required=True,
                    help="Directory of confirmed train-horn WAVs.")
    ap.add_argument("--negatives", "-n", required=True,
                    help="Directory of confirmed no-train WAVs.")
    ap.add_argument("--output-dir", "-o", default="horn_profile_out",
                    help="Where to write plots, horn_profile.json, and the report "
                         "(default: ./horn_profile_out).")
    ap.add_argument("--sr", type=int, default=TARGET_SR,
                    help=f"Resample rate (default {TARGET_SR}, the detector's).")
    ap.add_argument("--no-plots", action="store_true",
                    help="Skip the diagnostic plots (no matplotlib needed).")
    ap.add_argument("--no-json", action="store_true",
                    help="Don't write horn_profile.json.")
    args = ap.parse_args()

    pos_files = list_wavs(args.positives)
    neg_files = list_wavs(args.negatives)
    if not pos_files:
        sys.exit(f"No WAV files in positives dir: {args.positives}")
    if not neg_files:
        sys.exit(f"No WAV files in negatives dir: {args.negatives}")

    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Positives: {len(pos_files)} file(s) in {args.positives}")
    print(f"Negatives: {len(neg_files)} file(s) in {args.negatives}")
    print(f"Output dir: {outdir}\n")

    # --- 1. Spectral analysis ------------------------------------------------
    print("[1/3] Spectral analysis — finding the horn band...")
    pos_spec, freqs = median_spectrum(pos_files, args.sr, "positive")
    neg_spec, _ = median_spectrum(neg_files, args.sr, "negative")
    if pos_spec is None or neg_spec is None:
        sys.exit("Could not build spectra — check the audio files.")

    low_hz, high_hz, peak_hz, peak_contrast, contrast, band_ok = \
        derive_horn_band(pos_spec, neg_spec, freqs)
    print(f"    derived band: {low_hz:.0f}–{high_hz:.0f} Hz "
          f"(peak {peak_hz:.0f} Hz, contrast {peak_contrast:.2f}×)"
          f"{'' if band_ok else '  [low confidence — kept default band]'}\n")

    # --- 2. Threshold calibration -------------------------------------------
    print("[2/3] Threshold calibration — running detector features over corpus...")
    posm = collect_metrics(pos_files, args.sr, low_hz, high_hz, "positives")
    negm = collect_metrics(neg_files, args.sr, low_hz, high_hz, "negatives")

    tiers, med_p, med_r, ton_ok = pick_tonality_thresholds(
        posm["tonality"], negm["tonality"])
    dur_rec = recommend_durations(posm["durations"])
    win_rec = recommend_window(posm["gaps"])
    print(f"    tonality tiers: {tiers}  "
          f"(medium → precision {med_p:.0%}, recall {med_r:.0%})")
    print(f"    blast duration: {dur_rec['min']}–{dur_rec['max']}s"
          f"{'' if dur_rec['from_data'] else '  [default — too few blasts]'}")
    print(f"    confirmation window: {win_rec['window']:.0f}s, "
          f"merge gap {win_rec['merge']}s"
          f"{'' if win_rec['from_data'] else '  [default — too few gaps]'}\n")

    # Collect any caveats worth surfacing in the report / block.
    notes = []
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

    # --- assemble the profile ------------------------------------------------
    profile = {
        "generated": date.today().isoformat(),
        "detector": "train_horn_detector.py",
        "n_positives": len(pos_files),
        "n_negatives": len(neg_files),
        "horn_freq_low_hz": round(low_hz),
        "horn_freq_high_hz": round(high_hz),
        "peak_freq_hz": round(peak_hz) if peak_hz else None,
        "tonality_ratio_threshold": tiers,
        "rms_threshold_percentile": DEFAULTS["rms_threshold_percentile"],
        "blast_min_duration_sec": dur_rec["min"],
        "blast_max_duration_sec": dur_rec["max"],
        "blast_merge_gap_sec": win_rec["merge"],
        "confirmation_window_sec": win_rec["window"],
        "min_blasts_for_confirmation": DEFAULTS["min_blasts_for_confirmation"],
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
            "notes": notes,
        },
        "source": {
            "positives": str(Path(args.positives).resolve()),
            "negatives": str(Path(args.negatives).resolve()),
        },
    }

    # --- 3. Plots ------------------------------------------------------------
    saved_plots = []
    if args.no_plots:
        print("[3/3] Plots skipped (--no-plots).\n")
    else:
        print("[3/3] Rendering diagnostic plots...")
        spectra = {
            "freqs": freqs, "pos": pos_spec, "neg": neg_spec,
            "n_pos": len(pos_files), "n_neg": len(neg_files),
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

    # --- write JSON + report + parameter block -------------------------------
    block = build_parameter_block(profile, notes)

    if not args.no_json:
        json_path = outdir / "horn_profile.json"
        with open(json_path, "w") as f:
            json.dump(profile, f, indent=2)
        print(f"Wrote {json_path}")

    report_path = outdir / "calibration_report.txt"
    with open(report_path, "w") as f:
        f.write("Emmaus Observatory — train horn detector calibration\n")
        f.write(f"Generated {profile['generated']}\n")
        f.write(f"Positives: {len(pos_files)}   Negatives: {len(neg_files)}\n\n")
        f.write("Parameter block for train_horn_detector.py:\n\n")
        f.write(block + "\n\n")
        f.write("Full profile (horn_profile.json):\n\n")
        f.write(json.dumps(profile, indent=2) + "\n")
    print(f"Wrote {report_path}")
    if saved_plots:
        print(f"Plots in {outdir}/")

    # --- console: the deliverable --------------------------------------------
    print("\n" + "=" * 64)
    print("CALIBRATED PARAMETER BLOCK  (paste into train_horn_detector.py,")
    print("or just keep horn_profile.json next to it — the detector loads it)")
    print("=" * 64 + "\n")
    print(block)
    print()


if __name__ == "__main__":
    main()
