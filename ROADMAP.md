# Roadmap — Alan's Brain

> The running to-do list. Ask "what's on the list?" any time; we (re)prioritize
> here and keep it current. **Convention:** when a feature lands, move it to
> "Done (recent)" with a date and add the matching `Build History.md` entry.
> Detailed designs live in the `PLAN-*.md` docs; this file is the index + status.
>
> Status key: **▶ Next** · **◷ Soon** · **○ Later** · **✓ Done**

---

## ★ June Ship — systematic MVP review (active sprint)

A time-boxed pass to get the site **feature-complete for an MVP** worth linking on
socials, target **go-live ≈ end of June**. Full breakdown, phases, and checkboxes in
**`PLAN-june-ship.md`**. Scope locked 2026-06-14: **flagship = Pulse "interests +
events" feed**; Radio Station + Monte Cassino deferred to immediate post-launch.
Start order: cleanups/removals → flagship → content/themes (as assets land) →
**security review (launch gate)**. The items below remain the standing backlog; the
sprint draws from and extends them.

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
**Admin-tool workflow shipped 2026-06-11** — `admin.py box` + the **Trains / Box**
GUI panel one-click the pull → sort → calibrate → deploy → sync loop (see
`ADMIN.md` / `COMMANDS.md`), so the day-to-day no longer means remembering CLIs.
Still open: a **passphrase-gated web review page** (like `tasks.html`) so vetting
doesn't need SSH at all — reuse `POST /api/trains/{id}/verdict`, hold the key safely
(don't ship it in static JS), maybe add a key-gated `/api/trains/pending`. Then
the **"known trains improve detection"** loop: tune thresholds from labelled
events → schedule prior → acoustic fingerprint (details in the plan).

---

## ◷ Soon

### 3. Confidence-tuning follow-ups (life list)
- **Current gate (2026-06-08):** a new species joins after **3 detections at
  ≥ 0.85 within a rolling 24h window**, **one ~100% (≥ 0.995) hit** (instant), **or
  ≥ 8 detections at ≥ 0.70 all-time** (cumulative-evidence path, no time window — added
  2026-06-08 to catch persistent moderate-confidence birds like the Downy Woodpecker).
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
- **Watch (cumulative path, 2026-06-08):** the new ≥ 8 @ ≥ 0.70 all-time rule trades a
  little strictness for catching persistent moderate birds. Watch for the opposite failure —
  a consistently mis-IDed call (e.g. one species reliably confused for another at ~0.70+)
  could now accumulate its way onto the list. If that shows up, raise `LIFE_LIST_CUMULATIVE_HITS`
  / `LIFE_LIST_CUMULATIVE_CONFIDENCE`, or gate the cumulative path on `review_birds.py` labels.
  A cumulative-path lifer with no ≥ 0.85 hits also shows **no ×count badge** on the life list
  (the tally counts ≥ 0.85); revisit if that reads oddly.
- **Later:** per-species thresholds (some calls are easier to ID than others).
- **✓ Done (2026-06-10) — record *how* a species made the list.** `lifetime` now carries
  `qualified_via` / `qualified_at`; the pipeline stamps new lifers with the exact path, the
  one-shot `backfill_qualified_via.py` labels existing ones (incl. **`grandfathered`** for
  pre-rules lifers like the Grackle), `/api/species` returns them, and the bird card states it.
  See "Done (recent)". *(Still open if wanted: a cumulative "qualified N times" tally — counting
  non-overlapping qualifying events over time, not just the first/why.)*

### 3a. Train analytics — **foundation shipped 2026-06-08**, next additions below  (design: `PLAN-train-analytics.md`)
**Foundation done:** `GET /api/trains/analytics` (events → **passes**; Eastern hour / day /
day-of-week buckets + median headway) and a Trains-tab section — pass counts (Trains / Today /
Busiest hour / Typical gap), an hour-of-day chart, a per-day chart, and a day×hour heatmap.

**Next additions (queued 2026-06-08, all build on the pass + timestamp data):**
- **Headway over time / "next train usually around…"** — predictive: from the timestamps,
  surface the typical times trains come (and when one's "due"). Per-hour/day headway trend.
- **Duration & loudness distributions** — how long / how loud passes are (`duration_s`,
  `peak_db` already on every event); histograms + maybe a loudness-over-time view.
- **"Compared to usual"** — today's pass count vs. a trailing baseline ("8 trains today ·
  typically ~12"). Needs a baseline computation (shared idea with the birds backlog §3b).
- **Weather correlation** — join pass volume/timing against `weather.js` data
  (temp/wind/precip). The most *uniquely yours* one (stitches two home-grown systems); needs a
  weather-history join. Also tracked in §3b for birds — could share the join.

**✓ Done (2026-06-11) — folded trains into the Analytics tab** as a `🐦 Birds | 🚂 Trains`
switch (the train analytics no longer live on the Trains tab, which is now the raw
recent-events feed + method panel). Same change added **numbers on every bar** and a
**tap-any-chart detail popout** (the mobile read path, since hover tooltips don't fire on
touch). Front-end only; see "Done (recent)" + `Build History.md` (2026-06-11). The
remaining "Next additions" above (headway-over-time, duration/loudness, compared-to-usual,
weather) still want a box-side `/api/trains/analytics` expansion.
**✓ Period-scoped train analytics (2026-06-11):** `/api/trains/analytics` now takes
`start`/`end` (passes_today stays absolute); the Analytics→Trains period selector filters
the charts. Compute extracted to `birdstation/train_analytics.py` + `test_trains_analytics.py`.

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

- **2026-06-21** — Tech Stack **de-crowded** + icon credits, plus two small polish fixes.
  Reworked all 11 `techstack.html` node positions into a clean **two-column layout** (taller
  mobile canvas, `7/10`→`7/12`) so nothing overlaps — verified with a bounding-box harness at
  desktop + a 360px phone; the **alansbrain.com** node now uses the **Brain header icon**.
  Added **seven new Flaticon icons** (radar/observatory/api/visitor/coding/parrot/octopus,
  credited in `Attributions_for_Artists.txt`) and **wired them** — five Tech Stack nodes
  (`img/Icons/icons/Stack/`) plus the **Pulse**/**Observatory** page heroes + project cards
  (`Projects/`). (Drive was firewalled from the sandbox, so the PNGs came in via a GitHub
  branch upload; all verified as complete 512×512 PNGs before wiring.) Also fixed the
  **Xikipedia** description on Great & Free
  (it's the algorithmic Simple-Wikipedia feed, not an "xkcd parody wiki") and **eased the
  Starfield twinkle ~25%**. See `Build History.md` (2026-06-21).

- **2026-06-19** — June Ship **Phase 2: Space theme** — a new **Starfield** skin in the
  footer theme picker. Animated full-viewport canvas starfield (`starfield.js`) — drifting,
  twinkling parallax stars + the occasional shooting star — over the deep-space palette
  (`themes/starfield.css`). **Lazy-loaded only when the skin is active** (`ensureStarfield()`
  in `theme-switcher.js`), so zero overhead otherwise; honors `prefers-reduced-motion`
  (static field) and pauses on hidden tabs. Pure vanilla, no assets, front-end only. The
  "optional toggle" is the opt-in skin itself (like Quake II). See `Build History.md` +
  `PLAN-june-ship.md` Phase 2.

- **2026-06-19** — Mobile menu: the nav overlay now **scrolls instead of clipping** and
  the close ✕ stays reachable. Was `justify-content: center` with no scroll, so on a phone
  the top/bottom items ran off-screen unreachable; now top-aligned + `overflow-y: auto`
  with `padding-top` clearing the sticky nav. CSS-only in shared `style.css` (all pages).
  Plus **tap-the-backdrop + Escape to close** via a new shared `nav-menu.js` (loaded
  site-wide; augments the per-page hamburger toggle without re-binding it).

- **2026-06-17** — Weather: **"Best rest of week"** now excludes days past the current week
  (today→Sunday only), **Weather promoted into the top nav on every page** (was hidden while
  gated), and **renamed "My Week" → "Weather"** everywhere. `?v=w6`.

- **2026-06-17** — Weather: a **selectable hour-by-hour chart** in the drawer (pick
  Rain/UV/Temp/Wind/Cloud/Humidity → see the metric's shape + labeled peak, e.g. "rain
  100% at 3 PM", "UV peaks at noon"; replaces the unreadable per-activity score bars), plus
  **🌅 sunrise / 🌇 sunset / 🌙 moon phase** on the hero + drawer. `?v=w5`.

- **2026-06-17** — Weather: **drone + tanning scoring** grounded the same way (drone =
  wind/gusts-dominant per DJI specs + rain/fog/cold caps; tanning = UV-led + clear sky +
  warmth) so e.g. 29 mph gusts → Fair not Good and a hot high-UV day → Perfect tanning; a
  plain-language **"How these scores work"** explainer drawer (ℹ️ button); and the
  **passphrase gate removed — My Week is now public**. `?v=w4`.

- **2026-06-17** — Weather drawer + scoring (Alan's review): metrics no longer repeat in
  the detail drawer (single shared **Conditions** block; activities show rating · window ·
  bars · tap-to-open breakdown), **Good** recolored teal → **blue** (distinct from green
  Perfect), and the **running score** rebuilt around apparent temp + **dew point** (gentle
  bands, UV dropped, heat/cold caps) so e.g. 78°F/43%/0% reads **Good (81)** not Fair (64).
  `?v=w3`. Drone/tanning scoring left for a later pass.

- **2026-06-17** — Observatory polish (Alan's formatting notes): **life-list cards no
  longer break names mid-word** (vertical card: full-width name + `×count · since` meta
  row), the **"Almost a lifer" shelf moved into a popout** (compact trigger banner →
  modal reusing the life-list shell), and **breathing room** added to the Birds panel
  (reclaimed shelf space + margin bumps). Front-end only, `?v=obs38`/`obs30`; verified
  with a render harness + screenshots.

- **2026-06-17** — June Ship: **bird-page fixes + weather "My Week" redesign** (front-end
  only, no box deploy). Bird page (`?v=obs37`/`obs29`): cards now **always populate** —
  `openBirdCard` retries `/api/species` at the 0.60 preserve floor when the 0.85 fetch
  404s (was leaving a Wikipedia-only stub for moderate/cumulative-path lifers); the
  Wikipedia extract no longer chops at a single-letter abbreviation; and the 24-column
  hour analytics chart prints a number **only on the peak bar** (the rest live in the
  tap-to-detail popout) so "big numbers run into each other" is gone. Weather (`?v=w2`):
  full overhaul from the cramped 7-column strip to a **hero "Today" card + "best this
  week" chips + roomy 6-day list** with a single detail drawer at all widths; location
  switching verified (also clears the yesterday cache). Verified with a headless render
  harness + desktop/phone screenshots. Weather stays passphrase-gated until public.

- **2026-06-11** — Train analytics: **period scoping.** `/api/trains/analytics` gained
  optional `start`/`end` (same Eastern→UTC window as the bird analytics; `passes_today`
  stays absolute), the Analytics→Trains period selector now filters the charts, and the
  pass-grouping compute moved to a dependency-free `birdstation/train_analytics.py`
  (+ `test_trains_analytics.py`, 17 checks). **Needs a box deploy** (`git pull` + restart
  `birdapi`); old box ignores the params (all-time) until then. Also fixed the `[hidden]`
  CSS bug that had left the period bar visible-but-inert in Trains mode (`?v=obs35`/`obs26`).

- **2026-06-11** — **Admin tool: modular Box + Git panels + CLI catalog.** `admin.py` gained a
  `box` group (pull clips / calibrate / deploy profile / sync verdicts / status / restart, all
  config-driven via `admin-config.json` and each printing the exact ssh/scp it runs) and a `git`
  group (commit & push from the GUI — publish artwork/photos without a terminal). The GUI got a
  reusable **`CommandPanel`** base + **BoxPanel**/**GitPanel** (new panels are ~20 lines). Docs:
  **`ADMIN.md`** (architecture + "Adding a panel") and **`COMMANDS.md`** (the commands-I-forget
  cookbook). Advances ▶ Next #3 (vetting without raw CLI). Also same day: Trains tab **"Last
  train" highlight + loudness/duration meters** so the raw feed isn't bare (`?v=obs34`/`obs25`).

- **2026-06-11** — Observatory: **unified Analytics + chart polish.** A `🐦 Birds | 🚂 Trains`
  switch on the Analytics tab folds train analytics in (the Trains tab is now just the raw
  recent-events feed + method panel — convention now matches birds). Plus **a number on every
  bar** (`compactNum`, headroom-scaled so labels don't clip) and **tap-any-chart → enlarged
  detail popout** with full labels/numbers (also the mobile read path — hover tooltips never
  fire on touch). Front-end only (`?v=obs33` / `obs24`), reuses `/api/analytics` +
  `/api/trains/analytics`; verified with a builder harness (15) + a DOM/fetch integration
  harness (18). Lands the §3a "fold trains into the Analytics tab" idea.

- **2026-06-10** — Observatory: **durable "how it qualified" record + grandfathered lifers.**
  From the Common Grackle reading "✓ On the life list" above three unmet paths (it joined before
  the 0.85 bar). `lifetime` gained **`qualified_via`** (`instant_100` / `burst_24h` /
  `cumulative_70` / `grandfathered`) + **`qualified_at`**, migrated idempotently by
  `birdnet_pipeline.init_db()` + new `bird_api.ensure_life_schema()`. The pipeline stamps new
  lifers; **`backfill_qualified_via.py`** (new one-shot) labels existing ones; `/api/species`
  returns both. The bird card (`?v=obs32`) now leads with the durable fact — "Made the life list
  by *<path>* on *<date>*", or for grandfathered "joined under an earlier, lower confidence bar"
  — and reframes the three rows as "current standing". 30 box tests (7 new) + a backfill
  integration run + a JS caption harness. **Deploy:** box `git pull` → restart `birdnet`+`birdapi`
  → run `backfill_qualified_via.py`. Closes the §3 "record how a species made the list" item.

- **2026-06-10** — Observatory Birds polish from Alan's notes (front-end only, no box change;
  `?v=obs31`/`obs23`): (1) lifer cards now wear a small green **★ in the corner** instead of the
  "★ Lifer" text pill; (2) the bird card gained a **"How it makes the life list" breakdown** —
  the three qualifying paths, each with this bird's count and a ✓ on the path(s) it currently
  meets (`lifeListBreakdown()`), replacing the old one-line status and surfacing *which* method
  qualifies it; (3) the **"N of M on the life list" summary moved to its own line** under the
  heading (was crowding the "100% only" toggle); (4) **"confidence" is grounded** where the
  numbers are — a caption over the bird-card recent-hits ("Each detection's confidence — how
  sure BirdNET was") + a `title` on every % pill. Lands the Observatory items in §3.

- **2026-06-08** — **Train analytics: count trains + when** (largely lands §3a). New
  `GET /api/trains/analytics` groups detection clips into **passes** (clips within ~5 min =
  one train) and returns Eastern hour/day/day-of-week buckets + median headway. The Trains tab
  now leads with **pass** counts (Trains / Today / Busiest hour / Typical gap) and three charts —
  "When trains pass" (hour), "Trains per day", and a "When across the week" day×hour heatmap —
  reusing the `obs-an-*` analytics styling (`?v=obs30`). Fixes the "221 clips looks like a lot"
  by counting de-duped passes. Also same-day: auto-detection went live + post-deploy fixes
  (Eastern "today" count, dropped the per-row audio-private note). See `Build History.md`.

- **2026-06-08** — Observatory: **life list cumulative-evidence path + "Lifer" tags + scoring
  explainer.** From a note that the life list was too restrictive (the Downy Woodpecker — ~10
  detections averaging ~76%, never 3×≥85% in 24h — never qualified). Added a **third
  qualifying path** (box): a species also lists once it has **≥ 8 detections at ≥ 0.70
  all-time, no time window** (`birdnet_pipeline.py`; gate now fires on any hit ≥ 0.70). A
  one-shot **`backfill_life_list.py`** catches up species that already qualify. `/api/species`
  now returns cumulative progress. Front-end (`?v=obs28`/`obs22`): a **"★ Lifer"** tag on
  species-grid cards + a **"★ N of M on the life list"** filter-aware summary in the period
  heading, an updated bird-card status line (both routes), and a collapsible
  **"ℹ️ How confidence & the life list work"** explainer on the Birds tab. Verified on temp
  DBs. **Deploy:** box `git pull` → restart `birdnet`/`birdapi` → run `backfill_life_list.py`
  once. Addresses §3 below (life-list tuning).

- **2026-06-07** — **Automatic train detection (auto-publish + strike-off).** Flipped from
  default-deny manual vetting to post-moderation, per Alan: trains flow onto the page in
  real time and a human only strikes off false positives. **One process, two stages** —
  `train_detector` keeps its loose trigger as a "grab a clip" gate and runs the calibrated
  `train_horn_detector` **inline** to confirm (auto-publish `verdict='train'`, audio private)
  or reject. `train_confirm.py` becomes a manual backfill / `--rescore` utility (re-applies a
  new profile to past machine calls; never touches human decisions). `sync_train_verdicts.py
  reject` strikes off; page badges auto-detected vs ✓ confirmed (`?v=obs26`/`obs20`). Method
  docs/panel updated to the auto model. **Substantially addresses ▶ Next #3** (automated
  detection / "known trains improve detection" loop). Deploy = one-time rollout (install
  `librosa scipy` in `train-env`, drop in the profile, restart, `--rescore`). Verified the
  confirm cascade on a temp DB; live streaming path needs a box check. See `Build History.md`.

- **2026-06-07** — **Train detection: methodology doc + on-page panel.** Profile is strong
  (94% passes / 96% precision on 131 horns + 109 negatives), so documented and surfaced the
  method: `birdstation/DETECTION-METHODS.md` (acoustic method, calibration pipeline, the
  repeatable refinement loop, confirmed-trains-preserved-for-analytics, two-detector reality +
  convergence, caveats) and a collapsible **"ℹ️ How these are detected"** panel on the Trains
  tab driven by `data/train-method.json` (`loadTrainMethod()`, `.obs-method*`, `?v=obs25`/`obs19`).
  Next: **ship via PR to `main`** (box `git pull` + `restart birdapi`; site deploys the panel),
  then the **train analytics view** (§3a) — now unblocked: the pass-grouping (clips within N min =
  one train) is the counting logic, and the vetting bridge banks categorized, timestamped data.

- **2026-06-06** — **Train vetting → Observatory page bridge.** The P2 corpus clips are the
  live detector's `train_events`, so `sync_train_verdicts.py` carries the sorted-folder
  labels back into the DB (no second review): `emit` (PC) → CSV → `apply` (box) sets
  verdict/category by exact-filename match. `train_events` gained `category` (fine class:
  plane/vehicle/gunshot/… for future analytics) and `published` (default 0) — a confirmed
  train **counts and shows** on the page but its **audio stays private** until explicitly
  published (backyard mic). API clip gate now needs `verdict='train' AND published=1`;
  `observatory.js?v=obs24` shows events without a dead player when private; migration is
  idempotent at `birdapi` startup and preserves existing public clips. Advances ▶ Next #3
  (vetting without per-clip SSH) and unblocks the gated train analytics (§3a). Verified on a
  temp DB. See `Build History.md` (2026-06-06).

- **2026-06-06** — Emmaus Observatory **P2 train horn study**: an offline AudioMoth horn
  detector (`train_horn_detector.py`, now version-controlled) plus the new
  **`build_horn_profile.py`** corpus-calibration pass. Point the profiler at confirmed-horn
  and no-train folders → it derives the real horn band from positive/negative spectral
  contrast, calibrates the tonality/duration/gap thresholds against the labelled corpus
  (reusing the detector's own feature fns), and emits diagnostic plots + a ready-to-paste
  parameter block + `horn_profile.json` that the detector auto-loads. Both are manual
  birdstation CLIs (no unit). This is the offline-study analogue of ▶ Next #3's "known
  trains improve detection" loop (the *live-stream* `train_detector.service` vetting/tuning
  loop is still future). Generated profiles are gitignored; the param block is the durable
  record. Verified end-to-end on a synthetic corpus. See `Build History.md` (2026-06-06).
  **Same day, management pass:** the profiler now reads a **category-folder corpus**
  (`--corpus`: `trains/` = positives, every other folder = a labeled negative class), has a
  **`--check`** readiness census, and ends with an **end-to-end validation** (real detector
  over the labeled clips → recall/precision + per-class false-alarm breakdown; it caught a
  duration-bound bug, fixed). Plus **`birdstation/HORN-CORPUS-GUIDE.md`**, a plain-English
  **Windows 11** runbook (sort in VLC/Audacity → calibrate → read accuracy → deploy).

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
