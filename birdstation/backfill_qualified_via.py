#!/usr/bin/env python3
"""
backfill_qualified_via.py — label existing life-list rows with HOW they qualified.

The `lifetime` table gained `qualified_via` / `qualified_at` so the bird card can
state exactly how a species made the list. The pipeline sets them for *new* lifers
going forward; this one-shot classifies the *existing* ones (qualified_via IS NULL)
from their detection history, mirroring the live gate's rules:

  instant_100   — a single hit >= LIFE_LIST_INSTANT_CONFIDENCE (~100%)
  burst_24h     — >= LIFE_LIST_MIN_HITS hits >= LIFE_LIST_MIN_CONFIDENCE (0.85)
                  (the all-time analog of the live "3 in a rolling 24h" rule)
  cumulative_70 — >= LIFE_LIST_CUMULATIVE_HITS hits >= LIFE_LIST_CUMULATIVE_CONFIDENCE (0.70)
  grandfathered — on the list but meets NONE of the current paths: it joined under
                  an earlier, lower confidence bar (e.g. before the 0.85 display
                  floor was set on 2026-06-03). It stays on the list — the card just
                  explains the history instead of showing three unmet rows.

Order mirrors find_qualifiers() in backfill_life_list.py (instant → burst → cumulative)
so the two scripts agree. Idempotent: only rows with qualified_via NULL/'' are touched,
so re-running is safe. This script never inserts or deletes lifers (use
backfill_life_list.py for that) — it only labels.

Safety: backs up the DB first (unless --no-backup); --dry-run shows the plan.

Usage (on the box):
    python3 ~/alans-brain/birdstation/backfill_qualified_via.py --dry-run
    python3 ~/alans-brain/birdstation/backfill_qualified_via.py
"""
import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

DB_PATH = os.environ.get("BIRDNET_DB", os.path.expanduser("~/birdnet.db"))

# Keep in sync with birdnet_pipeline.py / bird_api.py.
LIFE_LIST_MIN_CONFIDENCE = 0.85
LIFE_LIST_MIN_HITS = 3
LIFE_LIST_INSTANT_CONFIDENCE = 0.995
LIFE_LIST_CUMULATIVE_CONFIDENCE = 0.70
LIFE_LIST_CUMULATIVE_HITS = 8


def ensure_columns(conn):
    """Add qualified_via / qualified_at if the DB predates them (idempotent), so this
    runs even before a birdnet/birdapi restart has migrated the schema."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(lifetime)")}
    if "qualified_via" not in cols:
        conn.execute("ALTER TABLE lifetime ADD COLUMN qualified_via TEXT")
    if "qualified_at" not in cols:
        conn.execute("ALTER TABLE lifetime ADD COLUMN qualified_at TEXT")


def classify_via(best, hits_display, hits_cum):
    """Map a species' all-time detection aggregates to a qualifying path code.
    grandfathered = meets none of the current paths (joined under an earlier rule)."""
    if best >= LIFE_LIST_INSTANT_CONFIDENCE:
        return "instant_100"
    if hits_display >= LIFE_LIST_MIN_HITS:
        return "burst_24h"
    if hits_cum >= LIFE_LIST_CUMULATIVE_HITS:
        return "cumulative_70"
    return "grandfathered"


def plan_labels(conn):
    """Return [(common_name, via)] for every lifer whose qualified_via is NULL/'',
    classified from its all-time detection history."""
    rows = conn.execute(
        "SELECT common_name, scientific_name FROM lifetime "
        "WHERE qualified_via IS NULL OR qualified_via = ''"
    ).fetchall()
    out = []
    for r in rows:
        common = r["common_name"]
        scientific = r["scientific_name"]
        agg = conn.execute(
            """SELECT MAX(confidence)      AS best,
                      SUM(confidence >= ?) AS hits_display,
                      SUM(confidence >= ?) AS hits_cum
               FROM detections
               WHERE common_name = ? OR scientific_name = ?""",
            (LIFE_LIST_MIN_CONFIDENCE, LIFE_LIST_CUMULATIVE_CONFIDENCE,
             common, scientific or common)
        ).fetchone()
        best = agg["best"] or 0
        hits_display = agg["hits_display"] or 0
        hits_cum = agg["hits_cum"] or 0
        out.append((common, classify_via(best, hits_display, hits_cum)))
    return out


def main():
    ap = argparse.ArgumentParser(
        description="Label existing lifers with how they qualified (incl. grandfathered).")
    ap.add_argument("--dry-run", action="store_true",
                    help="report the plan; change nothing")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the pre-write DB backup (not recommended)")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        sys.exit(f"database not found: {DB_PATH} (set BIRDNET_DB to override)")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    ensure_columns(conn)
    plan = plan_labels(conn)

    print(f"DB: {DB_PATH}")
    if not plan:
        print("Nothing to label — every lifer already has a qualified_via.")
        conn.close()
        return

    counts = {}
    for _, via in plan:
        counts[via] = counts.get(via, 0) + 1
    print(f"{len(plan)} lifer(s) to label: " +
          ", ".join(f"{v} ×{n}" for v, n in sorted(counts.items())))
    for common, via in plan:
        print(f"  {common} → {via}")

    if args.dry_run:
        print(f"[dry-run] would update {len(plan)} row(s).")
        conn.close()
        return

    if not args.no_backup:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{DB_PATH}.backup-{stamp}"
        shutil.copy2(DB_PATH, backup)
        print(f"backed up DB → {backup}")

    conn.executemany(
        "UPDATE lifetime SET qualified_via = ? "
        "WHERE common_name = ? AND (qualified_via IS NULL OR qualified_via = '')",
        [(via, common) for common, via in plan]
    )
    conn.commit()
    conn.close()
    print(f"labeled {len(plan)} lifer(s). done.")


if __name__ == "__main__":
    main()
