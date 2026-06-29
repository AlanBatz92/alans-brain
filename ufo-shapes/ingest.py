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
  .md    — markdown (stdlib alone); strips the markup → clean prose paragraphs.
           (.markdown too.) Handy for OCR'd/converted books saved as markdown.
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


def strip_markdown(raw):
    """Markdown → plain prose. Strips the common syntax (headings, emphasis,
    list/quote markers, link/image URLs, code fences, tables, raw HTML) so the
    snippets read naturally instead of carrying #/**/[]() clutter. Stdlib-only;
    keeps the visible text, drops only the markup."""
    # drop fenced code blocks entirely (``` … ``` or ~~~ … ~~~)
    raw = re.sub(r"(?ms)^[ \t]*(```|~~~).*?^[ \t]*\1[ \t]*$", "", raw)
    lines = []
    for line in raw.split("\n"):
        # horizontal rules / setext underlines (---, ===, ***) → paragraph break
        if re.match(r"^[ \t]*([-*_=])\1{2,}[ \t]*$", line):
            lines.append("")
            continue
        # table separator rows (|---|:--:|) → drop
        if "-" in line and re.match(r"^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$", line):
            continue
        line = re.sub(r"^[ \t]*>+[ \t]?", "", line)            # blockquote marker
        line = re.sub(r"^[ \t]*#{1,6}[ \t]+", "", line)        # ATX heading hashes (keep title text)
        line = re.sub(r"^[ \t]*(?:[-*+]|\d+[.)])[ \t]+", "", line)  # list markers
        line = line.replace("|", " ")                          # table cell pipes
        lines.append(line)
    text = "\n".join(lines)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)      # image  ![alt](url) → alt
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)       # link   [text](url) → text
    text = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", text)      # reference link → text
    text = re.sub(r"</?[a-zA-Z][^>\n]*>", "", text)            # raw HTML tags
    text = re.sub(r"[*_`~]+", "", text)                        # emphasis/code/strike markers
    text = re.sub(r"\\([\\`*_{}\[\]()#+.!>~-])", r"\1", text)  # unescape \* \_ …
    return text


def extract_md(path):
    """Markdown source → paragraphs (markdown stripped, then split like .txt)."""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    paras = re.split(r"\n\s*\n", strip_markdown(raw))
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


EXTRACTORS = {".txt": extract_txt, ".md": extract_md, ".markdown": extract_md,
              ".pdf": extract_pdf, ".epub": extract_epub}


# ── Metadata ───────────────────────────────────────────────────────────────

def prompt(label, current):
    if current is not None:
        return current
    return input(f"  {label}: ").strip() or None


def slugify(path):
    base = os.path.splitext(os.path.basename(path))[0]
    s = re.sub(r"[^a-z0-9]+", "_", base.lower()).strip("_")
    return (s[:60] or "source")


def register_and_extract(path, meta):
    """Extract a single file to segments + register it in sources.json.

    Returns True if the source was ingested, False if it yielded no text and was
    skipped (so callers don't count it).
    """
    ext = os.path.splitext(path)[1].lower()
    print(f"\nExtracting segments from {os.path.basename(path)} ...")
    segments = EXTRACTORS[ext](path)
    sid = meta["id"]
    rows = [{"source_id": sid, "locator": loc, "text": txt} for loc, txt in segments]

    if not rows:
        # No extractable text — don't pollute sources.json with an empty source.
        print(f"  ⚠ 0 extractable text segments — NOT registered.")
        if ext == "pdf":
            print("    This PDF has no text layer (it's a scanned/image PDF). It needs OCR")
            print("    before it can be ingested — or find a text-based copy.")
        elif ext == "epub":
            print("    This EPUB has no extractable text (image-based/scanned, or DRM-wrapped).")
            print("    Try a text-based copy, or convert it (e.g. Calibre) first.")
        else:
            print("    The file appears to be empty or has no readable text.")
        return False

    C.write_jsonl(C.segments_path(sid), rows)
    print(f"  → {len(rows)} segments → {C.segments_path(sid)}")

    sources = C.load_json(C.SOURCES_JSON, []) or []
    sources = [s for s in sources if s.get("id") != sid]  # replace on re-ingest
    sources.append({
        "id": sid,
        "title": meta.get("title"),
        "author": meta.get("author"),
        "year": int(meta["year"]) if meta.get("year") else None,
        "type": meta.get("type") or "book",
        "format": ext.lstrip("."),
        "reliability_tier": int(meta["tier"]) if meta.get("tier") else None,
        "citation": meta.get("citation"),
        "url": meta.get("url"),
        "file": os.path.basename(path),       # lets --all skip already-ingested files
        "ingested_at": _dt.date.today().isoformat(),
        "segment_count": len(rows),
    })
    sources.sort(key=lambda s: (s.get("year") or 0, s.get("title") or ""))
    C.write_json(C.SOURCES_JSON, sources)
    print(f"  → registered '{sid}' in {C.SOURCES_JSON}")
    return True


def prompt_meta(path):
    """Interactively collect metadata for one book; returns dict or None to skip."""
    default_id = slugify(path)
    print(f"\n── {os.path.basename(path)} ──")
    sid = input(f"  id (slug) [{default_id}] (or 's' to skip): ").strip() or default_id
    if sid.lower() == "s":
        print("  skipped.")
        return None
    return {
        "id": sid,
        "title": input("  title: ").strip() or None,
        "author": input("  author: ").strip() or None,
        "year": input("  year: ").strip() or None,
        "type": input("  type [book]: ").strip() or "book",
        "tier": input("  reliability tier 1-4: ").strip() or None,
        "citation": input("  citation: ").strip() or None,
        "url": input("  url (optional): ").strip() or None,
    }


def find_books():
    out = []
    for name in sorted(os.listdir(C.SOURCES_DIR)):
        p = os.path.join(C.SOURCES_DIR, name)
        if os.path.isfile(p) and os.path.splitext(name)[1].lower() in EXTRACTORS:
            out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser(description="Ingest source document(s) into normalized segments.")
    ap.add_argument("file", nargs="?", help="Path to a single .txt / .md / .pdf / .epub source")
    ap.add_argument("--all", action="store_true",
                    help="Batch mode: interactively ingest every new book in ufo-shapes/sources/.")
    ap.add_argument("--reingest", action="store_true",
                    help="With --all, also re-process files already in sources.json.")
    ap.add_argument("--id", help="Stable source id (slug). Single-file mode only.")
    ap.add_argument("--title")
    ap.add_argument("--author")
    ap.add_argument("--year", type=int)
    ap.add_argument("--type", default=None, help="book | report | article | case-db (default: book)")
    ap.add_argument("--tier", type=int, help="Reliability tier 1-4 (1=primary firsthand … 4=community).")
    ap.add_argument("--citation", help="Full human-readable citation string")
    ap.add_argument("--url", default=None)
    args = ap.parse_args()

    # ── Batch mode ──────────────────────────────────────────────────────────
    if args.all:
        books = find_books()
        if not books:
            sys.exit(f"No .txt/.md/.epub/.pdf files found in {C.SOURCES_DIR}")
        done = {s.get("file") for s in (C.load_json(C.SOURCES_JSON, []) or [])}
        todo = [b for b in books if args.reingest or os.path.basename(b) not in done]
        skipped = len(books) - len(todo)
        print(f"Found {len(books)} book(s) in sources/  ·  {len(todo)} to ingest"
              + (f"  ·  {skipped} already done (skip)" if skipped else ""))
        n = skipped_empty = 0
        for path in todo:
            meta = prompt_meta(path)
            if meta:
                if register_and_extract(path, meta):
                    n += 1
                else:
                    skipped_empty += 1
        tail = f"  ·  {skipped_empty} skipped (no extractable text)" if skipped_empty else ""
        print(f"\nIngested {n} book(s).{tail}  Next: python extract.py   (then python build.py)")
        return

    # ── Single-file mode ────────────────────────────────────────────────────
    if not args.file:
        sys.exit("Give a file, or use --all to batch-ingest ufo-shapes/sources/.")
    ext = os.path.splitext(args.file)[1].lower()
    if ext not in EXTRACTORS:
        sys.exit(f"Unsupported format '{ext}'. Supported: {', '.join(EXTRACTORS)}")
    if not os.path.exists(args.file):
        sys.exit(f"No such file: {args.file}")

    print("Source metadata (Enter to skip a field):")
    sid = args.id or input(f"  id (slug) [{slugify(args.file)}]: ").strip() or slugify(args.file)
    meta = {
        "id": sid,
        "title": prompt("title", args.title),
        "author": prompt("author", args.author),
        "year": args.year if args.year is not None else (input("  year: ").strip() or None),
        "type": args.type or (input("  type [book]: ").strip() or "book"),
        "tier": args.tier if args.tier is not None else (input("  reliability tier 1-4: ").strip() or None),
        "citation": prompt("citation", args.citation),
        "url": prompt("url (optional)", args.url),
    }
    register_and_extract(args.file, meta)
    print("\nNext: python extract.py   (then python build.py)")


if __name__ == "__main__":
    main()
