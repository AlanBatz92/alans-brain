# PLAN — Generalized ingestion (Pulse Phase 4)

> Handoff doc. Read `CLAUDE.md`, then `Current State.md` and `Build History.md`
> (local-only) for what's shipped. This file is the design for the next phase:
> bringing in non-RSS sources (web-scraped calendars, email newsletters,
> one-off announcements) without sacrificing maintainability or robustness.

## Why

Today Pulse has exactly one way in: RSS rows in `feed_sources`, fetched by
`pulse_fetch.py` on a timer. Everything downstream is solid and must be left
intact — the **spine**: `dedup → AI enrich (tag + summary) → filter/search →
auto-delete → daily digest`. The work is entirely at the front door.

Concrete motivating sources:
- **Emmaus Theater calendar** — a web page, no RSS. Future-dated *events*.
- **Joey Strain's "Bug Club"** — a monthly email Alan receives. Event-ish.
- **One-off announcements** — a flyer, a URL someone sends, etc.

## Core idea: pluggable adapters feeding one spine

Generalize the front door into **adapters**. Each adapter turns one *kind* of
source into the normalized item shape the spine already expects
(`{title, link, published, body, source_key}`), then hands off unchanged.

```
feed_sources row ──► adapter (by type) ──► normalized items ──► [dedup → enrich → store → serve]
  rss    │ {url}             fetch_rss
  scrape │ {url, hint?}      fetch_scrape   ← AI extracts from HTML
  email  │ {match…}          fetch_email    ← AI extracts from message body (Phase 4c)
  manual │ —                 pulse_add       ← AI extracts from pasted text/URL
```

`pulse_fetch.py` becomes a dispatcher: `ADAPTERS[source.type](source.config)`.
- New *kind* of source = one new adapter function.
- New *instance* = one `feed_sources` row (same as today).
- One source failing never touches the others (already true — keep it).

## The robustness principle: AI is the parser

For `scrape` and `email`, **do not write CSS selectors or regex.** Fetch the
raw HTML/text, hand it to Claude with a Pydantic schema, and let
`messages.parse()` extract structured items — the exact pattern already used by
`pulse_enrich`/`pulse_digest`.

- Maintainable: no selectors to babysit; site redesigns don't break us.
- Robust: the model reads the page like a person.
- Cheap: these sources are low-frequency. **Content-hash the fetched payload
  and only call Claude when it changed** → a handful of calls a month.

Model: `claude-sonnet-4-6` (matches the digest; structured output + adaptive
thinking). Haiku is fine for high-volume tagging; extraction wants Sonnet.

## Data model: news vs. events (DECIDED: separate)

Future-dated content gets its **own `events` table** and a **"What's On"
surface**, fed by the same adapters. Rationale: theater shows / Bug Club /
voting dates aren't news that ages out after N days — they age out *after the
event date passes*, and deserve a persistent home, not a one-morning mention.

- `feed_items` — time-sensitive news (existing auto-delete rules unchanged).
- `events` — future-dated happenings.

```sql
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY,
    source_key  TEXT,
    title       TEXT NOT NULL,
    start_date  TEXT NOT NULL,   -- ISO date/datetime
    end_date    TEXT,
    location    TEXT,
    detail      TEXT,
    url         TEXT,
    content_hash TEXT,           -- dedup / idempotent re-scrape
    added_at    TEXT NOT NULL,
    active      INTEGER DEFAULT 1
);
```

A **router** sends each adapter output to `feed_items` or `events` based on the
source's declared `content_kind` (add a column to `feed_sources`, default
`'news'`; Emmaus Theater = `'events'`). This subsumes the earlier `civic_dates`
idea — voting dates are just `events` rows (manually seeded).

Auto-delete for events: drop rows where `end_date` (or `start_date`) is past.

## feed_sources changes

Add `type` (`'rss'|'scrape'|'email'`), `config` (JSON, type-specific params),
and `content_kind` (`'news'|'events'`). Existing rows migrate to
`type='rss', config={"url": <old url>}, content_kind='news'`.

## Adapters

- **rss** — existing feedparser path, moved behind the dispatcher. No behavior change.
- **scrape** — GET url → reduce to text → Claude → `list[ExtractedItem]`
  (`title, date?, url, detail`). Cache by content hash; skip Claude if unchanged.
  Emmaus Theater is the first instance (`content_kind='events'`).
- **email (Phase 4c, deferred)** — automated mailbox poll. NOT built first
  (see below). When built: a Gmail filter forwards/labels target mail to a
  `pulse` label; `pulse_email.py` polls IMAP; body → Claude → items/events.
  Needs mail creds on birdstation — defer until paste-capture proves annoying.

## Streamlined "add content" — two modes by cadence

- **Recurring/automated** → a `feed_sources` row (`rss`/`scrape`). Set once.
- **Ad-hoc / one-off** → **`pulse_add` capture tool** (DECIDED: this is the
  email path for now too). Give it a URL *or* pasted text (the Bug Club email,
  a flyer's text); Claude structures it into an item/event and inserts it. No
  SQL, no source row. Start as a ~20-line CLI on birdstation; a tiny admin page
  can come later.

Coverage check: Emmaus = `scrape` source row → `events`. Bug Club = paste into
`pulse_add` (→ `events`) now; automated `email` adapter later. Random poster =
`pulse_add` with the URL/text.

## Health & isolation

Extend the per-source health strip to every adapter type: `last_run`,
`last_ok`, `last_error`, `items_found`. AI-extraction failures surface as a
source error, never a crash. Dedup by stable key (link or `content_hash`) so
re-scraping is idempotent.

## Website surface

- New **"What's On" section** on `pulse.html` (and/or homepage), fed by a new
  `GET /api/events?upcoming=1`. Mirrors the existing feed rendering conventions
  (`pulse.js`, vanilla, `pulse-` prefix). The daily digest can also be handed
  the upcoming `events` so the morning brief becomes civic/event-aware
  (pass them as a second labeled block to `pulse_digest.py`).

## Recommended build order

1. **4a — Adapter refactor + first event source.** Add `type`/`config`/`content_kind`
   to `feed_sources`; move RSS behind the dispatcher (no behavior change; verify
   existing feeds still flow); add the `events` table + router. **First real source:
   Archer Music Hall via the `api` adapter (Ticketmaster Discovery API)** — see the
   2026-06-04 field finding; it's the testable, rot-resistant path. Build the
   `scrape` adapter (AI-as-parser, hash-caching) next, when a no-API source comes up.
2. **4b — Surfaces.** `GET /api/events`, the "What's On" card, and feed
   upcoming events into the digest. Manually seed a few `events` (voting dates).
3. **4c — `pulse_add` capture CLI.** Paste URL/text → Claude → insert. Covers
   Bug Club manually and every one-off.
4. **4d (optional, deferred) — automated `email` adapter** via IMAP, only if
   the manual paste step proves tedious.

## Field finding (2026-06-04): HTML scraping is mostly blocked → prefer APIs

Before adding the first real event source (Archer Music Hall, Allentown), each
candidate page was tested with a plain server-side fetch. **All of them return
HTTP 403 Forbidden to a non-browser client:**

- `archermusichall.com/shows` (official) — 403
- Bandsintown, JamBase, Concertfix, SeatGeek venue pages — all 403

These sites sit behind bot protection (Cloudflare/Akamai-style). A server fetch
(or feedparser/requests on the box) gets the same wall. Lesson, consistent with
the "thoroughly test each source" rule: **don't assume a page is scrapable —
verify with a real fetch first, and prefer a structured API when one exists.**
The same wall applies to the hallucination work — blindly scraping news-article
bodies for fuller context will 403 on many publishers, so the first move there
was to stop discarding the full text feeds already provide (see Build History
2026-06-04), not to add a scraper.

### New adapter type: `api`

Add an **`api`** adapter alongside `rss`/`scrape`/`email`. It calls a documented
JSON API and maps the response straight to the normalized item/event shape — **no
AI parser needed** (the data is already structured, so there's nothing to
hallucinate). This is strictly more robust than `scrape` when an API exists; reach
for `scrape` (AI-as-parser) only when there's no API and the HTML is fetchable.

### First event source: Archer Music Hall via the Ticketmaster Discovery API

Archer Music Hall is a Live Nation / Ticketmaster venue, so its calendar is
available through the **Ticketmaster Discovery API** — free key, 5000 calls/day,
5 req/s, clean JSON.

- **Venue id:** Ticketmaster `KovZ917AYeX` (a.k.a. site venue `393388`). Confirm
  on first call by name/city rather than hardcoding blindly.
- **Endpoint:** `GET https://app.ticketmaster.com/discovery/v2/events.json`
  `?venueId=KovZ917AYeX&sort=date,asc&size=100&apikey=<KEY>`
- **Map** `_embedded.events[]` → `events` rows:
  `title=name`, `start_date=dates.start.dateTime||localDate`, `url=url`,
  `location="Archer Music Hall, Allentown"`,
  `detail=classifications/genre + room if present`,
  `content_hash=sha1(id+start_date)` (idempotent re-sync; TM `id` is stable).
- **Key handling:** `TICKETMASTER_API_KEY` in `/etc/birdstation.env` (chmod 600,
  `EnvironmentFile=`), never committed — same pattern as `ANTHROPIC_API_KEY` /
  `BIRD_API_KEY`. Adapter no-ops with a clear `last_error` if the key is absent,
  so the box never crashes on a missing key.
- **`feed_sources` row:** `key='archer'`, `label='Archer Music Hall'`,
  `type='api'`, `content_kind='events'`,
  `config={"provider":"ticketmaster","venue_id":"KovZ917AYeX"}`.
- **Cadence:** low — a daily (or twice-daily) timer is plenty; concert calendars
  don't change by the minute. Content-hash so a re-sync that returns the same
  events is a no-op.

This replaces "Emmaus Theater (scrape)" as the *first* events source to build,
precisely because the API path is testable and won't rot. Emmaus Theater stays
the canonical `scrape` example for when no API exists (test its fetchability
first).

## Conventions to honor (see CLAUDE.md / Current State.md)

- Vanilla HTML/CSS/JS, no frameworks/build step. `pulse-` prefix on the page.
- Reuse the `messages.parse()` + Pydantic structured-output pattern from
  enrich/digest. Keep adapters isolated and individually health-reported.
- After landing each phase: append to `Build History.md`, revise
  `Current State.md`.
