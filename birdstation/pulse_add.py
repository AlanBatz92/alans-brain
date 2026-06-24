#!/usr/bin/env python3
"""
pulse_add.py — paste-to-capture for the Pulse "What's On" events board.

The low-effort manual pipeline: paste a blob (a venue flyer, a forwarded newsletter,
a copied web page, a government meeting notice) and an AI parser turns it into clean,
dated event rows you eyeball and publish — no hand-typing of structured fields.

Runs ON THE BOX, where ANTHROPIC_API_KEY and ~/birdnet.db already live, so no secret
ever lands on a laptop (the security-conscious choice). Insert is dedup-guarded, so
re-pasting the same flyer can't double-add.

Usage:
    python3 pulse_add.py                 # opens $EDITOR to paste into
    python3 pulse_add.py --file flyer.txt
    pbpaste | python3 pulse_add.py -     # read the blob from stdin
    python3 pulse_add.py --yes < blob    # skip the per-event review prompt
    python3 pulse_add.py --kind civic    # hint default kind (parser still decides)

Review keys per parsed event: [y] add  [n] skip  [e] edit a field  [q] quit.
"""

import argparse
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import event_parser

DB_PATH = os.path.expanduser("~/birdnet.db")

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'event',
    starts_at   TEXT NOT NULL,
    ends_at     TEXT,
    all_day     INTEGER NOT NULL DEFAULT 0,
    venue       TEXT,
    location    TEXT,
    url         TEXT,
    description TEXT,
    source      TEXT NOT NULL DEFAULT 'manual',
    source_key  TEXT,
    dedup_key   TEXT UNIQUE,
    added_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
"""

COLUMNS = ("title", "kind", "starts_at", "ends_at", "all_day", "venue",
           "location", "url", "description", "source", "source_key",
           "dedup_key", "added_at")

EDITABLE = ("title", "kind", "starts_at", "ends_at", "venue", "location",
            "url", "description")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(CREATE_SQL)  # idempotent; safe if bird_api already migrated
    return conn


def read_text(args):
    """Get the blob from --file, stdin (`-`), or by opening $EDITOR."""
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            return fh.read()
    if args.file_stdin or not sys.stdin.isatty():
        return sys.stdin.read()
    editor = os.environ.get("EDITOR", "nano")
    with tempfile.NamedTemporaryFile("w+", suffix=".txt", delete=False) as tf:
        tf.write("# Paste the flyer / email / page text below this line, save & exit.\n")
        path = tf.name
    try:
        subprocess.call([editor, path])
        with open(path, encoding="utf-8") as fh:
            return "\n".join(l for l in fh if not l.startswith("#"))
    finally:
        os.unlink(path)


def show(row, idx, total):
    when = row["starts_at"] + (" (all day)" if row["all_day"] else "")
    print(f"\n── event {idx}/{total} ──────────────────────────────")
    print(f"  title       {row['title']}")
    print(f"  kind        {row['kind']}")
    print(f"  starts_at   {when}")
    if row.get("ends_at"):     print(f"  ends_at     {row['ends_at']}")
    if row.get("venue"):       print(f"  venue       {row['venue']}")
    if row.get("location"):    print(f"  location    {row['location']}")
    if row.get("url"):         print(f"  url         {row['url']}")
    if row.get("description"): print(f"  description  {row['description']}")


def edit(row):
    print("  field to edit (" + ", ".join(EDITABLE) + "):")
    field = input("  field> ").strip()
    if field not in EDITABLE:
        print("  (not an editable field)")
        return
    val = input(f"  {field}> ").strip()
    row[field] = val or None
    if field in ("title", "starts_at", "venue"):
        row["dedup_key"] = event_parser.dedup_key(
            row["title"], row["starts_at"], row.get("venue"))


def review(rows, assume_yes):
    """Walk the parsed rows; return the ones to keep."""
    if assume_yes:
        return rows
    keep = []
    i = 0
    while i < len(rows):
        row = rows[i]
        show(row, i + 1, len(rows))
        choice = (input("  [y] add  [n] skip  [e] edit  [q] quit > ").strip().lower()
                  or "y")
        if choice == "y":
            keep.append(row); i += 1
        elif choice == "n":
            i += 1
        elif choice == "e":
            edit(row)  # re-show same event
        elif choice == "q":
            break
    return keep


def insert(conn, rows):
    placeholders = ", ".join("?" for _ in COLUMNS)
    sql = f"INSERT OR IGNORE INTO events ({', '.join(COLUMNS)}) VALUES ({placeholders})"
    added = 0
    for row in rows:
        cur = conn.execute(sql, tuple(row.get(c) for c in COLUMNS))
        added += cur.rowcount  # 0 when dedup_key already present
    conn.commit()
    return added


def main():
    ap = argparse.ArgumentParser(description="Paste text -> AI-parsed Pulse events.")
    ap.add_argument("file", nargs="?", help="read the blob from FILE (or '-' for stdin)")
    ap.add_argument("--file", dest="file_opt", help="read the blob from this file")
    ap.add_argument("--kind", choices=event_parser.VALID_KINDS,
                    help="hint (the parser still decides per event)")
    ap.add_argument("--yes", action="store_true", help="add all parsed events, no review")
    args = ap.parse_args()

    args.file_stdin = (args.file == "-")
    if args.file and args.file != "-":
        args.file_opt = args.file
    args.file = args.file_opt

    text = read_text(args)
    if not text.strip():
        print("pulse_add: nothing to parse (empty input)")
        return 1

    try:
        import anthropic
        client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from env
    except Exception as ex:
        print(f"pulse_add: Anthropic client unavailable ({ex})")
        return 1

    try:
        rows = event_parser.parse_events(client, text, source="manual")
    except Exception as ex:  # incl. anthropic.APIError
        print(f"pulse_add: parse failed ({ex})")
        return 1

    if not rows:
        print("pulse_add: no datable events found in that text.")
        return 0

    print(f"pulse_add: parsed {len(rows)} event(s).")
    keep = review(rows, args.yes)
    if not keep:
        print("pulse_add: nothing added.")
        return 0

    conn = get_db()
    added = insert(conn, keep)
    conn.close()
    print(f"pulse_add: added {added} new event(s)"
          + (f" ({len(keep) - added} already present)" if len(keep) - added else "")
          + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main())
