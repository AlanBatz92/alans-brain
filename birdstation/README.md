# birdstation

The home server behind **Pulse** (`https://birds.alansbrain.com`). It's an
**Emmaus Bird Observatory** (BirdNET acoustic detections + a train-noise
detector; a solar node is wired but disabled) and Pulse is a tenant on the same
box — they share `~/birdnet.db` and one FastAPI app (`bird_api.py`, uvicorn on
`:8080`). Pulse fetches RSS sources, dedupes/stores articles, AI-enriches them
(category + summary), and writes a daily "Morning Brief". The website
(`pulse.html` / `pulse.js`) is a thin reader over this.

This folder is the **source of truth** for birdstation's code. The box runs the
checked-out files directly (**run-from-clone**): the repo is cloned to
`~/alans-brain` and the systemd units point at `~/alans-brain/birdstation/*.py`.
Deploying is `git pull` + a restart — no copy step, nothing drifts.

## Layout

```
birdstation/
  pulse_fetcher.py    # timer: pull enabled feed_sources, dedupe, store, purge >30d
  pulse_enrich.py     # timer: batched AI category + one-sentence summary (Haiku)
  pulse_digest.py     # daily timer: Claude Morning Brief with citations (Sonnet)
  bird_api.py         # FastAPI app: /api/feed, /api/digest, bird + train routes
  birdnet_pipeline.py # birdnet.service: capture→analyze→log; life-list gate; clips
  purge_bird_clips.py # daily timer: age out unreviewed bird verification clips
  review_birds.py     # CLI: confirm lifers; --stats prints measured precision
  purge_low_confidence.py # CLI one-shot: drop detections below the 0.60 preserve floor
  schema.sql          # full birdnet.db schema + migration log
  systemd/            # .service / .timer units (templated — no inline secrets)
  README.md           # this file
```

## Deploy (routine, after the cutover below)

```bash
cd ~/alans-brain
git pull origin main
# restart only what changed:
sudo systemctl restart birdapi              # bird_api.py changed
sudo systemctl restart birdnet              # birdnet_pipeline.py changed (init_db auto-migrates)
sudo systemctl start  pulse-digest.service  # regenerate the brief now
# new units? re-copy + reload + enable (see cutover step 4) — e.g. purge-bird-clips.timer
# schema.sql changed? bird columns auto-migrate via init_db on birdnet restart; others by hand
```

## Secrets — never committed

Keys live **only on the box**, in an untracked env file the units reference:

```
# /etc/birdstation.env   (chmod 600, NOT in git)
ANTHROPIC_API_KEY=sk-ant-...
BIRD_API_KEY=...            # rotate the one that leaked in chat 2026-05-30
```

The committed units use `EnvironmentFile=/etc/birdstation.env` — no inline keys.
`.gitignore` also blocks `*.env` / `*.db` repo-wide as a backstop.

## First-time cutover (run-from-clone)

One-time migration from the old `~/*.py` + inline-key units to this model.

```bash
# 1. Clone the repo read-only to ~/alans-brain (deploy key or HTTPS).
git clone <repo-url> ~/alans-brain

# 2. Create the secrets file (rotate BIRD_API_KEY first).
sudo tee /etc/birdstation.env >/dev/null <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
BIRD_API_KEY=<newly-rotated-key>
EOF
sudo chmod 600 /etc/birdstation.env

# 3. Apply any pending DB migration (see schema.sql).
sqlite3 ~/birdnet.db "ALTER TABLE feed_digests ADD COLUMN citations_json TEXT;"

# 4. Install the units from the repo, reload, restart/enable.
sudo cp ~/alans-brain/birdstation/systemd/*.service \
        ~/alans-brain/birdstation/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart birdapi
sudo systemctl enable --now pulse-fetch.timer pulse-enrich.timer pulse-digest.timer

# 5. Verify, then regenerate the brief so citations appear.
sudo systemctl start pulse-digest.service
journalctl -u pulse-digest.service -n 10 --no-pager
curl -s https://birds.alansbrain.com/api/digest | python3 -m json.tool | head -40

# 6. Once green, retire the old copies to avoid confusion.
mkdir -p ~/retired && mv ~/pulse_fetcher.py ~/pulse_enrich.py ~/pulse_digest.py ~/bird_api.py \
                        ~/birdnet_pipeline.py ~/train_detector.py ~/retired/ 2>/dev/null || true
```

### Cutover addendum — observatory pipelines

The same run-from-clone switch for `birdnet.service` and `train_detector.service`
(installed alongside the Pulse units in step 4). After `daemon-reload`:

```bash
# Kill the duplicate train detector first (check which is actually enabled).
systemctl is-enabled train_detector.service traindetect.service
sudo systemctl disable --now traindetect.service
sudo rm /etc/systemd/system/traindetect.service
sudo systemctl daemon-reload

# Restart the two pipelines onto the clone'd scripts.
sudo systemctl restart birdnet.service train_detector.service
systemctl is-active birdnet.service train_detector.service        # → active, active
journalctl -u birdnet.service -n 5 --no-pager                     # detections flowing
```

Both keep their existing venvs (`birdnet-env`, `train-env`) — no reinstall.

The venv at `/home/alan/api-env` already has the deps (anthropic, pydantic,
fastapi, uvicorn, feedparser).

## Migrations

`schema.sql` is canonical; the live DB is migrated by hand. Add each change as a
dated `-- migration` block at the bottom of `schema.sql` and note it in the
repo's `Build History.md`.

## Services

| Unit | Role |
|---|---|
| `birdapi.service` | the FastAPI app (long-running, `:8080`) |
| `birdnet.service` | BirdNET capture/analyze/log pipeline (long-running loop) |
| `train_detector.service` | train-whistle detector (long-running loop) |
| `purge-train-clips.timer` → `.service` | weekly purge of train clips (Sun 04:00) |
| `purge-bird-clips.timer` → `.service` | daily purge of unreviewed bird clips (04:30) |
| `pulse-fetch.timer` → `.service` | source fetch every 15 min (purges >30 days) |
| `pulse-enrich.timer` → `.service` | batched AI enrichment, every 20 min |
| `pulse-digest.timer` → `.service` | daily Morning Brief (~06:00 local) |

### Bird verification clips (privacy)

`birdnet_pipeline.py` saves one short WAV per life-list-qualifying detection
(>= 0.85, one per species/day) under `~/bird_clips`, so the life list can be
spot-checked and BirdNET scores calibrated (`review_birds.py`, with `--stats`).
Like the train clips these come off the backyard mic and can catch conversation,
so they are **never served by the API** — review them on the box over SSH. The
daily `purge-bird-clips.timer` deletes unreviewed clips older than 30 days
(`BIRD_CLIP_RETENTION_DAYS`); clips you label with `review_birds.py` are kept.

The observatory pipelines (`birdnet`, `train_detector`) each use their own venv —
`~/BirdNET-Analyzer/birdnet-env` and `~/train-env` — which the units reference
directly; only the script path moves into the clone.

> **Duplicate unit:** the box had both `train_detector.service` and
> `traindetect.service` pointing at the same script (two detectors writing
> `train_events` in parallel). The repo keeps **`train_detector.service`** as
> canonical; disable and remove `traindetect.service` at cutover (below).
