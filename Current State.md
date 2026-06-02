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
| Observatory | `observatory.html` / `observatory.js` | BirdNET + train detections from birdstation. Linked from the home Explore grid + nav dropdown. |

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

- **One combined page, two tabs** (🐦 Birds / 🚂 Trains); linked from the home
  Explore card grid + the site-wide Explore dropdown / mobile overlay;
  **load-once + manual ↻ refresh** (no auto-polling).
- Reads, all GET on `https://birds.alansbrain.com`: Birds → `/api/today?min_confidence=0.75`,
  `/api/lifetime`; Trains → `/api/trains/stats`, `/api/trains/recent?approved=1`
  (+ inline `<audio>` clips at `/api/trains/clip/{file}`, basename of `clip_path`).
- **Train privacy (2026-06-01) — default-deny.** Clips can capture conversation
  near the mic, so the public page shows **only human-confirmed** events
  (`verdict='train'`): the page requests `?approved=1` *and* re-filters client-side,
  the clip endpoint 403s anything not tied to an approved train, and stats show
  approved counts. Vetting is via `review_trains.py` on the box; clips auto-purge
  weekly. Full design in `PLAN-train-vetting.md`.
- **Confidence gate (0.75):** the pipeline logs everything ≥ 0.35, so the page
  filters to ≥ 0.75 — the floor the box uses to credit a life-list hit. Enforced
  both server-side (optional `min_confidence` param on `/api/today`,
  `/api/detections`, `/api/stats`, default 0.0) and client-side in `observatory.js`
  (so it's correct even before a box redeploy). The page visualizes every confident
  bird; the **life list itself** requires **3 such hits in one day** (box-side, see
  birdstation section). Bird **stats are derived client-side from the filtered
  data** (heard today / species today / life-list size / latest), not raw totals.
- **Birds "Heard today" is grouped by species:** one card per species with ×count,
  a colored confidence bar + pill (best-of-day), and last-heard time, newest-first.
- **Every section fetches independently** (`Promise.allSettled`), so one
  endpoint failing — or the box being offline — degrades only that section.
  Confidence color bands: high ≥ 0.85, mid ≥ 0.75.
- **Times render in Eastern** (`OBS_TZ = America/New_York`). The box runs UTC and
  writes *naive* ISO timestamps; `parseTime` appends `Z` to tz-less values so they
  aren't read in the viewer's local zone (train stamps carry an offset, untouched).
- **Both** assets are cache-busted on observatory.html — `observatory.js?v=obs10` +
  `style.css?v=obs10` + `bird-info.js?v=obs6`. Bump the query on *every* changed
  Observatory asset (a stale cached `.js` once made a whole iteration look unshipped).
- **Bird cards (steps 1–3 + polish, 2026-06-01):** tapping any species card opens a
  quick-view modal (bottom sheet on mobile, centered on desktop): Wikipedia photo
  (contain + max-height:200px so full bird is visible) + filtered description (generic
  "species of bird/owl" suppressed) + extract (word-boundary truncation) + comic-book
  stats grid (Heard Here / Best ID / First Heard / Last Heard with date+time).
  `bird-info.js` handles fetch + 30-day localStorage cache + `data/bird-overrides.json`
  hook. `GET /api/species/{name}` serves history. Degrades gracefully if either source
  is offline. CC BY-SA attribution shown. Classes: `.obs-bcard-*`.
  Next: step 4 detail view (sparkline + by-hour histogram).
- **Timeline + search (2026-06-01):** period selector (Today / Yesterday / This week /
  This month) above the species grid; search input filters by name client-side.
  `GET /api/detections/grouped?start=&end=&min_confidence=` on birdstation returns
  pre-aggregated `{common_name, scientific_name, count, best_confidence, first_heard,
  last_heard}` for the date range. Switching periods fetches the new endpoint;
  "Today" re-renders from already-loaded data (no extra fetch). Stat cards always
  show today's numbers regardless of selected period.
- **Sort controls (2026-06-01):** `<select>` dropdowns on the period species grid and
  life list — Recent / Most heard / Least heard. Client-side, no refetch.
  `state.periodSort` + `state.lifeSort`. `renderLife()` is now its own function.
- **Subtitles (2026-06-01):** Birds tab hero tagline = "What is the source of all
  that chirping?!"; Trains tab dynamically sets it to "I like trains." via `TAGLINES`.
- **Stat cards (2026-06-01):** "Life list" smooth-scrolls to the life list; "Latest"
  opens the bird card modal. Both use `data-action` delegation; keyboard-accessible.
- **Bird card UX (2026-06-01):** Wikipedia link moved below the sci name (easy to tap on
  mobile); photo wrapped as Wikipedia link; extract expanded to 3 sentences (≤ 500 chars).
- Assets: `style.css?v=obs10`, `observatory.js?v=obs10`, `bird-info.js?v=obs6`.

### birdstation (home server — code mirrored in this repo under `birdstation/`)

birdstation is primarily an **Emmaus Bird Observatory** (BirdNET acoustic
detections + a train-noise detector; a solar telemetry node is wired but
disabled). Pulse is a tenant on the same box — it shares `~/birdnet.db` and the
same FastAPI app. As of 2026-05-30 the box's code lives in this repo under
`birdstation/` and deploys via `git pull` (see `birdstation/README.md`).

- **API service:** `bird_api.py` — **FastAPI via uvicorn on `:8080`**, fronted at
  `https://birds.alansbrain.com`. CORS allows `alansbrain.com` / `www.alansbrain.com`.
  Pulse uses `/api/feed` and `/api/digest`; the rest serve bird/train data
  (`/api/detections`, `/api/today`, `/api/lifetime`, `/api/stats`, `/api/trains/*`).
  Write routes (train verdicts) are guarded by `BIRD_API_KEY` via an `X-API-Key` header.
- **Storage:** SQLite at `~/birdnet.db` (full schema in `birdstation/schema.sql`).
  Bird/observatory tables: `detections`, `lifetime`, `train_events`, `solar_telemetry`.
  Pulse tables:
  - `feed_sources` — `key` (PK), `label`, `url`, `enabled`, `last_status`, `last_count`, `last_fetch`.
  - `feed_items` — **PK is `url`** (no integer id/link column; code uses `rowid AS id`). Columns: `title`, `source_key`, `source`, `published` (INTEGER), `fetched_at`, `summary`, `category`, `ai_summary`, `enriched_at`, `enrich_attempts`.
  - `feed_digests` — `date` (PK), `generated_at`, `headline`, `sections_json`, `model`, `item_count`. (`citations_json` lands with the citations backend.)
- **Jobs (systemd timers):**
  - `pulse_fetcher.py` — `pulse-fetch.timer`, every 15 min: pulls every enabled source (feedparser), dedupes by `url`, stores, and **purges items older than 30 days** (`RETENTION_DAYS`).
  - `pulse_enrich.py` — `pulse-enrich.timer` (every 20 min): batched (20/run) AI tagging + one-sentence summaries via **`claude-haiku-4-5`**, prompt-cached system prompt, retried up to `enrich_attempts` 3.
  - `pulse_digest.py` — `pulse-digest.timer`, daily ~6 AM: reads the last 24h of enriched items, writes a sectioned "Morning Brief" via **`claude-sonnet-4-6`** + adaptive thinking, structured output through `messages.parse()`. Skips days with <3 items.
- **Observatory writers (long-running services, in `birdstation/`):**
  - `birdnet_pipeline.py` — `birdnet.service`: captures 15 s chunks off the Icecast `/backyard` stream (`localhost:8000`), runs BirdNET-Analyzer (its own `~/BirdNET-Analyzer/birdnet-env` venv), writes `detections` (confidence ≥ `MIN_CONFIDENCE` 0.35). **Life-list gate (2026-06-01):** a *new* species joins `lifetime` only after **`LIFE_LIST_MIN_HITS` = 3** detections in one local day at ≥ `LIFE_LIST_MIN_CONFIDENCE` **0.75**; existing lifers just increment `total_detections`. (CSV reader fixed 2026-05-30 to `delimiter=","`.) Wipe bird tables for a clean start with `birdstation/reset_birds.sh` (backs up first; leaves Pulse + trains intact).
  - `train_detector.py` — `train_detector.service` (own `~/train-env` venv, needs numpy): reads `localhost:8000/backyard`, pipes it through **ffmpeg → mono s16le PCM** (must decode the MP3 — reading raw stream bytes as PCM was the long-standing reason `train_events` stayed empty; fixed 2026-06-01), detects sustained energy in the 300–1500 Hz band, writes `train_events` + a WAV clip in `~/train_clips`. Every event starts un-reviewed/hidden (see Train privacy above). **NB:** a duplicate `traindetect.service` existed for the same script — `train_detector.service` is canonical; the dup is removed.
  - `review_trains.py` — **manual** CLI on the box to vet pending train events (play clip → train/false/unsure → DB). Near-term vetting workflow; web UI is future (`PLAN-train-vetting.md`).
  - `purge_train_clips.py` — `purge-train-clips.timer` (**Sun 04:00**): deletes rejected + aged-orphan clips, keeps approved-train + still-pending. `--dry-run` supported.
- **Secrets:** `ANTHROPIC_API_KEY` and `BIRD_API_KEY` live only on the box, moving to `/etc/birdstation.env` (chmod 600) referenced by `EnvironmentFile=`. Never committed; `.gitignore` blocks `*.env`/`*.db`. (The observatory services need no keys.)

### Digest + citations (current behavior)

- The Morning Brief renders as a card above the feed: one-line headline, 3–6 themed sections (each a 2–4 sentence synthesis), a per-section **`Sources:` line** of numbered clickable links, and a numbered **Citations** list at the foot.
- Citation flow: each item is fed to Claude with its `feed_items.id`; Claude returns `citation_ids` per section; `pulse_digest.py` resolves those ids → globally-numbered `{n, title, url, source}` (Claude never emits URLs → no hallucinated links). The API returns per-section `citations` plus a top-level `citations` list; the front-end renders both and **degrades silently** when they're absent.

## Other version-controlled docs

- `PLAN-pulse.md` — original Pulse design + phases.
- `PLAN-ingestion.md` — **Phase 4 plan** (next up): generalize ingestion beyond RSS (pluggable adapters for scrape/email/manual, AI-as-parser, a separate `events` store + "What's On" surface, a paste-to-capture tool). Decisions settled: separate events store; paste-first email.
- `PLAN-spotify-setlist-tools.md`, `Spotify Setlist Tools Implementation.md`, `Task Tracker Write-Back Implementation.md` — design/implementation records for those features.

## Known caveats

- **RSS URL rot** is the #1 source-health risk; broken feeds surface as a per-source error in the strip rather than breaking the page.
- birdstation is a home box — if it's offline, Pulse shows an offline state and the digest card simply hides.
- The two old local planning docs (`Task Tracker Write-Back Feature Plan.md`, `New Pages Plan.md`) remain gitignored.
- **birdstation runs from the clone** (cutover complete 2026-05-31): the box has the repo at `~/alans-brain`, units point at `~/alans-brain/birdstation/*.py`, secrets are in `/etc/birdstation.env`. Deploy = `cd ~/alans-brain && git pull && sudo systemctl restart <unit>`. See `birdstation/README.md`.
- **Citations are live** — the `feed_digests.citations_json` column exists, `pulse_digest.py` writes per-section + global citations, `/api/digest` serves them, and the front-end renders the `Sources:` lines + Citations list. (`pulse_digest.py` uses `max_tokens=16000` — 4000 truncated the thinking+citations output.)
- **`BIRD_API_KEY` was rotated** at cutover (the old one leaked in chat 2026-05-30); the new value lives only in `/etc/birdstation.env`.
- Old `~/*.py` copies are retired to `~/retired/`; the canonical copies are in `birdstation/`.
