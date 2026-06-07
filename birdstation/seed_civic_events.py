#!/usr/bin/env python3
"""
Seed civic/voting dates into the events table (the "manual" content path for
low-churn, hand-known dates — no source feed, no scraper). Idempotent: each row
has a stable uid, so re-running upserts in place rather than duplicating.

Run on the box once (and again whenever you add dates):
    python3 birdstation/seed_civic_events.py

These surface on the What's On page under the 🗳️ "Elections & Voting" bucket and
feed the civic-aware digest. Edit ELECTIONS below to add primaries, municipal
elections, or deadlines as they're scheduled.
"""
import sys

from pulse_adapters import make_event_row
from pulse_fetcher import ensure_events_table, get_db, upsert_events

VOTE_URL = "https://www.votespa.com/"

# Pennsylvania, Lehigh Valley. Keep future-dated; past rows are purged by the
# fetcher's event purge after they pass.
ELECTIONS = [
    {"id": "pa-2026-general", "title": "General Election", "date": "2026-11-03",
     "detail": "Pennsylvania general election. Polls open 7 AM – 8 PM."},
    {"id": "pa-2026-general-registration", "title": "Voter registration deadline",
     "date": "2026-10-19",
     "detail": "Last day to register to vote in the November 3 general election."},
    {"id": "pa-2026-general-mailballot", "title": "Mail-ballot application deadline",
     "date": "2026-10-27",
     "detail": "Last day to apply for a mail-in or absentee ballot (5 PM)."},
]


def seed(conn):
    """Upsert the ELECTIONS rows; returns (count, newly_inserted). Pure (takes a
    connection) so it's testable against an in-memory DB."""
    ensure_events_table(conn)
    rows = [
        make_event_row(
            uid="elections:" + e["id"], source_key="elections",
            title=e["title"], start_date=e["date"], category="Election",
            location="Pennsylvania", detail=e.get("detail"), url=VOTE_URL)
        for e in ELECTIONS
    ]
    return upsert_events(conn, rows)


def main():
    conn = get_db()
    found, new = seed(conn)
    conn.commit()
    conn.close()
    print(f"seed_civic_events: {found} dates upserted ({new} new)")


if __name__ == "__main__":
    sys.exit(main())
