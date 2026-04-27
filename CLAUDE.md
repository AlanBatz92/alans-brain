# Alan's Brain — session bootstrap

Before doing any work, read these two local-only reference docs in the project root:

- `Current State.md` — present-day snapshot of pages, key files/functions, conventions, and known caveats
- `Build History.md` — chronological record of feature work and decisions

Both are gitignored. Treat them as authoritative context — they capture what's shipped, why, and the conventions to match. After landing a feature, update both files (append a dated entry to `Build History.md`; revise the relevant sections of `Current State.md`).

## Project conventions (quick reference, full list in `Current State.md`)

- Vanilla HTML/CSS/JS. No frameworks, no build step, no package manager. Don't introduce any.
- `setlist-spotify.js` is ES5-style (`function`, `var` — not `let`/`const`/arrow). Match the style when editing it.
- Setlist tool uses the `sl-` prefix for IDs and classes.
- Theme variables (`--bg`, `--surface`, `--text`, `--green`, etc.) live near the top of `style.css`.
- `api/` holds Vercel serverless proxies (setlist.fm, Spotify writes) for CORS workarounds.
