# Alan's Brain — Current State

**Last Updated:** April 3, 2026

---

## Recently Added

- **Task tracker: area filtering, progress fade, day granularity:** Area dropdown lets you scope the task list to a single room (Kitchen, Basement, etc.). "Fade" toggle adds a colored progress fill to each task card — fills up as the task approaches due (green → yellow → red). "Drain" sub-toggle reverses the direction so it empties like a gauge. All badge text now shows days only (no more hours). Preferences persist in localStorage.
- **Backdate task completions:** Drawer now has a "When?" section with "Just now" / "Earlier…" toggle. Selecting "Earlier…" reveals date + time pickers (defaults to yesterday at 12:00). Backend accepts optional `completedAt` ISO timestamp for backdated entries — affects Last Completed, Next Due, and Log.
- **Per-clip icons:** Clips can now have an optional `"icon"` field. Clicking a clip with an assigned icon swaps the category header image to that clip's icon — shows who the clip comes from. Admin GUI gets "Set Icon" / "Clear Icon" buttons per clip row, plus a 🖼 indicator for clips that have icons.
- **Admin GUI image ingestion fix:** `_on_add_icon` now copies files picked from outside the project into `img/Icons/Soundboards/{BoardId}/` before saving the path — no more broken `../../../Downloads/...` paths in JSON. Stale relative paths cleared from `maxpayne.json` (Goons) and `halflife.json` (G-Man).
- **Max Payne "Goons" board** (`2882bb8`): 6 clips added (`death_01–03`, `death_06`, `death_08`, `wack_the_sucker`). Audio in `audio/maxpayne/`.
- **Half-Life G-Man additions** (`2882bb8`): 5 more clips + rotating category images for G-Man and Scientists.
- **Rotating board selector icons** (`6baea93`): `index.json` `"icon"` → `"icons"` (array). Board selector uses `pickWeighted()` + sessionStorage anti-repeat. Multi-character boards rotate; single-character boards use a 1-item array.
- **Board selector icon styling** (`6baea93`, `8b8d2b1`): `.sb-board-icon` class at 44px, `object-fit: cover + object-position: top center` — same head-crop style as category images.
- **Clip glow fade-out** (`6baea93`, `638f2f5`): `box-shadow` transition extended to `0.6s ease-out`; `border-color` removed from `.audio-btn.playing` to prevent green outline lingering after glow dissolves.
- **iOS silent switch fix** (`7cbb598`): Replaced Web Audio API with `<audio>` elements.
- **Progress bar + stop-button glow fixes** (`686eb82`): `onStart` moved to `loadedmetadata`; explicit CSS transition properties prevent animation freeze.

---

## How to Add Content

Every Explore page works the same way — edit the JSON, drop in the files, page handles the rest. No HTML editing needed.

### Great & Free → `data/tools.json` / `data/websites.json`

```json
{
  "name": "Tool Name",
  "url": "https://link.com",
  "description": "What it does.",
  "category": "Design",
  "icon": "🔧"
}
```
Categories auto-generate filter buttons. Tools total: 40 across 11 categories. Websites total: 25 across 5 categories.

---

### YouTube Channels → `data/youtube.json`

1. Save profile picture to `img/youtube/channel-name.png`
2. Add entry:
```json
{
  "name": "Channel Name",
  "url": "https://youtube.com/@handle",
  "description": "What they make.",
  "category": "Tech",
  "image": "img/youtube/channel-name.png"
}
```
Optional `"exemplar": { "videoId": "abc123", "title": "...", "note": "..." }` to feature a specific video.

---

### Photo Gallery → `data/photos.json`

1. Full-size image → `img/photos/full/`
2. Thumbnail (~600px) → `img/photos/thumbs/` (same filename)
3. Add entry:
```json
{
  "src": "img/photos/full/sunset.jpg",
  "thumb": "img/photos/thumbs/sunset.jpg",
  "caption": "Sunset over the mountains",
  "category": "Nature"
}
```

---

### Art Gallery → `data/art.json`

1. Full image → `img/art/full/`
2. Thumbnail → `img/art/thumbs/`
3. Add entry:
```json
{
  "src": "img/art/full/painting.jpg",
  "thumb": "img/art/thumbs/painting.jpg",
  "title": "Title",
  "artist": "Artist Name",
  "year": "1889"
}
```
`artist` and `year` are optional.

---

### Paranormal → `data/paranormal.json`

```json
{
  "title": "The Phoenix Lights",
  "type": "video",
  "category": "UFOs",
  "description": "Thousands of people across Arizona saw a V-shaped formation in March 1997.",
  "url": "https://youtube.com/watch?v=example",
  "conviction": 8
}
```
`type`: video, article, photo, writing, podcast, documentary, book, case
`category`: UFOs, Ghosts, Cryptids, Psychic, Unexplained, Conspiracy, Ancient, Other
`conviction`: 0–10, optional. `image`: optional path.

---

### Soundboards → `data/soundboards/`

The master list is `data/soundboards/index.json`. Each board has its own JSON file.

**Adding clips to an existing board:**
1. Put audio files in `audio/{boardId}/`
2. Edit `data/soundboards/{boardId}.json`:
```json
{
  "quotes": ["Memorable quote from the game"],
  "icons": {
    "CategoryName": ["img/Icons/Soundboards/Board/char1.png", "img/Icons/Soundboards/Board/char2.png"],
    "default": "img/Icons/Soundboards/Board/char.png"
  },
  "categories": [
    {
      "name": "CategoryName",
      "clips": [
        { "label": "Display Name", "file": "filename.wav", "icon": "img/Icons/Soundboards/Board/char.png" }
      ]
    }
  ]
}
```
3. Run `python admin-gui.py` to manage clips, images, and subtitles visually. Or run `python admin.py soundboard sync` to update clip counts.

**Icons:** Each category header shows a rotating character image. Assign images per-category in `data.icons[categoryName]` (string for one image, array for rotation). Use the admin GUI's "Rotating Images" section to add/remove without editing JSON manually.

**Clip icons:** Individual clips can have an optional `"icon"` field. When a clip with an icon is clicked, its category header image swaps to that icon — useful for general categories like "Monsters" where each clip comes from a different character. Assign via the admin GUI's "Set Icon" button per clip row. The existing page-refresh rotation is unaffected.

**Adding a new board:** Add entry to `index.json`, create `data/soundboards/{id}.json`, create `audio/{id}/`, add character icon to `img/Icons/Soundboards/{BoardFolder}/`.

---

### Quick Reference

| Adding... | Edit this file | Files go here |
|---|---|---|
| A tool | `data/tools.json` | (URL only, no files) |
| A website | `data/websites.json` | (URL only, no files) |
| A YouTube channel | `data/youtube.json` | `img/youtube/` |
| A photo | `data/photos.json` | `img/photos/full/` + `img/photos/thumbs/` |
| An artwork | `data/art.json` | `img/art/full/` + `img/art/thumbs/` |
| A paranormal entry | `data/paranormal.json` | `img/paranormal/` (optional) |
| Soundboard clips | `data/soundboards/{id}.json` | `audio/{id}/` |

---

## Current File Structure

```
alans-brain/
├── index.html              ✅ Homepage with Explore cards
├── tasks.html              ✅ Task tracker (passphrase-protected, no public nav links)
├── tools.html              ✅ Great & Free — tools + websites, tab toggle, search, filters
├── youtube.html            ✅ YouTube channels + videos tabs, 114 channels
├── photos.html             ✅ Masonry photo gallery — empty, ready to fill
├── art.html                ✅ Slideshow + lightbox art gallery — 2 entries
├── soundboards.html        ✅ 5 boards, HTML Audio engine, rotating board icons, 2-col mobile grid
├── paranormal.html         ✅ Paranormal media grid — empty, ready to fill
├── transart.html           ✅ Pride and Identity — Art/Polyamory/Resources tabs
├── style.css               ✅ All shared components, theme support, soundboard styles
├── theme-switcher.js       ✅ Theme engine (apply/persist/load, picker UI, Konami code)
├── soundboards.js          ✅ SoundEngine — <audio> elements, OGG→WAV fallback, iOS silent-switch bypass
├── gallery.js              ✅ Lightbox + Slideshow constructors
├── visit-ticker.js         ✅ Odometer visit counter (GoatCounter)
├── auth.js                 ✅ SHA-256 passphrase gate (tasks.html)
├── tasks.js                ✅ Task tracker engine
├── admin.py                ✅ Unified CLI: soundboard + media commands
├── admin-gui.py            ✅ Unified GUI: Soundboards panel (clips/icons/subtitles) + Media panel
├── .gitignore              ✅ Excludes planning docs, __pycache__, Build History.md
├── themes/
│   ├── quake2.css          ✅ Quake II color theme (35+ variable overrides)
│   └── textures/quake2/    ⬚ Empty — ready for Phase 4 texture assets
├── data/
│   ├── tools.json          ✅ 40 tools, 11 categories
│   ├── websites.json       ✅ 25 websites, 5 categories (incl. Indie Web)
│   ├── youtube.json        ✅ 114 channels with profile images
│   ├── videos.json         ⬚ Empty — for YouTube Videos tab
│   ├── photos.json         ⬚ Empty — needs photo entries
│   ├── art.json            ✅ 2 entries (Sebastian Pether)
│   ├── paranormal.json     ⬚ Empty — needs paranormal entries
│   ├── transart-artists.json     ⬚ Empty — needs artist profiles
│   ├── transart-resources.json   ⬚ Empty — needs resource listings
│   ├── transart-polyamory.json   ⬚ Empty — needs polyamory content
│   └── soundboards/
│       ├── index.json      ✅ 5-board manifest with character image icons
│       ├── halflife.json   ✅ 20 clips (Scientists × 15, G-Man × 5)
│       ├── theyhunger.json ✅ 7 clips (Monsters × 5, Chester Rockwood × 2)
│       ├── maxpayne.json   ✅ 6 clips (Goons × 6)
│       ├── quake2.json     ⬚ Empty categories — ready for clips
│       └── rlm.json        ⬚ Empty categories — ready for clips
├── img/
│   ├── Icons/
│   │   ├── Soundboards/    ✅ Character images by board subfolder
│   │   │   ├── Half-Life/      Scientist_1/2/3_No_BG.png, Scientist_No_BG.png (board icon), G-Man_No_BG.png
│   │   │   ├── Max_Payne/      Max_Payne_No_BG.png
│   │   │   ├── They_Hunger/    They_Hunger_Boy_No_BG.webp, ChesterRockwood_No_BG.png
│   │   │   ├── Quake2/         Bitterman_No_BG.png
│   │   │   └── RLM/            Mike_Stoklasa, Jay_RLM, Rich, Rich_2 _No_BG.png
│   │   └── icons/          ✅ UI icons by page (all pages use cam.png, speaker.png, etc.)
│   ├── youtube/            ✅ 114 channel profile pictures (.png + .webp)
│   ├── art/full/           ✅ 2 full-size artworks (.jpg + .webp)
│   ├── art/thumbs/         ✅ 2 thumbnails (.jpg + .webp)
│   ├── photos/full/        ⬚ Empty
│   └── photos/thumbs/      ⬚ Empty
└── audio/
    ├── halflife/           ✅ 20 clips (.wav + .ogg each = 40 files)
    ├── theyhunger/         ✅ 7 clips (.mp3)
    └── maxpayne/           ✅ 6 clips (.wav)
```

**Directories to create as needed:**
- `img/paranormal/` — paranormal entry images
- `audio/quake2/`, `audio/rlm/` — audio per board

---

## What's Left / Roadmap

### Theme System Phase 4: Quake II Full Skin

Color theme is live. Next: elevate to "this IS Quake 2":
1. **Textures** — Tiled stone/metal from Q2 PAK files in `themes/textures/quake2/` with `background-blend-mode: overlay`
2. **Beveled UI chrome** — 2px borders, inset shadows, reduced border-radius
3. **Pixel font** — `Press Start 2P` or similar, override `--font-display`
4. **Scanline overlay** — `body::after` with `repeating-linear-gradient` for CRT feel

### Theme System Phase 5: Additional Themes

Each theme = CSS file + texture folder + one line in `THEMES` object:
- **PS1** — Sony grays & blues, chunky polygonal energy
- **Doom** — STBAR browns, red accents, metal textures

### Phase 4: Pride and Identity — Content

Shell is built. Needs:
1. Artist profiles → `data/transart-artists.json` (schema: `{ name, pronouns, photo, bio, categories[], links{}, artworks[] }`)
2. Resource listings → `data/transart-resources.json` (schema: `{ name, description, category, region, url, phone, crisis }`)
3. Polyamory content → `data/transart-polyamory.json`
4. Artist artwork thumbnails with lightbox

### Content Population (Ongoing)

These are ready structurally — just need Alan's curation:
- `data/photos.json` — any photos + `img/photos/full/` + `img/photos/thumbs/`
- `data/art.json` — more artworks
- `data/paranormal.json` — paranormal videos, articles, cases, etc.
- `data/soundboards/maxpayne.json`, `quake2.json`, `rlm.json` — clips when audio is ready

### Phase 5: Polish

- **Easter eggs** — paranormal-themed animation, page-specific Konami code surprises
- **Thumbnail auto-generation** — script to auto-generate thumbs from full-size images (photos + art)
- **Responsive testing** — verify 380px, 600px, 700px+ breakpoints on all pages

---

## Resolved Design Decisions

1. **Navigation:** Dropdown menu + dedicated "Explore" landing page (both)
2. **Trans Art page:** Fully public — no passphrase
3. **Soundboards:** Alan extracts audio; we build the structure
4. **Photo/Art galleries:** 25–50 images to start
5. **Paranormal page:** "Those That Matter to Me, Thus Far..." — personal, open-ended
6. **Homepage:** Minimal — Explore page is the hub
7. **Tasks page:** Security through obscurity — no nav links, direct URL only
8. **Icons:** Custom PNGs throughout (don't auto-recolor with themes, but visually consistent)
9. **Audio:** OGG served first (smaller), WAV/MP3 fallback; `<audio>` elements used instead of Web Audio API so iOS plays clips regardless of the silent/ringer switch (same media session as YouTube)
