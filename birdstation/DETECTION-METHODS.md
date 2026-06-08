# Train detection — methods, calibration pipeline, and caveats

The canonical, plain-English record of how the Emmaus Observatory decides
something is a train, how that decision is tuned, and what it can and can't do.
A condensed, machine-readable version lives in `data/train-method.json` and is
surfaced on the Observatory **Trains** tab ("ℹ️ How these are detected"); keep
the two in sync when the method changes.

## TL;DR

A train **horn** is the target signal (the mic is ~1,500–1,700 ft from the
tracks — rumble doesn't carry, the horn does). Detection is **automatic** and
shown in real time: a loose trigger grabs candidate clips, a **calibrated horn
detector confirms each inline** (~96% precision), and confirmed events publish on
their own. There's **no per-event human approval** — a person only *strikes off*
the occasional false positive (post-moderation). Clip audio stays **private** by
default (backyard mic); the event still shows and counts. Current tuned accuracy:
**94% of train passes caught, 96% precision** on a 131-horn / 109-negative corpus.

## One detector, two stages (the cascade)

A single always-on process, `train_detector.service`, runs a two-stage cascade:

1. **Loose trigger** (`train_detector.py`) — watches the Icecast stream in real
   time and grabs a candidate clip whenever there's sustained energy in 300–1500
   Hz. Deliberately loose / high-recall: better to look than miss. Cheap.

2. **Calibrated confirm** (`train_horn_detector.py`, imported) — the moment a clip
   is grabbed, `train_detector` runs the tuned horn detector on it inline (narrow
   band + tonality + blasts, from `horn_profile.json`). Confirmed → the event is
   written `verdict='train'` and **auto-published** to the page (audio private,
   `published=0`); not a horn → `verdict='false_positive'`, hidden. `reviewed`
   stays 0 (a machine call).

So `train_horn_detector.py` is a **shared library** (+ an offline batch CLI used
by calibration), not a second daemon. If its deps (librosa/scipy) aren't
installed, `train_detector` writes events *pending* (verdict NULL) and
`train_confirm.py` scores them later — see below. `build_horn_profile.py` tunes
the confirm stage; `train_confirm.py --rescore` re-applies a new profile to past
machine decisions.

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
5. **Deploy** the profile to the box (`horn_profile.json` next to
   `train_horn_detector.py`); restart `train_detector` and run
   `train_confirm.py --rescore` to re-apply it to past machine decisions.
6. **Strike off** any false positives the auto-detector publishes
   (`sync_train_verdicts.py reject …`) — each strike-off is also a fresh labeled
   negative to fold back into the corpus.
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

## Privacy & exception review (post-moderation)

- **Auto-publish, audio-private:** the confirm stage writes `verdict='train'` and
  the event shows immediately, but the clip **audio is served only if
  `published=1`** (default 0) — backyard audio never goes public un-listened. The
  page filter is "show `verdict='train'`" (auto + any human-verified), hiding only
  false positives; the clip endpoint 403s anything not published.
- **Strike off (the only required human step):** no pre-approval. Pull the
  confirmed clips from the box, listen, and strike off any false positive with
  `sync_train_verdicts.py reject <clip|folder> …` (sets `verdict='false_positive'`,
  `reviewed=1` → off the page). Rejected clips are removed by the weekly purge.
- **Publish audio (opt-in):** `sync_train_verdicts.py publish <clip> …` makes a
  specific clip's audio public.
- Live, per-clip alternative on the box: `review_trains.py`.

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
