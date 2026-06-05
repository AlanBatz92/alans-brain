#!/usr/bin/env bash
# Symlink birdstation's systemd unit files from the repo into /etc/systemd/system
# so unit-file edits deploy on `git pull` (+ daemon-reload) with no manual copy —
# making the units truly run-from-clone, like the Python already is.
#
# Idempotent: re-running only relinks what isn't already correct. Any existing
# *real* (non-symlink) unit is backed up once before being replaced, so it's
# reversible. Relinking does NOT restart running services — restart the units you
# changed yourself afterward.
#
#   sudo ~/alans-brain/birdstation/link_units.sh
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)/systemd"
DEST_DIR="/etc/systemd/system"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo (writes symlinks into $DEST_DIR)." >&2
  exit 1
fi

linked=0
for src in "$SRC_DIR"/*.service "$SRC_DIR"/*.timer; do
  [[ -e "$src" ]] || continue
  name="$(basename "$src")"
  dest="$DEST_DIR/$name"

  # Already the correct symlink? leave it.
  if [[ -L "$dest" && "$(readlink -f "$dest")" == "$(readlink -f "$src")" ]]; then
    continue
  fi
  # Back up an existing real file (not a symlink) once, so this is reversible.
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    cp -a "$dest" "$dest.bak-$STAMP"
    echo "backed up $name -> $name.bak-$STAMP"
  fi
  ln -sfn "$src" "$dest"
  echo "linked $name -> $src"
  linked=$((linked + 1))
done

systemctl daemon-reload
echo "daemon-reload done; ${linked} unit(s) (re)linked."
echo "Now restart any units whose definition changed, e.g.:"
echo "  sudo systemctl restart pulse-digest.timer birdapi.service"
