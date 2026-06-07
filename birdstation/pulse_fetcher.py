#!/usr/bin/env python3
"""
Pulse fetcher — the ingestion dispatcher (Phase 4).

Runs on a systemd timer (pulse-fetch.timer). Each enabled feed_sources row
declares a `type` (front-door adapter) and a `content_kind` (router target):

    type 'rss'  → fetch_rss   → news  → feed_items   (the original behavior)
    type 'api'  → fetch_api   → events → events       (Ticketmaster / Legistar JSON)
    type 'ics'  → fetch_ics   → events → events       (iCalendar civic feeds)

Adapters return normalized records; the router writes them to feed_items (news,
deduped by url, purged > 30d — unchanged) or events (future-dated, UPSERT by uid,
purged after they pass). One source failing never touches the others; AI is not
used here (api/ics data is already structured — see pulse_adapters.py). The pure
parsing/mapping lives in pulse_adapters.py (stdlib-only, unit-tested).
"""
import calendar
import json
import os
import re
import sqlite3
from datetime import datetime, timezone, timedelta

import pulse_adapters as pa

DB_PATH = os.path.expanduser("~/birdnet.db")
UA = pa.UA
RETENTION_DAYS = 30           # feed_items (news) auto-delete window
EVENT_GRACE_DAYS = 2          # keep events this many days past before purging

BODY_CAP = 2000  # chars kept per item — feeds the AI enrich + digest grounding


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", text).strip()[:BODY_CAP]


def extract_body(e):
    """Richest available article text from a feed entry. Many feeds carry the full
    piece in `content:encoded` (feedparser exposes it as e.content[*].value) while
    only a one-line teaser sits in summary; discarding the full text starved the AI
    enrich/digest and drove hallucinated detail. Prefer the fullest; fall back."""
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


def eastern_today():
    """Today's date in Emmaus (Eastern), for the upcoming-events filter."""
    now = datetime.now(timezone.utc)
    if pa._EASTERN is not None:
        now = now.astimezone(pa._EASTERN)
    else:
        now = now + timedelta(hours=-5)
    return now.strftime("%Y-%m-%d")


def ensure_schema(conn):
    """Idempotently migrate to the Phase-4 shape: feed_sources gains
    type/config/content_kind; the events table is created. Runs every invocation
    (guarded by PRAGMA checks), so a plain `git pull` + the next timer fire
    migrates the live DB with no manual SQL — same pattern as the other jobs."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(feed_sources)").fetchall()]
    if "type" not in cols:
        conn.execute("ALTER TABLE feed_sources ADD COLUMN type TEXT NOT NULL DEFAULT 'rss'")
    if "config" not in cols:
        conn.execute("ALTER TABLE feed_sources ADD COLUMN config TEXT")
    if "content_kind" not in cols:
        conn.execute("ALTER TABLE feed_sources ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'news'")
    ensure_events_table(conn)
    conn.commit()


def ensure_events_table(conn):
    """Create the events table (+ index) if absent. Split out so seed_civic_events.py
    can use it without the rest of the Pulse schema present."""
    conn.execute(
        """CREATE TABLE IF NOT EXISTS events (
               id          INTEGER PRIMARY KEY AUTOINCREMENT,
               uid         TEXT UNIQUE,
               source_key  TEXT NOT NULL,
               title       TEXT NOT NULL,
               start_date  TEXT NOT NULL,
               end_date    TEXT,
               category    TEXT,
               location    TEXT,
               detail      TEXT,
               url         TEXT,
               added_at    TEXT NOT NULL,
               active      INTEGER NOT NULL DEFAULT 1
           )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_date)")
    conn.commit()


# ── Adapters ──────────────────────────────────────────────────────────────────
# Each returns a list of normalized records: news dicts (for feed_items) from rss,
# event-row dicts (for events) from api/ics. Network/JSON failures raise so main()
# records them as the source's last_status without crashing the run.

def fetch_rss(src):
    """RSS/Atom → news records (unchanged behavior)."""
    import feedparser  # lazy: api/ics sources don't need it, and tests run without it
    d = feedparser.parse(src["url"], agent=UA)
    if not d.entries:
        reason = str(d.get("bozo_exception", "")) or "no items returned"
        raise RuntimeError(reason[:160])
    items = []
    for e in d.entries:
        link = (e.get("link") or "").strip()
        if not link:
            continue
        tp = e.get("published_parsed") or e.get("updated_parsed")
        items.append({
            "url": link,
            "title": (e.get("title") or "(untitled)").strip(),
            "source_key": src["key"],
            "source": src["label"],
            "published": calendar.timegm(tp) * 1000 if tp else None,
            "summary": extract_body(e),
        })
    return items


def _config(src):
    raw = src.get("config")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise RuntimeError("bad config JSON")


def fetch_api(src):
    """A structured JSON API → event records. provider in config picks the mapping."""
    cfg = _config(src)
    provider = cfg.get("provider")
    if provider == "ticketmaster":
        key = os.environ.get("TICKETMASTER_API_KEY", "").strip()
        if not key:
            raise RuntimeError("TICKETMASTER_API_KEY not set")
        start_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        url = pa.build_ticketmaster_url(src["url"], cfg.get("params"), key, start_iso)
        data = pa.http_get_json(url)
        return pa.ticketmaster_events(data, src["key"])
    if provider == "legistar":
        client = cfg.get("client") or ""
        url = pa.build_legistar_url(src["url"], eastern_today())
        data = pa.http_get_json(url)
        rows = pa.legistar_events(data, src["key"], client)
        today = eastern_today()
        return [r for r in rows if pa.is_upcoming(r["start_date"], r["end_date"], today)]
    raise RuntimeError("unknown api provider: %r" % provider)


def fetch_ics(src):
    """An iCalendar feed → event records (upcoming only)."""
    cfg = _config(src)
    text = pa.http_get(src["url"], accept="text/calendar, text/plain, */*")
    rows = pa.ics_to_events(pa.parse_ics(text), src["key"],
                            category=cfg.get("category", "Civic meeting"))
    today = eastern_today()
    return [r for r in rows if pa.is_upcoming(r["start_date"], r["end_date"], today)]


ADAPTERS = {"rss": fetch_rss, "api": fetch_api, "ics": fetch_ics}


# ── Routers (write normalized records to the right table) ─────────────────────

def insert_news(conn, items):
    new = 0
    for it in items:
        cur = conn.execute(
            """INSERT OR IGNORE INTO feed_items
               (url, title, source_key, source, published, fetched_at, summary)
               VALUES (:url, :title, :source_key, :source, :published, :fetched_at, :summary)""",
            {**it, "fetched_at": now_iso()},
        )
        new += cur.rowcount
    return len(items), new


def upsert_events(conn, rows):
    # Honest "new" count: ON CONFLICT DO UPDATE makes rowcount 1 for both inserts
    # and updates, so determine new-ness by which uids already exist up front.
    valid = [r for r in rows if r.get("start_date")]
    uids = [r["uid"] for r in valid]
    existing = set()
    if uids:
        qmarks = ",".join("?" * len(uids))
        existing = {row[0] for row in
                    conn.execute(f"SELECT uid FROM events WHERE uid IN ({qmarks})", uids)}
    new = 0
    for r in valid:
        conn.execute(
            """INSERT INTO events
                 (uid, source_key, title, start_date, end_date, category,
                  location, detail, url, added_at, active)
               VALUES
                 (:uid, :source_key, :title, :start_date, :end_date, :category,
                  :location, :detail, :url, :added_at, 1)
               ON CONFLICT(uid) DO UPDATE SET
                 title=excluded.title, start_date=excluded.start_date,
                 end_date=excluded.end_date, category=excluded.category,
                 location=excluded.location, detail=excluded.detail,
                 url=excluded.url, active=1""",
            {**r, "added_at": now_iso()},
        )
        if r["uid"] not in existing:
            new += 1
    return len(valid), new


def purge_old_news(conn):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    deleted = conn.execute(
        "DELETE FROM feed_items WHERE fetched_at < ?", (cutoff,)
    ).rowcount
    if deleted:
        print(f"purge: removed {deleted} news items older than {RETENTION_DAYS}d")
    return deleted


def purge_past_events(conn):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=EVENT_GRACE_DAYS)).strftime("%Y-%m-%d")
    deleted = conn.execute(
        "DELETE FROM events WHERE substr(COALESCE(end_date, start_date), 1, 10) < ?",
        (cutoff,),
    ).rowcount
    if deleted:
        print(f"purge: removed {deleted} past events (before {cutoff})")
    return deleted


def main():
    conn = get_db()
    ensure_schema(conn)
    sources = conn.execute(
        "SELECT key, label, url, type, config, content_kind "
        "FROM feed_sources WHERE enabled = 1"
    ).fetchall()
    for row in sources:
        src = dict(row)
        stype = (src.get("type") or "rss").strip()
        kind = (src.get("content_kind") or "news").strip()
        try:
            adapter = ADAPTERS.get(stype)
            if adapter is None:
                raise RuntimeError("unknown source type: %r" % stype)
            records = adapter(src)
            if kind == "events":
                found, new = upsert_events(conn, records)
            else:
                found, new = insert_news(conn, records)
            conn.execute(
                "UPDATE feed_sources SET last_status='ok', last_count=?, last_fetch=? WHERE key=?",
                (found, now_iso(), src["key"]),
            )
            print(f"{src['key']}: {found} {kind} ({new} new)")
        except Exception as ex:
            conn.execute(
                "UPDATE feed_sources SET last_status=?, last_fetch=? WHERE key=?",
                (str(ex)[:200], now_iso(), src["key"]),
            )
            print(f"{src['key']}: ERROR {ex}")
        conn.commit()
    purge_old_news(conn)
    purge_past_events(conn)
    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
