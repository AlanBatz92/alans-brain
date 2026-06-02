# Build History

> Chronological record of feature work and decisions. Append a dated entry
> after landing each feature; keep `Current State.md` in sync.
>
> **Backfill note:** this log was started 2026-05-30. Pre-2026-05 feature
> history lives in the per-feature implementation docs (`Spotify Setlist Tools
> Implementation.md`, `Task Tracker Write-Back Implementation.md`) and the
> `PLAN-*.md` files — pull entries forward into this log as you revisit them.

---

## 2026-06-02 — Life-list gate (85% × 3 in 24h, instant at ~100%) + period-aware Observatory stats

Two changes — one box-side, one front-end.

**Life-list qualification (box-side, `birdstation/birdnet_pipeline.py`):** a new
species now joins `lifetime` after **3 detections at ≥ 0.85 within a rolling
24-hour window** (was 3 at ≥ 0.75 in a calendar day), **or immediately on a
single ≥ 0.995 (~100%) detection** that bypasses the multi-hit requirement. New
constant `LIFE_LIST_INSTANT_CONFIDENCE = 0.995` (defined as "displays as 100%" —
what the page rounds to); `LIFE_LIST_MIN_CONFIDENCE` 0.75 → 0.85; `LIFE_LIST_MIN_HITS`
stays 3. The window switched from `date(timestamp)=date('now','localtime')` to
`datetime(timestamp) >= datetime('now','-24 hours')`; `datetime()` normalizes the
stored ISO `T`+microsecond timestamps so the string comparison is exact (verified
with a sqlite simulation). Existing-lifer tallies still increment per ≥ 0.85 hit.
**Deploy:** `cd ~/alans-brain && git pull && sudo systemctl restart birdnet`. No DB
migration. The page's *display* floor stays 0.75 (it still shows every confident
bird, listed or not) — display and life-list gating are now decoupled, and stale
"0.70 gate" / "0.75 matches the lifer floor" comments were corrected in
`observatory.js` and `bird_api.py`.

**Misidentification quantification (the question behind the change):** BirdNET's
confidence is a unitless sigmoid score, *not* a calibrated probability (Wood &
Kahl 2024), so "85%" ≠ "85% chance correct." Literature precision climbs steeply
with threshold (~95% above 0.82 in one study; <2% false positives at 0.5 in
another; species-specific thresholds reach >0.9). The lat/lon location filter the
pipeline already applies is the biggest single false-positive reducer; a noted gap
is that `--week` isn't passed, so there's no seasonal filtering (BirdNET uses a
48-week/yr convention, so the stored ISO week would need converting). The 3×/24h
rule kills one-off flukes but **not** systematic confusers (recurring noise or
vocal mimics — mockingbird/jay/starling), whose errors are correlated, not
independent — so it's not a clean p³. The ~100% instant-add trades the multi-hit
net for those edge cases (low but non-zero risk). To *measure* site precision:
retain a clip/spectrogram per qualifying detection and spot-check → added to the
roadmap (ties into the existing "provisional vs. confirmed" idea).

**Observatory period-aware stats (front-end, `observatory.js` / `observatory.html`):**
the headline stat cards now follow the selected period instead of always showing
today. "Heard today" → "Heard yesterday / this week / this month / this year", and
the Heard + Species totals (plus the period's "Latest" bird) update with the filter;
the **Life list** card stays the all-time total. Added a **"This year"** period tab
(`periodDates` gains a `year` branch: Jan 1 Eastern → now). All three period stats
derive from `state.periodGroups` (one row per species, each with a `count`) via
`sum(count)` and `length`, so they're correct for any range with no extra fetch;
`state.periodLabel` drives the labels and `state.periodLatest` the Latest card.
`renderBirdStats()` runs whenever the active period's data loads (not on search/sort,
so the top totals reflect the period, not the text filter). **Assets:** `observatory.js?v=obs11`
(HTML cache-bust bumped; no CSS change).

## 2026-06-02 — Tech Stack: glossary popovers, custom icons, improved node spacing

Polish pass on `techstack.html` after initial launch.

- **Glossary / clickable-term system:** 32-entry `GLOSSARY` object maps term keys to `{title, def}`. `T(key, display)` helper wraps technical terms in `<span class="ts-term" data-key="...">` inside all node panel descriptions. Clicking any term opens a fixed-position `.ts-gloss` popover with a plain-English definition; viewport-aware placement via `getBoundingClientRect()` (flips below trigger if < 60px from top). Event delegation on `.ts-panel` — no per-term listeners. A demo term in the hero subtitle ("hop between nodes") shows the feature immediately on load.
- **Custom icons:** replaced generic colored boxes with site icons for 5 nodes — AudioMoth → `img/Icons/icons/Audio_Related/audio-waves.png`, birdnode → `Audio_Related/sound-wave.png`, Cloudflare → `Explore/cloud.png`, Porkbun → `Other/domain.png`, website → `Other/planet.png`. Alan, birdstation, GitHub, Vercel, Anthropic, Visitor continue to use emoji fallbacks (no matching icon in the set).
- **Node spacing:** canvas aspect-ratio changed from `4/3` to `5/4` (desktop) to add vertical room for the 6-layer layout. Node positions retuned — the AudioMoth → birdnode → birdstation left-column chain now has ≥ 17% vertical gap between nodes.

## 2026-06-02 — Tech Stack page: initial build + birdnode topology + Stack nav tab

New `techstack.html`: interactive SVG node-graph documenting the full hardware and software stack behind alansbrain.com.

- **11 nodes:** AudioMoth, birdnode, birdstation, Alan, GitHub, Cloudflare, Porkbun, Vercel, Anthropic, alansbrain.com, Visitor. **12 protocol-labeled edges** (USB, Icecast/HTTP, SSH, git pull, HTTPS + CDN, NS delegation, git push/API, Anthropic API, deploy hook).
- **birdnode is a real distinct device:** Raspberry Pi Zero 2 W running Icecast that sits between AudioMoth and birdstation. Earlier drafts (and the issue description) omitted it. The correct audio chain is AudioMoth → birdnode (Icecast) → birdstation (BirdNET pull from localhost Icecast).
- **Tap-to-explore:** clicking a node opens a bottom-sheet panel with what/role description and "connection chips" that jump to connected nodes. Edge highlighting on node select (active 0.9 opacity, inactive 0.06).
- **Dual layout:** percentage-based positions with separate `d:` (desktop, 5/4 canvas) and `m:` (mobile, 7/10 canvas) coordinate sets; `positionGraph()` runs on every resize.
- **Privacy-safe:** no IPs, ports, credentials, or internal network topology in any panel. Public-facing URLs and generic architectural descriptions only.
- **"Stack" nav tab:** added as a top-level link (not inside Explore dropdown) to all 15 HTML pages — both desktop `.nav-links` and the mobile overlay. `techstack.html` gets `class="active"`.

---

## 2026-06-01 — Observatory: clickable stat cards, Wikipedia link UX, richer extract

- **Clickable stat cards:** "Life list" card smooth-scrolls to the life list section;
  "Latest" card opens the bird card modal for that species. Both use `data-action`
  delegation wired in `initObservatory()`; keyboard-accessible (Enter/Space). Cards
  only become interactive when there's data (life list loads async).
- **Wikipedia link moved to top of card:** previously the "via Wikipedia ↗" link was
  at the bottom of the card, below the stats grid — hard to reach on mobile. It now
  appears just below the scientific name. The photo is also wrapped as a link to
  Wikipedia so tapping the image works too. Footer div removed.
- **Richer bird extract:** `truncateExtract` now returns up to 3 sentences (≤ 500 chars)
  instead of just one, naturally surfacing range, habitat, and behavior info from
  Wikipedia's lead paragraph.
- **Assets:** `style.css?v=obs10`, `observatory.js?v=obs10`.

## 2026-06-01 — Observatory polish + Pulse citation fix

Cosmetic and UX pass on the Observatory page, plus one Pulse data fix.

- **Subtitles:** Birds tab shows "What is the source of all that chirping?!" in the
  page hero tagline; switching to the Trains tab dynamically updates it to "I like
  trains." (`TAGLINES` map in `observatory.js`, wired into `initTabs()`).
- **Bird card photo:** changed from `aspect-ratio:16/9` + `object-fit:cover` to
  `max-height:200px` + `object-fit:contain` + `background:var(--bg)` — the full
  bird is now visible rather than cropped. Skeleton placeholder updated to match.
- **Bird card stats grid:** replaced the three teal chips (×N detections · first
  DATE · last TIME) with a 2×2 comic-book character-profile grid: **Heard Here**
  (×N), **Best ID** (peak confidence%), **First Heard** (date), **Last Heard**
  (date · time). Last Heard now shows date + time instead of time only.
- **Bird card description filter:** generic Wikipedia descriptions that begin with
  "species of …" (e.g. "species of bird", "species of owl") are silently dropped —
  they add nothing useful.
- **Bird card extract word-wrap:** `truncateExtract()` now finds the last space
  before 200 chars so it never cuts mid-word.
- **Sort controls:** `<select>` dropdowns added to the period species grid heading
  and the life list heading — **Recent / Most heard / Least heard**. State tracked
  in `state.periodSort` / `state.lifeSort`; re-renders on change without refetch.
  `renderLife()` extracted from `loadLife()` so both the sort handler and the
  initial load share the same render path.
- **Pulse citations:** `renderSectionSources()` now shows `c.title || c.source`
  (article headline first) instead of `c.source || c.title` (source label first),
  so section Source links show the article title rather than "PA Governor" etc.
- **Assets bumped:** `style.css?v=obs8`, `observatory.js?v=obs8`.

## 2026-06-01 — Observatory timeline + species search

Period selector and live search for the "Heard today" species grid.

- **`GET /api/detections/grouped?start=&end=&min_confidence=` (`birdstation/bird_api.py`):**
  groups detections by species for any local date range — returns `{common_name,
  scientific_name, count, best_confidence, first_heard, last_heard}` per species,
  ordered newest-last-heard first. Uses `date(timestamp)` directly (pipeline writes
  naive local time). 5 new tests in `test_species_endpoint.py`; all 12 tests pass.
- **Period selector (`observatory.html`, `observatory.js`, `style.css`):**
  four pill tabs above the species grid — Today / Yesterday / This week / This month.
  "Today" re-renders from the already-loaded `/api/today` data (zero extra fetches);
  other periods call the new grouped endpoint. Heading updates to "Heard yesterday"
  etc. Switching tabs clears the search input. Manual ↻ refresh also refreshes the
  current period if it's not Today. Stat cards always reflect today's numbers.
- **Species search:** a search input at the right of the period bar filters the
  loaded species list client-side on every keystroke — no refetch. Matches
  `common_name` or `scientific_name` (case-insensitive). Shows "No species match
  '…'" when no results.
- **Assets bumped:** `style.css?v=obs7`, `observatory.js?v=obs7`.
- **Box step needed:** `git pull` + `sudo systemctl restart birdapi` to pick up
  `/api/detections/grouped`.

## 2026-06-01 — Bird cards steps 1–3: API endpoint, Wikipedia helper, quick-card modal

Implemented the first three steps of the "comic-book" bird cards plan
(`PLAN-observatory-cards.md`), all independently testable.

- **`GET /api/species/{name}` (`birdstation/bird_api.py`):** new endpoint returning
  per-species detection history — `total_detections`, `first_heard`, `last_heard`,
  a flat `confidence_series`, and a 24-slot `by_hour` histogram. Matches
  `common_name` OR `scientific_name`; defaults to `min_confidence=0.75`.
  Returns 404 when no detections clear the threshold.
- **`birdstation/test_species_endpoint.py`:** 7 standalone tests (pure stdlib,
  in-memory SQLite) covering common/scientific lookup, confidence filtering,
  not-found cases, hour bucketing, rounding. All green.
- **`bird-info.js`:** `BirdInfo.get(scientificName, commonName)` fetches Wikipedia
  Summary REST API (scientific name first, common as fallback), caches in-memory
  and localStorage (30-day TTL), checks `data/bird-overrides.json` for hand-tuned
  entries, returns `null` on total failure. Returns `{photo, photo_full,
  description, extract, url, title, attribution}`. CC BY-SA attribution baked in.
- **`data/bird-overrides.json`:** empty `{}` placeholder; populate per-species
  to pin a better photo or custom fact text.
- **Quick-card modal (`observatory.js`, `style.css`, `observatory.html`):**
  - Tapping any `.obs-species` or `.obs-lifer` card opens a modal (bottom sheet
    on mobile, 420 px centered on desktop ≥ 600 px), animated slide-up.
  - Shows: bird photo (16:9, `object-fit: cover`), common + scientific name,
    Wikipedia description tagline, first-sentence extract, teal detection chips
    (×N detections · first DATE · last TIME), "via Wikipedia ↗" attribution link.
  - Skeleton shimmer while both fetches are in-flight (`Promise.allSettled`).
  - Degrades gracefully: if Wikipedia is unavailable, shows name + local stats
    only; if the box is offline, shows name + Wikipedia facts only.
  - Close: × button, backdrop click, or Escape. Keyboard-accessible
    (`role="button"`, `tabindex="0"`, Enter/Space to open).
  - Event delegation on the grid containers (no per-card listeners).
  - Assets bumped: `?v=obs6` on all three Observatory assets.
- **Box step needed:** `git pull` + `sudo systemctl restart birdapi` to pick up
  the new `/api/species/{name}` endpoint. Test: `python3 birdstation/test_species_endpoint.py`.

## 2026-06-01 — Train privacy: approved-only public, CLI vetting, weekly purge

The fixed detector started recording **us talking** near the mic. Train clips
are inherently privacy-sensitive, so the public Observatory is now **default-deny
on `verdict='train'`** — nothing is visible or playable until a human confirms
it's a train. (PR #6 + follow-up.)

- **Public gate (front-end, ships via Vercel + API, takes effect on box pull):**
  - `/api/trains/recent?approved=1` (verdict='train' only); the page requests it
    **and** re-filters client-side (`reviewed && verdict==='train'`) so an
    un-updated box can't leak.
  - `/api/trains/clip/{file}` → **403 unless the clip belongs to an approved
    train** — un-vetted audio isn't downloadable even by direct URL.
  - `/api/trains/today` approved-only; `/api/trains/clips[/count]` moved behind
    the API key. Stats expose `approved_total`/`approved_today`; public cards show
    "Confirmed trains / Today" (dropped the public "Unreviewed").
  - Note on the page: only human-confirmed events are shown. Assets → `?v=obs5`.
- **CLI vetting (`review_trains.py`):** walk the pending queue on the box, play
  each clip (ffplay/aplay/paplay, or `--no-audio`), record train/false/unsure
  straight to the DB. Chosen as the near-term workflow (web review UI is future).
- **Weekly purge (`purge_train_clips.py` + `purge-train-clips.{service,timer}`,
  Sun 04:00):** deletes rejected clips (clears their `clip_path`) and aged orphan
  files; **keeps** approved-train and still-pending clips. `--dry-run` supported.
- **Verified:** SQLite tests — a `false_positive` "conversation" clip is excluded
  from listing, blocked from download (403), and omitted from public counts;
  front-end renders only the approved train even if the API returns everything;
  purge keeps approved+pending, deletes rejected+old-orphans, clears paths.
- **Docs:** `PLAN-train-vetting.md` (incl. a "known trains improve detection"
  roadmap — threshold tuning from labels, schedule prior, acoustic fingerprint)
  and `PLAN-observatory-cards.md` (Wikipedia-at-runtime bird cards, decided).
- **Box steps handed over:** `git pull` + restart `birdapi`; classify the
  existing voice events (`UPDATE … verdict='false_positive'`); install the purge
  timer.

## 2026-06-01 — Life-list 75%/3-hits gate, bird DB reset, train detector fix

Three changes — one front-end-visible, two box-side.

- **Life-list gate raised & made repeat-based** (`birdnet_pipeline.py`):
  `LIFE_LIST_MIN_CONFIDENCE` 0.70 → **0.75**, plus a new `LIFE_LIST_MIN_HITS = 3`.
  A *new* species now joins `lifetime` only after **3 detections in one local day
  at ≥ 0.75** (counted via `date(timestamp)=date('now','localtime')`). Existing
  lifers just keep incrementing `total_detections`; sub-0.75 hits never count.
  Every detection ≥ 0.35 is still logged, so the page keeps visualizing all
  confident birds — the gate governs only the permanent list. Front-end matched:
  `MIN_CONFIDENCE` 0.70 → 0.75 in `observatory.js` (filter + `confClass` mid band
  + `?min_confidence=0.75`), note text updated, assets bumped to `?v=obs4`.
  Verified with a SQLite harness driving the real `parse_and_log` (2 hits → not
  listed; 3rd → listed; 0.50×5 → never; mixed 0.9/0.6/0.88 → not until a 3rd
  *confident* hit; existing lifer increments, no dup row; all rows still logged).
- **Bird DB reset script** (`birdstation/reset_birds.sh`): clears `detections` +
  `lifetime` only (stale entries from the pre-tuning era), backs up the whole DB
  first, and leaves **Pulse (`feed_*`) and `train_events` untouched** — they share
  `~/birdnet.db`. Stops/restarts `birdnet.service` around the wipe. Reset SQL
  dry-run against the real schema confirmed birds cleared, trains + Pulse intact.
  **Run on the box:** `cd ~/alans-brain && bash birdstation/reset_birds.sh`.
- **Train detector fixed** (`train_detector.py`) — root cause of 0 events found
  in the logs:
  1. **MP3 never decoded.** `stream_chunks` read the *encoded* Icecast MP3 bytes
     and reinterpreted them as int16 PCM (garbage) — the docstring even said
     "MP3 stream" while doing no decode. That's why every chunk read as a stuck
     loud "-4.9 dB whistle candidate" that never resolved. Now pipes the stream
     through **ffmpeg → mono s16le PCM** (same approach as the working BirdNET
     pipeline), relaunching ffmpeg on disconnect.
  2. **Wrong mount → HTTP 404.** Was reading `http://192.168.4.132:8000/backyard`
     (repeated 404s in the log); the bird pipeline reads `localhost:8000/backyard`
     fine, so switched to that.
  Also confirmed from the log that the **duplicate `traindetect.service` is gone**
  after the cutover restart (lines no longer doubled). Could not run the audio
  path here (sandbox lacks ffmpeg/numpy); `py_compile` passes and the logic mirrors
  the proven bird pipeline — **needs a real-stream check on the box** (restart the
  service, watch for a "Train event logged" line on the next passing train).

## 2026-05-31 — Observatory: cache-bust JS, Eastern time, mid-word wrap

Same-day follow-up after a fresh screenshot showed the previous iteration
hadn't taken effect, plus two real bugs.

- **Stale cached JS (root cause of "nothing changed"):** the confidence-gate
  iteration cache-busted `style.css` but *not* the `<script>` tag, so the live
  page ran the **old `observatory.js`** against the new HTML — old stat labels
  ("DETECTIONS / SPECIES (LIFE) / TODAY"), ungrouped list, a 36% bird showing.
  Fix: bump **both** assets together — `observatory.js?v=obs3` + `style.css?v=obs3`.
  Convention going forward: bump the query on *every* changed Observatory asset.
- **Timezone → Eastern:** detection times rendered in the viewer's local zone.
  The box runs UTC and writes **naive** ISO timestamps (no offset), so
  `parseTime` now appends `Z` to tz-less values (treats them as UTC) and all
  clock/date output renders in `America/New_York` (`OBS_TZ`). Train timestamps
  already carry an offset and are left untouched (no double-shift). Verified
  headless: `23:50 UTC → 7:50 PM` Eastern.
- **Mid-word wrap:** "Grasshopper Sparrow" broke as "Grasshoppe|r Sparrow" —
  swapped `word-break: break-word` for `overflow-wrap: break-word` (wrap at
  spaces) and render the text "Latest" value via `.obs-stat-value-sm` so
  two-word names fit the card.

## 2026-05-31 — Observatory: confidence gate, grouped species view, beautify

First post-launch iteration after seeing the page live on mobile.

- **Inflated numbers — root cause:** the BirdNET pipeline *logs* every detection
  ≥ 0.35 (lots of low-confidence noise — 36%/45% House Sparrows etc.), and the
  page counted all of it ("1980 today" == "1980 all-time"). **Fix:** the page now
  only shows birds **≥ 0.70 confidence** (the same gate the life list already
  uses on the writer side). Enforced two ways: `bird_api.py` got an optional
  `min_confidence` query param on `/api/today`, `/api/detections`, `/api/stats`
  (defaults to 0.0 → existing callers unaffected), and `observatory.js` passes
  `0.70` **and** filters client-side, so the page is correct whether or not the
  box has been redeployed with the param yet. Stats are now **derived from the
  filtered data** client-side (heard today / species today / life list / latest)
  rather than trusting the raw `/api/stats` totals.
- **Beautify (Birds):** "Today's detections" (a flat list repeating the same
  species dozens of times) → **"Heard today", grouped by species**: one card per
  species with count (×N), a colored confidence bar + pill (best-of-day), and
  last-heard time, sorted most-recent-first. Sets up the future hover/detail
  feature. Life-list rows gained the scientific name. Dead `.obs-row*` styles
  removed (the old flat list is gone).
- **Stale CSS:** the live page showed unstyled `.obs-*` blocks (cached
  `style.css` from before the deploy) — bumped the link to `style.css?v=obs2`.
- **Trains = 0 (NOT a front-end bug):** birds flow fine over the same shared
  API/DB, so `train_events` is simply empty — the detector isn't writing.
  That's **box-side/operational** (service or stream), can't be reached from the
  cloud session. Diagnostics handed to Alan (see note in ROADMAP / chat).
- **Deferred (logged):** hover species overview — a "comic-book" stat card with
  a photo + key facts, click-through to a fuller view.

## 2026-05-31 — Bird & Train Observatory — POC front end

Gave the BirdNET + train data its first home on the website: a new
`observatory.html` / `observatory.js` page that reads the birdstation GET
endpoints and renders them. Vanilla, `pulse-`-style patterns, `obs-` prefix.

- **One combined page, two tabs** (🐦 Birds / 🚂 Trains), kicked off by
  settling the roadmap's three open questions: combined (not split) page and
  **load-once + manual ↻ refresh** (no auto-polling — light on the home box).
  Shipped unlisted, then **wired in** the same session: a home Explore card
  (after Pulse) plus an Observatory entry in the site-wide Explore dropdown +
  mobile overlay across all 15 pages (scripted insert before "Personal
  Projects", active state on its own page).
- **Birds tab:** headline stat cards (`/api/stats` — total detections, life
  species, today, latest), today's detections feed (`/api/today` — species,
  scientific name, a color-coded confidence pill, clock time), and the life
  list (`/api/lifetime` — name, ×count, "since" date).
- **Trains tab:** event stat cards (`/api/trains/stats`) and recent events
  (`/api/trains/recent`) each with an inline **playable WAV clip**
  (`<audio preload="none">` → `/api/trains/clip/{file}`, filename derived from
  `clip_path` basename) and a review-verdict badge when present.
- **Resilience (mirrors pulse.js):** every section fetches independently via
  `Promise.allSettled`, so one endpoint failing — or the whole box being
  offline — degrades just that section to an offline/empty state. Confidence
  pill threshold reuses the pipeline's 0.70 "confident" gate.
- **Decisions:** confidence pill bands at 0.70 / 0.50; train timestamps are
  UTC-ISO (with offset) and detections are local-ISO (no offset) — `new Date()`
  handles both, so no manual TZ math. Built for iteration: modular per-section
  renderers, easy to split into separate Birds/Trains pages later.

## 2026-05-30 — Pulse: citations in the morning brief

Added source attribution to the daily brief.

- **birdstation (`pulse_digest.py`):** each item is now fed to Claude with its
  `feed_items.id`; the `DigestSection` schema gained `citation_ids: list[int]`.
  After `messages.parse()`, the script resolves those ids → globally-numbered
  `{n, title, url, source}` in first-seen order — **Claude never emits URLs**,
  so no hallucinated links. New `citations_json` column on `feed_digests`;
  `/api/digest` returns per-section `citations` plus a top-level `citations` list.
- **website (`pulse.js`, `style.css`):** each section renders a compact
  `Sources: [1] [2]` line of clickable links, and a numbered **Citations** list
  renders at the foot of the brief. Both **degrade silently** when citations are
  absent, so the front-end is safe to ship ahead of the backend.
- **Decision:** per-section `Sources:` line rather than inline `[n]` markers
  woven into the prose — robust (no need to assign numbers pre-generation),
  with inline markers left as a possible follow-up.

## 2026-05-30 — Fix: BirdNET detections silently dropped (CSV delimiter)

`birdnet_pipeline.py`'s `parse_and_log()` read BirdNET's CSV output with
`delimiter="\t"` (tab), but BirdNET emits **comma**-separated CSV — so every row
failed to parse into fields and no detection was ever written to the DB. Changed
the delimiter to `","`. First detection on restart: Gray Catbird, 77%. (BirdNET
detection itself was always working — American Robin 56%, Chipping Sparrow 47%
in manual tests — results were just discarded before the DB write.)

Imported into the repo on 2026-05-30 (see entry below) with the fix in place.

## 2026-05-31 — Citations UI polish; life-list confidence gate; roadmap

- **Pulse citations UI:** the per-section `Sources:` line now wraps (flex-wrap;
  was overflowing the card on mobile), and the bottom **Citations** list is a
  collapsible native `<details>`/`<summary>` (collapsed by default, click to
  expand, "Citations (N)").
- **BirdNET life-list gate:** added `LIFE_LIST_MIN_CONFIDENCE = 0.70` to
  `birdnet_pipeline.py` — detections still log at ≥ 0.35, but a species only
  joins `lifetime` at ≥ 0.70, so low-confidence noise can't create a lifer.
  (Optional cleanup of pre-gate lifers noted in `ROADMAP.md`.)
- **Roadmap:** added `ROADMAP.md` (committed) as the running to-do list, and
  wired it + the now-committed memory docs into `CLAUDE.md`'s bootstrap. Next-up
  item: the Bird & Train Observatory POC front end.

## 2026-05-31 — Cutover to run-from-clone; digest max_tokens fix

Ran the full birdstation cutover (clone at `~/alans-brain`, `/etc/birdstation.env`,
units installed from the repo, `traindetect.service` removed, `BIRD_API_KEY`
rotated). All services came up active on the clone'd code; pulse-fetch and the
observatory pipelines verified healthy.

First-run bug in the citations digest: `messages.parse()` returned
`parsed_output=None` because `max_tokens=4000` was too tight — adaptive thinking
plus the larger citations output truncated the JSON mid-stream (crashed on
`digest.sections`). Raised `max_tokens` to 16000 and added a `None` guard that
raises a clear error (with `stop_reason`) instead of an `AttributeError`.
Shipped via git-deploy (first real bugfix through the new pipeline).

## 2026-05-30 — Train detector: single-instance lock + duplicate unit disabled

The box had `train_detector.service` **and** `traindetect.service` both enabled
and active against the same script — two detectors reading the stream in
parallel. Disabled + stopped `traindetect.service` on the box (its unit file is
removed at cutover). A 60s-window pair scan of `train_events` found **no**
duplicate rows, so no data cleanup was needed.

Added an `flock`-based single-instance guard to `train_detector.py`
(`acquire_singleton_lock()` at the top of `run()`, lock at
`~/train_detector.lock`): a second copy now logs and exits cleanly instead of
double-processing. Cheap insurance against a stray duplicate unit recurring.

## 2026-05-30 — Imported the observatory writers (whole box now in repo)

Decision: bring the full Emmaus Observatory under git-deploy (not just Pulse).

- **Imported verbatim** into `birdstation/`: `birdnet_pipeline.py` (with the
  CSV-delimiter fix) and `train_detector.py` (FFT train-whistle detector).
- **Added their services** to `birdstation/systemd/`, re-pointed at the clone:
  `birdnet.service` (keeps the `birdnet-env` venv) and `train_detector.service`
  (keeps the `train-env` venv).
- **Duplicate unit found:** the box ran both `train_detector.service` and
  `traindetect.service` against the same script (two detectors writing
  `train_events` in parallel). Kept `train_detector.service` as canonical;
  cutover disables + removes `traindetect.service`.
- The repo now mirrors the entire box; every change is a tracked commit
  deployed via `git pull`.

## 2026-05-30 — birdstation imported into the repo (git-deploy, run-from-clone)

Brought the home server's code under version control and switched to a
`git pull` deploy model.

- **Imported verbatim** into `birdstation/`: `pulse_fetcher.py`, `pulse_enrich.py`,
  `pulse_digest.py`, `bird_api.py`, and `schema.sql` (full `birdnet.db` schema).
- **Templated systemd units** under `birdstation/systemd/` for **run-from-clone**
  (units point at `~/alans-brain/birdstation/*.py`) using
  `EnvironmentFile=/etc/birdstation.env` — no inline keys. One-time cutover guide
  in `birdstation/README.md`.
- **Citations backend** shipped *through* the new pipeline (first real
  git-deploy change): `pulse_digest.py` now feeds Claude each item's `rowid` as
  `id`, takes `citation_ids` per section, and resolves them to globally-numbered
  `{n, title, url, source}` (no model-emitted URLs); `feed_digests` gains
  `citations_json`; `/api/digest` returns per-section + top-level citations.
  Written against the **real schema** — importing-first caught that `feed_items`
  has no `id`/`link` column (PK is `url`, code uses `rowid`), which the earlier
  paste-block had wrong.
- **Decisions:** run-from-clone over copy-on-deploy (no drift); keys move to
  `/etc/birdstation.env`.
- **Security:** `BIRD_API_KEY` was exposed in chat during the unit dump (the
  redaction only caught `ANTHROPIC_API_KEY`) — flagged for rotation at cutover.
- **Pending:** confirm the real `pulse-enrich.timer` schedule; run the cutover.

## 2026-05-30 — Memory system committed; git-deploy proposed for birdstation

- Un-gitignored and committed `Current State.md` + `Build History.md` so **every**
  session (local *and* Claude Code on the web, which clones fresh) auto-bootstraps
  with project context instead of relying on local-only files.
- **Session ritual:** start → read `CLAUDE.md` + these two docs + the relevant
  `PLAN`; work → one feature/phase per chat; end → update both docs + commit.
  Carry the docs across days, not the chat.
- **Open proposal (not yet done):** move birdstation's Python (`pulse_fetch.py`,
  `pulse_enrich.py`, `pulse_digest.py`, `bird_api.py`, schema/migrations) into a
  `birdstation/` folder in this repo so changes are made via normal git and
  tracked here, with the box doing `git pull` + restart to deploy — instead of
  one-off paste-blocks. Preferred over granting SSH access from the ephemeral
  cloud session.

## 2026-05-29 — Pulse: daily AI "Morning Brief" (Phase 3)

A once-a-day Claude-written roundup atop the feed.

- **birdstation:** new `feed_digests` table; `pulse_digest.py` on
  `pulse-digest.timer` (daily 06:00 local, `Persistent=true`) reads the last 24h
  of *enriched* `feed_items` and writes a structured brief; skips days with <3
  items. Model **`claude-sonnet-4-6`** + adaptive thinking (once/day, so the
  reasoning cost is irrelevant and the synthesis reads noticeably better).
  Structured output via `messages.parse()` → `Digest{headline, sections[]}`
  (JSON, not markdown → no front-end parser). `GET /api/digest` serves the latest.
- **website:** "Morning Brief" card at the top of Pulse (`#pulse-brief`,
  hidden until populated), fetched independently of the feed so a digest miss
  never affects the list; styles under `.pulse-brief*`.
- **Decisions:** on-page only (no email infra); prose brief, per-item links
  deferred (delivered the next day as citations — see above).

## (Earlier) — Pulse Phases 0–2, and pre-Pulse pages

See `PLAN-pulse.md` for the original Pulse design (proxy → birdstation fetch,
per-source health, enrichment taxonomy, auto-delete). Pre-Pulse page history
(Spotify/setlist tools, task tracker, galleries, soundboards, etc.) is in
`README.md` and the `*Implementation.md` docs. Backfill dated entries here as
those areas are revisited.
