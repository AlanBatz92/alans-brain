# Alan's Brain — session bootstrap

Before doing any work, read these reference docs in the project root (all committed to the repo):

- `Current State.md` — present-day snapshot of pages, key files/functions, conventions, and known caveats
- `Build History.md` — chronological record of feature work and decisions
- `ROADMAP.md` — the running, prioritized to-do list (what's next, what's deferred)

Treat them as authoritative context — they capture what's shipped, why, what's planned, and the conventions to match. After landing a feature, update all three: append a dated entry to `Build History.md`, revise the relevant sections of `Current State.md`, and move the item to "Done" in `ROADMAP.md`.

birdstation (the home server behind Pulse + the Bird Observatory) is version-controlled under `birdstation/` and deploys run-from-clone; see `birdstation/README.md`.

## Project conventions (quick reference, full list in `Current State.md`)

- Vanilla HTML/CSS/JS. No frameworks, no build step, no package manager. Don't introduce any.
- `setlist-spotify.js` is ES5-style (`function`, `var` — not `let`/`const`/arrow). Match the style when editing it.
- Setlist tool uses the `sl-` prefix for IDs and classes.
- Theme variables (`--bg`, `--surface`, `--text`, `--green`, etc.) live near the top of `style.css`.
- `api/` holds Vercel serverless proxies (setlist.fm, Spotify writes) for CORS workarounds.
