# Alan's Brain — Build History

Chronological log of every phase and feature added. Append new sessions at the bottom.
See `Current State.md` for the living snapshot (what's here now, what's next).

---

## Phase 1: Foundation

**Commit:** `9dc4732` — *Phase 1: Add responsive nav, shared CSS components, and gallery.js*

- **Navigation overhaul** — Desktop: horizontal nav with "Explore" dropdown. Mobile (≤600px): hamburger with full-screen overlay, staggered fadeUp animations.
- **Shared CSS components** — `.page-hero`, `.media-grid`, `.media-card`, `.tag-pill`, `.filter-bar`, `.search-input`, `.audio-btn`, `.lightbox`, `.masonry-grid`, `.slideshow`
- **`gallery.js`** — `Lightbox()` (open/close/prev/next, keyboard + touch swipe) and `Slideshow()` (auto-cycling crossfade with progress bar, pause on hover)
- **`.gitignore`** — excludes local planning docs

---

## Phase 2: Content-Light Pages

**Commit:** `1bfe30b` — *Phase 2: Add tools, youtube, and photos pages with JSON data architecture*

All three pages follow JSON-driven pattern: thin HTML shell → fetch() JSON → render cards → filters on in-memory data.

| Page | Features | Data File |
|---|---|---|
| Great & Free (`tools.html`) | Tab toggle (Tools/Websites), live search, dropdown category filter | `data/tools.json`, `data/websites.json` |
| YouTube Channels (`youtube.html`) | Category filters, channel cards with profile image | `data/youtube.json` |
| Photo Gallery (`photos.html`) | Masonry grid (3→2→1 col), Lightbox integration, lazy loading | `data/photos.json` |

---

## Phase 3: Complex Pages

**Commit:** `c07590d` — *Phase 3: Add art gallery, soundboards, and UFO cases pages*

| Page | Features | Data File(s) |
|---|---|---|
| Art Gallery (`art.html`) | Hero slideshow (15s crossfade), thumbnail grid, Lightbox | `data/art.json` |
| Soundboards (`soundboards.html`) | Board selector, categorized clip grids, Web Audio API engine (max 2 concurrent, click-to-toggle), volume slider, Random, combo counter | `data/soundboards/index.json` + per-board JSON |
| UFO Cases (`ufo.html`) | Vertical timeline, evidence tags, conviction meter bars, expandable read more, sort/filter | `data/ufo-cases.json` *(page later replaced by paranormal.html)* |

**New JS:** `soundboards.js` — `SoundEngine` constructor (fetch→decode→play, buffer caching, gain node volume, max 2 concurrent, click-to-toggle, per-URL source tracking)

---

## Art Gallery Bug Fixes & Enhancements

**Commits:** `9126a02`, `b04b995`, `facff42`, `4525042`

- **Bug fix:** `Slideshow()` called `_showSlide()` and `_startAuto()` before they were defined as function expressions. Fixed by moving init calls to end of constructor.
- **Art content:** `data/art.json` — 2 entries (Sebastian Pether: "River Scene" 1826, "A Ruined Gothic Church beside a River by Moonlight" 1841)
- **Lightbox on art page:** Clicking slideshow image or thumbnail opens Lightbox
- **Year field:** Optional `"year"` in art.json; shown in slideshow overlay, lightbox caption, thumbnail tooltip
- **Cache-busting:** `art.html` loads `gallery.js?v=2`

---

## Great & Free Expansions

**Commits:** `e82b2a6`, `db09a9a`

- Total grown to 40 tools across 11 categories + 25 websites across 5 categories (incl. Indie Web)
- "Cool Websites" tab added — `data/websites.json` with 22+ entries (Atlas Obscura, Library of Babel, Neal.fun, etc.)
- Filter dropdown redesign: replaced horizontal pill rows with `.filter-dropdown` component across all pages

---

## YouTube Channels Page

**Commits:** `5c2136f`, `82f2dac`

- `data/youtube.json` — 114 channels across multiple categories
- Two-tab system: Channels / Videos toggle (`data/videos.json` for videos, empty but live)
- Channel cards with profile images (stored `img/youtube/`), descriptions, category pills, external links

---

## Half-Life Soundboard

**Commits:** `eb8503d`, `72248ab`, `1a9b31d`, `1514429`

- `data/soundboards/halflife.json` — 20 clips: 15 Scientists + 5 G-Man
- Audio files in `audio/halflife/` (.wav + .ogg per clip)

---

## Soundboard Admin Tools

**Commit:** `70d488b`

- `soundboard-admin.py` — CLI tool (add/remove clips, create boards, validate data)
- `soundboard-admin-gui.py` — GUI wrapper using tkinter

---

## Theme System (Phases 1–3)

**Commit:** `d411753`

**Architecture:** CSS custom property swap via `data-theme` attribute on `<html>`. Each theme is a standalone CSS file that overrides `:root` variables. Theme choice persists in `localStorage`.

| Component | Purpose |
|---|---|
| `theme-switcher.js` | Applies themes via `data-theme`, loads theme CSS on demand, persists to localStorage, Konami code easter egg |
| `themes/quake2.css` | 35+ CSS variable overrides to warm browns/golds from Q2 palette |
| Picker styles (in `style.css`) | Floating panel with open/close animation, active state highlighting |
| FODT prevention | Inline `<script>` in all HTML `<head>` blocks reads localStorage and sets `data-theme` before CSS paints |

**Themes:** `default` ("Deep Space"), `quake2` ("Quake II" — warm browns/golds)

---

## UFO → Paranormal Rework

**Commit:** `028e8cf` (partial)

- `ufo.html` replaced by `paranormal.html` — curated media grid for all paranormal content
- Category filters: UFOs, Ghosts, Cryptids, Psychic, Unexplained, Conspiracy, Ancient, Other
- Type filters: video, article, photo, writing, podcast, documentary, book, case
- `data/paranormal.json` — empty `[]`, ready for entries (supports title, type, category, description, url, image, conviction 0–10)
- Old timeline CSS kept (`.conviction-meter` still used by paranormal cards)

---

## Trans Art & Resources → Pride and Identity

**Commits:** `4bc02d3`, `028e8cf`, `f9eff06`, `0c2caff`

- `transart.html` — Art/Polyamory/Resources tab toggle, JSON-driven rendering
- Trans flag color accents: title gradient, pink tagline, decorative gradient bar, resource category heading borders
- Crisis resource banner (auto-pins `"crisis": true` entries at top of Resources tab)
- Renamed from "Trans Art & Resources" to "Pride and Identity" everywhere
- Polyamory tab added (`data/transart-polyamory.json`)

---

## Brain SVG CSS Variable Integration

- SVG gradient `stop-color` attributes and sparkle `fill` attributes changed from hardcoded hex to `var(--teal)`, `var(--blue)`, `var(--purple)`, `var(--pink)` — brain recolors correctly with any theme

---

## Homepage Explore Section Refresh

- "Projects" section renamed to "Explore" with 7 clickable cards (YouTube, Great & Free, Soundboards, Art Gallery, Pride and Identity, Paranormal, Photo Gallery)
- `.projects-grid` changed from flex column to responsive CSS grid

---

## Cross-Linking Footers

- "More from Alan's Brain" section on all 7 Explore pages, linking to 3 related pages each

---

## Custom PNG Icons — Emoji Replacement

**Commit:** `0c2caff`

All emoji icons replaced with hand-selected custom PNGs in `img/Icons/icons/`. Nav icons (24px), mobile nav (28px), page hero (72px), homepage cards (44px), cross-linking footers (28px).

| Location | Icon | Path |
|---|---|---|
| Alan's Brain logo | World creativity globe | `Alan's_Brain/world-creativity-and-innovation-day.png` |
| YouTube Channels | TV | `Youtube_Channels/tv.png` |
| Pride and Identity | Flag | `Pride_and_Identity/flag.png` |
| Soundboards | Speaker | `Audio_Related/speaker.png` |
| Great & Free | Internet Explorer | `Cool_Links/internet-explorer.png` |
| Photo Gallery | Camera | `Photo_Gallery/cam.png` |
| Art Gallery | Starry Night | `Art/starry-night.png` |
| Paranormal | Paranormal icon | `Paranormal/clairvoyance.png` |
| Explore section | Cloud | `Explore/cloud.png` |
| Footer | UFO | `UFO/ufo.png` |
| Soundboard empty state | No sound | `No_Sound/no-sound.png` |
| Theme picker | Color palette | `Theme/colors.png` |
| Grape-Nuts easter egg | Grape-Nuts logo | `Grapenuts/Grape_Nuts_No_BG.png` |

---

## Visit Counter Ticker (GoatCounter)

**Commit:** `5ff2f13`

- `visit-ticker.js` — fetches per-page view count from GoatCounter public JSON API, builds 6-digit odometer with staggered roll-in animation
- GoatCounter `count.js` script added to all 9 pages for privacy-friendly tracking
- Footer "No tracking. No ads." removed

---

## Soundboard Quotes — JSON Migration

**Commit:** `b22fbba`

- Rotating quotes moved from hardcoded JS object to `"quotes"` array in each board's JSON
- `updateQuote()` reads from `boardData[id].quotes` after board data is fetched
- Admin script updated with `add-quote`, `remove-quote`, and `--quote` flag on `add`

---

## Soundboard Enhancements

**Commit:** `0c2caff`, `e569d8b`, `f6fdd41`, `f0631c4`

- **Category images:** Per-board character images alongside category headers, organized in `img/Icons/Soundboards/{BoardName}/`
- **Playback rules:** Max 2 concurrent sounds; click-to-toggle stop; pending clips count toward limit; Stop All button removed
- **Clip progress bar:** `.clip-progress` animates left-to-right over clip duration; `SoundEngine.play()` signature changed to `play(url, onStart, onEnded)`
- **Board selector icons:** All boards use image paths in `index.json` instead of emoji

---

## Soundboard Icon Reorganization & New Board Scaffolding

- Icons moved from flat `img/Icons/Soundboards/` into per-board subfolders
- 3 new boards scaffolded: They Hunger, Quake 2, Red Letter Media — each has JSON, icons, and category image mappings
- RLM board maps category names to person images (Mike/Jay/Rich)

---

## Performance Audit & Image Optimization Pipeline

**Commit:** `bf96e58`

- **`optimize-media.py`** (later merged into `admin.py media`) — batch compression: art, youtube icons, UI icons, soundboard characters, audio WAV→OGG
- **CSS:** Dead timeline CSS removed (~130 lines), `prefers-reduced-motion` media query, `will-change` hints on animated elements
- **JS:** `defer` added to all external scripts, `DOMContentLoaded` wrappers on inline scripts
- **Responsive images:** `<picture>` elements with WebP sources for YouTube cards and art thumbnails; `webpSrc()` utility in `gallery.js`
- **CLS fixes:** `width`/`height` attributes on all static `<img>` tags
- **Audio:** `SoundEngine.load()` tries `.ogg` first, falls back to `.wav`

---

## Random Cycling Category Icons, Grape-Nuts Easter Egg, Button & Scroll Fixes

**Commit:** `f1cae8c`

1. **Random cycling icons:** `CATEGORY_IMAGES_RAW` supports arrays — `pickWeighted()` with sessionStorage anti-repeat. Currently cycling: Half-Life Scientists (3 variants), They Hunger default (2 variants).
2. **Grape-Nuts easter egg:** Footer Grape-Nuts icon links to grapenuts.com/our-story/. Hover scales 4.4× on desktop; tap-to-pop then tap-to-navigate on mobile.
3. **Button deselect fix:** Playing clip stopped but retained visual highlight. Fixed with `classList.remove('playing')` + `btn.blur()`. Added `.audio-btn:focus:not(.playing)` CSS rule.
4. **Scroll arrow fix:** Wrapped hover styles in `@media (hover: hover)`, added `touch-action: manipulation`.

---

## Soundboard Persistence & Icon Scaling

**Commits:** `a07270e`, `d165f9f`

- Selected board saves to `localStorage('ab_soundboard')`, restored on page load
- `.sb-category-img` changed from `object-fit: contain` to `object-fit: cover; object-position: top center` — crops to show head/upper body

---

## Icon Config to Board JSON, Admin Enhancements, Weighted Quotes

**Commit:** `9c67eed`

1. **Icons moved to JSON:** `CATEGORY_IMAGES_RAW` removed from HTML; each board's JSON now has an `"icons"` field. `resolveIcons()` reads it at runtime.
2. **`add-icon` / `remove-icon` admin commands:** Copy image into board's icon folder and add to JSON; auto-converts string→array when second image added.
3. **Interactive quote prompts:** `add` and `bulk` commands now prompt after adding clips.
4. **Weighted quote rotation:** `updateQuote()` uses `pickWeighted()` with sessionStorage anti-repeat.
5. **`maxpayne.json` created:** Empty board with default icon entry.

---

## Unified Admin Script

**Commit:** `f3cd989`

- `soundboard-admin.py`, `soundboard-admin-gui.py`, `optimize-media.py` consolidated into `admin.py` (CLI) and `admin-gui.py` (Tkinter GUI)
- GUI: sidebar nav, Soundboards panel (full board/category/clip management), Media panel (optimization commands with live log output)
- Extensible: add new CLI groups in `GROUPS` dict; new GUI panels by subclassing with `LABEL` attribute

---

## Admin GUI Enhancements — Playback, Subtitles, File Rename

**Commits:** `70ade45`, `0b3789f`, `8f43077`, `b31de76`

1. **▶ Play button per clip:** Tries pygame → ffplay → os.startfile. Status bar shows "Playing: {label}".
2. **Subtitles section:** Appears below clips for selected board. Add/edit (double-click)/delete individual quotes.
3. **File rename:** Updates file on disk + all JSON references. Auto-updates label if it matched old filename; prompts if manually customized.
4. **Label editing:** Visible "edit" link + double-click label. Single-click edit via dialog.
5. **Remove with file deletion:** Yes/No/Cancel dialog — Yes deletes file from disk + JSON, No removes from JSON only.

---

## They Hunger Clips Added

**Commit:** `6046b4e`

- `data/soundboards/theyhunger.json` — 7 clips across Monsters + Chester Rockwood categories
- Audio files in `audio/theyhunger/`

---

## iOS Ringer Fix, Admin Category Icons, Mobile 2-Column Grid

**Commit:** `d553318`

1. **iOS audio fix (`soundboards.js`):** `SoundEngine._init()` plays a silent WAV `<audio playsinline>` element within the user gesture, promoting iOS audio session from "ringer" to "playback" category — clips now play with iPhone silent switch off.
2. **Admin GUI per-category icons (`admin-gui.py`):** "Rotating Images" section added to clips panel per category. `+ Add Image` opens file picker, adds relative path to `data.icons[categoryName]`. JSON stored as string (single) or array (multiple), matching Half-Life convention.
3. **Mobile clip grid (`style.css`, `soundboards.html`):** `.audio-btn` now wraps text (`overflow-wrap: break-word`) instead of truncating. New `.sb-clip-grid` class: auto-fill on desktop, 2 columns on mobile (≤600px).

---

## File Structure Cleanup

**Commit:** `bdf8f0e`

- `__pycache__/` and `*.pyc` added to `.gitignore`; `__pycache__/admin-gui.cpython-313.pyc` untracked from git
- Ghost directory `./C:Users505maDocumentsGitHubalans-brain/` deleted (created by path resolution bug)
- `data/ufo-cases.json` deleted — orphaned after UFO page replaced by paranormal.html
- `img/Icons/icons/Photo_Gallery/old-camera-.png/.webp` deleted — typo filename, unused
- `img/Icons/icons/Photo_Gallery/old-camera.png/.webp` deleted — unused (cam.png used everywhere)
- `audio/halflife/misc_02.*`, `misc_03.*`, `misc_04.*`, `rise_shine.*` deleted — not referenced in halflife.json (8 files removed)
- `Build History.md` added to `.gitignore`
- `Current State.md` restructured: split into lean snapshot + this history file

---

## iOS Silent Switch Fix — Web Audio → HTML Audio

**Commit:** `7cbb598`

The `SoundEngine` in `soundboards.js` was rewritten from Web Audio API (`AudioContext`) to HTML `<audio>` elements.

**Root cause:** `AudioContext` on iOS is routed through the "ambient" audio session, which the silent/ringer switch controls. HTML `<audio>` elements are routed through the "media playback" session — the same one used by YouTube, Spotify, and all native media apps — which bypasses the silent switch entirely. The earlier fix (playing a zero-length silent WAV to "unlock" the session) was insufficient; iOS did not promote the session for a zero-duration clip.

**What changed:**
- `SoundEngine` no longer creates an `AudioContext`, `GainNode`, or buffer cache. No more `decodeAudioData`.
- `play(url, onStart, onEnded)` creates a `<audio playsinline>` element per clip, sets volume directly, adds it to `self.active{}` immediately (so `playingCount()` is accurate before playback starts), and calls `audio.play()`.
- OGG-first / WAV fallback preserved: tries `.ogg` extension; on `play()` rejection switches to original URL.
- `stop()`, `stopAll()`, `isPlaying()`, `setVolume()`, `playingCount()` all behave identically to before.
- Samsung Galaxy (Android) was already working without any fix — Android routes `AudioContext` through the media session by default.

---

## Soundboard Progress Bar & Stop-Button Glow Fixes

**Commit:** `686eb82`

Two visual bugs introduced when switching to `<audio>` elements, now resolved.

**Progress bar not animating:**
- `onStart(duration)` was triggered by the `play` event on the audio element.
- At the moment `play` fires, `audio.duration` is often still `NaN` — the browser hasn't loaded file metadata yet.
- `isFinite(NaN)` returns `false`, so `onStart(0)` was called. The guard `if (duration > 0)` then silently skipped the CSS width animation every time.
- Fix: moved `onStart` to the `loadedmetadata` event, which the browser only fires after duration is known. `{ once: true }` preserved.

**Green glow persisting after stopping a clip:**
- `.audio-btn` had `transition: all 0.15s`. While `.playing` was active, `animation: audioPulse` was overriding `box-shadow` each frame.
- When `.playing` was removed mid-animation, the animation halted and `box-shadow` froze at whatever glow intensity the keyframe was at. `transition: all` then tried to animate FROM that frozen mid-pulse value to `none` — over 150ms — leaving a lingering green outline.
- Fix: replaced `transition: all 0.15s` with explicit properties (`background`, `border-color`, `box-shadow`, `transform`). `box-shadow` now drops cleanly the instant the class is removed.
- Additional hardening: `outline: none` on base `.audio-btn`; `:focus` and `:focus-visible` both reset; `-webkit-tap-highlight-color: transparent` eliminates iOS/Android tap residue.
- Stop handler now also resets `.clip-progress` width immediately (no transition) so next play always starts from zero.

---

## Rotating Board Selector Icons, Icon Crop, Clip Fade-Out

**Commits:** `6baea93`, `638f2f5`, `8b8d2b1`

1. **Rotating board selector icons:** `index.json` `"icon"` (string) replaced with `"icons"` (array) for all boards. `renderBoardSelector()` uses `pickWeighted()` + sessionStorage anti-repeat — same pattern as category icons. Multi-character boards (Half-Life, They Hunger, RLM) rotate; single-character boards (Max Payne, Quake 2) keep a 1-item array.
2. **Board selector icon size:** `24px` inline style replaced with `.sb-board-icon` CSS class (`height: 44px`, `object-fit: contain`). `.sb-board-btn` gets `inline-flex + gap`.
3. **Clip glow fade-out:** `box-shadow` transition extended from `0.15s` to `0.6s ease-out` — teal pulse visibly dissolves on natural clip end instead of snapping off.
4. **Green border linger fix (`638f2f5`):** `.audio-btn.playing` was setting both `border-color: var(--teal)` and `box-shadow`. Box-shadow faded over `0.6s` but `border-color` only transitioned at `0.15s`, leaving a visible green outline after the glow dissolved. Fix: removed `border-color` from `.audio-btn.playing` entirely — the `box-shadow` ring is the sole visual indicator and fades cleanly.
5. **Board icon crop (`8b8d2b1`):** `.sb-board-icon` now matches `.sb-category-img` — `object-fit: cover + object-position: top center + border-radius: 6px`. Characters are cropped to head/upper-body at consistent size instead of "contain" (variable apparent size).

---

## Max Payne Soundboard + Half-Life G-Man Additions

**Commit:** `2882bb8`

- **Max Payne "Goons" category:** 6 clips added (`death_01–03`, `death_06`, `death_08`, `wack_the_sucker.wav`) in `audio/maxpayne/`
- **Half-Life G-Man:** 5 additional clips added; rotating category images added for G-Man and Scientists
- **index.json:** Max Payne entry updated

---

## Admin GUI Image Ingestion Fix

**Commit:** *(today)*

- **Bug:** `_on_add_icon` was saving `os.path.relpath()` of any selected file — files picked from outside the project (e.g. `Downloads/`) ended up as `../../../Downloads/...` paths in JSON, which broke on the web server.
- **Fix:** `_on_add_icon` now detects when the selected path resolves outside the project (`rel.startswith("..")`) and auto-copies the file into `img/Icons/Soundboards/{BoardId}/` before saving the path. Images are always ingested into the repo.
- **Data cleanup:** Removed the stale `../../../Downloads/` paths from `maxpayne.json` (Goons icons) and `halflife.json` (G-Man icons). Working images (existing in-repo paths) preserved.

---

## Per-Clip Icon Support

**Commit:** `87c8220`

Clips in general categories (like "Monsters") can now have an individual `"icon"` field. Clicking a clip with an assigned icon swaps its category header image to that clip's icon, showing who the clip comes from. The existing page-refresh rotation logic is unchanged.

**What changed:**
- **Data model:** Clips accept an optional `"icon"` field (relative image path)
- **Frontend (`soundboards.html`):** `renderClips()` emits `data-clip-icon` attribute on buttons; click handler finds the parent `.sb-category-header` and swaps the `<img>` src
- **Admin GUI (`admin-gui.py`):** Each clip row shows "Set Icon" or "Clear Icon" button. Clips with icons display a 🖼 indicator (hover shows filename). File picker starts in `img/Icons/Soundboards/` and auto-copies external files into the project.

---

## Backdate Task Completions

**Commit:** *(current)*

Added the ability to backdate task completions — for when you did a task yesterday but are marking it today.

**What changed:**

- **Drawer UI (`tasks.html`, `style.css`):** New "When?" section between person picker and PIN field. Two toggle buttons: "Just now" (default) and "Earlier…". Tapping "Earlier…" reveals a date + time picker row (date defaults to yesterday, time to 12:00). Styled to match existing drawer components (`--bg-deep`, `--border`, `--teal` focus ring).
- **Frontend logic (`tasks.js`):** When toggle wired up in `initTaskTracker()`. `openDrawer()` resets the toggle and pre-fills yesterday's date each time. `submitDrawer()` reads the backdate value and passes `completedAt` (ISO string) to `markTaskDone()`. The payload only includes `completedAt` when "Earlier…" is selected and a date is set.
- **Backend (`code.gs` — updated separately on desktop):** `doPost` and new `markTaskDone()` server function both accept optional `completedAt`. If provided and valid, uses that timestamp for Last Completed, Next Due calculation, and the Log entry. Invalid dates fall back to `new Date()`.

---

## Task Tracker: Area Filtering, Progress Fade, Day Granularity

**Commits:** `e7dbcc4`, `fb92e9e`

Three enhancements to the household task tracker page:

**1. Area filtering:**
- Dropdown `<select>` (replacing an earlier pill-row design) lets you scope the task list to a single room — Kitchen, Basement, Dining Room, Downstairs Bathroom, etc.
- Dynamically populated from the API data categories on each render. Works independently of and stacks with the status filter (All / Overdue / Due Soon / On Track / Not Started).

**2. Progress fade toggle:**
- "Fade" toggle switch adds a colored horizontal fill to each task card, proportional to how far through its cycle the task is (0% = just completed, 100% = due now).
- Color matches status: green (on track), yellow (due soon), red (overdue). Overdue tasks always show 100% fill.
- "Drain" sub-toggle (appears when fade is on) reverses the direction — starts full and empties like a gauge as the task approaches due.
- Both preferences persist in `localStorage` (`t_fade`, `t_fade_reverse`).
- Implemented as an absolutely-positioned `.t-card-fade` overlay div inside each card with a `linear-gradient` background using 8-digit hex colors for alpha transparency.

**3. Day-only granularity:**
- "Due soon" badge changed from `{hoursLeft}h left` to `{days}d left` (minimum 1 day).
- All time displays now operate in days only — consistent across overdue, due-soon, and on-track statuses.

**What changed:**
- **`tasks.html`:** Replaced area filter pill row + view options with a single compact row: area `<select>` dropdown + fade/drain toggle switches.
- **`tasks.js`:** Added `currentArea`, `fadeEnabled`, `fadeReverse` state variables. Area dropdown `change` listener. Fade/reverse toggle listeners with localStorage persistence. `renderTasks()` dynamically builds `<option>` elements, applies area filter, computes per-card fill percentages, and inserts `.t-card-fade` overlay divs. Badge text switched to day math.
- **`style.css`:** Added `.t-view-options` flex row, `.t-area-select` styled native dropdown (custom arrow SVG, dark theme), `.t-toggle-label` / `.t-toggle-switch` iOS-style toggle, `.t-card-fade` absolute overlay.

---

## Git History

| Commit | Description |
|---|---|
| `9dc4732` | Phase 1: Add responsive nav, shared CSS components, and gallery.js |
| `1bfe30b` | Phase 2: Add tools, youtube, and photos pages with JSON data architecture |
| `c07590d` | Phase 3: Add art gallery, soundboards, and UFO cases pages |
| `ff0ea64` | Add Current State.md to gitignore |
| `6f774c3` | Remove tasks page links from public navigation for security through obscurity |
| `75c64b5` | Added source photos |
| `9126a02` | Fix Slideshow constructor calling methods before they are defined |
| `b04b995` | Add second artwork to art gallery JSON |
| `facff42` | Add fullscreen lightbox on art gallery image click |
| `4525042` | Add year field to art gallery display |
| `e82b2a6` | Add 15 tools to Great & Free section and update tagline |
| `db09a9a` | Add 20 tools, 18 websites tab, and redesign filter dropdown across all pages |
| `8a1748d` | Fix filter dropdown rendering behind content cards |
| `a2549e5` | Improve tools page: sort, scroll nav, favicons, mobile layout fix |
| `eef51c9` | Fix filter dropdown z-index by removing stacking contexts on cards |
| `da6471d` | Fix filter dropdown z-index: move stacking context from cards to grid |
| `547fa1a` | Fix filter dropdown hidden behind cards: animation stacking context |
| `5c2136f` | Build YouTube channels page with 114 channels and two-tab system |
| `82f2dac` | Add channel profile pictures to YouTube page |
| `eb8503d` | Add Half-Life soundboard with 7 scientist clips |
| `72248ab` | Added more sounds to half-life board |
| `1a9b31d` | Fix JSON syntax errors in Half-Life soundboard data |
| `70d488b` | Add soundboard admin tools (CLI + GUI) for easier board management |
| `1514429` | Added more sounds to G-Man |
| `d411753` | Add theme system with Quake II skin and picker UI |
| `4bc02d3` | Add Trans Art & Resources shell page |
| `028e8cf` | Rework UFO→Paranormal, trans flag accents, Brain SVG CSS vars, homepage Explore refresh |
| `84eeee0` | Add cross-linking footers, new tools/websites |
| `f9eff06` | Clean up homepage cards, add Polyamory tab to Trans Art page |
| `0c2caff` | Replace emoji icons with custom PNGs, rename Trans Art to Pride and Identity, soundboard enhancements |
| `9ccaaba` | Update icons: new galaxy Explore icon, refreshed Paranormal icon, adjust icon sizes |
| `6a7f75d` | Add polyamory heart icon to empty state, update UFO attribution |
| `dc9e5fc` | Update UFO icon with new design |
| `9c2ea14` | Replace remaining emoji icons with custom PNGs |
| `52b4f77` | Icon refresh: new Explore cloud, eye empty state, construction badge, search icon, updated no-sound |
| *(merge)* | Merge `claude/homepage-layout-updates-UslXV`: remove Links nav, move Cool Links to websites.json |
| `5ff2f13` | Add visit counter ticker with GoatCounter integration |
| `b22fbba` | Enlarge search icons, add quote management to soundboard admin and JSON |
| `7df4010` | Fix visit ticker to use GoatCounter TOTAL counter endpoint |
| `e569d8b` | Limit soundboard to 2 concurrent sounds, add click-to-toggle stop |
| `f6fdd41` | Fix race condition in soundboard concurrent playback limit |
| `f0631c4` | Remove Stop All button, enlarge board selector icons to 24px |
| `bf96e58` | Performance audit: image optimization pipeline, WebP/OGG generation, defer scripts, reduced-motion |
| `8efbfab` | Fix stretched art thumbnails on mobile by removing fixed dimensions |
| `f1cae8c` | Random category icons, Grape-Nuts footer easter egg, fix button deselect and scroll arrows |
| `a07270e` | Grape-Nuts hover pop, fix They Hunger board icon, persist selected soundboard |
| `68676b2` | Increase Grape-Nuts hover pop to 4.4x, add mobile active state |
| `d165f9f` | Soundboard icon cover-crop, Grape-Nuts mobile scroll growth, weighted image rotation |
| `0ead5f6` | Grape-Nuts mobile: tap-to-pop then tap-to-navigate replaces scroll growth |
| `9c67eed` | Move icon config to board JSON, add-icon admin command, weighted quotes, interactive prompts |
| `f3cd989` | Unified admin script: merge soundboard, media, and icon management under extensible CLI + GUI |
| `70ade45` | Fix admin GUI crash: move tuple padding from Frame constructor to pack() |
| `0b3789f` | Add audio playback, subtitle editor, and file rename to admin GUI |
| `8f43077` | Auto-update clip label when file is renamed in admin GUI |
| `b31de76` | Fix remove to delete audio file from disk, add visible label edit button |
| `6046b4e` | Updated they hunger clips |
| `d553318` | iOS ringer fix, admin category icons, soundboard mobile 2-col layout |
| `bdf8f0e` | File structure cleanup, gitignore fix, doc restructure |
| `7cbb598` | Replace Web Audio API with <audio> elements for iOS silent switch fix |
| `686eb82` | Fix progress bar and stop-button outline on soundboard |
| `6baea93` | Rotating board selector icons, larger icon size, clip fade-out on end |
| `638f2f5` | Fix lingering green border after clip ends on soundboard |
| `8b8d2b1` | Match board selector icon crop to category image style |
| `2882bb8` | Added new sounds and rotating images to Max Payne and Half-Life soundboards |
| `87c8220` | Add per-clip icon support to swap category header on click |
| `95f2bbd` | Support passphrase via URL parameter for quick access |
| `bb3df61` | Merge all person sources so Cassie and Zion always appear in picker |
| `5bb0e77` | Add backdate option to task completion drawer |
| `72b3da7` | Add README |
| `e7dbcc4` | Add area filtering, progress fade toggle, and day-only granularity to tasks |
| `fb92e9e` | Replace area filter pills with compact dropdown select |
