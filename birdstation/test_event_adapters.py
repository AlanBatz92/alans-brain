#!/usr/bin/env python3
"""Standalone unit tests for pulse_adapters.py (the Phase-4 ingestion parsing).

Imports the real module (stdlib-only, no feedparser/anthropic/fastapi needed), so
there's no logic drift. Run with: python3 birdstation/test_event_adapters.py
"""
import sys

import pulse_adapters as pa


# ── date / time helpers ───────────────────────────────────────────────────────

def test_parse_clock():
    assert pa.parse_clock("6:00 PM") == "18:00:00"
    assert pa.parse_clock("6:00:00 PM") == "18:00:00"
    assert pa.parse_clock("12:00 AM") == "00:00:00"
    assert pa.parse_clock("12:00 PM") == "12:00:00"
    assert pa.parse_clock("20:00") == "20:00:00"
    assert pa.parse_clock("9:30 am") == "09:30:00"
    assert pa.parse_clock("") == ""
    assert pa.parse_clock("noon") == ""


def test_combine_date_time():
    assert pa.combine_date_time("2026-06-04", "6:00 PM") == "2026-06-04T18:00:00"
    assert pa.combine_date_time("2026-06-04T00:00:00", "") == "2026-06-04"
    assert pa.combine_date_time("2026-06-04", "") == "2026-06-04"


def test_friendly_time():
    assert pa.friendly_time("2026-07-15T20:00:00") == "8:00 PM"
    assert pa.friendly_time("2026-07-15T09:30:00") == "9:30 AM"
    assert pa.friendly_time("2026-07-15T00:00:00") == "12:00 AM"
    assert pa.friendly_time("2026-07-15") == ""


def test_is_upcoming():
    assert pa.is_upcoming("2026-06-10", None, "2026-06-07") is True
    assert pa.is_upcoming("2026-06-07", None, "2026-06-07") is True   # today survives
    assert pa.is_upcoming("2026-06-05", None, "2026-06-07") is False
    # ends in the future though it started in the past (multi-day) → still upcoming
    assert pa.is_upcoming("2026-06-01", "2026-06-09", "2026-06-07") is True
    assert pa.is_upcoming("", "", "2026-06-07") is False


# ── iCalendar ─────────────────────────────────────────────────────────────────

def test_normalize_ics_dt():
    assert pa.normalize_ics_dt("20260704") == "2026-07-04"                       # DATE
    assert pa.normalize_ics_dt("20260710T190000") == "2026-07-10T19:00:00"       # floating local
    # UTC ("Z") → Eastern wall time: July = EDT (UTC-4): 22:00Z → 18:00 local.
    assert pa.normalize_ics_dt("20260704T220000Z") == "2026-07-04T18:00:00"
    # January = EST (UTC-5): 12:00Z → 07:00 local.
    assert pa.normalize_ics_dt("20260115T120000Z") == "2026-01-15T07:00:00"
    assert pa.normalize_ics_dt("garbage") == ""


ICS_SAMPLE = "\r\n".join([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:evt-100@emmauspa.gov",
    "SUMMARY:Planning Commiss",      # folded across two physical lines →
    " ion Meeting",                  #   "Planning Commission Meeting"
    "DTSTART;TZID=America/New_York:20260710T190000",
    "LOCATION:Borough Hall\\, 28 S 4th St",
    "DESCRIPTION:Monthly\\nmeeting.",
    "URL:https://www.emmauspa.gov/Calendar.aspx?EID=1294",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:evt-200@emmauspa.gov",
    "SUMMARY:Community Cleanup Day",
    "DTSTART;VALUE=DATE:20260711",
    "END:VEVENT",
    "END:VCALENDAR",
])


def test_parse_ics_unfold_and_fields():
    evs = pa.parse_ics(ICS_SAMPLE)
    assert len(evs) == 2
    e0 = evs[0]
    assert e0["title"] == "Planning Commission Meeting"     # unfolded
    assert e0["start"] == "2026-07-10T19:00:00"             # TZID local kept as-is
    assert e0["location"] == "Borough Hall, 28 S 4th St"    # \, unescaped
    assert e0["description"] == "Monthly meeting."          # \n → space
    assert e0["uid"] == "evt-100@emmauspa.gov"
    assert evs[1]["start"] == "2026-07-11"                  # all-day DATE


def test_ics_to_events():
    rows = pa.ics_to_events(pa.parse_ics(ICS_SAMPLE), "civic-emmaus")
    assert rows[0]["uid"] == "civic-emmaus:evt-100@emmauspa.gov"
    assert rows[0]["source_key"] == "civic-emmaus"
    assert rows[0]["category"] == "Civic meeting"
    assert rows[0]["title"] == "Planning Commission Meeting"
    assert rows[1]["start_date"] == "2026-07-11"


def test_ics_to_events_synthesizes_uid_when_missing():
    parsed = [{"title": "No UID event", "start": "2026-08-01"}]
    rows = pa.ics_to_events(parsed, "civic-emmaus")
    assert rows[0]["uid"].startswith("civic-emmaus:2026-08-01")


# ── Ticketmaster ──────────────────────────────────────────────────────────────

TM_SAMPLE = {"_embedded": {"events": [
    {"id": "G5v0Z", "name": "The Band Live", "url": "https://tm/eventX",
     "dates": {"start": {"localDate": "2026-07-15", "localTime": "20:00:00"}},
     "classifications": [{"segment": {"name": "Music"}, "genre": {"name": "Rock"}}],
     "_embedded": {"venues": [{"name": "Archer Music Hall", "city": {"name": "Allentown"}}]}},
    {"id": "TBA1", "name": "To Be Announced", "dates": {"start": {}}},     # undated → skip
]}}


def test_ticketmaster_events_mapping():
    rows = pa.ticketmaster_events(TM_SAMPLE, "tm-lv")
    assert len(rows) == 1                                  # undated skipped
    r = rows[0]
    assert r["uid"] == "tm:G5v0Z"
    assert r["source_key"] == "tm-lv"
    assert r["title"] == "The Band Live"
    assert r["start_date"] == "2026-07-15T20:00:00"
    assert r["category"] == "Rock"
    assert r["location"] == "Archer Music Hall, Allentown"
    assert r["url"] == "https://tm/eventX"


def test_ticketmaster_genre_falls_back_to_segment():
    data = {"_embedded": {"events": [
        {"id": "X", "name": "Show", "dates": {"start": {"localDate": "2026-09-01"}},
         "classifications": [{"segment": {"name": "Arts & Theatre"},
                              "genre": {"name": "Undefined"}}]},
    ]}}
    rows = pa.ticketmaster_events(data, "tm-lv")
    assert rows[0]["category"] == "Arts & Theatre"         # skips "Undefined" genre
    assert rows[0]["start_date"] == "2026-09-01"           # date-only (no localTime)


def test_ticketmaster_empty():
    assert pa.ticketmaster_events({}, "tm-lv") == []
    assert pa.ticketmaster_events({"_embedded": {"events": []}}, "tm-lv") == []


# ── Legistar ──────────────────────────────────────────────────────────────────

LEGISTAR_SAMPLE = [
    {"EventId": 111, "EventBodyName": "City Council",
     "EventDate": "2026-06-10T00:00:00", "EventTime": "6:00 PM",
     "EventLocation": "Council Chambers", "EventComment": "",
     "EventInSiteURL": "https://allentownpa.legistar.com/Meeting.aspx?ID=111"},
    {"EventId": 112, "EventBodyName": "Planning Commission",
     "EventDate": "2026-06-12T00:00:00", "EventTime": "",
     "EventLocation": "", "EventInSiteURL": ""},
]


def test_legistar_events_mapping():
    rows = pa.legistar_events(LEGISTAR_SAMPLE, "civic-allentown", "allentownpa")
    assert len(rows) == 2
    a = rows[0]
    assert a["uid"] == "legistar:allentownpa:111"
    assert a["source_key"] == "civic-allentown"
    assert a["title"] == "City Council"
    assert a["start_date"] == "2026-06-10T18:00:00"
    assert a["category"] == "Civic meeting"
    assert a["location"] == "Council Chambers"
    assert a["url"].endswith("ID=111")
    # No EventTime → date-only start, no url/location
    assert rows[1]["start_date"] == "2026-06-12"
    assert rows[1]["url"] is None


# ── URL builders ──────────────────────────────────────────────────────────────

def test_build_ticketmaster_url():
    import urllib.parse as up
    url = pa.build_ticketmaster_url(
        "https://app.ticketmaster.com/discovery/v2/events.json",
        {"latlong": "40.6,-75.4", "segmentId": ["A", "B"], "size": "100"},
        "SECRETKEY", start_iso="2026-06-07T00:00:00Z")
    q = up.parse_qs(up.urlsplit(url).query)
    assert q["apikey"] == ["SECRETKEY"]
    assert q["segmentId"] == ["A", "B"]            # list → repeated params
    assert q["sort"] == ["date,asc"]               # default applied
    assert q["startDateTime"] == ["2026-06-07T00:00:00Z"]
    assert q["size"] == ["100"]


def test_build_legistar_url():
    url = pa.build_legistar_url("https://webapi.legistar.com/v1/allentownpa/Events",
                                "2026-06-07")
    assert url.startswith("https://webapi.legistar.com/v1/allentownpa/Events?$filter=")
    assert "EventDate" in url and "2026-06-07T00:00:00" in url
    assert "$orderby=EventDate" in url and "$top=200" in url


# ── front-end mapping ─────────────────────────────────────────────────────────

def test_to_public_event():
    row = pa.make_event_row(
        uid="tm:1", source_key="tm-lv", title="The Band Live",
        start_date="2026-07-15T20:00:00", category="Rock",
        location="Archer Music Hall, Allentown", detail="Archer Music Hall, Allentown",
        url="https://tm/x")
    pub = pa.to_public_event(row)
    assert pub["venue"] == "tm-lv"
    assert pub["date"] == "2026-07-15"
    assert pub["time"] == "8:00 PM"
    assert pub["category"] == "Rock"
    assert pub["detail"] == "Archer Music Hall, Allentown"
    assert "end" not in pub


def test_to_public_event_all_day_with_end():
    row = pa.make_event_row(uid="x", source_key="civic-emmaus", title="Festival",
                            start_date="2026-08-01", end_date="2026-08-03")
    pub = pa.to_public_event(row)
    assert pub["date"] == "2026-08-01"
    assert pub["time"] == ""
    assert pub["end"] == "2026-08-03"


def test_venue_descriptor_known_and_fallback():
    v = pa.venue_descriptor("tm-lv")
    assert v["key"] == "tm-lv" and v["color"] == "blue" and v["name"]
    f = pa.venue_descriptor("mystery")
    assert f["key"] == "mystery" and f["color"] == "teal" and f["emoji"] == "📍"


if __name__ == "__main__":
    tests = [
        test_parse_clock,
        test_combine_date_time,
        test_friendly_time,
        test_is_upcoming,
        test_normalize_ics_dt,
        test_parse_ics_unfold_and_fields,
        test_ics_to_events,
        test_ics_to_events_synthesizes_uid_when_missing,
        test_ticketmaster_events_mapping,
        test_ticketmaster_genre_falls_back_to_segment,
        test_ticketmaster_empty,
        test_legistar_events_mapping,
        test_build_ticketmaster_url,
        test_build_legistar_url,
        test_to_public_event,
        test_to_public_event_all_day_with_end,
        test_venue_descriptor_known_and_fallback,
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
