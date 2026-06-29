# UAP Shape Census — Workflow & Git Cheat-Sheet

Your go-to reference. When you think *"wait, how do I do this again?"* — it's here.
(Companion to `INGESTING.md` for the detail; this is the quick version.)

---

## 0. The one rule that prevents most pain

**Always start by getting on the branch and up to date:**

```powershell
cd C:\Users\Alan\Documents\github\alans-brain
git switch claude/ufo-shape-search-framework-z5gsku
git pull origin claude/ufo-shape-search-framework-z5gsku
```

Check which branch you're on any time:  `git branch --show-current`
(You keep ending up on `main` — that's the cause of half the git errors below.)

---

## 1. Add new books / interviews → publish

```powershell
git switch claude/ufo-shape-search-framework-z5gsku
git pull origin claude/ufo-shape-search-framework-z5gsku

# drop the .epub / .txt files into  ufo-shapes\sources\
cd ufo-shapes
python ingest.py --all        # registers new files, skips ones already done
python extract.py             # additive: re-does local books, carries the rest
python classify.py            # AI-confirm/reject (needs the API key, see §3)
python build.py               # writes the published JSON
python report.py              # sanity check: any dupes / empties? (optional)

cd ..
git add data/ufo-shapes
git commit -m "shape census: <what you added>"
git push origin claude/ufo-shape-search-framework-z5gsku
```

That's the whole loop. Commit **only `data/ufo-shapes`** — never the books.

---

## 2. Just re-run the AI pass (no new books)

Works on any clone, even without the books:

```powershell
cd ufo-shapes
python classify.py
python build.py
cd ..
git add data/ufo-shapes && git commit -m "shape census: AI pass" && git push origin claude/ufo-shape-search-framework-z5gsku
```

---

## 3. API key (once per computer)

```powershell
setx ANTHROPIC_API_KEY "sk-ant-...your key..."
```
Then **close and reopen** the terminal. Verify:  `echo $env:ANTHROPIC_API_KEY`
Key from console.anthropic.com → API keys.

---

## 4. Errors you've hit, and the exact fix

| Error / symptom | What it means | Fix |
|---|---|---|
| `src refspec ... does not match any` | You're on the wrong branch (usually `main`); your commit is fine, just stranded | `git push origin HEAD:claude/ufo-shape-search-framework-z5gsku` |
| `pathspec 'data/ufo-shapes' did not match` | You're **inside** `ufo-shapes\` | `cd ..` to the repo root first |
| `CONFLICT ... Automatic merge failed` | Local diverged from remote (you didn't edit code yourself) | `git merge --abort` → `git fetch origin` → `git reset --hard origin/claude/ufo-shape-search-framework-z5gsku` → re-run `python ingest.py --all` |
| `Pulling is not possible ... unmerged files` | A conflict is still open | Resolve it (row above) first |
| `extract.py` says a source was **skipped** | No local segments *and* not in committed data | Put its book in `sources\` and re-ingest, or ignore if intentional |
| `0 extractable text segments` on ingest | Scanned/image PDF or DRM EPUB | Needs OCR; it's skipped automatically |
| `python -c "..."` SyntaxError in PowerShell | Quote-escaping hell | Use a script (`python report.py`) instead of `-c` |

---

## 5. Always-true facts (so you can trust the system)

- **Books, `segments.jsonl`, and `work/` are git-ignored.** They never get committed and they **survive any `git reset`** — so resets are safe.
- **`extract.py` is additive.** You do *not* need every book on one machine; missing ones are carried forward from the committed data.
- **`classify.py` is resumable.** If it stops, just run it again — it never re-charges for work already done.
- **Only `data/ufo-shapes` gets committed** (the derived JSON: sources, mentions, summary). Short fair-use snippets only.
- **Re-ingesting** with the same `--id` replaces that source.

---

## 6. Reliability tiers (when ingesting)

- **1** — primary firsthand (witness's own testimony/transcript, official doc)
- **2** — verified third-party / corroborating record (named investigator, on-record official)
- **3** — secondary reporting or synthesis (most journalistic books)
- **4** — unverified community (forums, anonymous). Leads only.

---

## 7. Is my data trustworthy? — one command

```powershell
cd ufo-shapes
python report.py
```
Lists every source with its mention count + tier, and flags duplicates, empty
sources, or orphaned mentions. Ends with **✓ Looks clean** or a list of issues.
