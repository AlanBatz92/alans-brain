# Roadmap — Alan's Brain

> The running to-do list. Ask "what's on the list?" any time; we (re)prioritize
> here and keep it current. **Convention:** when a feature lands, move it to
> "Done (recent)" with a date and add the matching `Build History.md` entry.
> Detailed designs live in the `PLAN-*.md` docs; this file is the index + status.
>
> Status key: **▶ Next** · **◷ Soon** · **○ Later** · **✓ Done**

---

## ▶ Next

### 1. Observatory: "comic-book" bird cards — **steps 1–3 + polish + recent hits done**  (design: `PLAN-observatory-cards.md`)
Quick-card modal is live: Wikipedia photo (full bird visible, not cropped),
filtered description, word-boundary extract, comic-book stats grid (Heard Here /
Best ID / First Heard / Last Heard), sort controls on both species grid and life
list, and (2026-06-03) a **recent-hits list** — the last 10 detections with
confidence + time and a life-list-progress status line. **Remaining:** step 4 —
detail view (larger photo + full extract + confidence sparkline + by-hour bar chart).

### 2. Observatory: timeline + species search — **done 2026-06-01**
Period selector (Today / Yesterday / This week / This month) and a live search
box above the species grid. `GET /api/detections/grouped?start=&end=` serves
pre-aggregated species data for any date range. Search is client-side (no
refetch). Sort controls added (Recent / Most heard / Least heard).

### 3. Train vetting — more robust workflow  (design: `PLAN-train-vetting.md`)
Privacy gate + CLI review (`review_trains.py`) + weekly purge shipped 2026-06-01.
Next: a **passphrase-gated web review page** (like `tasks.html`) so vetting
doesn't need SSH — reuse `POST /api/trains/{id}/verdict`, hold the key safely
(don't ship it in static JS), maybe add a key-gated `/api/trains/pending`. Then
the **"known trains improve detection"** loop: tune thresholds from labelled
events → schedule prior → acoustic fingerprint (details in the plan).

---

## ◷ Soon

### 3. Confidence-tuning follow-ups (life list)
- **Current gate (2026-06-02):** a new species joins after **3 detections at
  ≥ 0.85 within a rolling 24h window, or one ~100% (≥ 0.995) hit** (instant).
- **Preserve floor raised (2026-06-03):** the box now keeps only detections ≥ 0.85
  (was 0.35); the page floor matches at 0.85. Cleaner analytics, but watch that the
  tighter floor doesn't starve the calibration set (review_birds bands all start at
  0.85, so no loss there) or hide a genuinely-heard-but-quiet species.
- **✓ Verifiable lifers (2026-06-02):** the pipeline archives one clip per
  life-list-qualifying detection (`~/bird_clips`, one per species/day);
  `review_birds.py` labels them and `--stats` prints measured precision by
  confidence band. **Next:** fit a logistic score→probability calibration
  (Wood & Kahl 2024) once enough labels accrue; optional on-page "provisional vs.
  confirmed" tier.
- **✓ Seasonal filter (2026-06-02):** `--week` (BirdNET's 1-48 week) is now passed
  to the analyzer, so it filters by season as well as location.
- **Watch:** see how the 3-hits/24h rule feels — a genuinely rare flyover heard
  once or twice still won't list. If too strict, revisit the window or a tier.
  Also watch whether the season filter ever hides a real off-season vagrant.
- **Later:** per-species thresholds (some calls are easier to ID than others).

### 4. Pulse ingestion — Phase 4 (full design in `PLAN-ingestion.md`)
Generalize ingestion beyond RSS: pluggable adapters (scrape/email/manual), a
separate `events` store + "What's On" surface, AI-as-parser. First sources:
**Emmaus Theater calendar** (scrape) and **Joey Strain's "Bug Club"** email
(paste-to-capture). Decisions settled: separate events store; paste-first email.

---

## ○ Later

### 5. Citation link resolution
Brief citations currently link to Google News RSS redirect URLs (functional but
ugly). Resolve to the publisher's canonical URL when storing the digest.

### 6. Email delivery of the Morning Brief
Deferred from the digest build (we shipped on-page only). Would add SMTP/mail
infra on birdstation — only if "comes to you" is wanted.

### 7. birdstation auto-deploy
A systemd path-unit or cron that runs `git pull` (+ targeted restarts) so deploys
are hands-off instead of manual. Only worth it once the manual rhythm proves a chore.

### 8. Inline citation markers
Optional UX alternative to the per-section `Sources:` line — `[n]` markers woven
into the prose. More fragile; revisit only if the current style feels lacking.

---

## ✓ Done (recent)

- **2026-06-03** — Observatory: recent hits on bird cards + 85% preserve/display
  floor. Bird cards now show the **last 10 detections** (confidence + time, newest
  first) plus a life-list-progress line ("N of 3 qualifying hits in 24h" or "✓ On the
  life list"); `/api/species/{name}` gained `recent[]` / `hits_24h` / `on_life_list`.
  The box's `MIN_CONFIDENCE` was raised **0.35 → 0.85** (preserve only confident hits)
  and the page's display floor **0.75 → 0.85** to match — clean locale analytics,
  only-going-forward (existing rows left in place). Life-list clips stay **local-only**
  (declined a public/web surface for backyard-mic privacy). `?v=obs13`/`obs11`.

- **2026-06-02** — Verifiable lifers + BirdNET seasonal filter (box-side). The
  pipeline now passes `--week` (season filter atop lat/lon) and archives one WAV per
  life-list-qualifying detection (`~/bird_clips`, one per species/day) for
  spot-checking + calibration. New `review_birds.py` (label clips; `--stats` =
  measured precision by confidence band) and `purge_bird_clips.py` +
  `purge-bird-clips.timer` (daily; keeps labelled clips, ages out unreviewed > 30d).
  `detections` gains `clip_path` + `verified` (auto-migrated by `init_db`). Clips are
  never served publicly (backyard-mic privacy).

- **2026-06-02** — Life-list gate retuned + Observatory period-aware stats.
  Box-side: a new species now lists after **3 hits at ≥ 0.85 in a rolling 24h**,
  or instantly on a **~100% (≥ 0.995)** hit (`birdnet_pipeline.py`); the rolling
  window replaces the old calendar-day rule. Front-end: the headline stat cards
  follow the selected filter ("Heard/Species <period>") and a **"This year"** tab
  was added; Life list stays all-time. `observatory.js?v=obs11`. Includes a
  misidentification-probability writeup (see `Build History.md`).

- **2026-06-02** — Tech Stack polish (`techstack.html`): 32-term glossary popovers
  (every technical term clickable with plain-English definitions), custom icons
  from the site's existing icon set (AudioMoth, birdnode, Cloudflare, Porkbun,
  website), improved node spacing via 5/4 canvas aspect-ratio + retuned positions.


- **2026-06-02** — Tech Stack page (`techstack.html`): interactive SVG node-graph,
  11 nodes, 12 protocol-labeled edges, tap-to-explore bottom-sheet panels with
  connection chips. Correctly documents birdnode (Pi Zero 2 W, Icecast) as a
  distinct device between AudioMoth and birdstation. "Stack" top-level nav tab
  added to all 15 pages.

- **2026-06-01** — Observatory polish + Pulse citation fix: hero subtitle updated;
  Trains tab dynamically sets tagline to "I like trains."; bird card photo now shows
  full bird (contain); comic-book stats grid replaces chips (Heard Here / Best ID /
  First Heard / Last Heard with date+time); generic descriptions filtered; word-boundary
  truncation; sort controls on period grid + life list. Pulse section Sources: lines
  now show article title rather than source label.

- **2026-06-01** — Train privacy: public Observatory now shows **only
  human-confirmed** train events (default-deny on `verdict='train'`); clip
  endpoint 403s un-vetted audio. CLI vetting (`review_trains.py`) + weekly clip
  purge (`purge-train-clips.timer`). Docs: `PLAN-train-vetting.md`.

- **2026-06-01** — Train detector fixed & confirmed on the box: it was reading
  encoded MP3 bytes as PCM (never decoded) → 0 events ever; now decodes via
  ffmpeg and reads `localhost:8000/backyard`. Log shows the fix working (no more
  stuck "-4.9 dB candidate"); awaiting a passing train to log the first event.
- **2026-06-01** — Life-list gate → **0.75 + 3 hits/day**, and bird DB reset for
  a clean start (`reset_birds.sh`; 3244 detections / 31 lifers cleared, Pulse's
  682 feed items preserved). Page floor bumped to 0.75 (`?v=obs4`).
- **2026-05-31** — Observatory iteration: confidence gate (≥ 0.70, server +
  client), grouped-by-species "Heard today" cards with confidence bars, honest
  derived stats (fixed inflated counts), scientific names on lifers, CSS
  cache-bust. Surfaced the trains-not-recording box-side issue (now ▶ Next #1).
- **2026-05-31** — Bird & Train Observatory POC front end (`observatory.html` /
  `observatory.js`): combined two-tab page, load-once + refresh, now linked
  from the home Explore grid + site-wide nav dropdown. Follow-ups when ready:
  possibly split Birds/Trains; richer views (per-species history, hourly charts,
  train clip review). Note: `/api/detections?limit=`, `/api/trains/today`,
  `/api/trains/clips` remain available but unused by the POC.
- **2026-05-31** — Citations UI polish: wrapping `Sources:` lines, collapsible
  Citations block.
- **2026-05-31** — Life-list confidence gate (0.70).
- **2026-05-31** — birdstation cutover to run-from-clone; whole box in git.
- **2026-05-30** — BirdNET CSV-delimiter fix (0 → detections flowing).
- **2026-05-30** — Citations in the Morning Brief (front + back end).
- **2026-05-29** — Daily AI "Morning Brief" (Sonnet 4.6, on-page).
