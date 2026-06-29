# UAP Shape Census — local toolkit

Local Python tooling that ingests UFO/UAP source documents, finds every
**shape** description (disc, sphere, triangle, cigar, Tic-Tac, egg…), and emits
the cited JSON that `ufo-shapes.html` renders on the site.

Runs **locally** (Dell Optiplex). Raw books stay on your machine; only the
derived, cited JSON under `../data/ufo-shapes/` is committed. Full design,
schemas, and the phase plan live in **`../PLAN-ufo-shapes.md`** — read that first.

> **Adding new sources** (books *or* transcribed interviews)? See the step-by-step
> **[`INGESTING.md`](INGESTING.md)** reference guide.
>
> **Forget a command or hit a git error?** The **[`WORKFLOW.md`](WORKFLOW.md)**
> cheat-sheet has the daily loop + fixes for every error. Run **`python report.py`**
> any time to sanity-check the data (sources, counts, duplicates/empties).

## Ingestion path (do it this way)

1. **Get the book onto the machine running this session — do NOT upload it to
   GitHub.** A GitHub web upload commits the raw (copyrighted) file into the repo
   and bypasses `.gitignore`. Instead drop the EPUB into `ufo-shapes/sources/`
   locally (in a Claude Code session, hand it to the session). The `.gitignore`
   keeps it out of git; only derived JSON is ever committed.
2. **Prefer EPUB.** Born-digital PDF works too (real page numbers); avoid scanned
   PDFs. First time with non-TXT: `pip install ebooklib beautifulsoup4 pymupdf`.

## The loop

```bash
cd ufo-shapes

# 1. Ingest a source → normalized segments + tiered metadata in sources.json
python ingest.py sources/In_Plain_Sight.epub --id coulthart_inplainsight \
    --title "In Plain Sight" --author "Ross Coulthart" --year 2021 \
    --tier 3 --type book --citation "Coulthart, In Plain Sight (2021)" --url ""

# 2. Extract every shape mention across ALL sources → work/mentions.full.json
#    (local only; high + review tiers)
python extract.py

# 2b. (Optional but recommended) AI disambiguation pass: confirm each mention
#     actually describes a craft's shape, drop false positives, pull modifiers.
#     Needs ANTHROPIC_API_KEY + `pip install anthropic`. Resumable + cached.
python classify.py                 # or --engine mock to test plumbing
#     (python classify.py --limit 40   → cheap trial on 40 mentions first)

# 3. PUBLISH GATE: write the committed JSON. Publishes high-confidence +
#    AI-confirmed; reports what it withheld (review-tier, AI-rejected).
python build.py
#    (python build.py --include-review  → also publish the ambiguous lexical tier)

# 4. Commit ONLY the derived data
cd .. && git add data/ufo-shapes ufo-shapes/shapes.json \
  && git commit -m "shape census: add In Plain Sight" && git push
```

### Running just the AI pass on a fresh clone (no books needed)

The disambiguation pass only needs each mention's snippet, which is already in the
committed `data/ufo-shapes/mentions.json`. So on any clone — even one without the
EPUBs or local `work/` segments — you can refine the published set directly:

```bash
cd ufo-shapes
python classify.py            # falls back to the committed mentions.json
python build.py               # re-publishes high + AI-confirmed
cd .. && git add data/ufo-shapes && git commit -m "shape census: AI disambiguation" && git push
```

`extract.py` is the part that needs the books (it scans `sources/<id>/segments.jsonl`,
which are git-ignored and live only where you ingested). You only need `extract.py`
when adding or changing sources.

## The high-confidence gate

You commit **only high-confidence shapes**. How that's enforced:

- Every alias in `shapes.json` is tiered: **`aliases`** (shape-explicit — "flying
  saucer", "cigar-shaped", "tic tac", "diamond-shaped") vs **`review_aliases`**
  (ambiguous common words — "ball", "cube", "delta", "egg", "diamond").
- `extract.py` captures **both** tiers into local `work/mentions.full.json`.
- `build.py` **publishes only the high tier** into `data/ufo-shapes/` and tells
  you what it withheld. The ambiguous hits stay local for inspection.
- To rescue a good ambiguous hit: either move that term into `aliases` in
  `shapes.json` (if it's reliably a craft in your corpus) and re-run, or run
  `build.py --include-review` for a one-off.

### The AI disambiguation pass (`classify.py`)

`classify.py` is the finer gate: it reads each mention's snippet and asks a model
(default **claude-haiku-4-5**) whether it actually describes a craft's shape. It
sets `confidence` to `llm-confirmed` (published) or `llm-rejected` (always
withheld), corrects the canonical shape when the lexical guess was wrong, and
attaches modifiers to that specific mention. It can **promote a good
`review`-tier hit** to published, and **drop a bad `high`-tier hit** — finer than
the per-term tiers. It's resumable (cached in `work/classify_cache.json`, so a
re-run never re-spends) and runs locally with `ANTHROPIC_API_KEY`. Confirmed
passages show a ✓ AI-checked badge in the page's drill-down.

## Files

| File | Role |
|---|---|
| `shapes.json` | The controlled shape vocabulary (canonical shapes + aliases). Grows over time. |
| `ingest.py` | TXT/EPUB/PDF → `sources/<id>/segments.jsonl` + registers metadata. |
| `extract.py` | Lexicon match over all segments → `work/mentions.full.json`. |
| `classify.py` | Optional AI disambiguation pass (Claude Haiku) → confirms/drops mentions. |
| `build.py` | Publish gate → aggregate to `data/ufo-shapes/{mentions,summary}.json` (incl. `terms_by_shape`, the vernacular layer). |
| `candidates.py` | **Grow the vocabulary:** scans local segments for shape-descriptors *not yet in* `shapes.json` ("ice-cream cone", "propane tank"), most frequent first. Report-only, runs locally. |
| `report.py` | Sanity-check the committed data (sources, counts, duplicates/empties). Works on any clone. |
| `_common.py` | Shared paths + JSON/JSONL helpers. |
| `sources/` | Per-source raw text + segments. **Gitignored** (copyright). |

## Format notes

- **EPUB** is best (clean text, chapter structure): `pip install ebooklib beautifulsoup4`
- **PDF** (born-digital, has a text layer) gives real page-number citations: `pip install pymupdf`
- **TXT** works with stdlib alone.
- Scanned/image PDFs need OCR first — out of scope for now.

## Status (2026-06-29)

TXT + **EPUB** validated; the full `ingest → extract → classify → build` loop has run on a real
corpus. **Reframed as a vernacular / zeitgeist census** (how the culture *describes* the phenomenon,
not physical truth) — so the page surfaces the colloquial words under each shape ("described as …",
from `build.py`'s `terms_by_shape`) and `candidates.py` makes the vocabulary easy to grow. Alan is
**rebuilding the corpus from scratch locally** (more sources + Jonathan Weygandt interviews). PDF
(born-digital) path implemented; OCR/scanned PDFs still out of scope. See `../PLAN-ufo-shapes.md`.
