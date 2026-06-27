# UAP Shape Census — local toolkit

Local Python tooling that ingests UFO/UAP source documents, finds every
**shape** description (disc, sphere, triangle, cigar, Tic-Tac, egg…), and emits
the cited JSON that `ufo-shapes.html` renders on the site.

Runs **locally** (Dell Optiplex). Raw books stay on your machine; only the
derived, cited JSON under `../data/ufo-shapes/` is committed. Full design,
schemas, and the phase plan live in **`../PLAN-ufo-shapes.md`** — read that first.

## The loop

```bash
cd ufo-shapes

# 1. Ingest a source → normalized segments + metadata in sources.json
python ingest.py /path/to/book.epub --id coulthart_inplainsight \
    --title "In Plain Sight" --author "Ross Coulthart" --year 2021 \
    --tier 3 --type book --citation "Coulthart, In Plain Sight (2021)"

# 2. Extract every shape mention across ALL ingested sources (regex/lexicon)
python extract.py

# 3. Aggregate into the page's summary.json
python build.py

# 4. Publish
cd .. && git add data/ufo-shapes && git commit -m "shape census: add In Plain Sight" && git push
```

## Files

| File | Role |
|---|---|
| `shapes.json` | The controlled shape vocabulary (canonical shapes + aliases). Grows over time. |
| `ingest.py` | TXT/EPUB/PDF → `sources/<id>/segments.jsonl` + registers metadata. |
| `extract.py` | Lexicon match over all segments → `data/ufo-shapes/mentions.json`. |
| `build.py` | Aggregate → `data/ufo-shapes/summary.json`. |
| `_common.py` | Shared paths + JSON/JSONL helpers. |
| `sources/` | Per-source raw text + segments. **Gitignored** (copyright). |

## Format notes

- **EPUB** is best (clean text, chapter structure): `pip install ebooklib beautifulsoup4`
- **PDF** (born-digital, has a text layer) gives real page-number citations: `pip install pymupdf`
- **TXT** works with stdlib alone.
- Scanned/image PDFs need OCR first — out of scope for now.

## Status: Phase 0 (scaffold)

The TXT path and `extract.py`/`build.py` are exercised and working. The EPUB/PDF
extractors are implemented but **not yet validated against a real file** — that's
the Phase 1 first task. See `../PLAN-ufo-shapes.md` § "Next steps".
