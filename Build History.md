# Build History

> Chronological record of feature work and decisions. Append a dated entry
> after landing each feature; keep `Current State.md` in sync.
>
> **Backfill note:** this log was started 2026-05-30. Pre-2026-05 feature
> history lives in the per-feature implementation docs (`Spotify Setlist Tools
> Implementation.md`, `Task Tracker Write-Back Implementation.md`) and the
> `PLAN-*.md` files — pull entries forward into this log as you revisit them.

---

## 2026-06-17 — Weather: "rest of week" only, nav link on every page, renamed "Weather"

Three quick follow-ups (`weather.js` + all page navs, `?v=w6`):

- **"Best this week" → "Best rest of week."** It was scanning the full rolling 7-day
  forecast, so it could surface *next* week's days (e.g. next Tue). `renderBestOfWeek` now
  caps the pool to **today through the coming Sunday** (`locDow` → `daysLeft = ((7-dow)%7)+1`,
  week = Mon–Sun) and labels it "Best rest of week" (or "Best today" when only today's left).
  Verified with a harness: a cool next-week Tue that scored best is correctly excluded.
- **Weather promoted into the top nav on every page.** It was only in the nav on
  `weather.html`/`tasks.html` (hidden elsewhere while the page was gated). A
  `<a href="weather.html">` now sits right after **Home** in both the desktop `.nav-links`
  and the mobile overlay on **all** pages (scripted insert after each Home anchor; the navs
  otherwise vary by page).
- **Renamed "My Week" → "Weather"** everywhere user-facing (nav links, the page `<h1>`/
  section title, `<title>`), per Alan.

---

## 2026-06-17 — Weather: hour-by-hour metric chart + sun/moon on the page

From Alan's note on the drawer ("hard to tell what the graph shows / where the 100% rain
falls; I want to pick a metric and see the what & where; also add moon phase + sunrise/sunset")
(`weather.js`/`weather.html`/`style.css`, `?v=w5`).

- **Selectable hour-by-hour chart.** The confusing per-activity score bars (colored by
  rating, no axis) are gone. The drawer now has one **"Hour by hour"** chart with a metric
  selector — **🌧 Rain · ☀️ UV · 🌡 Temp · 💨 Wind · ☁️ Cloud · 💧 Humidity** — that plots
  the picked metric for every upcoming hour, **highlights + labels the peak**, has an hour
  axis, and a plain caption ("Rain chance peaks at **100%** around **3 PM**", "UV index peaks
  at **9** around **12 PM**"). Defaults to **Rain** when there's any rain that day (the
  "when does it rain?" case), else Temp. So you can see at a glance *when* it rains and
  *when/where* UV is highest. `WX_SERIES` + `wxState` + `renderHourlyMetric()`/`hourlyChartHTML()`;
  `.w-hr-*` styles. Gracefully shows "not available this far out" for days past the ~48h
  hourly window. (Per-activity sections keep their rating + best window + tap-to-open breakdown.)
- **Sun & moon, broadly "weather."** The hero (Today) and each day's drawer header now show
  **🌅 sunrise · 🌇 sunset · 🌙 moon phase** (emoji + name), from OWM daily `sunrise`/`sunset`/
  `moon_phase`. `sunMoonHTML()` + `locClock()` (tz-aware) + `moonPhaseInfo()` (8 phases);
  `.w-sunmoon` styles. First cut — easy to extend (moonrise/set, golden hour) later.

**Verification:** `node --check`; stubbed-DOM harness drove `renderWeather` + `openWeatherDrawer`
+ a metric switch (Rain → UV), rendered with the live stylesheet, and screenshotted (shared with
Alan) — confirmed the 100% rain peak and the UV peak read clearly and the hero sun/moon shows.

---

## 2026-06-17 — Weather: drone/tanning scoring, "how it works" explainer, gate removed

Follow-up to the running-score work — same research-grounded treatment for the other two
activities, a user-friendly explainer, and the page went **public** (`weather.js`/`weather.html`/
`style.css`, `?v=w4`).

- **Drone scoring grounded in reality.** Rebuilt around what keeps a small drone safe/legal:
  **wind 35 · gusts 25 · precip 25 · temp 15**, with caps for rain (not waterproof), fog /
  low visibility (VLOS — hourly uses real `visibility`, daily assumes clear unless foggy),
  near-limit sustained wind (>22 mph), and below-freezing (LiPo batteries fade). Wind/gusts now
  dominate per DJI wind-resistance specs (~20–24 mph / Beaufort 5). Effect: the sample day's
  **29 mph gusts → Fair 61** (was a too-rosy Good 74); a clear calm 30°F → Good 75 (not Perfect);
  >24 mph gusts → Poor. Visibility dropped from the additive score (daily forecast lacks it) and
  is a cap instead.
- **Tanning scoring grounded in reality.** **UV 35 · clouds 25 · temp 25 · wind 15** — UV leads
  (it's what actually tans you; higher = faster tan *and* burn), then clear skies, lying-out
  warmth (~78–92°F), and a light breeze; rain and too-cold (<58°F) cap it. Removed the old
  "temp < 70 → 0" hard floor and the band that *penalized* high UV. Effect: the hot, high-UV,
  mostly-clear sample day → **Perfect 88** (was a wrong-feeling Fair 57).
- Shared `computeDroneScore()` / `computeTanScore()` (day + hourly agree); breakdown weights
  updated; `drone_vis`/`tan_pop` band tables removed.
- **"How these scores work" explainer.** New **ℹ️ How these scores work** button (under the
  legend) opens a drawer (reuses the detail-drawer shell) that, in plain language, shows the
  Perfect/Good/Fair/Poor scale (colored chips) and what drives each activity — including the
  *why* ("a dry 80° beats a humid 80°", "higher UV burns faster — wear sunscreen"). `infoDrawerHTML()`
  / `openInfoDrawer()`; `.w-info-*` styles.
- **Passphrase gate removed — My Week is now public.** Dropped the `auth-gate` markup,
  `auth.js`, and the `initAuthGate(...)` wrapper (init runs directly now); `#protectedContent`
  no longer hidden. (It's already linked in the main nav.)

**Verification:** `node --check`; scoring sanity tables for a spread of drone (wind/gust/temp)
and tanning (UV/cloud/temp) cases; the explainer + updated detail drawer rendered via the
stubbed-DOM harness and screenshotted (shared with Alan).

---

## 2026-06-17 — Weather: drawer de-dup + rating colors + running-score overhaul

Three fixes from Alan's review of the detail drawer (`weather.js`/`style.css`, `?v=w3`):

- **No more repeated metrics in the drawer.** Each activity (Running/Drone/Tanning) used
  to print its own factor rows — so temperature, wind, and rain appeared three times, the
  bulk of the "overload." Now a single **`Conditions` block** (a 2-col metric grid + the
  UV "tap for info" expandable, built by `conditionsHTML()`) sits once at the top, and each
  activity shows only its **rating · best window (+ during-window chips) · hourly bars ·
  a tap-to-open score breakdown** (where the per-factor detail now lives). `renderDrawerActivity`
  lost its `factorRows`/`uvValue` params; the window chips dropped humidity (it's in
  Conditions); `drawerRow()` removed (orphaned).
- **"Good" recolored green → blue.** Perfect (green `--green #34d399`) and Good (teal
  `--teal #2dd4bf`) were nearly the same hue. Good is now **blue (`--blue #38bdf8`)** across
  every weather rating surface (pills, hero tiles, week dots, best-of-week chips, drawer
  window + hourly bars, legend) — a clear 4-step ramp green → blue → amber → red.
- **Running score reworked (research-based).** The old model was harsh and double-counted:
  a flat feels-like cliff (76–80°F → 10/20), humidity scored *separately* on top of
  feels-like (which already includes it), a 20-pt **UV** weight that tanked sunny runs, and
  a hard "feels > 90 → poor" guard. Rebuilt around **apparent temperature + dew point**
  (the runner's real mugginess metric, ≤55°F dry … ≥70°F oppressive — std running guidance)
  with gentle bands: **feels-like 40 · precip 25 · wind 18 · dew point 17 = 100**, UV
  dropped, plus dangerous-heat (feels ≥ 92 → ≤ Poor) and bitter-cold (≤ 24 → ≤ Fair) caps.
  Heat+humidity still hurts correctly — a muggy 85° reads as a higher feels-like *and* a
  higher dew point, a dry 85° doesn't. Shared `computeRunScore()` (used by the day card +
  hourly window) + `getDewPoint()`/`dewPointF()` (prefers OWM `dew_point`, computes from
  RH as fallback). Verified across a sanity table: 78°/43%/14mph/0% **Fair 64 → Good 81**
  (Alan's example), dry 85° → Good 66, muggy 85°→feels-92 → Poor 30, 40° clear → Perfect 90,
  72° + 60% rain → Fair 50.

**Verification:** `node --check`; a stubbed-DOM harness drove the real `renderWeather` +
`openWeatherDrawer` → preview with the live stylesheet → screenshot (shared with Alan);
running-score sanity table printed for a range of temp/humidity/wind cases. Drone & tanning
scoring left as-is (Alan flagged only running); their thresholds can get the same dew-point
treatment later if wanted.

---

## 2026-06-17 — Observatory polish: life-list wrapping + "Almost" popout + breathing room

Follow-up to Alan's two formatting notes (screenshots): life-list entries wrapping to
ugly mid-word breaks, and the main Birds page feeling cramped ("everything right on top
of each other"). All front-end (`observatory.html`/`observatory.js`/`style.css`,
`?v=obs38`/`obs30`).

- **Life-list cards no longer break mid-word.** Each `.obs-lifer` shared a flex row
  between the name (left) and the count + "since …" date (right, `white-space:nowrap`);
  the date squeezed the name column so long names broke mid-word ("Least Flycat\ner",
  "Red-bellied Woodpec\ker"). The card is now a **vertical stack** — name (full width,
  wraps at spaces), sci name, then a compact meta **row** ("×21  since Jun 14"). Names
  wrap cleanly at the space ("Red-bellied" / "Woodpecker") or fit on one line. CSS only.
- **"Almost a lifer" moved into a popout** (Alan: "put the almost lifers into their own
  pop-out window, sort of like the life list"). The big inline shelf (heading + caption
  + 5 cards) is replaced by a **compact trigger banner** — "🎯 Almost a lifer (N) · on
  the cusp of the life list →", shown only when there are candidates — that opens a
  **modal reusing the life-list shell** (`#obs-almost-modal`, the `.obs-life-overlay`
  classes + `obs-life-open` toggle; `openAlmostModal`/`closeAlmostModal`/`almostModalOpen`,
  wired into the Escape chain and the bird-card scroll-lock so a card opened from an
  almost row layers correctly). `renderAlmost()` now drives the trigger + both counts
  instead of the inline section; the card markup + `computeAlmostLifers` logic are
  unchanged, and the `obs-almost` card-tap delegation still works (the container kept
  its id, just moved into the modal).
- **Breathing room on the Birds panel.** Reclaiming the inline shelf's vertical space
  plus margin bumps — `.obs-method` `6/18` → `14/24`px, `.obs-period-bar` top `20` →
  `28`px — separate the stats / Almost trigger / explainer / period selector / grid.
- **Verified** with a stubbed-DOM render harness (drove the real `renderLife` /
  `renderAlmost`) → preview HTML with the live stylesheet → desktop + zoom screenshots
  (shared with Alan) confirming names wrap cleanly and the popout/trigger read well.

---

## 2026-06-17 — June Ship: bird-page fixes + weather "My Week" redesign

From Alan's notes (3 screenshots): bird cards that "do not fully populate," analytics
still too crowded ("big numbers on columns run into each other"), and the weather page
"just ugly to look at" — overhaul it, take a page from better-built weather apps, and
make sure changing location actually works.

**Bird page (`observatory.js` + `style.css`, `?v=obs37`/`obs29`):**
- **Cards now fully populate.** A species opened from the life list / "almost a lifer"
  shelf that had **no detections at the 0.85 display floor** (a moderate-confidence or
  cumulative-path lifer) made `/api/species?min_confidence=0.85` **404**, so the card
  fell back to a Wikipedia-only stub — no stats grid, no recent hits, no life-list
  breakdown (exactly what the Junco/Oriole screenshots showed). `openBirdCard` now
  retries at the **0.60 preserve floor** when the display-floor fetch comes back null,
  so the card populates for any bird with any detection. **Front-end only** — the
  existing API already honors the `min_confidence` param, so no box deploy needed.
- **Extract no longer chops mid-phrase.** `truncateExtract` treated the period in a
  single-letter abbreviation as a sentence end (e.g. "…Mexico, I. s." on the Orchard
  Oriole). It now skips boundaries where the word before the period is one letter.
- **Analytics decluttered.** The 24-column hour chart printed a count on *every* bar —
  far too narrow, so large/adjacent numbers collided even on desktop (the earlier
  < 600px hide only helped phones). Now `hourBarsHtml` prints the count **only on the
  peak (busiest) bar**; every bar's number still lives in the tap-to-detail popout and
  the hover tooltips. One number per chart → zero collisions at any width. (Daily chart
  unchanged — few bars; its < 600px label hide stays.)

**Weather "My Week" redesign** (`weather.html`/`weather.js` + `style.css`, `?v=w2`):
- Full visual overhaul from the cramped 7-column strip (which jammed temps + tiny
  detail rows into ~100px columns) to a **hero + clean week list** (Alan picked this
  direction). New structure:
  - **Hero "Today" card** — big temperature, condition + "feels like", H/L · wind ·
    humidity, the vs-yesterday line, and the **three activity verdicts** (🏃 Run /
    🛸 Drone / ☀️ Tan) as tiles with a rating-colored top accent + best-window time.
  - **"Best this week" chip row** — one chip per activity naming its best day + window
    (replaces the old cross-week summary line), tap-through to that day.
  - **6-day list** — roomy tappable rows: day/date · icon · hi/lo · three activity
    emoji+colored-dot indicators. Tap any day/chip/hero → the **detail drawer** (now
    the single detail surface at *all* widths; the cramped inline desktop expand is gone).
- **Location switching:** the change handler was already sound (set localStorage →
  clear forecast cache → forced refetch); also clear the **yesterday cache** on switch
  so nothing location-specific lingers. Selector unchanged and verified wired.
- **Removed** the now-dead `renderUnifiedStrip`/`renderUnifiedDetail`/`renderHourlyMini`/
  `summaryHTML`/`findBestDay`/`isMobile`/`RATING_ICONS` and all the `.w-strip`/`.w-day*`/
  `.w-detail*`/`.w-hourly-mini*`/`.w-summary*` CSS; page container narrowed 820→620px
  for the single column. Scoring/window/drawer logic is unchanged (kept the tested core).
- **Verification:** `node --check` on both JS files; a headless render harness (stubbed
  DOM) confirmed the hero/best/week markup is well-formed and fully populated; rendered a
  full preview with the real stylesheet and **screenshotted it at desktop + phone widths**
  (shared with Alan) to confirm the look before deploy.

**Deploy:** all front-end, no box change. (Weather stays passphrase-gated until it's
public — Alan: "not until it looks and feels good.")

---

## 2026-06-14/15 — June Ship: systematic MVP review kicked off (Phase 1 + 1b)

Started a time-boxed "systematic review of alansbrain.com" to reach a
feature-complete MVP worth linking on socials (target go-live ≈ end of June).
Planning doc **`PLAN-june-ship.md`** (phased, checkboxed, effort/owner-tagged),
linked from a **★ June Ship** banner in `ROADMAP.md`. Scope locked with Alan:
flagship new build = **Pulse "interests + events" feed**; Radio Station + Monte
Cassino deferred to immediate post-launch. This session completed **Phase 1
(cleanups/removals)** and **Phase 1b (weather overhaul)** — everything buildable
without Alan-supplied assets.

**Phase 1 — cleanups/removals/verbiage:**
- Removed the `"Built with HTML, CSS, and JS — the way the web was meant to be"`
  footer line (+ dangling `<br>`) across **all 14 pages**.
- Removed the Stack `"Privacy-safe — no IPs…"` note + its orphaned `.ts-privacy` CSS.
- Pride & Identity tagline → "art, voices, and resources" (dropped "that matter").
- Removed the arbitrary **USB** glossary definition on Stack (kept the "USB audio"
  edge label); unwrapped its two `T('usb',…)` clickable terms. Glossary now 31 entries.
- Bird **life-card text overflow** fixed — `min-width:0` + `overflow-wrap` on the
  species name, life-list rows, and bird-card stat grid cells (`?v=obs27`).
- **"Almost a lifer" → any metric:** added the **cumulative route** (6–7 of 8
  all-time hits at ≥0.70) alongside the burst route; `loadAlmost` fetches both
  windows in parallel, `computeAlmostLifers` merges + dedupes to the nearer path
  and labels each card's scope ("1 more in 24h" / "2 more all-time"). Logic verified
  with a harness (exclusions, dedup, closest-first). `?v=obs36`.
- **Analytics crowding:** large all-time counts collided the inline hour/day bar
  numbers on phones — hide them < 600px (the tap-to-detail popout is the mobile read
  path), keep on desktop. `?v=obs28`.
- **Stack:** enlarged nodes 56→64px (52px mobile) with icons/glyphs + `NODE_R`
  (32 / 26) to match; removed the label `max-width`+ellipsis truncation so full
  names show.
- **Process:** added a `CLAUDE.md` convention to keep `techstack.html` current when
  the stack changes.
- **Deferred (asset-gated):** custom icons for the home Pulse/Observatory cards +
  the Stack emoji nodes — the existing icon set has nothing suitable.

**Phase 1b — weather ("My Week") overhaul** (`weather.html`/`weather.js` + new
`api/weather.js`):
- **Security:** the OpenWeatherMap key was **hardcoded in client JS** (scrapable).
  Added a Vercel serverless proxy **`api/weather.js`** that reads the key from the
  `OPENWEATHER_API_KEY` env var (endpoint whitelist guards SSRF); the client calls
  `/api/weather` and the key is gone from the browser. **✅ Done 2026-06-18:** Alan set
  `OPENWEATHER_API_KEY` in Vercel and rotated the old client-exposed key.
- **Real "vs. yesterday":** replaced the hack that cached *today's* forecast and
  relabeled it — now a true historical comparison via One Call 3.0 `day_summary`
  (through the proxy), timezone-aware date, cached per day/location.
- **Timezone bucketing:** the hourly "best window" math + day/date labels now read in
  the forecast **location's** timezone (`locHour`/`locDow`/`locDateStr` from
  `timezone_offset`), not the viewer's. `updateTimestamp` stays viewer-local.
- **Cleanups:** collapsed the duplicate `scoreInverse()` into `scoreRange()` (15
  callers); made the drone daily **visibility** honest in the score breakdown
  ("clear (assumed)" / "reduced (fog)" with real points, not a fake `20/20 —`);
  replaced the `prompt()`/`alert()` custom-location flow with an **inline form**
  (validation, Enter-to-save, inline errors).

**Verification:** `node --check` on all changed JS; CSS brace-balanced; logic
harness for the almost-a-lifer merge; tz-helper math sanity-checked. The
**visual** items (analytics mobile labels, Stack node sizing, the weather inline
form) and the **weather proxy** (needs the env var) want a check on the preview
deploy — flagged in the handoff. Calibration of the weather scoring thresholds is
deferred until Alan flags specific ratings that feel wrong.

---

## 2026-06-11 — Train analytics: period scoping (box + front-end)

Follow-up to the period-bar fix: Alan — "period scoping is important for proper
analytics." Made the Trains analytics honor the period selector instead of being
all-time.

- **Box (`/api/trains/analytics`):** added optional `start`/`end` (full UTC datetime
  strings, end exclusive — the **same** Eastern→UTC window the bird `/api/analytics`
  already gets from the period selector). Passes whose start falls in `[start, end)`
  feed the period buckets (`by_hour` / `by_dow_hour` / `by_day` / `total_passes` /
  `busiest_hour` / `peak_day` / headway). **`passes_today` stays absolute** (Eastern
  today), so the "Today" card is meaningful at any period. No window = all-time, so an
  **old box ignores the new params** (FastAPI drops undeclared query params) and simply
  serves all-time until deployed — graceful, no breakage.
- **Refactor for testability:** the pass-grouping + bucketing moved out of the endpoint
  into **`birdstation/train_analytics.py`** → `compute_train_analytics()` (no FastAPI
  import), and `bird_api.trains_analytics` is now a thin DB-read + delegate. Robust
  import (`from train_analytics import …` with a `birdstation.` fallback) covers
  run-from-`birdstation/` and repo-root. New **`test_trains_analytics.py`** (17 checks):
  pass grouping (5 clips → 3 passes), Eastern hour bucketing, window scoping,
  passes_today-absolute-under-a-different-window, no-window all-time, empty range, and
  headway median. All pass here (no box needed — the module is dependency-free).
- **Front-end (`observatory.js?v=obs35`):** the Analytics period selector now applies to
  **both** datasets — `loadAnalytics` computes the window once and routes it to
  `loadTrainAnalytics(start, end)` (which appends `?start=&end=`), and `setAnMode` keeps
  the period bar visible for trains with a reframed note ("counts follow the selected
  period; 'Today' is always today"). Verified the URL windowing + routing with a stub.
- **Deploy:** this one **needs the box** — `cd ~/alans-brain && git pull && sudo
  systemctl restart birdapi` (picks up `bird_api.py` + the new `train_analytics.py`).
  Site auto-deploys `?v=obs35`; until the box restarts, trains analytics are all-time.

---

## 2026-06-11 — Fix: Analytics period bar stayed visible (and inert) in Trains mode

`setAnMode('trains')` set `#obs-an-period-bar`'s `hidden` attribute (train analytics
are all-time, so the Today/Week/Month selector shouldn't apply), but the bar stayed
on screen: `.obs-period-bar { display: flex }` (author CSS) **overrides** the UA
`[hidden] { display: none }`, so the attribute never won. Result on desktop: the
period filters showed in Trains mode and clicking them re-fetched the same all-time
data — "nothing changes." Fix is a one-line normalize, `[hidden] { display: none
!important; }`, so the attribute always wins (also hardens every other
`hidden`-toggled element — panels, the daily-chart sections, the "Last train" card).
CSS-only; `style.css?v=obs26`. (If period-scoped *train* analytics are wanted later,
that's a box change — add `start`/`end` to `/api/trains/analytics`; tracked in
ROADMAP §3a.)

---

## 2026-06-11 — Trains tab "Last train" + meters, and a modular admin tool (Box + Git panels, CLI catalog)

Two threads from Alan: (1) the now-raw Trains tab "looks a little too bare," and
(2) a better, GUI-driven workflow for vetting/calibrating birdstation — plus a
catalog of the CLI commands he always forgets — and the admin tool should be
**modular/extensible** so future site-admin surfaces (artwork, photos, soundboard
clips, commit-to-GitHub) drop in easily.

**Trains tab — "Last train" highlight + visual rows** (`observatory.js?v=obs34` /
`style.css?v=obs25`, front-end only):
- A **"🚂 Last train"** card above the feed — the most recent pass as a big relative
  time ("2h ago") + date·time + duration/loudness chips + the auto/confirmed badge.
  Answers "when did the last train go by?" at a glance.
- Recent-event rows now render **loudness + duration meters** (labeled bars,
  normalized across the shown set) instead of plain tags, so the feed reads
  visually. Rows are sorted newest-first defensively (not trusting API order).
  Verified with a DOM/fetch harness (11 checks: latest picks the most recent *train*
  with false-positives excluded, meters present, loudest≈full bar, published-only
  audio, auto/confirmed badges).

**Admin tool — modular Box + Git panels over `admin.py`** (the bigger ask):
- **`admin.py` gained two command groups.** `box` wraps the birdstation/train
  workflow — `status` (SSH health: services + train counts + pending + profile),
  `pull --match GLOB` (scp clips → local `_incoming`), `open-corpus --make`,
  `check`, `calibrate`, `deploy-profile` (scp + restart detector), `sync emit|apply`
  (the verdicts bridge, dry-run aware), `restart`, `deploy`, `inspect`. `git` wraps
  `status`/`pull`/`push`/`commit`/`sync` so the GUI can **commit & push to GitHub
  without a terminal** ("save my new artwork/photos"). Every `box` command **prints
  the exact ssh/scp/python it runs**, so the log doubles as a cheat-sheet. Two shared
  helpers: `run_cmd()` (print-then-run) and `load_admin_config()`.
- **Config-driven:** `admin-config.json` (gitignored; `admin-config.example.json`
  committed) holds host/paths/venv; defaults match the `C:\horn` layout in
  `HORN-CORPUS-GUIDE.md`.
- **GUI: a reusable `CommandPanel` base** (header + toolbar + log already wired to
  `admin.py`) — new panels are ~20 lines. Added **BoxPanel** (workflow buttons + a
  pull-glob entry + a dry-run checkbox) and **GitPanel** (message box + Commit&Push).
  `PANELS = [Soundboard, Media, Box, Git]`.
- **Docs:** **`ADMIN.md`** (architecture + a full "Adding a panel" recipe — the
  extensibility the user asked for) and **`COMMANDS.md`** (the categorized CLI
  cookbook — deploy/services, the horn vet→calibrate→deploy loop, train-event
  verdicts, bird life-list backfills, DB peeks, Pulse, git/site deploy).

**Verified:** `node --check` + the train harness (11); `py_compile admin.py` +
live smoke tests (`git status` runs locally; `box pull --dry-run` prints the exact
`scp`; dispatch help; empty-message guard); and — since tkinter isn't installable
here — a faithful tkinter-stub harness that instantiates BoxPanel/GitPanel and
asserts they build the right `admin.py` arg lists (`box pull --match …`,
`box deploy-profile [--dry-run]`, `git sync -m …`) with the empty-message guard.
`.gitignore` updated. The `box`/`git` ssh/scp paths can't be exercised against the
live box from here — they need a real run on Alan's PC.

---

## 2026-06-11 — Observatory: unified Analytics (🐦 Birds | 🚂 Trains switch), tap-to-detail charts, numbers on bars

Brought train analytics into the Analytics tab so it follows the same convention as
birds, per Alan: "the analytics page should have a switch for me to look at train
data … all train data, including advanced analytics, lives under the train tab,
which does not follow the convention." Plus two cross-cutting polish asks — every
bar graph shows its number, and any chart can be tapped to see it in detail
(parity with what the bird analytics offers, and the fix for mobile, where hover
tooltips never fire). Front-end only — no box change (reuses the existing
`/api/analytics` and `/api/trains/analytics`). `?v=obs33` / `style.css?v=obs24`.

- **`🐦 Birds | 🚂 Trains` dataset switch** (`.obs-an-modes`, `state.an.mode`) at the
  top of the Analytics tab. `setAnMode()` toggles the section sets, swaps the note,
  and reloads. `loadAnalytics()` branches on mode: birds → `/api/analytics`
  (unchanged, period-scoped); trains → `loadTrainAnalytics()` → `/api/trains/analytics`.
  Each mode caches its last response (`state.an.birds.data` / `state.an.trains.data`)
  and `state.an.data` mirrors the active one for the detail popout.
- **Train analytics moved off the Trains tab.** The Trains tab is now the **raw feed**
  — "Recent events" + the "How these are detected" panel (mirrors the Birds tab being
  the raw/today view). The pass-count stat cards + the hour / per-day / day-of-week×hour
  charts now live under Analytics → 🚂 Trains, reusing the same `obs-an-*` chart
  containers (IDs unchanged, relocated in the HTML). The Trains note points at the
  Analytics tab. Train analytics are all-time (the box endpoint isn't period-scoped),
  so the period selector is hidden in Trains mode and the note says "All-time".
- **Numbers on every bar.** New shared `hourBarsHtml()` / `dailyChartHtml()` (birds +
  trains) print the count above each bar via `.obs-an-bar-num`; bars now scale to
  `BAR_HEADROOM_PCT` (86%) so the top label never clips. `compactNum()` keeps inline
  labels short (1.3k / 12k) so a busy 24-column chart stays legible; the per-day chart
  only prints numbers for ≤ 31 days (a year stays uncluttered — the detail popout
  labels them all). Tooltips/detail still show the full number.
- **Tap any chart → detail popout** (`#obs-chart-modal`, reuses the life-modal shell).
  Each chart heading has a ⤢ button and the bar charts are themselves tappable
  (`.obs-an-tappable`); `openChartDetail(key)` builds an enlarged, fully-labeled
  version from the active mode's cached data — every axis tick, a full number on each
  bar (`detailBars`), the complete heatmap with counts in the cells (`detailHeatmap`,
  shown for the train day×hour), and the full (un-truncated) leaderboard. Charts scroll
  horizontally inside the sheet. This is also the **mobile** read path (no hover on
  touch). Leaderboard rows inside the popout still open the bird card (layered on top);
  Escape closes the topmost modal.
- **Responsive:** the mode pill, chart-head + ⤢ row, and the popout all collapse to a
  bottom sheet on mobile / centered (≤ 760px) on desktop; detail charts scroll-x.

**Verified:** `node --check`; a sandboxed builder harness (15 checks — compactNum,
bar numbers, peak class, ≤31-day number gate, detail full-numbers + every-column
axis, heatmap cell numbers); and a DOM+fetch integration harness (18 checks) driving
the real `loadTrainAnalytics` → stat cards / charts and `openChartDetail` for every
train key, proving the `state.an.data` wiring. CSS braces balanced. Lands the
"original idea (still open)" in ROADMAP §3a (fold trains into the Analytics tab via a
toggle). Not yet exercised against the live box from here; deploys via Vercel.

---

## 2026-06-10 — Observatory: durable "how it qualified" record (qualified_via) + grandfathered lifers

Follow-up to the bird-card breakdown. The breakdown computed which of the three
life-list paths a bird *currently* meets — which read as a contradiction for a
**grandfathered** lifer like the **Common Grackle**: on the list, but (because it
joined back when the bar was 0.75, before the 0.85 floor went in 2026-06-03) it
meets none of today's paths, so the card showed "✓ On the life list" above three
unmet rows. Alan asked how to handle it; we chose the **durable box record** (vs. a
front-end-only note) so the card can state the truth definitively.

- **Schema (`lifetime`):** two idempotent columns — `qualified_via`
  (`instant_100` / `burst_24h` / `cumulative_70` / `grandfathered`) and `qualified_at`
  (ISO timestamp of the qualifying hit). Added by **`birdnet_pipeline.init_db()`** and a
  new **`bird_api.ensure_life_schema()`** (mirrors `ensure_train_schema`), so a plain
  `git pull` + restart of *either* service migrates the live DB.
- **Pipeline writes them for new lifers** — `birdnet_pipeline.py` already derived the
  qualifying reason for its log line; now it also stores the path code + timestamp on
  the `INSERT INTO lifetime`.
- **`/api/species` returns `qualified_via` + `qualified_at`** — read with `SELECT *` +
  `dict().get()` so a DB that predates the columns yields `None` rather than 500-ing.
  `/api/lifetime` already `SELECT *`s, so the fields flow through there too.
- **Backfill (`backfill_qualified_via.py`, new one-shot):** labels existing lifers from
  their detection history (instant → burst → cumulative → else **grandfathered**),
  mirroring `backfill_life_list.find_qualifiers`' order. Idempotent (only NULL rows),
  backs up the DB first, `--dry-run` / `--no-backup`. The Grackle → `grandfathered`.
- **Front-end (`observatory.js` `?v=obs32`):** `lifeListBreakdown()` now leads with the
  durable fact — "Made the life list by *<path>* on *<date>*" for a recorded method, or
  for grandfathered: "On the list from before the current rules — it joined under an
  earlier, lower confidence bar." The three rows are reframed as "its standing under
  today's three paths" (not pass/fail). Falls back to the old inference when
  `qualified_via` is absent (pre-backfill / older API), so nothing breaks before deploy.

Verified: 30 box tests pass (7 new — classifier incl. the grandfathered Grackle, the
`qualified_via` passthrough, and the absent-column safety); a temp-DB integration run of
the backfill CLI (old schema → migrate → label instant/burst/cumulative/grandfathered →
idempotent re-run); and a JS caption harness across all paths. **Deploy:** box `git pull`
→ restart `birdnet` + `birdapi` → run `backfill_qualified_via.py` once. Closes the
ROADMAP §3 "record how a species made the list" item.

---

## 2026-06-10 — Observatory Birds: lifer star, life-list breakdown on the card, less-crowded heading, "confidence" grounded

Four front-end tweaks to the Birds tab from Alan's notes, all in `observatory.js`
(`?v=obs31`) + `style.css` (`?v=obs23`) — **no box change** (everything reuses what
`/api/species` and `/api/lifetime` already return):

- **Lifer star instead of "★ Lifer" text.** The species-grid cards dropped the
  word-pill for a small green **★** tucked into the card's top-right corner next to
  the ×count (`.obs-species-meta` group + `.obs-lifer-star`; the old `.obs-lifer-tag`
  pill CSS is gone). Less clutter, same at-a-glance "this one's a lifer" read.
- **"How it makes the life list" breakdown on the expanded bird card.** Replaced the
  single status line with a three-row mini-panel (`lifeListBreakdown()`,
  `.obs-bcard-method*`) — the three qualifying paths, **each with this bird's count**
  and a green **✓** on the one(s) it currently meets:
  - **One detection at ~100%** — count of ≥ `PERFECT_CONFIDENCE` (0.995) hits, all-time
    (derived client-side from `confidence_series`).
  - **3 detections at 85%+ in 24h** — the live rolling-24h count (`hits_24h`).
  - **8 detections at 70%+, all-time** — `hits_cumulative`.
  A lifer reads "✓ On the life list" + "Currently meets the path(s) marked ✓"; if it
  qualified earlier and is quiet now (no path met live) the caption honestly says so
  rather than contradicting itself. A non-lifer sees the same three rows as progress
  ("2 / 3", "5 / 8"). This shows *which* method(s) qualify it and folds each method's
  count onto the card, per the note. (Pinpointing the exact *historical* trigger, and a
  cumulative "qualified N times" tally, would need a box-side change — record the
  qualifying method on the `lifetime` row at insert; deferred, noted in ROADMAP §3.)
- **Less-crowded heading.** The "★ N of M on the life list" summary moved out of the
  `<h2>` (where it sat right beside the "💯 100% only" toggle) onto its **own caption
  line** under the heading row (`.obs-lifer-summary` is now block-level, hidden via
  `:empty` when there's nothing to show).
- **"Confidence" grounded where the numbers are.** Visitors meet "confidence" cold in
  the explainer title. Now the bird card's recent-hits list carries a caption — "Each
  detection's confidence — how sure BirdNET was — newest first" — right above the %
  pills, and every `confPill` gained a `title="BirdNET confidence"`, so the term has
  context the first time it's seen.

Verified the breakdown logic on a standalone harness across five scenarios (lifer via
each path, the Downy-style cumulative case, a quiet "qualified earlier" lifer, and a
not-yet-lifer); `node --check` clean. Addresses the Observatory items in ROADMAP §3.

---

## 2026-06-08 — `train_inspect.py`: forensic "why was this train missed?" tool

After a real train ~10:30 PM didn't appear on the dashboard, Alan wanted a way to
replay what the detector saw and decided. New `train_inspect.py` (pure stdlib, on
the box): give it an Eastern time (`"10:30pm"`, `22:30`, `"2026-06-08 22:30"`, or
nothing = now) and a ±window, and it lists the `train_events` candidates around it —
**confirmed AND rejected** — with verdict, peak dB, duration, and clip (incl. an
on-disk/purged marker; `--play` plays each). Box clock is UTC, so it converts
Eastern → UTC for you. The output pinpoints the failure stage: **nothing in the
window** = a stage-1 trigger miss (no clip was ever saved — the horn didn't trip
the loose trigger); a candidate with **✗ rejected** = the calibrated confirm turned
down a real horn (add it to the corpus + recalibrate); **✓ train** = it was detected,
so a no-show is a display/timezone issue. Empty windows also print the nearest
candidate before/after. Verified locally (windowed view, empty/trigger-miss case,
all time-parse forms). Documents the one real gap: a stage-1 miss leaves no audio
to replay (the stream isn't continuously recorded).

---

## 2026-06-08 — Train analytics: count trains (passes) + when they pass

Alan: "I'm interested in counting trains and when they pass through more than
anything else." Built the pass-grouped analytics that turn raw detection *clips*
into actual *trains*.

- **`GET /api/trains/analytics`** — approved train events grouped into **passes**
  (clips within `pass_gap_min`, default 5 min, are the same train — one pass can
  fire several horn-blast clips), then bucketed **Eastern**: `by_hour[24]`,
  `by_day{date:count}`, `by_dow_hour[7][24]`, plus `total_passes`, `passes_today`,
  `busiest_hour`, and the **median headway** (typical wait between trains). All in
  Python (train volume is low); detected_at parsed via `fromisoformat` → Eastern.
  Verified the grouping (5 clips incl. a 3-clip burst → 3 passes) + buckets.
- **Trains tab** (`observatory.js?v=obs30`): `loadTrainAnalytics()` replaces the
  clip-count stat cards with **pass** counts — *Trains / Today / Busiest hour /
  Typical gap* — and renders **"When trains pass"** (hour-of-day), **"Trains per
  day"** (hidden until >1 day), and a **"When across the week"** day×hour heatmap,
  reusing the bird-analytics CSS (`obs-an-*`). This also fixes the "221 looks like a
  lot" confusion: the headline is now passes (de-duped), not clips.

The detector logs confirmed the live cascade is healthy (real-time "Candidate
train" / "Candidate false_positive"). Needs `birdapi` restarted on the box; site
auto-deploys `?v=obs30`. Largely lands ▶ Next #3a (train analytics).

---

## 2026-06-08 — Trains: post-deploy fixes (Eastern "today" + drop per-row audio note)

After auto-detection went live (PR #8), the Trains tab showed **0 today** despite
many Jun-8 events, and every row carried a "🔒 audio kept private" label.

- **"Today" now means today in Eastern.** `/api/trains/stats` (`today_count`,
  `approved_today`) and `/api/trains/today` used a **UTC-day** `detected_at LIKE
  '<utc-date>%'`, so once UTC rolled past midnight (evening Eastern) all
  Eastern-today events fell off → 0. New `eastern_today_bounds()` computes the UTC
  window for the Eastern day and queries `datetime(detected_at) >= datetime(?) AND
  < datetime(?)` — same fix the bird endpoints already use. `train_events.detected_at`
  is **tz-aware** UTC ISO (`…+00:00`); verified SQLite `datetime()` parses the offset
  and the window counts correctly.
- **Dropped the per-row "audio kept private" note** (`observatory.js?v=obs29`): a
  confirmed train with no published audio now just shows its time/duration/dB —
  audio-private is the default, not worth labeling on every row. Audio still renders
  only when `published=1`.

Both verified locally (SQLite window test; `node --check`). **Needs `birdapi`
restarted on the box** to take effect; the site auto-deploys `?v=obs29`.

**Note on the 221 "confirmed trains":** that count came from `train_confirm.py
--rescore` scoring the **backlog** of 565 pending candidates the live detector had
saved since May 31 (221 confirmed, 344 rejected) — not a single day. It also counts
*events/clips*, and one train pass can span several clips (>30s apart), so the real
number of train *passes* is lower; pass-level dedup is part of the planned train
analytics view. Worth spot-checking a sample and striking off any false positives.

---

## 2026-06-08 — Life list: cumulative-evidence path + "Lifer" tags + on-page scoring explainer

From a handwritten note: the life list felt **too restrictive** — a backyard regular
like the **Downy Woodpecker** (heard ~10× averaging ~76%, never 3× ≥85% in 24h) never
qualified — plus a wish to **tag lifers on the species grid** and to **document how
confidence is calculated** on the page. Alan picked the **cumulative-evidence** approach
(over an average-confidence or probabilistic combination).

- **New third qualifying path (box, `birdnet_pipeline.py`).** A species now joins the
  life list on **any** of: (1) 3 hits ≥ 0.85 in a rolling 24h, (2) one ~100% hit, or
  (3) **≥ `LIFE_LIST_CUMULATIVE_HITS` (8) detections at ≥ `LIFE_LIST_CUMULATIVE_CONFIDENCE`
  (0.70) all-time, no time window**. Reasoning: many independent moderate detections are
  very unlikely to *all* be misfires, so the weight of evidence lists a persistent bird the
  24h rule kept missing. The gate is now evaluated for any hit ≥ 0.70 (was ≥ 0.85), so a
  moderate hit can be the one that crosses the cumulative bar. The 0.70 floor sits above the
  0.60 preserve floor, so pure noise still can't pile up. Tally semantics unchanged
  (`total_detections` derived live as the ≥ 0.85 count) — a cumulative-path lifer with no
  ≥ 0.85 hits shows no count badge (the front-end already hides `×0`).
- **One-shot backfill (`birdstation/backfill_life_list.py`).** The pipeline only evaluates
  the gate on a *new* detection, so existing persistent species wouldn't list until next
  heard. This scans `detections` and inserts the missing `lifetime` rows for anything that
  already qualifies under any path (cumulative ≥ 8 @ ≥ 0.70, one ~100%, or — retroactively —
  ≥ 3 @ ≥ 0.85 all-time). Backs up the DB first; `--dry-run`. Run once on the box after
  deploy so the Downy (and friends) list immediately.
- **`/api/species/{name}` surfaces both paths** (`bird_api.py`): added `hits_cumulative`,
  `life_list_cumulative_hits`, `life_list_cumulative_confidence` alongside the existing
  `hits_24h` / `life_list_min_hits`, so the bird card can show progress on whichever route
  is closer.
- **Front-end (`?v=obs28`/`obs22`).** (a) **"★ Lifer" tag** on species-grid cards already
  on the life list — `lifeNameSet()`/`isLiferGroup()` + a re-render of the grid once
  `/api/lifetime` lands (the two fetch in parallel) — plus a **"★ N of M on the life list"**
  summary in the period heading that respects the active search / 100%-only filters (counts
  the displayed species). (b) **Bird-card status** now reads "Not yet a lifer — N of 3
  confident hits (≥85%) in 24h, or M of 8 lifetime hits (≥70%)". (c) **On-page explainer** —
  a collapsible "ℹ️ How confidence & the life list work" panel on the Birds tab (reusing the
  Trains panel's `.obs-method*` styling) covering BirdNET's score (model certainty, not a
  calibrated probability), the display/preserve floors, and the three life-list paths. The
  life-list popout note was updated to mention the cumulative path too.
- **Verified on temp DBs:** the backfill qualification logic (Downy via cumulative, a
  confident bird via the retro 0.85 path; a sub-0.70 bird and a 7-hit bird correctly
  excluded) and the live gate (lists the Downy on its 8th ≥0.70 hit, never lists a
  below-floor bird).
- **Deploy:** box `git pull` → restart `birdnet.service` + `birdapi` → run
  `backfill_life_list.py` once. Site deploys the page assets.

## 2026-06-07 — Automatic train detection (auto-publish + strike-off), one-process cascade

Pivoted the train pipeline from **default-deny manual vetting** to **automatic
detection with exception review**, at Alan's direction ("I'd much rather have data
flow in automatically and live with a small margin of error"). The privacy reason
for pre-vetting is already solved by the `published` flag, so we auto-publish the
*event* while keeping *audio* private.

- **One process, two stages (cascade).** Rather than add a second detector daemon,
  folded the calibrated confirm into the live detector (Alan's call — "why two
  processes?"). `train_detector.py` keeps its loose trigger as a cheap high-recall
  "grab a clip" gate, then runs `train_horn_detector.process_file()` (the tuned,
  ~96%-precision detector + `horn_profile.json`) **inline**: confirmed →
  `verdict='train'`, auto-published (audio private, `published=0`); not a horn →
  `verdict='false_positive'`. `reviewed` stays 0 (machine call). Guarded import +
  profile auto-load at startup; if librosa/scipy are missing it writes events
  *pending* and warns. `train_horn_detector.py` is thus a shared library, not a
  second process.
- **`train_confirm.py` demoted from a timer to a manual utility** (the 5-min
  `train-confirm.timer/.service` were never shipped — removed): backfills pending
  events and, with `--rescore`, re-applies a fresh profile to past **machine**
  decisions (reviewed=0) after a recalibration. **Never overwrites human decisions
  (reviewed=1).**
- **Exception review / strike-off.** `sync_train_verdicts.py reject <clip|folder>…`
  sets `verdict='false_positive'`, `reviewed=1` → off the page (weekly purge
  removes the audio). Rejected candidate clips are **kept until the purge** so a
  recalibration + `--rescore` can recover a wrongly-rejected train.
- **Page (`?v=obs26`/`obs20`).** Client filter relaxed from "reviewed && train" to
  just `verdict='train'` (auto + human-verified show; only false positives hidden);
  `renderVerdict` badges **● auto-detected** vs **✓ confirmed**; the note now reads
  "detected automatically … a human strikes off the occasional false positive."
- **Docs/method synced to the new model:** `DETECTION-METHODS.md` (cascade,
  post-moderation, the convergence is now *done*), `data/train-method.json` + the
  on-page panel (auto-publish + ~1-in-25 strike-off margin), README (rollout: install
  `librosa scipy` in `train-env`, deploy the profile, restart, `--rescore`).

**Verified** the confirm cascade end-to-end on a temp DB + synthetic clips: horn →
`train` (category=train, audio private), noise → `false_positive`, missing skipped,
human `reviewed=1` row untouched, and `--rescore` re-applies a profile. `train_detector.py`
compiles; the live streaming path itself needs a box check (can't drive the stream
from here). **Deploy is the one-time rollout above** — until then events still flow
the old way. Big step toward ▶ Next #3's "automated detection" goal.

---

## 2026-06-07 — Train detection: methodology doc + on-page "how it works" panel

With the profile strong (94% passes / 96% precision on 131 horns + 109 negatives),
shifted from tuning to **documenting and surfacing** the method, per Alan's ask to
make detection transparent on the page and establish a refinement pipeline.

- **`birdstation/DETECTION-METHODS.md`** — the canonical, plain-English record: the
  acoustic method (band → tonality → blasts → passes), the calibration pipeline
  (`build_horn_profile.py`), the **repeatable refinement loop** (pull → sort →
  calibrate → inspect misses → deploy → vet/publish → recalibrate), how **confirmed
  trains are preserved as labeled analytics data** (`train_events` rows with
  `category` + timestamps; pass-grouping = the analytics' counting logic), the
  privacy/human-review gate, and the **caveats** (horn-bound recall, single mic,
  look-alikes, clip-vs-stream, parameter drift). Also documents the **two-detector
  reality** (loose live stream detector vs. the tuned offline horn detector) and the
  convergence roadmap, so the page can be honest: "acoustic candidate **+ human
  confirmation**."
- **On-page methodology panel** — `data/train-method.json` (JSON-driven, like the
  rest of the site; a condensed, machine-readable mirror of the doc: summary,
  method, parameters, accuracy, caveats) rendered into a collapsible **"ℹ️ How these
  are detected"** `<details>` on the Trains tab (`observatory.js` `loadTrainMethod()`,
  `.obs-method*` styles, links to the full doc). Bonus panel — fails silent if the
  JSON is absent. `observatory.js?v=obs25`, `style.css?v=obs19`.
- **Plan for the rest of Alan's ask:** *ship it* via PR to `main` (the box picks up
  the bridge/API on `git pull` + `restart birdapi`; the site deploys the panel);
  the **analytics view** (frequency / headway / time-of-day, built on the
  pass-grouping) is the next milestone, scaffold-ready and gated only on data flowing.

`node --check` + JSON validation pass. Keep `data/train-method.json` and
`DETECTION-METHODS.md` in sync on every recalibration (the displayed parameters are
corpus-measured, not a live guarantee).

---

## 2026-06-06 — Horn calibration: pass-level recall + missed-clip list

Real corpus at MIN_BLASTS=1 hit **80% recall / 96% precision** — the gap is now
"horn found in only 80% of clips" (19/97 yield no blast at all), not the
confirmation rule. Two diagnostics to chase that, the first from Alan's insight
that clips minutes apart are the same train:
- **Pass-level recall:** `parse_clip_time()` reads the timestamp from each clip name
  (live `train_2026-06-01T08-30-00.wav` or AudioMoth `20260601_083000.WAV`),
  `pass_recall()` groups clips within `--pass-gap-min` (default 5) into train
  *passes*, and a pass counts as caught if ANY of its clips has a horn. That's the
  number that matters (catching a train once = caught it) and it's how the webpage
  should later *count* trains (dedup clips → passes; feeds frequency/headway). Shown
  in the console + ACCURACY block, stored in the profile.
- **`missed_positives.txt`:** lists the positive clips that yielded zero blasts, so
  they can be listened to — genuinely faint/absent horn, mislabeled, or horn outside
  the band. Tells us whether to widen the band / lower tonality next, or accept them.
`blast_counts()` now returns (path, count) pairs so both can map back to filenames.

## 2026-06-06 — Horn calibration: blast-count diagnostic + MIN_BLASTS calibration

First real-corpus run (97 trains / 66 negatives) gave 97% precision but only **58%
recall** — the detector was *missing* trains, not confusing them. Root cause: the
corpus is single-event clips (the live detector's catches), but the detector only
confirms a train on **2+ horn blasts** (a rule meant for scanning continuous audio,
where a pass sounds the full long-long-short-long sequence). Many clips have one
blast → fail confirmation.

Made `build_horn_profile.py` measure and fix this instead of guessing:
- **`blast_counts()`** runs the detector's finder at the full operating config and
  counts blasts per clip; **`recommend_min_blasts()`** scores ≥1/≥2/≥3 on the corpus
  (recall from positives, precision from negatives) and picks best F1 (smaller k wins
  ties). `--min-blasts {1,2,3}` forces it.
- Calibration now reports **blast-level recall** ("horn found, ≥1 blast" — the blast
  detector's true reach) vs **confirmed recall** (≥k), so a low confirmed number is
  legible: detector working but the k-rule too strict, vs. the horn genuinely not
  found. The chosen `min_blasts_for_confirmation` is written to `horn_profile.json`
  (the detector already honors it via `load_profile`), added to the param block, and
  the k-table + blast-level recall go into the JSON.
- A note flags when k is lowered from 2, with the clip-vs-continuous caveat
  (k=1 best for clips; k=2 safer against lone-blip false positives on long recordings).
- Also (same session) fixed the Windows `UnicodeEncodeError` (UTF-8 on all file
  writes + stdout/stderr reconfigure) and a spurious numpy divide warning
  (`np.divide(..., where=)`), both verified.

Verified the new path on the synthetic corpus (diagnostic prints, k-table, auto-pick,
`--min-blasts` override, JSON fields, param block line). Expectation on the real
corpus: blast-level recall ≫ 58% → auto-picking k=1 lifts confirmed recall with
precision intact (negatives produced ~0 blasts at k=2).

---

## 2026-06-06 — Train vetting → Observatory page bridge (verdicts + privacy + category)

Connected the P2 corpus-sorting back to the live Observatory. The clips Alan is
sorting for calibration *are* the live detector's events (each has a `train_events`
row), so one sorting pass can both calibrate the detector and populate the Trains
page — without vetting twice. Two product decisions (asked): **keep the full
category** in the DB, and **count confirmed trains but keep their audio private**
by default (backyard mic).

- **Schema (`train_events` += `category`, `published`):** `category` stores the
  fine vetting class (train / plane / vehicle / gunshot / …) for future train
  analytics; `published` (default 0) decouples "is a train" (counts + shows on the
  page) from "serve the audio" (opt-in). `bird_api.ensure_train_schema()` applies
  both idempotently at startup (so `git pull` + `systemctl restart birdapi`
  migrates the live DB), and **preserves any already-public approved clip**
  (`published=1 WHERE verdict='train'`) so nothing currently public breaks.
- **`sync_train_verdicts.py` (new, pure stdlib — runs on the Windows PC and the
  box, no venv):** `emit` walks the sorted corpus → `train_verdicts.csv`
  (filename, verdict, category; `trains/`→train, other folders→false_positive with
  the folder as category, `unsure/`+`_*` skipped). `apply` (box) matches each clip
  to its `train_events` row **by exact basename** (not LIKE — clip names contain
  underscores) and sets reviewed/verdict/category, leaving audio private unless
  `--publish-trains`; backs up the DB first, supports `--dry-run`. `publish` flips
  chosen clips' audio public later.
- **API (`bird_api.py`):** the clip endpoint now also requires `published=1`, so a
  confirmed-but-private train's audio 403s even with a direct URL. `/api/trains/recent`
  already returns all columns (`dict(r)`), so `category`/`published` reach the
  front-end with no handler change.
- **Front-end (`observatory.js` `?v=obs24`):** the Trains list renders the
  `<audio>` player only when `published`; otherwise the event still shows
  (time/duration/dB) with a "🔒 audio kept private" note instead of a dead player.
- **Verified** end-to-end on a temp DB seeded with the *old* schema: migration
  added the columns + preserved a pre-existing public train, `emit`→`apply` set
  verdict/category correctly, new trains landed private (`published=0`), the clip
  gate served only published trains, and `publish` flipped one public. Python
  compiles; `observatory.js` passes `node --check`.
- **Deploy note:** these touch both tiers — restart `birdapi` on the box (picks up
  the migration + clip gate) and deploy the site (`observatory.js?v=obs24`). Do the
  box first so `/api/trains/recent` includes `published` before the new JS reads it.
  Currently on the feature branch; needs to reach production to go live.

Unblocks the designed-but-gated train analytics (`PLAN-train-analytics.md`) — the
vetted, categorized events are exactly its input. `schema.sql` migration logged;
`HORN-CORPUS-GUIDE.md` gained a "send confirmed trains to the page" step.

---

## 2026-06-06 — P2 horn study: corpus management, validation, Windows runbook

Follow-up to the same-day P2 build, in response to "make it idiot-proof to manage."
Reworked `build_horn_profile.py` around how Alan actually works — he pulls a week of
AudioMoth WAVs to a **Windows** PC and sorts them by ear (VLC/Audacity) into
category folders (trains, planes, vehicles, gunshots, construction…), where
everything that isn't a train is a negative.

- **Category-folder corpus (`--corpus ROOT`):** `trains/` = positives, every other
  subfolder = a labeled negative class (`unsure/`, `_*`, and the output dir are
  skipped). Also accepts repeatable `--negatives DIR DIR…`. Matches the sort-into-
  folders workflow with zero glue.
- **`--check` readiness census:** counts each class and gives a plain verdict
  (GOOD/OK/THIN + nudges like "only 12 trains — aim for 20+"). Runnable mid-sort,
  no calibration — directly answers "do I have enough yet / is this strong enough."
- **End-to-end validation pass:** after deriving the profile it runs the *real*
  detector over the labeled clips and reports **recall / precision with a per-class
  false-alarm breakdown** ("planes 2/40, gunshots 0/20") + a one-line verdict — the
  honest "is it accurate" answer, in the user's own data.
- **Calibration coherence fix (found by the new validation):** durations were
  measured at a permissive setting but the detector runs at `medium`, and a tight
  `BLAST_MAX` clipped the longest real horn blasts → they failed the 2-blast
  confirmation (synthetic recall fell to 50%). Now blast geometry is measured **at
  the derived operating threshold** (detector's own finder, duration filter opened
  wide so the distribution isn't censored), and `recommend_durations` carries
  headroom (min −30%, max +20%). Synthetic recall went 50% → 92% at 100% precision.
  Refactor: replaced `file_metrics`/`collect_metrics`/`combine_metrics` with
  `collect_tonality` (tiers/plots) + `measure_blasts_at` (operating-point geometry).
  JSON gained `negative_categories` + `calibration.validation`.
- **`HORN-CORPUS-GUIDE.md`** — a calm, linear **Windows 11** runbook (the user has
  no Mac): one-time setup (`C:\horn`, venv, folders), pull recordings with the
  built-in `scp`, sort in File Explorer + VLC/Audacity, `--check`, calibrate, read
  the accuracy block, deploy the profile (next to the detector, or `scp` to the
  box). Plus a cheat sheet and a "when something looks off" FAQ.

**Verified** end-to-end on a synthetic Windows-shaped corpus (12 trains + planes/
vehicles/gunshots negatives): `--check`, `--corpus`, explicit multi-`-n`, the
validation pass, and the regenerated profile all behave; the detector still
auto-loads the richer JSON (extra keys ignored). Docs synced (Current State,
ROADMAP, README). The earlier Mac-flavored draft of the guide was replaced.

---

## 2026-06-06 — P2 train horn study: offline detector + corpus calibration

A second, **offline** train detector for the Emmaus Observatory's P2 freight
study — distinct from the live `train_detector.service` on the Icecast stream.
An AudioMoth ~1500–1700 ft from the tracks records to WAV; these tools analyse
those recordings in batch, keying on the **train horn** (tonal energy ~250–600 Hz,
2+ blasts within a window) rather than the broadband rumble that's too faint at
that distance. Both are **manual CLIs** in `birdstation/` (no systemd unit).

**`train_horn_detector.py`** — the detector (drafted in a prior session), now
version-controlled. Per file: STFT → horn-band RMS + a **tonality ratio**
(horn-band energy / 100–1200 Hz broadband energy; tonal horn = high, wind/thunder
= low), find sustained blasts, confirm a train when 2+ blasts fall within the
window. Parses AudioMoth `YYYYMMDD_HHMMSS.WAV` names for wall-clock timestamps;
optional CSV out. **Added a runtime-profile hook:** `load_profile()` + a
`--profile` flag (and auto-discovery of a `horn_profile.json` next to the script)
override the built-in constants, and `extract_horn_band_features()` gained
optional `low_hz`/`high_hz` args (backward-compatible) so a calibrated band can
be applied without editing source.

**`build_horn_profile.py`** — the new one-time calibration pass (the actual ask).
Takes a folder of confirmed horn WAVs and a folder of confirmed no-train WAVs and:
- **Spectral analysis** — builds each file's representative spectrum from its
  loudest frames, takes the median across positives vs negatives, and derives the
  real horn band from the **positive/negative contrast** (the frequencies where
  horns carry energy the negatives don't — may be narrower than the 250–600 Hz
  default). Plots the spectrum overlay (band shaded) + an **onset-aligned average
  spectrogram** so the signature is visually obvious.
- **Threshold calibration** — runs the detector's *own* feature functions
  (imported, not re-implemented) over every file to compare positives vs
  negatives on tonality ratio, blast duration, inter-blast gap, and horn-band
  RMS. Sweeps tonality thresholds and picks low/medium/high tiers from the
  separation (medium = best F1; low = most sensitive still-precise split; high =
  strictest split still catching most horns), reporting the precision/recall each
  would give. Duration bounds from positive-blast percentiles; confirmation
  window from observed inter-blast spacing.
- **Outputs** — a ready-to-paste parameter block (with `# was X` deltas), six
  diagnostic PNGs, a `calibration_report.txt`, and `horn_profile.json` (which the
  detector auto-loads). Degrades gracefully: per-file load errors are skipped,
  `--no-plots` drops the matplotlib dependency, and thin corpora fall back to
  defaults with a flagged note instead of inventing a number.

**Conventions/wiring:** modern Python 3 + type hints (matches the other box
scripts), `librosa numpy scipy` (+ `matplotlib` for plots, headless `Agg`).
Generated `horn_profile.json` / `horn_profile_out/` are **gitignored**
(deployment-specific, like `*.db`); the durable record is the committed parameter
block. **Verified** end-to-end against a synthetic corpus (8 horn-like positives /
6 broadband negatives): the profiler recovered the planted band (355–415 Hz vs a
350–420 Hz fundamental), separated the classes cleanly, wrote all artifacts, and
the detector then loaded the profile and fired on positives / stayed silent on
negatives. `birdstation/README.md` gained a "Train horn study (P2)" section.

---

## 2026-06-05 — Personal Projects page: add the Observatory card

Small navigation fix: `projects.html` (the "things I've built" hub) only listed
Pulse and Setlist to Spotify — the Observatory was reachable from the home Explore
grid and the site-wide nav, but not from the project hub. Added an **Observatory
project card** (`card-teal`, 🔭) between Pulse and Setlist, mirroring the home
page's Pulse → Observatory ordering and grouping the two birdstation-powered
projects. Matches the page's existing `.project-card` format (emoji / title /
`card-desc` / two `card-tag`s — "BirdNET", "Raspberry Pi"). Pure static HTML,
consistent with the home card's colour/emoji. Verified: 3 project cards,
balanced `<a>` tags. `Current State.md` Pages table updated.

---

## 2026-06-05 — Observatory: "Almost a lifer" shelf (life-list progress game)

A front-end-only delight feature (assets `?v=obs23` / `style.css?v=obs18`) that turns the
life-list qualification rule into a visible progress game.

**What it is.** A shelf on the Birds panel (between the stat cards and the period bar)
listing species **on the cusp of the life list** — heard at the display floor (≥ 0.85) in
the **rolling last 24 hours** but not yet listed and short of the 3-hit bar. Each is a card
with a green **"N of 3"** progress bar, an "M more to go" line, the last-heard time, and a
tap-through to the bird card. Sorted closest-first (most hits, then most recent). The shelf
is **self-hiding**: `#obs-almost-section` starts `hidden` and only appears when something is
actually close — so it reads as a reward, not clutter, and silently disappears if nothing's
near or the box is offline (it's a bonus surface, no error state).

**Pure front-end — no box change.** It mirrors birdstation's life-list rule client-side:
- `loadAlmost()` fetches `GET /api/detections/grouped` over a **rolling 24h** window. A new
  `fmtUtcTsFull()` formats the window bounds as full `YYYY-MM-DD HH:MM:SS` UTC strings
  (minute/second precision), unlike the hour-floored `fmtUtcTs()` the period selector uses,
  so the window tracks the box's `datetime('now','-24 hours')` rule closely. `count` from the
  endpoint = qualifying (≥ 0.85) hits in the window, exactly the life-list numerator.
- `computeAlmostLifers(groups, life, need, perfectConf)` — a **pure, tested** function —
  keeps only species with `1 ≤ count < LIFE_LIST_MIN_HITS` (3), drops anything already on the
  life list (matched by common **or** scientific name, like the box), and drops the ~100%
  instant-add tier (`best_confidence ≥ PERFECT_CONFIDENCE` 0.995, which would already list).
- `renderAlmost()` is called from **both** `loadAlmost()` and `loadLife()` (whichever resolves
  last wins, same cross-section pattern as `renderBirdStats()`), and is **gated on
  `state.lifeLoaded`** so a species is never briefly shown as "almost" before we know the life
  list. The shelf is independent of the page's period selector — the rule is always rolling-24h.

New constants `LIFE_LIST_MIN_HITS = 3` / `LIFE_LIST_WINDOW_HOURS = 24` mirror the pipeline.
The shelf container joins the existing `[data-name]` card delegation, so taps open the bird
card with no new listener. New `.obs-almost-*` CSS (green left-accent + green progress bar to
read as a goal-in-progress, distinct from the confidence-coloured species cards).

**Verified:** `node --check`; CSS brace-balanced with all `.obs-almost-*` classes + theme
vars present; a throwaway DOM-stub harness (25 checks) exercised `computeAlmostLifers`
(exclusions for listed/≥100%/count≥3/0-hit, common-vs-scientific match, closest-first +
recency tiebreak), `renderAlmost` (hidden until life loads, count badge, "N of 3" / "M more
to go" / progress-bar widths, hide-when-empty), the HTML↔JS id cross-check, and the rolling
window (valid format, exact 24h span, sub-hour precision preserved). Front-end only — ships
via Vercel; no box deploy needed (it reuses `/api/detections/grouped` + `/api/lifetime`).

---

## 2026-06-05 — Observatory: dawn-chorus shading + train-analytics design

A quick-win visual plus the design groundwork for train analytics (assets
`?v=obs21` / `style.css?v=obs16`).

**Dawn-chorus shading.** The "When the birds sing" hour chart's caption already
talked about "the dawn chorus and the quiet hours" — now the chart *draws* it. The
24 hour-columns are tinted by Emmaus' real day/night cycle: night a soft dark wash,
the **dawn window (sunrise → ~90 min after) picked out in gold**, dusk a faint warm
tint, daytime clear. A 🌅/🌇 sunrise/sunset line sits under the chart
(`#obs-an-suninfo`). Sun times come from a **trimmed SunCalc** (`sunTimes()`,
Agafonkin/MIT — pure vanilla, no deps) computed for the selected period's **midpoint
date** (representative for multi-day ranges), converted to Eastern decimal hours
(`easternDecimalHour()`), and each column is classed `obs-an-hbar-{night,dawn,dusk,day}`
by `hourBand()`. Verified the math against real Emmaus times (Jun 5: sunrise 5:33a /
sunset 8:30p; winter solstice 7:23a / 4:39p). Degrades to no shading if sun times are
unavailable. Birds-only — the future train toggle will skip it.

**Train-analytics design (`PLAN-train-analytics.md`).** Wrote the full design for a
`Birds | Trains` toggle on the Analytics tab: reuse the stat cards / hour chart /
per-day chart, swap in a **day-of-week × hour heatmap**, **duration & loudness
histograms**, and a **headway** ("typical wait between passes") card; backed by a new
**approved-only** `GET /api/trains/analytics` that mirrors `/api/analytics`' Eastern
bucketing (with a note that train `detected_at` carries an offset, unlike the naive-UTC
bird rows, so the bucketing differs). Gated on the detector producing **vetted** events;
the front-end scaffold (toggle + empty state) can land ahead of data. Build order +
endpoint shape are in the doc.

**Roadmap re-prioritization.** Folded the 2026-06-05 brainstorm into the Observatory
ideas backlog (§3a train analytics, §3b the rest), tagging each idea **[new]** vs.
**[tracked]** so a future session can pick up cleanly. Standout **[new]** ideas: an
"Almost a lifer" shelf, a year calendar heatmap, "compared to usual" baselines, rare
visitors, a diversity trend, and a `weather.js` correlation join.

**Verified:** `node --check`; SunCalc + the hour classification sanity-checked in node.
Front-end only — no birdstation change in this batch.

**Follow-up (same day): gradient, not blocks.** The first cut tinted each hour *column*
behind the bars (`obs-an-hbar-{night,dawn,dusk,day}` classes); on screen that read as
gappy, muddy boxes (the 3px inter-column gaps + low-alpha gold smears). Replaced with a
**single continuous `linear-gradient`** drawn behind all the columns (`.obs-an-hours-bg`,
built by `sunGradient()` from the same sunrise/sunset) — night → gold dawn glow → clear day
→ warm dusk → night, smooth. The container is now `position:relative; overflow:hidden` and
the bars sit above the gradient via z-index. Stops verified monotonic for summer + winter.
`?v=obs22`/`obs17`.

---

## 2026-06-05 — Observatory: life list → popout + tooltip wrap fix

Two front-end follow-ups (assets `?v=obs20` / `style.css?v=obs15`):

**Life list is now a popout, not an inline section.** Clicking the "Life list" stat
card used to smooth-scroll the page — and it landed *past* the section heading (the
scroll target was `#obs-life`, the cards container, which sits below the heading +
controls). Rather than just fix the scroll, the whole list moved into a **modal**
(`#obs-life-modal`, `.obs-life-*`) that reuses the bird-card shell: **bottom sheet on
mobile, centered ≥600px**, sticky header with the sort `<select>` + `💯 100% only`
toggle, scrollable body. The inline section (and its now-redundant rule note) is gone,
so the main Birds page is more compact with no scrolling to reach the list.

Layering: the life modal sits at `z-index 390`, below the bird card's 400, so tapping a
lifer opens its card **on top** and closing returns to the list. `openLifeModal()` /
`closeLifeModal()` coordinate the `body` scroll-lock with `closeBirdCard()` (the page
stays locked while either modal is up), and Escape closes the **topmost** modal. Flexbox
scroll gotcha handled — the sheet is `overflow:hidden` and the body is `flex:1; min-height:0`
so the body scrolls under a fixed header. Lifer cards get `var(--bg)` inside the
surface-colored sheet so they still stand out. `renderLife()` already owned the count +
the `#obs-life` render, so it needed no change — opening just reveals the modal.

**Tooltip count no longer wraps mid-phrase.** The analytics hover tooltips were breaking
"188 detections" across two lines (number stranded from its unit). Added an `nbCount()`
helper that joins the figure to its unit with a non-breaking space (` `), used in the
hour, heatmap, and daily tips so each count wraps as one unit.

**Verified:** `node --check`; HTML/JS id cross-check; no stale `scroll-life`/`scrollIntoView`
refs remain. Front-end only — no birdstation change in this batch.

---

## 2026-06-05 — Observatory: life-list 100%-only filter + Analytics fixes

Four targeted Observatory tweaks (assets `?v=obs18` / `style.css?v=obs14`):

**Birds — "100% only" on the life list.** The species grid already had a green
`💯 100% only` toggle; the life list now has the same affordance (`#obs-life-perfect`,
`state.lifeOnlyPerfect`), filtering to lifers whose **best-ever** confidence reads as
100% (≥ `PERFECT_CONFIDENCE` 0.995 — the instant-add bar). This needed a new field:
`/api/lifetime` now derives `best_confidence` per species (unfloored `MAX(confidence)`,
so a single ~100% hit counts), alongside the live `total_detections`. `renderLife()`
now owns the life-list count so it tracks the filter (like the grid). Degrades to "No
lifers heard at 100% yet" until the box redeploys with the new field.

**Analytics — "Activity over time / detections per day" was blank.** A pure CSS bug:
`.obs-an-dbar-wrap` had no height and its parent `.obs-an-daily-bars` uses
`align-items: flex-end` (not `stretch`), so the wrapper collapsed to content height and
the `height:100%` track (and the `%`-height bars inside) resolved against ~0 → invisible
bars. Fixed by giving the wrapper `height: 100%` so it resolves against the row's 120px.

**Analytics — "Who sings when" long names cut off.** Widened the heatmap species label
132 → 168px (mobile 100 → 124px), bumped the heatmap `min-width` 460 → 500px to keep the
24 cells legible, and added a `title` (full common name) on each label for hover.

**Analytics — real hover tooltips.** Replaced the slow/unstyled native `title` on the
hour bars, heatmap cells, and daily bars with an **instant, themed tooltip** (`.obs-an-tip`):
elements carry `data-tip`, delegated `mousemove`/`mouseleave` on each chart container show
a cursor-tracking bubble (`initAnTooltips()`). "Who sings when" shows the species×hour
count; "When the birds sing" shows the per-hour total (all species); daily shows the
per-day total + species count. All read from the period-scoped `/api/analytics` response,
so they respect the active filter (Today / Yesterday / This week / …).

**Verified:** `node --check`, `python3 -m ast` parse; analytics + species test suites pass
(added `test_lifetime_best_confidence_is_unfloored_max` and extended the `lifetime_list`
mirror with `best_confidence`).

---

## 2026-06-05 — birdstation: systemd units truly run-from-clone (symlinks)

Deploying the twice-daily timer surfaced that the "run-from-clone" model only
covered the Python: the unit *files* were `cp`'d into `/etc/systemd/system`, so a
`.timer`/`.service` edit needed a manual re-copy — and a skipped copy silently
left the box on the old schedule (the live `pulse-digest.timer` still read
"daily at 6 AM" after a `git pull`). The README even claimed "no copy step" for
units, which wasn't true.

**Fix — `birdstation/link_units.sh`:** an idempotent installer that **symlinks**
`systemd/*.{service,timer}` from the clone into `/etc/systemd/system`, backing up
any existing real file once (`<unit>.bak-<ts>`) and running `daemon-reload`. After
this, a unit-file edit deploys on `git pull` + `daemon-reload` + restart — no copy,
nothing drifts. Relinking doesn't restart running services, so it's non-disruptive.

**README:** corrected the run-from-clone description, added a **"Deploying
unit-file changes"** section (pull → `daemon-reload` → restart; `link_units.sh`
for brand-new units), switched cutover step 4 from `cp` to `link_units.sh`, and
refreshed the stale `pulse_digest`/timer descriptions (Haiku, twice-daily).

**Verified:** `bash -n`; a temp-dir harness exercised the link/backup/idempotency
logic (real file backed up, symlink resolves to new content, second pass a no-op).
On the box: `sudo ~/alans-brain/birdstation/link_units.sh` once retrofits the
symlinks (replacing the `cp`'d copies), then `daemon-reload` + restart the timer.

---

## 2026-06-05 — Pulse digest: twice daily, Haiku, windowed "since the last brief"

Reworked the daily brief into a **twice-daily** one (morning + evening), moved it
off Sonnet onto **Haiku 4.5** for cost, and changed the window so each brief is
genuinely fresh rather than a re-tread of the last.

**Model: `claude-sonnet-4-6` → `claude-haiku-4-5`** with **extended thinking**
(`{"type":"enabled","budget_tokens":4000}` — Haiku rejects `"adaptive"` thinking
with a 400, so we use the explicit-budget form; the digest auto-falls-back to no
thinking if a model rejects thinking entirely).
Sonnet wasn't necessary now that the brief is *grounded* (it reads real article
excerpts + a hard anti-invention prompt, added 2026-06-04) — grounding drives
correctness far more than model size. Haiku 4.5 handles the synthesis +
citation-id bookkeeping, at a large fraction of the cost; running it twice a day
on Haiku still comes in well under once a day on Sonnet.

**Window: last-24h → "since the last brief."** Each run now selects items
**`enriched_at` after the previous digest's `generated_at`** (floored at
`MAX_LOOKBACK_HOURS = 24` so a first run / outage gap can't pull an unbounded
backlog). Windowing on `enriched_at` rather than `fetched_at` means an item that
enriches late still lands in the *next* brief instead of being dropped — no gap,
no overlap. In steady state the two briefs are ~11–13h apart, so each covers only
what's new.

**Storage: two briefs coexist.** `feed_digests` PK went `date` → **`(date, slot)`**
with `slot ∈ {morning, evening}` (Eastern date + a noon split on
`datetime.now(ZoneInfo("America/New_York")).hour`). `pulse_digest.ensure_schema()`
applies the rebuild **idempotently** on the next run (guarded on the `slot`
column; preserves existing rows as `morning`), so a plain `git pull` migrates the
live DB — no manual SQL, same pattern as `birdnet_pipeline.init_db()`.

**Surfaces.** `GET /api/digest` now returns the most recent brief **by
`generated_at`** (was `date`) and includes `slot`; it tolerates the pre-migration
schema (PRAGMA-checks for the column) so the API doesn't depend on the digest
migration having run yet. The front-end labels the card **"🌆 Evening Brief"** vs
**"📰 Morning Brief"** off `d.slot`. The timer (`pulse-digest.timer`) fires
**06:00 + 17:00 `America/New_York`** (Eastern-pinned so it's DST-correct and
unaffected by the box running UTC).

**Verified:** `py_compile` (all 4 box scripts) + `node --check pulse.js`; a
throwaway-DB harness exercised the real `ensure_schema` — legacy→migrated (old row
becomes `morning`), morning+evening rows coexisting under the new PK, "latest by
`generated_at`" picking the evening brief, idempotent re-run, and the
`max(last, floor)` cutoff (last-wins normally, floor-capped after a long gap). Not
run against the live API (no box access here); deploy = `git pull`, restart
`birdapi`, `systemctl daemon-reload` for the timer, then the next run migrates +
writes. Needs Anthropic credits on the account (separate billing top-up in flight).

---

## 2026-06-05 — Pulse: API outages no longer poison the enrich backlog

Deploying the grounding work surfaced a latent pipeline flaw. The box's Anthropic
account had run out of credits, so every `pulse-enrich` run 400'd
("credit balance is too low") — and the old code **bumped `enrich_attempts` on
the whole batch for any exception**. Since the fetch query skips items at
`enrich_attempts >= MAX_ATTEMPTS` (3), a few hours of outage permanently excluded
the items it touched: they'd never enrich even after credits returned (the logs
showed "bumped 11/12 attempts" per failed run). An infrastructure failure was
silently burning a budget meant for genuinely-unprocessable items.

**Fix — only burn the retry budget on a real per-item miss.**
- `pulse_enrich.py` — batch-level API/account/network failures (`anthropic.APIError`,
  the base for all status + connection errors: billing 400, auth 401, 429, 5xx,
  timeouts) now **roll back without bumping** and exit non-zero cleanly (no
  traceback); the next timer run retries the same items as-is. The *only* place
  `enrich_attempts` increments now is the existing path where a **successful** call
  returns a response that omits an item — the genuine "can't enrich this one" signal.
- `pulse_digest.py` — same `anthropic.APIError` guard around the digest call, so an
  outage logs one line and retries next run instead of crashing with a traceback
  (the digest has no per-item counter, so nothing was poisoned there — this is just
  cleaner failure behavior).

**Operational note (one-time):** items already capped by the outage need their
counter reset so they re-enrich once credits are restored:
`sqlite3 ~/birdnet.db "UPDATE feed_items SET enrich_attempts = 0 WHERE enriched_at IS NULL;"`.
Going forward this is self-healing — no manual reset after an API hiccup.

**Verified:** `py_compile` on both scripts. (Couldn't exercise against the live
API from this environment; the failure path is exercised naturally by the billing
outage on the box — re-run `pulse-enrich` after adding credits + the reset above.)

---

## 2026-06-04 — Pulse: collapse brief sources, anti-hallucination grounding, + Archer source plan

Three threads of Pulse work: a small front-end tidy, a real fix for the digest's
tendency to invent detail, and the groundwork/decision for adding the first
*event* source (Archer Music Hall).

**1. Brief "Sources:" lines collapsed by default (front-end).** Each Morning Brief
section showed an always-visible `Sources:` line of numbered links. It's now a
native `<details>`/`<summary>` ("Sources (N)"), collapsed by default and styled to
match the existing Citations toggle (▸ rotates on open). `renderSectionSources()`
in `pulse.js`; new `.pulse-sources-toggle` / `.pulse-sources-list` in `style.css`
(the old flat `.pulse-brief-sources` flex rules moved onto `.pulse-sources-list`).
No version query on Pulse assets, so nothing to bump.

**2. Hallucination reduction — grounding, not scraping (box-side, deployable).**
Root cause: the AI saw almost nothing real. The fetcher truncated the teaser to
500 chars and ignored `content:encoded`, and the **digest synthesized from only
the one-sentence AI summaries** — so Claude filled gaps with plausible-but-invented
specifics. Fixes:
- `pulse_fetcher.py` — new `extract_body()` prefers the fullest `content:encoded`
  (feedparser `e.content[*].value`) over the teaser, and the cap rose 500 → 2000
  (`BODY_CAP`). Forward-looking: existing rows are deduped by url, so only new
  items get the richer body.
- `pulse_digest.py` — the payload now includes an **`excerpt`** (the richer
  `summary` body, capped 500/item) alongside the one-line `ai_summary`, so synthesis
  is grounded in actual article text. System prompt gained a hard GROUNDING rule:
  no invented figures/dates/names/quotes/causes/outcomes; be vague rather than wrong;
  cite only provided ids.
- `pulse_enrich.py` — same grounding rule added to the one-sentence summarizer.

  Why not scrape article bodies for even more context? **Tested it — it's blocked.**
  See thread 3: the same 403 wall that stops venue scraping stops most news
  publishers, so the high-leverage, zero-risk move was to stop throwing away the
  full text the feeds already carry, plus constrain the model. Per-source full-text
  scraping stays a *future, individually-tested* option, not a blanket one.

**3. Archer Music Hall — tested every source, chose the API (decision + plan).**
Goal: add upcoming concerts at Archer Music Hall, Allentown. Tested each candidate
with a real server-side fetch: **`archermusichall.com/shows`, Bandsintown, JamBase,
Concertfix, and SeatGeek all return HTTP 403** to a non-browser client (bot
protection). The robust path is the **Ticketmaster Discovery API** (Archer is a
Live Nation/Ticketmaster venue, id `KovZ917AYeX` / `393388`): free key, JSON, no
HTML parsing, no hallucination surface. Decision (with Alan): build a new **`api`
adapter** (alongside `rss`/`scrape`/`email`) and make Archer the *first* event
source, ahead of the scrape-based Emmaus Theater. Full design — endpoint, field
mapping, `TICKETMASTER_API_KEY` in `/etc/birdstation.env`, `feed_sources` row,
daily cadence — written into `PLAN-ingestion.md`. **Not built this session**
(scope: front-end + hallucination only; the box can't be deployed/tested from
here, and the events table + "What's On" surface is the larger Phase-4 build).

**Verified:** `py_compile` on all three box scripts; `node --check pulse.js`; CSS
brace-balanced with the new classes present. Box scripts not run against the live
DB (no box access from this environment) — deploy is `git pull` + restart the
`pulse-*` units (fetch/enrich/digest). The grounding changes take effect as new
items are fetched (richer body) and on the next digest run.

---

## 2026-06-04 — Observatory: Analytics tab (bird distributions)

First of the "fun analytics" — a third Observatory tab (📊 **Analytics**, between
Birds and Trains) that visualizes detection *distributions* over a selected period.
All charts are vanilla CSS bars/cells (no chart library — per the no-deps convention),
fed by a single box-side aggregation.

**New endpoint — `GET /api/analytics?start=&end=&min_confidence=&top=` (`birdstation/bird_api.py`).**
Returns a pre-aggregated bundle for a UTC datetime range (the same Eastern→UTC day
boundaries the period selector already sends to `/api/detections/grouped`):
- `by_hour[24]` — detections per **Eastern** hour-of-day (the "dawn chorus" curve)
- `species_hours[]` — the top `top` (default 12) species, each with `hours[24]` → the species×hour heatmap
- `top_species[]` — the full most-heard leaderboard `{common_name, scientific_name, count}`
- `by_day[]` — `{date, count, species}` per Eastern day (volume + diversity)
- totals + `busiest_hour` (0–23) + `peak_day`

**Eastern bucketing, done right.** The box stores **naive-UTC** timestamps, so a raw
hour bucket would put the dawn chorus at ~9–10 (UTC) instead of ~5–6 (Eastern). The
endpoint `GROUP BY substr(timestamp,1,13)` (the UTC `YYYY-MM-DDtHH` prefix — works for
both the `T`-separated ISO stamps the pipeline writes and space-separated ones), giving a
**bounded** intermediate (≤ ~24×days×species rows), then folds each bucket into Eastern
hour/day buckets in Python via `eastern_parts()` — so the conversion is cheap and
**DST-correct** without a per-row SQL scan. Uses `zoneinfo` when available (the box has
tzdata) with a self-contained US-Eastern (post-2007) DST rule as the fallback. New tests:
`birdstation/test_analytics_endpoint.py` (13 — Eastern/EST/EDT bucketing, late-night
roll-back to the previous Eastern day, the DST fallback boundaries, diversity, leaderboard,
`top` cap, confidence filter, ISO-`T` stamps, empty range).

**Front-end (`observatory.html`, `observatory.js`, `style.css`).** The Analytics tab has
its own period selector (Today / Yesterday / This week / This month / This year / All,
defaulting to **This week**) and renders:
- **Summary stat cards** — Detections (period), Species, Busiest hour ("7 AM"), Peak day.
- **"When the birds sing"** — a 24-bar hour-of-day chart, busiest hour highlighted green.
- **"Who sings when"** — a species×hour heatmap, each row self-normalized to its own
  busiest hour so the *pattern* (owls after dark, robins at dawn) reads regardless of
  volume; a ×total badge conveys magnitude. Horizontally scrolls on narrow screens.
- **Most heard** — top-15 leaderboard with proportional bars.
- **Activity over time** — per-day detection bars (hidden for single-day periods, where the
  hour chart already covers it).
Heatmap rows + leaderboard rows carry `data-name`/`data-sci`, so the **existing bird-card
delegation opens a card on tap**. Analytics **lazy-loads on first tab open** (it's a heavier
box aggregation) and is included in the manual ↻ refresh only once opened. New `obs-an-*`
classes; `TAGLINES.analytics = "The shape of the chorus."`.

**Verified:** `py_compile` + 13 analytics tests + 22 existing species/grouped/lifetime tests
green; `node --check observatory.js`; a DOM-stub render harness (27 checks — bar counts,
peak highlighting, heatmap cells/ticks/alpha, clickable rows, empty states, single-day
hiding) all pass; CSS brace-balanced, all vars defined. (Couldn't hit the live box — the
web session's network policy blocks `birds.alansbrain.com`.) **Assets:** `observatory.js?v=obs17`,
`style.css?v=obs13` (`bird-info.js` unchanged). **Box step:** `cd ~/alans-brain && git pull
&& sudo systemctl restart birdapi` to serve `/api/analytics` (front-end ships via Vercel;
until the box is restarted the Analytics tab shows the offline state).

## 2026-06-03 — Observatory: bird-card tap targets + "100% only" filter

Three small UX asks.

- **Photo is no longer a Wikipedia link.** The card photo was wrapped in an `<a>` to
  Wikipedia, so tapping it (the biggest element on the card) navigated away by accident.
  Unwrapped it to a plain `<img>`; the deliberate `↗ Wikipedia` text link below the name
  stays. Removed the now-dead `.obs-bcard-photo-link` rule.
- **Bigger close button.** `.obs-bcard-close` 28×28 → **40×40** with a larger glyph,
  an `:active` state, and `-webkit-tap-highlight-color: transparent`; the name's
  `padding-right` grew to clear it in the no-photo layout.
- **"100% only" filter.** A green toggle pill (`#obs-perfect`, `state.onlyPerfect`) in
  the species-grid heading filters the grid to species whose best confidence in the
  selected period reads as 100% (≥ `PERFECT_CONFIDENCE` 0.995 — the lifer instant-add
  bar). Client-side, persists across period switches, and updates the count + empty
  message ("No species heard at 100% in this period."). Pair with the **All** period for
  the all-time list of birds heard at 100%. The headline stat cards are unaffected (like
  search, it's a grid-only filter).

**Assets:** `observatory.js?v=obs16`, `style.css?v=obs12`. `node --check` clean; no box
step (front-end only — ships via Vercel).

## 2026-06-03 — Observatory: period counts mutually inconsistent (day-boundary bug)

**Bug.** The page showed 45 birds "today", 62 "yesterday", but 2,277 "this week" —
today wasn't even a subset of the week. Two compounding day-boundary defects:
- **"Today" used `/api/today`**, which filters `date(timestamp)=date('now','localtime')`.
  The box runs UTC, so that's the **UTC calendar day**; in the evening Eastern (after
  UTC midnight) it rolls to the next UTC day and shows almost nothing.
- **The other periods use `/api/detections/grouped`** with Eastern-aligned UTC
  boundaries, but the query compared **raw timestamp strings**. The pipeline writes
  ISO `T` + microseconds (`2026-06-03T17:35:00.123456`); compared against the
  space-formatted boundary (`2026-06-03 04:00:00`), the `T` (chr 84) sorts after the
  space (chr 32), so the 04:00-UTC boundary check was wrong — windows effectively
  became whole UTC days, offset from "today".

**Fix.**
- **`bird_api.py` `/api/detections/grouped`** now compares `datetime(timestamp) >=
  datetime(?) AND datetime(timestamp) < datetime(?)`, normalizing the `T`/microseconds
  to the boundary's shape so Eastern-day windows split correctly (a 10 PM EDT
  detection = 02:00 UTC next day now lands in the right Eastern day).
- **`observatory.js`** routes **every** period — Today included — through the grouped
  endpoint (Eastern-aligned), so all counts share one consistent definition and Today ⊆
  This week. Removed the now-dead `/api/today` path: `loadToday()`, `groupDetections()`,
  `EP.today`, `state.today`. (`/api/today` the endpoint stays for any other consumer.)

**Verified:** new test seeds realistic ISO-`T`/microsecond timestamps straddling the
04:00-UTC boundary and asserts the right Eastern-day split (22 tests, all green);
`node --check`; `py_compile`. **Assets:** `observatory.js?v=obs15`. **Box step:**
`cd ~/alans-brain && git pull && sudo systemctl restart birdapi` (front-end is the main
fix; the grouped-query change needs the API restart).

## 2026-06-03 — Observatory: life-list tally derived live (was drifting low)

**Bug.** The life list showed a `total_detections` lower than a single day's count
(e.g. House Sparrow ×856 lifetime while "today" alone was ×759). Root cause: the
tally was a **denormalized counter** on the `lifetime` table, maintained by the
pipeline as `existing + 1` per ≥0.85 hit and seeded at listing time with the 24h
hit count. That counter drifts — it never counts hits logged before a species was
listed and never self-corrects after any missed update — so it can fall behind the
real number of detections.

**Fix (two parts).**
- **`bird_api.py` `/api/lifetime`** now derives `total_detections` **live** from the
  `detections` table — `COUNT(*)` of that species' hits at ≥ `LIFE_LIST_MIN_CONFIDENCE`
  (0.85), matching by common *or* scientific name — instead of returning the stored
  counter. This makes the life-list total always truthful, self-healing across resets
  /purges, and consistent with the page's other ≥0.85 views (the "All" period grid now
  agrees with the life-list ×N). N+1 COUNTs, but N = lifer count, so it's cheap.
- **`birdnet_pipeline.py`** now keeps the stored column honest too: an existing lifer's
  tally is **recomputed from `COUNT(*)`** (not `+1`), and a newly-listed species is
  seeded with the true all-time qualifying count (not just the 24h window). So the
  persisted value self-heals on the next detection rather than carrying old drift.

**Verified:** 2 new tests (live count overrides a stale stored value and ignores
sub-floor hits; matches by scientific name) — 21 total, all green. **Box step:**
`cd ~/alans-brain && git pull && sudo systemctl restart birdnet birdapi` (the API fix
corrects the displayed total immediately; the pipeline fix heals the stored column on
each new detection). No front-end change (the page already reads `total_detections`).

## 2026-06-03 — Observatory: recent hits on bird cards + 85% preserve/display floor

Three morning Observatory asks. Two shipped as code; one was a question answered
in-place (no code change).

**Recent hits on the bird card (front-end + API).** Each bird card now lists the
**last 10 detections** (newest first) under the comic-book stats grid — a confidence
pill + date·time per hit — followed by a one-line life-list status: "✓ On the life
list", or "Not yet a lifer — N of 3 qualifying hits (≥85%) in the last 24h". This
makes the life-list math legible at a glance: a species heard-but-unlisted is simply
short of 3 qualifying hits in the rolling window (or its hits are spread too far apart).
`GET /api/species/{name}` gained `recent[]` (last 10 `{timestamp, confidence}`, newest
first), `hits_24h` (qualifying hits in the rolling 24h, using the life-list floor),
`life_list_min_hits`, and `on_life_list` (joins the `lifetime` table). `observatory.js`
renders them in `birdCardContent`; new `.obs-bcard-hits*` / `.obs-bcard-status*` CSS.

**Three-tier confidence model (box + front-end).** Reconciled "keep the diagnostic
hits" with "clean analytics" by decoupling three floors:
- **Preserve 0.60** — the pipeline's `MIN_CONFIDENCE` went **0.35 → 0.60** (also passed
  to the analyzer as `--min_conf`). The box keeps detections ≥ 0.60, so sub-85% hits
  survive for diagnostics but the worst noise is cut.
- **Display 0.85** — the page grid/stats floor went **0.75 → 0.85** (`observatory.js`
  `MIN_CONFIDENCE` + the `/api/species` and `/api/detections/grouped` server defaults),
  so the public page/analytics show only confident birds.
- **Life list 0.85 + count** — unchanged (3 hits at ≥ 0.85 in a rolling 24h, or one ~100%).

The bird card's **recent-hits list reaches down to the preserve floor** (a separate
`/api/species` query at `PRESERVE_MIN_CONFIDENCE`), so the lower hits that explain a
non-lifer are visible (colour-graded mid/low), while the card's summary stats stay at
the 0.85 display floor. This delivers the original ask — e.g. a Downy Woodpecker card
shows two 70% IDs + one 89%, with "1 of 3 qualifying hits".

(An earlier pass this same day set a single 0.85 preserve==display floor; superseded by
the three-tier model above after deciding to retain the sub-85% diagnostic hits.)

**Purge script for the old noise (`purge_low_confidence.py`).** A manual one-shot the
box runs once to clear detections below the new preserve floor (default 0.60) — the
historical ≥ 0.35 rows logged before the floor was raised. Backs the DB up first,
supports `--dry-run` / `--floor` / `--no-backup`, VACUUMs after. Leaves `lifetime`,
Pulse, and train tables alone. Not scheduled: the pipeline already declines to write
below the floor, so new data stays clean. Smoke-tested against a throwaway DB (keeps
0.60 + 0.88, deletes 0.40 + 0.59, writes a backup).

**Life-list clips — "should a recording be available?" (answered, no change).** The
pipeline already archives one WAV per life-list-qualifying detection to `~/bird_clips`
(2026-06-02, "verifiable lifers"), but those clips are **local-only and never served**
— the backyard mic can catch conversation, so the documented posture is SSH review via
`review_birds.py`. That's why they haven't appeared on the page: there is intentionally
no web surface. **Decision:** keep clips local-only for now (declined a public clip on
the card and a passphrase-gated review page). Re-open later if a vetted, privacy-safe
surface is wanted.

**Verified:** `test_species_endpoint.py` updated + extended (19 tests, all green) —
`recent` ordering/cap, the recent-reaches-to-0.60 vs stats-at-0.85 split (sub-display
diagnostics shown, sub-preserve excluded), `on_life_list`, `hits_24h` (rolling-window);
seed data re-baselined to the floors; `py_compile` on all three box scripts;
`node --check observatory.js`; purge script smoke-tested on a throwaway DB.
**Assets:** `observatory.js?v=obs14`, `style.css?v=obs11`. **Box steps:**
`cd ~/alans-brain && git pull && sudo systemctl restart birdnet birdapi` (picks up the
0.60 preserve floor + the enriched `/api/species` response), then optionally
`python3 ~/alans-brain/birdstation/purge_low_confidence.py --dry-run` and, once happy,
without `--dry-run` to clear the old < 0.60 noise.

## 2026-06-02 — Observatory: "All" (all-time) period filter

Added an **All** tab alongside Today / Yesterday / This week / This month / This
year. `periodDates` gains an `all` branch (start `2000-01-01` → today) that the
existing grouped-fetch + period-aware stats handle unchanged: the stat cards read
"Heard all time / Species all time" and the grid lists every species ever heard at
≥ 75%. **Assets:** `observatory.js?v=obs12`.

## 2026-06-02 — Verifiable lifers (clip archive + review) + BirdNET seasonal filter

Two box-side follow-ups to the life-list work, both in `birdstation/`.

**Seasonal filter (`birdnet_pipeline.py`).** The analyzer was run with lat/lon
(location filter) but an implicit `--week -1` (year-round). It now passes BirdNET's
1-48 week-of-year via a new `birdnet_week(dt)` helper — `(month-1)*4 + week-of-month`,
the "every month has 4 weeks" convention from the BirdNET-Analyzer docs (birdnetlib's
day-of-year proportional variant differs by ≤1 week near month boundaries —
immaterial to seasonal filtering). Gated behind `USE_WEEK_FILTER`. This constrains
the species list by season as well as location, cutting out-of-season false positives.
The `detections.week` column now stores this 1-48 value (was ISO `%V`, which nothing read).

**Verifiable lifers (`birdnet_pipeline.py` + new tooling).** The pipeline now archives
a short WAV for each life-list-qualifying detection (≥ 0.85), capped to **one per species
per local day** to bound storage, recording the path in a new `detections.clip_path`. A
new `detections.verified` column holds a review label (correct/wrong/unsure). Both columns
are added idempotently by `init_db()`, so `git pull` + `systemctl restart birdnet` migrates
the live DB with no manual step.

- **`review_birds.py`** (mirrors `review_trains.py`): walks unreviewed clips, plays each
  (ffplay/aplay/paplay), records correct/wrong/unsure into `verified`. `--stats` prints
  **measured precision by confidence band** (0.85–0.90, 0.90–0.95, 0.95–0.995, 0.995+) and
  overall — the raw material to calibrate BirdNET scores into real probabilities.
- **`purge_bird_clips.py`** + **`purge-bird-clips.timer`** (daily 04:30): keeps labelled
  clips (the calibration set) and recent unreviewed ones; deletes unreviewed clips older
  than `BIRD_CLIP_RETENTION_DAYS` (30) and aged orphans, clearing the dangling `clip_path`.
  Mirrors the train-clip purge.
- **Privacy:** these clips come off the same backyard mic as train clips and can catch
  conversation, so they are **never served by the API** — local-only, reviewed over SSH,
  aged out by the purge. No public endpoint was added.

Verified locally: the week formula (range 1-48, today → 21), the one-per-species/day cap
query, and a purge integration test (keeps reviewed + recent, deletes aged unreviewed +
aged orphan, clears the path). `schema.sql` and `birdstation/README.md` updated (layout,
Services table, deploy notes, a clip-privacy section).

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
  2. **Wrong mount → HTTP 404.** Was reading `http://your-box:8000/backyard`
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
