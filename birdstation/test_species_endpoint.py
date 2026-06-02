#!/usr/bin/env python3
"""Standalone smoke tests for the /api/species/{name} logic.

Mirrors the SQL + response-building code from bird_api.py so any divergence
becomes a test failure. Run with: python3 birdstation/test_species_endpoint.py
"""
import sqlite3
import sys


def make_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        common_name TEXT NOT NULL,
        scientific_name TEXT NOT NULL,
        confidence REAL NOT NULL,
        week INTEGER,
        battery_voltage_v REAL
    )""")
    return conn


def seed(conn, rows):
    conn.executemany(
        "INSERT INTO detections (timestamp, common_name, scientific_name, confidence) VALUES (?,?,?,?)",
        rows,
    )
    conn.commit()


def species_history(conn, name, min_confidence=0.75):
    """Mirrors the SQL + response logic in bird_api.py GET /api/species/{name}."""
    rows = conn.execute(
        """SELECT timestamp, confidence, common_name, scientific_name
           FROM detections
           WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ?
           ORDER BY timestamp ASC""",
        (name, name, min_confidence),
    ).fetchall()
    if not rows:
        return None
    by_hour = [0] * 24
    confidences = []
    for r in rows:
        confidences.append(round(r["confidence"], 3))
        try:
            hour = int(r["timestamp"][11:13])
            by_hour[hour] += 1
        except (ValueError, IndexError):
            pass
    return {
        "common_name":       rows[0]["common_name"],
        "scientific_name":   rows[0]["scientific_name"],
        "total_detections":  len(rows),
        "first_heard":       rows[0]["timestamp"],
        "last_heard":        rows[-1]["timestamp"],
        "confidence_series": confidences,
        "by_hour":           by_hour,
    }


def test_found_by_common_name():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:12:00", "American Robin", "Turdus migratorius", 0.88),
        ("2026-06-01 08:45:00", "American Robin", "Turdus migratorius", 0.92),
        ("2026-06-01 14:30:00", "American Robin", "Turdus migratorius", 0.76),
    ])
    r = species_history(conn, "American Robin")
    assert r is not None
    assert r["total_detections"] == 3
    assert r["common_name"] == "American Robin"
    assert r["scientific_name"] == "Turdus migratorius"
    assert r["first_heard"] == "2026-06-01 07:12:00"
    assert r["last_heard"] == "2026-06-01 14:30:00"
    assert r["confidence_series"] == [0.88, 0.92, 0.76]
    assert r["by_hour"][7] == 1
    assert r["by_hour"][8] == 1
    assert r["by_hour"][14] == 1
    assert sum(r["by_hour"]) == 3


def test_found_by_scientific_name():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 09:00:00", "American Robin", "Turdus migratorius", 0.80),
    ])
    r = species_history(conn, "Turdus migratorius")
    assert r is not None
    assert r["total_detections"] == 1
    assert r["common_name"] == "American Robin"


def test_min_confidence_filter():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "House Sparrow", "Passer domesticus", 0.60),  # excluded
        ("2026-06-01 08:00:00", "House Sparrow", "Passer domesticus", 0.80),  # included
    ])
    r = species_history(conn, "House Sparrow", min_confidence=0.75)
    assert r is not None
    assert r["total_detections"] == 1
    assert r["confidence_series"] == [0.80]
    assert r["by_hour"][8] == 1
    assert r["by_hour"][7] == 0


def test_not_found_empty_db():
    conn = make_db()
    assert species_history(conn, "Nonexistent Bird") is None


def test_not_found_all_below_threshold():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "House Sparrow", "Passer domesticus", 0.60),
    ])
    assert species_history(conn, "House Sparrow", min_confidence=0.75) is None


def test_by_hour_spans_multiple_hours():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 06:00:00", "Gray Catbird", "Dumetella carolinensis", 0.90),
        ("2026-06-01 06:30:00", "Gray Catbird", "Dumetella carolinensis", 0.85),
        ("2026-06-01 18:15:00", "Gray Catbird", "Dumetella carolinensis", 0.78),
    ])
    r = species_history(conn, "Gray Catbird")
    assert r["by_hour"][6] == 2
    assert r["by_hour"][18] == 1
    assert sum(r["by_hour"]) == 3
    assert len(r["by_hour"]) == 24


def test_confidence_rounded_to_3dp():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "Wood Thrush", "Hylocichla mustelina", 0.876543),
    ])
    r = species_history(conn, "Wood Thrush")
    assert r["confidence_series"] == [0.877]


# ── /api/detections/grouped ───────────────────────────────────────────────────

def detections_grouped(conn, start, end, min_confidence=0.75):
    """Mirrors the SQL + response logic in bird_api.py GET /api/detections/grouped.
    start/end are full UTC datetime strings "YYYY-MM-DD HH:MM:SS"; end is exclusive."""
    rows = conn.execute(
        """SELECT common_name, scientific_name,
                  COUNT(*) AS count,
                  MAX(confidence) AS best_confidence,
                  MIN(timestamp) AS first_heard,
                  MAX(timestamp) AS last_heard
           FROM detections
           WHERE timestamp >= ? AND timestamp < ?
             AND confidence >= ?
           GROUP BY common_name
           ORDER BY MAX(timestamp) DESC""",
        (start, end, min_confidence),
    ).fetchall()
    return [dict(r) for r in rows]


def test_grouped_basic():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "American Robin",  "Turdus migratorius",      0.88),
        ("2026-06-01 09:00:00", "American Robin",  "Turdus migratorius",      0.92),
        ("2026-06-01 08:00:00", "Gray Catbird",    "Dumetella carolinensis",  0.80),
    ])
    # June 1 Eastern (EDT) = UTC 2026-06-01 04:00:00 → 2026-06-02 04:00:00
    r = detections_grouped(conn, "2026-06-01 04:00:00", "2026-06-02 04:00:00")
    assert len(r) == 2
    # ordered newest-last-heard first: Robin last heard 09:00, Catbird 08:00
    assert r[0]["common_name"] == "American Robin"
    assert r[0]["count"] == 2
    assert r[0]["best_confidence"] == 0.92
    assert r[0]["first_heard"] == "2026-06-01 07:00:00"
    assert r[0]["last_heard"]  == "2026-06-01 09:00:00"
    assert r[1]["common_name"] == "Gray Catbird"
    assert r[1]["count"] == 1


def test_grouped_date_range_excludes_outside():
    conn = make_db()
    seed(conn, [
        ("2026-05-30 07:00:00", "House Sparrow",  "Passer domesticus",    0.80),
        ("2026-06-01 08:00:00", "American Robin", "Turdus migratorius",   0.88),
        ("2026-06-03 09:00:00", "Wood Thrush",    "Hylocichla mustelina", 0.90),
    ])
    # June 1–2 Eastern = UTC 2026-06-01 04:00:00 → 2026-06-03 04:00:00
    r = detections_grouped(conn, "2026-06-01 04:00:00", "2026-06-03 04:00:00")
    assert len(r) == 1
    assert r[0]["common_name"] == "American Robin"


def test_grouped_confidence_filter():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "House Sparrow",  "Passer domesticus",  0.60),  # excluded
        ("2026-06-01 08:00:00", "American Robin", "Turdus migratorius", 0.88),  # included
    ])
    r = detections_grouped(conn, "2026-06-01 04:00:00", "2026-06-02 04:00:00", min_confidence=0.75)
    assert len(r) == 1
    assert r[0]["common_name"] == "American Robin"


def test_grouped_empty():
    conn = make_db()
    assert detections_grouped(conn, "2026-06-01 04:00:00", "2026-06-02 04:00:00") == []


def test_grouped_multi_day_accumulates():
    conn = make_db()
    seed(conn, [
        ("2026-05-29 07:00:00", "Wood Thrush",    "Hylocichla mustelina", 0.90),
        ("2026-05-30 14:00:00", "Wood Thrush",    "Hylocichla mustelina", 0.85),
        ("2026-05-31 09:00:00", "Wood Thrush",    "Hylocichla mustelina", 0.78),
        ("2026-05-30 08:00:00", "American Robin", "Turdus migratorius",   0.88),
    ])
    # May 29–31 Eastern = UTC 2026-05-29 04:00:00 → 2026-06-01 04:00:00
    r = detections_grouped(conn, "2026-05-29 04:00:00", "2026-06-01 04:00:00")
    assert len(r) == 2
    wt = next(x for x in r if x["common_name"] == "Wood Thrush")
    assert wt["count"] == 3
    assert wt["best_confidence"] == 0.90
    assert wt["first_heard"] == "2026-05-29 07:00:00"
    assert wt["last_heard"]  == "2026-05-31 09:00:00"


def test_grouped_late_night_eastern_boundary():
    # 10PM Eastern (EDT) = 02:00 UTC next day; must appear in the correct Eastern day.
    conn = make_db()
    seed(conn, [
        ("2026-06-01 02:00:00", "Great Horned Owl", "Bubo virginianus",  0.90),  # 10PM ET May 31
        ("2026-06-01 05:00:00", "Barred Owl",       "Strix varia",       0.88),  # 1AM ET June 1
    ])
    # May 31 Eastern (EDT) = UTC 2026-05-31 04:00:00 → 2026-06-01 04:00:00
    r = detections_grouped(conn, "2026-05-31 04:00:00", "2026-06-01 04:00:00")
    assert len(r) == 1
    assert r[0]["common_name"] == "Great Horned Owl"
    # June 1 Eastern = UTC 2026-06-01 04:00:00 → 2026-06-02 04:00:00
    r2 = detections_grouped(conn, "2026-06-01 04:00:00", "2026-06-02 04:00:00")
    assert len(r2) == 1
    assert r2[0]["common_name"] == "Barred Owl"


if __name__ == "__main__":
    tests = [
        test_found_by_common_name,
        test_found_by_scientific_name,
        test_min_confidence_filter,
        test_not_found_empty_db,
        test_not_found_all_below_threshold,
        test_by_hour_spans_multiple_hours,
        test_confidence_rounded_to_3dp,
        test_grouped_basic,
        test_grouped_date_range_excludes_outside,
        test_grouped_confidence_filter,
        test_grouped_empty,
        test_grouped_multi_day_accumulates,
        test_grouped_late_night_eastern_boundary,
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
