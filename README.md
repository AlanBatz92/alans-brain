# Alan's Brain

A personal indie web project. Built with HTML, CSS, and JS — no frameworks, no build step.

## Pages

| Page | Description |
|---|---|
| **Home** (`index.html`) | Landing page with Explore cards |
| **YouTube Channels** (`youtube.html`) | 114 curated channels with profile images |
| **Great & Free** (`tools.html`) | 40 tools + 25 websites across searchable categories |
| **Soundboards** (`soundboards.html`) | 5 boards with categorized audio clips, rotating character icons |
| **Art Gallery** (`art.html`) | Slideshow + lightbox gallery |
| **Photo Gallery** (`photos.html`) | Masonry photo grid |
| **Paranormal** (`paranormal.html`) | Curated paranormal media grid |
| **Pride and Identity** (`transart.html`) | Art, polyamory, and resources tabs |

## Running Locally

Open any HTML file in a browser. For soundboard audio and JSON data fetches to work, serve from a local HTTP server:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Admin Tools

Manage soundboard clips, icons, subtitles, and media assets without editing JSON by hand.

```bash
# GUI (tkinter)
python admin-gui.py

# CLI
python admin.py soundboard list
python admin.py soundboard sync
python admin.py media optimize
```

## Adding Content

Every page is JSON-driven. Edit the data file, drop in any media files, and the page handles the rest.

| Adding... | Edit this file | Files go here |
|---|---|---|
| A tool | `data/tools.json` | (URL only) |
| A website | `data/websites.json` | (URL only) |
| A YouTube channel | `data/youtube.json` | `img/youtube/` |
| A photo | `data/photos.json` | `img/photos/full/` + `img/photos/thumbs/` |
| An artwork | `data/art.json` | `img/art/full/` + `img/art/thumbs/` |
| A paranormal entry | `data/paranormal.json` | `img/paranormal/` (optional) |
| Soundboard clips | `data/soundboards/{id}.json` | `audio/{id}/` |

## Themes

Color themes swap via CSS custom properties. Current themes: **Deep Space** (default), **Quake II**. Toggle in the theme picker (bottom-right corner of any page).

## Tech

- Zero dependencies, zero build tools
- JSON data files + vanilla JS `fetch()` rendering
- GoatCounter for privacy-friendly analytics
- `<audio>` elements for iOS silent-switch compatibility
- Weighted random rotation for soundboard icons and quotes
