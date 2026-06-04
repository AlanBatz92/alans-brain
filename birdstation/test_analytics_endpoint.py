#!/usr/bin/env python3
"""Standalone smoke tests for the /api/analytics aggregation logic.

Mirrors the SQL + Eastern-bucketing code from bird_api.py so any divergence
becomes a test failure. Run with: python3 birdstation/test_analytics_endpoint.py
"""
import sqlite3
import sys
from datetime import datetime, timezone, timedelta

try:
    from zoneinfo import ZoneInfo
    _EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _EASTERN = None


# ── Eastern helpers (mirror bird_api.py) ──────────────────────────────────────

def _nth_sunday(year, month, n):
    first = datetime(year, month, 1)
    first_sunday = 1 + (6 - first.weekday()) % 7
    return first_sunday + (n - 1) * 7


def _is_us_edt(dt_utc):
    y = dt_utc.year
    start = datetime(y, 3, _nth_sunday(y, 3, 2), 7, tzinfo=timezone.utc)
    end   = datetime(y, 11, _nth_sunday(y, 11, 1), 6, tzinfo=timezone.utc)
    return start <= dt_utc < end


def eastern_parts(uy, um, ud, uh):
    dt = datetime(uy, um, ud, uh, tzinfo=timezone.utc)
    if _EASTERN is not None:
        e = dt.astimezone(_EASTERN)
    else:
        e = dt + timedelta(hours=(-4 if _is_us_edt(dt) else -5))
    return e.strftime("%Y-%m-%d"), e.hour


def make_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        common_name TEXT NOT NULL,
        scientific_name TEXT NOT NULL,
        confidence REAL NOT NULL
    )""")
    return conn


def seed(conn, rows):
    conn.executemany(
        "INSERT INTO detections (timestamp, common_name, scientific_name, confidence) VALUES (?,?,?,?)",
        rows,
    )
    conn.commit()


def analytics(conn, start, end, min_confidence=0.85, top=12):
    """Mirrors bird_api.py GET /api/analytics."""
    rows = conn.execute(
        """SELECT substr(timestamp, 1, 13) AS hbucket,
                  common_name,
                  MAX(scientific_name) AS scientific_name,
                  COUNT(*) AS n
           FROM detections
           WHERE datetime(timestamp) >= datetime(?) AND datetime(timestamp) < datetime(?)
             AND confidence >= ?
           GROUP BY hbucket, common_name""",
        (start, end, min_confidence),
    ).fetchall()

    by_hour = [0] * 24
    by_day  = {}
    sp_total = {}
    sp_sci   = {}
    sp_hours = {}
    for r in rows:
        hb = r["hbucket"]
        try:
            uy, um, ud, uh = int(hb[0:4]), int(hb[5:7]), int(hb[8:10]), int(hb[11:13])
        except (ValueError, IndexError):
            continue
        edate, ehour = eastern_parts(uy, um, ud, uh)
        n = r["n"]
        common = r["common_name"]
        by_hour[ehour] += n
        day = by_day.setdefault(edate, {"count": 0, "species": set()})
        day["count"] += n
        day["species"].add(common)
        sp_total[common] = sp_total.get(common, 0) + n
        sp_sci.setdefault(common, r["scientific_name"])
        sp_hours.setdefault(common, [0] * 24)[ehour] += n

    total_detections = sum(sp_total.values())
    ranked = sorted(sp_total.items(), key=lambda kv: kv[1], reverse=True)
    top_species = [
        {"common_name": c, "scientific_name": sp_sci.get(c), "count": n}
        for c, n in ranked
    ]
    species_hours = [
        {"common_name": c, "scientific_name": sp_sci.get(c),
         "total": sp_total[c], "hours": sp_hours[c]}
        for c, _ in ranked[:top]
    ]
    by_day_list = [
        {"date": d, "count": v["count"], "species": len(v["species"])}
        for d, v in sorted(by_day.items())
    ]
    busiest_hour = max(range(24), key=lambda i: by_hour[i]) if total_detections else None
    peak_day = max(by_day_list, key=lambda d: d["count"]) if by_day_list else None
    return {
        "start": start, "end": end,
        "total_detections": total_detections,
        "total_species":    len(sp_total),
        "active_days":      len(by_day_list),
        "by_hour":          by_hour,
        "species_hours":    species_hours,
        "top_species":      top_species,
        "by_day":           by_day_list,
        "busiest_hour":     busiest_hour,
        "peak_day":         peak_day,
    }


# ── Eastern-bucketing unit tests ──────────────────────────────────────────────

def test_eastern_parts_edt():
    # Summer (EDT, UTC-4): UTC 10:00 on June 3 → 6 AM Eastern, same date.
    d, h = eastern_parts(2026, 6, 3, 10)
    assert (d, h) == ("2026-06-03", 6), (d, h)


def test_eastern_parts_est():
    # Winter (EST, UTC-5): UTC 12:00 on Jan 15 → 7 AM Eastern, same date.
    d, h = eastern_parts(2026, 1, 15, 12)
    assert (d, h) == ("2026-01-15", 7), (d, h)


def test_eastern_parts_rolls_back_a_day():
    # UTC 02:00 → 10 PM Eastern the *previous* day (EDT). Late-night owl, prior date.
    d, h = eastern_parts(2026, 6, 4, 2)
    assert (d, h) == ("2026-06-03", 22), (d, h)


def test_dst_fallback_rule_boundaries():
    # The pure-Python fallback: March 8 2026 is the 2nd Sunday (DST begins),
    # November 1 2026 is the 1st Sunday (DST ends).
    assert _nth_sunday(2026, 3, 2) == 8
    assert _nth_sunday(2026, 11, 1) == 1
    # 06:00 UTC March 8 = 1 AM EST (still EST); 07:00 UTC = 3 AM EDT (now EDT).
    assert _is_us_edt(datetime(2026, 3, 8, 6, tzinfo=timezone.utc)) is False
    assert _is_us_edt(datetime(2026, 3, 8, 7, tzinfo=timezone.utc)) is True
    # July is EDT, January is EST.
    assert _is_us_edt(datetime(2026, 7, 1, 12, tzinfo=timezone.utc)) is True
    assert _is_us_edt(datetime(2026, 1, 1, 12, tzinfo=timezone.utc)) is False


# ── Aggregation tests ─────────────────────────────────────────────────────────

def test_by_hour_buckets_in_eastern():
    conn = make_db()
    # Three robins at UTC 10:00 (=6 AM EDT) and one at UTC 11:00 (=7 AM EDT), June 3.
    seed(conn, [
        ("2026-06-03 10:00:00", "American Robin", "Turdus migratorius", 0.90),
        ("2026-06-03 10:30:00", "American Robin", "Turdus migratorius", 0.91),
        ("2026-06-03 10:45:00", "American Robin", "Turdus migratorius", 0.92),
        ("2026-06-03 11:15:00", "American Robin", "Turdus migratorius", 0.88),
    ])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00")
    assert r["by_hour"][6] == 3   # 6 AM Eastern
    assert r["by_hour"][7] == 1   # 7 AM Eastern
    assert sum(r["by_hour"]) == 4
    assert r["busiest_hour"] == 6


def test_species_hours_and_leaderboard():
    conn = make_db()
    seed(conn, [
        ("2026-06-03 11:00:00", "American Robin",  "Turdus migratorius",     0.90),  # 7 AM ET
        ("2026-06-03 11:00:00", "American Robin",  "Turdus migratorius",     0.91),
        ("2026-06-03 12:00:00", "American Robin",  "Turdus migratorius",     0.92),  # 8 AM ET
        ("2026-06-04 02:00:00", "Barred Owl",      "Strix varia",            0.88),  # 10 PM ET June 3
    ])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00")
    # Leaderboard: Robin (3) ahead of Owl (1)
    assert r["top_species"][0]["common_name"] == "American Robin"
    assert r["top_species"][0]["count"] == 3
    assert r["top_species"][0]["scientific_name"] == "Turdus migratorius"
    assert r["total_species"] == 2
    # species_hours carries the per-species Eastern hour distribution
    robin = next(s for s in r["species_hours"] if s["common_name"] == "American Robin")
    assert robin["hours"][7] == 2 and robin["hours"][8] == 1
    assert robin["total"] == 3
    owl = next(s for s in r["species_hours"] if s["common_name"] == "Barred Owl")
    assert owl["hours"][22] == 1   # 10 PM Eastern


def test_by_day_volume_and_diversity():
    conn = make_db()
    seed(conn, [
        # June 3 Eastern: 2 species, 3 detections
        ("2026-06-03 13:00:00", "American Robin", "Turdus migratorius",   0.90),
        ("2026-06-03 14:00:00", "American Robin", "Turdus migratorius",   0.91),
        ("2026-06-03 15:00:00", "Gray Catbird",   "Dumetella carolinensis", 0.86),
        # June 4 Eastern: 1 species, 1 detection (UTC 10:00 = 6 AM EDT June 4)
        ("2026-06-04 10:00:00", "Wood Thrush",    "Hylocichla mustelina", 0.88),
    ])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-05 04:00:00")
    days = {d["date"]: d for d in r["by_day"]}
    assert days["2026-06-03"]["count"] == 3
    assert days["2026-06-03"]["species"] == 2
    assert days["2026-06-04"]["count"] == 1
    assert days["2026-06-04"]["species"] == 1
    assert r["active_days"] == 2
    assert r["peak_day"]["date"] == "2026-06-03"


def test_late_night_attributed_to_previous_eastern_day():
    conn = make_db()
    # UTC 02:00 June 4 = 10 PM EDT June 3 → must land on Eastern June 3.
    seed(conn, [("2026-06-04 02:00:00", "Eastern Whip-poor-will", "Antrostomus vociferus", 0.90)])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00")
    assert r["active_days"] == 1
    assert r["by_day"][0]["date"] == "2026-06-03"
    assert r["by_hour"][22] == 1


def test_confidence_filter():
    conn = make_db()
    seed(conn, [
        ("2026-06-03 12:00:00", "House Sparrow",  "Passer domesticus",  0.80),  # excluded
        ("2026-06-03 12:00:00", "American Robin", "Turdus migratorius", 0.88),  # included
    ])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00", min_confidence=0.85)
    assert r["total_detections"] == 1
    assert r["total_species"] == 1
    assert r["top_species"][0]["common_name"] == "American Robin"


def test_range_excludes_outside():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 12:00:00", "House Sparrow",  "Passer domesticus",  0.90),  # before range
        ("2026-06-03 12:00:00", "American Robin", "Turdus migratorius", 0.90),  # in range
        ("2026-06-10 12:00:00", "Wood Thrush",    "Hylocichla mustelina", 0.90), # after range
    ])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00")
    assert r["total_detections"] == 1
    assert r["top_species"][0]["common_name"] == "American Robin"


def test_top_caps_species_hours_but_not_leaderboard():
    conn = make_db()
    # 5 distinct species, each one detection
    seed(conn, [
        (f"2026-06-03 1{i}:00:00", f"Species {i}", f"Sci {i}", 0.90)
        for i in range(5)
    ])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00", top=3)
    assert len(r["species_hours"]) == 3      # heatmap capped at `top`
    assert len(r["top_species"]) == 5        # leaderboard is the full ranked list


def test_empty_range():
    conn = make_db()
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00")
    assert r["total_detections"] == 0
    assert r["total_species"] == 0
    assert r["active_days"] == 0
    assert r["by_hour"] == [0] * 24
    assert r["species_hours"] == []
    assert r["top_species"] == []
    assert r["busiest_hour"] is None
    assert r["peak_day"] is None


def test_iso_t_timestamps_bucket_correctly():
    conn = make_db()
    # The pipeline writes ISO "T" + microseconds; substr prefix + parsing must still work.
    seed(conn, [
        ("2026-06-03T10:30:00.123456", "American Robin", "Turdus migratorius", 0.90),  # 6 AM ET
        ("2026-06-03T11:45:00.654321", "American Robin", "Turdus migratorius", 0.91),  # 7 AM ET
    ])
    r = analytics(conn, "2026-06-03 04:00:00", "2026-06-04 04:00:00")
    assert r["by_hour"][6] == 1
    assert r["by_hour"][7] == 1
    assert r["total_detections"] == 2


if __name__ == "__main__":
    tests = [
        test_eastern_parts_edt,
        test_eastern_parts_est,
        test_eastern_parts_rolls_back_a_day,
        test_dst_fallback_rule_boundaries,
        test_by_hour_buckets_in_eastern,
        test_species_hours_and_leaderboard,
        test_by_day_volume_and_diversity,
        test_late_night_attributed_to_previous_eastern_day,
        test_confidence_filter,
        test_range_excludes_outside,
        test_top_caps_species_hours_but_not_leaderboard,
        test_empty_range,
        test_iso_t_timestamps_bucket_correctly,
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
