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
  - `birdnet_pipeline.py` — `birdnet.service`: captures 15 s chunks off the Icecast `/backyard` stream, runs BirdNET-Analyzer (its own `~/BirdNET-Analyzer/birdnet-env` venv), writes `detections` + `lifetime`. (CSV reader fixed 2026-05-30 to `delimiter=","` — see Build History.)
  - `train_detector.py` — `train_detector.service`: FFT-based train-whistle detector on the same stream (its own `~/train-env` venv, needs numpy), writes `train_events` + saves WAV clips to `~/train_clips`. **NB:** the box also had a duplicate `traindetect.service` for the same script — `train_detector.service` is canonical; the dup is removed at cutover.
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
- **birdstation code lives in `birdstation/`** (scripts + `schema.sql` + templated `systemd/` units) and uses the **run-from-clone** model: the box clones the repo to `~/alans-brain` and units point at `~/alans-brain/birdstation/*.py`; deploy = `git pull` + restart. See `birdstation/README.md` for the one-time cutover.
- **Citations backend** is in the repo (`pulse_digest.py` + `/api/digest` + `schema.sql` migration) but **lands on the box at cutover** — needs `ALTER TABLE feed_digests ADD COLUMN citations_json TEXT` and a digest regenerate before the front-end citations render with data.
- **`BIRD_API_KEY` leaked into chat 2026-05-30** during the import — rotate it as part of the cutover (new value goes in `/etc/birdstation.env`).
