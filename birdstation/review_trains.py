#!/usr/bin/env python3
"""
review_trains.py — vet train detections from the terminal on the box.

Train clips can pick up conversation near the mic, so every detection starts
*un-reviewed* and is hidden from the public Observatory until a human approves
it here. This tool walks the pending queue, plays each clip, and records a
verdict:

    train          → confirmed train; becomes visible on the public site
    false_positive → not a train (voices, a dog, wind…); stays hidden, clip
                     queued for deletion on the next purge
    unsure         → leave it; ask again next time
    skip / quit    → stop without deciding

Usage (on the box):
    python3 ~/alans-brain/birdstation/review_trains.py            # review pending
    python3 ~/alans-brain/birdstation/review_trains.py --all      # include already-reviewed
    python3 ~/alans-brain/birdstation/review_trains.py --no-audio # don't try to play clips

Playback uses whatever's available (ffplay / aplay / paplay); if none is found
or you pass --no-audio, you still get the metadata (time, duration, peak dB) to
judge by. Verdicts are written straight to ~/birdnet.db, the same column the API
reads — no restart needed.
"""

import argparse
import os
import shutil
import sqlite3
import subprocess
import sys

DB_PATH  = os.environ.get("BIRDNET_DB", "/home/alan/birdnet.db")
CLIP_DIR = os.environ.get("TRAIN_CLIP_DIR", "/home/alan/train_clips")

VALID = {
    "t": "train",
    "f": "false_positive",
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


def main():
    ap = argparse.ArgumentParser(description="Vet train detections.")
    ap.add_argument("--all", action="store_true",
                    help="include events already reviewed (re-vet)")
    ap.add_argument("--no-audio", action="store_true",
                    help="don't attempt clip playback")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        sys.exit(f"database not found: {DB_PATH} (set BIRDNET_DB to override)")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    where = "" if args.all else "WHERE reviewed = 0"
    rows = conn.execute(
        f"SELECT * FROM train_events {where} ORDER BY detected_at ASC"
    ).fetchall()

    if not rows:
        print("Nothing to review — the queue is empty. 🚂")
        return

    player = None if args.no_audio else find_player()
    if not args.no_audio and player is None:
        print("No audio player found (ffplay/aplay/paplay) — judging by metadata only.\n")

    print(f"{len(rows)} event(s) to review.  "
          "[t]rain  [f]alse  [u]nsure  [r]eplay  [s]kip  [q]uit\n")

    decided = 0
    for i, r in enumerate(rows, 1):
        dur = f"{r['duration_s']:.0f}s" if r["duration_s"] is not None else "?"
        db  = f"{r['peak_db']:.0f} dB" if r["peak_db"] is not None else "?"
        cur = f" (currently: {r['verdict']})" if r["verdict"] else ""
        print(f"[{i}/{len(rows)}] id={r['id']}  {r['detected_at']}  {dur}  {db}{cur}")
        clip = r["clip_path"]

        while True:
            if player and clip:
                play(player, clip)
            choice = input("  verdict? ").strip().lower()

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
                    "UPDATE train_events SET reviewed = 1, verdict = ? WHERE id = ?",
                    (verdict, r["id"]),
                )
                conn.commit()
                decided += 1
                note = "→ now PUBLIC" if verdict == "train" else "→ stays hidden"
                print(f"  marked {verdict} {note}\n")
                break
            print("  ? use t / f / u / r / s / q")

    print(f"\nDone. {decided} decided this session.")
    conn.close()


if __name__ == "__main__":
    main()
