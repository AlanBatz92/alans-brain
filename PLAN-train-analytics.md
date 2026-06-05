# PLAN — Train analytics (Analytics tab, Birds | Trains toggle)

> Status: **designed, not started** (2026-06-05). Front-end scaffolding can land
> ahead of data; the box endpoint + real charts wait on the train detector
> producing a useful volume of **vetted** events. Keep this doc in sync as pieces
> land (mirror the convention in `PLAN-train-vetting.md`).

## Why

The Analytics tab (`📊`, shipped 2026-06-04) is bird-only. Trains have their own
rich, regular signal — when do they pass, how long, how loud, how often — that
deserves the same treatment. The goal is a **`Birds | Trains` toggle** at the top
of the Analytics tab that swaps the dataset and re-renders, reusing as much of the
existing chart machinery as possible.

This is **gated on train data**: the detector must be producing events and they
must be **human-vetted** (only `verdict='train'` is ever public — see
`PLAN-train-vetting.md`). Until there's a meaningful vetted volume, build only the
front-end scaffold (the toggle + empty/“coming soon” states) and leave the box
endpoint as the last step.

## Privacy (non-negotiable)

Same default-deny posture as the rest of the train surface: **only approved
(`verdict='train'`) events are ever counted or shown.** The analytics endpoint
filters server-side, and (defense in depth) the front-end treats any
non-approved row as if it doesn't exist. No clip audio is involved in analytics,
so there's no new clip-exposure surface — but the counts themselves must still be
approved-only so a pending/false event can't leak "something happened at 2am".

## Data model (existing — no migration needed)

`train_events`: `id, detected_at, duration_s, peak_db, clip_path, reviewed,
verdict`. Everything analytics needs is already there:

- `detected_at` — timestamp (carries an offset; **not** naive-UTC like bird
  detections, so the Eastern bucketing differs slightly — see below).
- `duration_s` — how long the pass sustained.
- `peak_db` — loudness of the pass.
- `verdict='train'` — the approved gate.

## What's reusable vs. new

The Analytics tab is already componentized (`state.an`, `obs-an-*`,
`loadAnalytics()`, the period selector, the custom hover tooltip, the dawn/chorus
sun shading is bird-only). Mapping bird → train:

| Component | Birds (today) | Trains |
|---|---|---|
| Summary stat cards | Detections / Species / Busiest hour / Peak day | **Trains / Busiest hour / Avg duration / Loudest** |
| 24-hour activity chart | detections per Eastern hour | **train passes per Eastern hour** (reuse `renderHourChart`, drop the sun shading) |
| Species × hour heatmap | per-species daily pattern | **day-of-week × hour heatmap** (7 rows × 24 cols — commuter vs. freight rhythm) |
| Most-heard leaderboard | top species by count | *(no taxonomy)* → repurpose as **longest / loudest passes**, or omit |
| Per-day activity chart | detections per day | **passes per day** (reuse `renderDaily` directly) |

New train-only visuals worth adding:
- **Duration distribution** — histogram of `duration_s` (short freight vs. long).
- **Loudness distribution** — histogram of `peak_db`, with a "loudest pass" callout.
- **Headway** — gaps between consecutive passes ("typical wait", "longest gap").
  Computed from sorted `detected_at` deltas.

## Backend — `GET /api/trains/analytics`

Mirror `GET /api/analytics` (the bird one) in shape and Eastern-bucketing
approach, but over `train_events` and **approved-only**.

```
GET /api/trains/analytics?start=<utc>&end=<utc>
  → {
      start, end,
      total_trains,
      by_hour[24],                 // Eastern hour-of-day
      by_dow_hour[7][24],          // day-of-week × hour (Mon..Sun) heatmap
      by_day[] {date, count},      // Eastern day volume
      durations {avg, max, buckets[]},   // duration_s summary + histogram
      peak_db   {avg, max, buckets[]},   // loudness summary + histogram
      headway   {avg_s, max_s},          // gaps between passes
      busiest_hour, peak_day, loudest {detected_at, peak_db}
    }
```

Notes for the implementer:
- **Approved gate:** `WHERE verdict='train'` on every aggregation.
- **Eastern bucketing:** bird `/api/analytics` groups on `substr(timestamp,1,13)`
  because bird rows are naive-UTC; **train `detected_at` carries an offset**, so
  either normalize with `datetime(detected_at)` (SQLite understands the offset and
  yields UTC) then fold to Eastern via the existing `eastern_parts()` helper, or
  parse the offset in Python. Verify against a known pass before trusting buckets.
- **Day-of-week** is derived from the Eastern date (after bucketing), Mon=0.
- The same Eastern→UTC window the period selector already sends to
  `/api/detections/grouped` / `/api/analytics` is reused unchanged.
- Add box-side tests mirroring `test_analytics_endpoint.py` (Eastern boundary,
  approved-only exclusion, headway/duration math, empty range).

## Front-end

- **Toggle:** a `Birds | Trains` segmented control beside the Analytics period
  selector. New state: `state.an.mode ∈ {'birds','trains'}` (default `'birds'`).
- `loadAnalytics()` branches on `mode`: birds → `/api/analytics` (today's path,
  unchanged); trains → `/api/trains/analytics`. Swap the section set:
  - Shared: stat cards, hour chart, per-day chart (different inputs).
  - Birds-only: species heatmap, leaderboard, **sun shading** on the hour chart.
  - Trains-only: day-of-week×hour heatmap, duration & loudness histograms,
    headway card.
- Hide/show the right sections per mode (the panels already toggle cleanly).
- Reuse the custom `.obs-an-tip` hover tooltip — give train cells/bars their own
  `data-tip` text (e.g. "Tue 5 PM — 3 passes", "Pass · 47 s · 72 dB").
- **Empty / pre-data state:** if `total_trains` is 0 (no vetted data yet), show a
  friendly "No confirmed train passes in this period yet" rather than blank charts.
- Cache-bust `observatory.js` / `style.css` as usual; `obs-an-*` prefix continues.

## Build order

1. **Scaffold (no data needed):** add the `Birds | Trains` toggle + `state.an.mode`,
   branch `loadAnalytics`, stub the trains branch to the empty state. Ships today,
   inert until the endpoint exists.
2. **Box endpoint:** `GET /api/trains/analytics` (approved-only, Eastern buckets) +
   tests. Verify Eastern bucketing against a real `detected_at` offset.
3. **Train charts:** hour chart + per-day (reused), day-of-week×hour heatmap,
   duration/loudness histograms, headway card, stat cards.
4. **Polish:** tooltips, empty states, mobile scroll for the new heatmap.
5. **Stretch:** overlay train passes on the *bird* hour chart — do the birds quiet
   down when a train rolls through? (A genuinely novel cross-analysis once both
   datasets are solid.)

## Dependencies

- Train detector producing events at a usable cadence (currently sparse).
- A vetting rhythm so approved events accumulate (`review_trains.py`, or the
  future passphrase-gated web review in `PLAN-train-vetting.md`).
