# birdstation

The home server behind **Pulse** (`https://birds.alansbrain.com`). It fetches
RSS sources, dedupes and stores articles in SQLite, AI-enriches them
(category + summary), writes a daily "Morning Brief", and serves everything
over a small HTTP API. The website (`pulse.html` / `pulse.js`) is a thin reader
over this.

This folder is the **source of truth** for birdstation's code. Changes are made
here as normal git commits and deployed to the box with `git pull` + a service
restart — no SSH-from-CI, no paste-blocks.

## Layout

```
birdstation/
  pulse_fetch.py     # timer: pull active feed_sources, dedupe, store
  pulse_enrich.py    # timer: AI category + one-sentence summary per item
  pulse_digest.py    # daily timer: Claude-written Morning Brief (+ citations)
  bird_api.py        # HTTP API: /api/feed, /api/digest
  schema.sql         # full DB schema (source of truth for table structure)
  systemd/           # .service / .timer units (templated — no secrets)
  README.md          # this file
```

## Deploy (run on birdstation)

```bash
cd ~/alans-brain                 # the box's read-only clone of this repo
git pull origin main
# restart whatever changed:
sudo systemctl restart birdapi             # after bird_api.py changes
sudo systemctl start  pulse-digest.service # to regenerate the brief now
# after schema.sql changes, apply migrations by hand (see "Migrations")
```

(Optional later: a `systemd` path-unit or cron that auto-runs `git pull` so
deploys are hands-off.)

## Secrets — never committed

The `ANTHROPIC_API_KEY` lives **only on the box**, in an untracked env file
referenced by the units:

```
# /etc/birdstation.env   (chmod 600, NOT in git)
ANTHROPIC_API_KEY=sk-ant-...
```

```ini
# in each unit that calls Claude:
EnvironmentFile=/etc/birdstation.env
```

The unit files committed here use `EnvironmentFile=` and carry **no inline
key**. `.gitignore` also blocks `*.env` and `*.db` repo-wide as a backstop.

## Migrations

`schema.sql` is the canonical schema. The live DB (`~/birdnet.db`) is migrated
by hand for now; record each change both here (as a dated `-- migration` block
at the bottom of `schema.sql`) and in the repo's `Build History.md`. Example:

```sql
-- migration 2026-05-30: citations on digests
ALTER TABLE feed_digests ADD COLUMN citations_json TEXT;
```

## Services (confirm exact unit names on the box)

| Unit | Role |
|---|---|
| `pulse-fetch.timer` → `.service` | periodic source fetch |
| `pulse-enrich.timer` → `.service` | periodic enrichment |
| `pulse-digest.timer` → `.service` | daily Morning Brief (~06:00 local) |
| `birdapi.service` | the HTTP API (long-running) |
