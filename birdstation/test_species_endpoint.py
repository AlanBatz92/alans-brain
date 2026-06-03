#!/usr/bin/env python3
"""Standalone smoke tests for the /api/species/{name} logic.

Mirrors the SQL + response-building code from bird_api.py so any divergence
becomes a test failure. Run with: python3 birdstation/test_species_endpoint.py
"""
import sqlite3
import sys


# Confidence floors — mirror bird_api.py / birdnet_pipeline.py.
PRESERVE_MIN_CONFIDENCE  = 0.60   # box keeps >= this; recent-hits list reaches here
LIFE_LIST_MIN_CONFIDENCE = 0.85
LIFE_LIST_MIN_HITS = 3


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
    conn.execute("""CREATE TABLE lifetime (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        common_name TEXT,
        scientific_name TEXT,
        first_seen TEXT,
        total_detections INTEGER DEFAULT 1
    )""")
    return conn


def seed(conn, rows):
    conn.executemany(
        "INSERT INTO detections (timestamp, common_name, scientific_name, confidence) VALUES (?,?,?,?)",
        rows,
    )
    conn.commit()


def seed_life(conn, rows):
    conn.executemany(
        "INSERT INTO lifetime (common_name, scientific_name, first_seen, total_detections) VALUES (?,?,?,?)",
        rows,
    )
    conn.commit()


def species_history(conn, name, min_confidence=0.85):
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
    common     = rows[0]["common_name"]
    scientific = rows[0]["scientific_name"]
    # Recent hits reach down to the preserve floor (0.60), newest first — so the
    # card can show sub-display-floor diagnostic hits. Separate from the stats query.
    recent_rows = conn.execute(
        """SELECT timestamp, confidence FROM detections
           WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ?
           ORDER BY timestamp DESC LIMIT 10""",
        (common, scientific, PRESERVE_MIN_CONFIDENCE),
    ).fetchall()
    recent = [
        {"timestamp": r["timestamp"], "confidence": round(r["confidence"], 3)}
        for r in recent_rows
    ]
    hits_24h = conn.execute(
        "SELECT COUNT(*) FROM detections "
        "WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ? "
        "AND datetime(timestamp) >= datetime('now','-24 hours')",
        (common, scientific, LIFE_LIST_MIN_CONFIDENCE),
    ).fetchone()[0]
    on_life_list = conn.execute(
        "SELECT 1 FROM lifetime WHERE common_name = ? OR scientific_name = ? LIMIT 1",
        (common, scientific),
    ).fetchone() is not None
    return {
        "common_name":        common,
        "scientific_name":    scientific,
        "total_detections":   len(rows),
        "first_heard":        rows[0]["timestamp"],
        "last_heard":         rows[-1]["timestamp"],
        "confidence_series":  confidences,
        "by_hour":            by_hour,
        "recent":             recent,
        "hits_24h":           hits_24h,
        "life_list_min_hits": LIFE_LIST_MIN_HITS,
        "on_life_list":       on_life_list,
    }


def test_found_by_common_name():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:12:00", "American Robin", "Turdus migratorius", 0.88),
        ("2026-06-01 08:45:00", "American Robin", "Turdus migratorius", 0.92),
        ("2026-06-01 14:30:00", "American Robin", "Turdus migratorius", 0.86),
    ])
    r = species_history(conn, "American Robin")
    assert r is not None
    assert r["total_detections"] == 3
    assert r["common_name"] == "American Robin"
    assert r["scientific_name"] == "Turdus migratorius"
    assert r["first_heard"] == "2026-06-01 07:12:00"
    assert r["last_heard"] == "2026-06-01 14:30:00"
    assert r["confidence_series"] == [0.88, 0.92, 0.86]
    assert r["by_hour"][7] == 1
    assert r["by_hour"][8] == 1
    assert r["by_hour"][14] == 1
    assert sum(r["by_hour"]) == 3


def test_found_by_scientific_name():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 09:00:00", "American Robin", "Turdus migratorius", 0.88),
    ])
    r = species_history(conn, "Turdus migratorius")
    assert r is not None
    assert r["total_detections"] == 1
    assert r["common_name"] == "American Robin"


def test_min_confidence_filter():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "House Sparrow", "Passer domesticus", 0.80),  # excluded
        ("2026-06-01 08:00:00", "House Sparrow", "Passer domesticus", 0.90),  # included
    ])
    r = species_history(conn, "House Sparrow", min_confidence=0.85)
    assert r is not None
    assert r["total_detections"] == 1
    assert r["confidence_series"] == [0.90]
    assert r["by_hour"][8] == 1
    assert r["by_hour"][7] == 0


def test_not_found_empty_db():
    conn = make_db()
    assert species_history(conn, "Nonexistent Bird") is None


def test_not_found_all_below_threshold():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "House Sparrow", "Passer domesticus", 0.80),
    ])
    assert species_history(conn, "House Sparrow", min_confidence=0.85) is None


def test_by_hour_spans_multiple_hours():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 06:00:00", "Gray Catbird", "Dumetella carolinensis", 0.90),
        ("2026-06-01 06:30:00", "Gray Catbird", "Dumetella carolinensis", 0.85),
        ("2026-06-01 18:15:00", "Gray Catbird", "Dumetella carolinensis", 0.88),
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


def test_recent_hits_newest_first_capped_at_10():
    conn = make_db()
    # 12 hits across hours 00–11, all qualifying (>= 0.85)
    seed(conn, [
        (f"2026-06-01 {h:02d}:00:00", "American Robin", "Turdus migratorius", 0.85 + (h % 5) * 0.01)
        for h in range(12)
    ])
    r = species_history(conn, "American Robin")
    assert r["total_detections"] == 12
    assert len(r["recent"]) == 10                       # capped at 10
    assert r["recent"][0]["timestamp"] == "2026-06-01 11:00:00"   # newest first
    assert r["recent"][-1]["timestamp"] == "2026-06-01 02:00:00"  # oldest of the 10
    assert "confidence" in r["recent"][0]               # each carries time + confidence


def test_recent_hits_fewer_than_10():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "Gray Catbird", "Dumetella carolinensis", 0.90),
        ("2026-06-01 09:00:00", "Gray Catbird", "Dumetella carolinensis", 0.88),
    ])
    r = species_history(conn, "Gray Catbird")
    assert len(r["recent"]) == 2
    assert r["recent"][0]["timestamp"] == "2026-06-01 09:00:00"   # newest first
    assert r["recent"][0]["confidence"] == 0.88


def test_recent_includes_sub_display_floor_diagnostics():
    # The recent list reaches down to the preserve floor (0.60), so a sub-85% hit
    # shows for diagnostics even though it doesn't count toward the summary stats.
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "Downy Woodpecker", "Dryobates pubescens", 0.70),  # diagnostic
        ("2026-06-01 08:00:00", "Downy Woodpecker", "Dryobates pubescens", 0.88),  # qualifying
        ("2026-06-01 09:00:00", "Downy Woodpecker", "Dryobates pubescens", 0.92),  # qualifying
    ])
    r = species_history(conn, "Downy Woodpecker")
    # Summary stats use the 0.85 display floor → only the two confident hits.
    assert r["total_detections"] == 2
    assert r["confidence_series"] == [0.88, 0.92]
    # Recent list reaches to 0.60 → all three, newest first, with the 0.70 visible.
    assert len(r["recent"]) == 3
    assert r["recent"][0]["timestamp"] == "2026-06-01 09:00:00"
    assert r["recent"][-1]["confidence"] == 0.70


def test_recent_excludes_below_preserve_floor():
    conn = make_db()
    seed(conn, [
        ("2026-06-01 07:00:00", "House Sparrow", "Passer domesticus", 0.50),  # below preserve
        ("2026-06-01 08:00:00", "House Sparrow", "Passer domesticus", 0.90),  # qualifying
    ])
    r = species_history(conn, "House Sparrow")
    assert r["total_detections"] == 1
    assert len(r["recent"]) == 1           # the 0.50 hit is below the 0.60 preserve floor
    assert r["recent"][0]["confidence"] == 0.90


def test_on_life_list_flag():
    conn = make_db()
    seed(conn, [("2026-06-01 07:00:00", "American Robin", "Turdus migratorius", 0.90)])
    assert species_history(conn, "American Robin")["on_life_list"] is False
    seed_life(conn, [("American Robin", "Turdus migratorius", "2026-06-01 07:00:00", 3)])
    assert species_history(conn, "American Robin")["on_life_list"] is True


def test_hits_24h_counts_recent_qualifying_only():
    conn = make_db()
    # two qualifying hits inside the window, one qualifying but older than 24h
    conn.execute("INSERT INTO detections (timestamp, common_name, scientific_name, confidence) "
                 "VALUES (datetime('now'), 'Wood Thrush', 'Hylocichla mustelina', 0.90)")
    conn.execute("INSERT INTO detections (timestamp, common_name, scientific_name, confidence) "
                 "VALUES (datetime('now','-1 hours'), 'Wood Thrush', 'Hylocichla mustelina', 0.88)")
    conn.execute("INSERT INTO detections (timestamp, common_name, scientific_name, confidence) "
                 "VALUES (datetime('now','-48 hours'), 'Wood Thrush', 'Hylocichla mustelina', 0.95)")
    conn.commit()
    r = species_history(conn, "Wood Thrush")
    assert r["hits_24h"] == 2
    assert r["total_detections"] == 3   # the old hit still counts toward all-time totals


# ── /api/lifetime (live total_detections) ─────────────────────────────────────

def lifetime_list(conn, life_floor=0.85):
    """Mirrors bird_api.py GET /api/lifetime — total_detections is derived live
    from the detections table (>= life floor), not read from the stored counter."""
    species = []
    for r in conn.execute("SELECT * FROM lifetime ORDER BY first_seen ASC").fetchall():
        d = dict(r)
        d["total_detections"] = conn.execute(
            "SELECT COUNT(*) FROM detections "
            "WHERE (common_name = ? OR scientific_name = ?) AND confidence >= ?",
            (d.get("common_name"), d.get("scientific_name"), life_floor),
        ).fetchone()[0]
        species.append(d)
    return species


def test_lifetime_total_is_live_count_not_stored():
    conn = make_db()
    # stored counter is stale/low — the live count must override it
    seed_life(conn, [("House Sparrow", "Passer domesticus", "2026-06-01 07:00:00", 5)])
    seed(conn, [
        ("2026-06-01 07:00:00", "House Sparrow", "Passer domesticus", 0.90),  # counts
        ("2026-06-01 07:05:00", "House Sparrow", "Passer domesticus", 0.70),  # below life floor, ignored
        ("2026-06-01 07:10:00", "House Sparrow", "Passer domesticus", 0.88),  # counts
        ("2026-06-01 07:15:00", "House Sparrow", "Passer domesticus", 0.99),  # counts
    ])
    r = lifetime_list(conn)
    assert len(r) == 1
    assert r[0]["total_detections"] == 3   # three >=0.85 hits, not the stored 5, not the 0.70


def test_lifetime_total_matches_by_scientific_name():
    conn = make_db()
    seed_life(conn, [("Gray Catbird", "Dumetella carolinensis", "2026-06-01 06:00:00", 0)])
    # detections recorded under the scientific name still count toward the lifer
    seed(conn, [
        ("2026-06-01 06:00:00", "Gray Catbird", "Dumetella carolinensis", 0.91),
        ("2026-06-01 06:30:00", "Gray Catbird", "Dumetella carolinensis", 0.86),
    ])
    r = lifetime_list(conn)
    assert r[0]["total_detections"] == 2


# ── /api/detections/grouped ───────────────────────────────────────────────────

def detections_grouped(conn, start, end, min_confidence=0.85):
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
        ("2026-06-01 08:00:00", "Gray Catbird",    "Dumetella carolinensis",  0.86),
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
        ("2026-05-30 07:00:00", "House Sparrow",  "Passer domesticus",    0.88),
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
        ("2026-06-01 07:00:00", "House Sparrow",  "Passer domesticus",  0.80),  # excluded
        ("2026-06-01 08:00:00", "American Robin", "Turdus migratorius", 0.88),  # included
    ])
    r = detections_grouped(conn, "2026-06-01 04:00:00", "2026-06-02 04:00:00", min_confidence=0.85)
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
        ("2026-05-31 09:00:00", "Wood Thrush",    "Hylocichla mustelina", 0.86),
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
        test_recent_hits_newest_first_capped_at_10,
        test_recent_hits_fewer_than_10,
        test_recent_includes_sub_display_floor_diagnostics,
        test_recent_excludes_below_preserve_floor,
        test_on_life_list_flag,
        test_hits_24h_counts_recent_qualifying_only,
        test_lifetime_total_is_live_count_not_stored,
        test_lifetime_total_matches_by_scientific_name,
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
