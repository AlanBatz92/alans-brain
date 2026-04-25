# Spotify / Setlist.fm Tool Suite — Implementation Details

*Three tools live on the Personal Projects page, all built on the same vanilla-JS + Vercel-proxy stack.*

Implemented: April 2026. Audited and hardened: April 2026.

Original spec: `PLAN-spotify-setlist-tools.md`.

-----

## Overview

The Personal Projects page (`projects.html`) is a hub for three small Spotify /
setlist.fm tools. They share the Spotify PKCE auth flow, a serverless setlist.fm
proxy (`api/setlist.js`), and a serverless Spotify write proxy (`api/spotify-proxy.js`).

| Tool | File | APIs | Creates Playlist |
|---|---|---|---|
| Setlist to Spotify | `setlist-spotify.html` + `.js` | setlist.fm + Spotify | Yes |
| Featured Artist Playlist | `featured-artists.html` + `.js` | Spotify only | Yes |
| Live Play Stats | `live-play-stats.html` + `.js` | Spotify + setlist.fm | No |

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

## Tool 1: Setlist to Spotify (`setlist-spotify.html`)

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

## Tool 2: Featured Artist Playlist (`featured-artists.html`)

### Flow

1. Paste a Spotify track / album / playlist URL.
2. Tool detects type and fetches:
   - **Track:** `artists[1..]` are the features (`artists[0]` is primary).
   - **Album:** every track's artists, minus the album's primary artists.
   - **Playlist:** every unique artist across every track (no concept of
     "primary" for a playlist), capped at 20.
3. User unchecks any artists they don't want.
4. Tool fetches each selected artist's top 5 tracks via
   `/artists/{id}/top-tracks?market=US`.
5. Preview the playlist; edit the name; create it.

### "No features" handling

- Solo track: "{Track} has only one credited artist — no features found."
- Solo album: "No featured artists found on this album."
- Empty playlist: "No artists found in this playlist."

-----

## Tool 3: Live Play Stats (`live-play-stats.html`)

### Flow

1. Paste a Spotify track / album / playlist URL.
2. Tool fetches all tracks from Spotify and extracts `(songName, artistName)`.
3. For each song, calls `/search/setlists?songName=&artistName=` on setlist.fm
   via the proxy.
4. Renders a sortable table: Song, Times Played, Last Played, Last Venue.
5. CSV export available once the run finishes.

### Song name cleaning

Strips Spotify-style suffixes before querying setlist.fm so the search isn't
defeated by "(Remastered 2011)" or "- Live at Wembley":

```javascript
.replace(/\s*[\(\[](remaster(ed)?|live|version|edit|mix|radio|demo|acoustic|deluxe|bonus|feat\.?[^\)\]]*)[^\)\]]*[\)\]]/gi, '')
.replace(/\s*[-–]\s*(remaster(ed)?|live|version|edit|mix|radio|demo|acoustic).*/gi, '')
```

-----

## April 2026 Audit & Fixes

After the initial implementation shipped, I audited the three tools end-to-end
and fixed the following:

### Live Play Stats

| Issue | Fix |
|---|---|
| OAuth errors (denial, state mismatch, token failure) failed silently — user left at a blank page | Errors now surface in the step-1 error block |
| HTTP 429 from setlist.fm was treated as "song not found" | `lpsSearchSong` now retries up to twice with a 1.5s backoff on 429 |
| Sequential queries fired as fast as the network allowed, often tripping setlist.fm's ~2 req/sec limit | Added a 250ms throttle between songs |
| Clicking "Start Over" mid-lookup crashed with `Cannot set property 'stats' of undefined` (in-flight `.then` writing into a freshly-emptied `rows` array) | Added a `runId` cancellation pattern; in-flight callbacks check `myRun !== lpsState.runId` before writing |

### Featured Artist Playlist

| Issue | Fix |
|---|---|
| OAuth errors failed silently | Errors now surface in the step-1 error block |
| Unused `defaultName` variable | Removed |

### Setlist to Spotify

| Issue | Fix |
|---|---|
| Single-mode renderers (`renderArtistResults`, `renderSetlistResults`, `renderSongList`, `selectArtist`, `selectSetlist`, `rebuildAndCreate`, success / fallback messages) interpolated artist, venue, song, and city names into HTML without escaping. Combine mode already used `escHtml`. | All single-mode renders now use `escHtml`. Eliminates display breakage on names containing `<`, `&`, or `"` and removes the XSS surface. |
| Combine-mode setlist picker hid the country code that single-mode showed | Combine picker now shows `City, US` like the single-mode version |

### What I checked and left alone

- `api/setlist.js` and `api/spotify-proxy.js` proxies — both correct.
- PKCE flow + `sessionStorage` round-trip across the OAuth redirect — works in
  all three tools (single-mode setlist, combine-mode setlist, FA, LPS).
- "Spotify Dev Mode blocked tracks" fallback in `setlist-spotify.js` — the
  catch-all is broad (network errors also trigger it) but the user still gets
  a list of Spotify track links and an open-playlist button, so it's the right
  behavior for a fallback.
- Default API keys baked into the JS — these are intentionally public so the
  tools work for anyone visiting the site without setup. Users with their own
  Spotify app can override in the Advanced Setup section.

-----

## What Stays the Same

- The Personal Projects page itself (`projects.html`) — no changes needed.
- All three tools' OAuth flow.
- Both serverless proxies (`api/setlist.js`, `api/spotify-proxy.js`).
- Default API keys — `setlist.fm` key + Spotify Client ID baked in for one-tap
  use; users can override via Advanced Setup.

-----

## Future Enhancements (Not Implemented)

- Pull stats for **multiple albums at once** in Live Play Stats (currently one
  Spotify URL per run).
- "Build a playlist from these results" button on Live Play Stats — Tool 2
  already creates playlists; could share the same code path.
- Cache setlist.fm responses per `(songName, artistName)` in `localStorage` so
  re-running a playlist is fast and rate-limit-friendly.
- Surface Spotify rate-limit (429) handling in Featured Artist top-track fetches
  the same way we now handle setlist.fm 429s.
