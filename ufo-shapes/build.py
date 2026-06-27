#!/usr/bin/env python3
"""build.py — aggregate mentions into the page's precomputed summary.

Stage 3 of the UAP Shape Census pipeline (see PLAN-ufo-shapes.md).

Reads data/ufo-shapes/sources.json + mentions.json and writes
data/ufo-shapes/summary.json — the single small file ufo-shapes.html loads to
render the dashboard (headline stats, shape leaderboard, shape×source heatmap,
top modifiers, timeline) without the browser crunching every raw mention.

The page lazy-loads mentions.json only when a visitor drills into a shape/source.

Usage:  python build.py
Then:   git add data/ufo-shapes && git commit && git push   (→ live)
"""
import argparse
import collections
import datetime as _dt
import os
import sys

import _common as C


def main():
    ap = argparse.ArgumentParser(description="Publish-gate: build committed JSON from the full mention set.")
    ap.add_argument("--include-review", action="store_true",
                    help="Also publish review-tier (ambiguous) mentions. Default: high-confidence only.")
    args = ap.parse_args()

    taxonomy = C.load_json(C.SHAPES_PATH)
    shapes = taxonomy["shapes"]
    shape_order = [s["id"] for s in shapes]
    shape_label = {s["id"]: s["label"] for s in shapes}
    shape_icon = {s["id"]: s.get("icon", "") for s in shapes}

    sources = C.load_json(C.SOURCES_JSON, []) or []

    if not os.path.exists(C.MENTIONS_FULL):
        sys.exit(f"No {C.MENTIONS_FULL} — run `python extract.py` first. "
                 "(Refusing to overwrite committed data with nothing.)")
    full = C.load_json(C.MENTIONS_FULL, []) or []

    # THE PUBLISH GATE: high-confidence only, unless --include-review.
    if args.include_review:
        mentions = full
    else:
        mentions = [m for m in full if m.get("confidence") == "high"]
    withheld = len(full) - len(mentions)

    # Write the committed mention set (what the page reads for drill-down).
    C.write_json(C.MENTIONS_JSON, mentions)

    by_shape = collections.Counter()
    shape_sources = collections.defaultdict(set)
    by_source = collections.Counter()
    matrix = collections.Counter()        # (shape_id, source_id) -> count
    modifiers = collections.Counter()
    timeline = collections.Counter()      # decade -> count

    for m in mentions:
        sid, shp = m["source_id"], m["shape"]
        by_shape[shp] += 1
        shape_sources[shp].add(sid)
        by_source[sid] += 1
        matrix[(shp, sid)] += 1
        for mod in m.get("modifiers", []):
            modifiers[mod] += 1
        d = m.get("event_date")
        if d and len(d) >= 4 and d[:4].isdigit():
            decade = (int(d[:4]) // 10) * 10
            timeline[decade] += 1

    summary = {
        "generated_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "taxonomy_version": taxonomy.get("version"),
        "totals": {
            "sources": len(sources),
            "mentions": len(mentions),
            "shapes": sum(1 for s in shape_order if by_shape[s] > 0),
        },
        "by_shape": [
            {
                "shape": s,
                "label": shape_label[s],
                "icon": shape_icon[s],
                "count": by_shape[s],
                "source_count": len(shape_sources[s]),
            }
            for s in shape_order if by_shape[s] > 0
        ],
        "by_source": [
            {
                "id": src["id"],
                "title": src.get("title"),
                "year": src.get("year"),
                "reliability_tier": src.get("reliability_tier"),
                "count": by_source[src["id"]],
            }
            for src in sources
        ],
        "shape_by_source_matrix": {
            "shapes": [s for s in shape_order if by_shape[s] > 0],
            "sources": [src["id"] for src in sources],
            "cells": [
                {"shape": shp, "source": sid, "count": cnt}
                for (shp, sid), cnt in sorted(matrix.items())
            ],
        },
        "top_modifiers": [
            {"term": t, "count": c} for t, c in modifiers.most_common(25)
        ],
        "timeline_buckets": [
            {"decade": dec, "count": timeline[dec]} for dec in sorted(timeline)
        ],
    }

    # Sort leaderboard by count desc (keep taxonomy order as the tiebreak).
    summary["by_shape"].sort(key=lambda r: r["count"], reverse=True)
    summary["by_source"].sort(key=lambda r: r["count"], reverse=True)

    C.write_json(C.SUMMARY_JSON, summary)
    gate = "ALL (high+review)" if args.include_review else "high-confidence only"
    print(f"Published [{gate}] → {C.MENTIONS_JSON} + {C.SUMMARY_JSON}")
    print(f"  sources={summary['totals']['sources']}  "
          f"mentions={summary['totals']['mentions']}  "
          f"distinct shapes={summary['totals']['shapes']}")
    if withheld and not args.include_review:
        by_shape_withheld = collections.Counter(
            m["shape"] for m in full if m.get("confidence") != "high")
        terms = collections.Counter(
            m["raw_term"] for m in full if m.get("confidence") != "high")
        print(f"  withheld {withheld} review-tier mention(s) — NOT committed:")
        for shp, c in by_shape_withheld.most_common():
            print(f"      {c:4d}  {shape_label.get(shp, shp)}")
        print(f"    review terms: {', '.join(t for t, _ in terms.most_common(12))}")
        print("    → inspect work/mentions.full.json; re-run with --include-review to publish them,")
        print("      or promote specific terms to `aliases` in shapes.json.")


if __name__ == "__main__":
    main()
