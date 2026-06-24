#!/usr/bin/env python3
"""
event_parser.py — turn a pasted blob of text (a flyer, a newsletter email, a copied
web page) into structured Lehigh Valley "What's On" events for the Pulse events store.

This is the brain behind the paste-to-capture pipeline (pulse_add.py) and, later, the
scrape/email adapters: one grounded Claude pass extracts whatever real events are in
the text, and a pure `normalize()` step validates + stamps them into row dicts ready
for the `events` table. Split that way so the validation/dedup logic is unit-testable
without hitting the API (see test_event_parser.py).

Model + style mirror pulse_enrich.py / pulse_digest.py: claude-haiku-4-5, structured
output via messages.parse(), a GROUNDED system prompt ("be vague rather than wrong",
never invent specifics), and anthropic.APIError handled by the caller.
"""

import re
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel

MODEL = "claude-haiku-4-5"

# Two on-page sections: a venue happening vs. a government / civic notice.
Kind = Literal["event", "civic"]

VALID_KINDS = ("event", "civic")
VALID_SOURCES = ("manual", "ical", "rss", "scrape", "email")


class ParsedEvent(BaseModel):
    title: str
    kind: Kind = "event"
    starts_at: str                     # ISO 8601: "2026-07-04" or "2026-07-04T19:30"
    ends_at: Optional[str] = None
    all_day: bool = False
    venue: Optional[str] = None
    location: Optional[str] = None     # city/region text, e.g. "Allentown, PA"
    url: Optional[str] = None
    description: Optional[str] = None


class EventBatch(BaseModel):
    events: list[ParsedEvent]


SYSTEM_PROMPT = """\
You extract real, dated happenings from a blob of text a human pasted in — a venue \
flyer, a newsletter email, a copied web page, or a government/civic notice — for a \
Greater Lehigh Valley (Pennsylvania) "What's On" board.

Return ONLY events that are explicitly present in the text. Each needs at least a \
title and a start date. Rules:

- GROUNDING: use only what the text states. Do NOT invent or guess venues, dates, \
  times, prices, performers, addresses, or URLs. If a field isn't in the text, leave \
  it null. Be vague rather than wrong.
- DATES: normalize to ISO 8601. Date only -> "YYYY-MM-DD"; with a time -> \
  "YYYY-MM-DDTHH:MM" (24h, the venue's local clock). The user message states TODAY's \
  date — resolve relative words ("this Friday", "next week", "tonight") against it. If \
  a date is genuinely absent or unresolvable, DROP that event (don't guess a year).
- all_day: true only when the text gives no clock time (a date but no time).
- KIND: "civic" for government / public-meeting / agenda / hearing / election / \
  ballot / voting items; "event" for everything else (concerts, theater, festivals, \
  markets, talks, screenings).
- venue: the place ("Miller Symphony Hall"). location: the city/region text \
  ("Allentown, PA") if stated.
- url: only a real link copied in the text. Never fabricate one.
- description: at most one short factual sentence drawn from the text, or null. No hype.
- If the text contains no datable event, return an empty list.
"""


def build_user_message(text: str, today: Optional[str] = None) -> str:
    """The user turn: today's date (for relative-date resolution) + the raw blob."""
    today = today or datetime.now(timezone.utc).date().isoformat()
    text = (text or "").strip()
    return f"TODAY is {today}.\n\nText to extract events from:\n\"\"\"\n{text}\n\"\"\""


def call_model(client, text: str, today: Optional[str] = None) -> EventBatch:
    """One grounded Claude pass -> EventBatch. Raises anthropic.APIError on API trouble
    (the caller decides how to surface it)."""
    message = client.messages.parse(
        model=MODEL,
        max_tokens=2048,
        system=[{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": build_user_message(text, today)}],
        output_format=EventBatch,
    )
    return message.parsed_output


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(s: str) -> str:
    return _SLUG_RE.sub("-", (s or "").strip().lower()).strip("-")


def dedup_key(title: str, starts_at: str, venue: Optional[str]) -> str:
    """Stable key so the same event pasted twice can't double-insert. Date-granular
    (drop any time) so "7:30 PM" vs "19:30" phrasings of one show still collapse."""
    day = (starts_at or "")[:10]
    return "|".join((_slug(title), day, _slug(venue or "")))


def _clean(v):
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def normalize(parsed, source: str = "manual", source_key: Optional[str] = None,
              now: Optional[str] = None):
    """Pure step: validate ParsedEvent objects (or plain dicts) into row dicts for the
    `events` table — drops anything without a title + start date, clamps `kind`/`source`,
    computes `dedup_key`, de-dupes within the batch, and stamps `added_at`. No I/O, so
    it's fully unit-testable.

    `parsed` may be an EventBatch, a list of ParsedEvent, or a list of dicts."""
    now = now or datetime.now(timezone.utc).isoformat()
    source = source if source in VALID_SOURCES else "manual"

    if isinstance(parsed, EventBatch):
        items = parsed.events
    else:
        items = list(parsed or [])

    rows = []
    seen = set()
    for it in items:
        d = it.model_dump() if isinstance(it, BaseModel) else dict(it)
        title = _clean(d.get("title"))
        starts_at = _clean(d.get("starts_at"))
        if not title or not starts_at or len(starts_at) < 10:
            continue  # need at least a title and a YYYY-MM-DD start
        kind = d.get("kind")
        kind = kind if kind in VALID_KINDS else "event"
        key = dedup_key(title, starts_at, d.get("venue"))
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "title": title,
            "kind": kind,
            "starts_at": starts_at,
            "ends_at": _clean(d.get("ends_at")),
            "all_day": 1 if d.get("all_day") else 0,
            "venue": _clean(d.get("venue")),
            "location": _clean(d.get("location")),
            "url": _clean(d.get("url")),
            "description": _clean(d.get("description")),
            "source": source,
            "source_key": _clean(source_key),
            "dedup_key": key,
            "added_at": now,
        })
    return rows


def parse_events(client, text: str, today: Optional[str] = None,
                 source: str = "manual", source_key: Optional[str] = None):
    """Full path: Claude extract -> normalized row dicts. `client` is an
    anthropic.Anthropic() (injectable for tests)."""
    batch = call_model(client, text, today)
    return normalize(batch, source=source, source_key=source_key)
