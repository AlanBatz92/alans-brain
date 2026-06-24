#!/usr/bin/env python3
"""Standalone tests for event_parser (no API, no FastAPI).
Run: python3 birdstation/test_event_parser.py"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import event_parser
from event_parser import normalize, dedup_key, ParsedEvent, EventBatch

passed = failed = 0
def ok(name, cond):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("  FAIL:", name)


# ── normalize(): validation + stamping ────────────────────────────────────
rows = normalize([
    {"title": "Jazz Night", "kind": "event", "starts_at": "2026-07-04T19:30",
     "venue": "Miller Symphony Hall", "location": "Allentown, PA"},
    {"title": "City Council", "kind": "civic", "starts_at": "2026-07-08",
     "all_day": True, "venue": "Allentown City Hall"},
], now="2026-06-23T00:00:00+00:00")
ok("two valid rows kept", len(rows) == 2)
ok("kind preserved (event)", rows[0]["kind"] == "event")
ok("kind preserved (civic)", rows[1]["kind"] == "civic")
ok("all_day -> 1", rows[1]["all_day"] == 1)
ok("all_day default 0", rows[0]["all_day"] == 0)
ok("added_at stamped", rows[0]["added_at"] == "2026-06-23T00:00:00+00:00")
ok("source default manual", rows[0]["source"] == "manual")
ok("dedup_key present", bool(rows[0]["dedup_key"]))

# Missing title or start date -> dropped.
dropped = normalize([
    {"title": "", "starts_at": "2026-07-04"},
    {"title": "No Date Fest", "starts_at": ""},
    {"title": "Bad Date", "starts_at": "soon"},
])
ok("rows without title/start dropped", len(dropped) == 0)

# Bad kind clamps to 'event'; bad source clamps to 'manual'.
clamped = normalize([{"title": "X", "starts_at": "2026-07-04", "kind": "party"}],
                    source="bogus")
ok("bad kind -> event", clamped[0]["kind"] == "event")
ok("bad source -> manual", clamped[0]["source"] == "manual")

# Empty strings normalized to None.
cleaned = normalize([{"title": "X", "starts_at": "2026-07-04", "venue": "  ",
                      "url": ""}])
ok("blank venue -> None", cleaned[0]["venue"] is None)
ok("blank url -> None", cleaned[0]["url"] is None)

# ── dedup: within-batch + date-granular ───────────────────────────────────
dup = normalize([
    {"title": "Show", "starts_at": "2026-07-04T19:30", "venue": "The Venue"},
    {"title": "Show", "starts_at": "2026-07-04T20:00", "venue": "The Venue"},  # same day
])
ok("same title+day+venue de-duped in batch", len(dup) == 1)
ok("dedup_key drops the time", dedup_key("Show", "2026-07-04T19:30", "The Venue")
   == dedup_key("Show", "2026-07-04T23:00", "The Venue"))
ok("different day -> different key", dedup_key("Show", "2026-07-04", "V")
   != dedup_key("Show", "2026-07-05", "V"))

# ── call_model + parse_events via a stub client ───────────────────────────
class StubMessage:
    def __init__(self, batch): self.parsed_output = batch
class StubMessages:
    def __init__(self, batch): self._b = batch; self.calls = []
    def parse(self, **kw): self.calls.append(kw); return StubMessage(self._b)
class StubClient:
    def __init__(self, batch): self.messages = StubMessages(batch)

batch = EventBatch(events=[
    ParsedEvent(title="Festival", starts_at="2026-08-01", venue="SteelStacks"),
    ParsedEvent(title="", starts_at="2026-08-02"),  # invalid -> dropped by normalize
])
client = StubClient(batch)
out = event_parser.parse_events(client, "some pasted text", today="2026-06-23")
ok("parse_events drops invalid, keeps valid", len(out) == 1 and out[0]["title"] == "Festival")
ok("model called with output_format", client.messages.calls[0]["output_format"] is EventBatch)
ok("user message carries TODAY", "2026-06-23" in client.messages.calls[0]["messages"][0]["content"])

# ── INSERT OR IGNORE dedup against a temp DB (mirrors pulse_add/bird_api) ──
COLS = ("title", "kind", "starts_at", "ends_at", "all_day", "venue", "location",
        "url", "description", "source", "source_key", "dedup_key", "added_at")
conn = sqlite3.connect(":memory:")
conn.execute("""CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, kind TEXT,
    starts_at TEXT NOT NULL, ends_at TEXT, all_day INTEGER, venue TEXT, location TEXT,
    url TEXT, description TEXT, source TEXT, source_key TEXT,
    dedup_key TEXT UNIQUE, added_at TEXT)""")
def ins(rows):
    sql = ("INSERT OR IGNORE INTO events (" + ", ".join(COLS) + ") VALUES ("
           + ", ".join("?" for _ in COLS) + ")")
    n = 0
    for r in rows:
        n += conn.execute(sql, tuple(r.get(c) for c in COLS)).rowcount
    conn.commit()
    return n
first = normalize([{"title": "Repeat Show", "starts_at": "2026-09-01", "venue": "Hall"}],
                  now="t")
ok("first insert adds 1", ins(first) == 1)
ok("re-insert same event ignored", ins(first) == 0)
ok("one row in table", conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
