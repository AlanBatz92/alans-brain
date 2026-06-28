#!/usr/bin/env python3
"""extract.py — find every shape mention across all ingested sources.

Stage 2 of the UAP Shape Census pipeline (see PLAN-ufo-shapes.md).

Reads the taxonomy (shapes.json) and every source's normalized segments
(ufo-shapes/sources/<id>/segments.jsonl), runs a deterministic, whole-word,
case-insensitive lexicon match, and writes one mention record per hit to
data/ufo-shapes/mentions.json:

    { "id": "...", "source_id": "...", "shape": "disc", "raw_term": "saucer",
      "locator": "p.42", "snippet": "...the metallic saucer hovered...",
      "modifiers": [], "confidence": "lexical", "event_date": null }

This is the regex/lexicon census from the agreed plan. It is intentionally
HIGH-RECALL and will include false positives (e.g. "disc" = record). Those are
removed in Phase 3 by classify.py (a local-Ollama or claude-haiku-4-5 pass that
sets confidence: "llm-confirmed" / drops the row and fills `modifiers`). Until
then, `confidence` is "lexical" and the snippet is the receipt a human reads.

Usage:  python extract.py
"""
import collections
import re

import _common as C

# This run extracts the "craft_shape" facet (the shape of the craft). The same
# pipeline is designed to host other facets later — most immediately "humanoid"
# (descriptions of entities/occupants) — by pointing it at a different taxonomy
# file and tagging mentions with that facet. See PLAN-ufo-shapes.md §10.
FACET = "craft_shape"

# Light modifier harvest for the lexical pass — adjectives commonly attached to
# craft descriptions. The LLM pass (Phase 3) will do this properly; this is a
# cheap first cut so the page has something in the "modifiers" column.
MODIFIER_WORDS = [
    "metallic", "silver", "silvery", "black", "white", "glowing", "luminous",
    "dark", "shiny", "bright", "huge", "massive", "enormous", "small", "tiny",
    "silent", "hovering", "spinning", "rotating", "translucent", "transparent",
    "orange", "red", "blue", "green", "golden", "matte",
]
SNIPPET_MAX = 280


def compile_lexicon(shapes):
    """Return list of (shape_id, raw_term, tier, compiled_regex), longest alias first.

    tier is "high" (shape-explicit → published) or "review" (ambiguous → captured
    locally, withheld from the committed data unless promoted). See shapes.json.
    """
    out = []
    for shape in shapes:
        for tier, key in (("high", "aliases"), ("review", "review_aliases")):
            for alias in shape.get(key, []):
                # internal spaces → flexible whitespace + optional hyphen between tokens
                tokens = re.escape(alias).replace(r"\ ", r"[\s-]+")
                pattern = re.compile(rf"\b{tokens}\b", re.IGNORECASE)
                out.append((shape["id"], alias, tier, pattern))
    # match longer phrases before their sub-words ("flying saucer" before "saucer")
    out.sort(key=lambda t: len(t[1]), reverse=True)
    return out


def make_snippet(text, start, end):
    if len(text) <= SNIPPET_MAX:
        return text
    half = SNIPPET_MAX // 2
    a = max(0, start - half)
    b = min(len(text), end + half)
    # trim to word boundaries
    if a > 0:
        sp = text.find(" ", a)
        a = sp + 1 if sp != -1 and sp < start else a
    if b < len(text):
        sp = text.rfind(" ", end, b)
        b = sp if sp != -1 else b
    return ("…" if a > 0 else "") + text[a:b].strip() + ("…" if b < len(text) else "")


def find_modifiers(text):
    low = text.lower()
    return [m for m in MODIFIER_WORDS if re.search(rf"\b{m}\b", low)]


def main():
    taxonomy = C.load_json(C.SHAPES_PATH)
    shapes = taxonomy["shapes"]
    lexicon = compile_lexicon(shapes)
    sources = C.load_json(C.SOURCES_JSON, []) or []

    # ADDITIVE: for each source, re-extract it fresh IF its segments are present
    # locally; otherwise carry its mentions forward from the committed published
    # mentions.json. This means you can run extract on a machine that only has
    # SOME of the books without dropping the rest. On a machine with every book,
    # nothing is carried and this behaves exactly like a full re-scan.
    committed = C.load_json(C.MENTIONS_JSON, []) or []
    committed_by_src = collections.defaultdict(list)
    for m in committed:
        committed_by_src[m.get("source_id")].append(m)

    # First pass: classify each source as locally-present, carried, or skipped.
    seg_cache = {}
    fresh_srcs, carried_srcs, skipped_srcs = [], [], []
    for src in sources:
        sid = src["id"]
        segs = C.load_jsonl(C.segments_path(sid))
        if segs:
            seg_cache[sid] = segs
            fresh_srcs.append(sid)
        elif committed_by_src.get(sid):
            carried_srcs.append(sid)
        else:
            skipped_srcs.append(sid)

    # Fresh ids continue above any carried id so the two never collide. When
    # nothing is carried, this starts at 0 → original M000001… numbering.
    def idnum(m):
        try:
            return int(str(m.get("id", "M0")).lstrip("M"))
        except ValueError:
            return 0
    n = max((idnum(m) for sid in carried_srcs for m in committed_by_src[sid]), default=0)

    mentions = []
    for src in sources:
        sid = src["id"]
        if sid in seg_cache:
            for seg in seg_cache[sid]:
                text = seg["text"]
                claimed = []  # (start, end) spans already matched in this segment
                for shape_id, raw_term, tier, rx in lexicon:
                    for m in rx.finditer(text):
                        span = (m.start(), m.end())
                        if any(span[0] < e and s < span[1] for s, e in claimed):
                            continue
                        claimed.append(span)
                        n += 1
                        snip = make_snippet(text, m.start(), m.end())
                        mentions.append({
                            "id": f"M{n:06d}",
                            "source_id": sid,
                            "facet": FACET,
                            "shape": shape_id,
                            "raw_term": m.group(0).lower(),
                            "locator": seg["locator"],
                            "snippet": snip,
                            "modifiers": find_modifiers(snip),
                            "confidence": tier,
                            "event_date": None,
                        })
        elif sid in committed_by_src:
            mentions.extend(committed_by_src[sid])   # carry forward, as-is

    C.write_json(C.MENTIONS_FULL, mentions)
    high = sum(1 for m in mentions if m.get("confidence") == "high")
    review = sum(1 for m in mentions if m.get("confidence") == "review")
    print(f"Extracted {len(mentions)} mentions → {C.MENTIONS_FULL}")
    print(f"  re-extracted locally: {len(fresh_srcs)} source(s)  ·  "
          f"carried from committed data: {len(carried_srcs)}  ·  "
          f"skipped: {len(skipped_srcs)}")
    if carried_srcs:
        print(f"  carried (kept as last published): {', '.join(carried_srcs)}")
    if skipped_srcs:
        print(f"  ⚠ skipped — no local segments AND not in committed data: {', '.join(skipped_srcs)}")
    print(f"  tiers — high: {high}  review: {review}  (carried keep their prior confidence)")
    print("Next: python classify.py   (optional)   then python build.py")


if __name__ == "__main__":
    main()
