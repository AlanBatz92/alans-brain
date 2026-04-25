# Spotify / Setlist.fm Tool — Implementation Details

*One tool lives on the Personal Projects page, built on a vanilla-JS + Vercel-proxy stack.*

Implemented: April 2026. Audited and hardened: April 2026.

Original spec: `PLAN-spotify-setlist-tools.md` (also covered two extra tools — see the "Removed tools" section below for why they're gone).

-----

## Overview

The Personal Projects page (`projects.html`) is a hub for one small Spotify /
setlist.fm tool. It uses the Spotify PKCE auth flow, a serverless setlist.fm
proxy (`api/setlist.js`), and a serverless Spotify write proxy (`api/spotify-proxy.js`).

| Tool | File | APIs | Creates Playlist |
|---|---|---|---|
| Setlist to Spotify | `setlist-spotify.html` + `.js` | setlist.fm + Spotify | Yes |

-----

## Architecture

```
Browser ── PKCE auth ──▶ accounts.spotify.com
   │
   ├── Spotify reads ──▶ api.spotify.com (direct, with bearer token)
   ├── Spotify writes ──▶ /api/spotify-proxy ──▶ api.spotify.com
   └── Setlist.fm  ──────▶ /api/setlist     ──▶ api.setlist.fm
```

- Reads from Spotify go straight from the browser (CORS-allowed).
- Writes (create playlist, add tracks) route through `/api/spotify-proxy` because
  Spotify's Dev-Mode app sometimes blocks direct browser writes; the proxy also
  surfaces the full Spotify error body for debugging.
- All setlist.fm calls route through `/api/setlist` because setlist.fm doesn't
  send CORS headers.

-----

## Setlist to Spotify (`setlist-spotify.html`)

### Two modes

A toggle at the top of step 1 switches between **Single Setlist** and
**Combine Setlists** modes. State (`appState.mode`) survives the OAuth redirect
via `sessionStorage`.

### Single Setlist flow

1. **Search** — accepts an artist name *or* a pasted setlist.fm URL. The URL
   parser supports both long URLs and the short hex-id form.
2. **Pick setlist** — fetches setlists for the artist, filters to ones with at
   least one song.
3. **Review songs** — extracts songs from `setlist.sets.set[*].song[*]`, skips
   any with `tape: true`. Shows cover credit when present.
4. **Match on Spotify** — sequential `track:X artist:Y` searches; picks the top
   result for each.
5. **Create playlist** — through `/api/spotify-proxy`. If track addition is
   blocked (Spotify Dev Mode), shows a fallback list of direct Spotify track
   links with a "Copy list" button.

### Combine Setlists flow

1. **Add slots** — start with two; up to five. Each slot accepts an artist
   search or a pasted setlist URL.
2. **Review combined songs** — group headers per setlist; "Remove duplicate
   songs across setlists" checkbox (on by default), normalizing by lowercased
   alphanumerics.
3. **Match + create** — same as single mode. Default playlist name:
   `{Artist1} & {Artist2} — {Date}`.

### Defaults baked in

- Setlist.fm API key is hard-coded as the default; users can override in the
  collapsed "Advanced Setup" section.
- Spotify Client ID is the same — pre-filled, overridable.

-----

## April 2026 Audit & Fixes

After the initial implementation shipped, I audited everything end-to-end and
fixed the following.

### Setlist to Spotify

| Issue | Fix |
|---|---|
| `addTracksToPlaylist` hit `POST /v1/playlists/{id}/tracks`, which returns 403 in Dev Mode for personal apps after the Feb 2026 API change. The "Spotify Dev Mode blocked tracks" fallback was firing for every successful run. | Switched to `POST /v1/playlists/{id}/items` (the post-Feb-2026 endpoint). Tracks now actually get added to the playlist. |
| In combine mode, every song in the merged list was searched against `doneSlots[0].artist.name` — i.e. every song from setlist 2+ was searched against setlist 1's artist. Real-world example: HEALTH + Carpenter Brut combined; 100% of Carpenter Brut tracks failed to match. | `extractSongs(setlist, artistName)` now tags each song with its source artist. `matchAllSongs` prefers `song.cover` → `song.artist` → caller fallback when picking the search artist. |
| The Spotify search used `track:NAME artist:ARTIST` only, with no fallback. Strict filter chokes on parens / slashes / dash-remaster-suffixes — e.g. `Ouverture (Deus Ex Machina)`, `The Misfits / The Rebels`. | New `cleanForSearch()` strips those before searching, and `spotifySearch` now tries up to four progressively looser queries (strict → cleaned strict → cleaned plain → raw plain). First non-empty wins. |
| Single-mode renderers (`renderArtistResults`, `renderSetlistResults`, `renderSongList`, `selectArtist`, `selectSetlist`, `rebuildAndCreate`, success / fallback messages) interpolated artist, venue, song, and city names into HTML without escaping. Combine mode already used `escHtml`. | All single-mode renders now use `escHtml`. Eliminates display breakage on names containing `<`, `&`, or `"` and removes the XSS surface. |
| Combine-mode setlist picker hid the country code that single-mode showed | Combine picker now shows `City, US` like the single-mode version |

### What I checked and left alone

- `api/setlist.js` and `api/spotify-proxy.js` proxies — both correct.
- PKCE flow + `sessionStorage` round-trip across the OAuth redirect — works.
- "Spotify Dev Mode blocked tracks" fallback in `setlist-spotify.js` — the
  catch-all is broad (network errors also trigger it) but the user still gets
  a list of Spotify track links and an open-playlist button, so it's the right
  behavior for a fallback. With the `/items` switch this branch should rarely
  fire now.
- Default API keys baked into the JS — these are intentionally public so the
  tool works for anyone visiting the site without setup. Users with their own
  Spotify app can override in the Advanced Setup section.

-----

## Removed Tools

The original `PLAN-spotify-setlist-tools.md` scoped two extra tools alongside
Setlist to Spotify:

- **Featured Artist Playlist** (`featured-artists.html` + `.js`)
- **Live Play Stats** (`live-play-stats.html` + `.js`)

Both shipped initially but were removed after a real-world OAuth roadblock:
Spotify's free developer plan only allows **one app per developer account**, and
that app's allow-listed redirect URIs were registered against
`setlist-spotify.html`. Adding `/featured-artists.html` and
`/live-play-stats.html` would have required either a second Spotify app (not
possible on the free plan) or refactoring all three tools to share a single
redirect-callback page. Given the new tools were a "nice to have" and Setlist
to Spotify is the primary use case, the simpler call was to delete them.

If they ever come back, the right design is a single `auth-callback.html` that
restores the originating tool's state from `sessionStorage` and bounces back —
that gives Spotify a single redirect URI to allow-list per host.

-----

## What Stays the Same

- The Personal Projects page (`projects.html`) — still the entry point.
- The Setlist to Spotify OAuth flow.
- Both serverless proxies (`api/setlist.js`, `api/spotify-proxy.js`).
- Default API keys — `setlist.fm` key + Spotify Client ID baked in for one-tap
  use; users can override via Advanced Setup.
