# Adding sources to the UAP Shape Census — reference guide

A practical runbook for getting new material (books **or** transcribed interviews)
into the census. For the full design see `../PLAN-ufo-shapes.md`; for the toolkit
overview see `README.md`.

---

## The pipeline at a glance

```
ingest.py  →  extract.py  →  [classify.py]  →  build.py  →  git commit
 (per file)    (all sources)   (optional AI)    (publish)    (derived JSON only)
```

Run everything from inside the `ufo-shapes/` folder.

---

## 0. Where files go, and what's supported

- Put the source file in **`ufo-shapes/sources/`**.
- Formats:
  - **`.txt`** — transcribed interviews, notes, pasted text. Works with no extra installs.
  - **`.epub`** — best for books (clean text). Needs `pip install ebooklib beautifulsoup4`.
  - **`.pdf`** — born-digital only (real page numbers). Needs `pip install pymupdf`.
- The raw files are **git-ignored** — they never get committed. Only the derived,
  cited JSON under `data/ufo-shapes/` is committed.

> **Transcribed interviews are just `.txt` files.** Save each interview as a plain
> text file with a blank line between paragraphs (the ingester splits on blank
> lines; each paragraph becomes a locator like `para:14`).

---

## 1. Ingest — register the source + slice it into segments

**One file:**
```powershell
python ingest.py sources/weygandt_interview_2025.txt --id weygandt_2025 ^
    --title "Jonathan Weygandt — interview" --author "Jonathan Weygandt" ^
    --year 2025 --type interview --tier 1 ^
    --citation "Weygandt interview (2025)"
```
(PowerShell line-continuation is a backtick `` ` ``; the `^` above is cmd. Or just put
it all on one line and skip the continuations.)

**Several at once** — drop them all in `sources/` and run:
```powershell
python ingest.py --all
```
It walks every new file, suggests an `id` from the filename, prompts for the
metadata, and **skips anything already ingested**. Type `s` to skip a file.

Fields:
- `--id` — a short stable slug (also the folder name). Re-using an id **replaces** that source.
- `--type` — `book` | `interview` | `report` | `article`.
- `--tier` — reliability (see below).
- `--citation` — how it should read in a citation line on the site.

### Reliability tier — pick one

| Tier | Use for |
|---|---|
| **1** | Primary firsthand — a witness's own testimony/transcript, sworn statement, official/government document. |
| **2** | Verified third-party — a named investigator with a track record, an on-the-record official, a corroborating public record. |
| **3** | Secondary reporting or synthesis — most journalistic books. |
| **4** | Unverified community — forums, anonymous claims. Leads only. |

For your **transcribed interviews:** if it's the witness speaking firsthand about
their own experience, that's **Tier 1**. If it's a host/journalist synthesizing or
interviewing about others, it's **Tier 2–3**.

---

## 2. Extract — find shape mentions across ALL sources

```powershell
python extract.py
```
Writes `work/mentions.full.json` (local only). Run this after ingesting anything new
— it re-scans every ingested source, not just the new one.

> `extract.py` needs the source files present (it reads each source's segments). It
> only runs on the machine where you ingested.

---

## 3. (Optional, recommended) AI disambiguation

```powershell
python classify.py --limit 40     # trial first
python classify.py                # full run
```
Confirms each mention really describes a craft's shape, drops false positives, and
tags confirmed ones. Needs `ANTHROPIC_API_KEY` set (see `README.md`). Resumable.
Works with or without local segments (falls back to the committed `mentions.json`).

---

## 4. Build — the publish gate

```powershell
python build.py
```
Aggregates and writes the committed `data/ufo-shapes/{mentions,summary}.json`
(high-confidence + AI-confirmed only). Prints what it withheld.

---

## 5. Commit — derived data only

```powershell
cd ..
git add data/ufo-shapes
git commit -m "shape census: add Weygandt 2025 interview"
git push origin claude/ufo-shape-search-framework-z5gsku
```

The new source and its mentions now appear on the site (Paranormal → UAP Shape Census).

---

## Things worth remembering

- **Privacy / copyright.** Snippets (short quotes around each mention) get committed
  into `mentions.json` and shown publicly. Short fair-use quotes from published books
  are fine. **For a private or unpublished interview, those snippets would become
  public** — only ingest material you're comfortable quoting on the site, or keep
  sensitive ones out.
- **Books never get committed** — `.gitignore` keeps `sources/` local. Hand files to
  the machine directly; don't upload them to GitHub (that bypasses `.gitignore`).
- **Segments are local.** They live only where you ingested. To re-extract on another
  machine you'd need the source files there too — but `classify.py`/`build.py` can
  refine the already-published set anywhere.
- **Re-ingesting** a source with the same `--id` replaces it (use this to fix metadata
  or re-slice a file).
- **Growing the shape vocabulary.** If you notice a shape term being missed or a false
  positive, edit `shapes.json` (`aliases` = high-confidence, `review_aliases` =
  ambiguous), bump its `version`, then re-run `extract → build`.
