# Command cookbook — the things I always forget

A catalog of the CLI commands for running Alan's Brain + birdstation. Most have a
one-click equivalent in the admin tool (`python admin.py gui` → see `ADMIN.md`),
but this is the fallback reference for when you're in a terminal.

**Conventions:** the box is `birdstation` (SSH `you@your-box`), run-from-clone
at `~/alans-brain`, secrets in `/etc/birdstation.env`. Replace host/paths with your
own (the admin tool reads them from `admin-config.json`).

---

## Admin tool (does most of the below for you)

```bash
python admin.py gui                      # launch the GUI
python admin.py                          # list every group + command
python admin.py git sync -m "message"    # stage all, commit, push (publish)
python admin.py box status               # box health snapshot
python admin.py box pull --match "train_2026-06-*.wav"   # pull clips to sort
python admin.py box calibrate            # rebuild horn_profile.json + accuracy
python admin.py box deploy-profile       # scp profile to box + restart detector
```

---

## Git / publishing the site

```bash
git status -sb
git add -A && git commit -m "message"
git push -u origin <branch>              # e.g. main
git pull origin <branch>

# branch + merge (fast-forward main when a feature branch is one ahead)
git checkout -b claude/my-feature
git push origin claude/my-feature:main   # FF main to the feature tip
```
Vercel deploys the static site automatically on push. **Bump the `?v=` query** on
any changed `observatory.js` / `style.css` so caches don't serve stale assets.

---

## birdstation — deploy & services

```bash
# deploy box/site code (run on the box, or `admin.py box deploy`)
cd ~/alans-brain && git pull && sudo systemctl restart birdapi

# a changed systemd unit also needs:
sudo systemctl daemon-reload
sudo ~/alans-brain/birdstation/link_units.sh   # only for a brand-new unit

# services (canonical units)
sudo systemctl restart birdapi          # FastAPI (the website's data)
sudo systemctl restart birdnet          # BirdNET pipeline
sudo systemctl restart train_detector   # live train detector (loads horn_profile.json)
systemctl is-active birdapi birdnet train_detector
journalctl -u train_detector -f         # follow a service's log
```

---

## Train horn detector — vet → calibrate → deploy

Full runbook: `birdstation/HORN-CORPUS-GUIDE.md`. The short version (mostly the
**Trains / Box** GUI panel):

```powershell
# 1. PULL a batch from the box into the corpus (on your PC)
scp 'you@your-box:~/train_clips/train_2026-06-*.wav' C:\horn\corpus\_incoming\

# 2. SORT in File Explorer + VLC: trains\ = horns, every other folder = a negative

# 3. CHECK readiness (no commitment)
C:\horn\env\Scripts\python birdstation\build_horn_profile.py --corpus C:\horn\corpus --check

# 4. CALIBRATE — writes horn_profile.json + an accuracy block
C:\horn\env\Scripts\python birdstation\build_horn_profile.py --corpus C:\horn\corpus -o C:\horn\out

# 5. DEPLOY the profile to the box (it auto-loads next run)
scp C:\horn\out\horn_profile.json you@your-box:~/alans-brain/birdstation/
ssh you@your-box 'sudo systemctl restart train_detector'
```

`build_horn_profile.py` flags: `--corpus DIR` (has `trains/` + negative folders) |
`--positives DIR` / `--negatives DIR…` | `--check` (census only) | `-o OUT` |
`--min-blasts {1,2,3}` | `--pass-gap-min N` | `--no-plots` | `--no-validate`.

---

## Train events — vetting & the Observatory page

```bash
# bridge sorted folders -> page verdicts
#  (PC) emit a CSV from the corpus:
python birdstation/sync_train_verdicts.py emit --corpus C:\horn\corpus --out train_verdicts.csv
scp train_verdicts.csv you@your-box:~/
#  (box) preview then apply:
python3 ~/alans-brain/birdstation/sync_train_verdicts.py apply --csv ~/train_verdicts.csv --dry-run
python3 ~/alans-brain/birdstation/sync_train_verdicts.py apply --csv ~/train_verdicts.csv

# strike off false positives (off the page; weekly purge removes audio)
python3 ~/alans-brain/birdstation/sync_train_verdicts.py reject train_2026-06-01T08-30-00.wav

# make one clip's audio public (default is private)
python3 ~/alans-brain/birdstation/sync_train_verdicts.py publish train_2026-06-01T08-30-00.wav

# why was a train missed? (Eastern time, ± window)
python3 ~/alans-brain/birdstation/train_inspect.py 10:30pm
python3 ~/alans-brain/birdstation/train_inspect.py 22:30 -w 60 --rejects-only

# re-apply a fresh profile to past *machine* calls (never touches human verdicts)
python3 ~/alans-brain/birdstation/train_confirm.py --rescore --dry-run

# manual interactive vetting on the box
python3 ~/alans-brain/birdstation/review_trains.py

# weekly clip purge (Sun 04:00 timer; manual run supported)
python3 ~/alans-brain/birdstation/purge_train_clips.py --dry-run
```

---

## Birds — life list & maintenance (box)

```bash
# catch up the life list for species that already qualify (after a rule change)
python3 ~/alans-brain/birdstation/backfill_life_list.py --dry-run
python3 ~/alans-brain/birdstation/backfill_life_list.py

# label existing lifers with HOW they qualified (incl. grandfathered)
python3 ~/alans-brain/birdstation/backfill_qualified_via.py --dry-run
python3 ~/alans-brain/birdstation/backfill_qualified_via.py

# confirm life-list detections from archived clips (--stats = precision by band)
python3 ~/alans-brain/birdstation/review_birds.py --stats

# clear old sub-floor detection noise (one-shot; backs up first)
python3 ~/alans-brain/birdstation/purge_low_confidence.py --floor 0.60 --dry-run

# daily bird-clip purge (timer; manual run supported)
python3 ~/alans-brain/birdstation/purge_bird_clips.py --dry-run
```

---

## Quick DB peeks (box, read-only)

```bash
sqlite3 ~/birdnet.db "SELECT verdict, COUNT(*) FROM train_events GROUP BY verdict;"
sqlite3 ~/birdnet.db "SELECT COUNT(*) FROM train_events WHERE verdict='train' AND reviewed=0;"  # pending
sqlite3 ~/birdnet.db "SELECT COUNT(*) FROM detections WHERE confidence>=0.85;"
sqlite3 ~/birdnet.db "SELECT COUNT(*) FROM lifetime;"                       # life-list size
sqlite3 ~/birdnet.db "SELECT title FROM feed_items ORDER BY rowid DESC LIMIT 5;"  # latest Pulse items
```

---

## Pulse (box)

```bash
sudo systemctl restart pulse-fetch.timer pulse-enrich.timer pulse-digest.timer
python3 ~/alans-brain/birdstation/pulse_digest.py        # force a brief now
# if an API outage capped enrich attempts, reset them:
sqlite3 ~/birdnet.db "UPDATE feed_items SET enrich_attempts=0 WHERE enriched_at IS NULL;"

# Add Lehigh Valley events to the "What's On" board (paste-to-capture; run on the box).
# Paste a flyer / forwarded newsletter / copied page; AI parses -> you review -> publish.
python3 ~/alans-brain/birdstation/pulse_add.py                 # opens $EDITOR
python3 ~/alans-brain/birdstation/pulse_add.py --file blob.txt # from a file
pbpaste | python3 ~/alans-brain/birdstation/pulse_add.py -     # from stdin
# peek at upcoming events
sqlite3 ~/birdnet.db "SELECT starts_at, kind, title, venue FROM events ORDER BY starts_at LIMIT 20;"
```

---

## Site media optimization (local)

```bash
python admin.py media all --dry-run     # compress images, WebP, audio (preview)
python admin.py media report            # what's unoptimized
```

> Add to this file whenever you reach for a command you had to look up. It's the
> memory you keep meaning to write down.
