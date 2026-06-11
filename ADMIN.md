# Admin tool — `admin.py` + `admin-gui.py`

One tool to run the site's chores without living in a terminal: a Tkinter GUI
(`admin-gui.py`) with a sidebar of **panels**, backed by a CLI (`admin.py`) of
**command groups**. The GUI is a thin face over the CLI — every button shells
out to `python admin.py <group> <command>` and streams the output into a log, so
anything the GUI does, you can also script.

```
python admin.py gui            # launch the GUI
python admin.py <group> <cmd>  # or run a command directly
python admin.py                # help (lists every group + command)
```

It's built to be **extended**. Adding a new surface is two small steps — a CLI
group (the logic) and a GUI panel (the buttons). Both are plain registries; see
"Adding a panel" below.

---

## What's in it today

| Sidebar panel | CLI group | Does |
|---|---|---|
| **Soundboards** | `soundboard` | Add/edit clips, boards, categories, quotes, icons (JSON-driven) |
| **Media** | `media` | Compress images, generate WebP, convert audio |
| **Trains / Box** | `box` | Pull clips from birdstation, calibrate the horn profile, deploy it, sync vetting to the page |
| **Git** | `git` | Commit & push the repo to GitHub — publish changes without a terminal |

The **Git** panel is the "I just dropped in new artwork/photos/soundboard clips —
publish it" button: type a message, hit **Commit & Push**. (Vercel deploys the
site on push.)

---

## Configuration — `admin-config.json`

The `box` and `git` groups read **`admin-config.json`** (gitignored, per-machine).
Copy the example and edit:

```bash
cp admin-config.example.json admin-config.json
```

Anything you leave out falls back to the documented defaults in
`admin.py` → `ADMIN_CONFIG_DEFAULTS`. Keys: `box_host`, `box_repo`, `box_db`,
`box_clips_dir`, `box_services`, `corpus_dir`, `out_dir`, `verdicts_csv`,
`calibrate_python`. The Windows defaults assume the `C:\horn` layout from
`birdstation/HORN-CORPUS-GUIDE.md`; point `calibrate_python` at the venv that has
`librosa`/`scipy`/`numpy` so `box calibrate` works.

> The `box` commands SSH/scp to birdstation — they need `ssh`/`scp` on your PATH
> (built into Windows 11, macOS, Linux) and key/password access to the box. Every
> `box` command **prints the exact command before running it**, so the log
> doubles as a cheat-sheet (see also `COMMANDS.md`).

---

## Architecture (how the pieces fit)

**CLI side (`admin.py`).** A `GROUPS` dict maps a group name → either a dict of
`{command: fn}` or a custom `dispatch(args)` (used when a group wants flexible
flags). `main()` reads `sys.argv`, finds the group, and calls its dispatch.

```python
GROUPS = {
    "soundboard": {"commands": SOUNDBOARD_COMMANDS},
    "media":      {"commands": MEDIA_COMMANDS, "dispatch": media_dispatch},
    "box":        {"commands": BOX_COMMANDS,   "dispatch": box_dispatch},
    "git":        {"commands": GIT_COMMANDS,   "dispatch": git_dispatch},
}
```

Two shared helpers make new groups short:
- **`run_cmd(args, dry=False, cwd=None)`** — prints `$ …` then runs it (list = no
  shell; string = shell). Child stdout inherits ours, so it streams to the GUI.
- **`load_admin_config()`** — merges `admin-config.json` over the defaults.

**GUI side (`admin-gui.py`).** A `PANELS` list of `tk.Frame` subclasses; the app
builds one sidebar entry per `panel.LABEL` and instantiates `panel(parent,
set_status)`. New panels subclass **`CommandPanel`**, which gives you a titled
header, a toolbar to fill, and a log already wired to `admin.py`:

```python
class CommandPanel(tk.Frame):
    LABEL = "Command"          # sidebar text
    TITLE = "Command"          # header text
    # SUBTITLE = "..."         # optional muted header note
    def build_toolbar(self, bar): ...        # override: add your buttons/inputs
    def add_button(self, bar, text, fn): ...  # styled button
    def add_row(self, pady=(0,6)): ...        # a full-width row under the toolbar
    def run_admin(self, admin_args, label):   # stream `admin.py <args>` to the log
```

---

## Adding a panel (the whole recipe)

Say you want a **Photos** panel that optimizes new photos and publishes them.

**1. (If it needs new logic) add a CLI group** in `admin.py`:

```python
def photos_optimize(rest):
    run_cmd([sys.executable, os.path.join(SCRIPT_DIR, "admin.py"), "media", "all"])

PHOTOS_COMMANDS = {"optimize": photos_optimize}

def photos_dispatch(args):
    cmd, rest = (args[0], args[1:]) if args else ("", [])
    fn = PHOTOS_COMMANDS.get(cmd)
    if not fn: print("commands:", ", ".join(PHOTOS_COMMANDS)); return
    fn(rest)

# register it:
GROUPS["photos"] = {"commands": PHOTOS_COMMANDS, "dispatch": photos_dispatch}
```

**2. Add the GUI panel** in `admin-gui.py` (subclass `CommandPanel`):

```python
class PhotosPanel(CommandPanel):
    LABEL = "Photos"
    TITLE = "Photos"
    SUBTITLE = "optimize + publish"
    def build_toolbar(self, bar):
        self.add_button(bar, "Optimize", lambda: self.run_admin(["media", "all"], "optimize"))
        # need inputs? add a row:
        row = self.add_row()
        self.tag = tk.Entry(row, bg=BG_INPUT, fg=FG); self.tag.pack(side="left", ipady=4)
        self.add_button(row, "Publish", lambda: self.run_admin(
            ["git", "sync", "-m", self.tag.get() or "Add photos"], "publish"))

PANELS.append(PhotosPanel)   # or add it to the PANELS list literal
```

That's it — restart the GUI and "Photos" is in the sidebar. The same pattern
covers artwork, gallery JSON edits, a Pulse-source editor, a birdstation deploy
button, etc. Keep the *logic* in `admin.py` (scriptable, testable) and the panel
*thin* (just buttons that call `run_admin`).

### Conventions
- Theme colors live at the top of `admin-gui.py` (`BG`, `ACCENT`, …) — use them.
- Anything that touches the box or writes data should support a **dry run**
  (the `box` group does; the GUI exposes it as a checkbox).
- Print the underlying command (use `run_cmd`) so the log teaches the CLI.
- Update `COMMANDS.md` when you add a command worth remembering.

---

## Ideas parked for later panels
- **Gallery/Photos** — drop files in, optimize (`media`), edit the JSON, publish.
- **Pulse sources** — add/disable a `feed_sources` row over SSH.
- **birdstation deploy** — one button for `box deploy` (git pull + restart) — the
  `box` group already has it; surface it on the Box panel if handy.
- **Backups** — pull a dated copy of `birdnet.db` off the box.
