# PLAN — The UAP Shape Census

> Comprehensive guide for future sessions. Read this before touching the
> `ufo-shapes/` toolkit, `ufo-shapes.html`, or `data/ufo-shapes/`.
>
> **What it is:** a narrow, growing census of how UFO/UAP craft are described
> by *shape* (disc, sphere, triangle, cigar, Tic-Tac, egg…) across ingested
> source documents, correlated across sources, presented on the site with every
> mention traceable back to its source.
>
> **Why it exists:** it's a useful artifact in its own right, *and* it's the
> deliberate proving ground / Layer-1-and-2-in-miniature for the larger
> paranormal projects (`The_UAP_Evidence_Cartography_Project.md`,
> `Paranormal_Node_Graph_Architecture.md`). It exercises the full
> ingest → extract → cite → publish loop on the real, vanilla stack before any
> heavier infrastructure is committed to.
>
> **Status:** Phase 0 (scaffold) shipped 2026-06-27. Next steps in the final section.

---

## 1. The architectural decision (read this first)

The two framework docs assume a **Next.js + Supabase + React + Neo4j** stack for
the paranormal section. The *actual* alansbrain.com is **vanilla HTML/CSS/JS,
JSON-driven, no frameworks, no build step, no package manager** (see `CLAUDE.md`
/ `Current State.md`), with local Python doing heavy processing and emitting
committed JSON the static pages read.

**Decision (Alan, 2026-06-27): build the Shape Census on the actual vanilla
pattern, not the framework's aspirational stack.**

- **Process locally** in Python (`ufo-shapes/` toolkit, Dell Optiplex).
- **Emit committed JSON** (`data/ufo-shapes/*.json`) — like `data/train-method.json`.
- **Render with vanilla JS** (`ufo-shapes.html`) reading that JSON via `fetch()` —
  like `observatory.html`.

Supabase / Next.js / Neo4j are deferred — revisit **only if** the dataset
genuinely outgrows static files (tens of thousands of mentions making the JSON
too large to ship, or a need for live server-side queries). The census is partly
a test of whether that heavier stack is ever necessary. So far the answer is "no".

---

## 2. How this seeds the larger projects

| Shape Census (now, vanilla) | Cartography / Node-Graph (later) |
|---|---|
| `sources.json` + reliability tiers | Layer 1 source archive + source discipline |
| `mentions.json` (atomic, cited records) | Layer 2 claims registry |
| `summary.json` → page | Layer 5 public synthesis / public graph |
| methodology panel + honest caveats | the honesty / gap-as-content layer |
| shape × source correlation | a first taste of cross-source/cross-case analysis |
| reliability tier (1–4) on each source | the same Tier 1–4 discipline from the Cartography doc |

The census proves the loop end-to-end. When the bigger project is built, this
data model maps cleanly upward (each shape mention is a tiny, single-field
"claim"; each source already carries its tier). If a publishing-gate /
Supabase migration ever happens, these JSON files are the export source.

---

## 3. Data model

Three committed artifacts under `data/ufo-shapes/`. The page loads `summary.json`
for everything on first paint; `mentions.json` is lazy-loaded only on drill-down.

### `sources.json` — the ingested-source registry (≈ Layer 1)
```jsonc
[{
  "id": "coulthart_inplainsight",   // stable slug, also the sources/<id>/ folder name
  "title": "In Plain Sight",
  "author": "Ross Coulthart",
  "year": 2021,
  "type": "book",                   // book | report | article | case-db
  "format": "epub",                 // epub | pdf | txt
  "reliability_tier": 3,            // 1=primary firsthand … 4=community (Cartography tiers)
  "citation": "Coulthart, In Plain Sight (2021)",
  "url": null,
  "ingested_at": "2026-06-27",
  "segment_count": 4120
}]
```

### `mentions.json` — every shape mention (≈ Layer 2 atomic claims)
```jsonc
[{
  "id": "M000123",
  "source_id": "coulthart_inplainsight",
  "facet": "craft_shape",           // which description facet (craft_shape | humanoid | …) — see §10
  "shape": "disc",                  // canonical id from shapes.json
  "raw_term": "saucer",             // the exact alias matched
  "locator": "p.142",              // p.N (pdf) | para:N (txt) | ch:N#para:M (epub)
  "snippet": "…a metallic saucer hovered above the ridge…",   // the receipt
  "modifiers": ["metallic"],        // descriptive words near the mention
  "confidence": "lexical",          // "lexical" (regex) | "llm-confirmed" (Phase 3)
  "event_date": null                // ISO date of the SIGHTING, if extractable (Phase 4)
}]
```

### `summary.json` — precomputed aggregates for the page
```jsonc
{
  "generated_at": "2026-06-27T00:32:27",
  "taxonomy_version": 1,
  "totals": { "sources": 1, "mentions": 5, "shapes": 5 },
  "by_shape":  [{ "shape":"disc","label":"Disc","icon":"🛸","count":42,"source_count":7 }],
  "by_source": [{ "id":"...","title":"...","year":2021,"reliability_tier":3,"count":120 }],
  "shape_by_source_matrix": {
    "shapes":  ["disc","sphere", ...],
    "sources": ["coulthart_inplainsight", ...],
    "cells":   [{ "shape":"disc","source":"coulthart_inplainsight","count":31 }]
  },
  "top_modifiers":    [{ "term":"metallic","count":58 }],
  "timeline_buckets": [{ "decade":1950,"count":120 }]   // populated once event_date exists
}
```

The `shape_by_source_matrix.cells` array is what powers the **per-source view**
(§5) *without* loading `mentions.json` — clicking a source shows its shape
profile straight from `summary.json`.

---

## 4. The shape taxonomy (`ufo-shapes/shapes.json`)

~10 canonical shapes, **Tic-Tac as its own bucket** (iconic, time-stamped
post-2004 morphology). Each shape has an `id`, `label`, `icon`, `aliases[]`
(matched whole-word, case-insensitive, internal spaces → flexible whitespace +
optional hyphen), and a `disambiguation` note.

Canonical set: **Disc · Sphere/Orb · Triangle · Boomerang/Chevron ·
Cylinder/Cigar · Tic-Tac/Pill · Egg/Ovoid · Cone · Diamond · Cube/Box ·
Other/Unspecified.**

This file is meant to **grow**. When you add or change aliases, bump
`version` — the page surfaces `taxonomy_version` so the data's provenance is
clear. Triangle vs Boomerang and Cigar vs Tic-Tac are kept deliberately
separate; see each shape's `disambiguation` note.

---

## 5. The page (`ufo-shapes.html`)

Vanilla, self-contained styles (a `<style>` block, **`us-` prefix** — like
`sl-`/`pulse-`/`obs-`), reads `data/ufo-shapes/summary.json`. Sections:

1. **Headline stats** — sources · mentions · distinct shapes.
2. **Shape leaderboard** — horizontal bars, most→least.
3. **By source (per-source view)** — *Alan's requested feature.* Click a
   source (e.g. Coulthart's *In Plain Sight*) → it expands to show which shapes
   it references and how often, as count chips. Built from
   `summary.json`'s matrix, no `mentions.json` fetch needed. **First-class, not
   an afterthought.**
4. **Methodology panel** (`<details>`) — how mentions are found + honest caveats
   (high-recall lexical pass, mentions ≠ distinct sightings, read the snippets).
5. *(Phase 1+)* Shape × source **heatmap**, snippet-level **drill-down**
   (the receipts), and *(Phase 4)* a **timeline** by sighting decade.

Currently **not linked in any nav** and shows an empty state until the first
source is ingested — intentional, like `tasks.html`. Link it from
`paranormal.html` (and add a nav entry + a Tech Stack node) when it has real data.

---

## 6. The local pipeline (`ufo-shapes/`)

```
ingest.py  →  sources/<id>/segments.jsonl   (+ register in sources.json)
extract.py →  data/ufo-shapes/mentions.json (regex lexicon over all segments)
build.py   →  data/ufo-shapes/summary.json  (aggregate)
```

Then `git add data/ufo-shapes && commit && push` → live. See `ufo-shapes/README.md`
for exact commands. Stdlib-only except the optional EPUB (`ebooklib` +
`beautifulsoup4`) and PDF (`pymupdf`) extractors, which a future session installs
into a local venv (`.venv/`, gitignored) when the first non-TXT book is processed.

---

## 7. Copyright posture (important)

**Never commit full book text to this public repo.** `ufo-shapes/.gitignore`
keeps `sources/<id>/` (raw text + segments) and loose `*.epub/*.pdf/*.txt` files
local. Only the **derived** data is committed: short snippet quotes (standard
fair-use concordance territory), shape counts, and citations. Keep snippets
short (the extractor caps them at ~280 chars). If a publisher's text ever needs
fuller quoting, reconsider per-source.

---

## 8. What shipped in Phase 0 (2026-06-27)

- `ufo-shapes/` toolkit: `shapes.json` (taxonomy), `ingest.py`, `extract.py`,
  `build.py`, `_common.py`, `README.md`, `.gitignore`, `sources/.gitkeep`.
- `data/ufo-shapes/`: `sources.json`, `mentions.json`, `summary.json` (empty,
  documented schemas).
- `ufo-shapes.html`: vanilla page stub — headline stats, shape leaderboard,
  **per-source drill-down**, methodology panel, empty state. Not yet nav-linked.
- This guide + entries in `Build History.md` / `Current State.md` / `ROADMAP.md`.
- Pipeline smoke-tested end-to-end on a synthetic TXT source (ingest → extract →
  build produced correct stats, matrix, modifiers); test data then cleared.

---

## 9. Next steps (clearly identified for future sessions)

### Phase 1 — first real data + working receipts
- [x] **Validate `ingest.py` against a real EPUB** (2026-06-27) — Coulthart,
      *In Plain Sight* (EPUB, `ebooklib`+`beautifulsoup4`): 2078 segments
      extracted cleanly. PDF path still unverified. Segmenting was good enough
      out of the box; revisit front-matter/index trimming if a noisier book needs it.
- [x] Ingest the **first real book** + calibrate the lexicon (2026-06-27):
      219 mentions across all 10 shapes (Disc 91, Tic-Tac 50, Triangle 34…).
      Eyeballing `mentions.json` caught two false-positive clusters → **taxonomy
      v2** dropped bare `bell` from Cone (22 surname/Bell-Helicopter hits) and
      bare `box`/`square`/`block` from Cube (metaphors). This is the calibration
      loop working as intended.
- [ ] Add **snippet-level drill-down** to `ufo-shapes.html`: clicking a shape (or
      a source's shape chip) lazy-loads `mentions.json`, filters to those
      mentions, and lists snippet + locator + "view source" + tier badge. This is
      "the receipts" and the heart of the per-source idea — going from "what
      shapes are in this source" to "show me the exact passages".
- [ ] Link the page from `paranormal.html`; add it to the Explore nav; add a
      **Tech Stack node** (`techstack.html`) per the repo convention.

### Phase 2 — correlation views
- [ ] **Shape × source heatmap** (reuse the Observatory `obs-an-*` heatmap CSS) —
      the at-a-glance "which shapes cluster in which sources" view.
- [ ] **Top modifiers** display ("metallic", "glowing", "silent") + per-shape
      modifier breakdown.
- [ ] Consider splitting `mentions.json` per-shape (`mentions/<shape>.json`) if it
      gets large, so drill-down stays light.

### Phase 3 — LLM disambiguation (the rigor pass)
- [ ] `classify.py`: for each lexical candidate, a local **Ollama (llama3)** or
      **`claude-haiku-4-5`** call answers "does this describe the shape of a
      craft/object? → keep/drop", sets `confidence: "llm-confirmed"`, fixes the
      canonical shape if the lexical guess was wrong, and **properly attaches
      modifiers to the specific mention** (the lexical pass over-attaches every
      modifier in a paragraph to every mention in it — known limitation).
- [ ] Page shows a confirmed/unconfirmed distinction; methodology panel updated.

### Phase 4 — timeline
- [ ] Extract the **sighting's date** (not the book's) where stated, into
      `event_date`; `build.py` already buckets these by decade. Render a timeline
      (saucers peak 1950s, triangles 1980s+, Tic-Tac post-2004). Directly seeds
      the Cartography interactive-timeline component.

### Later / open questions
- [ ] De-duplication: the same famous case described in ten books counts ten
      times. Decide whether to (and how to) cluster mentions into distinct
      *sightings* — or keep "mentions" as the honest unit and just say so.
- [ ] Cross-link to the eventual node graph (a shape mention ↔ a CLAIM node).
- [ ] Revisit Supabase only if static JSON becomes unwieldy.

---

## 10. Generalizing beyond shapes — the humanoid facet (near-future, Alan 2026-06-27)

This is really a **controlled-vocabulary description census**, of which craft
*shape* is the first facet. Alan wants to extend it to **humanoid / entity
descriptions** next (Greys, tall whites, reptilians, mantids, "Nordics", insectoid,
robotic, etc.), and the stated value is the same for both: **finding connections
across descriptions and terms — surfacing where independent sources converge or
diverge, to build a better consensus understanding of the source material.**

The architecture already generalizes — it was built for this:

- **Taxonomy is just a file.** `shapes.json` is the `craft_shape` facet's
  vocabulary. A future `humanoids.json` is the `humanoid` facet's vocabulary
  (same shape: canonical entity types + aliases + disambiguation). Nothing about
  the matcher is shape-specific.
- **Mentions already carry a `facet` field** (added Phase 0, defaults to
  `craft_shape`). Humanoid mentions get `facet: "humanoid"` and an `entity`
  field (mirroring `shape`).
- **The pipeline parametrizes cleanly.** `extract.py` should grow a
  `--facet`/`--taxonomy` switch so it can run either vocabulary; `build.py`
  should produce per-facet summaries (e.g. `summary.json` keyed by facet, or
  sibling `summary-humanoid.json`).

**When building the humanoid facet:**
1. Author `ufo-shapes/humanoids.json` (consider renaming the toolkit dir to
   something facet-neutral like `descriptions/` at that point, or keep
   `ufo-shapes/` and just add the file — a naming call to make then, not now).
2. Generalize `extract.py` to take a facet + taxonomy path and write the matching
   field (`shape` vs `entity`) — or normalize both to a generic `term` +
   `canonical` pair.
3. Generalize `build.py` to emit per-facet aggregates.
4. Page: either a facet switcher on `ufo-shapes.html` (`🛸 Craft | 👤 Beings`)
   or a sibling `ufo-entities.html`. The per-source view becomes even more
   valuable here — "what does *this* source say beings looked like".
5. **The cross-facet payoff** (the real prize, and where the consensus analysis
   lives): correlate facets *within a source/case* — e.g. "discs co-occur with
   Grey-type descriptions; triangles co-occur with no occupant report at all".
   That co-occurrence analysis is exactly the kind of meaningful pattern the
   larger Cartography/Node-Graph project is for, and the census is where it can
   first be shown cheaply.

Keep Phase 0–4 above focused on craft shape (prove the loop on one facet first);
fold in the humanoid facet once the shape census has real data and the
drill-down/heatmap views are working.
