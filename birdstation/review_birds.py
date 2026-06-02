#!/usr/bin/env python3
"""
review_birds.py — confirm BirdNET life-list detections from the box terminal.

birdnet_pipeline.py archives one short clip per life-list-qualifying detection
(>= 0.85, one per species/day). This walks those clips, plays each, and records
whether the ID was right:

    correct → BirdNET got it; counts as a true positive
    wrong   → mis-ID; counts as a false positive
    unsure  → leave it; ask again next time
    skip / quit → stop without deciding

Labels live in detections.verified (the same DB the pipeline writes). Reviewed
clips are kept by the purge; unreviewed ones age out after the retention window.
Once you've labelled some, `--stats` prints measured precision by confidence band
— the raw material for turning BirdNET scores into real probabilities.

Usage (on the box):
    python3 ~/alans-brain/birdstation/review_birds.py            # review unlabelled
    python3 ~/alans-brain/birdstation/review_birds.py --all      # include labelled
    python3 ~/alans-brain/birdstation/review_birds.py --no-audio # metadata only
    python3 ~/alans-brain/birdstation/review_birds.py --stats    # precision so far

Playback uses ffplay / aplay / paplay if present; otherwise you judge by the
metadata (species, confidence, time). No restart needed — labels write straight
to ~/birdnet.db.
"""

import argparse
import os
import shutil
import sqlite3
import subprocess
import sys

DB_PATH  = os.environ.get("BIRDNET_DB", "/home/alan/birdnet.db")
CLIP_DIR = os.environ.get("BIRD_CLIP_DIR", "/home/alan/bird_clips")

VALID = {
    "c": "correct",
    "w": "wrong",
    "u": "unsure",
}


def find_player():
    """First available CLI audio player, or None."""
    for cmd in ("ffplay", "paplay", "aplay"):
        if shutil.which(cmd):
            return cmd
    return None


def play(player, path):
    """Play a clip and block until done. Best-effort — never crashes the review."""
    if not path or not os.path.exists(path):
        print("  (clip file missing on disk)")
        return
    try:
        if player == "ffplay":
            subprocess.run(["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", path],
                           check=False)
        else:  # aplay / paplay take the path directly
            subprocess.run([player, path], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as exc:
        print(f"  (couldn't play clip: {exc})")


def show_stats(conn):
    """Measured precision from the labels gathered so far, overall and by
    confidence band. 'correct' = true positive, 'wrong' = false positive;
    'unsure' is excluded from the denominator."""
    rows = conn.execute(
        "SELECT confidence, verified FROM detections "
        "WHERE verified IN ('correct','wrong')"
    ).fetchall()
    if not rows:
        print("No labelled clips yet — run a review session first.")
        return
    bands = [(0.85, 0.90), (0.90, 0.95), (0.95, 0.995), (0.995, 1.01)]
    print(f"Measured precision from {len(rows)} labelled detection(s):\n")
    print(f"  {'confidence':<14}{'correct':>9}{'wrong':>7}{'precision':>11}")
    for lo, hi in bands:
        sub = [r for r in rows if lo <= r["confidence"] < hi]
        if not sub:
            continue
        ok = sum(1 for r in sub if r["verified"] == "correct")
        n  = len(sub)
        label = f"{lo:.3f}-{hi:.3f}" if hi <= 1.0 else f"{lo:.3f}+"
        print(f"  {label:<14}{ok:>9}{n - ok:>7}{ok / n:>10.0%}")
    ok = sum(1 for r in rows if r["verified"] == "correct")
    print(f"  {'-' * 41}")
    print(f"  {'overall':<14}{ok:>9}{len(rows) - ok:>7}{ok / len(rows):>10.0%}")


def main():
    ap = argparse.ArgumentParser(description="Confirm BirdNET life-list detections.")
    ap.add_argument("--all", action="store_true",
                    help="include detections already labelled (re-review)")
    ap.add_argument("--no-audio", action="store_true",
                    help="don't attempt clip playback")
    ap.add_argument("--stats", action="store_true",
                    help="print measured precision from labels and exit")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        sys.exit(f"database not found: {DB_PATH} (set BIRDNET_DB to override)")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if args.stats:
        show_stats(conn)
        conn.close()
        return

    where = "clip_path IS NOT NULL AND clip_path != ''"
    if not args.all:
        where += " AND verified IS NULL"
    rows = conn.execute(
        f"SELECT * FROM detections WHERE {where} ORDER BY timestamp ASC"
    ).fetchall()

    if not rows:
        print("Nothing to review — no clips awaiting a verdict. \U0001F426")
        conn.close()
        return

    player = None if args.no_audio else find_player()
    if not args.no_audio and player is None:
        print("No audio player found (ffplay/aplay/paplay) — judging by metadata only.\n")

    print(f"{len(rows)} clip(s) to review.  "
          "[c]orrect  [w]rong  [u]nsure  [r]eplay  [s]kip  [q]uit\n")

    decided = 0
    for i, r in enumerate(rows, 1):
        conf = f"{r['confidence']:.0%}" if r["confidence"] is not None else "?"
        cur  = f" (currently: {r['verified']})" if r["verified"] else ""
        print(f"[{i}/{len(rows)}] id={r['id']}  {r['common_name']}  {conf}  {r['timestamp']}{cur}")
        clip = r["clip_path"]

        while True:
            if player and clip:
                play(player, clip)
            choice = input("  correct? ").strip().lower()

            if choice in ("q", "quit"):
                print(f"\nStopped. {decided} decided this session.")
                conn.close()
                return
            if choice in ("s", "skip", ""):
                print("  skipped.\n")
                break
            if choice in ("r", "replay"):
                if not (player and clip):
                    print("  (no audio to replay)")
                continue
            if choice in VALID:
                verdict = VALID[choice]
                conn.execute(
                    "UPDATE detections SET verified = ? WHERE id = ?",
                    (verdict, r["id"]),
                )
                conn.commit()
                decided += 1
                print(f"  marked {verdict}\n")
                break
            print("  ? use c / w / u / r / s / q")

    print(f"\nDone. {decided} decided this session.")
    conn.close()


if __name__ == "__main__":
    main()
