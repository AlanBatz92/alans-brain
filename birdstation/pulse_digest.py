#!/usr/bin/env python3
"""
Pulse digest — a daily Claude-written "Lehigh Valley morning brief".
Runs on pulse-digest.timer (~6 AM local). Reads the last 24h of enriched
feed_items, synthesizes a short sectioned brief, stores it in feed_digests
(one row per local date; re-running the same day overwrites).
"""
import json
import os
import sqlite3
from datetime import date, datetime, timedelta, timezone

import anthropic
from pydantic import BaseModel

DB_PATH = os.path.expanduser("~/birdnet.db")
MODEL = "claude-sonnet-4-6"
WINDOW_HOURS = 24
MAX_ITEMS = 150

SYSTEM_PROMPT = (
    "You are the morning editor for a Lehigh Valley (Allentown, Bethlehem, "
    "Easton, PA) news brief. You are given the past day's headlines, each with a "
    "category and a one-sentence summary. Write a concise morning brief:\n"
    "- headline: a single line capturing the day's overall tenor.\n"
    "- sections: 3 to 6 thematic sections. Each has a short heading and a 2-4 "
    "sentence body that SYNTHESIZES the related items (connect them, note what "
    "matters) rather than just listing them.\n\n"
    "Be factual and local. Use only the provided items — do not invent details. "
    "Lead with what's most significant to Lehigh Valley residents."
)


class DigestSection(BaseModel):
    heading: str
    body: str


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
        """SELECT title, category, ai_summary
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

    payload = json.dumps(
        [{"headline": r["title"], "category": r["category"],
          "summary": r["ai_summary"]} for r in rows],
        ensure_ascii=False,
    )

    client = anthropic.Anthropic()
    message = client.messages.parse(
        model=MODEL,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user",
                   "content": "Here are the past day's items:\n" + payload}],
        output_format=Digest,
    )
    digest = message.parsed_output

    today = date.today().isoformat()
    conn.execute(
        """INSERT OR REPLACE INTO feed_digests
           (date, generated_at, headline, sections_json, model, item_count)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            today,
            datetime.now(timezone.utc).isoformat(),
            digest.headline,
            json.dumps([s.model_dump() for s in digest.sections], ensure_ascii=False),
            MODEL,
            len(rows),
        ),
    )
    conn.commit()
    conn.close()
    print(f"digest: wrote {today} ({len(digest.sections)} sections from {len(rows)} items)")


if __name__ == "__main__":
    main()
