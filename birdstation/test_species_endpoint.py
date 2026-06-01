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


if __name__ == "__main__":
    tests = [
        test_found_by_common_name,
        test_found_by_scientific_name,
        test_min_confidence_filter,
        test_not_found_empty_db,
        test_not_found_all_below_threshold,
        test_by_hour_spans_multiple_hours,
        test_confidence_rounded_to_3dp,
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
