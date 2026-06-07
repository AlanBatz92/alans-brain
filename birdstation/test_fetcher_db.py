#!/usr/bin/env python3
"""Standalone tests for pulse_fetcher.py's DB-facing logic: the idempotent Phase-4
schema migration, the news/events routers, and event purging. No network, no
feedparser (the rss adapter's import is lazy). Run:
    python3 birdstation/test_fetcher_db.py
"""
import sqlite3
import sys

import pulse_adapters as pa
import pulse_fetcher as pf


def legacy_db():
    """A pre-Phase-4 DB: feed_sources without type/config/content_kind, no events."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE feed_sources (
               key TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL,
               enabled INTEGER NOT NULL DEFAULT 1, last_status TEXT,
               last_count INTEGER DEFAULT 0, last_fetch TEXT)"""
    )
    conn.execute(
        """CREATE TABLE feed_items (
               url TEXT PRIMARY KEY, title TEXT NOT NULL, source_key TEXT NOT NULL,
               source TEXT NOT NULL, published INTEGER, fetched_at TEXT NOT NULL,
               summary TEXT)"""
    )
    conn.execute("INSERT INTO feed_sources (key,label,url) VALUES ('lvnews','LV News','http://x/rss')")
    conn.commit()
    return conn


def _has_table(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def _cols(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def test_ensure_schema_migrates_legacy():
    conn = legacy_db()
    assert not _has_table(conn, "events")
    pf.ensure_schema(conn)
    cols = _cols(conn, "feed_sources")
    assert "type" in cols and "config" in cols and "content_kind" in cols
    assert _has_table(conn, "events")
    # legacy row keeps its data and gets the safe defaults
    row = conn.execute("SELECT type, content_kind FROM feed_sources WHERE key='lvnews'").fetchone()
    assert row["type"] == "rss" and row["content_kind"] == "news"


def test_ensure_schema_idempotent():
    conn = legacy_db()
    pf.ensure_schema(conn)
    pf.ensure_schema(conn)            # second run must not raise or duplicate
    assert _cols(conn, "feed_sources").count("type") == 1


def test_insert_news_dedup():
    conn = legacy_db()
    pf.ensure_schema(conn)
    items = [
        {"url": "http://a", "title": "A", "source_key": "s", "source": "S",
         "published": None, "summary": "x"},
        {"url": "http://b", "title": "B", "source_key": "s", "source": "S",
         "published": None, "summary": "y"},
        {"url": "http://a", "title": "A dup", "source_key": "s", "source": "S",
         "published": None, "summary": "z"},   # same url → ignored
    ]
    found, new = pf.insert_news(conn, items)
    assert (found, new) == (3, 2)
    assert conn.execute("SELECT COUNT(*) FROM feed_items").fetchone()[0] == 2


def test_upsert_events_insert_then_update():
    conn = legacy_db()
    pf.ensure_schema(conn)
    r1 = pa.make_event_row("tm:1", "tm-lv", "Old Title", "2030-07-15T20:00:00",
                           category="Rock", location="Archer")
    pf.upsert_events(conn, [r1])
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1

    # same uid, changed title/time → updates in place (no duplicate)
    r1b = pa.make_event_row("tm:1", "tm-lv", "New Title", "2030-07-16T21:00:00",
                            category="Rock", location="Archer")
    pf.upsert_events(conn, [r1b])
    rows = conn.execute("SELECT uid, title, start_date FROM events").fetchall()
    assert len(rows) == 1
    assert rows[0]["title"] == "New Title" and rows[0]["start_date"] == "2030-07-16T21:00:00"

    # different uid → new row
    pf.upsert_events(conn, [pa.make_event_row("tm:2", "tm-lv", "Another", "2030-08-01")])
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2


def test_upsert_skips_missing_start():
    conn = legacy_db()
    pf.ensure_schema(conn)
    bad = pa.make_event_row("x:1", "civic-emmaus", "No date", "")
    found, new = pf.upsert_events(conn, [bad])
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


def test_events_row_to_public_roundtrip():
    # Locks the events-table columns ↔ to_public_event() contract used by
    # GET /api/events (a DB row read back must map cleanly to the page shape).
    conn = legacy_db()
    pf.ensure_schema(conn)
    pf.upsert_events(conn, [pa.make_event_row(
        "tm:1", "tm-lv", "Show", "2030-07-15T20:00:00",
        category="Rock", location="Archer, Allentown",
        detail="Archer, Allentown", url="http://x")])
    row = dict(conn.execute("SELECT * FROM events WHERE active=1").fetchone())
    assert pa.to_public_event(row) == {
        "venue": "tm-lv", "title": "Show", "date": "2030-07-15",
        "time": "8:00 PM", "category": "Rock",
        "detail": "Archer, Allentown", "url": "http://x",
    }


def test_seed_civic_events_idempotent():
    import seed_civic_events as sce
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    found, new = sce.seed(conn)
    assert found == len(sce.ELECTIONS) and new == len(sce.ELECTIONS)
    found2, new2 = sce.seed(conn)                 # re-run: upsert, nothing new
    assert (found2, new2) == (len(sce.ELECTIONS), 0)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == len(sce.ELECTIONS)
    rows = conn.execute("SELECT category, source_key FROM events").fetchall()
    assert all(r["category"] == "Election" and r["source_key"] == "elections" for r in rows)


def test_purge_past_events():
    conn = legacy_db()
    pf.ensure_schema(conn)
    pf.upsert_events(conn, [
        pa.make_event_row("p:1", "tm-lv", "Long gone", "2020-01-01"),
        pa.make_event_row("p:2", "tm-lv", "Future show", "2030-01-01"),
        # multi-day that already ended → purged on its end_date
        pa.make_event_row("p:3", "tm-lv", "Old festival", "2019-12-30", end_date="2019-12-31"),
    ])
    deleted = pf.purge_past_events(conn)
    assert deleted == 2
    remaining = [r[0] for r in conn.execute("SELECT uid FROM events").fetchall()]
    assert remaining == ["p:2"]


if __name__ == "__main__":
    tests = [
        test_ensure_schema_migrates_legacy,
        test_ensure_schema_idempotent,
        test_insert_news_dedup,
        test_upsert_events_insert_then_update,
        test_upsert_skips_missing_start,
        test_events_row_to_public_roundtrip,
        test_seed_civic_events_idempotent,
        test_purge_past_events,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  {t.__name__}: PASS")
        except AssertionError as e:
            print(f"  {t.__name__}: FAIL  {e}")
            failed += 1
        except Exception as e:
            print(f"  {t.__name__}: ERROR  {e}")
            failed += 1
    print()
    if failed:
        print(f"{failed} test(s) failed.")
        sys.exit(1)
    print("All tests passed.")
