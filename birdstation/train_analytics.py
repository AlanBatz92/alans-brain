#!/usr/bin/env python3
"""Pure (FastAPI-free) train-analytics computation, so it can be unit-tested
without standing up the API. `bird_api.trains_analytics` is a thin wrapper that
reads the DB rows and calls compute_train_analytics().

Counts are *passes*: clips within `pass_gap_min` minutes are the same train (one
pass can fire several horn-blast clips). Distributions are bucketed in **Eastern**
(Emmaus, PA). An optional [start, end) window (the same Eastern→UTC bounds the
Observatory period selector sends to /api/analytics) scopes the period buckets;
`passes_today` is always the absolute Eastern-today count, independent of the
selected period, so the "Today" stat card stays meaningful at any period.
"""
from datetime import datetime, timezone, timedelta

try:
    from zoneinfo import ZoneInfo
    _EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _EASTERN = None


def _parse_dt(s):
    """Parse an ISO datetime (tz-aware or naive; 'T'- or space-separated). A naive
    value is assumed UTC. Returns an aware datetime, or None if unparseable."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace(" ", "T"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _to_eastern(dt):
    if _EASTERN is not None:
        return dt.astimezone(_EASTERN)
    return dt.astimezone(timezone.utc)   # fallback: no zoneinfo → UTC buckets


def compute_train_analytics(rows, pass_gap_min=5.0, start=None, end=None,
                            today_start=None, today_end=None):
    """rows: iterable of mappings with detected_at / duration_s / peak_db.
    start, end: optional window bounds (ISO; naive=UTC; end exclusive) restricting
    the period buckets to passes that *start* in [start, end).
    today_start, today_end: ISO bounds of Eastern 'today' for the absolute
    passes_today card. Returns the analytics dict the front-end renders."""
    # Parse + sort defensively (grouping into passes depends on chronological order).
    events = []
    for r in rows:
        dt = _parse_dt(r["detected_at"])
        if dt is None:
            continue
        dur = r["duration_s"] or 0.0
        db = r["peak_db"]
        events.append((dt, dur, db))
    events.sort(key=lambda e: e[0])

    gap = timedelta(minutes=pass_gap_min)
    passes = []          # each: {start, clips, peak_db, max_dur}
    last = None
    for dt, dur, db in events:
        if last is None or dt - last > gap:
            passes.append({"start": dt, "clips": 1, "peak_db": db, "max_dur": dur})
        else:
            p = passes[-1]
            p["clips"] += 1
            if db is not None and (p["peak_db"] is None or db > p["peak_db"]):
                p["peak_db"] = db
            p["max_dur"] = max(p["max_dur"], dur)
        last = dt

    # Absolute "today" (Eastern), independent of the selected period.
    ts, te = _parse_dt(today_start), _parse_dt(today_end)
    passes_today = sum(1 for p in passes if ts and te and ts <= p["start"] < te)

    # Window the period buckets (no window = all-time, the original behavior).
    ws, we = _parse_dt(start), _parse_dt(end)
    windowed = [p for p in passes if ws <= p["start"] < we] if (ws and we) else passes

    by_hour = [0] * 24
    by_dow_hour = [[0] * 24 for _ in range(7)]   # 0=Mon … 6=Sun (Python weekday)
    by_day = {}
    for p in windowed:
        e = _to_eastern(p["start"])
        by_hour[e.hour] += 1
        by_dow_hour[e.weekday()][e.hour] += 1
        d = e.date().isoformat()
        by_day[d] = by_day.get(d, 0) + 1

    starts = [p["start"] for p in windowed]
    headways = sorted((starts[i + 1] - starts[i]).total_seconds() / 60.0
                      for i in range(len(starts) - 1))
    median_headway = headways[len(headways) // 2] if headways else None

    return {
        "pass_gap_min":       pass_gap_min,
        "total_passes":       len(windowed),
        "total_clips":        sum(p["clips"] for p in windowed),
        "passes_today":       passes_today,
        "by_hour":            by_hour,
        "by_dow_hour":        by_dow_hour,
        "by_day":             dict(sorted(by_day.items())),
        "median_headway_min": round(median_headway, 1) if median_headway is not None else None,
        "busiest_hour":       max(range(24), key=lambda h: by_hour[h]) if any(by_hour) else None,
        "peak_day":           max(by_day.items(), key=lambda kv: kv[1])[0] if by_day else None,
    }
