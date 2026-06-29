#!/usr/bin/env python3
"""report.py — a trust check for the UAP Shape Census data.

Run it any time (no arguments) to see exactly what's in the published data and
catch problems: duplicate sources, empty sources, sources that didn't make it
into the data, and how much has been AI-confirmed vs. still raw lexical.

    python report.py

Reads the committed data/ufo-shapes/{sources,mentions,summary}.json — so it
works on any clone, with or without the books locally.
"""
import collections

import _common as C


def main():
    sources = C.load_json(C.SOURCES_JSON, []) or []
    mentions = C.load_json(C.MENTIONS_JSON, []) or []
    summary = C.load_json(C.SUMMARY_JSON, {}) or {}

    pub_by_src = collections.Counter(m.get("source_id") for m in mentions)
    conf = collections.Counter(m.get("confidence") for m in mentions)
    warnings = []

    # ── Sources table ────────────────────────────────────────────────────────
    print(f"\nSOURCES ({len(sources)} registered)")
    print("-" * 72)
    seen = collections.Counter(s.get("id") for s in sources)
    for s in sources:
        sid = s.get("id", "?")
        segs = s.get("segment_count") or 0
        pub = pub_by_src.get(sid, 0)
        tier = s.get("reliability_tier")
        flag = ""
        if segs == 0:
            flag = "  ⚠ 0 segments (should not have registered)"
            warnings.append(f"{sid}: 0 segments")
        if pub == 0:
            flag += "  ⚠ 0 published mentions"
            warnings.append(f"{sid}: 0 published mentions")
        if seen[sid] > 1:
            flag += "  ⚠ DUPLICATE id"
        print(f"  T{tier or '?'}  {pub:5d} mentions  {segs:6d} segs  {sid}{flag}")

    # ── Published mentions that point at a source not in sources.json ─────────
    orphan = sorted(set(pub_by_src) - {s.get("id") for s in sources})
    if orphan:
        warnings.append(f"mentions reference unknown source(s): {', '.join(orphan)}")

    # ── Totals + confidence ──────────────────────────────────────────────────
    t = summary.get("totals", {})
    print("\nTOTALS")
    print("-" * 72)
    print(f"  published mentions : {len(mentions)}  (summary says {t.get('mentions')})")
    print(f"  sources w/ mentions: {sum(1 for s in sources if pub_by_src.get(s.get('id')))}"
          f"  (summary says {t.get('sources')})")
    print(f"  distinct shapes    : {t.get('shapes')}")
    print(f"  confidence         : " +
          ", ".join(f"{k}={v}" for k, v in conf.most_common()))
    ai = conf.get("llm-confirmed", 0)
    if ai < len(mentions):
        print(f"  note: {len(mentions) - ai} mention(s) are still raw lexical "
              f"(run classify.py to AI-check them)")

    # ── Verdict ──────────────────────────────────────────────────────────────
    print("\n" + ("-" * 72))
    if warnings:
        print("⚠ ISSUES:")
        for w in warnings:
            print(f"  - {w}")
    else:
        print("✓ Looks clean — no duplicates, no empty sources, no orphan mentions.")
    print()


if __name__ == "__main__":
    main()
