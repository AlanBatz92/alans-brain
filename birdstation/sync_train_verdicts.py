#!/usr/bin/env python3
"""
sync_train_verdicts.py — turn your sorted horn corpus into Observatory verdicts.

The clips you sort for calibration are the *same* clips the live train detector
saved (each has a row in train_events). This bridges your one sorting pass into
the box's database, so the Trains page fills up without vetting twice:

    emit  (run on your PC):  read the corpus folders  -> train_verdicts.csv
    apply (run on the box):  read that CSV             -> set train_events rows
    publish (run on the box): make specific clips' audio public, one by one

Mapping: every WAV in trains/ becomes verdict='train' (category='train'); every
WAV in another class folder (planes/, vehicles/, gunshots/, ...) becomes
verdict='false_positive' with category=<folder name>. unsure/ and _*/ are left
alone (those rows stay pending). Matching is by exact filename, so DON'T rename
clips while sorting; clips that didn't come from the box's train_clips simply
won't match (they still serve calibration fine).

Privacy: confirming a clip as 'train' makes the *event* count and show on the
page, but its audio stays private (published=0) unless you publish it explicitly
(`apply --publish-trains`, or the `publish` command for select clips). These are
backyard-mic recordings, so audio is opt-in.

Pure standard library — no venv needed on either machine.

Usage:
    # on your PC, after sorting C:\\horn\\corpus:
    python sync_train_verdicts.py emit --corpus C:\\horn\\corpus --out train_verdicts.csv
    #   scp train_verdicts.csv you@your-box:~/

    # on the box:
    python3 ~/alans-brain/birdstation/sync_train_verdicts.py apply --csv ~/train_verdicts.csv --dry-run
    python3 ~/alans-brain/birdstation/sync_train_verdicts.py apply --csv ~/train_verdicts.csv
    #   (the Trains page updates immediately — no restart)

    # later, to make one train's audio public:
    python3 ~/alans-brain/birdstation/sync_train_verdicts.py publish train_2026-06-01T08-30-00.wav
"""

import argparse
import csv
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DB_PATH = os.environ.get("BIRDNET_DB", os.path.expanduser("~/birdnet.db"))
POSITIVE_LABEL = "trains"          # corpus subfolder holding confirmed horns
EXCLUDE = {"unsure", "_review", "horn_profile_out", "_incoming"}
WAV_EXTS = (".wav", ".WAV")


def list_wavs(d: Path):
    """WAV files under a folder (recursive), sorted."""
    return sorted(p for p in d.rglob("*") if p.suffix in WAV_EXTS)


def ensure_columns(conn):
    """Idempotently add category + published to train_events (matches
    bird_api.ensure_train_schema), preserving any already-public approved clips."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(train_events)")}
    if "category" not in cols:
        conn.execute("ALTER TABLE train_events ADD COLUMN category TEXT")
    if "published" not in cols:
        conn.execute("ALTER TABLE train_events ADD COLUMN published INTEGER DEFAULT 0")
        conn.execute("UPDATE train_events SET published = 1 WHERE verdict = 'train'")
    conn.commit()


def basename_index(conn):
    """Map clip basename -> [row ids]. Exact filename match, no LIKE wildcards
    (clip names contain underscores, which LIKE would treat as wildcards)."""
    idx = {}
    for rid, cp in conn.execute("SELECT id, clip_path FROM train_events"):
        if cp:
            idx.setdefault(os.path.basename(cp), []).append(rid)
    return idx


def backup_db(db_path):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = f"{db_path}.backup-{stamp}"
    shutil.copy2(db_path, dest)
    print(f"backed up DB -> {dest}")


# ---------------------------------------------------------------------------
# emit  (PC side)
# ---------------------------------------------------------------------------

def cmd_emit(args):
    root = Path(args.corpus)
    if not root.is_dir():
        sys.exit(f"--corpus is not a directory: {root}")

    rows = []
    pos_dir = root / args.positive_label
    for f in list_wavs(pos_dir) if pos_dir.is_dir() else []:
        rows.append((f.name, "train", "train"))

    for sub in sorted(p for p in root.iterdir() if p.is_dir()):
        name = sub.name
        if (name == args.positive_label or name in EXCLUDE
                or name.startswith((".", "_"))):
            continue
        for f in list_wavs(sub):
            rows.append((f.name, "false_positive", name))

    if not rows:
        sys.exit(f"No sorted clips found under {root} "
                 f"(expected a '{args.positive_label}/' folder and/or class folders).")

    out = Path(args.out)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["filename", "verdict", "category"])
        w.writerows(rows)

    # Census so you can sanity-check before sending it to the box.
    by_cat = {}
    for _, _, cat in rows:
        by_cat[cat] = by_cat.get(cat, 0) + 1
    n_train = sum(1 for _, v, _ in rows if v == "train")
    print(f"Wrote {out}  ({len(rows)} clip(s): {n_train} train, "
          f"{len(rows) - n_train} non-train)")
    for cat, n in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        print(f"  {cat:<16}{n:>5}")
    print("\nNext: copy it to the box, e.g.")
    print(f"  scp {out} you@your-box:~/")
    print("  then on the box:  sync_train_verdicts.py apply --csv ~/"
          f"{out.name} --dry-run")


# ---------------------------------------------------------------------------
# apply  (box side)
# ---------------------------------------------------------------------------

def cmd_apply(args):
    if not os.path.exists(args.db):
        sys.exit(f"database not found: {args.db} (set BIRDNET_DB to override)")
    if not os.path.exists(args.csv):
        sys.exit(f"CSV not found: {args.csv}")

    with open(args.csv, newline="", encoding="utf-8") as fh:
        entries = [(r["filename"], r["verdict"], r.get("category") or "")
                   for r in csv.DictReader(fh)]
    if not entries:
        sys.exit("CSV has no rows.")

    conn = sqlite3.connect(args.db)
    ensure_columns(conn)
    idx = basename_index(conn)

    matched, unmatched = 0, []
    by_verdict = {}
    for filename, verdict, category in entries:
        ids = idx.get(filename)
        if not ids:
            unmatched.append(filename)
            continue
        matched += len(ids)
        by_verdict[verdict] = by_verdict.get(verdict, 0) + len(ids)
        if args.dry_run:
            continue
        sets = ["reviewed = 1", "verdict = ?", "category = ?"]
        params = [verdict, category]
        if verdict != "train":
            sets.append("published = 0")          # never serve a non-train clip
        elif args.publish_trains:
            sets.append("published = 1")          # opt-in publish of confirmed trains
        sql = f"UPDATE train_events SET {', '.join(sets)} WHERE id = ?"
        for rid in ids:
            conn.execute(sql, params + [rid])

    print(f"CSV rows: {len(entries)}   matched to events: {matched}   "
          f"unmatched: {len(unmatched)}")
    for v, n in sorted(by_verdict.items(), key=lambda kv: -kv[1]):
        print(f"  {v:<16}{n:>5}")
    if unmatched:
        print(f"  ({len(unmatched)} clip(s) had no train_events row — likely renamed "
              f"or not from this box's train_clips)")
        for f in unmatched[:8]:
            print(f"    - {f}")
        if len(unmatched) > 8:
            print(f"    … and {len(unmatched) - 8} more")

    if args.dry_run:
        print("\n[dry-run] nothing written. Re-run without --dry-run to apply.")
        conn.close()
        return

    if not args.no_backup:
        backup_db(args.db)
    conn.commit()
    conn.close()
    pub = "PUBLIC audio" if args.publish_trains else "private audio (count-only)"
    print(f"\nApplied. Confirmed trains now show on the Trains page with {pub}.")
    print("No restart needed — the API reads the DB live.")


# ---------------------------------------------------------------------------
# publish  (box side) — make specific confirmed-train clips' audio public
# ---------------------------------------------------------------------------

def cmd_publish(args):
    if not os.path.exists(args.db):
        sys.exit(f"database not found: {args.db}")
    conn = sqlite3.connect(args.db)
    ensure_columns(conn)
    idx = basename_index(conn)

    if not args.no_backup:
        backup_db(args.db)
    published, skipped = 0, []
    for fn in args.filenames:
        ids = idx.get(os.path.basename(fn))
        if not ids:
            skipped.append(fn)
            continue
        for rid in ids:
            n = conn.execute(
                "UPDATE train_events SET published = 1 "
                "WHERE id = ? AND verdict = 'train'", (rid,)
            ).rowcount
            published += n
            if n == 0:
                skipped.append(fn)  # row exists but isn't a confirmed train
    conn.commit()
    conn.close()
    print(f"Published audio for {published} clip(s).")
    if skipped:
        print(f"Skipped {len(skipped)} (no matching confirmed-train event): "
              + ", ".join(skipped[:8]) + (" …" if len(skipped) > 8 else ""))


def cmd_reject(args):
    """Strike off train events as false positives so they drop off the page — the
    human exception-review path for the auto-detection model. Accepts clip
    filenames and/or folders (every WAV in a folder is struck off)."""
    if not os.path.exists(args.db):
        sys.exit(f"database not found: {args.db}")
    names = []
    for fn in args.filenames:
        p = Path(fn)
        if p.is_dir():
            names.extend(w.name for w in list_wavs(p))
        else:
            names.append(os.path.basename(fn))
    conn = sqlite3.connect(args.db)
    ensure_columns(conn)
    idx = basename_index(conn)
    if not args.no_backup:
        backup_db(args.db)
    struck, skipped = 0, []
    for name in names:
        ids = idx.get(name)
        if not ids:
            skipped.append(name)
            continue
        for rid in ids:
            conn.execute("UPDATE train_events SET verdict='false_positive', "
                         "reviewed=1 WHERE id=?", (rid,))
            struck += 1
    conn.commit()
    conn.close()
    print(f"Struck off {struck} event(s) — they no longer show on the page "
          f"(the next clip purge removes their audio).")
    if skipped:
        print(f"Skipped {len(skipped)} (no matching event): "
              + ", ".join(skipped[:8]) + (" …" if len(skipped) > 8 else ""))


def main():
    ap = argparse.ArgumentParser(
        description="Bridge a sorted horn corpus into Observatory train verdicts.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("emit", help="(PC) corpus folders -> train_verdicts.csv")
    e.add_argument("--corpus", "-c", required=True, help="corpus root (has trains/ + class folders)")
    e.add_argument("--out", "-o", default="train_verdicts.csv", help="output CSV path")
    e.add_argument("--positive-label", default=POSITIVE_LABEL,
                   help=f"positives subfolder (default '{POSITIVE_LABEL}')")
    e.set_defaults(func=cmd_emit)

    a = sub.add_parser("apply", help="(box) train_verdicts.csv -> set train_events")
    a.add_argument("--csv", required=True, help="the CSV produced by `emit`")
    a.add_argument("--db", default=DB_PATH, help=f"birdnet.db path (default {DB_PATH})")
    a.add_argument("--publish-trains", action="store_true",
                   help="also make confirmed trains' audio public (default: private)")
    a.add_argument("--dry-run", action="store_true", help="report only; change nothing")
    a.add_argument("--no-backup", action="store_true", help="skip the pre-write DB backup")
    a.set_defaults(func=cmd_apply)

    p = sub.add_parser("publish", help="(box) make specific train clips' audio public")
    p.add_argument("filenames", nargs="+", help="clip filename(s), e.g. train_2026-06-01T08-30-00.wav")
    p.add_argument("--db", default=DB_PATH, help=f"birdnet.db path (default {DB_PATH})")
    p.add_argument("--no-backup", action="store_true", help="skip the pre-write DB backup")
    p.set_defaults(func=cmd_publish)

    r = sub.add_parser("reject", help="(box) strike off events as false positives "
                                      "(exception review for the auto model)")
    r.add_argument("filenames", nargs="+",
                   help="clip filename(s) and/or folder(s) of clips to strike off")
    r.add_argument("--db", default=DB_PATH, help=f"birdnet.db path (default {DB_PATH})")
    r.add_argument("--no-backup", action="store_true", help="skip the pre-write DB backup")
    r.set_defaults(func=cmd_reject)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
