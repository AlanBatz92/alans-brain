# Roadmap — Alan's Brain

> The running to-do list. Ask "what's on the list?" any time; we (re)prioritize
> here and keep it current. **Convention:** when a feature lands, move it to
> "Done (recent)" with a date and add the matching `Build History.md` entry.
> Detailed designs live in the `PLAN-*.md` docs; this file is the index + status.
>
> Status key: **▶ Next** · **◷ Soon** · **○ Later** · **✓ Done**

---

## ▶ Next

### 1. Observatory: "comic-book" bird cards  ← FOCUS
Make the grouped-species cards come alive. Two layers:

**a) Hover / tap → quick card.** A richer popover over a species card showing a
**photo** and a few punchy facts (size, habitat, a fun fact, maybe its call) —
"comic-book stat card" energy, not a wall of text. On mobile this is a tap
(there's no hover), so design it as a tap-to-open card from the start.

**b) Click through → full detail.** From the quick card, open a fuller view.
Two distinct kinds of "detail" to combine:
- **Its facts** (external) — fuller description, range map, more photos.
- **Its history here** (our data) — every time *we've* heard this species:
  detection count, first/last heard, confidence over time, time-of-day pattern.
  This is the "go to the bird database we pull from" idea — note birdstation
  only stores **detections**, so this view is built from `/api/detections` (or a
  small new per-species endpoint), not from any bird encyclopedia.

**Key decision before building — where do photos + facts come from?** birdstation
has none (detections only). Options:
- **Wikipedia / Wikimedia Commons REST API**, keyed by scientific name — free, no
  key, CC-licensed photos + summary. Best coverage; needs attribution.
- **eBird / Macaulay (Cornell)** — birding-grade data + media, but needs an API
  key and has stricter media-use terms.
- **Small curated JSON in-repo** — full control, zero network, but manual work
  per species and doesn't scale as the life list grows.
- *Likely answer:* Wikipedia summary + Commons image at runtime, cached, with a
  tiny local JSON override for any species we want to hand-tune. Settle this
  first, then a `PLAN-observatory-cards.md` can spec the markup/fetch/caching.

Foundation is already in place: cards are rendered per-species in `renderToday()`
/ the life list, `obs-` prefix, vanilla JS — this builds straight on top.

---

## ◷ Soon

### 2. Confidence-tuning follow-ups (life list)
- **Current gate (2026-06-01):** a new species joins the life list only after
  **3 detections in one day at ≥ 0.75**; DB was reset for a clean start.
- **Watch:** see how the 3-hits/day rule feels in practice — a genuinely rare
  flyover heard only once or twice won't list. If that's too strict, consider
  letting hits accumulate across days, or a "provisional vs. confirmed" tier.
- **Later:** per-species thresholds (some calls are easier to ID than others).

### 3. Pulse ingestion — Phase 4 (full design in `PLAN-ingestion.md`)
Generalize ingestion beyond RSS: pluggable adapters (scrape/email/manual), a
separate `events` store + "What's On" surface, AI-as-parser. First sources:
**Emmaus Theater calendar** (scrape) and **Joey Strain's "Bug Club"** email
(paste-to-capture). Decisions settled: separate events store; paste-first email.

---

## ○ Later

### 4. Citation link resolution
Brief citations currently link to Google News RSS redirect URLs (functional but
ugly). Resolve to the publisher's canonical URL when storing the digest.

### 5. Email delivery of the Morning Brief
Deferred from the digest build (we shipped on-page only). Would add SMTP/mail
infra on birdstation — only if "comes to you" is wanted.

### 6. birdstation auto-deploy
A systemd path-unit or cron that runs `git pull` (+ targeted restarts) so deploys
are hands-off instead of manual. Only worth it once the manual rhythm proves a chore.

### 7. Inline citation markers
Optional UX alternative to the per-section `Sources:` line — `[n]` markers woven
into the prose. More fragile; revisit only if the current style feels lacking.

---

## ✓ Done (recent)

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
