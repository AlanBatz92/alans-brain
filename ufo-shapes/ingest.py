#!/usr/bin/env python3
"""ingest.py — normalize a source document into located text segments.

Stage 1 of the UAP Shape Census pipeline (see PLAN-ufo-shapes.md).

Whatever the input format (TXT / EPUB / PDF), this produces ONE normalized
representation the rest of the pipeline reads:

    ufo-shapes/sources/<id>/segments.jsonl
        one JSON object per line:
        { "source_id": "...", "locator": "p.42" | "para:17" | "ch:3#para:5",
          "text": "..." }

...and registers the source's metadata (with its reliability tier, per the
Cartography project's source discipline) in data/ufo-shapes/sources.json.

The raw book and the segments stay LOCAL (gitignored). Only the derived,
cited JSON under data/ufo-shapes/ is ever committed. See "Copyright posture"
in PLAN-ufo-shapes.md.

Format support:
  .txt   — works with stdlib alone (splits on blank lines → paragraphs).
  .pdf   — needs PyMuPDF (`pip install pymupdf`); gives real page-number locators.
  .epub  — needs ebooklib + beautifulsoup4 (`pip install ebooklib beautifulsoup4`);
           gives chapter+paragraph locators.

Usage:
  python ingest.py path/to/book.epub --id vallee_passport --title "Passport to Magonia" \
      --author "Jacques Vallee" --year 1969 --tier 3 --type book
  python ingest.py notes.txt --id my_notes        # prompts for any missing metadata

This is a Phase-0 scaffold: the .txt path is exercised and working; the EPUB/PDF
extractors are implemented but UNVERIFIED against real files (that's the Phase 1
validation step). Tune the segmenting once you run a real book through it.
"""
import argparse
import datetime as _dt
import os
import re
import sys

import _common as C


# ── Format extractors → list[(locator, text)] ──────────────────────────────

def extract_txt(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    paras = re.split(r"\n\s*\n", raw)
    out = []
    for i, p in enumerate(paras):
        t = " ".join(p.split())
        if t:
            out.append((f"para:{i}", t))
    return out


def extract_pdf(path):
    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.exit("PDF support needs PyMuPDF: pip install pymupdf  (see PLAN-ufo-shapes.md)")
    out = []
    doc = fitz.open(path)
    for pno in range(len(doc)):
        text = doc[pno].get_text("text")
        t = " ".join(text.split())
        if t:
            # Locator uses 1-based page number for human-friendly citation.
            out.append((f"p.{pno + 1}", t))
    return out


def extract_epub(path):
    try:
        from ebooklib import epub, ITEM_DOCUMENT
        from bs4 import BeautifulSoup
    except ImportError:
        sys.exit("EPUB support needs ebooklib + beautifulsoup4: "
                 "pip install ebooklib beautifulsoup4  (see PLAN-ufo-shapes.md)")
    out = []
    book = epub.read_epub(path)
    ch = 0
    for item in book.get_items_of_type(ITEM_DOCUMENT):
        ch += 1
        soup = BeautifulSoup(item.get_content(), "html.parser")
        paras = soup.find_all(["p", "div"])
        sources = paras if paras else [soup]
        for i, node in enumerate(sources):
            t = " ".join(node.get_text(" ").split())
            if t:
                out.append((f"ch:{ch}#para:{i}", t))
    return out


EXTRACTORS = {".txt": extract_txt, ".pdf": extract_pdf, ".epub": extract_epub}


# ── Metadata ───────────────────────────────────────────────────────────────

def prompt(label, current):
    if current is not None:
        return current
    return input(f"  {label}: ").strip() or None


def main():
    ap = argparse.ArgumentParser(description="Ingest a source into normalized segments.")
    ap.add_argument("file", help="Path to the .txt / .pdf / .epub source")
    ap.add_argument("--id", help="Stable source id (slug, e.g. vallee_passport)")
    ap.add_argument("--title")
    ap.add_argument("--author")
    ap.add_argument("--year", type=int)
    ap.add_argument("--type", default=None,
                    help="book | report | article | case-db (default: book)")
    ap.add_argument("--tier", type=int,
                    help="Reliability tier 1-4 (1=primary firsthand, 4=community). "
                         "See PLAN-ufo-shapes.md / Cartography source discipline.")
    ap.add_argument("--citation", help="Full human-readable citation string")
    ap.add_argument("--url", default=None)
    args = ap.parse_args()

    ext = os.path.splitext(args.file)[1].lower()
    if ext not in EXTRACTORS:
        sys.exit(f"Unsupported format '{ext}'. Supported: {', '.join(EXTRACTORS)}")
    if not os.path.exists(args.file):
        sys.exit(f"No such file: {args.file}")

    print("Source metadata (Enter to skip a field):")
    sid = args.id or input("  id (slug): ").strip()
    if not sid:
        sys.exit("An --id is required.")
    title = prompt("title", args.title)
    author = prompt("author", args.author)
    year = args.year if args.year is not None else (input("  year: ").strip() or None)
    stype = args.type or (input("  type [book]: ").strip() or "book")
    tier = args.tier if args.tier is not None else (input("  reliability tier 1-4: ").strip() or None)
    citation = prompt("citation", args.citation)
    url = prompt("url (optional)", args.url)

    print(f"\nExtracting segments from {args.file} ...")
    segments = EXTRACTORS[ext](args.file)
    rows = [{"source_id": sid, "locator": loc, "text": txt} for loc, txt in segments]
    C.write_jsonl(C.segments_path(sid), rows)
    print(f"  → {len(rows)} segments → {C.segments_path(sid)}")

    sources = C.load_json(C.SOURCES_JSON, []) or []
    sources = [s for s in sources if s.get("id") != sid]  # replace on re-ingest
    sources.append({
        "id": sid,
        "title": title,
        "author": author,
        "year": int(year) if year else None,
        "type": stype,
        "format": ext.lstrip("."),
        "reliability_tier": int(tier) if tier else None,
        "citation": citation,
        "url": url,
        "ingested_at": _dt.date.today().isoformat(),
        "segment_count": len(rows),
    })
    sources.sort(key=lambda s: (s.get("year") or 0, s.get("title") or ""))
    C.write_json(C.SOURCES_JSON, sources)
    print(f"  → registered in {C.SOURCES_JSON}")
    print("\nNext: python extract.py   (then python build.py)")


if __name__ == "__main__":
    main()
