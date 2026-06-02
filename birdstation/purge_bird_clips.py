#!/usr/bin/env python3
"""
purge_bird_clips.py — age out unreviewed bird verification clips.

birdnet_pipeline.py archives one short WAV per life-list-qualifying detection
(>= 0.85, one per species per day) so the life list can be spot-checked and
BirdNET scores calibrated against truth. These clips come off the same backyard
mic as the train clips and can pick up conversation, so we don't keep them
around indefinitely:

  KEEP   clips whose detection was reviewed  (verified IS NOT NULL)  — the
         labelled calibration set the owner chose to keep
  KEEP   unreviewed clips newer than RETENTION_DAYS                  — pending review
  DELETE unreviewed clips older than RETENTION_DAYS (verified IS NULL)
  DELETE orphan files older than RETENTION_DAYS with no matching detection row

After deleting an unreviewed clip's file, its row is kept but clip_path is
cleared (the detection history/count survives without a dangling path).

Intended to run from a daily systemd timer (see systemd/purge-bird-clips.*).
Safe to run by hand; pass --dry-run to see what it would do.

    python3 ~/alans-brain/birdstation/purge_bird_clips.py --dry-run
    python3 ~/alans-brain/birdstation/purge_bird_clips.py
"""

import argparse
import os
import sqlite3
import sys
import time

DB_PATH        = os.environ.get("BIRDNET_DB", "/home/alan/birdnet.db")
CLIP_DIR       = os.environ.get("BIRD_CLIP_DIR", "/home/alan/bird_clips")
RETENTION_DAYS = int(os.environ.get("BIRD_CLIP_RETENTION_DAYS", "30"))


def main():
    ap = argparse.ArgumentParser(description="Purge old unreviewed bird clips.")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be deleted, change nothing")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        sys.exit(f"database not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    deleted = 0
    freed   = 0
    cutoff  = time.time() - RETENTION_DAYS * 86400

    # 1. Unreviewed clips older than the retention window → delete file, clear path.
    #    Reviewed clips (verified IS NOT NULL) are the calibration set — kept.
    pending = conn.execute(
        "SELECT id, clip_path FROM detections "
        "WHERE verified IS NULL AND clip_path IS NOT NULL AND clip_path != ''"
    ).fetchall()
    for r in pending:
        path = r["clip_path"]
        if not path or not os.path.exists(path):
            # File already gone — tidy the dangling path.
            if not args.dry_run:
                conn.execute("UPDATE detections SET clip_path = NULL WHERE id = ?", (r["id"],))
            continue
        try:
            if os.path.getmtime(path) > cutoff:
                continue  # still within the review window — keep it
            size = os.path.getsize(path)
        except OSError:
            continue
        print(f"{'[dry-run] ' if args.dry_run else ''}delete aged unreviewed clip: {path}")
        if not args.dry_run:
            try:
                os.remove(path)
                freed += size
                deleted += 1
            except OSError as exc:
                print(f"  (failed: {exc})")
                continue
            conn.execute("UPDATE detections SET clip_path = NULL WHERE id = ?", (r["id"],))
    if not args.dry_run:
        conn.commit()

    # 2. Orphan files on disk older than RETENTION_DAYS with no detection row
    #    referencing them. Never touches a file still referenced by any row.
    referenced = {
        os.path.basename(row["clip_path"])
        for row in conn.execute(
            "SELECT clip_path FROM detections WHERE clip_path IS NOT NULL AND clip_path != ''"
        ).fetchall()
    }
    if os.path.isdir(CLIP_DIR):
        for fn in os.listdir(CLIP_DIR):
            if not fn.endswith(".wav") or fn in referenced:
                continue
            path = os.path.join(CLIP_DIR, fn)
            try:
                if os.path.getmtime(path) > cutoff:
                    continue  # young orphan — leave it one more cycle
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
