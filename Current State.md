# Alan's Brain — Current State

**Last Updated:** March 26, 2026
**Status:** Phases 1–3 complete, tasks link removal done, art gallery bug fixes & enhancements done, Great & Free expanded to 38 tools + 18 websites with tab toggle, filter dropdown redesign across all pages, YouTube channels page built (114 channels), Half-Life soundboard populated (20 clips), soundboard admin tools added, **theme system implemented (Phases 1–3: switcher engine + Quake II color theme + picker UI)**, **UFO page reworked into Paranormal page**, **trans flag accents added to Trans Art page**, **Brain SVG CSS variable integration done**, **homepage Explore section refreshed with 7 page cards**, **cross-linking footers added to all Explore pages**, **Great & Free expanded to 40 tools + 22 websites**, **homepage cards cleaned up (no subtitles/tags)**, **Polyamory tab added to Pride and Identity page**, **all emoji icons replaced with custom PNG icons**, **Pride and Identity renamed to Pride and Identity**, **soundboard enhancements (category images, clip progress bar, rotating quotes)**, **Paranormal subtitle updated**, **icon refresh: new Explore cloud, eye empty state, construction badge, search icon, updated no-sound icon**, **Links nav removed, Cool Links section moved to websites.json, homepage description updated, soundboard category images/quote enlarged**, **visit counter ticker added (GoatCounter)**, **footer "No tracking. No ads." removed**, **search icons enlarged**, **soundboard quotes moved to board JSON + admin script quote management**, **soundboard icons reorganized into per-board subfolders, They Hunger/Quake 2/RLM boards scaffolded with icons + JSON**, **performance audit & image optimization pipeline (optimize-media.py, WebP generation, OGG audio, defer scripts, reduced-motion, dead CSS cleanup, CLS fixes)**, **random cycling category icons for soundboards, Grape-Nuts footer easter egg, button deselect fix, scroll arrow fix**, **Grape-Nuts hover pop, They Hunger board icon fix, soundboard selection persists across refresh**, **soundboard icon cover-crop scaling, Grape-Nuts mobile scroll growth, weighted image rotation to reduce repeats**, Phases 4–5 remaining

-----

## What's Been Built

### Phase 1: Foundation (Complete)

**Commit:** `9dc4732` — *Phase 1: Add responsive nav, shared CSS components, and gallery.js*

- **Navigation overhaul** across `index.html` and `tasks.html`
  - Desktop: horizontal nav with "Explore" dropdown (7 page links with emoji icons, click/click-outside toggle, ARIA attributes)
  - Mobile (≤600px): hamburger button (3-line → X animation) with full-screen overlay, staggered fadeUp animations, "Explore" section label
  - Structure: Home | Explore ▾ | Links (Tasks link removed — security through obscurity)
- **Shared CSS components** added to `style.css` (all used by Phase 2/3 pages):
  - `.page-hero` — compact per-page hero (icon, gradient title, Caveat tagline)
  - `.media-grid` / `.media-card` — responsive card grid with hover lift + glow
  - `.tag-pill` — category filter pills with active state
  - `.filter-bar` — horizontal scrolling filter container
  - `.search-input` / `.search-wrap` — styled search with icon
  - `.audio-btn` — soundboard button with `.playing` pulse animation
  - `.lightbox` — full-screen image overlay with nav arrows, close button
  - `.masonry-grid` — CSS columns gallery (3→2→1 responsive)
  - `.slideshow` — hero slideshow with crossfade, progress bar, nav arrows
- **`gallery.js`** — two reusable constructors:
  - `Lightbox()` — open/close/prev/next, keyboard + touch swipe, backdrop click to close
  - `Slideshow()` — auto-cycling crossfade with progress bar, pause on hover, image preloading
- **`.gitignore`** — excludes local planning docs from repo

### Phase 2: Content-Light Pages (Complete)

**Commit:** `1bfe30b` — *Phase 2: Add tools, youtube, and photos pages with JSON data architecture*

All three pages follow the JSON-driven pattern: thin HTML shell → `fetch()` JSON → render cards → filters operate on in-memory data. Adding content = editing a JSON file.

| Page | File | Features | Data File |
|---|---|---|---|
| Great & Free | `tools.html` | Tab toggle (Tools & Apps / Cool Websites), live search, dropdown category filter, card list with emoji, name, description, category pill, external link. Tagline: "these won't even make a dent" | `data/tools.json` — 38 entries across 11 categories; `data/websites.json` — 22 entries across 4 categories |
| YouTube Channels | `youtube.html` | Category filters, channel cards (profile image, name, description, exemplar video thumbnail), graceful empty state | `data/youtube.json` — empty, ready to fill |
| Photo Gallery | `photos.html` | Masonry grid (3→2→1 col responsive), Lightbox integration from `gallery.js`, category filters, lazy loading | `data/photos.json` — empty, ready to fill |

### Phase 3: Complex Pages (Complete)

**Commit:** `c07590d` — *Phase 3: Add art gallery, soundboards, and UFO cases pages*

| Page | File(s) | Features | Data File(s) |
|---|---|---|---|
| Art Gallery | `art.html` | Hero slideshow (15s auto-crossfade, progress bar, pause-on-hover, prev/next). Thumbnail grid syncs with slideshow — click thumb to jump. Uses `gallery.js` | `data/art.json` — empty, ready to fill |
| Soundboards | `soundboards.html` + `soundboards.js` | Board selector (5 boards, 24px character icons), categorized clip grids, Web Audio API engine (max 2 concurrent, click-to-toggle), volume slider, Random, combo counter | `data/soundboards/index.json` — manifest with 5 boards (They Hunger, Half-Life, Max Payne, Quake 2, RLM). Half-Life: 20 clips, others: 0 clips but JSON + icons ready |
| UFO Cases | `ufo.html` | Vertical timeline (teal gradient line + date markers), evidence tags, conviction meter bars (x/10), expandable "Read more", source links. Sort by date/conviction, filter by evidence type | `data/ufo-cases.json` — empty, ready to fill |

**New CSS added:** Full timeline component system (`.timeline`, `.timeline-item`, `.timeline-card`, `.timeline-marker`, `.evidence-tag`, `.conviction-meter`, etc.)

**New JS added:** `soundboards.js` — Web Audio API engine (fetch→decode→play, buffer caching, gain node volume control, max 2 concurrent sounds, click-to-toggle stop, per-URL source tracking)

### Post-Phase 3: Art Gallery Bug Fixes & Enhancements

**Commits:** `9126a02`, `b04b995`, `facff42`, `4525042`

**Bug fix — `gallery.js` Slideshow constructor:**
The `Slideshow()` constructor called `self._showSlide()` and `self._startAuto()` before those methods were defined as function expressions. JavaScript doesn't hoist function expressions, so this threw a runtime error that silently broke the art page (the `.catch()` handler showed "Failed to load artwork"). Fix: moved the two init calls to the end of the constructor, after all method definitions.

**Art content populated:**
- `data/art.json` — 2 entries added (both by Sebastian Pether: "River Scene" 1826, "A Ruined Gothic Church beside a River by Moonlight" 1841)
- Images placed in `img/art/full/` and `img/art/thumbs/`

**Lightbox integration added to art page:**
- Clicking the slideshow image opens the full-screen Lightbox (was previously unused despite being instantiated)
- Clicking thumbnails in the grid now opens the Lightbox instead of jumping the slideshow
- Caption format: "Title — Artist (Year)"
- Added `cursor: pointer` to slideshow images for discoverability

**Year field added:**
- `data/art.json` schema now supports optional `"year"` field
- Slideshow overlay shows year on its own line below artist
- Lightbox caption includes year in parentheses
- Thumbnail tooltip includes year
- CSS styling added for `.slide-year` element
- Field is optional — omitting it simply hides the year line

**Cache-busting:** `art.html` now loads `gallery.js?v=2` to ensure browsers pick up the constructor fix.

### Post-Phase 3: Great & Free Expansion

**Commit:** `e82b2a6` — *Add 15 tools to Great & Free section and update tagline*

**Tagline updated:** Changed from "tools that don't cost a dime or your soul" to "these won't even make a dent"

**15 new tools added** to `data/tools.json`, bringing the total to 18 entries across 8 categories:

| Category | Tools |
|---|---|
| Design | Draw.io |
| Utilities | P2R3 Convert, Down for Everyone or Just Me, TeraCopy, BCUninstaller, Everything |
| Security | Have I Been Pwned |
| Productivity | Espanso, Microsoft PowerToys |
| Media | OBS Studio, Kdenlive, Audacity, FFmpeg, VLC |
| Networking | ZeroTier |
| Creative | Blender |
| Game Dev | Godot Engine, TrenchBroom |

Category filter buttons auto-generate from the data, so all 8 categories now appear as filter pills on the page.

### Post-Phase 3: Great & Free — Second Expansion + Websites Tab + Filter Redesign

**19 more tools added** to `data/tools.json`, bringing the total to 38 entries across 11 categories. New tools: PeaZip, LocalSend, LibreOffice, Notepad++, qBittorrent, Zen Browser, Krita, ImageMagick, Upscayl, yt-dlp, Jellyfin, HandBrake, Obsidian, Stirling PDF, Pi-hole, Bitwarden, RustDesk, balenaEtcher, Anki, Stellarium. New categories added: Internet, Education.

**"Cool Websites" tab added** — `data/websites.json` created with 22 entries across 4 categories (Exploration, Fun & Games, Knowledge, Outdoors & Maps). Tab toggle on `tools.html` switches between "Tools & Apps" and "Cool Websites". Sites include: Atlas Obscura, Library of Babel, Neal.fun, UpToDate, TalkSmi, Information is Beautiful, Today is Gay, MapChart, Scratch, Flightradar24, Wayback Machine, Scale of the Universe, Monkeytype, AllTrails, Komoot, Pointer Pointer, Neato Studio, Xikipedia.

**Page tagline updated** to "these won't even make a dent".

**Filter dropdown redesign** — Replaced the horizontal wrapping `.filter-bar` pill row with a new `.filter-dropdown` component across all pages:
- **tools.html** — "Category: All ▼" dropdown with 11 category pills
- **youtube.html** — "Category: All ▼" dropdown (hidden if ≤1 category)
- **photos.html** — "Category: All ▼" dropdown (hidden if ≤1 category)
- **ufo.html** — Split into two dropdowns: "Sort: By Date ▼" and "Evidence: All ▼"
- **soundboards.html** — "Board: They Hunger ▼" dropdown for board selection

New CSS: `.filter-dropdown`, `.filter-dropdown-btn`, `.filter-dropdown-panel`, `.filter-arrow`, `.filter-active-label` with open/close animation, click-outside-to-close, mobile responsive (full-width panel on ≤600px).

### Post-Phase 3: Tasks Link Removal

**Commit:** `6f774c3` — *Remove tasks page links from public navigation for security through obscurity*

**Decision:** Remove all `<a href="tasks.html">Tasks</a>` links from public navigation across all 7 pages (index, tools, youtube, photos, art, soundboards, ufo). The tasks page itself retains its own self-links. This is "security through obscurity" — the page still exists and works, but there's no public way to discover it. Users must know the URL directly.

**Files modified:** `index.html`, `tools.html`, `youtube.html`, `photos.html`, `art.html`, `soundboards.html`, `ufo.html` — two links removed per file (desktop nav + mobile overlay).

### Post-Phase 3: YouTube Channels Page

**Commit:** `5c2136f` — *Build YouTube channels page with 114 channels and two-tab system*
**Commit:** `82f2dac` — *Add channel profile pictures to YouTube page*

- `data/youtube.json` — 114 channels across multiple categories (Gaming, Music, Tech, News & Society, etc.)
- Two-tab system: Channels / Videos toggle
- Channel cards with profile images, descriptions, category pills, external links
- Profile pictures stored in `img/youtube/`

### Post-Phase 3: Tools Page Improvements

**Commits:** `db09a9a`, `8a1748d`, `eef51c9`, `da6471d`, `547fa1a`, `a2549e5`

- Filter dropdown z-index fixes (multiple iterations to resolve stacking context issues)
- Sort buttons, scroll nav, favicon display, mobile layout improvements
- 20 additional tools and 18 websites added with tab toggle

### Post-Phase 3: Half-Life Soundboard

**Commits:** `eb8503d`, `72248ab`, `1a9b31d`, `1514429`

- `data/soundboards/halflife.json` — 20 clips across categories (Scientists, G-Man)
- Audio files stored in `audio/halflife/`
- Fixed JSON syntax errors in soundboard data

### Post-Phase 3: Soundboard Admin Tools

**Commit:** `70d488b` — *Add soundboard admin tools (CLI + GUI) for easier board management*

- `soundboard-admin.py` — CLI tool for managing soundboard JSON data (add/remove clips, create boards, validate data)
- `soundboard-admin-gui.py` — GUI wrapper using tkinter for visual soundboard management

### Theme System (Phases 1–3)

**Architecture:** CSS custom property swap via `data-theme` attribute on `<html>`. Each theme is a standalone CSS file that overrides `:root` variables. Theme choice persists in `localStorage`. No build step, no dependencies.

**What was built:**

| Component | File | Purpose |
|---|---|---|
| Theme engine | `theme-switcher.js` | Core switcher: applies themes via `data-theme` attribute, loads theme CSS on demand, persists to `localStorage`, builds picker UI in footer, Konami code easter egg (↑↑↓↓←→←→BA opens picker) |
| Quake II theme | `themes/quake2.css` | Color-only variable overrides: all 35+ CSS variables swapped to warm browns (#1a1008–#3a2a16), golds (#c8a84e), olives (#7a8a6a) from Q2 palette. Gradient text, ambient blobs, nav, and auth gate recolored. |
| Texture directory | `themes/textures/quake2/` | Empty — ready for Phase 4 texture assets |
| Picker styles | `style.css` (appended) | `.theme-picker-wrap`, `.theme-trigger`, `.theme-picker`, `.theme-option` — floating panel with open/close animation, active state highlighting |
| FODT prevention | All 8 HTML `<head>` blocks | Inline `<script>` that reads `localStorage` and sets `data-theme` before CSS paints, preventing flash of default theme |
| Script inclusion | All 8 HTML `</body>` blocks | `<script src="theme-switcher.js">` loads the engine on every page |

**How it works:**
1. On page load, inline `<head>` script reads `localStorage('ab_theme')` and sets `data-theme` attribute immediately (before CSS evaluates)
2. `theme-switcher.js` loads, calls `initTheme()` which applies the saved theme (loads the theme CSS file via `<link>`)
3. On `DOMContentLoaded`, `buildThemePicker()` injects the picker UI into the footer
4. User clicks paint palette button → picker opens → clicking a theme calls `setTheme(name)` → attribute swaps, CSS file loads, localStorage saves

**Picker UI:** Paint palette button in footer of every page. Opens a floating panel with "CHOOSE YOUR SKIN" heading and theme option buttons. Active theme highlighted with teal glow. Also openable via Konami code on desktop.

**Themes registered:**
- `default` — "Deep Space" (current cool-toned aesthetic, no extra CSS needed)
- `quake2` — "Quake II" (warm browns/golds, loads `themes/quake2.css`)

**What's next for the theme system:**
- **Phase 4:** Quake 2 textures (tiled game textures on cards/nav/surfaces), beveled UI chrome (2px borders, inset shadows), pixel font (`Press Start 2P`), scanline overlay, CRT effects
- **Phase 5:** Additional themes (PS1, Doom) — each is just a CSS file + texture folder
- **Known items:** `tasks.js` has hardcoded `CATEGORY_COLORS`/`PERSON_COLORS` hex values

### UFO → Paranormal Page Rework

**What changed:** The UFO Cases page (`ufo.html`) was renamed and reworked into a broader Paranormal page (`paranormal.html`). Instead of a vertical timeline focused solely on UFO cases, the page is now a curated media grid for all things paranormal — videos, articles, photos, writing, podcasts, documentaries, books, and case files.

**Files created:**
- `paranormal.html` — New page with media-grid layout, Category filter (UFOs, Ghosts, Cryptids, Psychic, Unexplained, Conspiracy, Ancient, Other) and Type filter (video, article, photo, writing, podcast, documentary, book, case). Retains the original title "Those That Matter to Me, Thus Far..." and tagline "the ones that make you go hmm". Uses `👁️` icon.
- `data/paranormal.json` — Empty `[]`, ready for entries. Each entry supports: `title`, `type`, `category`, `description`, `url`, `image`, `conviction` (optional 0–10 meter).

**Files deleted:**
- `ufo.html` — Replaced by `paranormal.html`

**Nav updated across all 9 HTML files:** `🛸 UFO Cases` → `👁️ Paranormal`, `ufo.html` → `paranormal.html`

**CSS added:** `.para-card`, `.para-card-img`, `.para-card-tags`, `.para-card-title`, `.para-card-desc`, `.para-card-link` in `style.css`

**Note:** The old timeline CSS (`.timeline`, `.timeline-item`, `.conviction-meter`, etc.) is still in `style.css` — it's reusable and the conviction meter is still used on paranormal cards. Can be cleaned up later if not needed.

### Pride and Identity — Trans Flag Accents

**What changed:** Added trans flag color accents (light blue `#5BCEFA`, pink `#F5A9B8`, white `#FFFFFF`) to the Pride and Identity page.

**CSS added to `style.css`:**
- `.page-hero-trans .gradient-text` — Title uses trans flag gradient instead of the default teal→blue→purple
- `.page-hero-trans .page-hero-tagline` — Tagline colored pink
- `.page-hero-trans::after` — Decorative 120px trans flag gradient bar below the hero
- `.resource-cat-heading` — Resource category headings get a blue→pink gradient left border

**HTML updated:** `transart.html` hero section gets `page-hero-trans` class

### Brain SVG — CSS Variable Integration

**What changed:** The homepage brain SVG had hardcoded hex colors (`#2dd4bf`, `#38bdf8`, `#a78bfa`, `#f472b6`) in its gradient `stop-color` attributes and sparkle node `fill` attributes. These now use `style` attributes referencing CSS custom properties (`var(--teal)`, `var(--blue)`, `var(--purple)`, `var(--pink)`), so the brain recolors correctly with any theme (e.g., Quake II warm tones).

**File modified:** `index.html` — All SVG gradient stops and circle fills updated to use CSS variables via `style=""` attributes.

### Homepage Explore Section Refresh

**What changed:** The homepage "Projects" section had a single "Coming Soon" placeholder card. It's now renamed to "Explore" and contains 7 clickable cards linking to each Explore page.

**Cards added:**
| Card | Color | Status Tag | Link |
|---|---|---|---|
| YouTube Channels | teal | Live | `youtube.html` |
| Great & Free | blue | Live | `tools.html` |
| Soundboards | purple | Growing | `soundboards.html` |
| Art Gallery | pink | Growing | `art.html` |
| Pride and Identity | pink | Growing | `transart.html` |
| Paranormal | purple | Growing | `paranormal.html` |
| Photo Gallery | teal | Soon | `photos.html` |

**CSS updated:** `.projects-grid` changed from `flex-direction: column` to `display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))` for responsive multi-column layout.

**HTML updated:** Section title changed from "Projects" to "Explore". Cards are `<a>` tags (clickable) instead of `<div>` tags.

### Cross-Linking Footers

**What changed:** Added a "More from Alan's Brain" section above the site footer on all 7 Explore pages. Each page links to 3 related pages for discovery/navigation.

**CSS added:** `.explore-more`, `.explore-more-heading`, `.explore-more-grid`, `.explore-more-card`, `.explore-more-emoji`, `.explore-more-label` — responsive grid of link cards with hover effects, handwritten-style heading.

**Cross-link map:**
| Page | Links to |
|---|---|
| YouTube Channels | Soundboards, Great & Free, Paranormal |
| Pride and Identity | Art Gallery, YouTube Channels, Photo Gallery |
| Soundboards | YouTube Channels, Paranormal, Great & Free |
| Great & Free | YouTube Channels, Photo Gallery, Soundboards |
| Photo Gallery | Art Gallery, Paranormal, Pride and Identity |
| Art Gallery | Photo Gallery, Pride and Identity, YouTube Channels |
| Paranormal | Soundboards, Art Gallery, YouTube Channels |

### Great & Free — Third Expansion

**2 new tools added** to `data/tools.json`, bringing the total to 40:
- On The Go Map (Utilities) — route mapping for running/walking/cycling
- Piixes (Creative) — 15,000+ free pixelated icons

**4 new websites added** to `data/websites.json`, bringing the total to 22:
- Space Jam 1996 (Exploration) — preserved web 1.0 movie site
- Blair Witch Project (Exploration) — original viral marketing movie site
- The Black Vault (Knowledge) — declassified government UFO/paranormal documents via FOIA
- SCP Foundation (Fun & Games) — collaborative horror fiction wiki

### Homepage Card Cleanup

**What changed:** Removed `card-desc` subtitles and `card-tag` status badges (Live/Growing/Soon) from all 7 Explore cards on the homepage. Cards now show only emoji + title for a cleaner, less cluttered look.

### Pride and Identity — Polyamory Tab

**What changed:** Added a third tab "Polyamory" to the Pride and Identity page, sitting between Art and Resources. The page now has 3 tabs: **Art | Polyamory | Resources**.

**Tab toggle JS** refactored from hardcoded 2-tab switching to a dynamic `sections` object that handles any number of tabs.

**Data file:** `data/transart-polyamory.json` — currently empty (`[]`), ready for content. Each entry supports:
| Field | Required | Description |
|---|---|---|
| `name` | Yes | Title of the content |
| `description` | No | Brief description |
| `url` | No | Link to the content |
| `type` | No | Content type tag (Article, Art, Video, etc.) |

### Custom PNG Icons — Emoji Replacement

**What changed:** All emoji icons across the entire site were replaced with hand-selected custom PNG icons stored in `img/Icons/icons/`. Each page and navigation element now uses a distinct, cohesive icon instead of Unicode emoji.

**Icon mapping:**

| Page / Element | Old Emoji | New Icon | Path |
|---|---|---|---|
| Alan's Brain (logo) | 🧠 | World creativity globe | `img/Icons/icons/Alan's_Brain/world-creativity-and-innovation-day.png` |
| YouTube Channels | 📺 | TV | `img/Icons/icons/Youtube_Channels/tv.png` |
| Pride and Identity | 🎨 | Flag | `img/Icons/icons/Pride_and_Identity/flag.png` |
| Soundboards | 🔊 | Speaker | `img/Icons/icons/Audio_Related/speaker.png` |
| Great & Free | 🛠️ | Internet Explorer | `img/Icons/icons/Cool_Links/internet-explorer.png` |
| Photo Gallery | 📸 | Camera | `img/Icons/icons/Photo_Gallery/cam.png` |
| Art Gallery | 🖼️ | Starry Night | `img/Icons/icons/Art/starry-night.png` |
| Paranormal | 👁️ | Paranormal icon (updated) | `img/Icons/icons/Paranormal/clairvoyance.png` |
| Explore section | 🚀 | Cloud | `img/Icons/icons/Explore/cloud.png` |
| Cool Links section | 🔗 | Domain | `img/Icons/icons/Other/domain.png` |
| Footer | 🛸 | UFO (updated) | `img/Icons/icons/UFO/ufo.png` |
| Soundboard empty state | 🔇 | No sound (updated) | `img/Icons/icons/No_Sound/no-sound.png` |
| Resources empty state | 📚 | Research book | `img/Icons/icons/References/research.png` |
| Theme picker button | 🎨 | Color palette | `img/Icons/icons/Theme/colors.png` |
| Polyamory empty state | — | Polyamory heart | `img/Icons/icons/Pride_and_Identity/polyamory(1).png` |
| Paranormal empty state | 👁️ | Eye | `img/Icons/icons/Nothing_To_See/eye.png` |
| "Always under construction" badge | 🏗️ | Construction/heating | `img/Icons/icons/Under_Construction/heating.png` |
| Search bars | 🔍 | Transparency/search | `img/Icons/icons/Search/transparency.png` |

**Where icons are used:** Nav dropdown (`<img class="dropdown-icon">`), mobile nav overlay (`<img class="nav-mobile-icon">`), homepage Explore cards (`.card-emoji img`), page hero icons (`.page-hero-icon img`), cross-linking footers (`.explore-more-emoji img`), section headers (`.section-icon img`).

**CSS added:** Sizing rules for `img` elements inside `.dropdown-icon` (24px), `.card-emoji` (44px), `.page-hero-icon` (72px), `.explore-more-emoji` (28px), `.section-icon` (36px), and new `.nav-mobile-icon` class (28px, 34px for nav logo).

**Empty state updates:** The "Artist profiles coming soon" empty state uses the Starry Night art icon. The "Polyamory content coming soon" empty state uses the polyamory heart icon. The "Resources coming soon" empty state uses the research book icon. The soundboard "No clips loaded" empty state uses the no-sound icon.

**Note:** Custom PNGs don't auto-recolor with the theme system (unlike emoji/SVG), but this provides visual consistency across themes.

### Icon Refresh — Explore, Empty States, Search, Construction Badge

**What changed:** Replaced remaining emoji icons and updated several custom PNGs across the site.

**Icon updates:**

| Location | Old | New | Path |
|---|---|---|---|
| Homepage "Explore" section header | galaxy.png | cloud.png | `img/Icons/icons/Explore/cloud.png` |
| Homepage "Always under construction" badge | 🏗️ emoji | heating.png | `img/Icons/icons/Under_Construction/heating.png` |
| Paranormal empty state | 👁️ emoji | eye.png | `img/Icons/icons/Nothing_To_See/eye.png` |
| Search bars (YouTube, Great & Free) | 🔍 emoji | transparency.png | `img/Icons/icons/Search/transparency.png` |
| Soundboard empty state | no-sound(1).png | no-sound.png (updated) | `img/Icons/icons/No_Sound/no-sound.png` |

**Files modified:** `index.html`, `youtube.html`, `tools.html`, `soundboards.html`, `paranormal.html`

**Files deleted:** `img/Icons/icons/Explore/galaxy.png`, `img/Icons/icons/No_Sound/no-sound(1).png`

**New icon folders:** `Nothing_To_See/`, `Search/`, `Under_Construction/`

**Attributions updated** in `img/Icons/icons/Attributions_for_Artists.txt` — added credits for eye (Freepik), star (Freepik), construction (IconMarketPK), search (Freepik), sound off (Andrean Prabowo).

### Visit Counter Ticker (GoatCounter)

**What changed:** Added an odometer-style rolling digit visit counter to the footer of all 9 pages, powered by GoatCounter (`dbatz92.goatcounter.com`).

**How it works:**
- `visit-ticker.js` fetches the per-page view count from GoatCounter's public JSON API
- Builds 6 digit boxes (padded with leading zeros) with comma separators
- Each digit "rolls" into place with a staggered animation (120ms delay per digit, cubic-bezier ease)
- Falls back to `000,000` if the API is unreachable
- GoatCounter's `count.js` script tracks visits (privacy-friendly, no cookies)

**Files created:** `visit-ticker.js`

**CSS added:** `.visit-ticker`, `.ticker-label`, `.ticker-digits`, `.ticker-digit`, `.ticker-digit-inner`, `.ticker-separator` — odometer layout with `overflow: hidden` digit boxes and `translateY` animation

**Footer updated across all 9 pages:**
- Added ticker HTML (`#visitTicker` container)
- Added GoatCounter tracking script (`//gc.zgo.at/count.js`)
- Removed "No tracking. No ads." from footer text — now reads: "Part of the indie web. Just a human on the internet."

### Search Icon Enlargement

**What changed:** Search bar icons on YouTube Channels and Great & Free pages enlarged from 18px to 24px for better visibility.

**Files modified:** `youtube.html`, `tools.html`

### Soundboard Quotes — JSON Migration & Admin Commands

**What changed:** Rotating quotes moved from a hardcoded `BOARD_QUOTES` object in `soundboards.html` to each board's JSON file under a `"quotes"` array. This allows quotes to be managed alongside clip data via the admin script.

**Board JSON schema updated:** Each board file (e.g., `data/soundboards/halflife.json`) now supports an optional top-level `"quotes"` array:
```json
{
  "quotes": ["Quote one", "Quote two"],
  "categories": [...]
}
```

**`soundboards.html` updated:** `updateQuote()` now reads from `boardData[id].quotes` instead of the removed `BOARD_QUOTES` object. Quote display is deferred until after board data is fetched.

**`soundboard-admin.py` updated:**
- `add` command now accepts `--quote "text"` to add a quote alongside a clip
- New `add-quote <board> "text"` command — add a quote standalone
- New `remove-quote <board> "text"` command — remove a quote
- `list <board>` now displays quotes in the output

### Homepage Layout Updates — Links Removal, Description, Soundboard Styles

**What changed:** Merged `claude/homepage-layout-updates-UslXV` branch. Cleaned up homepage layout and nav structure.

**Changes:**
- **"Links" nav item removed** from desktop nav and mobile overlay across all 9 HTML pages (`index.html`, `tools.html`, `youtube.html`, `photos.html`, `art.html`, `soundboards.html`, `paranormal.html`, `transart.html`, `tasks.html`)
- **"Cool Links" section removed** from homepage — the 3 indie web links (Neocities, 32-Bit Cafe, Melon King) were moved into `data/websites.json` as a new "Indie Web" category (bringing websites total to 25)
- **Homepage hero description updated** from "A personal homepage, project hub, and digital garden. A little emulation of my brain and the multitudes it contains." to "An emulation of my Brain and the multitudes it contains."
- **Soundboard category images enlarged** from 36px to 52px
- **Soundboard rotating quote font enlarged** from 1.1rem to 1.3rem

### Trans Art & Resources → Pride and Identity

**What changed:** Renamed "Trans Art & Resources" to "Pride and Identity" everywhere — page title, nav dropdown (all 9 HTML files), mobile nav overlay, homepage Explore card, cross-linking footers, and the page hero heading. File remains `transart.html`. The trans flag gradient accents on the page are preserved.

### Paranormal — Subtitle Update

**What changed:** Paranormal page subtitle changed from "the ones that make you go hmm" to "Is there a there, there?"

### Soundboard Enhancements

**Category images:** Each soundboard category header now shows a character image alongside the category name. Images organized in per-board subfolders under `img/Icons/Soundboards/`. Images can be a single path OR an array of paths — arrays are randomly resolved to one pick per page load (see "Random Cycling Category Icons" section below):
- Half-Life → Scientists: **3 random variants** (`Scientist_1_No_BG.png`, `Scientist_2_No_BG.png`, `Scientist_3_No_BG.png`), G-Man: `Half-Life/G-Man_No_BG.png`
- Max Payne → `Max_Payne/Max_Payne_No_BG.png` (default for all categories)
- They Hunger → **2 random variants** (`They_Hunger_Boy_No_BG.webp`, `ChesterRockwood_No_BG.png`)
- Quake 2 → `Quake2/Bitterman_No_BG.png` (default)
- Red Letter Media → Per-person mapping: `RLM/Mike_Stoklasa_No_BG.png` (Mike + default), `RLM/Jay_RLM_No_BG.png` (Jay), `RLM/Rich_No_BG.png` (Rich). `Rich_2_No_BG.png` also available for a second Rich category.

Category image mapping is defined in `CATEGORY_IMAGES_RAW` object in the inline script on `soundboards.html`, then resolved into `CATEGORY_IMAGES` at page load. To add cycling to any category, change its value from a string to an array of strings. Categories are matched by name — e.g., naming an RLM category "Jay" will display Jay's image.

**Playback rules:** Maximum 2 concurrent sounds — additional clicks are ignored until a slot opens. Clicking a currently-playing clip toggles it off (stops playback, resets progress bar). `SoundEngine` tracks active sources by URL via `sourceMap` for toggle support, exposes `isPlaying(url)` and `stop(url)` methods. Pending (loading) clips count toward the limit to prevent race conditions. "Stop All" button removed — click-to-toggle and the 2-sound limit make it unnecessary.

**Clip progress bar:** Each audio button now contains a `.clip-progress` element — a 3px teal bar at the bottom that animates from left to right over the clip's duration while playing. The `SoundEngine.play()` signature changed from `play(url, onEnded)` to `play(url, onStart, onEnded)` where `onStart(duration)` receives the clip duration in seconds. Progress bars reset on stop/end.

**Rotating quotes:** Each soundboard can have a `"quotes"` array in its board JSON file (e.g., `data/soundboards/halflife.json`). When a board is selected, a random quote displays as the page tagline in the Caveat handwriting font. Quotes are managed via `soundboard-admin.py` (`add-quote`, `remove-quote`, or `--quote` flag on `add`). Current quotes:
- Half-Life: "Why do we all have to wear these ridiculous ties?", "Time to choose."
- Other boards: no quotes yet (add via `soundboard-admin.py add-quote <board> "text"`)

**Board selector icons:** All 5 boards in `data/soundboards/index.json` now use image paths (containing `/`) instead of emoji for their `icon` field. The `renderBoardSelector()` function detects path-based icons and renders `<img>` tags instead of text.

### Soundboard Icon Reorganization & New Board Scaffolding

**What changed:** Soundboard character icons moved from flat `img/Icons/Soundboards/` into per-board subfolders. Three new boards (They Hunger, Quake 2, Red Letter Media) fully scaffolded with icons, JSON data files, and category image mappings.

**Icon folder restructure:**
| Before | After |
|---|---|
| `img/Icons/Soundboards/Scientist_No_BG.png` | `img/Icons/Soundboards/Half-Life/Scientist_1_No_BG.png` (+ `Scientist_2_No_BG.png`, `Scientist_3_No_BG.png`) |
| `img/Icons/Soundboards/G-Man_No_BG.png` | `img/Icons/Soundboards/Half-Life/G-Man_No_BG.png` |
| `img/Icons/Soundboards/Max_Payne_No_BG.png` | `img/Icons/Soundboards/Max_Payne/Max_Payne_No_BG.png` |
| *(new)* | `img/Icons/Soundboards/They_Hunger/They_Hunger_Boy_No_BG.webp`, `ChesterRockwood_No_BG.png` |
| *(new)* | `img/Icons/Soundboards/Quake2/Bitterman_No_BG.png` |
| *(new)* | `img/Icons/Soundboards/RLM/Mike_Stoklasa_No_BG.png` |
| *(new)* | `img/Icons/Soundboards/RLM/Jay_RLM_No_BG.png` |
| *(new)* | `img/Icons/Soundboards/RLM/Rich_No_BG.png` |
| *(new)* | `img/Icons/Soundboards/RLM/Rich_2_No_BG.png` |

**Files updated:**
- `data/soundboards/index.json` — All 5 boards now use subfolder image paths instead of emoji
- `soundboards.html` — `CATEGORY_IMAGES` updated with new paths + entries for theyhunger, quake2, and rlm

**Files created:**
- `data/soundboards/theyhunger.json` — Empty board JSON (quotes + categories ready)
- `data/soundboards/quake2.json` — Empty board JSON
- `data/soundboards/rlm.json` — Empty board JSON

**RLM category mapping:** The RLM board maps category names to person images — name a category "Mike", "Jay", or "Rich" and the matching character image appears in the header. Unmatched categories fall back to Mike's image.

### Performance Audit & Image Optimization Pipeline

**What changed:** Comprehensive performance and asset optimization pass across the entire site. No visual changes — everything looks and works the same, just faster and more accessible.

**New file created:** `optimize-media.py` — standalone Python CLI tool for batch media optimization. Follows the `soundboard-admin.py` pattern. Requires Pillow (`pip install Pillow`) and ffmpeg on PATH.

**Subcommands:**
| Command | What it does |
|---|---|
| `python optimize-media.py art` | Resize full-size art JPGs to max 2000px, compress, generate WebP |
| `python optimize-media.py youtube` | Compress YouTube channel PNGs, generate WebP copies |
| `python optimize-media.py icons` | Resize UI icons to max 96px (2x retina), quantize to 256 colors, generate WebP |
| `python optimize-media.py soundboards` | Resize character PNGs to max 300px, generate WebP |
| `python optimize-media.py audio` | Convert WAV files to OGG Vorbis via ffmpeg |
| `python optimize-media.py all` | Run all of the above |
| `python optimize-media.py report` | Print size report without modifying anything |

All subcommands support `--dry-run` flag.

**Image compression results:**
| Category | Before | After |
|---|---|---|
| Art full-size (River Scene) | 3.1MB (5532px) | 375KB (2000px) |
| Art thumbnails | 87KB | 32KB |
| YouTube channel icons (114) | 7.3MB PNG | 6.2MB PNG + 634KB WebP |
| UI/Nav icons (29) | 758KB | 114KB (96px, quantized) |
| Soundboard characters (9) | 1.4MB | 554KB |
| Audio WAV → OGG (24 files) | 1.6MB | 722KB |

WebP files placed alongside originals (same directory, `.webp` extension) to enable `<picture>` fallback in HTML.

**CSS performance fixes** (`style.css`):
- **Dead CSS removed:** ~130 lines of unused `.timeline` through `.timeline-sources` styles from the old UFO page. The `.evidence-tag` and `.conviction-meter` classes were kept — still used by `paranormal.html`.
- **`prefers-reduced-motion: reduce`** media query added: disables blob drift, brainFloat, shadowPulse, blink, entrance animations (`.anim`, `.reveal`), slideshow crossfade transitions, clip progress transitions, and smooth scroll. Accessibility improvement.
- **`will-change` hints** added to `.blob` (transform), `.hero-brain` (transform), `.slideshow-img` (opacity) — GPU acceleration for continuously-animated elements only.

**JavaScript performance fixes** (all 9 HTML files):
- **`defer` added** to all external `<script>` tags: `theme-switcher.js`, `visit-ticker.js`, `gallery.js`, `soundboards.js`. Allows parallel download during HTML parsing.
- **`DOMContentLoaded` wrappers** added to inline scripts in `art.html`, `photos.html`, `soundboards.html` — these pages depend on deferred external scripts (`Lightbox()`, `SoundEngine()`), so inline code must wait for them to load.
- **Scroll handler throttled** in `index.html` — wrapped in `requestAnimationFrame` with `{ passive: true }` to prevent firing on every scroll frame.

**Responsive image markup** (HTML files + `gallery.js`):
- **`<picture>` elements with WebP sources** added to YouTube channel grid (114 icons) and art thumbnail grid. Browsers that support WebP load the smaller file; others fall back to PNG/JPG.
- **WebP detection utility** added to `gallery.js` — `webpSrc(src)` function detects WebP support and swaps file extensions for lightbox and slideshow image loading.
- **`width`/`height` attributes** added to all static icon `<img>` tags across all 9 pages to prevent Cumulative Layout Shift (CLS): nav dropdown icons (24×24), mobile nav icons (28×28), page hero icons (72×72), homepage card icons (44×44), footer icons (28×28).

**Audio format optimization** (`soundboards.js`):
- `SoundEngine.load()` now tries the `.ogg` version of audio files first, falling back to the original `.wav` URL on error. No JSON changes needed — the fallback is transparent.
- OGG files generated by `optimize-media.py audio` sit alongside WAVs in `audio/halflife/`.

**How to optimize new media:** When adding new images or audio, run `python optimize-media.py all` to compress and generate WebP/OGG versions. For YouTube channel icons specifically, `python optimize-media.py youtube`. For new soundboard audio, `python optimize-media.py audio`.

### Random Cycling Category Icons, Grape-Nuts Easter Egg, Button & Scroll Fixes

**What changed:** Four improvements in a single commit — random character icons for soundboard categories, a Grape-Nuts footer easter egg, a button deselect bug fix, and a scroll arrow responsiveness fix.

**1. Random cycling category icons (`soundboards.html`):**

The `CATEGORY_IMAGES` object was refactored into a two-step system:
- `CATEGORY_IMAGES_RAW` — the raw mapping where each value can be a **single string** (one image) OR an **array of strings** (multiple images to cycle through)
- On page load, a resolver loop picks one image at random from each array (or passes through single strings unchanged) into the final `CATEGORY_IMAGES` object

This means adding more variant images for any board/category is just a matter of adding more paths to the array — no other code changes needed.

**Current cycling images:**
| Board | Category | Images |
|---|---|---|
| Half-Life | Scientists | `Scientist_1_No_BG.png`, `Scientist_2_No_BG.png`, `Scientist_3_No_BG.png` (3 variants) |
| They Hunger | default | `They_Hunger_Boy_No_BG.webp`, `ChesterRockwood_No_BG.png` (2 variants) |

All other boards remain single-image (G-Man, Max Payne, Quake 2, RLM per-person) but can be converted to arrays at any time.

**New image files added:**
- `img/Icons/Soundboards/Half-Life/Scientist_1_No_BG.png`
- `img/Icons/Soundboards/Half-Life/Scientist_2_No_BG.png`
- `img/Icons/Soundboards/Half-Life/Scientist_3_No_BG.png`
- `img/Icons/Soundboards/They_Hunger/ChesterRockwood_No_BG.png`

**File removed:** `img/Icons/Soundboards/They_Hunger/They_Hunger_Boy_No_BG.png` (original PNG deleted; WebP version `They_Hunger_Boy_No_BG.webp` from optimization pipeline still exists and is referenced)

**2. Grape-Nuts footer easter egg (all 9 pages):**

The coffee cup emoji (`☕`) in the footer button row (`HTML | CSS | JS | ☕`) was replaced with a clickable Grape-Nuts icon. Clicking it opens the Grape-Nuts "Our Story" page (`https://www.grapenuts.com/our-story/`) in a new tab.

- Icon: `img/Icons/icons/Grapenuts/Grape_Nuts_No_BG.png` (14×14px, inline styled)
- Element changed from `<span class="footer-btn">☕</span>` to `<a class="footer-btn" href="..." target="_blank" title="🥣"><img ...></a>`
- Files modified: `index.html`, `art.html`, `paranormal.html`, `photos.html`, `soundboards.html`, `tasks.html`, `tools.html`, `transart.html`, `youtube.html`

**3. Button deselect fix (`soundboards.html`):**

When clicking a playing audio button to stop it, the button stayed visually highlighted (retained `.playing` class and keyboard focus). Fixed by adding `btn.classList.remove('playing')` and `btn.blur()` to the stop-toggle branch in the click handler.

Additionally, a new CSS rule `.audio-btn:focus:not(.playing)` removes the focus outline/box-shadow when a button is focused but not actively playing, preventing the "stuck highlight" appearance.

**4. Scroll arrow fix (`style.css`):**

The scroll navigation arrows (up/down page buttons) required two taps on mobile — the first tap triggered the hover state, the second tap actually activated the button. Fixed by:
- Wrapping `.scroll-nav-btn:hover` styles in `@media (hover: hover)` so hover effects only apply on devices with real hover capability (mouse/trackpad), not touch
- Adding `touch-action: manipulation` to prevent 300ms tap delay on mobile
- Adding `-webkit-tap-highlight-color: transparent` to remove the default tap highlight
- Moving the `background`/`color`/`border-color` change into `.scroll-nav-btn:active` so touch devices get immediate visual feedback on press

### Grape-Nuts Hover Pop, They Hunger Icon Fix, Soundboard Persistence

**1. Grape-Nuts hover pop (`style.css`):**

Added hover effect to the Grape-Nuts footer icon — on hover, the image scales to 2.2× its size via `transform: scale(2.2)` with a 0.2s ease transition. Makes the small 14px icon much more noticeable and discoverable as a clickable easter egg.

CSS added: `.footer-btn img` (transition) and `.footer-btn:hover img` (scale transform).

**2. They Hunger board selector icon fix (`data/soundboards/index.json`):**

The They Hunger entry in `index.json` referenced `They_Hunger_Boy_No_BG.png` which was deleted in the previous commit. Updated to `They_Hunger_Boy_No_BG.webp` (the WebP version generated by the optimization pipeline, which still exists).

**3. Soundboard selection persists across refresh (`soundboards.html`):**

The selected soundboard now saves to `localStorage('ab_soundboard')` whenever a board is selected. On page load, the saved board ID is read and validated against the loaded manifest — if valid, that board is selected instead of defaulting to the first board (They Hunger). Falls back to first board if the saved ID no longer exists in the manifest.

### Soundboard Icon Scaling, Grape-Nuts Mobile Scroll, Weighted Image Rotation

**1. Soundboard category icon scaling (`style.css`):**

Changed `.sb-category-img` from `object-fit: contain` (52px) to `object-fit: cover` with `object-position: top center` (56px). Full-body character images now crop to show the head/upper body at a decent size instead of shrinking the entire figure into a tiny square. Head-shot images continue to look great.

**2. Grape-Nuts mobile scroll growth (`visit-ticker.js`, `style.css`):**

Removed the CSS `:active` state for the Grape-Nuts easter egg (mobile tap). Replaced with scroll-based scaling in JavaScript: on touch devices (detected via `matchMedia('(hover: hover)')`), when within the last 200px of the page bottom, the Grape-Nuts icon gradually scales from 1× to 4.4× proportionally. Scrolling back up smoothly shrinks it. On desktop, the CSS `:hover` effect continues to work as before. This makes the easter egg discoverable on mobile by scrolling to the very bottom of any page.

**3. Weighted image rotation to reduce repeats (`soundboards.html`):**

Replaced pure `Math.random()` selection for rotating category images with a `pickWeighted()` function that uses `sessionStorage` to track the last image shown per board+category key (e.g. `sb_img_halflife_Scientists`). On each page load, the previously shown image is excluded from candidates, ensuring you won't see the same icon twice in a row. Gracefully falls back to standard random if sessionStorage is unavailable or if there's only one image option.

-----

## How to Add Content

Every Explore page works the same way: there's an HTML page (the layout) and a JSON file (the content). You never need to touch the HTML. To add, remove, or change what shows up on any page, you just edit its JSON file. The page reads that file when it loads and builds everything from it automatically.

Think of each JSON file as a list. Each item in the list is wrapped in `{ }` curly braces, items are separated by commas, and the whole list is wrapped in `[ ]` square brackets. Text values go in `"quotes"`, numbers don't.

---

### 🛠️ Great & Free Tools → `data/tools.json`

**What's there now:** 40 tools across 11 categories (Design, Utilities, Security, Productivity, Media, Networking, Creative, Game Dev, Internet, Education) + 25 websites across 5 categories (Exploration, Fun & Games, Knowledge, Outdoors & Maps, Indie Web)

**To add a new tool**, copy-paste this block inside the `[ ]` brackets (after the last `}`, put a comma first):

```json
{
  "name": "Tool Name",
  "url": "https://link-to-the-tool.com",
  "description": "A sentence or two about what it does.",
  "category": "Whatever Category",
  "icon": "🔧"
}
```

That's it. The filter buttons at the top of the page auto-generate from whatever categories you use — so if you type `"Security"` on three tools, a "Security" filter button appears automatically.

**Example — adding a new tool to the existing file:**
```json
[
  { ...existing Draw.io entry... },
  { ...existing P2R3 entry... },
  { ...existing HIBP entry... },
  {
    "name": "Photopea",
    "url": "https://photopea.com",
    "description": "Free online Photoshop alternative. Opens PSDs, XCFs, Sketch files.",
    "category": "Design",
    "icon": "🎨"
  }
]
```

---

### 📺 YouTube Channels → `data/youtube.json`

**What's there now:** 114 channels across multiple categories with profile images.

**To add a channel:**

1. Save the channel's profile picture to the `img/youtube/` folder (e.g., `img/youtube/linus.jpg`)
2. Add an entry to `data/youtube.json`:

```json
{
  "name": "Linus Tech Tips",
  "url": "https://youtube.com/@LinusTechTips",
  "description": "Tech reviews, PC builds, and questionable server room decisions.",
  "category": "Tech",
  "image": "img/youtube/linus.jpg"
}
```

**Want to feature a specific video from that channel?** Add an `exemplar` section:

```json
{
  "name": "Linus Tech Tips",
  "url": "https://youtube.com/@LinusTechTips",
  "description": "Tech reviews, PC builds, and questionable server room decisions.",
  "category": "Tech",
  "image": "img/youtube/linus.jpg",
  "exemplar": {
    "videoId": "dQw4w9WgXcQ",
    "title": "The Best Video They Ever Made",
    "note": "This one changed how I think about cooling."
  }
}
```

The `videoId` is the part after `v=` in a YouTube URL (e.g., `youtube.com/watch?v=dQw4w9WgXcQ` → `"dQw4w9WgXcQ"`). The page will auto-grab a thumbnail from YouTube using that ID. If you'd rather use your own thumbnail image, save one to `img/youtube/` and add `"thumbnail": "img/youtube/my-thumb.jpg"` inside the exemplar section.

---

### 📸 Photo Gallery → `data/photos.json`

**What's there now:** Empty — ready to fill.

**To add a photo:**

1. Put the full-size image in `img/photos/full/` (e.g., `img/photos/full/sunset.jpg`)
2. Put a smaller version (~600px wide) in `img/photos/thumbs/` with the same name (e.g., `img/photos/thumbs/sunset.jpg`)
3. Add an entry to `data/photos.json`:

```json
{
  "src": "img/photos/full/sunset.jpg",
  "thumb": "img/photos/thumbs/sunset.jpg",
  "caption": "Sunset over the mountains",
  "category": "Nature"
}
```

- `src` = the big version (shown when you click to zoom in)
- `thumb` = the small version (shown in the grid on the page)
- `caption` = text shown in the lightbox when you click the photo
- `category` = optional, creates filter buttons (leave it out if you don't want filters)

**Why two versions of each image?** The page loads the small thumbnails first so it's fast. The full-size image only loads when someone clicks to zoom in. Eventually we'll build a script that auto-generates thumbnails so you only have to drop in the full-size one.

---

### 🎨 Art Gallery → `data/art.json`

**What's there now:** 2 entries (both by Sebastian Pether)

**To add artwork:**

1. Put the full image in `img/art/full/`
2. Put a thumbnail in `img/art/thumbs/`
3. Add an entry to `data/art.json`:

```json
{
  "src": "img/art/full/painting.jpg",
  "thumb": "img/art/thumbs/painting.jpg",
  "title": "Starry Night But Cats",
  "artist": "Some Artist",
  "year": "1889"
}
```

- `artist` is optional — leave it out if it's your own work or you don't want to credit someone
- `year` is optional — omit it and the year line simply won't show
- The hero slideshow auto-cycles through all entries. Clicking the slideshow image or any thumbnail opens a full-screen lightbox with prev/next navigation.

---

### 👁️ Paranormal → `data/paranormal.json`

**What's there now:** Empty — ready to fill.

**To add an entry:**

```json
{
  "title": "The Phoenix Lights",
  "type": "video",
  "category": "UFOs",
  "description": "Thousands of people across Arizona saw a V-shaped formation of lights in March 1997.",
  "url": "https://youtube.com/watch?v=example",
  "conviction": 8
}
```

Key fields explained:
- `title` — the name of this piece of content
- `type` — what kind of content: `"video"`, `"article"`, `"photo"`, `"writing"`, `"podcast"`, `"documentary"`, `"book"`, `"case"`. Creates Type filter buttons.
- `category` — paranormal topic: `"UFOs"`, `"Ghosts"`, `"Cryptids"`, `"Psychic"`, `"Unexplained"`, `"Conspiracy"`, `"Ancient"`, `"Other"` (or make up your own). Creates Category filter buttons.
- `description` — a sentence or two about why this is compelling
- `url` — optional link to the source (video, article, etc.). Shows as "View source ↗"
- `conviction` — optional, a number from 0 to 10. How much do you believe this one? Shows as a meter bar.
- `image` — optional, path to a thumbnail image (e.g., `"img/paranormal/phoenix.jpg"`)

---

### 🔊 Soundboards → `data/soundboards/`

**What's there now:** 5 boards (They Hunger, Half-Life, Max Payne, Quake 2, Red Letter Media). Half-Life has 20 clips across Scientists + G-Man categories. Others have 0 clips but all have JSON files and character icons ready.

This one's a bit different because it uses multiple files. There's a master list, and then each board gets its own file.

**Step 1: The master list is already set up** at `data/soundboards/index.json`. Each board has a character image icon from `img/Icons/Soundboards/{BoardFolder}/`:

```json
[
  { "id": "theyhunger", "name": "They Hunger", "icon": "img/Icons/Soundboards/They_Hunger/They_Hunger_Boy_No_BG.png", "clipCount": 0 },
  { "id": "halflife", "name": "Half-Life", "icon": "img/Icons/Soundboards/Half-Life/Scientist_No_BG.png", "clipCount": 20 }
]
```

**Step 2: To add clips to a board** (e.g., They Hunger):

1. Create a folder for the audio files: `audio/theyhunger/`
2. Put your audio files in there (e.g., `audio/theyhunger/hello.wav`, `audio/theyhunger/scream.wav`)
3. Edit the existing `data/soundboards/theyhunger.json` (already created with empty categories):

```json
{
  "quotes": ["Some memorable quote from the game"],
  "categories": [
    {
      "name": "Dialogue",
      "clips": [
        { "label": "Hello there", "file": "hello.wav" },
        { "label": "Get out!", "file": "getout.wav" }
      ]
    }
  ]
}
```

Note: The `file` field is just the filename — the page auto-prefixes `audio/{boardId}/`.

4. Update the `clipCount` in `data/soundboards/index.json` to match how many clips you added.

**Category images:** To get a character image next to a category header, name the category to match a key in the `CATEGORY_IMAGES` object in `soundboards.html`. For RLM, naming categories "Mike", "Jay", or "Rich" will show the corresponding person's image. Any unmatched category falls back to the board's `default` image.

**To add a brand new board:** Add a new entry to `index.json` with a unique `id`, create `data/soundboards/{id}.json`, create `audio/{id}/` for clips, and optionally add a character icon to `img/Icons/Soundboards/{BoardFolder}/` and a `CATEGORY_IMAGES` entry in `soundboards.html`.

---

### Quick Reference: Where Does Everything Go?

| I want to add... | Edit this file | Put images/audio here |
|---|---|---|
| A free tool | `data/tools.json` | (no files needed, just a URL) |
| A cool website | `data/websites.json` | (no files needed, just a URL) |
| A YouTube channel | `data/youtube.json` | `img/youtube/` |
| A photo | `data/photos.json` | `img/photos/full/` + `img/photos/thumbs/` |
| An artwork | `data/art.json` | `img/art/full/` + `img/art/thumbs/` |
| A paranormal entry | `data/paranormal.json` | `img/paranormal/` (optional) |
| Soundboard clips | `data/soundboards/{id}.json` | `audio/{id}/` |

**Golden rule:** Edit the JSON, drop in the files, and the page handles the rest. No HTML editing needed.

-----

## Current File Structure

```
alans-brain/
├── index.html              ✅ Updated nav + FODT script + theme-switcher.js
├── tasks.html              ✅ Updated nav + FODT script + theme-switcher.js (passphrase-protected)
├── tools.html              ✅ Phase 2 — JSON-driven tool directory + theme support
├── youtube.html            ✅ Phase 2 — JSON-driven channel cards + theme support
├── photos.html             ✅ Phase 2 — JSON-driven masonry gallery + lightbox + theme support
├── art.html                ✅ Phase 3 — JSON-driven slideshow + thumbnail grid + theme support
├── soundboards.html        ✅ Phase 3 — JSON-driven board selector + clip grids + theme support
├── paranormal.html          ✅ Reworked from UFO — JSON-driven media grid with Category/Type filters + theme support
├── transart.html           ✅ Pride and Identity — Art/Polyamory/Resources tabs, trans flag accents, JSON-driven + theme support
├── style.css               ✅ Extended with all shared components + timeline + theme picker styles
├── theme-switcher.js       ✅ Theme engine (apply/persist/load themes, picker UI, Konami code)
├── auth.js                 ✅ Existing (SHA-256 passphrase gate for tasks.html)
├── tasks.js                ✅ Existing (task tracker engine)
├── gallery.js              ✅ Phase 1 (Lightbox + Slideshow constructors)
├── soundboards.js          ✅ Phase 3 (SoundEngine constructor — Web Audio API)
├── visit-ticker.js         ✅ Odometer-style visit counter (GoatCounter API integration)
├── soundboard-admin.py     ✅ CLI tool for soundboard JSON management (clips + quotes)
├── soundboard-admin-gui.py ✅ GUI wrapper for soundboard admin
├── .gitignore              ✅ Excludes: New Pages Plan.md, Current State.md, Task Tracker Write-Back Feature Plan.md
├── themes/
│   ├── quake2.css          ✅ Quake II color-only theme (35+ variable overrides)
│   └── textures/
│       └── quake2/         ⬚ Empty — ready for Phase 4 texture assets
├── data/
│   ├── tools.json          ✅ 38 entries across 11 categories — ready for more
│   ├── websites.json       ✅ 25 entries across 5 categories (incl. Indie Web) — ready for more
│   ├── youtube.json        ✅ 114 channels with profile images
│   ├── photos.json         ⬚ Empty [] — needs photo entries + images
│   ├── art.json            ✅ 2 entries (Sebastian Pether) — ready for more
│   ├── paranormal.json      ⬚ Empty [] — needs paranormal entries (videos, articles, photos, writing, etc.)
│   └── soundboards/
│       ├── index.json      ✅ 5-board manifest (Half-Life: 20 clips, others: 0) — all boards use image icons
│       ├── halflife.json   ✅ 20 clips across Scientists + G-Man categories
│       ├── theyhunger.json ⬚ Empty categories — ready for clips
│       ├── quake2.json     ⬚ Empty categories — ready for clips
│       └── rlm.json        ⬚ Empty categories — ready for clips
├── img/
│   ├── Icons/
│   │   ├── Soundboards/    ✅ Character images organized by board subfolder — used as nav icons + category headers
│   │   │   ├── Half-Life/      ✅ Scientist_1_No_BG.png, Scientist_2_No_BG.png, Scientist_3_No_BG.png, G-Man_No_BG.png
│   │   │   ├── Max_Payne/      ✅ Max_Payne_No_BG.png
│   │   │   ├── They_Hunger/    ✅ They_Hunger_Boy_No_BG.webp, ChesterRockwood_No_BG.png
│   │   │   ├── Quake2/         ✅ Bitterman_No_BG.png
│   │   │   └── RLM/            ✅ Mike_Stoklasa_No_BG.png, Jay_RLM_No_BG.png, Rich_No_BG.png, Rich_2_No_BG.png
│   │   └── icons/          ✅ Custom PNG icons organized by page (Alan's_Brain, Art, Audio_Related, Cool_Links, Explore, Grapenuts, No_Sound, Nothing_To_See, Other, Paranormal, Photo_Gallery, Pride_and_Identity, Search, UFO, Under_Construction, Youtube_Channels)
│   ├── youtube/            ✅ Channel profile pictures
│   ├── photos/
│   │   ├── full/           ⬚ Empty — for full-resolution photos
│   │   └── thumbs/         ⬚ Empty — for ~600px thumbnails
│   └── art/
│       ├── full/           ✅ 2 full-size artworks
│       └── thumbs/         ✅ 2 thumbnails
└── audio/
    └── halflife/           ✅ 23 .wav clips (Scientists + G-Man)
```

**Directories not yet created** (create as needed):
- `img/paranormal/` — for paranormal entry images
- `audio/theyhunger/`, `audio/maxpayne/`, `audio/quake2/`, `audio/rlm/` — audio clip folders per board

-----

## What's Left

### Theme System Phase 4: Quake II Full Skin

The color-only theme is in place. The next step is to elevate it from "brown website" to "this IS Quake 2":

1. **Textures** — Extract tiled textures from Q2 PAK files, place in `themes/textures/quake2/`:
   - `surface.png` — stone/metal for card backgrounds (128x128, tiled with `background-blend-mode: overlay`)
   - `nav-bg.png` — darker metal for nav bar
   - `card-bg.png` — alternate surface for variety
   - Use `image-rendering: pixelated` to preserve chunky pixels
2. **UI Chrome** — Beveled borders, reduced border-radius (2px), inset shadows:
   - `border-color: #5a4a28 #2a1a08 #2a1a08 #5a4a28` (classic beveled look)
   - `box-shadow: inset 1px 1px 0 rgba(255,255,255,0.08), inset -1px -1px 0 rgba(0,0,0,0.3)`
3. **Pixel font** — Load `Press Start 2P` or similar chunky pixel font, override `--font-display`
4. **Scanline overlay** — `body::after` with `repeating-linear-gradient` for CRT feel
5. ~~**Brain SVG**~~ — ✅ Done: CSS variables integrated into inline SVG gradient `stop-color` attributes

### Theme System Phase 5: Additional Themes

Each new theme = a CSS file + texture folder + one line in the `THEMES` object:
- **PS1** — Sony grays & blues, chunky polygonal energy
- **Doom** — STBAR browns, red accents, metal textures

### Phase 4: Pride and Identity — Content & Enhancement

**File:** `transart.html` — shell page built, needs content and polish.

**What's done:**
- HTML page with page hero, Art/Resources tab toggle, nav, footer, theme support
- JSON-driven rendering for both artists (`data/transart-artists.json`) and resources (`data/transart-resources.json`)
- Crisis resource banner (auto-pins resources with `"crisis": true` at top of Resources tab)
- Resource grouping by category
- Artist cards with photo, name, pronouns, bio, category tags
- CSS for crisis banner, artist cards, resource sections, empty states
- Empty states for both tabs ("coming soon" messaging)

**What's left to build:**
1. **Content population** — Alan curates artist profiles and resource listings
2. ~~**Trans flag color accents**~~ — ✅ Done: title gradient, pink tagline, decorative gradient bar, resource category heading borders
3. **Artist artwork thumbnails** — 1–3 artwork thumbnails per artist opening in lightbox
4. **Social links** on artist cards
5. **Collapsible accordion** for resource categories (optional enhancement)

**JSON schemas:**
- `data/transart-artists.json` — `{ name, pronouns, photo, bio, categories[], links{}, artworks[] }`
- `data/transart-resources.json` — `{ name, description, category, region, url, phone, crisis }`
- `data/transart-polyamory.json` — `{ name, description, url, type }` — currently empty, ready for content

**Sensitivity considerations:**
- Welcoming, safe, affirming tone
- Clear, inclusive language
- Crisis resources impossible to miss
- Content accuracy matters (healthcare/legal info) — Alan will curate

### Phase 5: Polish & Connect (Final)

1. ~~**Update `index.html`**~~ — ✅ Done: "Explore" section with 7 clickable cards (YouTube, Great & Free, Soundboards, Art Gallery, Trans Art, Paranormal, Photo Gallery) in responsive grid layout with Live/Growing/Soon status tags.

2. ~~**Cross-linking**~~ — ✅ Done: "More from Alan's Brain" footer sections on all 7 Explore pages with 3 related page links each.

3. **Easter eggs:**
   - Paranormal-themed animation — CSS keyframes for the paranormal page. Could be triggered by a secret key combo or random timer.
   - Page-specific surprises (e.g., Konami code on any page)

4. **Performance audit:**
   - Verify `loading="lazy"` on all images
   - Check page load times on mobile (especially soundboards page with Web Audio)
   - Ensure JSON fetches fail gracefully on all pages (they already do)
   - Test all pages at 380px, 600px, and 700px+ breakpoints

5. **Image optimization pipeline** — Build a simple Node/sharp CLI script:
   - Input: drop full-res images into `img/{page}/full/`
   - Output: auto-generates thumbnails (~600px wide) in `img/{page}/thumbs/` + converts to WebP
   - Keep it lightweight — single script, no build system

6. **Content population reminders** — These JSON files need Alan's input:
   - `data/photos.json` — Add photo entries (needs actual images in `img/photos/`)
   - `data/art.json` — Add more artwork entries (2 entries so far)
   - `data/paranormal.json` — Add paranormal entries (videos, articles, photos, writing, etc.)
   - `data/soundboards/*.json` — Add clip data per remaining boards (Half-Life done, 4 boards at 0 clips: They Hunger, Max Payne, Quake 2, RLM — JSON files and icons ready, just needs audio files + clip entries)
   - `data/transart-artists.json` — Add artist profiles (Phase 4)
   - `data/transart-resources.json` — Add resource listings (Phase 4)

-----

## Git History (This Project)

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
| `0c2caff` | Replace emoji icons with custom PNGs, rename Trans Art to Pride and Identity, add soundboard enhancements |
| `9ccaaba` | Update icons: new galaxy Explore icon, refreshed Paranormal icon, adjust icon sizes |
| `6a7f75d` | Add polyamory heart icon to empty state, update UFO attribution |
| `dc9e5fc` | Update UFO icon with new design |
| `9c2ea14` | Replace remaining emoji icons (no-sound, references, theme picker) with custom PNGs |
| `52b4f77` | Icon refresh: new Explore cloud, eye empty state, construction badge, search icon, updated no-sound |
| *(merge)* | Merge `claude/homepage-layout-updates-UslXV`: remove Links nav, move Cool Links to websites.json, update description, enlarge soundboard styles |
| `5ff2f13` | Add visit counter ticker with GoatCounter integration, remove "No tracking. No ads." from footer |
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
| `3a05083` | Soundboard icon cover-crop, Grape-Nuts mobile scroll growth, weighted image rotation |

-----

## Resolved Design Decisions

These were answered by Alan at the start of the session:

1. **Navigation:** Dropdown menu + a dedicated "Explore" landing page (both, not one or the other)
2. **Trans Art page:** Fully public — no passphrase
3. **Soundboards:** Audio clips not yet extracted — Alan handles that, we build the structure
4. **Photo/Art galleries:** 25–50 images to start
5. **UFO cases:** Titled "Those That Matter to Me, Thus Far..." — personal, open-ended
6. **Homepage:** Keep minimal — use Explore page as hub, may revisit later
7. **Image pipeline:** Yes — auto-thumbnail generation via simple Node/sharp script
8. **Tasks page:** Security through obscurity — no nav links, accessible only by direct URL
