# Train Horn Detector — how to run the whole thing (Windows 11)

*The no-stress version. If you only read one doc, read this one. Commands are for
**Windows 11 PowerShell** (the default in Windows Terminal). cmd alternatives are
noted where they differ.*

You're managing three things, in plain terms:

1. **SORT** — listen to recordings and drag each into a labeled folder.
   `trains\` = confirmed horns. Every other folder (`planes\`, `vehicles\`, …) is
   just "a kind of thing that is NOT a horn." Those are your negatives — they come
   for free from the same sorting pass.
2. **CALIBRATE** — one command turns those folders into a tuned `horn_profile.json`
   **plus an accuracy report that tells you, in your own clips, how good it is.**
3. **RUN** — point the detector at recordings; it reads the profile and logs the
   train events to a CSV.

You repeat this as you gather more clips. The corpus just **grows** — keep adding
to the folders and re-run step 2 whenever you want a fresher, more accurate
profile. Nothing is ever "final"; it gets better as the pile gets bigger.

Everything runs **on your Windows PC** (where you're vetting). The only thing that
goes back to the box is the finished `horn_profile.json`, and only if you want the
box to do the detecting. We'll keep everything under one folder, `C:\horn`, so
there's nothing to hunt for. Use the same `C:\horn` on your desktop and laptop and
they stay interchangeable.

---

## One-time setup on your PC (~10 minutes, once)

**a. Install Python** (if you don't have it). Get it from
<https://www.python.org/downloads/> and on the first installer screen **tick "Add
python.exe to PATH."** (Avoid the Microsoft Store version — it sandboxes file
paths and makes this fiddlier.)

**b. Get the two scripts onto the PC.** You need `build_horn_profile.py` and
`train_horn_detector.py` from `birdstation/`, kept **in the same folder** (the
detector reads the profiler as its neighbor). Put them in `C:\horn\scripts\`.
Easiest is Git for Windows (`git clone` the repo), or just download/copy those two
files from the box.

**c. Make a Python environment with the audio libraries.** Paste this into
PowerShell once:

```powershell
py -m venv C:\horn\env
C:\horn\env\Scripts\python -m pip install --upgrade pip
C:\horn\env\Scripts\pip install librosa numpy scipy matplotlib soundfile
```

(If `py` isn't recognized, use `python` instead.) From now on, "run the
calibrator/detector" means call `C:\horn\env\Scripts\python` — no "activating"
anything, no state to forget.

**d. Make your corpus folders** — one folder with a subfolder per kind of sound:

```powershell
mkdir C:\horn\corpus
cd C:\horn\corpus
mkdir trains,vehicles,planes,gunshots,construction,other,unsure,_incoming
```

*(cmd version: `cd /d C:\horn\corpus` then
`mkdir trains vehicles planes gunshots construction other unsure _incoming`.)*

`trains\` holds confirmed horns; the rest are negatives. `unsure\` and `_incoming\`
are ignored by the calibrator (they're just your staging/parking spots). Drop your
**37 already-confirmed horns into `trains\`** now, and your **existing set-aside
negatives** into whichever folders fit.

---

## Step 1 — Pull a batch of recordings onto your PC

Windows 11 already has `ssh` and `scp` built in, so this works in PowerShell with
no extra installs. First, find where the AudioMoth WAVs live on the box (do this
once and remember the path it prints):

```powershell
ssh alan@192.168.4.132 'find ~ -maxdepth 3 -name "20*_*.WAV" 2>/dev/null | head'
```

(First connection asks you to type `yes` and your box password.) Then copy a date
range into your staging folder. AudioMoth names files `YYYYMMDD_HHMMSS.WAV`, so
"the first week of June" is a simple pattern:

```powershell
# replace <RECORDINGS_DIR> with the path you found above
scp 'alan@192.168.4.132:<RECORDINGS_DIR>/2026060[1-7]_*.WAV' C:\horn\corpus\_incoming\
```

Keep the single quotes around the remote part — they let the **box** expand the
`*` pattern. You already vetted through half of 6/1, so just grab from where you
stopped; re-copying a file you've already sorted is harmless — you'll skip it.

*(No ssh/scp for some reason? You can also pull the SD card or use WinSCP's
drag-and-drop GUI — anything that lands the WAVs in `C:\horn\corpus\_incoming\`.)*

---

## Step 2 — Sort them (the actual vetting)

Open `C:\horn\corpus\_incoming\` in File Explorer and play clips in **VLC or
Audacity** (both free, both run on Windows) however you like — or just select a
file and press Space to preview. For each clip, drag it into the folder that
matches what you hear:

| Folder | What goes in it |
|---|---|
| `trains\` | A train **horn/whistle** is clearly audible. **This is the only positive.** |
| `planes\` | Aircraft (you have lots — great, they make strong negatives). |
| `vehicles\` | Cars/trucks/motorcycles, the road. |
| `gunshots\` | The range on the mountain. |
| `construction\` | Hammering, machinery, beeping. |
| `other\` | Anything else that isn't a horn (wind, birds, voices, silence). |
| `unsure\` | **When in doubt, put it here.** Ignored by the calibrator — no harm done. |

**Three rules that keep it honest:**

- **Only put a clip in `trains\` if you'd bet money it's a horn.** A wrong clip in
  `trains\` hurts more than a missing one. Borderline → `unsure\`.
- **You don't need to trim clips.** The calibrator finds the loud moment itself.
  A 1-minute file with a horn 30 seconds in is fine.
- **The category names are up to you.** Any folder that isn't `trains\`,
  `unsure\`, or `_incoming\` counts as a negative class. Make new ones if you want
  (`emergency-siren\`, `dogs\`, whatever). More variety = better.

When `_incoming\` is empty, you're done sorting this batch.

---

## Step 3 — Ask "do I have enough yet?" (instant, no commitment)

```powershell
C:\horn\env\Scripts\python C:\horn\scripts\build_horn_profile.py --corpus C:\horn\corpus --check
```

It just counts your folders and gives a verdict — `GOOD`, `OK`, or `THIN` — with a
nudge or two ("only 12 trains — aim for 20+"). Run it anytime while you're still
sorting. **Rough targets to feel good:** ~20+ trains and ~30+ negatives spread
across 3+ categories. Below that it still works, the numbers are just shakier.

---

## Step 4 — Calibrate

When `--check` looks good:

```powershell
C:\horn\env\Scripts\python C:\horn\scripts\build_horn_profile.py --corpus C:\horn\corpus -o C:\horn\out
```

This takes a minute or two and writes everything to `C:\horn\out\`:
`horn_profile.json` (the tuned settings), six diagnostic plots, and
`calibration_report.txt` (the whole story in one text file).

---

## Step 5 — Is it accurate? (this is the part you care about)

At the end it prints an **ACCURACY ON YOUR CORPUS** block — and this is the real
thing, not a guess: it re-runs the *actual* detector over your labeled clips and
counts what it gets right.

```
ACCURACY ON YOUR CORPUS  (real detector, this profile)
  Trains caught:  38/41   (93% recall)        <- how many real horns it found
  False alarms:   2/120   (2%  ->  98% precision)  <- how often it cried wolf
    planes          2/40   (5%)   <- most confusable
    vehicles        0/45   (0%)
    gunshots        0/20   (0%)
    other           0/15   (0%)
  Verdict: Strong — this profile is ready to use.
```

- **Recall** = of your confirmed horns, how many it catches. Higher = misses fewer trains.
- **Precision** = when it says "train," how often it's right. Higher = less noise.
- **The per-class line is your map:** it shows exactly which sounds fool it. If
  `planes` is your worst, that's where to add more plane clips next time.

Open `C:\horn\out\spectrum_overlay.png` too — the green (trains) curve should have a
clear bump the red (negatives) curve doesn't. That bump **is** the horn, and the
shaded band is what the detector now listens to.

**What "good" looks like:** recall ≥ 85% and precision ≥ 90% → ship it. Lower →
see the FAQ; usually it means "add more clips," especially of the confusable class.

---

## Step 6 — Turn the profile on

The detector automatically uses a `horn_profile.json` sitting **next to it**. So:

```powershell
# put the profile beside the detector script:
copy C:\horn\out\horn_profile.json C:\horn\scripts\

# then scan recordings into a CSV of train events:
C:\horn\env\Scripts\python C:\horn\scripts\train_horn_detector.py C:\horn\corpus\_incoming --output C:\horn\trains.csv
```

To let **the box** do ongoing detection instead, copy the profile there (it's
gitignored, so it won't fight `git pull`):

```powershell
scp C:\horn\out\horn_profile.json alan@192.168.4.132:~/alans-brain/birdstation/
```

The box's `train_horn_detector.py` will pick it up the next time it runs.

---

## Step 7 — Every week (the rhythm)

1. `scp` the new week's recordings into `_incoming\` (Step 1).
2. Sort them into the folders (Step 2).
3. `--check` (Step 3).
4. Re-calibrate (Step 4) — your corpus is bigger, so the profile gets better.
5. Glance at the accuracy block (Step 5). If it improved, copy the new
   `horn_profile.json` into place (Step 6).

Your folders are the memory. They only ever grow. There's no state to manage and
nothing to undo — a misfiled clip is fixed by dragging it to the right folder and
re-running.

---

## FAQ / when something looks off

**How many clips do I really need?** Enough that `--check` says `OK`/`GOOD`
(~20+ trains, ~30+ negatives). More always helps, with diminishing returns past a
few hundred. You don't need them all before starting — calibrate early, then
re-calibrate as you add.

**"Is it accurate?" — how do I actually trust it?** The accuracy block in Step 5
is measured on *your* clips with the *real* detector. One caveat: those are the
same clips used to tune it, so it's a best-case read. For a true test, hold ~10
horns and ~10 negatives out of the corpus (a `holdout\` folder you don't pass in),
calibrate on the rest, then run the detector on the held-out ones and see if it
still gets them. (Optional — the in-corpus number is a fine day-to-day guide.)

**Recall is low (it misses horns).** Usually the horns are faint or short. Try the
`low` sensitivity when running the detector (add `--sensitivity low`), and add
more horn clips — especially distant/quiet ones — then re-calibrate.

**One class keeps fooling it (high false-alarm rate).** That sound is genuinely
horn-like at this distance. Add *more* clips of it; the calibrator will push the
threshold to separate it. If it's stuck near 50/50, that sound may just be
acoustically too close to a horn — note it and move on.

**The derived band looks wrong** (e.g. way off 250–600 Hz, or "low confidence").
That almost always means too few or too-similar negatives. Add more varied
negatives and re-run. Until then it falls back to the safe default band and tells
you so.

**`py` / `python` not found.** Re-run the Python installer and tick "Add
python.exe to PATH," or just use the full path you installed it to. Once the venv
in step (c) exists, you only ever call `C:\horn\env\Scripts\python`.

**The plane idea.** By sorting planes into `planes\`, you're already building a
labeled plane dataset for free. Today they just serve as negatives (and the
accuracy block tells you how plane-vs-horn-separable they are). If planes turn out
to have their own clean signature, that's the seed of a second detector later —
no extra work now.

---

## Cheat sheet

```powershell
# 0. setup (once)
py -m venv C:\horn\env
C:\horn\env\Scripts\pip install librosa numpy scipy matplotlib soundfile
mkdir C:\horn\corpus; cd C:\horn\corpus
mkdir trains,vehicles,planes,gunshots,construction,other,unsure,_incoming

# 1. pull a week of recordings (replace <RECORDINGS_DIR>)
scp 'alan@192.168.4.132:<RECORDINGS_DIR>/2026060[1-7]_*.WAV' C:\horn\corpus\_incoming\

# 2. sort in File Explorer + VLC/Audacity (trains\ = horns, everything else = negatives)

# 3. enough yet?
C:\horn\env\Scripts\python C:\horn\scripts\build_horn_profile.py --corpus C:\horn\corpus --check

# 4. calibrate
C:\horn\env\Scripts\python C:\horn\scripts\build_horn_profile.py --corpus C:\horn\corpus -o C:\horn\out

# 5. read C:\horn\out\  (accuracy block + spectrum_overlay.png)

# 6. turn it on
copy C:\horn\out\horn_profile.json C:\horn\scripts\
C:\horn\env\Scripts\python C:\horn\scripts\train_horn_detector.py C:\path\to\recordings --output C:\horn\trains.csv
```
