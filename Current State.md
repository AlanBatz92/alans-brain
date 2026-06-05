# Current State

> Present-day snapshot of Alan's Brain — pages, key files, the Pulse subsystem,
> conventions, and known caveats. Read this (and `Build History.md`) at the
> start of every session. Revise the relevant sections after landing a feature.
>
> **Status note:** this file was reconstructed 2026-05-30 and is authoritative
> for the Pulse subsystem and project conventions. Older page internals are
> summarized from `README.md` and the `*Implementation.md` docs; flesh them out
> as you touch them.

## What this is

A personal indie website — vanilla HTML/CSS/JS, **no frameworks, no build step,
no package manager**. Static pages are JSON-driven and rendered client-side with
`fetch()`. A few features lean on external services (Vercel serverless proxies,
a Google Sheet, and a home server called **birdstation**).

## Pages

| Page | File | Notes |
|---|---|---|
| Home | `index.html` | Landing page with Explore cards |
| Pulse | `pulse.html` / `pulse.js` | Live Lehigh Valley news feed (see Pulse section) |
| YouTube Channels | `youtube.html` | 114 curated channels, JSON-driven |
| Great & Free | `tools.html` | Tools + websites, searchable categories |
| Soundboards | `soundboards.html` / `soundboards.js` | Categorized audio clips, rotating icons |
| Art Gallery | `art.html` / `gallery.js` | Slideshow + lightbox |
| Photo Gallery | `photos.html` | Masonry grid |
| Paranormal | `paranormal.html` | Curated media grid |
| Pride & Identity | `transart.html` | Tabbed: art, polyamory, resources |
| Personal Projects | `projects.html` | Hub for the Spotify/setlist tool |
| Setlist to Spotify | `setlist-spotify.html` / `setlist-spotify.js` | Setlists → Spotify playlist |
| My Week | `weather.html` / `weather.js` | Weather outlook + running/drone scoring |
| Household Task Tracker | `tasks.html` / `tasks.js` | Passphrase-gated, reads/writes a Google Sheet |
| Observatory | `observatory.html` / `observatory.js` | BirdNET + train detections from birdstation. Three tabs: 🐦 Birds / 📊 Analytics / 🚂 Trains. Linked from the home Explore grid + nav dropdown. |
| Tech Stack | `techstack.html` | Interactive SVG node-graph of the full site/hardware stack. Self-contained (inline CSS + JS). Public, no gate. See Tech Stack section below. |

Shared front-end: `style.css` (theme variables + all component styles),
`theme-switcher.js`, `auth.js`, `visit-ticker.js`.

## Conventions (authoritative)

- **Vanilla only.** No frameworks, no build step, no package manager. Don't introduce any.
- **`setlist-spotify.js` is ES5-style** (`function`, `var` — not `let`/`const`/arrow). Match it when editing that file. The rest of the JS is modern.
- **Theme variables** (`--bg`, `--surface`, `--text`, `--green`, `--teal`, `--border`, `--text-muted`, `--text-dim`, etc.) live near the top of `style.css`. Use them; don't hardcode colors.
- **`api/`** holds Vercel serverless proxies (`setlist.js`, `spotify-proxy.js`) for setlist.fm and Spotify writes (CORS workaround). Spotify auth is PKCE — no client secret in the browser.
- **Pages are JSON-driven** (`data/*.json`); adding content usually means editing a JSON file + dropping in media. See `README.md` "Adding Content".
- **Admin tooling:** `admin.py` (CLI) and `admin-gui.py` (tkinter) manage soundboard clips/icons/media.
- GoatCounter for analytics; `<audio>` elements for iOS silent-switch compatibility.
- **Nav layout:** Home · My Week · Tasks · Explore ▼ · Stack — across all 15 pages. "Stack" is a direct `<a>` in `.nav-links` (not inside the dropdown). The mobile overlay places it before the Explore section label.

## Pulse subsystem (most active area)

Pulse is a thin reader over **birdstation**, a home server reachable at
`https://birds.alansbrain.com`. birdstation does all fetching, dedup, storage,
AI enrichment, and the daily digest; the website just reads JSON and renders.

### Front-end (`pulse.html`, `pulse.js`, `.pulse-*` in `style.css`)

- ID/class prefix: **`pulse-`** (and `sl-` is the *setlist* tool's prefix — don't confuse them).
- `pulse.js` reads two endpoints, independently (one failing never breaks the other):
  - `GET /api/feed?limit=200` → `{items, sources}`. Renders headlines with AI category + one-sentence summary, a per-source health strip (doubles as a filter), and client-side filter/search (instant, no refetch).
  - `GET /api/digest` → the daily "Morning Brief" card atop the feed.
- `escapeHtml()` is the shared sanitizer; all rendered strings go through it.
- Category filter order mirrors birdstation's taxonomy via the `TAXONOMY` const in `pulse.js`.
- **To add/remove a news source you do NOT touch the front-end** — it's a row in birdstation's `feed_sources` table.

### Observatory front-end (`observatory.html`, `observatory.js`, `.obs-*` in `style.css`)

A second thin reader over birdstation (like Pulse), giving the BirdNET +
train data a home. ID/class prefix: **`obs-`**.

- **One combined page, three tabs** (🐦 Birds / 📊 Analytics / 🚂 Trains); linked from the
  home Explore card grid + the site-wide Explore dropdown / mobile overlay;
  **load-once + manual ↻ refresh** (no auto-polling). The Analytics tab **lazy-loads on
  first open** (heavier box aggregation) and joins the refresh only once opened.
- Reads, all GET on `https://birds.alansbrain.com`: Birds → `/api/detections/grouped`
  (every period, incl. Today — `&min_confidence=0.85`), `/api/lifetime`,
  `/api/species/{name}` (bird card); Trains → `/api/trains/stats`, `/api/trains/recent?approved=1`
  (+ inline `<audio>` clips at `/api/trains/clip/{file}`, basename of `clip_path`).
- **Train privacy (2026-06-01) — default-deny.** Clips can capture conversation
  near the mic, so the public page shows **only human-confirmed** events
  (`verdict='train'`): the page requests `?approved=1` *and* re-filters client-side,
  the clip endpoint 403s anything not tied to an approved train, and stats show
  approved counts. Vetting is via `review_trains.py` on the box; clips auto-purge
  weekly. Full design in `PLAN-train-vetting.md`.
- **Confidence gate — three tiers (2026-06-03):** decoupled floors.
  (1) **Preserve 0.60** — the pipeline keeps detections ≥ 0.60 (was 0.35), cutting the
  worst noise but retaining sub-85% *diagnostic* hits. (2) **Display 0.85** — the page
  grid/stats show only ≥ 0.85 (was 0.75), for clean locale analytics; enforced
  server-side (`min_confidence` param on `/api/today`, `/api/detections`, `/api/stats`,
  default 0.0; `/api/species` + `/api/detections/grouped` default 0.85) and client-side
  in `observatory.js`. (3) **Life list** — a count rule on top: **3 hits at ≥ 0.85
  within a rolling 24h**, or one **~100%** hit (box-side). The bird-card recent-hits
  list deliberately reaches down to the **preserve** floor so the lower hits explaining
  a non-lifer are visible. Old < 0.60 rows are cleared by `purge_low_confidence.py`
  (one-shot, on the box). Bird **stats are derived client-side from the filtered data**
  and follow the selected period (heard / species / life-list size / latest), not raw totals.
- **Birds "Heard today" is grouped by species:** one card per species with ×count,
  a colored confidence bar + pill (best-of-day), and last-heard time, newest-first.
- **Every section fetches independently** (`Promise.allSettled`), so one
  endpoint failing — or the box being offline — degrades only that section.
  Confidence color bands: high ≥ 0.85, mid ≥ 0.75.
- **Times render in Eastern** (`OBS_TZ = America/New_York`). The box runs UTC and
  writes *naive* ISO timestamps; `parseTime` appends `Z` to tz-less values so they
  aren't read in the viewer's local zone (train stamps carry an offset, untouched).
- **Both** assets are cache-busted on observatory.html — `observatory.js?v=obs17` +
  `style.css?v=obs13` + `bird-info.js?v=obs6`. Bump the query on *every* changed
  Observatory asset (a stale cached `.js` once made a whole iteration look unshipped).
- **Bird cards (steps 1–3 + polish, 2026-06-01):** tapping any species card opens a
  quick-view modal (bottom sheet on mobile, centered on desktop): Wikipedia photo
  (contain + max-height:200px so full bird is visible) + filtered description (generic
  "species of bird/owl" suppressed) + extract (word-boundary truncation) + comic-book
  stats grid (Heard Here / Best ID / First Heard / Last Heard with date+time).
  `bird-info.js` handles fetch + 30-day localStorage cache + `data/bird-overrides.json`
  hook. `GET /api/species/{name}` serves history. Degrades gracefully if either source
  is offline. CC BY-SA attribution shown. Classes: `.obs-bcard-*`.
- **Recent hits on the bird card (2026-06-03):** below the stats grid, each card lists
  the **last 10 detections** (newest first) with a confidence pill + date·time, plus a
  one-line life-list status — either "✓ On the life list" or "Not yet a lifer — N of 3
  qualifying hits (≥85%) in the last 24h". The list reaches down to the **0.60 preserve
  floor** (separate query in `/api/species`), so sub-85% diagnostic hits are visible
  (colour-graded mid/low) — making the life-list math legible at a glance (why a
  heard-but-unlisted species hasn't qualified). The card's summary stats (Heard Here /
  Best ID) stay at the 0.85 display floor. `/api/species/{name}` returns `recent[]`
  (last 10 `{timestamp, confidence}` ≥ 0.60), `hits_24h` (≥ 0.85 in 24h),
  `life_list_min_hits`, and `on_life_list`. Classes: `.obs-bcard-hits*`, `.obs-bcard-status*`.
  Next: step 4 detail view (sparkline + by-hour histogram).
- **Timeline + search (2026-06-01; period-aware stats 2026-06-02):** period selector
  (Today / Yesterday / This week / This month / This year / All) above the species grid;
  search input filters by name client-side. `GET /api/detections/grouped?start=&end=&min_confidence=`
  on birdstation returns pre-aggregated `{common_name, scientific_name, count,
  best_confidence, first_heard, last_heard}` for the date range. **All periods —
  including Today — use this one endpoint** (2026-06-03 fix), so the counts are
  mutually consistent; the query wraps the stored timestamp in `datetime()` so the
  Eastern-midnight-UTC day boundaries compare correctly against the ISO-`T`/microsecond
  timestamps the pipeline writes. (Previously Today used `/api/today`, a UTC-calendar-day
  endpoint, which disagreed with the Eastern windows after UTC midnight — "45 today vs
  2277 this week".) The headline **stat cards follow the selected period** — "Heard/Species
  <period>" totals and the period's "Latest" recompute from `state.periodGroups`
  (`sum(count)` / `length`); only the **Life list** card stays all-time.
- **Sort controls (2026-06-01):** `<select>` dropdowns on the period species grid and
  life list — Recent / Most heard / Least heard. Client-side, no refetch.
  `state.periodSort` + `state.lifeSort`. `renderLife()` is now its own function.
- **Subtitles (2026-06-01):** Birds tab hero tagline = "What is the source of all
  that chirping?!"; Trains tab dynamically sets it to "I like trains." via `TAGLINES`.
- **Stat cards (2026-06-01):** "Life list" smooth-scrolls to the life list; "Latest"
  opens the bird card modal. Both use `data-action` delegation; keyboard-accessible.
- **Bird card UX (2026-06-01; refined 2026-06-03):** Wikipedia link is the `↗ Wikipedia`
  text link below the sci name (the **photo is no longer a link** — it was too easy to
  tap out by accident); extract expanded to 3 sentences (≤ 500 chars); the close ✕ is a
  40×40 tap target (was 28×28).
- **"100% only" filter (2026-06-03):** a green toggle pill in the species-grid heading
  (`#obs-perfect`, `state.onlyPerfect`) filters the grid to species whose best confidence
  in the selected period reads as 100% (≥ `PERFECT_CONFIDENCE` 0.995 — the same bar that
  instant-adds a lifer). Client-side, persists across period switches; pair with the
  **All** period for the all-time list of birds heard at 100%.
- **Analytics tab (📊, 2026-06-04):** a third tab (between Birds and Trains) for detection
  *distributions* over its own period selector (defaults to **This week**). Renders, all
  vanilla CSS (no chart lib): summary stat cards (Detections / Species / **Busiest hour** /
  **Peak day**), a **24-hour activity chart** ("When the birds sing" — busiest hour
  highlighted), a **species×hour heatmap** ("Who sings when" — each row self-normalized to
  its own peak so the *pattern* shows; ×total badge for volume; scrolls horizontally on
  mobile), a **most-heard leaderboard** (top 15, proportional bars), and a **per-day
  activity chart** (hidden for single-day periods). All times **Eastern**. Heatmap +
  leaderboard rows are clickable → bird card (reuse the `[data-name]` delegation). Powered
  by `GET /api/analytics` (one call); `state.an`, `obs-an-*` classes, `loadAnalytics()`,
  `TAGLINES.analytics`. **Lazy-loads on first tab open.**
- Assets: `style.css?v=obs13`, `observatory.js?v=obs17`, `bird-info.js?v=obs6`.

### birdstation + birdnode (home server — code mirrored in this repo under `birdstation/`)

**Hardware topology:** **birdnode** is a Raspberry Pi Zero 2 W sitting near the
AudioMoth. It receives USB audio from the AudioMoth, runs **Icecast**, and
broadcasts a continuous HTTP stream on the local network (`/backyard` mount).
**birdstation** is the main home server; it connects to birdnode's Icecast stream
for all processing (BirdNET, train detector). The stream never leaves the local
network.

birdstation is primarily an **Emmaus Bird Observatory** (BirdNET acoustic
detections + a train-noise detector; a solar telemetry node is wired but
disabled). Pulse is a tenant on the same box — it shares `~/birdnet.db` and the
same FastAPI app. As of 2026-05-30 the box's code lives in this repo under
`birdstation/` and deploys via `git pull` (see `birdstation/README.md`).

- **API service:** `bird_api.py` — **FastAPI via uvicorn on `:8080`**, fronted at
  `https://birds.alansbrain.com`. CORS allows `alansbrain.com` / `www.alansbrain.com`.
  Pulse uses `/api/feed` and `/api/digest`; the rest serve bird/train data
  (`/api/detections`, `/api/today`, `/api/lifetime`, `/api/stats`,
  `/api/detections/grouped`, `/api/species/{name}`, `/api/analytics`, `/api/trains/*`).
  `/api/analytics` returns Eastern-bucketed distributions (hour-of-day, species×hour,
  per-day volume + diversity, leaderboard) for the Analytics tab — aggregated server-side
  (SQL groups to a bounded UTC-hour intermediate; Python folds it into Eastern buckets,
  DST-correct via `zoneinfo` with a self-contained US-Eastern fallback).
  Write routes (train verdicts) are guarded by `BIRD_API_KEY` via an `X-API-Key` header.
- **Storage:** SQLite at `~/birdnet.db` (full schema in `birdstation/schema.sql`).
  Bird/observatory tables: `detections`, `lifetime`, `train_events`, `solar_telemetry`.
  Pulse tables:
  - `feed_sources` — `key` (PK), `label`, `url`, `enabled`, `last_status`, `last_count`, `last_fetch`.
  - `feed_items` — **PK is `url`** (no integer id/link column; code uses `rowid AS id`). Columns: `title`, `source_key`, `source`, `published` (INTEGER), `fetched_at`, `summary`, `category`, `ai_summary`, `enriched_at`, `enrich_attempts`.
  - `feed_digests` — `date` (PK), `generated_at`, `headline`, `sections_json`, `model`, `item_count`. (`citations_json` lands with the citations backend.)
- **Jobs (systemd timers):**
  - `pulse_fetcher.py` — `pulse-fetch.timer`, every 15 min: pulls every enabled source (feedparser), dedupes by `url`, stores, and **purges items older than 30 days** (`RETENTION_DAYS`). **Captures the fullest article text (2026-06-04):** `extract_body()` prefers `content:encoded` (feedparser `e.content[*].value`) over the teaser; cap raised 500 → 2000 (`BODY_CAP`). This richer body lands in `summary` and grounds the AI steps (reduces hallucination). Forward-looking only — existing rows are deduped by `url`, so the fuller body fills in on new items.
  - `pulse_enrich.py` — `pulse-enrich.timer` (every 20 min): batched (20/run) AI tagging + one-sentence summaries via **`claude-haiku-4-5`**, prompt-cached system prompt. Prompt has a **GROUNDING rule (2026-06-04):** summarize only from the provided headline/blurb; don't invent specifics. **Retry budget (`enrich_attempts`, cap 3) is only burned on a genuine per-item miss (2026-06-05):** a *successful* call that omits an item. Batch-level API/account/network failures (`anthropic.APIError` — billing, auth, rate-limit, 5xx, timeouts) roll back **without** bumping and retry next run, so an outage (e.g. an empty credit balance) can't permanently exclude the items it touched. (Previously any exception bumped the whole batch, so a billing outage silently capped items at `>=3` and they never re-enriched — fixed; one-time cleanup was `UPDATE feed_items SET enrich_attempts=0 WHERE enriched_at IS NULL`.)
  - `pulse_digest.py` — `pulse-digest.timer`, daily ~6 AM: reads the last 24h of enriched items, writes a sectioned "Morning Brief" via **`claude-sonnet-4-6`** + adaptive thinking, structured output through `messages.parse()`. Skips days with <3 items. **Grounding (2026-06-04):** the per-item payload now carries an **`excerpt`** (the richer `summary` body, capped 500/item) alongside the one-sentence `ai_summary`, and the system prompt forbids invented figures/dates/names/quotes/causes/outcomes ("be vague rather than wrong") — the synthesis was previously built from one-liners alone, the main hallucination driver.
- **Observatory writers (long-running services, in `birdstation/`):**
  - `birdnet_pipeline.py` — `birdnet.service`: captures 15 s chunks off the Icecast `/backyard` stream (`localhost:8000`), runs BirdNET-Analyzer (its own `~/BirdNET-Analyzer/birdnet-env` venv), writes `detections` (confidence ≥ `MIN_CONFIDENCE` **0.60** — the *preserve* floor, raised from 0.35 on 2026-06-03 to cut noise while keeping sub-85% diagnostic hits; also passed to BirdNET as `--min_conf`. The public page filters separately at the 0.85 display floor). **Life-list gate (2026-06-02):** a *new* species joins `lifetime` after **`LIFE_LIST_MIN_HITS` = 3** detections at ≥ `LIFE_LIST_MIN_CONFIDENCE` **0.85** within a **rolling 24h window** (`datetime(timestamp) >= datetime('now','-24 hours')`), **or a single ≥ `LIFE_LIST_INSTANT_CONFIDENCE` 0.995 (~100%) hit** (instant-add, bypasses the multi-hit rule). **Life-list tally (fixed 2026-06-03):** `total_detections` is **recomputed live from `COUNT(*)` of the species' ≥ 0.85 detections** — both in the pipeline (on each new hit, self-healing the stored column) and, authoritatively, in `/api/lifetime` (derived at read time, so the displayed total is always truthful and consistent with the page's other ≥0.85 views). This replaced a `+1` counter that drifted low (showed a lifetime total below a single day's count). BirdNET runs with lat/lon **and** `--week` (BirdNET's 1-48 week, `USE_WEEK_FILTER`), so both location and season filter the species list. **Verifiable lifers (2026-06-02):** each life-list-qualifying hit (≥ 0.85) also archives one WAV to `~/bird_clips` (capped one per species/day; `clip_path` + `verified` columns on `detections`), labelled via `review_birds.py` (`--stats` = measured precision by confidence band) and aged out by `purge-bird-clips.timer` — **local-only, never served** (backyard-mic privacy). (CSV reader fixed 2026-05-30 to `delimiter=","`.) Wipe bird tables for a clean start with `birdstation/reset_birds.sh` (backs up first; leaves Pulse + trains intact).
  - `train_detector.py` — `train_detector.service` (own `~/train-env` venv, needs numpy): reads `localhost:8000/backyard`, pipes it through **ffmpeg → mono s16le PCM** (must decode the MP3 — reading raw stream bytes as PCM was the long-standing reason `train_events` stayed empty; fixed 2026-06-01), detects sustained energy in the 300–1500 Hz band, writes `train_events` + a WAV clip in `~/train_clips`. Every event starts un-reviewed/hidden (see Train privacy above). **NB:** a duplicate `traindetect.service` existed for the same script — `train_detector.service` is canonical; the dup is removed.
  - `review_trains.py` — **manual** CLI on the box to vet pending train events (play clip → train/false/unsure → DB). Near-term vetting workflow; web UI is future (`PLAN-train-vetting.md`).
  - `purge_train_clips.py` — `purge-train-clips.timer` (**Sun 04:00**): deletes rejected + aged-orphan clips, keeps approved-train + still-pending. `--dry-run` supported.
  - `review_birds.py` — **manual** CLI on the box to confirm life-list detections from their archived clips (correct/wrong/unsure → `detections.verified`); `--stats` prints measured precision by confidence band (calibration data).
  - `purge_bird_clips.py` — `purge-bird-clips.timer` (**daily 04:30**): deletes unreviewed bird clips older than 30 days + aged orphans, keeps labelled (reviewed) clips + recent unreviewed. `--dry-run` supported.
  - `purge_low_confidence.py` — **manual one-shot** (not timed): deletes `detections` with confidence below the preserve floor (default 0.60) — cleanup of the old ≥ 0.35 noise after the floor was raised. Backs the DB up first; `--dry-run` / `--floor` / `--no-backup`. Leaves `lifetime`, Pulse, and train tables untouched. New data stays clean on its own (the pipeline won't write below the floor).
- **Secrets:** `ANTHROPIC_API_KEY` and `BIRD_API_KEY` live only on the box, moving to `/etc/birdstation.env` (chmod 600) referenced by `EnvironmentFile=`. Never committed; `.gitignore` blocks `*.env`/`*.db`. (The observatory services need no keys.)

### Digest + citations (current behavior)

- The Morning Brief renders as a card above the feed: one-line headline, 3–6 themed sections (each a 2–4 sentence synthesis), a per-section **`Sources:` block** of numbered clickable links — **collapsed by default (2026-06-04)** behind a `<details>`/`<summary>` ("Sources (N)"), matching the Citations toggle — and a numbered **Citations** list at the foot (also collapsed). Front-end: `renderSectionSources()` in `pulse.js`; `.pulse-sources-toggle` / `.pulse-sources-list` in `style.css`.
- Citation flow: each item is fed to Claude with its `feed_items.id`; Claude returns `citation_ids` per section; `pulse_digest.py` resolves those ids → globally-numbered `{n, title, url, source}` (Claude never emits URLs → no hallucinated links). The API returns per-section `citations` plus a top-level `citations` list; the front-end renders both and **degrades silently** when they're absent.

## Other version-controlled docs

- `PLAN-pulse.md` — original Pulse design + phases.
- `PLAN-ingestion.md` — **Phase 4 plan** (next up): generalize ingestion beyond RSS (pluggable adapters for **api**/scrape/email/manual, AI-as-parser for scrape, a separate `events` store + "What's On" surface, a paste-to-capture tool). Decisions settled: separate events store; paste-first email; **first event source is Archer Music Hall via an `api` adapter (Ticketmaster Discovery API)** — every HTML source (official site + Bandsintown/JamBase/Concertfix/SeatGeek) 403s a server fetch (tested 2026-06-04), so prefer APIs and verify fetchability before assuming a page is scrapable. Needs a free `TICKETMASTER_API_KEY` in `/etc/birdstation.env`.
- `PLAN-spotify-setlist-tools.md`, `Spotify Setlist Tools Implementation.md`, `Task Tracker Write-Back Implementation.md` — design/implementation records for those features.

## Tech Stack page (`techstack.html`)

Self-contained single-file page (inline `<style>` + `<script>`). No external JS dependencies.

### Architecture documented (11 nodes, 12 edges)
Hardware chain: **AudioMoth** (USB mic) → **birdnode** (Raspberry Pi Zero 2 W running Icecast) → **birdstation** (home server: FastAPI + BirdNET + train detector) → **Cloudflare** (DNS + reverse proxy + SSL) → **alansbrain.com** (Visitor). Parallel paths: **Alan** (admin via SSH + git) → birdstation, **GitHub** (code hosting) → birdstation (git pull deploys) + **Vercel** (static hosting + serverless proxies), **Porkbun** (domain registrar, NS delegated to Cloudflare), **Anthropic** (Claude API called by birdstation's AI services).

### Node graph implementation
- `NODES` array: each entry has `id`, `label`, `d:[x%,y%]` (desktop pos), `m:[x%,y%]` (mobile pos), `color` (CSS class), `hex`, `type`, `what`, `role` (HTML with `T()` markup), optional `icon` (img path) or `emoji`, optional `privacy`.
- Canvas aspect-ratio: `5/4` desktop, `7/10` mobile. `positionGraph()` recomputes pixel coords on every resize.
- `buildGraph()` creates SVG defs/markers + node divs; `selectNode(id)` highlights active edges (stroke-opacity 0.9) and dims inactive (0.06); `clearSelection()` restores defaults.
- Extra-bow heuristic on long diagonals: alan→birdstation, github→birdstation, birdnode→birdstation (+18px).
- NODE_R = 28px desktop, 23px mobile (arrowhead offset).

### Glossary / clickable-term system (2026-06-02)
- **`GLOSSARY`** object: 32 entries mapping `key → {title, def}` (DNS, reverse-proxy, SSL termination, Icecast, BirdNET, systemd, FastAPI, SQLite, PKCE, CDN, anycast, nameserver, A record, CNAME, HTTPS, SSH, git, REST, JSON, API, WAV, PCM, MP3, FFT, uvicorn, CORS, webhook, serverless, venv, cron, passphrase, USB).
- **`T(key, display)`** helper wraps terms in `<span class="ts-term" data-key="...">` inside node role strings; event delegation on `.ts-panel` opens the popover.
- **`.ts-gloss`** fixed-position card; `showGloss(key, triggerEl)` uses `getBoundingClientRect()` for placement (flips below trigger if < 60px from top).

### Icons
Custom icons from `img/Icons/icons/`: AudioMoth → `Audio_Related/audio-waves.png`, birdnode → `Audio_Related/sound-wave.png`, Cloudflare → `Explore/cloud.png`, Porkbun → `Other/domain.png`, website → `Other/planet.png`. Alan, birdstation, GitHub, Vercel, Anthropic, Visitor use emoji fallbacks.

### Privacy posture
No IPs, ports, credentials, or internal network topology exposed. Node descriptions reference only public-facing URLs or generic architectural patterns.

## Known caveats

- **RSS URL rot** is the #1 source-health risk; broken feeds surface as a per-source error in the strip rather than breaking the page.
- birdstation is a home box — if it's offline, Pulse shows an offline state and the digest card simply hides.
- The two old local planning docs (`Task Tracker Write-Back Feature Plan.md`, `New Pages Plan.md`) remain gitignored.
- **birdstation runs from the clone** (cutover complete 2026-05-31): the box has the repo at `~/alans-brain`, units point at `~/alans-brain/birdstation/*.py`, secrets are in `/etc/birdstation.env`. Deploy = `cd ~/alans-brain && git pull && sudo systemctl restart <unit>`. See `birdstation/README.md`.
- **Citations are live** — the `feed_digests.citations_json` column exists, `pulse_digest.py` writes per-section + global citations, `/api/digest` serves them, and the front-end renders the `Sources:` lines + Citations list. (`pulse_digest.py` uses `max_tokens=16000` — 4000 truncated the thinking+citations output.)
- **`BIRD_API_KEY` was rotated** at cutover (the old one leaked in chat 2026-05-30); the new value lives only in `/etc/birdstation.env`.
- Old `~/*.py` copies are retired to `~/retired/`; the canonical copies are in `birdstation/`.
