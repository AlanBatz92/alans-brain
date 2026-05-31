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
  pulse_fetcher.py   # timer: pull enabled feed_sources, dedupe, store, purge >30d
  pulse_enrich.py    # timer: batched AI category + one-sentence summary (Haiku)
  pulse_digest.py    # daily timer: Claude Morning Brief with citations (Sonnet)
  bird_api.py        # FastAPI app: /api/feed, /api/digest, bird + train routes
  schema.sql         # full birdnet.db schema + migration log
  systemd/           # .service / .timer units (templated — no inline secrets)
  README.md          # this file
```

## Deploy (routine, after the cutover below)

```bash
cd ~/alans-brain
git pull origin main
# restart only what changed:
sudo systemctl restart birdapi              # bird_api.py changed
sudo systemctl start  pulse-digest.service  # regenerate the brief now
# units changed? re-copy + reload (see cutover step 4)
# schema.sql changed? apply the new migration block by hand
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
mkdir -p ~/retired && mv ~/pulse_fetcher.py ~/pulse_enrich.py ~/pulse_digest.py ~/bird_api.py ~/retired/ 2>/dev/null || true
```

The venv at `/home/alan/api-env` already has the deps (anthropic, pydantic,
fastapi, uvicorn, feedparser).

## Migrations

`schema.sql` is canonical; the live DB is migrated by hand. Add each change as a
dated `-- migration` block at the bottom of `schema.sql` and note it in the
repo's `Build History.md`.

## Services

| Unit | Role |
|---|---|
| `pulse-fetch.timer` → `.service` | source fetch every 15 min (purges >30 days) |
| `pulse-enrich.timer` → `.service` | batched AI enrichment, every 20 min |
| `pulse-digest.timer` → `.service` | daily Morning Brief (~06:00 local) |
| `birdapi.service` | the FastAPI app (long-running, `:8080`) |
