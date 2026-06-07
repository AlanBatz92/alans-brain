#!/usr/bin/env python3
"""
Pulse digest — a Claude-written "Lehigh Valley brief", twice a day.
Runs on pulse-digest.timer (06:00 + 17:00 America/New_York). Each run reads the
enriched feed_items that arrived SINCE THE LAST BRIEF, synthesizes a short
sectioned brief WITH citations, and stores it in feed_digests keyed by
(Eastern date, slot) where slot is 'morning' or 'evening' — so the two daily
briefs coexist and each is fresh (no re-tread).

Citations: each item is fed with its rowid as `id`; Claude returns the ids it
drew from per section; we resolve those ids to {n, title, url, source} here so
the model never emits a URL (no hallucinated links). Numbers are global across
the brief, assigned in first-seen order. feed_items has no integer id/link
column — the PK is `url` and `rowid` is the stable item id.
"""
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone

import anthropic
from pydantic import BaseModel, Field

import pulse_adapters as pa   # stdlib-only — friendly_time for the events block

DB_PATH = os.path.expanduser("~/birdnet.db")
MODEL = "claude-haiku-4-5"        # Haiku + extended thinking (see THINKING) — far
                                  # cheaper than Sonnet, and grounded enough now to
                                  # handle the synthesis (see the GROUNDING rule).
MAX_LOOKBACK_HOURS = 24           # floor on the "since last brief" window so a
                                  # first run / outage gap can't pull a huge backlog
MAX_ITEMS = 150
MIN_ITEMS = 3                     # skip a brief with too little to synthesize

# Haiku 4.5 supports extended ("enabled") thinking but NOT "adaptive" thinking
# (which 400s). budget_tokens is the thinking allowance; max_tokens must exceed it.
THINKING = {"type": "enabled", "budget_tokens": 4000}

# Eastern time — the brief's slot (morning/evening) and its date are local, and
# the box stores naive-UTC timestamps. zoneinfo when available (the box has tzdata);
# a fixed-offset fallback is fine here since slot/date is a coarse noon split.
try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    EASTERN = timezone(timedelta(hours=-5))

# API/account/network failures (incl. an empty credit balance, rate limits, 5xx,
# network blips). On these the digest just retries next run rather than crashing
# with a traceback. `anthropic.APIError` is the base for all API-layer errors.
TRANSIENT_API_ERRORS = (anthropic.APIError,)

SYSTEM_PROMPT = (
    "You are the editor for a Lehigh Valley (Allentown, Bethlehem, "
    "Easton, PA) news brief. You are given the latest headlines (everything since "
    "the previous brief), each with an id, a category, a one-sentence summary, and "
    "an excerpt from the article (may be empty). Write a concise brief:\n"
    "- headline: a single line capturing the overall tenor.\n"
    "- sections: 3 to 6 thematic sections. Each has a short heading and a 2-4 "
    "sentence body that SYNTHESIZES the related items (connect them, note what "
    "matters) rather than just listing them.\n"
    "- citation_ids: for each section, the ids of the items that section draws "
    "from. Include every item you used; order them by how central they are.\n\n"
    "GROUNDING (critical): every statement must be supported by the provided "
    "summaries and excerpts. Do NOT invent specifics — figures, dollar amounts, "
    "dates, names, quotes, causes, or outcomes — that are not present in the text. "
    "When the items are thin on detail, describe the story in general terms rather "
    "than guessing; it is better to be vague than wrong. Never assert anything you "
    "cannot point to in a provided item, and use only the provided ids.\n\n"
    "Be factual and local. Lead with what's most significant to Lehigh Valley "
    "residents.\n\n"
    "UPCOMING EVENTS: you may also be given a short list of upcoming local events "
    "(concerts, civic meetings, election dates) that have NO ids. If that list is "
    "present and has anything noteworthy, add ONE final short section (heading like "
    "\"On the calendar\") noting the most relevant few in plain terms. Because these "
    "have no ids, give that section an empty citation_ids list, and never place an "
    "event in another section's citations. Do not invent events beyond those given."
)


class DigestSection(BaseModel):
    heading: str
    body: str
    citation_ids: list[int] = Field(
        default_factory=list,
        description="feed_items rowids this section draws from",
    )


class Digest(BaseModel):
    headline: str
    sections: list[DigestSection]


def generate(client, user_content, use_thinking):
    """One digest call. `use_thinking` toggles extended thinking so the caller can
    retry without it on a model that rejects thinking entirely."""
    kwargs = dict(
        model=MODEL,
        max_tokens=16000,   # headroom for thinking + the citations output
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
        output_format=Digest,
    )
    if use_thinking:
        kwargs["thinking"] = THINKING
    return client.messages.parse(**kwargs)


def fetch_upcoming_events(conn, limit=12):
    """A few soonest upcoming events so the brief can be civic/event-aware. Returns
    [] when the events table is absent (pre-migration box) or nothing's upcoming,
    so the digest behaves exactly as before in that case."""
    has = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'"
    ).fetchone()
    if not has:
        return []
    today = datetime.now(EASTERN).strftime("%Y-%m-%d")
    rows = conn.execute(
        "SELECT title, start_date, end_date, category, location FROM events "
        "WHERE active = 1 AND substr(COALESCE(end_date, start_date), 1, 10) >= ? "
        "ORDER BY start_date ASC LIMIT ?",
        (today, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn):
    """Idempotently migrate feed_digests to the (date, slot) PK so morning and
    evening briefs coexist. SQLite can't add to a PK in place, so rebuild — but
    only once (guarded on the `slot` column). Runs on every digest invocation, so
    a plain `git pull` + restart migrates the live DB with no manual SQL."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(feed_digests)").fetchall()]
    if "slot" in cols:
        return
    conn.executescript(
        """
        ALTER TABLE feed_digests RENAME TO feed_digests_old;
        CREATE TABLE feed_digests (
            date           TEXT NOT NULL,
            slot           TEXT NOT NULL DEFAULT 'morning',
            generated_at   TEXT NOT NULL,
            headline       TEXT NOT NULL,
            sections_json  TEXT NOT NULL,
            citations_json TEXT,
            model          TEXT,
            item_count     INTEGER,
            PRIMARY KEY (date, slot)
        );
        INSERT INTO feed_digests
            (date, slot, generated_at, headline, sections_json, citations_json, model, item_count)
            SELECT date, 'morning', generated_at, headline, sections_json,
                   citations_json, model, item_count
            FROM feed_digests_old;
        DROP TABLE feed_digests_old;
        """
    )
    conn.commit()
    print("digest: migrated feed_digests to (date, slot) PK")


def main():
    conn = get_db()
    ensure_schema(conn)

    now_e = datetime.now(EASTERN)
    slot = "morning" if now_e.hour < 12 else "evening"
    today = now_e.strftime("%Y-%m-%d")

    # Window "since the last brief": items enriched after the previous digest was
    # generated, so each brief is genuinely new (no re-tread). We window on
    # enriched_at (not fetched_at) so an item that enriched late still lands in the
    # next brief instead of being skipped. Floor the look-back so a first run or an
    # outage gap can't pull an unbounded backlog.
    floor = (datetime.now(timezone.utc) - timedelta(hours=MAX_LOOKBACK_HOURS)).isoformat()
    last = conn.execute("SELECT MAX(generated_at) FROM feed_digests").fetchone()[0]
    cutoff = max(last, floor) if last else floor  # ISO-8601 UTC strings sort lexically

    rows = conn.execute(
        """SELECT rowid AS id, title, source, url, category, ai_summary, summary
           FROM feed_items
           WHERE enriched_at IS NOT NULL AND enriched_at > ?
           ORDER BY (published IS NULL), published DESC
           LIMIT ?""",
        (cutoff, MAX_ITEMS),
    ).fetchall()

    if len(rows) < MIN_ITEMS:
        print(f"digest: only {len(rows)} new items since last brief — skipping {slot}")
        conn.close()
        return

    by_id = {r["id"]: r for r in rows}
    # Hand the model the article excerpt alongside the one-sentence AI summary so
    # synthesis is grounded in real text, not a lossy one-liner (the excerpt is the
    # richer body the fetcher now captures). Cap per item to keep the prompt bounded.
    payload = json.dumps(
        [{"id": r["id"], "headline": r["title"], "category": r["category"],
          "summary": r["ai_summary"],
          "excerpt": (r["summary"] or "")[:500]} for r in rows],
        ensure_ascii=False,
    )

    user_content = "Here are the latest items since the previous brief:\n" + payload
    events = fetch_upcoming_events(conn)
    if events:
        ev_payload = json.dumps(
            [{"title": e["title"], "date": (e["start_date"] or "")[:10],
              "time": pa.friendly_time(e["start_date"]),
              "category": e["category"], "where": e["location"]} for e in events],
            ensure_ascii=False,
        )
        user_content += ("\n\nUPCOMING LOCAL EVENTS (no ids — for an optional "
                         "\"On the calendar\" section):\n" + ev_payload)

    client = anthropic.Anthropic()
    try:
        try:
            message = generate(client, user_content, use_thinking=True)
        except anthropic.BadRequestError as ex:
            # If the model rejects thinking (e.g. an unsupported thinking type),
            # fall back to no thinking so a brief still gets written.
            if "thinking" not in str(ex).lower():
                raise
            print(f"digest: thinking unsupported on {MODEL}, retrying without it")
            message = generate(client, user_content, use_thinking=False)
    except TRANSIENT_API_ERRORS as ex:
        conn.close()
        print(f"digest: API unavailable, retrying next run ({ex})")
        raise SystemExit(1)
    digest = message.parsed_output
    if digest is None:
        raise RuntimeError(
            f"digest parse returned None (stop_reason={message.stop_reason}); "
            "likely truncated — raise max_tokens, or check for a refusal"
        )

    # Resolve citation ids → globally-numbered links, first-seen order.
    order, num = [], {}
    for s in digest.sections:
        for cid in s.citation_ids:
            if cid in by_id and cid not in num:
                order.append(cid)
                num[cid] = len(order)

    def cite(cid):
        r = by_id[cid]
        return {"n": num[cid], "title": r["title"],
                "url": r["url"], "source": r["source"]}

    sections_out = []
    for s in digest.sections:
        seen, sec_cites = set(), []
        for cid in s.citation_ids:
            if cid in num and cid not in seen:
                seen.add(cid)
                sec_cites.append(cite(cid))
        sections_out.append({"heading": s.heading, "body": s.body,
                             "citations": sec_cites})

    citations_out = [cite(cid) for cid in order]

    conn.execute(
        """INSERT OR REPLACE INTO feed_digests
           (date, slot, generated_at, headline, sections_json, citations_json,
            model, item_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            today,
            slot,
            datetime.now(timezone.utc).isoformat(),
            digest.headline,
            json.dumps(sections_out, ensure_ascii=False),
            json.dumps(citations_out, ensure_ascii=False),
            MODEL,
            len(rows),
        ),
    )
    conn.commit()
    conn.close()
    print(f"digest: wrote {today} {slot} ({len(sections_out)} sections, "
          f"{len(citations_out)} citations, from {len(rows)} items)")


if __name__ == "__main__":
    main()
