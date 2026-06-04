#!/usr/bin/env python3
"""
Pulse digest — a daily Claude-written "Lehigh Valley morning brief".
Runs on pulse-digest.timer (~6 AM local). Reads the last 24h of enriched
feed_items, synthesizes a short sectioned brief WITH citations, and stores it
in feed_digests (one row per local date; re-running the same day overwrites).

Citations: each item is fed with its rowid as `id`; Claude returns the ids it
drew from per section; we resolve those ids to {n, title, url, source} here so
the model never emits a URL (no hallucinated links). Numbers are global across
the brief, assigned in first-seen order. feed_items has no integer id/link
column — the PK is `url` and `rowid` is the stable item id.
"""
import json
import os
import sqlite3
from datetime import date, datetime, timedelta, timezone

import anthropic
from pydantic import BaseModel, Field

DB_PATH = os.path.expanduser("~/birdnet.db")
MODEL = "claude-sonnet-4-6"
WINDOW_HOURS = 24
MAX_ITEMS = 150

SYSTEM_PROMPT = (
    "You are the morning editor for a Lehigh Valley (Allentown, Bethlehem, "
    "Easton, PA) news brief. You are given the past day's headlines, each with "
    "an id, a category, a one-sentence summary, and an excerpt from the article "
    "(may be empty). Write a concise morning brief:\n"
    "- headline: a single line capturing the day's overall tenor.\n"
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
    "residents."
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


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def main():
    conn = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)).isoformat()
    rows = conn.execute(
        """SELECT rowid AS id, title, source, url, category, ai_summary, summary
           FROM feed_items
           WHERE enriched_at IS NOT NULL AND fetched_at > ?
           ORDER BY (published IS NULL), published DESC
           LIMIT ?""",
        (cutoff, MAX_ITEMS),
    ).fetchall()

    if len(rows) < 3:
        print(f"digest: only {len(rows)} items in window — skipping")
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

    client = anthropic.Anthropic()
    message = client.messages.parse(
        model=MODEL,
        max_tokens=16000,   # headroom for adaptive thinking + the citations output
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user",
                   "content": "Here are the past day's items:\n" + payload}],
        output_format=Digest,
    )
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

    today = date.today().isoformat()
    conn.execute(
        """INSERT OR REPLACE INTO feed_digests
           (date, generated_at, headline, sections_json, citations_json,
            model, item_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            today,
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
    print(f"digest: wrote {today} ({len(sections_out)} sections, "
          f"{len(citations_out)} citations, from {len(rows)} items)")


if __name__ == "__main__":
    main()
