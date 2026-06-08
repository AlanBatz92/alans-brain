#!/usr/bin/env python3
"""
backfill_life_list.py — retroactively list species that already qualify.

Background: the life-list gate gained a third, cumulative-evidence path
(birdnet_pipeline.py) — a species lists once it has accumulated
LIFE_LIST_CUMULATIVE_HITS detections at/above LIFE_LIST_CUMULATIVE_CONFIDENCE
all-time, with no 24h window. This catches a persistent, moderate-confidence bird
that the old "3 hits >= 0.85 in a rolling 24h" rule kept missing (the motivating
case: a Downy Woodpecker heard ~10× averaging ~76%, never quite at 0.85).

The pipeline only evaluates the gate when a *new* detection arrives, so a species
that already cleared the new bar in past data wouldn't list until it's heard
again. This one-shot scans the existing `detections` and inserts the missing
`lifetime` rows for every species that qualifies under ANY path:

  (1) a single hit >= LIFE_LIST_INSTANT_CONFIDENCE (~100%)
  (2) >= LIFE_LIST_MIN_HITS hits >= LIFE_LIST_MIN_CONFIDENCE (0.85), all-time
      (a retroactive analog of the live 24h rule — heard confidently several times
       ever is at least as strong as several times in one day)
  (3) >= LIFE_LIST_CUMULATIVE_HITS hits >= LIFE_LIST_CUMULATIVE_CONFIDENCE (0.70),
      all-time — the new cumulative-evidence path

What it touches:
  - INSERTs into `lifetime` for qualifying species not already listed. Sets
    first_seen to the species' earliest hit at/above the cumulative floor and
    total_detections to its all-time count at/above the 0.85 display floor (the
    same tally /api/lifetime derives live, so the two agree).
  - Never deletes anything; never touches `detections`, Pulse, or train tables.

Safety: backs the whole DB up first (unless --no-backup), supports --dry-run.

Usage (on the box):
    python3 ~/alans-brain/birdstation/backfill_life_list.py --dry-run
    python3 ~/alans-brain/birdstation/backfill_life_list.py

One-shot, not scheduled — once the existing data is caught up, the pipeline lists
new qualifiers on its own.
"""
import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

DB_PATH = os.environ.get("BIRDNET_DB", os.path.expanduser("~/birdnet.db"))

# Keep in sync with birdnet_pipeline.py.
LIFE_LIST_MIN_CONFIDENCE = 0.85
LIFE_LIST_MIN_HITS = 3
LIFE_LIST_INSTANT_CONFIDENCE = 0.995
LIFE_LIST_CUMULATIVE_CONFIDENCE = 0.70
LIFE_LIST_CUMULATIVE_HITS = 8


def find_qualifiers(conn):
    """Return [(common_name, scientific_name, first_seen, total_qual, why)] for
    species that qualify under any life-list path but aren't listed yet."""
    listed = {
        row[0] for row in conn.execute("SELECT common_name FROM lifetime").fetchall()
    }
    # One pass over per-species aggregates — cheap (one row per species).
    rows = conn.execute(
        """SELECT common_name,
                  MAX(scientific_name) AS scientific_name,
                  MAX(confidence)      AS best,
                  SUM(confidence >= ?) AS hits_display,
                  SUM(confidence >= ?) AS hits_cumulative,
                  MIN(CASE WHEN confidence >= ? THEN timestamp END) AS first_cumulative
           FROM detections
           WHERE common_name <> ''
           GROUP BY common_name""",
        (LIFE_LIST_MIN_CONFIDENCE, LIFE_LIST_CUMULATIVE_CONFIDENCE,
         LIFE_LIST_CUMULATIVE_CONFIDENCE)
    ).fetchall()

    out = []
    for r in rows:
        name = r["common_name"]
        if name in listed:
            continue
        best        = r["best"] or 0
        hits_display = r["hits_display"] or 0
        hits_cum     = r["hits_cumulative"] or 0
        if best >= LIFE_LIST_INSTANT_CONFIDENCE:
            why = "instant ~100%"
        elif hits_display >= LIFE_LIST_MIN_HITS:
            why = f"{hits_display} hits >= {LIFE_LIST_MIN_CONFIDENCE:.0%}"
        elif hits_cum >= LIFE_LIST_CUMULATIVE_HITS:
            why = f"{hits_cum} hits >= {LIFE_LIST_CUMULATIVE_CONFIDENCE:.0%} (cumulative)"
        else:
            continue
        first_seen = r["first_cumulative"] or datetime.now().isoformat()
        out.append((name, r["scientific_name"] or "", first_seen, hits_display, why))
    return out


def main():
    ap = argparse.ArgumentParser(
        description="Backfill the life list with species that already qualify.")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be listed; change nothing")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the pre-write DB backup (not recommended)")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        sys.exit(f"database not found: {DB_PATH} (set BIRDNET_DB to override)")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    qualifiers = find_qualifiers(conn)

    print(f"DB: {DB_PATH}")
    if not qualifiers:
        print("Nothing to backfill — every qualifying species is already listed.")
        conn.close()
        return

    print(f"{len(qualifiers)} species qualify but aren't listed:")
    for name, sci, first_seen, total, why in qualifiers:
        print(f"  + {name} ({why}; ×{total} at >= {LIFE_LIST_MIN_CONFIDENCE:.0%}, since {first_seen[:10]})")

    if args.dry_run:
        print(f"[dry-run] would insert {len(qualifiers)} lifetime row(s).")
        conn.close()
        return

    if not args.no_backup:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{DB_PATH}.backup-{stamp}"
        shutil.copy2(DB_PATH, backup)
        print(f"backed up DB → {backup}")

    conn.executemany(
        "INSERT INTO lifetime (common_name, scientific_name, first_seen, total_detections) "
        "VALUES (?,?,?,?)",
        [(name, sci, first_seen, total) for name, sci, first_seen, total, _ in qualifiers]
    )
    conn.commit()
    conn.close()
    print(f"listed {len(qualifiers)} new species. done.")


if __name__ == "__main__":
    main()
