#!/usr/bin/env python3
"""
Pulse fetcher — pulls Lehigh Valley news feeds into birdnet.db.
Runs on a systemd timer (pulse-fetch.timer). Mirrors birdnet_pipeline.py.
Dedupes by article URL; records per-source health in feed_sources.
"""
import calendar
import re
import os
import sqlite3
import feedparser
from datetime import datetime, timezone, timedelta

DB_PATH = os.path.expanduser("~/birdnet.db")
UA = "Mozilla/5.0 (compatible; EmmausPulse/1.0; +https://www.alansbrain.com)"
RETENTION_DAYS = 30

BODY_CAP = 2000  # chars kept per item — feeds the AI enrich + digest grounding

def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", text).strip()[:BODY_CAP]


def extract_body(e):
    """Richest available article text from a feed entry.

    Many feeds carry the full piece in `content:encoded` (feedparser exposes it
    as e.content[*].value) while only a one-line teaser sits in summary. We were
    discarding the full text and truncating the teaser to 500 chars, which left
    the AI enrich/digest synthesizing from almost nothing — a big driver of
    hallucinated detail. Prefer the fullest content; fall back to summary."""
    best = ""
    content = e.get("content")
    if isinstance(content, list):
        for c in content:
            val = (c or {}).get("value") or ""
            if len(val) > len(best):
                best = val
    if not best:
        best = e.get("summary") or e.get("description") or ""
    return clean(best)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def fetch_source(src):
    d = feedparser.parse(src["url"], agent=UA)
    if not d.entries:
        reason = str(d.get("bozo_exception", "")) or "no items returned"
        raise RuntimeError(reason[:160])
    items = []
    for e in d.entries:
        link = (e.get("link") or "").strip()
        if not link:
            continue
        title = (e.get("title") or "(untitled)").strip()
        blurb = extract_body(e)
        tp = e.get("published_parsed") or e.get("updated_parsed")
        published_ms = calendar.timegm(tp) * 1000 if tp else None
        items.append((link, title, src["key"], src["label"], published_ms, blurb))
    return items


def purge_old(conn):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    deleted = conn.execute(
        "DELETE FROM feed_items WHERE fetched_at < ?", (cutoff,)
    ).rowcount
    conn.commit()
    if deleted:
        print(f"purge: removed {deleted} items older than {RETENTION_DAYS}d")
    return deleted


def main():
    conn = get_db()
    sources = conn.execute(
        "SELECT key, label, url FROM feed_sources WHERE enabled = 1"
    ).fetchall()
    for row in sources:
        src = dict(row)
        try:
            items = fetch_source(src)
            new = 0
            for (link, title, key, label, published_ms, blurb) in items:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO feed_items
                       (url, title, source_key, source, published, fetched_at, summary)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (link, title, key, label, published_ms, now_iso(), blurb),
                )
                new += cur.rowcount
            conn.execute(
                "UPDATE feed_sources SET last_status='ok', last_count=?, last_fetch=? WHERE key=?",
                (len(items), now_iso(), src["key"]),
            )
            print(f"{src['key']}: {len(items)} items ({new} new)")
        except Exception as ex:
            conn.execute(
                "UPDATE feed_sources SET last_status=?, last_fetch=? WHERE key=?",
                (str(ex)[:200], now_iso(), src["key"]),
            )
            print(f"{src['key']}: ERROR {ex}")
        conn.commit()
    purge_old(conn)
    conn.close()


if __name__ == "__main__":
    main()
