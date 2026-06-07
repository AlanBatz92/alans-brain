#!/usr/bin/env python3
"""
Pulse ingestion adapters — the pluggable "front door" beyond RSS (Phase 4).

This module is deliberately **stdlib-only** so it can be imported by both
pulse_fetcher.py (the dispatcher that does network + DB writes) and bird_api.py
(which maps event rows for GET /api/events), and unit-tested with no feedparser /
anthropic / fastapi install (see test_event_adapters.py — runnable anywhere).

The split: the *pure* parsing/mapping lives here (iCalendar parsing, Ticketmaster
& Legistar JSON → normalized event rows, the event-row → front-end shape, venue
metadata, URL building). The network fetch + DB upsert + per-source health stay in
pulse_fetcher.py. AI is NOT used for `api`/`ics` — the data is already structured,
so there is nothing to hallucinate (the `scrape` adapter, which would use the
messages.parse() AI-as-parser pattern, is deferred until a no-API source comes up).

A normalized **event row** is a dict:
    {uid, source_key, title, start_date, end_date, category, location, detail, url}
where start_date/end_date are naive *venue-local* wall time, "YYYY-MM-DD" or
"YYYY-MM-DDTHH:MM:SS". `uid` is the source's own stable id (Ticketmaster event id,
iCalendar UID, Legistar EventId, seed key); the fetcher UPSERTs on it.
"""
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (compatible; EmmausPulse/1.0; +https://www.alansbrain.com)"

# Eastern wall-clock for the rare iCal time given in UTC ("...Z"). zoneinfo when
# available (the box has tzdata); a post-2007 DST rule is the fallback.
try:
    from zoneinfo import ZoneInfo
    _EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _EASTERN = None


def _nth_sunday(year, month, n):
    first = datetime(year, month, 1)
    first_sunday = 1 + (6 - first.weekday()) % 7
    return first_sunday + (n - 1) * 7


def _is_us_edt(dt_utc):
    y = dt_utc.year
    start = datetime(y, 3, _nth_sunday(y, 3, 2), 7, tzinfo=timezone.utc)
    end   = datetime(y, 11, _nth_sunday(y, 11, 1), 6, tzinfo=timezone.utc)
    return start <= dt_utc < end


def _utc_to_eastern_naive(y, mo, d, h, mi, s):
    """A UTC wall time → naive Eastern "YYYY-MM-DDTHH:MM:SS"."""
    dt = datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)
    if _EASTERN is not None:
        e = dt.astimezone(_EASTERN)
    else:
        e = dt + timedelta(hours=(-4 if _is_us_edt(dt) else -5))
    return e.strftime("%Y-%m-%dT%H:%M:%S")


# ── tiny HTTP helpers (network — not unit-tested) ─────────────────────────────

def http_get(url, timeout=20, accept="*/*"):
    """GET a URL as text with the Pulse UA. Raises RuntimeError on any failure so
    the caller records it as a per-source last_status (never crashes the run)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        return raw.decode("utf-8", "replace")
    except Exception as ex:  # HTTPError, URLError, socket timeout, …
        raise RuntimeError(str(ex)[:180])


def http_get_json(url, timeout=20):
    return json.loads(http_get(url, timeout=timeout, accept="application/json"))


# ── date / time normalization (pure) ──────────────────────────────────────────

def parse_clock(s):
    """A loose clock string → "HH:MM:SS" (24h), or "" if unparseable.
    Handles "6:00 PM", "6:00:00 PM", "20:00", "20:00:00"."""
    s = (s or "").strip().upper()
    if not s:
        return ""
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$", s)
    if not m:
        return ""
    hh, mm, ss, ap = int(m.group(1)), m.group(2), m.group(3) or "00", m.group(4)
    if ap == "PM" and hh != 12:
        hh += 12
    elif ap == "AM" and hh == 12:
        hh = 0
    if hh > 23:
        return ""
    return "%02d:%s:%s" % (hh, mm, ss)


def combine_date_time(date_ymd, time_str):
    """"2026-06-04" + "6:00 PM" → "2026-06-04T18:00:00" (or just the date)."""
    date_ymd = (date_ymd or "")[:10]
    hms = parse_clock(time_str)
    return date_ymd + ("T" + hms if hms else "")


def friendly_time(start_date):
    """The time half of a start_date as "8:00 PM", or "" for an all-day/date-only."""
    s = start_date or ""
    if "T" not in s:
        return ""
    m = re.match(r"^(\d{2}):(\d{2})", s.split("T", 1)[1])
    if not m:
        return ""
    hh, mm = int(m.group(1)), m.group(2)
    ap = "AM" if hh < 12 else "PM"
    h12 = hh % 12 or 12
    return "%d:%s %s" % (h12, mm, ap)


def is_upcoming(start_date, end_date, today_ymd):
    """Mirror events.js: an event is upcoming while its end (or start) date is
    today or later, compared as YYYY-MM-DD strings (so an all-day event survives
    its whole day regardless of clock/zone)."""
    eff = (end_date or start_date or "")[:10]
    return bool(eff) and eff >= today_ymd


# ── iCalendar parsing (pure) ──────────────────────────────────────────────────

def _ics_unfold(text):
    """RFC 5545 line unfolding: a line beginning with a space/tab continues the
    previous one."""
    out = []
    for raw in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and out:
            out[-1] += raw[1:]
        else:
            out.append(raw)
    return out


def _ics_unescape(v):
    return (v.replace("\\n", " ").replace("\\N", " ")
             .replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")).strip()


def normalize_ics_dt(value):
    """An iCal DATE/DATE-TIME value → naive local "YYYY-MM-DD" or
    "YYYY-MM-DDTHH:MM:SS". A trailing "Z" (UTC) is converted to Eastern; a
    floating or TZID-qualified time is taken as-is (our civic feeds are local)."""
    v = (value or "").strip()
    digits = re.sub(r"[^0-9TZ]", "", v.upper())
    dm = re.match(r"^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$", digits)
    if not dm:
        return ""
    y, mo, d = dm.group(1), dm.group(2), dm.group(3)
    if dm.group(4) is None:                       # DATE only
        return "%s-%s-%s" % (y, mo, d)
    hh, mi, ss = dm.group(4), dm.group(5), dm.group(6)
    if dm.group(7) == "Z":                         # UTC → Eastern wall time
        return _utc_to_eastern_naive(int(y), int(mo), int(d), int(hh), int(mi), int(ss))
    return "%s-%s-%sT%s:%s:%s" % (y, mo, d, hh, mi, ss)


def parse_ics(text):
    """Parse VEVENTs from an iCalendar document into raw dicts:
    {uid, title, start, end, url, location, description} (dates normalized).
    Hand-rolled (no dependency) — read-only DTSTART/SUMMARY/URL extraction is
    simple, and avoids a brittle third-party parser."""
    events, cur = [], None
    for line in _ics_unfold(text):
        u = line.strip()
        if u == "BEGIN:VEVENT":
            cur = {}
            continue
        if u == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        head, value = line.split(":", 1)
        name = head.split(";", 1)[0].upper()
        if name == "SUMMARY":
            cur["title"] = _ics_unescape(value)
        elif name == "DTSTART":
            cur["start"] = normalize_ics_dt(value)
        elif name == "DTEND":
            cur["end"] = normalize_ics_dt(value)
        elif name == "UID":
            cur["uid"] = value.strip()
        elif name == "URL":
            cur["url"] = value.strip()
        elif name == "LOCATION":
            cur["location"] = _ics_unescape(value)
        elif name == "DESCRIPTION":
            cur["description"] = _ics_unescape(value)
    return events


# ── normalized event-row builder + source mappers (pure) ──────────────────────

def make_event_row(uid, source_key, title, start_date,
                   end_date=None, category=None, location=None,
                   detail=None, url=None):
    return {
        "uid": uid,
        "source_key": source_key,
        "title": (title or "").strip() or "(untitled event)",
        "start_date": start_date or "",
        "end_date": end_date or None,
        "category": (category or "").strip() or None,
        "location": (location or "").strip() or None,
        "detail": (detail or "").strip() or None,
        "url": (url or "").strip() or None,
    }


def ticketmaster_events(data, source_key):
    """Ticketmaster Discovery API events.json → normalized event rows. Uses the
    venue-local localDate/localTime (no tz math). uid = "tm:<event id>"."""
    out = []
    items = (((data or {}).get("_embedded") or {}).get("events")) or []
    for e in items:
        tid = e.get("id")
        if not tid:
            continue
        start = (((e.get("dates") or {}).get("start")) or {})
        local_date = start.get("localDate")
        if not local_date:
            dt = start.get("dateTime")                # UTC fallback (date part)
            local_date = dt[:10] if dt else None
        if not local_date:
            continue                                  # undated / TBA — skip
        start_date = local_date + ("T" + start["localTime"] if start.get("localTime") else "")

        venue_name = ""
        venues = ((e.get("_embedded") or {}).get("venues")) or []
        if venues:
            v0 = venues[0] or {}
            venue_name = (v0.get("name") or "").strip()
            city = ((v0.get("city") or {}).get("name") or "").strip()
            if city and city.lower() not in venue_name.lower():
                venue_name = (venue_name + ", " + city).strip(", ")

        genre = ""
        cls = e.get("classifications") or []
        if cls:
            c0 = cls[0] or {}
            for key in ("genre", "segment"):
                nm = ((c0.get(key) or {}).get("name") or "").strip()
                if nm and nm.lower() not in ("undefined", "other"):
                    genre = nm
                    break

        out.append(make_event_row(
            uid="tm:" + str(tid), source_key=source_key,
            title=(e.get("name") or ""), start_date=start_date,
            category=genre or "Event", location=venue_name or None,
            detail=venue_name or None, url=e.get("url") or None))
    return out


def legistar_events(data, source_key, client):
    """Legistar Web API /Events JSON (a list) → normalized civic-meeting rows.
    uid = "legistar:<client>:<EventId>". Caller filters to upcoming."""
    out = []
    for e in (data or []):
        eid = e.get("EventId")
        if eid is None:
            continue
        date = (e.get("EventDate") or "")[:10]
        if not date:
            continue
        body = (e.get("EventBodyName") or "Meeting").strip()
        start_date = combine_date_time(date, e.get("EventTime") or "")
        url = (e.get("EventInSiteURL") or "").strip()
        loc = (e.get("EventLocation") or "").strip()
        comment = (e.get("EventComment") or "").strip()
        out.append(make_event_row(
            uid="legistar:%s:%s" % (client, eid), source_key=source_key,
            title=body, start_date=start_date, category="Civic meeting",
            location=loc or None, detail=comment or None, url=url or None))
    return out


def ics_to_events(parsed, source_key, category="Civic meeting"):
    """parse_ics() output → normalized event rows. uid = "<source_key>:<UID>"."""
    out = []
    for i, ev in enumerate(parsed):
        start = ev.get("start")
        if not start:
            continue
        uid = ev.get("uid") or ("%s-%d" % (start, i))
        out.append(make_event_row(
            uid="%s:%s" % (source_key, uid), source_key=source_key,
            title=ev.get("title") or "", start_date=start, end_date=ev.get("end"),
            category=category, location=ev.get("location") or None,
            detail=ev.get("description") or None, url=ev.get("url") or None))
    return out


# ── URL builders (pure) ───────────────────────────────────────────────────────

def build_ticketmaster_url(base, params, apikey, start_iso=None):
    """events.json URL with the key + (optional) upcoming filter. List-valued
    params (e.g. segmentId) become repeated query params (doseq)."""
    q = dict(params or {})
    q["apikey"] = apikey
    q.setdefault("sort", "date,asc")
    if start_iso and "startDateTime" not in q:
        q["startDateTime"] = start_iso
    return base + "?" + urllib.parse.urlencode(q, doseq=True)


def build_legistar_url(base, today_ymd, top=200):
    """/Events filtered to today-or-later, ascending. OData $filter datetime
    literal; spaces %-encoded, quotes kept literal."""
    flt = urllib.parse.quote("EventDate ge datetime'%sT00:00:00'" % today_ymd, safe="':")
    return "%s?$filter=%s&$orderby=EventDate&$top=%d" % (base, flt, top)


# ── front-end mapping + venue metadata ────────────────────────────────────────

# Each event source maps to one front-end "venue" bucket on the What's On page
# (events.js keys cards to a venue for the emoji/accent/filter chip). Colors must
# be in the page's EV_COLORS set (teal/blue/purple/pink/green/yellow/red).
VENUE_META = {
    "tm-lv": {
        "name": "Lehigh Valley Events", "short": "LV Events", "emoji": "🎟️",
        "color": "blue", "location": "Allentown area",
        "url": "https://www.ticketmaster.com/",
        "blurb": "Concerts, comedy & theater near Allentown (via Ticketmaster).",
    },
    "civic-allentown": {
        "name": "Allentown — City Meetings", "short": "Allentown Civic", "emoji": "🏛️",
        "color": "purple", "location": "Allentown, PA",
        "url": "https://allentownpa.legistar.com/Calendar.aspx",
        "blurb": "City Council, boards & commissions.",
    },
    "civic-emmaus": {
        "name": "Emmaus — Borough Meetings", "short": "Emmaus Civic", "emoji": "🏛️",
        "color": "green", "location": "Emmaus, PA",
        "url": "https://www.emmauspa.gov/calendar.aspx",
        "blurb": "Borough Council & commission meetings.",
    },
    "elections": {
        "name": "Elections & Voting", "short": "Elections", "emoji": "🗳️",
        "color": "red", "location": "Lehigh Valley, PA",
        "url": "https://www.votespa.com/",
        "blurb": "Primary & general election dates and deadlines.",
    },
}


def venue_descriptor(source_key):
    """The front-end venue object for a source bucket (falls back gracefully so a
    new source can't break the page before VENUE_META is updated)."""
    meta = VENUE_META.get(source_key, {
        "name": source_key, "short": source_key, "emoji": "📍",
        "color": "teal", "location": "", "url": "", "blurb": "",
    })
    out = {"key": source_key}
    out.update(meta)
    return out


def to_public_event(row):
    """A DB events row (dict) → the events.js item shape
    {venue, title, date, time, category, detail, url[, end]}."""
    start = row.get("start_date") or ""
    out = {
        "venue":    row.get("source_key"),
        "title":    row.get("title") or "",
        "date":     start[:10],
        "time":     friendly_time(start),
        "category": row.get("category") or "",
        "detail":   row.get("detail") or row.get("location") or "",
        "url":      row.get("url") or "",
    }
    if row.get("end_date"):
        out["end"] = (row["end_date"] or "")[:10]
    return out
