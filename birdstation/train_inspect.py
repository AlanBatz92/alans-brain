#!/usr/bin/env python3
"""
train_inspect.py — what did the detector see (and decide) around a given time?

A forensic view for "there was a train at 10:30 last night but it's not on the
dashboard — why?". It pulls the train_events around an Eastern time and shows each
candidate's verdict, loudness, duration, and clip — confirmed AND rejected — so you
can see which stage failed, and optionally listen.

Reads which stage failed:
  * NOTHING in the window      -> the loose trigger never fired; no clip exists.
                                  Stage-1 (recall) miss — the horn didn't trip it.
  * a candidate, verdict=✗     -> the calibrated confirm REJECTED it. Listen; if
                                  it's a real horn, add the clip to your trains/
                                  corpus and recalibrate (it's a profile miss).
  * a candidate, verdict=✓     -> it WAS detected; if the page disagrees it's a
                                  display/timezone issue, not detection.

The box clock is UTC; you give Eastern and this converts. Pure standard library.

Usage (on the box):
    python3 ~/alans-brain/birdstation/train_inspect.py "10:30pm"     # last night ~10:30 ET
    python3 ~/alans-brain/birdstation/train_inspect.py 22:30 -w 60   # ±60 min
    python3 ~/alans-brain/birdstation/train_inspect.py "2026-06-08 22:30"
    python3 ~/alans-brain/birdstation/train_inspect.py "10:30pm" --play   # play each clip
    python3 ~/alans-brain/birdstation/train_inspect.py                # now (recent activity)
"""

import argparse
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone, timedelta, date

DB_PATH  = os.environ.get("BIRDNET_DB", os.path.expanduser("~/birdnet.db"))
CLIP_DIR = os.environ.get("TRAIN_CLIP_DIR", os.path.expanduser("~/train_clips"))

try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover — box has tzdata
    EASTERN = timezone.utc

VLABEL = {"train": "✓ train", "false_positive": "✗ rejected", "unsure": "? unsure"}


def vlabel(v):
    return VLABEL.get(v, "… pending" if v is None else str(v))


def fromiso(s):
    """Parse a stored detected_at (tz-aware UTC ISO) → aware datetime, or None."""
    try:
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def parse_when(text, now):
    """
    Fuzzy Eastern time → aware datetime. Accepts '10:30pm', '22:30', '10pm',
    optionally with a leading 'YYYY-MM-DD'. With no date, uses today's Eastern date,
    rolled back a day if that time is still in the future (so morning-after
    '10:30pm' means last night). 'now'/empty → now.
    """
    text = (text or "").strip().lower()
    if not text or text == "now":
        return now
    d = None
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if m:
        d = date(int(m[1]), int(m[2]), int(m[3]))
        text = (text[:m.start()] + text[m.end():]).strip()
    ampm = "pm" if "pm" in text else ("am" if "am" in text else None)
    t = text.replace("pm", "").replace("am", "").strip()
    if ":" in t:
        hh, mm = (int(x) for x in (t.split(":") + ["0"])[:2])
    else:
        digits = re.sub(r"\D", "", t)
        if not digits:
            raise ValueError(f"couldn't read a time from {text!r}")
        if len(digits) <= 2:
            hh, mm = int(digits), 0
        elif len(digits) == 3:
            hh, mm = int(digits[0]), int(digits[1:])
        else:
            hh, mm = int(digits[:2]), int(digits[2:4])
    if ampm == "pm" and hh < 12:
        hh += 12
    if ampm == "am" and hh == 12:
        hh = 0
    if not 0 <= hh < 24 or not 0 <= mm < 60:
        raise ValueError(f"time out of range in {text!r}")
    if d is None:
        cand = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if cand > now + timedelta(minutes=2):
            cand -= timedelta(days=1)
        return cand
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=EASTERN)


def find_player():
    for cmd in ("ffplay", "paplay", "aplay"):
        if shutil.which(cmd):
            return cmd
    return None


def play(player, path):
    if not path or not os.path.exists(path):
        print("    (clip missing on disk — purged or never saved)")
        return
    try:
        if player == "ffplay":
            subprocess.run(["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", path],
                           check=False)
        else:
            subprocess.run([player, path], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as exc:  # noqa: BLE001
        print(f"    (couldn't play: {exc})")


def et(dt):
    """Format an aware datetime in Eastern, e.g. 'Mon Jun 8 10:31 PM'."""
    return dt.astimezone(EASTERN).strftime("%a %b %-d %-I:%M %p")


def main():
    ap = argparse.ArgumentParser(
        description="Inspect train candidates (confirmed + rejected) around a time.")
    ap.add_argument("when", nargs="*",
                    help="Eastern time, e.g. '10:30pm', '22:30', '2026-06-08 22:30' "
                         "(default: now).")
    ap.add_argument("-w", "--window", type=float, default=45,
                    help="minutes on each side (default 45)")
    ap.add_argument("--db", default=DB_PATH, help=f"birdnet.db (default {DB_PATH})")
    ap.add_argument("--play", action="store_true", help="play each clip in turn")
    ap.add_argument("--trains-only", action="store_true", help="only verdict=train")
    ap.add_argument("--rejects-only", action="store_true", help="only false positives")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        sys.exit(f"database not found: {args.db} (set BIRDNET_DB to override)")

    now = datetime.now(EASTERN)
    try:
        center = parse_when(" ".join(args.when), now)
    except ValueError as exc:
        sys.exit(f"couldn't parse the time: {exc}")

    lo = (center - timedelta(minutes=args.window)).astimezone(timezone.utc)
    hi = (center + timedelta(minutes=args.window)).astimezone(timezone.utc)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT detected_at, verdict, reviewed, peak_db, duration_s, clip_path "
        "FROM train_events ORDER BY detected_at ASC"
    ).fetchall()
    conn.close()

    parsed = [(fromiso(r["detected_at"]), r) for r in rows]
    parsed = [(dt, r) for dt, r in parsed if dt is not None]
    window = [(dt, r) for dt, r in parsed if lo <= dt < hi]
    if args.trains_only:
        window = [(dt, r) for dt, r in window if r["verdict"] == "train"]
    if args.rejects_only:
        window = [(dt, r) for dt, r in window if r["verdict"] == "false_positive"]

    print(f"\nAround {center.strftime('%a %b %-d %-I:%M %p %Z')}  "
          f"(±{args.window:.0f} min · {lo.strftime('%H:%M')}–{hi.strftime('%H:%M')} UTC)\n")

    if not window:
        print("  Nothing here — the trigger never grabbed a clip in this window.")
        print("  → Stage-1 miss: the horn didn't trip the loose trigger, so no audio")
        print("    was saved. (Lower the trigger threshold to catch fainter horns.)")
        before = [x for x in parsed if x[0] < lo]
        after  = [x for x in parsed if x[0] >= hi]
        if before:
            dt, r = before[-1]
            print(f"\n  Nearest before: {et(dt)}  {vlabel(r['verdict'])}")
        if after:
            dt, r = after[0]
            print(f"  Nearest after:  {et(dt)}  {vlabel(r['verdict'])}")
        print()
        return

    counts = {}
    print(f"  {'time (ET)':<22}{'verdict':<16}{'dB':>6}{'dur':>6}   clip")
    print(f"  {'-'*66}")
    for dt, r in window:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        db  = f"{r['peak_db']:.0f}" if r["peak_db"] is not None else "?"
        dur = f"{r['duration_s']:.0f}s" if r["duration_s"] is not None else "?"
        clip = r["clip_path"] or ""
        base = os.path.basename(clip) if clip else "(none)"
        disk = ""
        if clip:
            disk = "  [on disk]" if os.path.exists(clip) else "  [purged]"
        verified = " (human)" if r["reviewed"] and r["verdict"] else ""
        print(f"  {dt.astimezone(EASTERN).strftime('%a %-I:%M:%S %p'):<22}"
              f"{vlabel(r['verdict']) + verified:<16}{db:>6}{dur:>6}   {base}{disk}")

    summary = ", ".join(f"{n} {vlabel(v).split()[-1]}" for v, n in counts.items())
    print(f"\n  {len(window)} candidate(s): {summary}")

    # Reading guide for the common cases present.
    if counts.get("false_positive") and not counts.get("train"):
        print("  → All rejected. If one of these is a real horn, it's a profile miss:")
        print("    copy the clip into your corpus trains/ folder, recalibrate, then")
        print("    train_confirm.py --rescore.")
    elif counts.get("train"):
        print("  → A train WAS detected here. If the page doesn't show it, that's a")
        print("    display/timezone issue (and restart birdapi for the 'today' fix).")

    if args.play:
        player = find_player()
        if not player:
            print("\n  (no audio player found — install ffplay/aplay/paplay to use --play)")
            return
        clips = [(dt, r) for dt, r in window
                 if r["clip_path"] and os.path.exists(r["clip_path"])]
        if not clips:
            print("\n  (no clips on disk to play)")
            return
        print(f"\n  Playing {len(clips)} clip(s). [enter] next · [r]eplay · [q]uit\n")
        for dt, r in clips:
            print(f"  ▶ {et(dt)}  {vlabel(r['verdict'])}  {os.path.basename(r['clip_path'])}")
            while True:
                play(player, r["clip_path"])
                choice = input("    ").strip().lower()
                if choice in ("q", "quit"):
                    return
                if choice in ("r", "replay"):
                    continue
                break


if __name__ == "__main__":
    main()
