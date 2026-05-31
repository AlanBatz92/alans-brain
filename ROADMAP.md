# Roadmap — Alan's Brain

> The running to-do list. Ask "what's on the list?" any time; we (re)prioritize
> here and keep it current. **Convention:** when a feature lands, move it to
> "Done (recent)" with a date and add the matching `Build History.md` entry.
> Detailed designs live in the `PLAN-*.md` docs; this file is the index + status.
>
> Status key: **▶ Next** · **◷ Soon** · **○ Later** · **✓ Done**

---

## ▶ Next

### 1. Trains not recording — diagnose on the box (operational)
The Observatory shows **0 train events** though trains roll through daily. Birds
flow fine over the same shared API/DB, so this is the **detector**, not the front
end — `train_events` is empty. Can't be reached from the cloud session; on the
box (`~/alans-brain`):
- `systemctl status train_detector.service` (is it active? crash-looping?)
- `tail -n 100 ~/train_detector.log` (stream connect OK? any "Whistle candidate"
  / "Train event logged" lines? errors?)
- `ls -la ~/train_clips | tail` and `sqlite3 ~/birdnet.db "SELECT COUNT(*) FROM train_events;"`
- Confirm the Icecast stream URL (`http://192.168.4.132:8000/backyard`) is reachable
  from the box and that the duplicate `traindetect.service` is really gone.
- Likely culprits: service not enabled after cutover; stream IP changed; thresholds
  (`ENERGY_THRESH` 0.10 / `DB_THRESH_DB` -20) too strict for the actual whistles.

### 2. Observatory: hover species overview (comic-book stat card)
On hover/tap of a species card, a richer popover: bird **photo** + key facts
(a few bullet points), then click-through to a fuller detail view. Needs a source
for photos + facts (e.g. a small curated JSON, or Wikipedia/eBird lookup keyed by
scientific name). First real feature build on the grouped-species foundation.

---

## ◷ Soon

### 2. Confidence-tuning follow-ups (life list)
- **Done this session:** added `LIFE_LIST_MIN_CONFIDENCE = 0.70` so noisy
  low-confidence hits no longer create lifers (detections still logged ≥ 0.35).
- **Optional cleanup:** prune existing `lifetime` rows whose best-ever detection
  is below the gate (species lifed during the pre-gate window):
  ```sql
  DELETE FROM lifetime WHERE common_name IN (
    SELECT common_name FROM detections GROUP BY common_name HAVING MAX(confidence) < 0.70
  );
  ```
- **Later:** per-species thresholds, or a "provisional vs. confirmed" life-list tier.

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
