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

    mentions = []
    n = 0
    for src in sources:
        sid = src["id"]
        segs = C.load_jsonl(C.segments_path(sid))
        for seg in segs:
            text = seg["text"]
            claimed = []  # (start, end) spans already matched in this segment
            for shape_id, raw_term, tier, rx in lexicon:
                for m in rx.finditer(text):
                    span = (m.start(), m.end())
                    # skip if this span overlaps a longer alias already taken
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
                        "confidence": tier,   # "high" → published, "review" → withheld by the gate
                        "event_date": None,
                    })

    C.write_json(C.MENTIONS_FULL, mentions)
    high = sum(1 for m in mentions if m["confidence"] == "high")
    review = len(mentions) - high
    print(f"Extracted {len(mentions)} candidate mentions from {len(sources)} source(s) "
          f"→ {C.MENTIONS_FULL}")
    print(f"  high-confidence: {high}   review (withheld unless promoted): {review}")
    print("Next: python build.py   (publishes high-confidence only)")


if __name__ == "__main__":
    main()
