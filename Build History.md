# Build History

> Chronological record of feature work and decisions. Append a dated entry
> after landing each feature; keep `Current State.md` in sync.
>
> **Backfill note:** this log was started 2026-05-30. Pre-2026-05 feature
> history lives in the per-feature implementation docs (`Spotify Setlist Tools
> Implementation.md`, `Task Tracker Write-Back Implementation.md`) and the
> `PLAN-*.md` files — pull entries forward into this log as you revisit them.

---

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
