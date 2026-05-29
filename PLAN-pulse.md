# PLAN — Pulse on Alan's Brain

A Lehigh Valley news/"pulse" feed, re-homed from the birdstation Python design
(`LEHIGH_VALLEY_PULSE_BUILD.md` / Pulse Deployment Runbook) onto the Alan's Brain
website. Start with a small, shippable win today; build up to the full product.

## Context: why this isn't the runbook

The runbook deploys Pulse on **birdstation** — Python 3.12, SQLite, systemd
timers, an always-on box at `192.168.4.132`. Alan's Brain is the opposite: a
**no-build static site on Vercel** — vanilla HTML/CSS/JS, JSON files in `data/`,
and serverless proxies in `api/` for CORS. There is no persistent disk and no
always-on process here.

Decisions made (2026-05-29):
- **Architecture:** native web rebuild. Pulse becomes a real page on the site
  (`pulse.html` + `pulse.js`) plus a serverless feed proxy (`api/pulse-feed.js`).
  No separate server. The birdstation Python stack is *not* used.
- **Storage:** decide later. Phase 0 does a live client-side fetch with no
  storage. We choose the persistence model (commit-to-repo via Vercel Cron, or
  Vercel KV/Blob) only after we've watched the feeds behave — the runbook's
  "walk away 24–48h and see which feeds are broken" beat, adapted to this stack.

## Conventions to match (from CLAUDE.md / Current State)

- Vanilla HTML/CSS/JS. No frameworks, no build step, no package manager.
- Serverless proxies live in `api/` and exist purely for CORS (see
  `api/setlist.js` — query-param driven, sets `Access-Control-Allow-Origin: *`).
- JSON-driven pages: `fetch()` a data file, render in JS (see `gallery.js`).
- Theme variables (`--bg`, `--surface`, `--text`, `--green`, …) at top of
  `style.css`; reuse them, don't hardcode colors.
- New page uses a `pulse-` prefix for IDs/classes (cf. setlist's `sl-`).
- Register the page in `index.html` Explore cards, `projects.html`, and the
  README page table.

---

## Phase 0 — Small win TODAY: live headlines page

Goal: prove the pipeline **feed → serverless proxy → rendered page** works on the
live site, end to end, with zero storage and zero AI.

1. **`api/pulse-feed.js`** — a CORS proxy modeled on `api/setlist.js`. Takes a
   `?url=` query param (allow-listed to the known Lehigh Valley sources so it
   can't be used as an open proxy), server-side `fetch`es the RSS/Atom XML,
   returns it with permissive CORS headers. Returns the raw XML (parsing happens
   client-side) or pre-parsed JSON — pick raw XML to keep the function dumb.
2. **`pulse.html`** — page shell matching the site's existing header/footer/theme
   markup (copy the structure from an existing page like `weather.html`).
3. **`pulse.js`** — for each source, fetch via the proxy, parse the XML with the
   browser's `DOMParser`, normalize to `{title, link, source, published}`, merge,
   sort by date desc, render a clean list. Show per-source error states inline
   (the runbook's `last_status` idea, surfaced in the UI instead of a DB column).
4. **Seed sources** — the runbook's six: `lehighvalleynews`, `wfmz`,
   `morningcall`, `pa-governor`, `fema-pa`, plus room for more. Start with the
   2–3 that have known-good RSS URLs; mark the rest as "to verify."
5. **Link it in** — add a card to `index.html` and `projects.html`.

Acceptance (Phase 0): visiting `pulse.html` on the deployed site shows recent
real headlines from at least 2 working sources, with broken feeds shown as a
visible per-source error rather than a blank page.

Deliverable today: a working page on a branch, ready to merge/deploy.

---

## Phase 1 — Persistence + scheduled refresh (after we watch the feeds)

Trigger: once Phase 0 has run for a day or two and we know which feeds are
healthy. Then pick the storage model (deferred decision above) and implement:

- A scheduled fetch (Vercel Cron) that pulls all healthy feeds.
- URL-based dedupe (the runbook's core dedupe guarantee).
- Snapshot written to either `data/pulse.json` (git-committed) or Vercel KV/Blob.
- The page reads the snapshot instead of live-fetching, so it loads instantly and
  doesn't hammer sources on every visit.
- A lightweight "source health" view (port of `manage.py list-sources`).

## Phase 1.5 — Email / newsletter sources (optional)

The runbook ingests newsletters via IMAP. On this stack that'd be a serverless
endpoint or a small ingest step that reads a dedicated inbox. Defer unless wanted.

## Phase 2 — AI tagging + summaries

The runbook's `enrich.py`, re-homed: a serverless endpoint (or the cron job)
calls the Anthropic API to tag and summarize new articles. The API key lives in a
Vercel env var, never in the browser (same discipline as the Spotify PKCE flow —
no secrets client-side). Run it over a handful of articles first, eyeball the
tags, tune the prompt, then ramp. Acceptance mirrors the build doc's gate.

## Phase 3 — Polish

Filters by tag/source, search, "persistent" sources that don't age out (the
runbook's `--persistent` flag → archive), purge/retention for the rest.

---

## Risks / open questions

- **RSS URL rot** — the runbook explicitly warns feeds break. Phase 0 surfaces
  this immediately via per-source error UI; verify each URL as we add it.
- **Open-proxy abuse** — `api/pulse-feed.js` must allow-list source domains.
- **Storage choice** — deferred; revisit at Phase 1 with real feed behavior.
- **Vercel Cron** — needs a `vercel.json` (none exists yet); introduced only at
  Phase 1, not today.
