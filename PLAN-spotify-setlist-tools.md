# Plan: Spotify & Setlist.fm Tool Suite Expansion

Three new tools expanding the existing `setlist-spotify` tool. All follow the same tech stack: vanilla JS, Vercel serverless proxies for CORS/auth, Spotify PKCE OAuth, setlist.fm API.

---

## Tool 1: Featured Artist Playlist Builder

**File:** `featured-artists.html` + `featured-artists.js`

### What It Does

User pastes a Spotify track, album, or playlist URL. The tool finds every artist featured (as a co-artist or collaborator) in that content and builds a Spotify playlist of each featured artist's top 5 songs.

If the content has no featured artists (e.g. a solo track with one artist), the tool tells the user clearly.

---

### Spotify URL Parsing

Detect type and ID from a pasted URL:

```
https://open.spotify.com/track/{id}      → type: "track"
https://open.spotify.com/album/{id}      → type: "album"
https://open.spotify.com/playlist/{id}   → type: "playlist"
```

Strip query strings (`?si=...`). Support both `open.spotify.com` and `spotify:track:{id}` URI formats.

---

### Artist Extraction Logic by Content Type

**Track:**
- `GET /tracks/{id}`
- `track.artists` is an array. Index 0 = primary artist. Index 1+ = featured/co-artists.
- If `artists.length === 1`: no features found.

**Album:**
- `GET /albums/{id}` → `album.artists` = the primary album artist(s)
- `GET /albums/{id}/tracks` (paginate, limit 50) → collect all `track.artists` across every track
- Featured = any unique artist ID not in `album.artists`

**Playlist:**
- `GET /playlists/{id}/tracks` (paginate, limit 100)
- Collect all unique artists across all tracks
- There is no single "primary" artist for a playlist — show all unique artists
- Present the full artist list to the user with checkboxes to de-select any they don't want

De-duplicate artists by **Spotify artist ID** (not name). Cap at 20 artists on a single playlist to prevent runaway playlist sizes (warn user if more were found).

---

### Top Tracks Fetch

For each selected featured artist:

```
GET /artists/{id}/top-tracks?market=US
```

Returns up to 10 tracks. Take the first **5**. If fewer than 5 exist, take all.

---

### Playlist Creation

- Name: `Featured Artists — {source name}` (editable before creation)
- Description: `Built from: {source URL}`
- Tracks ordered by artist (all 5 of Artist A, then all 5 of Artist B, etc.)
- Re-use existing `createPlaylist` + `addTracksToPlaylist` pattern from `setlist-spotify.js`

---

### "No Features" Handling

- **Solo track:** "No featured artists found. {Track Name} is credited to one artist only."
- **Solo album:** "No featured artists found. Every track on this album credits only {Artist Name}."
- **Playlist:** Unlikely, but: "All tracks on this playlist are by the same artist."

Optionally offer: "Want to build a Top 10 playlist for the primary artist instead?" as a fallback CTA.

---

### OAuth Scopes Needed

- Same PKCE flow as existing tool
- Read-only endpoints (`/tracks`, `/albums`, `/artists`, `/playlists`) need a valid token but no special read scopes beyond basic auth
- Playlist creation still needs: `playlist-modify-public`, `playlist-modify-private`

---

### 4-Step UI Wizard

| Step | Content |
|------|---------|
| 1 | Paste Spotify URL → "Analyze" button |
| 2 | Detected: `[Album Name] by [Artist]` + type badge. List of featured artists found (with checkboxes). "No features" message if applicable. |
| 3 | Loading top tracks → Preview: grouped by artist, 5 tracks each. Total track count shown. |
| 4 | (Login if needed) → Playlist name field → Create → Success with open-in-Spotify link |

---

### New Serverless Proxy

Most read calls go directly to Spotify from the browser (already works with a token). Album/playlist pagination may need the same approach as existing track search. No new proxy needed for reads.

Playlist creation re-uses the existing `api/spotify-proxy.js`.

---

---

## Tool 2: Live Play History (Spotify → Setlist.fm Stats)

**File:** `live-play-stats.html` + `live-play-stats.js`

### What It Does

User pastes a Spotify track, album, or playlist URL. The tool extracts song names and queries setlist.fm to show:

- **Times played live** (total setlists where this song appeared)
- **Last played date**
- **Last played venue + city**

---

### Flow

1. Parse Spotify URL (same logic as Tool 1) → extract type + ID
2. Fetch songs from Spotify:
   - **Track:** `GET /tracks/{id}` → one song
   - **Album:** `GET /albums/{id}/tracks` (paginate) → all tracks
   - **Playlist:** `GET /playlists/{id}/tracks` (paginate) → all tracks
3. For each song: query setlist.fm
4. Display results in a sortable table

---

### Setlist.fm Query Per Song

```
GET /search/setlists?songName={cleanedName}&artistName={artistName}&p=1
```

Response fields used:
- `total` → **Times played live** (number of setlists containing this song)
- `setlist[0].eventDate` → **Last played date** (most recent first by default)
- `setlist[0].venue.name` → **Last venue name**
- `setlist[0].venue.city.name` + `.stateDesc` + `.country.name` → **Last city**

If `total === 0` or no results: display "Not found on setlist.fm".

---

### Song Name Cleaning

Strip common Spotify suffixes before querying setlist.fm:

```javascript
function cleanSongName(name) {
  return name
    .replace(/\s*\(.*?(remaster|remastered|live|version|edit|mix|radio|demo|acoustic|feat\.?.*?)\)/gi, '')
    .replace(/\s*-\s*(remaster|remastered|live|version|edit|mix|radio|demo|acoustic).*/gi, '')
    .trim();
}
```

Also strip the featured artist from the Spotify `artists` array to get the primary artist name for the setlist.fm query.

---

### Performance / Rate Limiting

- Process songs **sequentially** (same pattern as existing song matching in `setlist-spotify.js`)
- Update table rows one by one as results arrive
- Show a progress indicator: "Checking 3 of 12 songs..."
- For playlists over 50 songs: warn the user upfront that this may take a moment

---

### Results Table

| Song | Artist | Times Played Live | Last Played | Last Venue | Last City |
|------|--------|------------------|-------------|------------|-----------|
| Lights | Journey | 847 | 2023-09-18 | Madison Square Garden | New York, NY, US |
| Don't Stop Believin' | Journey | 1,203 | 2023-09-20 | Barclays Center | Brooklyn, NY, US |
| Separate Ways | Journey | 412 | 2023-09-17 | ... | ... |

- Table is **sortable** by any column (click header to toggle asc/desc)
- "Not found on setlist.fm" rows styled differently (muted)
- **Export to CSV** button (client-side, no server needed)
- Click a song row → opens setlist.fm search for that song in a new tab

---

### OAuth / API Keys

- Spotify: same PKCE flow, read-only token (no write scopes needed unless user wants to create a playlist from the results — optional stretch goal)
- Setlist.fm: uses existing `/api/setlist` proxy

---

### 3-Step UI Wizard

| Step | Content |
|------|---------|
| 1 | Paste Spotify URL → "Look Up Live Stats" button |
| 2 | Shows extracted song list (loading if Spotify fetch in progress). "Start Lookup" button. |
| 3 | Results table, populating row by row. Export CSV button when complete. |

No playlist creation in this tool — it's purely informational.

---

---

## Tool 3: Multi-Setlist Combiner (Addition to Existing Tool)

**Files modified:** `setlist-spotify.html`, `setlist-spotify.js`

### What It Does

Adds a "Combine Setlists" mode to the existing setlist-to-Spotify tool. The user picks two or more setlist.fm setlists (typically from different artists at the same show — opener and headliner) and builds a single combined Spotify playlist.

---

### Where It Lives in the UI

Add a **mode toggle** at the very top of Step 1 (before search):

```
[ Single Setlist ]   [ Combine Setlists ]
```

Toggling switches between the current single-setlist flow and the new combine flow. State is preserved if user switches back.

---

### Combine Mode: Step-by-Step

**Step 1 — Manage Setlists**

Displays a list of "setlist slots". Each slot contains:
- Artist search box (same `searchArtists()` call as existing tool)
- Once artist is picked: setlist picker dropdown/list (same `getArtistSetlists()` call)
- Once setlist is picked: shows confirmation chip: `"Paramore — Sep 25, 2023 — Madison Square Garden"` with an `×` remove button

Below the slots:
- "Add Another Setlist" button (adds a new empty slot; max 5 to keep it reasonable)
- "Continue" button (enabled once at least 2 slots have setlists selected)

Also support pasting a setlist.fm URL directly into any slot (same URL parsing as existing tool).

**Step 2 — Review Combined Songs**

Shows all songs from all selected setlists in sequence:
- Each setlist's songs grouped under a header: `"Paramore Set"` / `"Taylor Swift Set"`
- Checkbox: "Remove duplicate songs across setlists" (checked by default)
  - Duplicates identified by normalized `song.name.toLowerCase()` + artist match
  - Duplicate songs shown as struck-through with a "duplicate" badge
- Total track count shown
- Spotify match status runs automatically if token is present (same `matchAllSongs()` pattern)

**Step 3 — Create Playlist**

- Default name: `{Artist1} & {Artist2} — {Date}` (uses earliest/most recent show date)
  - Editable before creation
- Standard playlist creation flow (re-uses all existing code)
- Success screen same as single-setlist flow

---

### State Management Changes

Extend `appState` in combine mode:

```javascript
appState = {
  mode: 'combine',                // 'single' | 'combine'
  combineSetlists: [              // array of picked setlists
    { artist, setlist, songs },
    { artist, setlist, songs },
    // ...
  ],
  songs: [],                      // merged/deduplicated songs
  matched: []
}
```

`sessionStorage` serialization must handle the new `combineSetlists` array to survive OAuth redirects.

---

### Duplicate Detection

```javascript
function normalizeSongName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function deduplicateSongs(allSongs) {
  const seen = new Set();
  return allSongs.map(song => {
    const key = normalizeSongName(song.name);
    if (seen.has(key)) {
      return { ...song, isDuplicate: true };
    }
    seen.add(key);
    return song;
  });
}
```

When "Remove duplicates" is checked: filter out `isDuplicate: true` entries before passing to `matchAllSongs()`.

---

### Refactoring Needed

The combine mode shares a lot of logic with single mode. Key functions to extract/reuse:

| Function | Status | Notes |
|----------|--------|-------|
| `searchArtists()` | Reuse as-is | Called per slot |
| `getArtistSetlists()` | Reuse as-is | Called per slot |
| `extractSongs()` | Reuse as-is | Called per slot |
| `parseSetlistUrl()` | Reuse as-is | Per slot URL paste |
| `matchAllSongs()` | Reuse as-is | On merged song list |
| `createPlaylist()` | Reuse as-is | Same API call |
| `addTracksToPlaylist()` | Reuse as-is | Same API call |
| `handleOAuthCallback()` | Extend | Must restore `combineSetlists` from sessionStorage |

No major restructuring needed. The combine flow is additive — the existing single-setlist code path is untouched.

---

---

## Implementation Order

Suggested sequencing:

1. **Tool 3 (Multi-Setlist Combiner)** — Lowest risk, modifies existing code, high personal utility. Start here to learn the existing code deeply before building the new standalone tools.

2. **Tool 1 (Featured Artist Playlist Builder)** — Pure Spotify, no setlist.fm dependency. Good middle step.

3. **Tool 2 (Live Play Stats)** — Bridges both APIs. Most complex due to rate-limiting concerns with large playlists.

---

## Shared Infrastructure

No new serverless functions are required. All three tools re-use:

- `api/setlist.js` — setlist.fm CORS proxy (Tools 2 and 3)
- `api/spotify-proxy.js` — Spotify write proxy (Tools 1 and 3)
- Spotify PKCE OAuth flow — identical across all tools
- Existing CSS variables and theme system — new pages inherit the existing look

---

## New Pages Summary

| Page | File | APIs Used | Creates Playlist |
|------|------|-----------|-----------------|
| Featured Artist Playlist Builder | `featured-artists.html` + `.js` | Spotify only | Yes |
| Live Play History | `live-play-stats.html` + `.js` | Spotify + setlist.fm | No |
| Multi-Setlist Combiner | Addition to existing files | setlist.fm + Spotify | Yes |

All three should be added to `index.html` Explore cards and to `tools.json` if applicable.
