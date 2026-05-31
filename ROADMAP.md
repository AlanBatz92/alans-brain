# Roadmap — Alan's Brain

> The running to-do list. Ask "what's on the list?" any time; we (re)prioritize
> here and keep it current. **Convention:** when a feature lands, move it to
> "Done (recent)" with a date and add the matching `Build History.md` entry.
> Detailed designs live in the `PLAN-*.md` docs; this file is the index + status.
>
> Status key: **▶ Next** · **◷ Soon** · **○ Later** · **✓ Done**

---

## ▶ Next

### 1. Bird & Train Observatory — proof-of-concept front end
A new page on the website (e.g. `observatory.html` / `observatory.js`) that reads
the birdstation API and gives the BirdNET + train data a real home. Worth its own
focused session.
- **Data already available** (all GET, `https://birds.alansbrain.com`):
  `/api/stats`, `/api/today`, `/api/detections?limit=`, `/api/lifetime`,
  `/api/trains/stats`, `/api/trains/recent`, `/api/trains/today`,
  `/api/trains/clips`, and clip audio at `/api/trains/clip/{file}`.
- **POC sections (first cut):** a live "today" detections feed (species, time,
  confidence), the life list, headline stats (total detections/species/today,
  latest), and a train-events list with **playable WAV clips** + train stats.
- **Build for iteration:** modular renderers, vanilla + `pulse-`-style patterns,
  theme variables, graceful offline/empty states (mirror `pulse.js`).
- **Open questions to settle at kickoff:** one combined page vs. separate
  Birds/Trains pages; whether it's linked from the home Explore cards or unlisted;
  how much "live" polling vs. load-once.

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

- **2026-05-31** — Citations UI polish: wrapping `Sources:` lines, collapsible
  Citations block.
- **2026-05-31** — Life-list confidence gate (0.70).
- **2026-05-31** — birdstation cutover to run-from-clone; whole box in git.
- **2026-05-30** — BirdNET CSV-delimiter fix (0 → detections flowing).
- **2026-05-30** — Citations in the Morning Brief (front + back end).
- **2026-05-29** — Daily AI "Morning Brief" (Sonnet 4.6, on-page).
