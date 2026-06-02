#!/usr/bin/env python3
"""
purge_train_clips.py — weekly cleanup of train audio clips.

Train clips can contain conversation picked up near the mic, so we don't keep
them around longer than needed. This deletes WAV files that are no longer worth
storing, while protecting the two cases we must keep:

  KEEP   clips of approved trains   (verdict='train')   — they're public
  KEEP   clips still awaiting review (reviewed=0)        — pending vetting
  DELETE clips of rejected events   (false_positive / unsure, reviewed=1)
  DELETE orphan clips older than RETENTION_DAYS with no matching event row

After deleting a rejected event's file, its row is kept but clip_path is cleared
(so the history/count survives without a dangling path).

Intended to run from a weekly systemd timer (see systemd/purge-train-clips.*).
Safe to run by hand; pass --dry-run to see what it would do.

    python3 ~/alans-brain/birdstation/purge_train_clips.py --dry-run
    python3 ~/alans-brain/birdstation/purge_train_clips.py
"""

import argparse
import os
import sqlite3
import sys
import time

DB_PATH        = os.environ.get("BIRDNET_DB", "/home/alan/birdnet.db")
CLIP_DIR       = os.environ.get("TRAIN_CLIP_DIR", "/home/alan/train_clips")
RETENTION_DAYS = int(os.environ.get("TRAIN_CLIP_RETENTION_DAYS", "7"))


def main():
    ap = argparse.ArgumentParser(description="Purge old/rejected train clips.")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be deleted, change nothing")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        sys.exit(f"database not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    deleted = 0
    freed   = 0

    # 1. Clips of reviewed-but-rejected events (not a train) → delete the file,
    #    clear the path. Approved trains and un-reviewed events are untouched.
    rejected = conn.execute(
        "SELECT id, clip_path FROM train_events "
        "WHERE reviewed = 1 AND verdict != 'train' "
        "AND clip_path IS NOT NULL AND clip_path != ''"
    ).fetchall()
    for r in rejected:
        path = r["clip_path"]
        if path and os.path.exists(path):
            size = os.path.getsize(path)
            print(f"{'[dry-run] ' if args.dry_run else ''}delete rejected clip: {path}")
            if not args.dry_run:
                try:
                    os.remove(path)
                    freed += size
                    deleted += 1
                except OSError as exc:
                    print(f"  (failed: {exc})")
                    continue
        if not args.dry_run:
            conn.execute("UPDATE train_events SET clip_path = NULL WHERE id = ?", (r["id"],))
    if not args.dry_run:
        conn.commit()

    # 2. Orphan files on disk older than RETENTION_DAYS with no event referencing
    #    them (e.g. a crash mid-write, or rows long since cleared). Never touches
    #    a file still referenced by any event row.
    referenced = {
        os.path.basename(row["clip_path"])
        for row in conn.execute(
            "SELECT clip_path FROM train_events WHERE clip_path IS NOT NULL AND clip_path != ''"
        ).fetchall()
    }
    cutoff = time.time() - RETENTION_DAYS * 86400
    if os.path.isdir(CLIP_DIR):
        for fn in os.listdir(CLIP_DIR):
            if not fn.endswith(".wav") or fn in referenced:
                continue
            path = os.path.join(CLIP_DIR, fn)
            try:
                if os.path.getmtime(path) > cutoff:
                    continue  # young orphan — leave it one more week
                size = os.path.getsize(path)
            except OSError:
                continue
            print(f"{'[dry-run] ' if args.dry_run else ''}delete orphan clip: {path}")
            if not args.dry_run:
                try:
                    os.remove(path)
                    freed += size
                    deleted += 1
                except OSError as exc:
                    print(f"  (failed: {exc})")

    conn.close()
    print(f"{'[dry-run] would free' if args.dry_run else 'Freed'} "
          f"{freed/1e6:.1f} MB across {deleted} clip(s).")


if __name__ == "__main__":
    main()
