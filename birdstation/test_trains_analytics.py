#!/usr/bin/env python3
"""Standalone tests for compute_train_analytics (no FastAPI needed).
Run: python3 birdstation/test_trains_analytics.py"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_analytics import compute_train_analytics, _EASTERN


def row(iso, dur=10.0, db=70.0):
    return {"detected_at": iso, "duration_s": dur, "peak_db": db}


# A burst (3 clips within 5 min = ONE pass) + two separate passes, all on
# 2026-06-15 (EDT, UTC-4): UTC 12:00→08:00 ET, 13:00→09:00 ET, 13:30→09:30 ET.
JUN15 = [
    row("2026-06-15T12:00:00+00:00"),
    row("2026-06-15T12:02:00+00:00"),
    row("2026-06-15T12:04:00+00:00"),
    row("2026-06-15T13:00:00+00:00"),
    row("2026-06-15T13:30:00+00:00"),
]
JUN10 = [row("2026-06-10T12:00:00+00:00"), row("2026-06-10T20:00:00+00:00")]  # 2 passes

passed = failed = 0
def ok(name, cond):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("  FAIL:", name)

if _EASTERN is None:
    print("zoneinfo unavailable — Eastern assertions would be UTC; skipping.")
    sys.exit(0)

# 1. Pass grouping: 5 clips -> 3 passes; Eastern hour buckets 8,9,9.
a = compute_train_analytics(JUN15)
ok("5 clips -> 3 passes", a["total_passes"] == 3)
ok("total_clips counts all 5", a["total_clips"] == 5)
ok("busiest Eastern hour = 9", a["busiest_hour"] == 9)
ok("by_hour[8]==1", a["by_hour"][8] == 1)
ok("by_hour[9]==2", a["by_hour"][9] == 2)
ok("peak_day 2026-06-15", a["peak_day"] == "2026-06-15")
ok("by_dow_hour total == 3", sum(sum(r) for r in a["by_dow_hour"]) == 3)

# 2. No window = all-time (backward compatible): 06-10 (2) + 06-15 (3) = 5 passes.
b = compute_train_analytics(JUN10 + JUN15)
ok("no window: all-time 5 passes", b["total_passes"] == 5)
ok("no window: 2 days", len(b["by_day"]) == 2)

# 3. Window scopes the buckets: window = the 06-15 Eastern day (UTC bounds).
w = compute_train_analytics(
    JUN10 + JUN15, start="2026-06-15 04:00:00", end="2026-06-16 04:00:00")
ok("window keeps only 06-15", w["total_passes"] == 3 and list(w["by_day"]) == ["2026-06-15"])

# 4. passes_today is ABSOLUTE (independent of the selected period). Window = 06-10,
#    but 'today' = 06-15 -> period total reflects 06-10 while passes_today counts 06-15.
t = compute_train_analytics(
    JUN10 + JUN15,
    start="2026-06-10 04:00:00", end="2026-06-11 04:00:00",
    today_start="2026-06-15 04:00:00", today_end="2026-06-16 04:00:00")
ok("windowed total = 06-10 (2)", t["total_passes"] == 2)
ok("passes_today absolute = 06-15 (3)", t["passes_today"] == 3)

# 5. Empty window -> zeros / None.
e = compute_train_analytics(JUN15, start="2030-01-01 00:00:00", end="2030-01-02 00:00:00")
ok("empty: 0 passes", e["total_passes"] == 0)
ok("empty: busiest None", e["busiest_hour"] is None)
ok("empty: peak_day None", e["peak_day"] is None)
ok("empty: headway None", e["median_headway_min"] is None)

# 6. Headway: 06-10 passes are 8h apart -> median 480 min.
h = compute_train_analytics(JUN10)
ok("headway 480 min", h["median_headway_min"] == 480.0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
