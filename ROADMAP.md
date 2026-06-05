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
- **Three-tier floors (2026-06-03):** preserve 0.60 (box keeps, for diagnostics) /
  display 0.85 (page + analytics) / life-list 0.85 + count. `purge_low_confidence.py`
  clears old < 0.60 noise. Watch: the 0.60 preserve floor still discards the very
  lowest hits — fine for diagnostics, but if a genuinely-heard-but-quiet species needs
  inspecting below 0.60, lower the floor temporarily. The card's recent-hits list is
  also the natural home for a future per-hit clip/spectrogram link if clips ever get a
  (privacy-safe) surface.
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

### 3a. Train analytics — `Birds | Trains` toggle on the Analytics tab  (design: `PLAN-train-analytics.md`)
**New (2026-06-05).** Add a `Birds | Trains` toggle to the Analytics tab that swaps the
dataset and re-renders — reusing the stat cards, hour chart, and per-day chart, swapping
in a **day-of-week × hour heatmap**, **duration/loudness histograms**, and a **headway**
("typical wait between passes") card. Backed by a new approved-only
`GET /api/trains/analytics` (mirrors `/api/analytics`' Eastern bucketing). **Gated on train
data:** the detector must be producing **vetted** events first (ties to ▶ Next #3 / the
`PLAN-train-vetting.md` review loop). Front-end scaffold (the toggle + empty state) can land
ahead of the data. Full build order + endpoint shape in `PLAN-train-analytics.md`.

### 3b. Observatory ideas backlog — re-prioritized 2026-06-05
Building on the Analytics tab / `GET /api/analytics` / bird cards. Tags: **[new]** = added
from the 2026-06-05 brainstorm, **[tracked]** = already on the list before then.

Highest-value, low-effort (do next):
- **[tracked] Bird-card detail view (step 4)** — larger photo + full extract + confidence
  sparkline + by-hour histogram. The per-species hourly data already exists. (Note:
  `/api/species/{name}`'s `by_hour` is **UTC**-bucketed and unused; switch it to Eastern,
  like `/api/analytics`, when the card chart is built.) This is also ▶ Next #1's remaining step.
- **[new] Year calendar heatmap** — GitHub-style 7×53 grid of detections/day; pairs with the
  **All** period to show seasonality at a glance. Reuses the heatmap cell styling.

Bigger / more data or math:
- **[tracked] Seasonal / first-arrival** view (when each species shows up across the year) +
  **[tracked] life-list growth curve** (cumulative new species over time).
- **[tracked] Confidence-distribution histogram** (ties into the calibration work).
- **[new] "Compared to usual"** — on Today, show each stat vs. its trailing baseline
  ("23 species today · typically ~18"). Needs a baseline computation.
- **[new] Rare visitors** — rank species by how seldom they're detected here; surface the
  uncommon ones. Derivable from all-time counts.
- **[new] Diversity trend** — a Shannon-diversity number per day ("how varied was the chorus")
  trending over time. Niche, on-brand.
- **[new/tracked] Weather correlation** — join detection volume against `weather.js` data
  (temp/wind/precip). The most *uniquely yours* idea (stitches two of your own systems); was
  loosely tracked as "weather correlations (later)", now spelled out. Needs a weather-history join.

✓ **Done from this backlog:** dawn-chorus shading on the hour chart (2026-06-05); the
**"Almost a lifer" shelf** (2026-06-05) — both in "Done (recent)" above.

### 4. Pulse ingestion — Phase 4 (full design in `PLAN-ingestion.md`)  **▶ first source decided**
Generalize ingestion beyond RSS: pluggable adapters (**api**/scrape/email/manual), a
separate `events` store + "What's On" surface, AI-as-parser (for scrape only).
**First event source: Archer Music Hall (Allentown) via a new `api` adapter on the
Ticketmaster Discovery API** — decided 2026-06-04 after testing showed every HTML
source (official site, Bandsintown, JamBase, Concertfix, SeatGeek) 403s a server
fetch. Build order: add `type`/`config`/`content_kind` to `feed_sources` + the
`events` table + router → the `api` adapter → Archer row (needs a free
`TICKETMASTER_API_KEY` in `/etc/birdstation.env`) → `GET /api/events` + a "What's On"
card. Then the `scrape` adapter (AI-as-parser) for no-API sources like the Emmaus
Theater calendar, and `pulse_add` paste-capture for one-offs / Bug Club.

### 4b. Pulse hallucination — full-text scraping follow-up
The 2026-06-04 grounding work (capture `content:encoded`, feed the digest real
excerpts, harden enrich/digest prompts) is the zero-risk baseline. **Next, if the
digest still invents:** per-source full-text fetch for the feeds that under-provide
— but **tested individually** (many publishers 403 a server fetch, same wall as the
venue sites), only adding a source once its fetch is proven reliable.

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

- **2026-06-05** — Observatory: **"Almost a lifer" shelf** on the Birds tab — turns the
  life-list rule into a progress game. Surfaces species heard at 85%+ in the **rolling last
  24h** but not yet listed and short of the 3-hit bar, as cards with a green **"N of 3"**
  progress bar + an "M more to go" line, closest-first, tap-through to the bird card. Pure
  front-end: computed client-side from `/api/detections/grouped` (a 24h window) minus
  `/api/lifetime` — no box change — and the section hides itself when nothing's close or the
  box is offline. `computeAlmostLifers()` is a tested pure fn. `?v=obs23`/`obs18`.

- **2026-06-05** — Observatory Analytics: **dawn-chorus shading** on the "When the birds
  sing" hour chart. The 24 columns are tinted by Emmaus' real day/night cycle (computed
  client-side via a trimmed SunCalc for the period's midpoint date, read in Eastern) — night
  a soft dark wash, the **dawn window picked out in gold**, daytime clear — with a 🌅/🌇
  sunrise/sunset line under the chart. Literally draws the caption's "dawn chorus and the
  quiet hours". Pure vanilla, no deps. `?v=obs21`/`obs16`. Also wrote `PLAN-train-analytics.md`
  (the `Birds | Trains` toggle design) and re-prioritized the Observatory ideas backlog (§3a/§3b).

- **2026-06-05** — Observatory: **life list moved to a popout** (modal reusing the bird-card
  shell — bottom sheet on mobile, centered on desktop; sticky header with sort + "100% only";
  scrollable body). Opened from the "Life list" stat card (fixes the old scroll that jumped
  past the heading); inline section removed → more compact Birds page. Layers below the bird
  card so a lifer's card opens on top. Also fixed analytics hover tooltips wrapping
  "188 detections" mid-phrase (non-breaking space via `nbCount()`). `?v=obs20`/`obs15`.

- **2026-06-05** — Observatory polish: a **"100% only" toggle on the life list** (mirrors
  the species grid; new unfloored `best_confidence` on `/api/lifetime`), and three Analytics
  fixes — the **"Activity over time / detections per day"** chart was blank (CSS: the
  `flex-end` parent collapsed the bar wrappers; gave them `height:100%`), the **"Who sings
  when"** heatmap labels were widened (132 → 168px) + given a full-name `title` so long
  names aren't cut off, and **instant hover tooltips** (`.obs-an-tip`, `data-tip`) replaced
  the slow native `title` on the hour bars, heatmap cells, and daily bars (each shows the
  block's detection count, respecting the active period filter). `?v=obs18`/`obs14`.

- **2026-06-05** — Pulse digest: **twice daily** (06:00 + 17:00 Eastern), moved Sonnet
  → **Haiku 4.5** (with adaptive thinking) for cost — grounding makes Sonnet
  unnecessary — and re-windowed to **"since the last brief"** (items `enriched_at` after
  the previous digest's `generated_at`, 24h-floored) so each brief is fresh, no re-tread.
  `feed_digests` PK → `(date, slot)` (morning/evening coexist; idempotent migration on
  next run). `/api/digest` returns the latest by `generated_at` + `slot`; card labels
  "📰 Morning / 🌆 Evening Brief". (Email delivery — item #6 below — still deferred.)

- **2026-06-05** — Pulse pipeline resilience: an API outage (the box ran out of
  Anthropic credits) revealed that `pulse-enrich` bumped `enrich_attempts` on *any*
  batch exception, so an outage permanently excluded the items it touched (capped at
  `>=3`). Now only a genuine per-item miss (a successful call that omits an item)
  burns the budget; API/account/network failures (`anthropic.APIError`) retry next
  run without bumping. Digest got the same clean-retry guard. Self-healing — no more
  manual counter resets after an API hiccup.

- **2026-06-04** — Pulse: brief **`Sources:` lines collapsed by default** (native
  `<details>`, matching the Citations toggle) + **hallucination grounding** — the
  fetcher now keeps the fullest article text (`content:encoded`, cap 500→2000), the
  digest synthesizes from real **excerpts** (not just one-line AI summaries), and the
  enrich/digest prompts forbid invented specifics ("be vague rather than wrong"). Also
  tested + decided the first **event** source: **Archer Music Hall via a Ticketmaster
  Discovery API `api` adapter** (every HTML source 403s a server fetch) — designed in
  `PLAN-ingestion.md`, build deferred to Phase 4.

- **2026-06-04** — Observatory **Analytics tab** (📊, bird distributions): a third tab with
  its own period selector rendering, all vanilla CSS, an **hour-of-day activity chart** ("When
  the birds sing"), a **species×hour heatmap** ("Who sings when" — each row self-normalized so
  the daily pattern reads), a **most-heard leaderboard**, and a **per-day activity chart**, plus
  summary cards (Detections / Species / Busiest hour / Peak day). All **Eastern**-bucketed by a
  new `GET /api/analytics` (server-side SQL→bounded-intermediate→Python Eastern fold, DST-correct).
  Heatmap/leaderboard rows click through to bird cards. Lazy-loads on first open.
  `?v=obs17`/`obs13`; 13 new box tests + a 27-check DOM render harness.

- **2026-06-03** — Bird-card UX + "100% only" filter: card photo is no longer a
  Wikipedia link (too easy to tap out by accident — the `↗ Wikipedia` text link stays),
  the close ✕ is a 40×40 tap target, and a green "100% only" toggle filters the species
  grid to birds whose best confidence reads as 100% (≥0.995); pair with **All** for the
  all-time list. `?v=obs16`/`obs12`.

- **2026-06-03** — Period-count consistency fix: "today" (45) / "yesterday" (62) /
  "this week" (2277) disagreed because Today used a UTC-calendar-day endpoint
  (`/api/today`) while other periods used Eastern-aligned grouped windows — and the
  grouped string comparison mis-sorted the ISO-`T` timestamps at the 04:00-UTC boundary.
  Now `/api/detections/grouped` compares via `datetime()` (correct Eastern days) and
  **all** periods, Today included, use that one endpoint. `?v=obs15`.

- **2026-06-03** — Life-list tally fix: `total_detections` was a denormalized `+1`
  counter that drifted low (lifetime total below a single day's count). Now derived
  **live** from `COUNT(*)` of the species' ≥0.85 detections — authoritatively in
  `/api/lifetime` (always truthful, agrees with the "All" period grid) and self-healed
  in the pipeline (recompute on each hit). `birdapi` restart fixes the display at once.

- **2026-06-03** — Observatory: recent hits on bird cards + three-tier confidence
  model. Bird cards now show the **last 10 detections** (confidence + time, newest
  first, reaching down to the 0.60 preserve floor so sub-85% diagnostic hits are
  visible) plus a life-list-progress line ("N of 3 qualifying hits in 24h" or "✓ On the
  life list"); `/api/species/{name}` gained `recent[]` / `hits_24h` / `on_life_list`.
  Floors decoupled: **preserve 0.60** (box keeps; `MIN_CONFIDENCE` 0.35 → 0.60),
  **display 0.85** (page grid/stats; was 0.75), **life list 0.85 + count**. New
  `purge_low_confidence.py` clears the old < 0.60 noise (manual, backs up first).
  Life-list clips stay **local-only** (declined a public/web surface for backyard-mic
  privacy). `?v=obs14`/`obs11`.

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
