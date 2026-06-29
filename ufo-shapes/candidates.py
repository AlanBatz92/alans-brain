#!/usr/bin/env python3
"""candidates.py — find colloquial shape-descriptors you haven't aliased yet.

A vocabulary-keeping helper. The census only counts the words it's been told to
look for (shapes.json); this surfaces the ones it's MISSING. It scans the local
source segments for the phrases people actually reach for to describe a craft's
shape —

    "<word>-shaped",  "in the shape of a ___",  "shaped like a ___",
    "looked like a ___",  "resembled a ___",  "the shape of a ___"

— and reports the captured descriptors that are NOT already in shapes.json, most
frequent first, with an example. You then decide which are real craft-shape words
and add them to the right shape's `aliases` (reliable) or `review_aliases`
(ambiguous) — the canonical shape can differ from the literal word (an
"ice-cream cone" might be Triangle or Cone, your call) — and re-run:

    python extract.py  ->  python classify.py  ->  python build.py

Runs LOCALLY (reads the ingested segments under ufo-shapes/sources/<id>/, which
are gitignored — the raw text never leaves your machine). Stdlib only.

Usage:
  python candidates.py                # candidates seen >=2 times, top 40
  python candidates.py --min 3        # only those seen >=3 times
  python candidates.py --limit 80     # show more rows
"""
import argparse
import collections
import os
import re

import _common as C

# words that are never a shape on their own — drop these captures
STOP = set("""
a an the it its this that these those something some any one ones thing things
object objects craft ship ships vehicle vessel light lights shape shapes form
sort kind type area thing my his her their your our me him them us we they you i
he she was were is are be been being had has have very more most large small
huge giant tiny big great other another same such
""".split())
PREP = set("off on in into of at to with that which and or as from over under near".split())

# "<word>-shaped" (or "<word> shaped"); and a shape-phrase trigger + 1–3 words
RX_COMPOUND = re.compile(r"\b([a-z][a-z'’]{2,})[-\s]shaped\b", re.IGNORECASE)
RX_PHRASE = re.compile(
    r"\b(?:in the shape of|the shape of|shaped (?:like|as)|"
    r"looked like|resembled|resembling)\s+(?:a |an |the )?"
    r"([a-z][a-z'’]+(?:[-\s][a-z][a-z'’]+){0,2})",
    re.IGNORECASE,
)


def known_aliases(shapes):
    """Every alias the taxonomy already knows, hyphen/space-normalized, plus ids/labels."""
    norm = {s["id"] for s in shapes}
    for s in shapes:
        norm.add(s["label"].lower())
        for key in ("aliases", "review_aliases"):
            for a in s.get(key, []):
                norm.add(a.lower().replace("-", " ").strip())
    return norm


def trim(phrase):
    """Lower, split on space/hyphen, drop leading/trailing stop & prep words."""
    toks = [t for t in re.split(r"[\s-]+", phrase.lower().strip()) if t]
    while toks and (toks[-1] in STOP or toks[-1] in PREP):
        toks.pop()
    while toks and (toks[0] in STOP or toks[0] in PREP):
        toks.pop(0)
    return toks if toks and len(toks[0]) >= 3 else []


def iter_segments():
    if not os.path.isdir(C.SOURCES_DIR):
        return
    for sid in sorted(os.listdir(C.SOURCES_DIR)):
        path = C.segments_path(sid)
        if os.path.exists(path):
            yield sid, C.load_jsonl(path)


def main():
    ap = argparse.ArgumentParser(description="Surface shape-descriptors missing from shapes.json.")
    ap.add_argument("--min", type=int, default=2, help="Min occurrences to report (default 2).")
    ap.add_argument("--limit", type=int, default=40, help="Max rows to show (default 40).")
    args = ap.parse_args()

    shapes = C.load_json(C.SHAPES_PATH)["shapes"]
    known = known_aliases(shapes)

    counts = collections.Counter()
    example = {}
    n_src = n_seg = 0
    for sid, segs in iter_segments():
        n_src += 1
        for seg in segs:
            n_seg += 1
            text = seg.get("text", "") or ""
            for rx, compound in ((RX_COMPOUND, True), (RX_PHRASE, False)):
                for m in rx.finditer(text):
                    toks = trim(m.group(1))
                    if not toks:
                        continue
                    cand = (toks[0] + "-shaped") if compound else " ".join(toks)
                    if cand.replace("-", " ") in known:
                        continue  # already in the taxonomy
                    counts[cand] += 1
                    if cand not in example:
                        a, b = max(0, m.start() - 40), min(len(text), m.end() + 40)
                        example[cand] = "…" + " ".join(text[a:b].split()) + "…"

    if n_seg == 0:
        print("No local segments found under ufo-shapes/sources/<id>/.")
        print("Run ingest.py first — this tool reads the raw ingested text, which stays local.")
        return

    rows = [(c, n) for c, n in counts.most_common() if n >= args.min][:args.limit]
    print(f"Scanned {n_src} source(s) / {n_seg} segment(s).")
    if not rows:
        print(f"No new candidate descriptors at >= {args.min} hits — the vocabulary looks current.")
        return
    print(f"\nCandidate shape-descriptors NOT yet in shapes.json (>= {args.min} hits):\n")
    print(f"  {'HITS':>4}  {'CANDIDATE':<20}  EXAMPLE")
    for c, n in rows:
        ex = example.get(c, "")
        if len(ex) > 68:
            ex = ex[:66] + "…"
        print(f"  {n:>4}  {c:<20}  {ex}")
    print("\nAdd the real craft descriptors to the right shape's `aliases` (reliable) or")
    print("`review_aliases` (ambiguous) in shapes.json — the canonical shape can differ from")
    print("the literal word (an 'ice-cream cone' might be Triangle or Cone, your call).")
    print("Then re-run:  python extract.py  ->  python classify.py  ->  python build.py")


if __name__ == "__main__":
    main()
