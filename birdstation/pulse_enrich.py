#!/usr/bin/env python3
"""
Pulse enrichment — AI category + one-sentence summary for feed_items.
Runs on pulse-enrich.timer, after the fetcher. Processes a batch of
un-enriched items per run (one batched Claude call); failures are
retried, capped by enrich_attempts. Mirrors the sqlite3+Row style.
"""
import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Literal

import anthropic
from pydantic import BaseModel

DB_PATH = os.path.expanduser("~/birdnet.db")
MODEL = "claude-haiku-4-5"
BATCH_SIZE = 20
MAX_ATTEMPTS = 3

CATEGORIES = [
    "Government & Politics", "Public Safety & Crime", "Business & Economy",
    "Education", "Health", "Weather & Environment", "Transportation",
    "Sports", "Arts & Culture", "Community", "Other",
]
Category = Literal[
    "Government & Politics", "Public Safety & Crime", "Business & Economy",
    "Education", "Health", "Weather & Environment", "Transportation",
    "Sports", "Arts & Culture", "Community", "Other",
]

SYSTEM_PROMPT = (
    "You are a local-news desk editor for the Lehigh Valley (Allentown, "
    "Bethlehem, Easton, PA). You receive a JSON array of articles, each with an "
    "id, a headline, and an optional blurb. Return exactly one result per id:\n"
    "- category: the single best-fit category from the fixed list.\n"
    "- summary: one plain, factual sentence (max 25 words). No clickbait, no "
    "phrases like 'this article'.\n\n"
    "GROUNDING (important): base the summary ONLY on the provided headline and "
    "blurb. Do not add facts, names, numbers, dates, locations, or outcomes that "
    "are not present in the text. If the blurb is empty or thin, summarize from "
    "the headline alone and stay general rather than guessing specifics. Never "
    "state as fact anything the text does not say.\n\n"
    "Categories: " + ", ".join(CATEGORIES) + ". Use 'Other' only when nothing fits."
)


class Enriched(BaseModel):
    id: int
    category: Category
    summary: str


class EnrichBatch(BaseModel):
    items: list[Enriched]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def fetch_batch(conn):
    rows = conn.execute(
        """SELECT rowid AS id, title, summary
           FROM feed_items
           WHERE enriched_at IS NULL AND enrich_attempts < ?
           ORDER BY (published IS NULL), published DESC
           LIMIT ?""",
        (MAX_ATTEMPTS, BATCH_SIZE),
    ).fetchall()
    return [dict(r) for r in rows]


def enrich(client, batch):
    payload = json.dumps(
        [{"id": it["id"], "headline": it["title"], "blurb": it.get("summary") or ""}
         for it in batch],
        ensure_ascii=False,
    )
    message = client.messages.parse(
        model=MODEL,
        max_tokens=2048,
        system=[{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": payload}],
        output_format=EnrichBatch,
    )
    return message.parsed_output


def main():
    conn = get_db()
    batch = fetch_batch(conn)
    if not batch:
        print("enrich: nothing to do")
        conn.close()
        return

    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from env
    try:
        result = enrich(client, batch)
    except Exception as ex:
        conn.executemany(
            "UPDATE feed_items SET enrich_attempts = enrich_attempts + 1 WHERE rowid = ?",
            [(it["id"],) for it in batch],
        )
        conn.commit()
        conn.close()
        print(f"enrich: batch failed ({ex}); bumped {len(batch)} attempts")
        raise

    by_id = {e.id: e for e in result.items}
    ok = 0
    for it in batch:
        e = by_id.get(it["id"])
        if e is None:
            conn.execute(
                "UPDATE feed_items SET enrich_attempts = enrich_attempts + 1 WHERE rowid = ?",
                (it["id"],),
            )
            continue
        conn.execute(
            "UPDATE feed_items SET category=?, ai_summary=?, enriched_at=? WHERE rowid=?",
            (e.category, e.summary.strip(), now_iso(), it["id"]),
        )
        ok += 1
    conn.commit()
    conn.close()
    print(f"enrich: {ok}/{len(batch)} enriched")


if __name__ == "__main__":
    main()
