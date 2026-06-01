# PLAN — Train detection vetting & privacy

> Status: **partially shipped** (2026-06-01). The privacy gate + CLI review +
> weekly purge are live; the web review UI and the "known trains improve
> detection" loop are future work. Keep this doc in sync as pieces land.

## Why

The train detector reads the backyard mic stream, so a clip can capture **us
talking** — that must never be public. The original build published *every*
detection and served *every* clip by URL. The fix is **default-deny**: nothing
is public until a human confirms it's actually a train.

## Data model (existing columns, now enforced)

`train_events`: `id, detected_at, duration_s, peak_db, clip_path, reviewed, verdict`.

- `reviewed = 0` → pending (hidden everywhere public).
- `verdict = 'train'` → the **only** state that is public.
- `verdict in ('false_positive','unsure')` → reviewed but stays hidden; clip
  becomes eligible for purge.

## Shipped (2026-06-01)

### 1. Public gate (API + front-end) — PR #6
- `GET /api/trains/recent?approved=1` → `verdict='train'` only. The public page
  requests this **and** re-filters client-side (defense in depth).
- `GET /api/trains/clip/{file}` → 403 unless the file belongs to a
  `verdict='train'` event. Un-vetted clips aren't downloadable by direct URL.
- `GET /api/trains/today` → approved only. `GET /api/trains/clips[/count]` →
  behind the API key (they enumerate all files on disk).
- Stats expose `approved_total` / `approved_today`; the page shows those and no
  longer surfaces an "Unreviewed" count publicly.

### 2. CLI review tool — `birdstation/review_trains.py`
Walks the pending queue on the box, plays each clip (ffplay/aplay/paplay, or
metadata-only with `--no-audio`), records `train` / `false_positive` / `unsure`
straight into the DB (no restart needed). `--all` re-vets decided events.

```bash
python3 ~/alans-brain/birdstation/review_trains.py
```

### 3. Weekly clip purge — `purge_train_clips.py` + `purge-train-clips.{service,timer}`
Sunday 04:00 local. Deletes clips of **rejected** events (and clears their
`clip_path`) and aged **orphan** files; **keeps** approved-train clips and any
still-pending clip. `--dry-run` to preview. Install the timer at deploy:

```bash
sudo cp ~/alans-brain/birdstation/systemd/purge-train-clips.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now purge-train-clips.timer
```

## Next — more robust vetting (web review UI)

A passphrase-gated review surface like `tasks.html`, so vetting doesn't require
SSH:
- New page (e.g. `observatory-review.html`) listing pending events with inline
  audio + Train / Not-train / Unsure buttons; mobile-first.
- Reuses the existing authenticated `POST /api/trains/{id}/verdict`
  (`X-API-Key`). Decide how the page holds the key — the tasks-page passphrase
  pattern, or a short-lived token — **without shipping the key in static JS**.
- Optional: a small `GET /api/trains/pending` (key-gated) so the page lists only
  the queue.
- Consider a "report a problem / take this down" affordance even on approved
  events, as a fast public-facing kill switch.

## Later — known trains improve detection

Turn confirmed events into a feedback loop so detection gets better over time
(Alan's ask). Sketch, lightest-first:

1. **Threshold tuning from labels.** Once enough events are vetted, compare the
   `peak_db` / band-energy distributions of `train` vs `false_positive` and pick
   `ENERGY_THRESH` / `DB_THRESH_DB` that best separate them — replacing today's
   hand-set 0.10 / -20. Could be a periodic report, then a manual config bump.
2. **Schedule prior.** Trains run on a rough timetable; log the local times of
   confirmed trains and weight detections that fall in those windows (or just
   surface "usual times" on the page).
3. **Acoustic fingerprint.** Save a compact spectral signature per confirmed
   train; score new candidates by similarity to known-train signatures vs.
   known-false ones (voices, dogs, mowers). A k-NN / small classifier on a
   handful of features beats raw thresholds and needs no heavy ML.
4. **Keep the audio minimal.** Whatever we build, retention stays short (the
   weekly purge) and only confirmed-train audio persists beyond a week.

Open question to settle before #3: how many labeled events we realistically
accumulate per week — that decides whether a learned classifier is worth it or
tuned thresholds are plenty.
