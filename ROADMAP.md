# Roadmap — Alan's Brain

> The running to-do list. Ask "what's on the list?" any time; we (re)prioritize
> here and keep it current. **Convention:** when a feature lands, move it to
> "Done (recent)" with a date and add the matching `Build History.md` entry.
> Detailed designs live in the `PLAN-*.md` docs; this file is the index + status.
>
> Status key: **▶ Next** · **◷ Soon** · **○ Later** · **✓ Done**

---

## ▶ Next

### 1. Observatory: "comic-book" bird cards — **steps 1–3 + polish done**  (design: `PLAN-observatory-cards.md`)
Quick-card modal is live: Wikipedia photo (full bird visible, not cropped),
filtered description, word-boundary extract, comic-book stats grid (Heard Here /
Best ID / First Heard / Last Heard), sort controls on both species grid and life
list. **Remaining:** step 4 — detail view (larger photo + full extract + confidence
sparkline + by-hour bar chart).

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
- **Current gate (2026-06-01):** a new species joins the life list only after
  **3 detections in one day at ≥ 0.75**; DB was reset for a clean start.
- **Watch:** see how the 3-hits/day rule feels in practice — a genuinely rare
  flyover heard only once or twice won't list. If that's too strict, consider
  letting hits accumulate across days, or a "provisional vs. confirmed" tier.
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
