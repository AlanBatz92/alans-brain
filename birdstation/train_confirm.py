#!/usr/bin/env python3
"""
train_confirm.py — (re)score train candidates with the calibrated horn detector.

`train_detector` confirms each candidate inline as it's detected (the primary,
real-time path). This script is the **manual companion** for two jobs:

  * backfill — score any events left *pending* (verdict NULL) because inline
    confirmation wasn't available (deps missing, a transient error);
  * re-score — after you recalibrate (a new horn_profile.json), re-evaluate past
    *machine* decisions against the new profile with `--rescore`.

It re-scores each event's clip with `train_horn_detector` (+ `horn_profile.json`):

    horn confirmed  -> verdict='train'           (shows on the page; audio private)
    no horn         -> verdict='false_positive'  (hidden; the trigger's noise)

`reviewed` stays 0 — these are the *machine's* call. **Human decisions
(reviewed=1) are never overwritten**, so your strike-offs / verifications stick.
Run it whenever; it's not a timer. Needs librosa numpy scipy in this venv.

Usage (on the box):
    python3 ~/alans-brain/birdstation/train_confirm.py             # score pending
    python3 ~/alans-brain/birdstation/train_confirm.py --rescore   # re-score all machine calls
    python3 ~/alans-brain/birdstation/train_confirm.py --dry-run
    python3 ~/alans-brain/birdstation/train_confirm.py --profile /path/horn_profile.json
"""

import argparse
import os
import sqlite3
import sys

DB_PATH = os.environ.get("BIRDNET_DB", os.path.expanduser("~/birdnet.db"))


def ensure_columns(conn):
    """Idempotently add category + published (matches bird_api.ensure_train_schema)."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(train_events)")}
    if "category" not in cols:
        conn.execute("ALTER TABLE train_events ADD COLUMN category TEXT")
    if "published" not in cols:
        conn.execute("ALTER TABLE train_events ADD COLUMN published INTEGER DEFAULT 0")
        conn.execute("UPDATE train_events SET published = 1 WHERE verdict = 'train'")
    conn.commit()


def main():
    ap = argparse.ArgumentParser(description="Auto-confirm train candidates.")
    ap.add_argument("--db", default=DB_PATH, help=f"birdnet.db (default {DB_PATH})")
    ap.add_argument("--profile", default=None,
                    help="horn_profile.json (default: auto-discover next to "
                         "train_horn_detector.py).")
    ap.add_argument("--rescore", action="store_true",
                    help="re-evaluate ALL machine decisions (reviewed=0), not just "
                         "pending ones — use after recalibrating. Human strike-offs / "
                         "verifications (reviewed=1) are never touched.")
    ap.add_argument("--limit", type=int, default=0, help="max candidates per run (0 = all)")
    ap.add_argument("--dry-run", action="store_true", help="report only; change nothing")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        sys.exit(f"database not found: {args.db} (set BIRDNET_DB to override)")

    # Import here so a missing audio dep gives a clear message, not an import crash.
    try:
        import train_horn_detector as thd
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"could not import train_horn_detector ({exc}). Install its deps "
                 f"(librosa numpy scipy) in this venv.")

    # Apply the calibration so auto-confirm matches what you tuned. Without it the
    # detector runs on uncalibrated guesses — loudly warn.
    profile = args.profile or (str(thd.DEFAULT_PROFILE_PATH)
                               if thd.DEFAULT_PROFILE_PATH.exists() else None)
    if profile and os.path.exists(profile):
        thd.load_profile(profile)
        print(f"loaded calibration profile: {profile}")
    else:
        print("WARNING: no horn_profile.json found — auto-confirming on UNCALIBRATED "
              "defaults. Deploy your profile next to train_horn_detector.py.")

    conn = sqlite3.connect(args.db)
    ensure_columns(conn)
    # --rescore re-evaluates every *machine* decision (reviewed=0, any verdict);
    # the default only backfills pending ones. Human calls (reviewed=1) are excluded.
    scope = "reviewed = 0" if args.rescore else "verdict IS NULL"
    rows = conn.execute(
        "SELECT id, clip_path FROM train_events "
        f"WHERE {scope} AND clip_path IS NOT NULL AND clip_path != '' "
        "ORDER BY detected_at ASC"
    ).fetchall()
    if args.limit:
        rows = rows[:args.limit]

    if not rows:
        print("Nothing to score (no pending candidates"
              + (" / machine decisions" if args.rescore else "") + ").")
        conn.close()
        return

    confirmed, rejected, skipped = 0, 0, 0
    for event_id, clip in rows:
        if not os.path.exists(clip):
            skipped += 1            # clip purged/missing — leave pending, age out later
            continue
        try:
            events = thd.process_file(clip, verbose=False)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! score error (id={event_id}): {exc}")
            skipped += 1
            continue
        verdict = "train" if events else "false_positive"
        if verdict == "train":
            confirmed += 1
        else:
            rejected += 1
        if not args.dry_run:
            if verdict == "train":
                # Don't touch published — preserve any clip a human opted public.
                conn.execute(
                    "UPDATE train_events SET verdict='train', category='train' "
                    "WHERE id=?", (event_id,))
            else:
                conn.execute(
                    "UPDATE train_events SET verdict='false_positive', published=0 "
                    "WHERE id=?", (event_id,))

    if not args.dry_run:
        conn.commit()
    conn.close()

    tag = "[dry-run] " if args.dry_run else ""
    print(f"{tag}auto-confirm: {confirmed} train(s) → page, {rejected} rejected, "
          f"{skipped} skipped, of {len(rows)} pending. Audio stays private until "
          f"published.")


if __name__ == "__main__":
    main()
