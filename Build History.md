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
