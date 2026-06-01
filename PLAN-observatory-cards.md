# PLAN — Observatory "comic-book" bird cards

> Status: **design** (2026-06-01). Source decided: **Wikipedia/Wikimedia at
> runtime**. This doc specs the build; update as pieces land, then move the
> ROADMAP item to Done.

## Goal

Make the grouped-species cards come alive in two layers:

1. **Hover / tap → quick card.** A photo + a few punchy facts ("comic-book stat
   card" energy), not a wall of text.
2. **Click through → full detail.** Combines the bird's **facts** (external) with
   its **history here** (our own detections).

## Data sources

- **Facts + photo → Wikipedia / Wikimedia, at runtime.** Decided.
  - Summary + lead image: `GET https://en.wikipedia.org/api/rest_v1/page/summary/{Title}`
    returns `{ title, extract, thumbnail{source}, originalimage{source}, content_urls }`.
    No API key; CORS-enabled; CC BY-SA (needs attribution + link back).
  - Key by **scientific name** first (most precise → the right species), fall back
    to common name. Wikipedia resolves species redirects well.
  - **Attribution is required:** show "via Wikipedia" linking to the article, and
    credit the image. Bake this into the card so we don't forget.
- **History here → our own data.** birdstation stores detections only (no media).
  - Reuse `GET /api/detections?limit=…` or add a small
    `GET /api/species/{name}` returning that species' count, first/last heard,
    confidence series, and per-hour histogram. Prefer the focused endpoint so the
    client isn't pulling the whole detections table.

## Caching (be a good Wikipedia citizen)

- Cache each species' summary in memory for the page session; also `localStorage`
  with a timestamp (e.g. 30-day TTL) so repeat visits don't refetch.
- One request per species, lazily — only when a card is first opened, not on page
  load. Never loop the whole life list at once.
- Optional later: a tiny in-repo `data/bird-overrides.json` to hand-tune or pin a
  better photo/fact for specific species; the fetch checks overrides first.

## UX

- **Mobile-first:** there's no hover on touch, so the interaction is **tap to
  open** a card (a bottom sheet / centered modal), tap-out to close. On desktop,
  hover-intent may *preview*, but click is the reliable open. Build tap first.
- **Quick card contents:** photo, common + scientific name, 2–4 fact chips
  (a one-line `extract` snippet; if we want structured facts like size/range
  later, that's a Wikidata follow-up — keep v1 to the summary), and our
  "heard N times · last <when>" line. A "More" affordance opens detail.
- **Detail view:** larger photo + fuller `extract`, "View on Wikipedia" link,
  then **our history**: total detections, first/last heard, a simple confidence
  sparkline and a by-hour bar (when this bird tends to sing). Reuse the existing
  `obs-` styles and chart-free SVG/CSS bars to stay vanilla.
- **Loading / failure:** skeleton while fetching; if Wikipedia has no match or is
  unreachable, show the name + our history only — never block the card on the
  external call (mirror the page's existing per-section resilience).

## Build order

1. `GET /api/species/{name}` on birdstation (history) + a tiny test.
2. `bird-info.js` (or a section in `observatory.js`): Wikipedia fetch + cache +
   override hook, returning `{photo, extract, url, attribution}`.
3. Quick card UI on the species cards (tap/hover-open), `.obs-card-*` styles.
4. Detail view (modal/route) combining facts + history with the sparkline/hist.
5. Attribution, empty/error states, `localStorage` TTL, cache-bust assets.

## Open questions

- Structured facts (size, diet, range) — Wikipedia `extract` only for v1, or pull
  **Wikidata** claims too? Start with the summary; revisit if it feels thin.
- Do life-list cards and "heard today" cards share one card component? (Should —
  same species identity, same data.)
- Image licensing display: a small "© … / CC BY-SA via Wikimedia" line is enough;
  confirm we're comfortable with that placement.
