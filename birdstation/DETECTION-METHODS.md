# Train detection — methods, calibration pipeline, and caveats

The canonical, plain-English record of how the Emmaus Observatory decides
something is a train, how that decision is tuned, and what it can and can't do.
A condensed, machine-readable version lives in `data/train-method.json` and is
surfaced on the Observatory **Trains** tab ("ℹ️ How these are detected"); keep
the two in sync when the method changes.

## TL;DR

A train **horn** is the target signal (the mic is ~1,500–1,700 ft from the
tracks — rumble doesn't carry, the horn does). Software flags horn-like sound,
groups blasts into train *passes*, and a **human confirms** each before it's
published. Only confirmed trains appear, and clip audio is private by default
(backyard mic). Current tuned accuracy: **94% of train passes caught, 96%
precision** on a 131-horn / 109-negative corpus.

## Two detectors (important context)

There are two, and they serve different roles:

1. **Live stream detector** (`train_detector.py`, `train_detector.service`) —
   watches the Icecast stream in real time, flags sustained energy in a wide
   300–1500 Hz band, and writes a `train_events` row + a clip. This is what has
   produced the events you currently vet. It's deliberately loose (a candidate
   generator), which is why human review exists.

2. **Offline horn detector** (`train_horn_detector.py`) — a more precise,
   *calibrated* detector that scans recorded WAVs for the horn specifically
   (narrow band + tonality + multi-blast). This is the one `build_horn_profile.py`
   tunes. It's the method described below and the path to better automatic
   precision.

**Convergence (roadmap):** the calibrated horn profile should eventually drive
the live pipeline (or a batch pass over recordings should write `train_events`),
so the thing flagging events matches the thing we've tuned. Until then, the page
honestly reads as "acoustic candidate **+ human confirmation**," with the
calibrated parameters shown as the tuned method.

## The acoustic method (the horn detector)

Per file/stream window, in `train_horn_detector.py`:

1. **STFT** → magnitude spectrum (n_fft 1024, hop 512 @ 22.05 kHz).
2. **Horn-band energy** in the calibrated band (currently **300–520 Hz**) and a
   broadband reference (100–1200 Hz).
3. **Tonality ratio** = horn-band energy ÷ broadband energy, per frame. A horn is
   near-tonal → high ratio; wind/planes/engines are broadband → low ratio. A
   frame is "active" when it's both **tonal** (ratio ≥ the medium threshold) and
   **loud** (top-15% RMS in that file).
4. **Blasts** = contiguous active runs within a duration window (brief drops
   merged). Too-short = transient, too-long = a sustained non-horn tone.
5. **Confirmation** = enough blasts within a window. For single-event clips one
   blast confirms; for continuous audio 2+ is safer against lone blips
   (`MIN_BLASTS_FOR_CONFIRMATION`, calibrated — see below).
6. **Passes** = events/clips within a few minutes are the same physical train.

A runtime `horn_profile.json` next to the script overrides the built-in
constants, so calibration flows straight into detection.

## Calibration — `build_horn_profile.py`

Turns a labeled corpus into a tuned `horn_profile.json` + an honest accuracy
read. The corpus is one folder per sound class: `trains/` = positives, every
other folder (`planes/`, `vehicles/`, `gunshots/`, …) = a labeled negative.

- **Find the real band** from the positive-vs-negative spectral *contrast* (where
  horns carry energy the negatives don't) — may be narrower than the 250–600 Hz
  guess.
- **Calibrate thresholds at the operating point** — tonality tiers (low/med/high
  by precision/recall), blast duration (with headroom so real horns aren't
  clipped), inter-blast gap / window. Measured with the detector's own functions,
  so the numbers reflect the deployed code.
- **Calibrate the blast count** — the corpus is single-event clips, so requiring
  2 blasts tanks recall; it scores ≥1/≥2/≥3 and picks the best, writing
  `MIN_BLASTS_FOR_CONFIRMATION`. `--min-blasts` forces it.
- **Validate end-to-end** — runs the *real* detector over the labeled clips and
  reports **blast-level recall** (horn found at all), **confirmed recall**, and
  the headline **pass-level recall** (clips within `--pass-gap-min` grouped into
  passes; a pass counts if any clip has the horn — the number that matters), plus
  per-class false-alarm rates and a one-line verdict.
- **Outputs:** `horn_profile.json`, six diagnostic plots, `calibration_report.txt`,
  a paste-ready parameter block, and `missed_positives.txt` (positives where no
  horn was found — listen to decide faint vs. mislabeled vs. out-of-band).

Worked example (2026-06-07, 131 horns / 109 negatives): band 300–520 Hz,
tonality ≥ 2.1, 1 blast to confirm → **94% passes / 96% precision** (planes 0/50).

## The refinement pipeline (repeatable loop)

The detector improves as the corpus grows. The loop:

1. **Pull** new recordings/clips (`HORN-CORPUS-GUIDE.md`).
2. **Sort** by ear into class folders (`trains/`, `planes/`, …).
3. **Calibrate** (`build_horn_profile.py --corpus …`) and read the accuracy block.
4. **Inspect misses** (`missed_positives.txt`) and confusable classes; add more of
   what's weak (e.g., distant horns, the look-alike that false-fires).
5. **Deploy** the profile (`horn_profile.json` next to the detector / on the box).
6. **Vet → publish** confirmed trains to the page (`sync_train_verdicts.py`), which
   also **preserves them as labeled data** (see below).
7. **Re-calibrate** whenever the corpus grows — nothing is ever "final."

The corpus folders are the memory; they only grow. Each pass tightens the band,
the thresholds, and the per-class precision.

## Confirmed trains are preserved for analytics

Every clip you confirm becomes a durable, labeled record — not lost:

- `sync_train_verdicts.py` writes `verdict='train'` + `category` to `train_events`
  (the same rows the page reads). The clip is kept by the purge (approved trains
  aren't aged out).
- Each row carries `detected_at` (timestamp), `duration_s`, `peak_db`, and now
  `category`, so **frequency** (passes/day), **headway** (typical gap between
  trains), and **time-of-day** distributions are all derivable.
- The **pass-grouping** used in calibration (clips within N minutes = one train) is
  the same logic the analytics view will use to count trains rather than clips.

So the vetting does double duty: it fills the page *and* banks a growing,
categorized dataset for the analytics view (designed in `PLAN-train-analytics.md`).

## Privacy & human review

- **Default-deny:** only `verdict='train'` events show; the page re-filters
  client-side and the clip endpoint 403s anything un-approved.
- **Audio private by default (2026-06-06):** confirming a train makes the *event*
  count and show, but the clip audio is served only if `published=1`
  (`sync_train_verdicts.py publish …`, or `apply --publish-trains`). Backyard mic →
  audio is opt-in.
- Review tools: `review_trains.py` (per-clip, on the box) or the batch bridge.

## Caveats (what this is NOT)

- **Recall is horn-bound:** a train that doesn't sound its horn, or sounds it too
  faintly to carry ~1,500 ft, won't be caught. Counts are "horns we caught and
  confirmed," not every train.
- **One mic, no kinematics:** no direction, speed, or length; a single point in
  space.
- **Look-alikes exist:** planes/sirens can be tonal; calibration pushes them down
  (planes currently 0/50) but human review is the real safeguard.
- **Clip corpus ≠ continuous stream:** thresholds tuned on isolated clips can read
  optimistically; `MIN_BLASTS_FOR_CONFIRMATION` and the band should be sanity-checked
  when the calibrated detector runs on long recordings (`--min-blasts 2` to compare).
- **Parameters drift:** every recalibration can move the band/thresholds; the page's
  method panel and `data/train-method.json` must be updated to match (the accuracy
  figures are corpus-measured, not a live guarantee).

## Where it's surfaced

- `data/train-method.json` → the Trains-tab "How these are detected" panel
  (`observatory.js` `loadTrainMethod()`), so visitors and you see the live method,
  parameters, accuracy, and caveats.
- This file is the long-form source; link to it from the panel.
