#!/usr/bin/env bash
#
# reset_birds.sh — wipe the Emmaus Bird Observatory data for a clean start.
#
# Clears ONLY the bird tables (`detections`, `lifetime`) in ~/birdnet.db so the
# pipeline can start logging fresh tonight under the new 75%-confidence / 3-hits
# life-list gate. Pulse (the news feed) shares this database — its tables
# (feed_*) and the train tables are left completely untouched.
#
# A timestamped backup of the whole DB is taken first, so this is reversible.
#
# Run on the box:
#     cd ~/alans-brain && bash birdstation/reset_birds.sh
#
# Stop the BirdNET pipeline while resetting so nothing writes mid-wipe, then
# restart it afterward (the script does this for you if systemd is present).

set -euo pipefail

DB="${BIRDNET_DB:-$HOME/birdnet.db}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${DB}.bak-${STAMP}"

if [[ ! -f "$DB" ]]; then
    echo "ERROR: database not found at $DB" >&2
    echo "       set BIRDNET_DB=/path/to/birdnet.db if it lives elsewhere." >&2
    exit 1
fi

echo "Database : $DB"
echo "Backup   : $BACKUP"
echo

# 1. Pause the pipeline so it doesn't write during the reset (best effort).
STOPPED=0
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet birdnet.service; then
    echo "Stopping birdnet.service…"
    sudo systemctl stop birdnet.service
    STOPPED=1
fi

# 2. Safety backup of the entire DB (Pulse data included) before any change.
cp -p "$DB" "$BACKUP"
echo "Backed up to $BACKUP"

# 3. Show what we're about to clear, wipe bird tables, reclaim space.
echo
echo "Before:"
sqlite3 "$DB" "SELECT '  detections = ' || COUNT(*) FROM detections;"
sqlite3 "$DB" "SELECT '  lifetime   = ' || COUNT(*) FROM lifetime;"

sqlite3 "$DB" <<'SQL'
BEGIN;
DELETE FROM detections;
DELETE FROM lifetime;
-- reset the AUTOINCREMENT counter for detections (no-op if table is empty)
DELETE FROM sqlite_sequence WHERE name = 'detections';
COMMIT;
VACUUM;
SQL

echo
echo "After:"
sqlite3 "$DB" "SELECT '  detections = ' || COUNT(*) FROM detections;"
sqlite3 "$DB" "SELECT '  lifetime   = ' || COUNT(*) FROM lifetime;"

# 4. Confirm Pulse + train data survived.
echo
echo "Preserved (should be non-zero / unchanged):"
sqlite3 "$DB" "SELECT '  feed_items   = ' || COUNT(*) FROM feed_items;"   2>/dev/null || echo "  (no feed_items table)"
sqlite3 "$DB" "SELECT '  train_events = ' || COUNT(*) FROM train_events;" 2>/dev/null || echo "  (no train_events table)"

# 5. Restart the pipeline if we stopped it.
if [[ "$STOPPED" -eq 1 ]]; then
    echo
    echo "Restarting birdnet.service…"
    sudo systemctl start birdnet.service
fi

echo
echo "Done. Birds will start logging fresh under the new life-list gate."
echo "If you ever need to undo this, restore with:  cp '$BACKUP' '$DB'"
