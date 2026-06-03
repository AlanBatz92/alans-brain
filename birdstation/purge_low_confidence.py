#!/usr/bin/env python3
"""
purge_low_confidence.py — drop very-low-confidence detections from the box DB.

Background: the pipeline now *preserves* detections >= 0.60 (the PRESERVE floor)
so the bird cards can show sub-85% diagnostic hits — but earlier it kept
everything >= 0.35, so the DB still holds a lot of <0.60 noise from before the
floor was raised. This clears those older sub-floor rows so the local data
matches the current policy (cleaner locale analytics).

What it touches:
  - DELETEs rows from `detections` with confidence < the floor (default 0.60).
  - Leaves `lifetime` alone — a lifer earned its place from >= 0.85 hits, and the
    purge floor is well below that.
  - Never touches Pulse (`feed_*`) or train (`train_events`) tables — they share
    the same ~/birdnet.db.

Safety: backs the whole DB up first (unless --no-backup), supports --dry-run.

Usage (on the box):
    python3 ~/alans-brain/birdstation/purge_low_confidence.py --dry-run
    python3 ~/alans-brain/birdstation/purge_low_confidence.py
    python3 ~/alans-brain/birdstation/purge_low_confidence.py --floor 0.6

This is a one-shot cleanup, not a scheduled job — the pipeline already declines
to write anything below the floor, so new data stays clean on its own.
"""
import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

DB_PATH = os.environ.get("BIRDNET_DB", os.path.expanduser("~/birdnet.db"))
DEFAULT_FLOOR = 0.60


def main():
    ap = argparse.ArgumentParser(description="Purge sub-floor detections from the box DB.")
    ap.add_argument("--floor", type=float, default=DEFAULT_FLOOR,
                    help=f"delete detections with confidence < this (default {DEFAULT_FLOOR})")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be deleted; change nothing")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the pre-delete DB backup (not recommended)")
    args = ap.parse_args()

    if not 0.0 <= args.floor <= 1.0:
        sys.exit(f"--floor must be between 0 and 1 (got {args.floor})")
    if not os.path.exists(DB_PATH):
        sys.exit(f"database not found: {DB_PATH} (set BIRDNET_DB to override)")

    conn = sqlite3.connect(DB_PATH)
    total = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
    low = conn.execute(
        "SELECT COUNT(*) FROM detections WHERE confidence < ?", (args.floor,)
    ).fetchone()[0]

    print(f"DB: {DB_PATH}")
    print(f"detections: {total} total, {low} below {args.floor:.0%} confidence")

    if low == 0:
        print("Nothing to purge — already clean.")
        conn.close()
        return

    if args.dry_run:
        print(f"[dry-run] would delete {low} detection(s), keeping {total - low}.")
        conn.close()
        return

    if not args.no_backup:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{DB_PATH}.backup-{stamp}"
        shutil.copy2(DB_PATH, backup)
        print(f"backed up DB → {backup}")

    deleted = conn.execute(
        "DELETE FROM detections WHERE confidence < ?", (args.floor,)
    ).rowcount
    conn.commit()
    print(f"deleted {deleted} detection(s); {total - deleted} remain.")

    # Reclaim the freed pages. Safe here — the DELETE transaction is committed and
    # VACUUM isn't a DML statement, so sqlite3 won't wrap it in a transaction.
    try:
        conn.execute("VACUUM")
        print("vacuumed.")
    except sqlite3.OperationalError as exc:
        print(f"(skipped VACUUM: {exc})")

    conn.close()
    print("done.")


if __name__ == "__main__":
    main()
