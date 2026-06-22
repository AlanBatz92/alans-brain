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
| Personal Projects | `projects.html` | Hub for the home-built projects — cards link to Pulse, Observatory, and Setlist to Spotify |
| Setlist to Spotify | `setlist-spotify.html` / `setlist-spotify.js` | Setlists → Spotify playlist |
| Weather | `weather.html` / `weather.js` | **Public** (passphrase gate removed 2026-06-17; nav label is **"Weather"**, was "My Week"). Weather outlook + running/drone/tan scoring. **Hero "Today" card** (incl. 🌅/🌇 sun + 🌙 moon phase via `sunMoonHTML`) + **"Best rest of week"** chips (today→Sunday only, no next-week days) + roomy 6-day list; tap any day/chip → detail drawer = shared `Conditions` block + a **selectable "Hour by hour" chart** (pick Rain/UV/Temp/Wind/Cloud/Humidity → peak labeled; `WX_SERIES`/`renderHourlyMetric`) + per-activity rating · best window · tap-to-open breakdown. Rating colors: green/blue/amber/red (Good = blue). **All three scores research-grounded** (`computeRunScore`/`computeDroneScore`/`computeTanScore`): running = apparent temp + **dew point** (UV dropped); drone = **wind/gusts** dominant + rain/fog/cold caps; tanning = **UV**-led + clear sky + warmth. **ℹ️ "How these scores work"** explainer drawer (`openInfoDrawer`). Assets `?v=w6`. |
| Household Task Tracker | `tasks.html` / `tasks.js` | Passphrase-gated, reads/writes a Google Sheet. **Not linked in any nav (2026-06-22)** — direct URL + passphrase only. |
| Observatory | `observatory.html` / `observatory.js` | BirdNET + train detections from birdstation. Three tabs: 🐦 Birds / 📊 Analytics / 🚂 Trains. **Analytics is unified** — a `🐦 Birds \| 🚂 Trains` switch on the Analytics tab (2026-06-11), so train *analytics* live there (not on the Trains tab, which is now just the raw recent-events feed + method panel). Linked from the home Explore grid + nav dropdown. |
| Tech Stack | `techstack.html` | Interactive SVG node-graph of the full site/hardware stack. Self-contained (inline CSS + JS). Public, no gate. See Tech Stack section below. |

Shared front-end: `style.css` (theme variables + all component styles),
`theme-switcher.js`, `auth.js`, `visit-ticker.js`, `nav-menu.js` (mobile-menu
backdrop-tap + Escape close, loaded on every page).

### Themes (`theme-switcher.js`, `themes/*.css`)

A footer picker ("Choose Your Skin") swaps CSS custom properties via a
`data-theme` attribute on `<html>`; the choice persists in `localStorage`
(`ab_theme`) and each page's `<head>` has a tiny inline script that re-applies it
before paint (no flash). Skins: **Deep Space** (default; no CSS file), **Starfield**
(`themes/starfield.css`), **Quake II** (`themes/quake2.css`). Non-default skins are
palette/visual overrides scoped to `html[data-theme="…"]`.

- **Starfield (2026-06-19):** the deep-space palette plus an **animated canvas
  starfield** — a fixed full-viewport `<canvas id="starfield-canvas">` (`z-index:0`,
  behind `.page`, alongside the ambient blobs) with drifting, twinkling **parallax**
  stars + the occasional shooting star (per-star twinkle speed eased ~25% on
  2026-06-21 — `tws` `0.45 + rand·1.2` — for a calmer shimmer). Drawn by **`starfield.js`**, which
  `theme-switcher.js` **lazy-loads once** (`ensureStarfield()`) only when the skin is
  selected — zero overhead for everyone else. The script self-boots on load and
  starts/stops on the `themechange` event; it honors `prefers-reduced-motion` (static
  field), pauses on hidden tabs, and is DPR-aware + debounced on resize. The matching
  `themes/starfield.css` only deepens `--bg-deep`/`--bg`, adds a soft vignette, and
  softens the blobs into nebula glow (palette otherwise inherited from `:root`).
  - **Background-events scaffold (2026-06-22):** `starfield.js` now has a small,
    extensible **events** layer — `EVENT_TYPES` each expose `onFrame(now,dt)`
    (decide when to spawn → push an effect) + `reset()`; an effect is
    `{ step(dt)→aliveBool }` that updates+draws itself and retires on `false`. Two
    events ship: a **comet** (slow interstellar visitor — green-white coma + long
    tapering tail, pure canvas gradients, ~30s to cross) and **bird-detection-driven
    shooting stars** — it polls `birds.alansbrain.com/api/detections` (~90s, ≥0.85)
    and fires a streak per *new* detection (species logged to the console — an easter
    egg). Bird-driven streaks are **green-tinted + brighter** to read distinctly from
    the **rare cool-white fallback** streaks, which only fill in after a long quiet gap
    (`idleBeforeRandom` 5 min, low `randChance`) — i.e. ≈ overnight. **The comet is the
    "special event":** it's triggered by a **new
    lifer** (a second `/api/lifetime` poll, ~5 min, sees a species that wasn't there)
    or a **rare detection** (a life-listed species with ≤ `rareMax` (3) all-time hits is
    promoted from a streak to a comet), with a long **ambient fallback** (~6–16 min);
    `requestComet()` feeds it, one-at-a-time + `minSpacing` so events can't burst.
    Fails silent, honors reduced-motion (no events/polling), pauses on hidden tabs.
    Knobs in `window.STARFIELD_CONFIG`; **verification hooks in `window.__starfield`**
    (`status()` → is the box reached + state; `testStreak(name)` / `testComet(reason,name)`
    → force one on demand) for confirming the bird-driven events on the live site. Add a
    new event by writing a `make…Type()` and pushing it to `EVENT_TYPES`.

## Conventions (authoritative)

- **Vanilla only.** No frameworks, no build step, no package manager. Don't introduce any.
- **`setlist-spotify.js` is ES5-style** (`function`, `var` — not `let`/`const`/arrow). Match it when editing that file. The rest of the JS is modern.
- **Theme variables** (`--bg`, `--surface`, `--text`, `--green`, `--teal`, `--border`, `--text-muted`, `--text-dim`, etc.) live near the top of `style.css`. Use them; don't hardcode colors.
- **`api/`** holds Vercel serverless proxies (`setlist.js`, `spotify-proxy.js`, `weather.js`) for setlist.fm, Spotify writes (CORS workaround), and OpenWeatherMap. Spotify auth is PKCE — no client secret in the browser. **`api/weather.js`** keeps the OpenWeatherMap key server-side (reads `OPENWEATHER_API_KEY` env var — **set in Vercel, old client-exposed key rotated 2026-06-18**; endpoint whitelist for `onecall`/`day_summary`/`timemachine`); `weather.js` calls `/api/weather`, never OWM directly. *(NB: `api/setlist.js` still hardcodes its key server-side — lower risk since it's never sent to the browser, but a candidate to move to an env var too.)*
- **Pages are JSON-driven** (`data/*.json`); adding content usually means editing a JSON file + dropping in media. See `README.md` "Adding Content".
- **Admin tooling:** `admin.py` (CLI) and `admin-gui.py` (tkinter GUI) — a sidebar of **panels**
  over a CLI of **command groups**. Panels: **Soundboards**, **Media**, **Trains / Box** (pull
  clips from birdstation → calibrate the horn profile → deploy → sync vetting to the page; group
  `box`), **Git** (commit & push to publish, no terminal; group `git`). New surfaces subclass
  `CommandPanel` + register in `PANELS` — see **`ADMIN.md`** (architecture + "Adding a panel").
  Box/git settings live in `admin-config.json` (gitignored; copy `admin-config.example.json`).
  Command catalog (the "I always forget these") is **`COMMANDS.md`**.
- GoatCounter for analytics; `<audio>` elements for iOS silent-switch compatibility.
- **Nav layout:** **`Weather`** is a top-level `<a href="weather.html">` in `.nav-links` (and the mobile overlay) on **every page**, inserted right after Home (2026-06-17 — promoted from hidden once the page went public; label is "Weather", not "My Week"). The rest of the bar varies by page (some carry Pulse). **The "Tasks" link was removed from every nav bar (2026-06-22)** — the Household Task Tracker stays passphrase-gated and reachable by direct URL only, no longer advertised in any menu. **The Explore dropdown + mobile overlay use `img/Icons/icons/Projects/observatory.png` for Observatory and `Projects/philosophy.png` for Personal Projects (2026-06-22; were the 🔭/🚀 emoji — philosophy icon also on the `index.html` card + `projects.html` hero).** "Stack" is a direct `<a>` in `.nav-links` (not inside the dropdown). The mobile overlay places Stack before the Explore section label. **The mobile overlay (`.nav-mobile-overlay`) scrolls** (2026-06-19): it's top-aligned (`justify-content: flex-start`) with `overflow-y: auto` and `padding-top: 84px` so a list taller than the screen scrolls instead of clipping off the top/bottom, and the first link clears the sticky nav bar — keeping the hamburger ✕ (the close button, `z-index 202` over the overlay's `199`) reachable. (Was `justify-content: center`, unscrollable — Home/Personal Projects clipped off both edges on a phone.) **Closing the menu (2026-06-19):** the hamburger toggles into a ✕, **and** `nav-menu.js` (a shared script loaded site-wide before `theme-switcher.js`) adds **tap-the-backdrop** (`e.target === overlay`) and **Escape** to close. It only *adds* listeners (never re-binds the hamburger), so it coexists with each page's inline toggle/link-close handler without double-toggling.

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
- **Automatic train detection — auto-publish + strike-off (2026-06-07).** The
  model flipped from default-deny manual vetting to **post-moderation**:
  `train_detector` runs a **cascade** (loose trigger grabs a candidate clip → the
  calibrated `train_horn_detector` confirms it **inline**), auto-publishing
  confirmed trains (`verdict='train'`, `reviewed=0`) in real time. The privacy that
  forced pre-vetting is handled by `published` instead (below), so events flow
  automatically and a human only **strikes off** false positives. The page filter
  is now just `verdict='train'` (auto + human-verified show; only `false_positive`
  hidden); `renderVerdict` badges **● auto-detected** vs **✓ confirmed**.
  `train_confirm.py` (manual) backfills pending events and `--rescore` re-applies a
  new profile to past machine calls (never touching `reviewed=1`).
- **Audio-private trains + category (2026-06-06).** `train_events` gained
  `published` (default 0) and `category`. A confirmed train **counts and shows**
  (time/duration/dB) but its **clip audio is served only when `published=1`** — the
  clip endpoint requires `verdict='train' AND published=1`, and `observatory.js`
  (`?v=obs30`) renders the `<audio>` only when `published`, else **nothing** (no
  per-row note — private is the norm; 2026-06-08). `train_events.detected_at` is
  tz-aware UTC ISO, so `/api/trains/stats` + `/api/trains/today` count **today in
  Eastern** via `eastern_today_bounds()` + `datetime(detected_at)` (was a UTC-day
  `LIKE`, which read 0 every evening once UTC rolled past midnight).
  `category` records the fine class (train/plane/vehicle/…). Migrated
  idempotently by `bird_api.ensure_train_schema()` + `train_detector`/`train_confirm`
  at startup (preserves any already-public clip). `sync_train_verdicts.py`:
  `reject` strikes off false positives (`verdict='false_positive'`, off the page),
  `publish` opts a clip's audio public, and `emit`/`apply` still bridge a sorted
  corpus → verdicts. **`data/train-method.json`** + the on-page "How these are
  detected" panel state the live method/parameters/caveats (auto-publish + ~1-in-25
  strike-off margin); full record in `birdstation/DETECTION-METHODS.md`.
- **Train analytics — count trains + when (2026-06-08; unified into the Analytics tab
  2026-06-11).** `GET /api/trains/analytics` groups approved events into **passes**
  (clips within `pass_gap_min`, default 5 min, = one train) and returns Eastern buckets:
  `by_hour[24]`, `by_day`, `by_dow_hour[7][24]`, `total_passes`/`passes_today`,
  `busiest_hour`, `median_headway_min` (all-time; the endpoint is **not** period-scoped).
  These now render under **Analytics → 🚂 Trains** (`loadTrainAnalytics()`, called by
  `loadAnalytics()` when the mode switch is on Trains), **not** on the Trains tab: the
  headline cards (Trains / Today / Busiest hour / Typical gap — *not* clip counts) +
  three charts — **"When trains pass"** (hour-of-day), **"Trains per day"** (>1 day),
  **"When across the week"** (day×hour heatmap) — reuse the `obs-an-*` analytics CSS.
  The Trains tab is now the **raw feed** (recent events + the "How these are detected"
  panel) only.
- **Train analytics are period-scoped (2026-06-11).** `/api/trains/analytics` now takes
  optional `start`/`end` (the same Eastern→UTC window the bird analytics use, end
  exclusive) and scopes the period buckets to passes starting in it; `passes_today`
  stays the **absolute** Eastern-today count (so the "Today" card means today at any
  period). No window = all-time (backward compatible — an old box ignores the params).
  The pass-grouping compute moved to **`birdstation/train_analytics.py`** (FastAPI-free,
  single source of truth, unit-tested in `test_trains_analytics.py`); `bird_api` is a
  thin wrapper. The Analytics→Trains period selector is back (the earlier `[hidden]`
  bug that left it visible-but-inert is fixed). **Needs a box deploy** (`git pull` +
  `restart birdapi`) — until then trains analytics serve all-time regardless of period.
- **Confidence gate — three tiers (2026-06-03):** decoupled floors.
  (1) **Preserve 0.60** — the pipeline keeps detections ≥ 0.60 (was 0.35), cutting the
  worst noise but retaining sub-85% *diagnostic* hits. (2) **Display 0.85** — the page
  grid/stats show only ≥ 0.85 (was 0.75), for clean locale analytics; enforced
  server-side (`min_confidence` param on `/api/today`, `/api/detections`, `/api/stats`,
  default 0.0; `/api/species` + `/api/detections/grouped` default 0.85) and client-side
  in `observatory.js`. (3) **Life list** — a count rule on top, **three ways in** (box-side):
  **3 hits at ≥ 0.85 within a rolling 24h**, OR one **~100%** hit, OR (cumulative-evidence,
  added 2026-06-08) **≥ 8 hits at ≥ 0.70 all-time, no time window** (`LIFE_LIST_CUMULATIVE_HITS`
  / `LIFE_LIST_CUMULATIVE_CONFIDENCE`) — so a persistent moderate-confidence bird (the Downy
  Woodpecker case) the 24h rule kept missing still earns a spot. The bird-card recent-hits
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
- **Analytics dataset switch + tap-to-detail + numbers on bars (2026-06-11).** The
  Analytics tab carries a `🐦 Birds | 🚂 Trains` segmented switch (`.obs-an-modes`,
  `state.an.mode`; `setAnMode()`); `loadAnalytics()` branches by mode (birds →
  `/api/analytics`, period-scoped; trains → `/api/trains/analytics`, all-time, period
  bar hidden). Each mode caches its data; `state.an.data` mirrors the active one.
  **Every bar chart prints its count** above the bar (`.obs-an-bar-num`; bars scale to
  `BAR_HEADROOM_PCT` 86% so labels don't clip; `compactNum()` → "1.3k"; the per-day
  chart shows numbers only for ≤ 31 days). **Any chart is tappable** (a ⤢ button in
  each heading + the bar charts themselves) → `openChartDetail()` opens an enlarged,
  fully-labeled popout (`#obs-chart-modal`, reuses the life-modal shell; `detailBars` /
  `detailHeatmap`) — every axis tick, full numbers, cell counts on the train heatmap,
  the full leaderboard; horizontally scrollable. This is the **mobile** read path (no
  hover on touch). Shared builders: `hourBarsHtml()` / `dailyChartHtml()`.
- **Both** assets are cache-busted on observatory.html — `observatory.js?v=obs35` +
  `style.css?v=obs26` + `bird-info.js?v=obs6`. Bump the query on *every* changed
  Observatory asset (a stale cached `.js` once made a whole iteration look unshipped).
- **Bird cards (steps 1–3 + polish, 2026-06-01):** tapping any species card opens a
  quick-view modal (bottom sheet on mobile, centered on desktop): Wikipedia photo
  (contain + max-height:200px so full bird is visible) + filtered description (generic
  "species of bird/owl" suppressed) + extract (word-boundary truncation) + comic-book
  stats grid (Heard Here / Best ID / First Heard / Last Heard with date+time).
  `bird-info.js` handles fetch + 30-day localStorage cache + `data/bird-overrides.json`
  hook. `GET /api/species/{name}` serves history. Degrades gracefully if either source
  is offline. CC BY-SA attribution shown. Classes: `.obs-bcard-*`.
- **Lifer star + scoring explainer (2026-06-08; star + own-line summary 2026-06-10):**
  species-grid cards for birds already on the life list carry a small green **★** in the
  card's top-right corner next to the ×count (`.obs-species-meta` group + `.obs-lifer-star`;
  replaced the old wordy "★ Lifer" pill for less clutter; `isLiferGroup()` matches common
  **or** scientific name against `lifeNameSet()`; the grid re-renders once `/api/lifetime`
  lands since the two fetch in parallel). A **"★ N of M on the life list"** summary
  (`#obs-period-lifers`, `.obs-lifer-summary`) — respecting the active search / 100%-only
  filters — now sits on **its own caption line under the heading row** (was crammed into the
  `<h2>` beside the "💯 100% only" toggle; block-level, `:empty`-hidden). A collapsible
  **"ℹ️ How confidence & the life list work"** panel
  (`#obs-bird-method`, static HTML reusing `.obs-method*`) sits below the Birds stat cards and
  documents BirdNET's score (model certainty, *not* a calibrated probability), the
  display/preserve floors, and the three life-list paths.
- **Life-list breakdown + recent hits on the bird card (2026-06-03; cumulative path 2026-06-08;
  three-path breakdown + durable `qualified_via` 2026-06-10):** below the stats grid, a
  **"How it makes the life list"** mini-panel (`lifeListBreakdown()`, `.obs-bcard-method*`) lists
  the **three qualifying paths**, **each with this bird's count** and a green **✓** on the path(s)
  it currently meets — One detection at ~100% (count of ≥ 0.995 hits, derived client-side from
  `confidence_series`), 3 at 85%+ in 24h (`hits_24h`), 8 at 70%+ all-time (`hits_cumulative`).
  The caption leads with the **durable record** the box stores (`qualified_via` / `qualified_at`
  on the `lifetime` row): "Made the life list by *<path>* on *<date>*", or for a **grandfathered**
  lifer (joined before the current rules — the Common Grackle, on the list but meeting none of
  today's paths) "On the list from before the current rules — it joined under an earlier, lower
  confidence bar." The three rows then read as "its standing under today's three paths" (not
  pass/fail). Falls back to inference ("Currently meets…" / "It qualified earlier…") when
  `qualified_via` is absent (pre-backfill / older API). A non-lifer sees the rows as progress
  ("2 / 3", "5 / 8"). This replaced the old single status line and surfaces *which* method(s)
  qualify it + each method's count.
  Below it, each card lists the **last 10 detections** (newest first) with a confidence pill +
  date·time, under a caption — "Each detection's confidence — how sure BirdNET was — newest
  first" — that **grounds the % as "confidence"** (every `confPill` also gained a
  `title="BirdNET confidence"`). The hits list reaches down to the **0.60 preserve floor**
  (separate query in `/api/species`), so sub-85% diagnostic hits are visible (colour-graded
  mid/low) — making the life-list math legible at a glance. The card's summary stats (Heard
  Here / Best ID) stay at the 0.85 display floor. `/api/species/{name}` returns `recent[]`
  (last 10 `{timestamp, confidence}` ≥ 0.60), `confidence_series` (all ≥ 0.85, for the ~100%
  count), `hits_24h` (≥ 0.85 in 24h), `life_list_min_hits`, `hits_cumulative` (≥ 0.70 all-time)
  + `life_list_cumulative_hits` / `life_list_cumulative_confidence` (the cumulative-evidence
  path), `on_life_list`, and `qualified_via` / `qualified_at` (how/when it made the list —
  `instant_100` / `burst_24h` / `cumulative_70` / `grandfathered`). Classes: `.obs-bcard-hits*`,
  `.obs-bcard-status*`, `.obs-bcard-method*`, `.obs-lifer-star`. Next: step 4 detail view (sparkline + by-hour
  histogram); optional box-side "record the qualifying method at insert" for exact historical
  attribution (ROADMAP §3).
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
- **Stat cards (2026-06-01; life popout 2026-06-05):** "Life list" opens the life-list
  popout (was a smooth-scroll); "Latest" opens the bird card modal. Both use `data-action`
  delegation; keyboard-accessible.
- **Bird card UX (2026-06-01; refined 2026-06-03):** Wikipedia link is the `↗ Wikipedia`
  text link below the sci name (the **photo is no longer a link** — it was too easy to
  tap out by accident); extract expanded to 3 sentences (≤ 500 chars); the close ✕ is a
  40×40 tap target (was 28×28).
- **"100% only" filter (2026-06-03):** a green toggle pill in the species-grid heading
  (`#obs-perfect`, `state.onlyPerfect`) filters the grid to species whose best confidence
  in the selected period reads as 100% (≥ `PERFECT_CONFIDENCE` 0.995 — the same bar that
  instant-adds a lifer). Client-side, persists across period switches; pair with the
  **All** period for the all-time list of birds heard at 100%.
- **Analytics tab (📊, 2026-06-04; hover + daily fix 2026-06-05):** a third tab (between
  Birds and Trains) for detection *distributions* over its own period selector (defaults to
  **This week**). Renders, all vanilla CSS (no chart lib): summary stat cards (Detections /
  Species / **Busiest hour** / **Peak day**), a **24-hour activity chart** ("When the birds
  sing" — busiest hour highlighted), a **species×hour heatmap** ("Who sings when" — each row
  self-normalized to its own peak so the *pattern* shows; ×total badge for volume; scrolls
  horizontally on mobile; species-name label widened to 168px + full-name `title` so longer
  names aren't cut off), a **most-heard leaderboard** (top 15, proportional bars), and a
  **per-day activity chart** ("Activity over time"; hidden for single-day periods). All times
  **Eastern**. Heatmap + leaderboard rows are clickable → bird card (reuse the `[data-name]`
  delegation). **Hover tooltips (2026-06-05):** the hour bars, heatmap cells, and daily bars
  carry `data-tip` and a delegated cursor-tracking `.obs-an-tip` bubble (`initAnTooltips()`)
  shows the count for that block — replacing the slow native `title` (which is kept only on
  the heatmap label for the full name). Tooltips read from the period-scoped response, so
  they respect the active filter. Powered by `GET /api/analytics` (one call); `state.an`,
  `obs-an-*` classes, `loadAnalytics()`, `TAGLINES.analytics`. **Lazy-loads on first tab
  open.** **Daily-chart blank fix (2026-06-05):** `.obs-an-dbar-wrap` now has `height:100%`
  (its `flex-end` parent had collapsed it, hiding the `%`-height bars).
- **Life list "100% only" filter (2026-06-05):** the life list has the same `💯 100% only`
  toggle as the species grid (`#obs-life-perfect`, `state.lifeOnlyPerfect`), filtering to
  lifers whose best-ever confidence reads as 100% (≥ `PERFECT_CONFIDENCE` 0.995). Driven by a
  new `best_confidence` field on `/api/lifetime` (unfloored `MAX(confidence)` per species);
  `renderLife()` now owns the life-list count so it follows the filter.
- **Life list popout (2026-06-05):** the life list is no longer an inline section — it lives
  in a **modal** (`#obs-life-modal`, `.obs-life-*`) reusing the bird-card shell (bottom sheet
  on mobile, centered ≥600px), opened by the "Life list" stat card. Sticky header carries the
  sort `<select>` + `💯 100% only` toggle; the body scrolls. The main Birds page is more
  compact (no scrolling to reach it). It sits at `z-index 390` (below the bird card's 400) so
  tapping a lifer opens its card on top and closing returns to the list; `openLifeModal()` /
  `closeLifeModal()` coordinate the body scroll-lock with the bird card. Escape closes the
  topmost modal.
- **"Almost a lifer" shelf (2026-06-05):** a progress-game shelf on the Birds panel (between
  the stat cards and the period bar; `#obs-almost-section`, hidden until populated) listing
  species **heard at ≥ 0.85 in the rolling last 24h but not yet on the life list and short of
  the 3-hit bar** — cards with a green **"N of 3"** progress bar + an "M more to go" line,
  ordered closest-first, tap-through to the bird card (added to the `[data-name]` delegation).
  Mirrors the box's life-list rule **client-side, no box change**: `loadAlmost()` fetches
  `/api/detections/grouped` over a **rolling 24h** window (`fmtUtcTsFull()` keeps minute/second
  precision, vs the hour-floored period windows) and `computeAlmostLifers()` (a pure, tested fn)
  drops listed species (matched by common **or** scientific name), the ~100% instant-add tier
  (`PERFECT_CONFIDENCE`), and counts outside `1..LIFE_LIST_MIN_HITS-1`. The section **hides
  itself** when nothing's close or the box is offline (a bonus shelf — no error noise).
  `renderAlmost()` is called from both `loadAlmost()` and `loadLife()` (whichever lands last
  wins) and gated on `state.lifeLoaded` so a lifer is never briefly shown as "almost". Classes
  `.obs-almost-*`.
- **Tooltip wrapping (2026-06-05):** the `.obs-an-tip` figures use a `nbCount()` helper
  that glues the count to its unit with a non-breaking space ("188 detections"), so a
  wrapping tooltip never strands the number on its own line.
- **Dawn-chorus shading (2026-06-05):** the "When the birds sing" hour chart sits over a
  **continuous day/night "sky" gradient** — night a soft dark wash, a **gold dawn glow** at
  sunrise, clear day, a **warm dusk** near sunset — with a 🌅/🌇 sunrise/sunset line
  (`#obs-an-suninfo`) below it. Sun times are computed client-side by a trimmed SunCalc
  (`sunTimes()`, `OBS_LAT`/`OBS_LON`) for the period's midpoint date, read in Eastern
  (`easternDecimalHour()`); `sunGradient()` builds a `linear-gradient` whose stops map the
  24-hour span to sunrise/sunset (the bars sit above it via `.obs-an-hours-bg` z-index). Pure
  vanilla, no deps; degrades to no shading if sun times are unavailable. Birds-only (the
  train-analytics toggle will skip it — see `PLAN-train-analytics.md`). *(First cut used
  per-column tints, which read as blocky/gappy; replaced with the single gradient.)*
- **Trains "How these are detected" panel (2026-06-07):** a collapsible `<details>`
  on the Trains tab (`#obs-train-method`, `.obs-method*`) rendered by
  `loadTrainMethod()` from **`data/train-method.json`** (JSON-driven: summary, method,
  parameters, accuracy, caveats) — so the page states exactly how detection works and
  its caveats. Full long-form record in **`birdstation/DETECTION-METHODS.md`** (method,
  calibration pipeline, refinement loop, two-detector reality + convergence, privacy,
  caveats); keep the JSON + doc in sync on every recalibration. Bonus panel — fails
  silent if the JSON is missing.
- Assets: `style.css?v=obs30`, `observatory.js?v=obs38`, `bird-info.js?v=obs6`.
- **"Almost a lifer" is a popout, not an inline shelf (2026-06-17):** a compact trigger
  banner (`#obs-almost-trigger`, shown only when candidates exist) opens a modal
  (`#obs-almost-modal`) reusing the life-list shell (`.obs-life-overlay` + `obs-life-open`;
  `openAlmostModal`/`closeAlmostModal`/`almostModalOpen`, in the Escape chain + bird-card
  scroll-lock). `renderAlmost()` drives the trigger + counts; `#obs-almost` (the card grid)
  moved into the modal but kept its id so the card-tap delegation is unchanged. This + a
  couple of margin bumps (`.obs-method`, `.obs-period-bar`) gave the Birds panel breathing
  room. **Life-list cards are now a vertical stack** (name full-width → wraps at spaces,
  not mid-word; then a `×count · since <date>` meta row) — fixes long names like
  "Red-bellied Woodpecker" breaking as "Woodpec\ker".
- **"Almost a lifer" now covers both routes (2026-06-15):** the shelf surfaces birds
  on the **burst** path (1–2 of 3 hits ≥0.85 in rolling 24h) *and* the **cumulative**
  path (6–7 of 8 all-time hits ≥0.70). `loadAlmost()` fetches both windows in parallel;
  `computeAlmostLifers(burst, cumulative, life, perfectConf)` merges, dedupes a bird
  close on both to the nearer path, and each card names its scope ("N more in 24h" /
  "N more all-time"). `ALMOST_CUMULATIVE_MIN = 6`.
- **Hour chart prints only the peak number (2026-06-17):** 24 columns are too narrow
  to label every bar without collisions (even on desktop), so `hourBarsHtml` now emits
  the count **only on the peak/busiest bar**; every bar's number stays in the
  tap-to-detail popout + hover tooltips. The daily chart still labels each bar (few of
  them) and hides those inline labels < 600px (`.obs-an-daily .obs-an-bar-num`).
- **Bird cards: long text wraps (2026-06-15):** `min-width:0` + `overflow-wrap` on the
  species name, life-list rows, and bird-card stat grid cells (no more overflow).
- **Bird cards always populate (2026-06-17):** a species with **no detections at the
  0.85 display floor** (a moderate-confidence / cumulative-path lifer opened from the
  life list) made `/api/species?min_confidence=0.85` **404**, so the card degraded to a
  Wikipedia-only stub (no stats / hits / life-list breakdown). `openBirdCard` now
  **retries at the 0.60 preserve floor** when the display-floor fetch returns null, so
  the card fills in for any bird with any detection (front-end only — the API already
  honors `min_confidence`). Also: `truncateExtract` no longer chops the extract at a
  single-letter abbreviation (e.g. "…Mexico, I. s.").

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
  - `feed_digests` — PK **`(date, slot)`** (was `date`; `slot ∈ {morning, evening}`, 2026-06-05), `generated_at`, `headline`, `sections_json`, `citations_json`, `model`, `item_count`. Migrated idempotently by `pulse_digest.ensure_schema()`.
- **Jobs (systemd timers):**
  - `pulse_fetcher.py` — `pulse-fetch.timer`, every 15 min: pulls every enabled source (feedparser), dedupes by `url`, stores, and **purges items older than 30 days** (`RETENTION_DAYS`). **Captures the fullest article text (2026-06-04):** `extract_body()` prefers `content:encoded` (feedparser `e.content[*].value`) over the teaser; cap raised 500 → 2000 (`BODY_CAP`). This richer body lands in `summary` and grounds the AI steps (reduces hallucination). Forward-looking only — existing rows are deduped by `url`, so the fuller body fills in on new items.
  - `pulse_enrich.py` — `pulse-enrich.timer` (every 20 min): batched (20/run) AI tagging + one-sentence summaries via **`claude-haiku-4-5`**, prompt-cached system prompt. Prompt has a **GROUNDING rule (2026-06-04):** summarize only from the provided headline/blurb; don't invent specifics. **Retry budget (`enrich_attempts`, cap 3) is only burned on a genuine per-item miss (2026-06-05):** a *successful* call that omits an item. Batch-level API/account/network failures (`anthropic.APIError` — billing, auth, rate-limit, 5xx, timeouts) roll back **without** bumping and retry next run, so an outage (e.g. an empty credit balance) can't permanently exclude the items it touched. (Previously any exception bumped the whole batch, so a billing outage silently capped items at `>=3` and they never re-enriched — fixed; one-time cleanup was `UPDATE feed_items SET enrich_attempts=0 WHERE enriched_at IS NULL`.)
  - `pulse_digest.py` — `pulse-digest.timer`, **twice daily (06:00 + 17:00 `America/New_York`, 2026-06-05)**: writes a sectioned brief via **`claude-haiku-4-5`** + **extended thinking** (`{"type":"enabled","budget_tokens":4000}` — Haiku 400s on `"adaptive"` thinking; the digest auto-falls-back to no thinking if a model rejects it) (was `claude-sonnet-4-6` — grounding lets Haiku do it at a fraction of the cost), structured output through `messages.parse()`. Skips a run with `<MIN_ITEMS` (3). **Window = "since the last brief" (2026-06-05):** selects items whose `enriched_at` is after the previous digest's `generated_at` (floored at `MAX_LOOKBACK_HOURS` = 24 so a first run / outage gap can't pull a huge backlog); windowed on `enriched_at` not `fetched_at` so late-enriched items aren't dropped — each brief is fresh, no re-tread. **Two briefs/day coexist:** stored by `(date, slot)` with `slot ∈ {morning, evening}` (Eastern date + noon split); `ensure_schema()` rebuilds the PK idempotently on first run (no manual SQL). **Grounding (2026-06-04):** the per-item payload carries an **`excerpt`** (richer `summary` body, capped 500/item) alongside the one-sentence `ai_summary`, and the prompt forbids invented figures/dates/names/quotes/causes/outcomes ("be vague rather than wrong"). API/account failures retry next run without crashing (`anthropic.APIError` guard).
- **Observatory writers (long-running services, in `birdstation/`):**
  - `birdnet_pipeline.py` — `birdnet.service`: captures 15 s chunks off the Icecast `/backyard` stream (`localhost:8000`), runs BirdNET-Analyzer (its own `~/BirdNET-Analyzer/birdnet-env` venv), writes `detections` (confidence ≥ `MIN_CONFIDENCE` **0.60** — the *preserve* floor, raised from 0.35 on 2026-06-03 to cut noise while keeping sub-85% diagnostic hits; also passed to BirdNET as `--min_conf`. The public page filters separately at the 0.85 display floor). **Life-list gate (2026-06-02):** a *new* species joins `lifetime` after **`LIFE_LIST_MIN_HITS` = 3** detections at ≥ `LIFE_LIST_MIN_CONFIDENCE` **0.85** within a **rolling 24h window** (`datetime(timestamp) >= datetime('now','-24 hours')`), **or a single ≥ `LIFE_LIST_INSTANT_CONFIDENCE` 0.995 (~100%) hit** (instant-add, bypasses the multi-hit rule), **or (cumulative-evidence path, 2026-06-08) ≥ `LIFE_LIST_CUMULATIVE_HITS` = 8 detections at ≥ `LIFE_LIST_CUMULATIVE_CONFIDENCE` = 0.70 all-time** (no time window — for persistent moderate-confidence birds). The gate is evaluated for any hit ≥ 0.70 (the lowest threshold that can contribute), not just ≥ 0.85. **Life-list tally (fixed 2026-06-03):** `total_detections` is **recomputed live from `COUNT(*)` of the species' ≥ 0.85 detections** — both in the pipeline (on each new hit, self-healing the stored column) and, authoritatively, in `/api/lifetime` (derived at read time, so the displayed total is always truthful and consistent with the page's other ≥0.85 views). This replaced a `+1` counter that drifted low (showed a lifetime total below a single day's count). BirdNET runs with lat/lon **and** `--week` (BirdNET's 1-48 week, `USE_WEEK_FILTER`), so both location and season filter the species list. **Verifiable lifers (2026-06-02):** each life-list-qualifying hit (≥ 0.85) also archives one WAV to `~/bird_clips` (capped one per species/day; `clip_path` + `verified` columns on `detections`), labelled via `review_birds.py` (`--stats` = measured precision by confidence band) and aged out by `purge-bird-clips.timer` — **local-only, never served** (backyard-mic privacy). (CSV reader fixed 2026-05-30 to `delimiter=","`.) Wipe bird tables for a clean start with `birdstation/reset_birds.sh` (backs up first; leaves Pulse + trains intact).
  - `train_detector.py` — `train_detector.service` (own `~/train-env` venv, needs numpy): reads `localhost:8000/backyard`, pipes it through **ffmpeg → mono s16le PCM** (must decode the MP3 — reading raw stream bytes as PCM was the long-standing reason `train_events` stayed empty; fixed 2026-06-01), detects sustained energy in the 300–1500 Hz band, writes `train_events` + a WAV clip in `~/train_clips`. Every event starts un-reviewed/hidden (see Train privacy above). **NB:** a duplicate `traindetect.service` existed for the same script — `train_detector.service` is canonical; the dup is removed.
  - **P2 train horn study (offline, manual CLIs — added 2026-06-06):** a *second*
    train detector that works on **recorded AudioMoth WAVs**, not the live stream —
    an AudioMoth ~1500–1700 ft from the tracks keying on the **horn** (tonal energy
    ~250–600 Hz, 2+ blasts within a window) rather than rumble. **No systemd unit;**
    run on demand. `train_horn_detector.py` scans a file/dir of WAVs (STFT → horn-band
    RMS + a tonality ratio; sustained blasts; 2+ within `CONFIRMATION_WINDOW_SEC` =
    train), parses AudioMoth `YYYYMMDD_HHMMSS.WAV` timestamps, optional CSV out.
    `build_horn_profile.py` is the **calibration**: it reads a **category-folder
    corpus** (`--corpus ROOT` where `trains/` = positives and every other subfolder
    = a labeled negative class — planes/vehicles/gunshots/…; or explicit
    `--positives`/repeatable `--negatives`), derives the real horn band
    (positive-vs-negative spectral contrast), calibrates the tonality/duration/gap
    thresholds **at the operating threshold** (reusing the detector's own feature
    fns), and writes diagnostic PNGs + a parameter block + `horn_profile.json`. A
    **`--check`** mode just censuses the corpus and gives a GOOD/OK/THIN readiness
    verdict (run mid-sort). It ends with an **end-to-end validation pass** — runs
    the *real* detector over the labeled clips and reports recall/precision with a
    **per-class false-alarm breakdown** (the honest "is it accurate" answer; it also
    caught a duration-bound bug during the build). The detector **auto-loads** a
    `horn_profile.json` sitting next to it (or via `--profile`), so calibration
    flows into detection with no source edits. Deps: `librosa numpy scipy` (+
    `matplotlib` for plots). Corpus WAVs and generated `horn_profile.json` /
    `horn_profile_out/` are **gitignored** (deployment-specific, like `*.db`); the
    param block is the durable record. **`birdstation/HORN-CORPUS-GUIDE.md`** is the
    plain-English **Windows 11** runbook (pull recordings → sort in VLC/Audacity →
    `--check` → calibrate → read accuracy → deploy). Full write-up in
    `Build History.md` (2026-06-06).
  - **`sync_train_verdicts.py` (bridge, 2026-06-06):** because the sorted corpus
    clips *are* the live detector's `train_events`, this carries the folder labels
    back into the DB so vetting also **populates the Observatory Trains page** —
    `emit` (PC) writes a verdicts CSV, `apply` (box) sets verdict/category/published
    by exact filename match (audio private by default), `publish` opts a clip's
    audio public. Pure stdlib. See the "Audio-private trains + category" bullet
    above and `Build History.md` (2026-06-06).
  - `review_trains.py` — **manual** CLI on the box to vet pending train events (play clip → train/false/unsure → DB). Near-term vetting workflow; web UI is future (`PLAN-train-vetting.md`).
  - `purge_train_clips.py` — `purge-train-clips.timer` (**Sun 04:00**): deletes rejected + aged-orphan clips, keeps approved-train + still-pending. `--dry-run` supported.
  - `review_birds.py` — **manual** CLI on the box to confirm life-list detections from their archived clips (correct/wrong/unsure → `detections.verified`); `--stats` prints measured precision by confidence band (calibration data).
  - `purge_bird_clips.py` — `purge-bird-clips.timer` (**daily 04:30**): deletes unreviewed bird clips older than 30 days + aged orphans, keeps labelled (reviewed) clips + recent unreviewed. `--dry-run` supported.
  - `backfill_life_list.py` — **manual one-shot** (not timed): scans `detections` and inserts the missing `lifetime` rows for species that already qualify under any path (cumulative ≥ 8 @ ≥ 0.70, one ~100%, or retroactively ≥ 3 @ ≥ 0.85 all-time). The pipeline only evaluates the gate on a *new* detection, so this catches up persistent species (e.g. the Downy) after the cumulative path shipped. Backs the DB up first; `--dry-run`. Leaves `detections`/Pulse/trains untouched.
  - `backfill_qualified_via.py` — **manual one-shot** (not timed; 2026-06-10): labels existing `lifetime` rows with **how they qualified** (`qualified_via`: `instant_100` / `burst_24h` / `cumulative_70`, or **`grandfathered`** when a lifer meets none of the current paths — it joined under an earlier, lower bar, e.g. the Common Grackle). Classifies from each species' all-time detection aggregates, mirroring `backfill_life_list.find_qualifiers`' order. Idempotent (only NULL rows), backs up the DB first, `--dry-run`. New lifers get `qualified_via`/`qualified_at` straight from the pipeline; this is just the catch-up for pre-existing ones. The `lifetime.qualified_via`/`qualified_at` columns are added idempotently by `birdnet_pipeline.init_db()` + `bird_api.ensure_life_schema()` at startup, and surfaced by `/api/species` + `/api/lifetime`.
  - `purge_low_confidence.py` — **manual one-shot** (not timed): deletes `detections` with confidence below the preserve floor (default 0.60) — cleanup of the old ≥ 0.35 noise after the floor was raised. Backs the DB up first; `--dry-run` / `--floor` / `--no-backup`. Leaves `lifetime`, Pulse, and train tables untouched. New data stays clean on its own (the pipeline won't write below the floor).
- **Secrets:** `ANTHROPIC_API_KEY` and `BIRD_API_KEY` live only on the box, moving to `/etc/birdstation.env` (chmod 600) referenced by `EnvironmentFile=`. Never committed; `.gitignore` blocks `*.env`/`*.db`. (The observatory services need no keys.)

### Digest + citations (current behavior)

- The brief renders as a card above the feed: one-line headline, 3–6 themed sections (each a 2–4 sentence synthesis), a per-section **`Sources:` block** of numbered clickable links — **collapsed by default (2026-06-04)** behind a `<details>`/`<summary>` ("Sources (N)"), matching the Citations toggle — and a numbered **Citations** list at the foot (also collapsed). Front-end: `renderSectionSources()` in `pulse.js`; `.pulse-sources-toggle` / `.pulse-sources-list` in `style.css`. The card label is **"📰 Morning Brief" / "🌆 Evening Brief"** off `d.slot` (twice-daily, 2026-06-05); `/api/digest` serves the most recent brief by `generated_at`.
- Citation flow: each item is fed to Claude with its `feed_items.id`; Claude returns `citation_ids` per section; `pulse_digest.py` resolves those ids → globally-numbered `{n, title, url, source}` (Claude never emits URLs → no hallucinated links). The API returns per-section `citations` plus a top-level `citations` list; the front-end renders both and **degrades silently** when they're absent.

## Other version-controlled docs

- `PLAN-pulse.md` — original Pulse design + phases.
- `PLAN-ingestion.md` — **Phase 4 plan** (next up): generalize ingestion beyond RSS (pluggable adapters for **api**/scrape/email/manual, AI-as-parser for scrape, a separate `events` store + "What's On" surface, a paste-to-capture tool). Decisions settled: separate events store; paste-first email; **first event source is Archer Music Hall via an `api` adapter (Ticketmaster Discovery API)** — every HTML source (official site + Bandsintown/JamBase/Concertfix/SeatGeek) 403s a server fetch (tested 2026-06-04), so prefer APIs and verify fetchability before assuming a page is scrapable. Needs a free `TICKETMASTER_API_KEY` in `/etc/birdstation.env`.
- `PLAN-train-analytics.md` — **designed, not started** (2026-06-05): a `Birds | Trains` toggle on the Analytics tab. Reuses the stat cards / hour chart / per-day chart; adds a day-of-week×hour heatmap, duration/loudness histograms, and a headway card; backed by a new approved-only `GET /api/trains/analytics`. **Gated on vetted train data** (ties to `PLAN-train-vetting.md`); the front-end scaffold can land first.
- `PLAN-train-vetting.md` — train privacy gate + CLI review + purge (shipped); web review UI + detection-tuning loop are future.
- `PLAN-spotify-setlist-tools.md`, `Spotify Setlist Tools Implementation.md`, `Task Tracker Write-Back Implementation.md` — design/implementation records for those features.

## Tech Stack page (`techstack.html`)

Self-contained single-file page (inline `<style>` + `<script>`). No external JS dependencies.

### Architecture documented (14 nodes, 15 edges)
Hardware chain: **AudioMoth** (USB mic) → **birdnode** (Raspberry Pi Zero 2 W running Icecast) → **birdstation** (home server: FastAPI + BirdNET + train detector) → **Cloudflare** (DNS + reverse proxy + SSL) → **alansbrain.com** (Visitor). Parallel paths: **Alan** (admin via SSH + git) → birdstation, **GitHub** (code hosting) → birdstation (git pull deploys) + **Vercel** (static hosting + serverless proxies), **Porkbun** (domain registrar, NS delegated to Cloudflare), **Anthropic** (Claude API called by birdstation's AI services). **External APIs (added 2026-06-22), each off Vercel's serverless proxies on the HTTPS/API edge:** **Spotify API** + **setlist.fm** (Setlist to Spotify) and **OpenWeatherMap** (Weather).

### Deep-linking (2026-06-22)
`techstack.html#<nodeId>` — or `#<nodeId>~<glossKey>` to also pop a definition — selects that node and opens its panel on load (`openFromHash()`, also on `hashchange`). Used by the **project-card tags on `projects.html`**, which carry `data-stack` and jump to the relevant tech: Pulse→**RSS** (`birdstation~rss`), Observatory→**BirdNET** (`birdstation~birdnet`) / **Raspberry Pi** (`birdnode`), Setlist→**Spotify API** (`spotify-api`) / **Setlist.fm** (`setlistfm`). Tags sit inside the card `<a>`, so a handler navigates manually + stops propagation; keyboard-accessible, with a `↗` affordance (`.card-tag[data-stack]`).

### Node graph implementation
- `NODES` array: each entry has `id`, `label`, `d:[x%,y%]` (desktop pos), `m:[x%,y%]` (mobile pos), `color` (CSS class), `hex`, `type`, `what`, `role` (HTML with `T()` markup), optional `icon` (img path) or `emoji`, optional `privacy`.
- Canvas aspect-ratio: `5/4` desktop, **`7/12` mobile** (mobile bumped from `7/10` + `min-height` 500→560px on 2026-06-21 for vertical breathing room). `positionGraph()` recomputes pixel coords on every resize.
- **Layout — de-crowded two columns (2026-06-21):** left column AudioMoth → birdnode → birdstation → Cloudflare → Porkbun; right column Alan → GitHub → Anthropic → Vercel; both converge to alansbrain.com → Visitor at the bottom center. All 11 `d`/`m` positions retuned so no icon or label overlaps (verified with a bounding-box harness at desktop + a 360px phone) — the old layout had the long "alansbrain.com" label running into the Visitor node.
- `buildGraph()` creates SVG defs/markers + node divs; `selectNode(id)` highlights active edges (stroke-opacity 0.9) and dims inactive (0.06); `clearSelection()` restores defaults.
- Extra-bow heuristic on long diagonals: alan→birdstation, github→birdstation, birdnode→birdstation (+18px).
- NODE_R = 32px desktop, 26px mobile (arrowhead offset; bumped 2026-06-15 with the
  larger nodes — `.ts-node-icon` 64px desktop / 52px mobile, was 56/46).
- **Labels show in full (2026-06-15):** `.ts-node-label` dropped its `max-width` +
  `text-overflow: ellipsis`, so long names ("alansbrain.com") are no longer truncated.

### Glossary / clickable-term system (2026-06-02)
- **`GLOSSARY`** object: 31 entries mapping `key → {title, def}` (DNS, reverse-proxy, SSL termination, Icecast, BirdNET, systemd, FastAPI, SQLite, PKCE, CDN, anycast, nameserver, A record, CNAME, HTTPS, SSH, git, REST, JSON, API, WAV, PCM, MP3, FFT, uvicorn, CORS, webhook, serverless, venv, cron, passphrase). *(USB removed 2026-06-14 as an arbitrary definition.)*
- **`T(key, display)`** helper wraps terms in `<span class="ts-term" data-key="...">` inside node role strings; event delegation on `.ts-panel` opens the popover.
- **`.ts-gloss`** fixed-position card; `showGloss(key, triggerEl)` uses `getBoundingClientRect()` for placement (flips below trigger if < 60px from top).

### Icons
Custom icons from `img/Icons/icons/`: AudioMoth → `Audio_Related/audio-waves.png`, birdnode → `Audio_Related/sound-wave.png`, Cloudflare → `Explore/cloud.png`, Porkbun → `Other/domain.png`, **website (alansbrain.com) → the Brain header icon `Alan's_Brain/world-creativity-and-innovation-day.png`** (apostrophe `\'`-escaped in the JS string; was `Other/planet.png`, 2026-06-21). **Node icons added 2026-06-21** (Flaticon, credited in `Attributions_for_Artists.txt`), all under **`img/Icons/icons/Stack/`**: Anthropic→`api.png`, GitHub→`octopus.png`, birdstation→`parrot.png`, Alan (Admin)→`coding.png`, Visitor→`visitor.png` (512×512 PNGs, rendered at 32/28px) — only **Vercel** still uses an emoji (▲). Separately, **Pulse** and **Observatory** got project icons — `img/Icons/icons/Projects/radar.png` + `observatory.png` — on their page heroes (`pulse.html`/`observatory.html`) and the project cards on `index.html` + `projects.html` (the small nav 🔭/🚀 emoji are unchanged). The PNGs were delivered via a GitHub branch upload (the build sandbox can't reach Google Drive) and verified as complete PNGs before wiring.

### Privacy posture
No IPs, ports, credentials, or internal network topology exposed. Node descriptions reference only public-facing URLs or generic architectural patterns.

## Known caveats

- **RSS URL rot** is the #1 source-health risk; broken feeds surface as a per-source error in the strip rather than breaking the page.
- birdstation is a home box — if it's offline, Pulse shows an offline state and the digest card simply hides.
- The two old local planning docs (`Task Tracker Write-Back Feature Plan.md`, `New Pages Plan.md`) remain gitignored.
- **birdstation runs from the clone** (cutover complete 2026-05-31): the box has the repo at `~/alans-brain`, units point at `~/alans-brain/birdstation/*.py`, secrets are in `/etc/birdstation.env`. Deploy = `cd ~/alans-brain && git pull && sudo systemctl restart <unit>`. **Unit files are symlinked from the repo into `/etc/systemd/system` (`birdstation/link_units.sh`, 2026-06-05)**, so `.timer`/`.service` edits also deploy on `git pull` — but a changed unit still needs `sudo systemctl daemon-reload` + a restart (and a brand-new unit needs `link_units.sh` run once). See `birdstation/README.md` → "Deploying unit-file changes". (Before this, units were `cp`'d in and silently drifted — a skipped copy left the box on the old `pulse-digest.timer` schedule.)
- **Citations are live** — the `feed_digests.citations_json` column exists, `pulse_digest.py` writes per-section + global citations, `/api/digest` serves them, and the front-end renders the `Sources:` lines + Citations list. (`pulse_digest.py` uses `max_tokens=16000` — 4000 truncated the thinking+citations output.)
- **`BIRD_API_KEY` was rotated** at cutover (the old one leaked in chat 2026-05-30); the new value lives only in `/etc/birdstation.env`.
- Old `~/*.py` copies are retired to `~/retired/`; the canonical copies are in `birdstation/`.
