#!/usr/bin/env python3
"""
Alan's Brain — Admin GUI

Unified Tkinter management interface with sidebar navigation.
Each section is a self-contained panel — add new ones by subclassing
AdminPanel and registering in PANELS.

Launch:
  python admin-gui.py
  python admin.py gui
"""

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data", "soundboards")
AUDIO_DIR = os.path.join(SCRIPT_DIR, "audio")
ICONS_DIR = os.path.join(SCRIPT_DIR, "img", "Icons", "Soundboards")
INDEX_FILE = os.path.join(DATA_DIR, "index.json")
IMG_DIR = os.path.join(SCRIPT_DIR, "img")

# ── Theme colors (matching the site's dark theme) ────────────────────

BG = "#0f1923"
BG_CARD = "#1a2736"
BG_INPUT = "#243447"
FG = "#e0e8f0"
FG_DIM = "#7a8a9a"
ACCENT = "#2dd4a8"
ACCENT_HOVER = "#38e8ba"
RED = "#f05050"
RED_HOVER = "#ff6b6b"
YELLOW = "#f0c040"
BORDER = "#2a3a4a"

# ── Data helpers ─────────────────────────────────────────────────────


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load_index():
    return load_json(INDEX_FILE)


def save_index(index):
    save_json(INDEX_FILE, index)


def board_json_path(board_id):
    return os.path.join(DATA_DIR, board_id + ".json")


def load_board(board_id):
    path = board_json_path(board_id)
    if not os.path.exists(path):
        return None
    return load_json(path)


def save_board(board_id, data):
    save_json(board_json_path(board_id), data)


def label_from_filename(filename):
    name = os.path.splitext(filename)[0]
    name = name.replace("_", " ").replace("-", " ")
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    name = re.sub(r"(?<=[a-zA-Z])(?=\d)", " ", name)
    name = re.sub(r"(?<=\d)(?=[a-zA-Z])", " ", name)
    return name.title()


def sync_clip_counts():
    index = load_index()
    for board in index:
        data = load_board(board["id"])
        if data:
            board["clipCount"] = sum(
                len(cat["clips"]) for cat in data.get("categories", [])
            )
        else:
            board["clipCount"] = 0
    save_index(index)


def find_category(data, cat_name):
    for cat in data.get("categories", []):
        if cat["name"].lower() == cat_name.lower():
            return cat
    return None


def fmt_size(n):
    if n < 1024:
        return f"{n}B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f}KB"
    return f"{n / (1024 * 1024):.1f}MB"


# ── Audio playback helper ────────────────────────────────────────────

_player_proc = None  # track the subprocess so we can stop it


def play_audio(filepath, on_done=None):
    """Play an audio file. Tries pygame, falls back to ffplay, then os.startfile."""
    global _player_proc
    stop_audio()

    def _worker():
        global _player_proc
        try:
            # Try pygame first
            import pygame
            pygame.mixer.init()
            pygame.mixer.music.load(filepath)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                pygame.time.wait(100)
            if on_done:
                on_done()
            return
        except Exception:
            pass

        # Try ffplay (silent, no window)
        try:
            _player_proc = subprocess.Popen(
                ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", filepath],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            _player_proc.wait()
            _player_proc = None
            if on_done:
                on_done()
            return
        except FileNotFoundError:
            pass

        # Last resort: OS default player
        if sys.platform == "win32":
            os.startfile(filepath)
        if on_done:
            on_done()

    threading.Thread(target=_worker, daemon=True).start()


def stop_audio():
    global _player_proc
    try:
        import pygame
        if pygame.mixer.get_init():
            pygame.mixer.music.stop()
    except Exception:
        pass
    if _player_proc and _player_proc.poll() is None:
        _player_proc.terminate()
        _player_proc = None


# ── Widget helpers ───────────────────────────────────────────────────


def make_btn(parent, text, command, color=ACCENT, small=False, side="right"):
    font = ("Segoe UI", 9) if small else ("Segoe UI", 10, "bold")
    py = 2 if small else 5
    px = 8 if small else 14
    hover = ACCENT_HOVER if color == ACCENT else RED_HOVER if color == RED else color
    btn = tk.Label(
        parent, text=text, font=font, bg=color, fg=BG,
        padx=px, pady=py, cursor="hand2",
    )
    btn.pack(side=side, padx=(6, 0))
    btn.bind("<Button-1>", lambda e: command())
    btn.bind("<Enter>", lambda e: btn.configure(bg=hover))
    btn.bind("<Leave>", lambda e: btn.configure(bg=color))
    return btn


# =====================================================================
#  Soundboards Panel
# =====================================================================


class SoundboardPanel(tk.Frame):
    """Soundboard management — boards, categories, clips, quotes, icons."""

    LABEL = "Soundboards"

    def __init__(self, parent, set_status):
        super().__init__(parent, bg=BG)
        self.set_status = set_status
        self.current_board_id = None
        self.current_category = None
        self._build()
        self._refresh_boards()

    def _build(self):
        # Top toolbar
        top = tk.Frame(self, bg=BG_CARD, pady=8, padx=12)
        top.pack(fill="x")
        tk.Label(
            top, text="Soundboards", font=("Segoe UI", 14, "bold"),
            bg=BG_CARD, fg=ACCENT,
        ).pack(side="left")
        make_btn(top, "Sync Counts", self._on_sync, FG_DIM)
        make_btn(top, "+ New Board", self._on_new_board, ACCENT)

        # Paned: left (boards + categories) | right (clips)
        paned = tk.PanedWindow(
            self, orient="horizontal", bg=BG, sashwidth=4, sashrelief="flat",
        )
        paned.pack(fill="both", expand=True, padx=6, pady=6)

        # Left
        left = tk.Frame(paned, bg=BG, width=260)
        paned.add(left, minsize=200)

        tk.Label(left, text="BOARDS", font=("Segoe UI", 10, "bold"),
                 bg=BG, fg=FG_DIM, anchor="w").pack(fill="x", padx=4, pady=(0, 4))
        self.boards_frame = tk.Frame(left, bg=BG)
        self.boards_frame.pack(fill="x", padx=4)

        tk.Frame(left, bg=BORDER, height=1).pack(fill="x", padx=4, pady=10)

        cat_header = tk.Frame(left, bg=BG)
        cat_header.pack(fill="x", padx=4)
        tk.Label(cat_header, text="CATEGORIES", font=("Segoe UI", 10, "bold"),
                 bg=BG, fg=FG_DIM, anchor="w").pack(side="left")
        make_btn(cat_header, "+ Add", self._on_new_category, ACCENT, small=True)

        self.cats_frame = tk.Frame(left, bg=BG)
        self.cats_frame.pack(fill="both", expand=True, padx=4, pady=(4, 0))

        # Right (clips)
        right = tk.Frame(paned, bg=BG)
        paned.add(right, minsize=380)

        clips_header = tk.Frame(right, bg=BG)
        clips_header.pack(fill="x", padx=4, pady=(0, 6))
        self.clips_title = tk.Label(
            clips_header, text="Select a board and category",
            font=("Segoe UI", 12, "bold"), bg=BG, fg=FG, anchor="w",
        )
        self.clips_title.pack(side="left")
        make_btn(clips_header, "+ Add Sounds", self._on_add_clips, ACCENT)

        canvas_frame = tk.Frame(right, bg=BG)
        canvas_frame.pack(fill="both", expand=True)

        self.clips_canvas = tk.Canvas(canvas_frame, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.clips_canvas.yview)
        self.clips_inner = tk.Frame(self.clips_canvas, bg=BG)

        self.clips_inner.bind(
            "<Configure>",
            lambda e: self.clips_canvas.configure(scrollregion=self.clips_canvas.bbox("all")),
        )
        self.clips_canvas.create_window((0, 0), window=self.clips_inner, anchor="nw")
        self.clips_canvas.configure(yscrollcommand=scrollbar.set)

        self.clips_canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.clips_canvas.bind_all(
            "<MouseWheel>",
            lambda e: self.clips_canvas.yview_scroll(-1 * (e.delta // 120), "units"),
        )

    # ── Refresh ──────────────────────────────────────────────────────

    def _refresh_boards(self):
        for w in self.boards_frame.winfo_children():
            w.destroy()
        for b in load_index():
            bid = b["id"]
            is_active = bid == self.current_board_id
            bg = BG_INPUT if is_active else BG_CARD
            fg_color = ACCENT if is_active else FG

            row = tk.Frame(self.boards_frame, bg=bg, pady=6, padx=10, cursor="hand2")
            row.pack(fill="x", pady=2)
            row.bind("<Button-1>", lambda e, _id=bid: self._select_board(_id))

            info = tk.Frame(row, bg=bg)
            info.pack(side="left", padx=(0, 0))
            info.bind("<Button-1>", lambda e, _id=bid: self._select_board(_id))

            name_lbl = tk.Label(
                info, text=b["name"], font=("Segoe UI", 11, "bold"),
                bg=bg, fg=fg_color, anchor="w",
            )
            name_lbl.pack(anchor="w")
            name_lbl.bind("<Button-1>", lambda e, _id=bid: self._select_board(_id))

            count_lbl = tk.Label(
                info, text=f"{b['clipCount']} clips",
                font=("Segoe UI", 9), bg=bg, fg=FG_DIM, anchor="w",
            )
            count_lbl.pack(anchor="w")
            count_lbl.bind("<Button-1>", lambda e, _id=bid: self._select_board(_id))

    def _refresh_categories(self):
        for w in self.cats_frame.winfo_children():
            w.destroy()
        if not self.current_board_id:
            return
        data = load_board(self.current_board_id)
        if not data:
            return
        for cat in data.get("categories", []):
            cname = cat["name"]
            count = len(cat["clips"])
            is_active = cname == self.current_category
            bg = BG_INPUT if is_active else BG_CARD
            fg_color = ACCENT if is_active else FG

            row = tk.Frame(self.cats_frame, bg=bg, pady=5, padx=10, cursor="hand2")
            row.pack(fill="x", pady=2)
            row.bind("<Button-1>", lambda e, _c=cname: self._select_category(_c))

            lbl = tk.Label(row, text=cname, font=("Segoe UI", 10, "bold"), bg=bg, fg=fg_color)
            lbl.pack(side="left")
            lbl.bind("<Button-1>", lambda e, _c=cname: self._select_category(_c))

            tk.Label(row, text=f"({count})", font=("Segoe UI", 9), bg=bg, fg=FG_DIM).pack(side="left", padx=(6, 0))

            del_lbl = tk.Label(row, text="x", font=("Segoe UI", 9, "bold"), bg=bg, fg=RED, cursor="hand2", padx=4)
            del_lbl.pack(side="right")
            del_lbl.bind("<Button-1>", lambda e, _c=cname: self._on_delete_category(_c))

    def _refresh_clips(self):
        for w in self.clips_inner.winfo_children():
            w.destroy()
        if not self.current_board_id or not self.current_category:
            self.clips_title.configure(text="Select a board and category")
            self._render_quotes_section()
            return

        data = load_board(self.current_board_id)
        cat = find_category(data, self.current_category)
        if not cat:
            return

        board_name = self.current_board_id
        for b in load_index():
            if b["id"] == self.current_board_id:
                board_name = b["name"]
                break

        self.clips_title.configure(
            text=f"{board_name}  >  {self.current_category}  ({len(cat['clips'])} clips)"
        )

        if not cat["clips"]:
            tk.Label(
                self.clips_inner, text='No clips yet. Click "+ Add Sounds" to get started.',
                font=("Segoe UI", 11), bg=BG, fg=FG_DIM, pady=30,
            ).pack()
            self._render_quotes_section()
            return

        header = tk.Frame(self.clips_inner, bg=BG, pady=4)
        header.pack(fill="x", padx=4)
        tk.Label(header, text="LABEL", font=("Segoe UI", 9, "bold"), bg=BG, fg=FG_DIM, width=24, anchor="w").pack(side="left")
        tk.Label(header, text="FILE", font=("Segoe UI", 9, "bold"), bg=BG, fg=FG_DIM, width=22, anchor="w").pack(side="left")
        tk.Label(header, text="STATUS", font=("Segoe UI", 9, "bold"), bg=BG, fg=FG_DIM, width=8, anchor="w").pack(side="left")

        for i, clip in enumerate(cat["clips"]):
            stripe_bg = BG_CARD if i % 2 == 0 else BG
            row = tk.Frame(self.clips_inner, bg=stripe_bg, pady=6, padx=8)
            row.pack(fill="x", padx=4, pady=1)

            lbl = tk.Label(
                row, text=clip["label"], font=("Segoe UI", 10),
                bg=stripe_bg, fg=FG, width=24, anchor="w", cursor="hand2",
            )
            lbl.pack(side="left")
            lbl.bind("<Double-Button-1>", lambda e, _c=clip, _cat=cat["name"]: self._on_edit_label(_c, _cat))

            file_lbl = tk.Label(
                row, text=clip["file"], font=("Consolas", 9),
                bg=stripe_bg, fg=FG_DIM, width=22, anchor="w",
            )
            file_lbl.pack(side="left")

            audio_path = os.path.join(AUDIO_DIR, self.current_board_id, clip["file"])
            if os.path.exists(audio_path):
                tk.Label(row, text="OK", font=("Segoe UI", 9, "bold"), bg=stripe_bg, fg=ACCENT, width=8, anchor="w").pack(side="left")
            else:
                tk.Label(row, text="MISSING", font=("Segoe UI", 9, "bold"), bg=stripe_bg, fg=RED, width=8, anchor="w").pack(side="left")

            # Action buttons (right side, right-to-left)
            del_btn = tk.Label(
                row, text="Remove", font=("Segoe UI", 9),
                bg=stripe_bg, fg=RED, cursor="hand2", padx=6,
            )
            del_btn.pack(side="right")
            del_btn.bind(
                "<Button-1>",
                lambda e, _f=clip["file"], _cat=cat["name"]: self._on_remove_clip(_f, _cat),
            )

            rename_btn = tk.Label(
                row, text="Rename", font=("Segoe UI", 9),
                bg=stripe_bg, fg=YELLOW, cursor="hand2", padx=4,
            )
            rename_btn.pack(side="right")
            rename_btn.bind(
                "<Button-1>",
                lambda e, _c=clip, _cat=cat["name"]: self._on_rename_file(_c, _cat),
            )

            play_btn = tk.Label(
                row, text="\u25b6", font=("Segoe UI", 10),
                bg=stripe_bg, fg=ACCENT, cursor="hand2", padx=4,
            )
            play_btn.pack(side="right")
            play_btn.bind(
                "<Button-1>",
                lambda e, _path=audio_path, _lbl=clip["label"]: self._on_play(_path, _lbl),
            )

        self._render_quotes_section()

    # ── Quotes / Subtitles ──────────────────────────────────────────

    def _render_quotes_section(self):
        """Render the subtitles/quotes editor below clips for the current board."""
        if not self.current_board_id:
            return

        data = load_board(self.current_board_id)
        if not data:
            return
        quotes = data.get("quotes", [])

        # Separator
        tk.Frame(self.clips_inner, bg=BORDER, height=1).pack(fill="x", padx=4, pady=12)

        header = tk.Frame(self.clips_inner, bg=BG)
        header.pack(fill="x", padx=4, pady=(0, 6))

        board_name = self.current_board_id
        for b in load_index():
            if b["id"] == self.current_board_id:
                board_name = b["name"]
                break

        tk.Label(
            header, text=f"Subtitles \u2014 {board_name}  ({len(quotes)})",
            font=("Segoe UI", 11, "bold"), bg=BG, fg=FG, anchor="w",
        ).pack(side="left")
        make_btn(header, "+ Add", self._on_add_quote, ACCENT, small=True)

        if not quotes:
            tk.Label(
                self.clips_inner, text="No subtitles yet. These cycle randomly on the soundboard page.",
                font=("Segoe UI", 10), bg=BG, fg=FG_DIM, pady=8,
            ).pack(padx=8, anchor="w")
            return

        for i, quote in enumerate(quotes):
            stripe_bg = BG_CARD if i % 2 == 0 else BG
            row = tk.Frame(self.clips_inner, bg=stripe_bg, pady=4, padx=8)
            row.pack(fill="x", padx=4, pady=1)

            lbl = tk.Label(
                row, text=quote, font=("Segoe UI", 10),
                bg=stripe_bg, fg=FG, anchor="w", wraplength=400, justify="left",
                cursor="hand2",
            )
            lbl.pack(side="left", fill="x", expand=True)
            lbl.bind("<Double-Button-1>", lambda e, _i=i: self._on_edit_quote(_i))

            del_lbl = tk.Label(
                row, text="x", font=("Segoe UI", 9, "bold"),
                bg=stripe_bg, fg=RED, cursor="hand2", padx=6,
            )
            del_lbl.pack(side="right")
            del_lbl.bind("<Button-1>", lambda e, _i=i: self._on_delete_quote(_i))

    def _on_add_quote(self):
        text = simpledialog.askstring(
            "Add Subtitle", "Enter subtitle text:",
            parent=self.winfo_toplevel(),
        )
        if not text or not text.strip():
            return
        data = load_board(self.current_board_id)
        if "quotes" not in data:
            data["quotes"] = []
        data["quotes"].append(text.strip())
        save_board(self.current_board_id, data)
        self._refresh_clips()
        self.set_status(f"Added subtitle: {text.strip()[:40]}...")

    def _on_edit_quote(self, index):
        data = load_board(self.current_board_id)
        quotes = data.get("quotes", [])
        if index >= len(quotes):
            return
        new_text = simpledialog.askstring(
            "Edit Subtitle", "Edit subtitle text:",
            initialvalue=quotes[index], parent=self.winfo_toplevel(),
        )
        if not new_text or new_text.strip() == quotes[index]:
            return
        data["quotes"][index] = new_text.strip()
        save_board(self.current_board_id, data)
        self._refresh_clips()
        self.set_status(f"Updated subtitle #{index + 1}")

    def _on_delete_quote(self, index):
        data = load_board(self.current_board_id)
        quotes = data.get("quotes", [])
        if index >= len(quotes):
            return
        removed = quotes.pop(index)
        save_board(self.current_board_id, data)
        self._refresh_clips()
        self.set_status(f"Removed subtitle: {removed[:40]}...")

    # ── Selection ────────────────────────────────────────────────────

    def _select_board(self, board_id):
        self.current_board_id = board_id
        self.current_category = None
        data = load_board(board_id)
        if data and data.get("categories"):
            self.current_category = data["categories"][0]["name"]
        self._refresh_boards()
        self._refresh_categories()
        self._refresh_clips()
        self.set_status(f"Board: {board_id}")

    def _select_category(self, cat_name):
        self.current_category = cat_name
        self._refresh_categories()
        self._refresh_clips()

    # ── Actions ──────────────────────────────────────────────────────

    def _on_new_board(self):
        dlg = _NewBoardDialog(self)
        self.winfo_toplevel().wait_window(dlg)
        if dlg.result:
            bid, name, icon = dlg.result
            index = load_index()
            for b in index:
                if b["id"] == bid:
                    messagebox.showerror("Error", f"Board '{bid}' already exists.")
                    return
            index.append({"id": bid, "name": name, "icon": icon, "clipCount": 0})
            save_index(index)
            if not os.path.exists(board_json_path(bid)):
                save_board(bid, {"categories": []})
            os.makedirs(os.path.join(AUDIO_DIR, bid), exist_ok=True)
            self._refresh_boards()
            self._select_board(bid)
            self.set_status(f"Created board: {name}")

    def _on_new_category(self):
        if not self.current_board_id:
            messagebox.showinfo("Info", "Select a board first.")
            return
        name = simpledialog.askstring("New Category", "Category name:", parent=self.winfo_toplevel())
        if not name or not name.strip():
            return
        name = name.strip()
        data = load_board(self.current_board_id)
        if find_category(data, name):
            messagebox.showerror("Error", f"Category '{name}' already exists.")
            return
        data["categories"].append({"name": name, "clips": []})
        save_board(self.current_board_id, data)
        self._select_category(name)
        self._refresh_categories()
        self.set_status(f"Added category: {name}")

    def _on_delete_category(self, cat_name):
        data = load_board(self.current_board_id)
        cat = find_category(data, cat_name)
        count = len(cat["clips"]) if cat else 0
        msg = f"Delete category '{cat_name}'"
        if count:
            msg += f" and its {count} clip(s)"
        msg += "?"
        if not messagebox.askyesno("Confirm", msg):
            return
        data["categories"] = [c for c in data["categories"] if c["name"].lower() != cat_name.lower()]
        save_board(self.current_board_id, data)
        sync_clip_counts()
        if self.current_category == cat_name:
            self.current_category = None
        self._refresh_categories()
        self._refresh_clips()
        self._refresh_boards()
        self.set_status(f"Deleted category: {cat_name}")

    def _on_add_clips(self):
        if not self.current_board_id or not self.current_category:
            messagebox.showinfo("Info", "Select a board and category first.")
            return
        files = filedialog.askopenfilenames(
            title="Select sound files to add",
            filetypes=[("Audio files", "*.wav *.mp3 *.ogg *.flac *.m4a *.aac"), ("All files", "*.*")],
        )
        if not files:
            return

        data = load_board(self.current_board_id)
        cat = find_category(data, self.current_category)
        existing = {clip["file"] for clip in cat["clips"]}
        dest_dir = os.path.join(AUDIO_DIR, self.current_board_id)
        os.makedirs(dest_dir, exist_ok=True)

        added = 0
        skipped = []
        for filepath in files:
            filename = os.path.basename(filepath)
            if filename in existing:
                skipped.append(filename)
                continue
            dest = os.path.join(dest_dir, filename)
            if not os.path.exists(dest):
                shutil.copy2(filepath, dest)
            label = label_from_filename(filename)
            cat["clips"].append({"label": label, "file": filename})
            existing.add(filename)
            added += 1

        save_board(self.current_board_id, data)
        sync_clip_counts()
        self._refresh_clips()
        self._refresh_boards()
        self._refresh_categories()

        msg = f"Added {added} clip(s)"
        if skipped:
            msg += f", skipped {len(skipped)} duplicate(s)"
        self.set_status(msg)

    def _on_remove_clip(self, filename, cat_name):
        if not messagebox.askyesno("Confirm", f"Remove '{filename}' from {cat_name}?"):
            return
        data = load_board(self.current_board_id)
        cat = find_category(data, cat_name)
        cat["clips"] = [c for c in cat["clips"] if c["file"] != filename]
        save_board(self.current_board_id, data)
        sync_clip_counts()
        self._refresh_clips()
        self._refresh_boards()
        self._refresh_categories()
        self.set_status(f"Removed: {filename}")

    def _on_edit_label(self, clip, cat_name):
        new_label = simpledialog.askstring(
            "Edit Label", "New label:", initialvalue=clip["label"],
            parent=self.winfo_toplevel(),
        )
        if not new_label or new_label.strip() == clip["label"]:
            return
        data = load_board(self.current_board_id)
        cat = find_category(data, cat_name)
        for c in cat["clips"]:
            if c["file"] == clip["file"]:
                c["label"] = new_label.strip()
                break
        save_board(self.current_board_id, data)
        self._refresh_clips()
        self.set_status(f"Renamed to: {new_label.strip()}")

    def _on_play(self, audio_path, label):
        if not os.path.exists(audio_path):
            self.set_status(f"File missing: {os.path.basename(audio_path)}")
            return
        self.set_status(f"Playing: {label}")
        play_audio(audio_path, on_done=lambda: self.after(0, self.set_status, "Ready"))

    def _on_rename_file(self, clip, cat_name):
        old_name = clip["file"]
        ext = os.path.splitext(old_name)[1]
        new_name = simpledialog.askstring(
            "Rename File", f"New filename (include extension like {ext}):",
            initialvalue=old_name, parent=self.winfo_toplevel(),
        )
        if not new_name or new_name.strip() == old_name:
            return
        new_name = new_name.strip()

        src = os.path.join(AUDIO_DIR, self.current_board_id, old_name)
        dst = os.path.join(AUDIO_DIR, self.current_board_id, new_name)

        if os.path.exists(dst) and dst != src:
            messagebox.showerror("Error", f"File '{new_name}' already exists.")
            return

        # Rename on disk
        if os.path.exists(src):
            os.rename(src, dst)

        # Update all references in this board's JSON
        data = load_board(self.current_board_id)
        for cat in data.get("categories", []):
            for c in cat["clips"]:
                if c["file"] == old_name:
                    c["file"] = new_name
        save_board(self.current_board_id, data)

        self._refresh_clips()
        self.set_status(f"Renamed: {old_name} -> {new_name}")

    def _on_sync(self):
        sync_clip_counts()
        self._refresh_boards()
        self.set_status("Clip counts synced.")


# ── New Board dialog ─────────────────────────────────────────────────


class _NewBoardDialog(tk.Toplevel):
    def __init__(self, parent):
        super().__init__(parent.winfo_toplevel())
        self.title("New Soundboard")
        self.configure(bg=BG_CARD)
        self.geometry("380x240")
        self.resizable(False, False)
        self.result = None

        pad = {"padx": 16, "pady": (8, 0)}
        tk.Label(self, text="Board ID (lowercase, no spaces):", bg=BG_CARD, fg=FG, font=("Segoe UI", 10)).pack(anchor="w", **pad)
        self.e_id = tk.Entry(self, bg=BG_INPUT, fg=FG, font=("Segoe UI", 11), insertbackground=FG)
        self.e_id.pack(fill="x", padx=16, pady=(2, 0))

        tk.Label(self, text="Display Name:", bg=BG_CARD, fg=FG, font=("Segoe UI", 10)).pack(anchor="w", **pad)
        self.e_name = tk.Entry(self, bg=BG_INPUT, fg=FG, font=("Segoe UI", 11), insertbackground=FG)
        self.e_name.pack(fill="x", padx=16, pady=(2, 0))

        tk.Label(self, text="Icon (emoji or image path):", bg=BG_CARD, fg=FG, font=("Segoe UI", 10)).pack(anchor="w", **pad)
        self.e_icon = tk.Entry(self, bg=BG_INPUT, fg=FG, font=("Segoe UI Emoji", 14), insertbackground=FG, width=4)
        self.e_icon.pack(anchor="w", padx=16, pady=(2, 0))

        btn_frame = tk.Frame(self, bg=BG_CARD)
        btn_frame.pack(fill="x", padx=16, pady=16)
        tk.Button(btn_frame, text="Create", bg=ACCENT, fg=BG, font=("Segoe UI", 10, "bold"),
                  command=self._submit, relief="flat", padx=16, pady=4).pack(side="right")
        tk.Button(btn_frame, text="Cancel", bg=BG_INPUT, fg=FG, font=("Segoe UI", 10),
                  command=self.destroy, relief="flat", padx=16, pady=4).pack(side="right", padx=(0, 8))

        self.e_id.focus_set()
        self.grab_set()

    def _submit(self):
        bid = self.e_id.get().strip().lower()
        name = self.e_name.get().strip()
        icon = self.e_icon.get().strip()
        if not bid or not name:
            messagebox.showerror("Error", "ID and Name are required.", parent=self)
            return
        if not icon:
            icon = "img/Icons/icons/Audio_Related/speaker.png"
        self.result = (bid, name, icon)
        self.destroy()


# =====================================================================
#  Media Panel
# =====================================================================


class MediaPanel(tk.Frame):
    """Media optimization — compress images, generate WebP, convert audio."""

    LABEL = "Media"

    def __init__(self, parent, set_status):
        super().__init__(parent, bg=BG)
        self.set_status = set_status
        self._build()

    def _build(self):
        top = tk.Frame(self, bg=BG_CARD, pady=8, padx=12)
        top.pack(fill="x")
        tk.Label(
            top, text="Media Optimization", font=("Segoe UI", 14, "bold"),
            bg=BG_CARD, fg=ACCENT,
        ).pack(side="left")

        # Command buttons
        btn_frame = tk.Frame(self, bg=BG, pady=10, padx=12)
        btn_frame.pack(fill="x")

        commands = [
            ("Art", "art"),
            ("YouTube", "youtube"),
            ("Icons", "icons"),
            ("Soundboards", "soundboards"),
            ("Audio", "audio"),
            ("All", "all"),
            ("Report", "report"),
        ]

        for label, cmd in commands:
            btn = tk.Label(
                btn_frame, text=label, font=("Segoe UI", 10, "bold"),
                bg=ACCENT, fg=BG, padx=14, pady=6, cursor="hand2",
            )
            btn.pack(side="left", padx=(0, 8))
            btn.bind("<Button-1>", lambda e, _c=cmd: self._run_command(_c))
            btn.bind("<Enter>", lambda e, b=btn: b.configure(bg=ACCENT_HOVER))
            btn.bind("<Leave>", lambda e, b=btn: b.configure(bg=ACCENT))

        # Dry-run checkbox
        self.dry_run_var = tk.BooleanVar(value=False)
        cb = tk.Checkbutton(
            btn_frame, text="Dry Run", variable=self.dry_run_var,
            bg=BG, fg=FG, selectcolor=BG_INPUT, activebackground=BG,
            activeforeground=FG, font=("Segoe UI", 10),
        )
        cb.pack(side="left", padx=(12, 0))

        # Output log
        log_frame = tk.Frame(self, bg=BG)
        log_frame.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        self.log = tk.Text(
            log_frame, bg=BG_INPUT, fg=FG, font=("Consolas", 10),
            wrap="word", state="disabled", highlightthickness=0,
            insertbackground=FG,
        )
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=scrollbar.set)
        self.log.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def _append_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _run_command(self, cmd):
        import subprocess
        import sys

        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

        dry_flag = " --dry-run" if self.dry_run_var.get() else ""
        self._append_log(f"$ admin.py media {cmd}{dry_flag}\n")
        self.set_status(f"Running: media {cmd}...")

        def _worker():
            try:
                script = os.path.join(SCRIPT_DIR, "admin.py")
                args = [sys.executable, script, "media", cmd]
                if self.dry_run_var.get():
                    args.append("--dry-run")
                proc = subprocess.Popen(
                    args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace",
                )
                for line in proc.stdout:
                    self.after(0, self._append_log, line.rstrip())
                proc.wait()
                self.after(0, self.set_status, f"Done: media {cmd} (exit {proc.returncode})")
            except Exception as exc:
                self.after(0, self._append_log, f"ERROR: {exc}")
                self.after(0, self.set_status, f"Error running media {cmd}")

        threading.Thread(target=_worker, daemon=True).start()


# =====================================================================
#  Main App — sidebar + panel area
# =====================================================================

# Panel registry — add new panels here
PANELS = [SoundboardPanel, MediaPanel]


class AdminApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Alan's Brain — Admin")
        self.geometry("1020x720")
        self.configure(bg=BG)
        self.minsize(800, 550)

        self.panels = {}
        self.active_panel = None

        self._build()
        # Select first panel
        if PANELS:
            self._select_panel(PANELS[0].LABEL)

    def _build(self):
        # Sidebar
        self.sidebar = tk.Frame(self, bg=BG_CARD, width=160)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        tk.Label(
            self.sidebar, text="Admin", font=("Segoe UI", 14, "bold"),
            bg=BG_CARD, fg=ACCENT, pady=12,
        ).pack(fill="x")

        tk.Frame(self.sidebar, bg=BORDER, height=1).pack(fill="x", padx=8)

        self.nav_labels = {}
        for panel_cls in PANELS:
            label = panel_cls.LABEL
            lbl = tk.Label(
                self.sidebar, text=label, font=("Segoe UI", 11),
                bg=BG_CARD, fg=FG, pady=10, padx=16, anchor="w", cursor="hand2",
            )
            lbl.pack(fill="x")
            lbl.bind("<Button-1>", lambda e, _l=label: self._select_panel(_l))
            self.nav_labels[label] = lbl

        # Main content area
        self.content = tk.Frame(self, bg=BG)
        self.content.pack(side="left", fill="both", expand=True)

        # Status bar
        self.status = tk.Label(
            self, text="Ready", font=("Segoe UI", 9),
            bg=BG_CARD, fg=FG_DIM, anchor="w", padx=12, pady=4,
        )
        self.status.pack(fill="x", side="bottom")

        # Create all panels (hidden)
        for panel_cls in PANELS:
            panel = panel_cls(self.content, self._set_status)
            self.panels[panel_cls.LABEL] = panel

    def _set_status(self, msg):
        self.status.configure(text=msg)

    def _select_panel(self, label):
        if self.active_panel:
            self.panels[self.active_panel].pack_forget()

        # Update sidebar highlighting
        for nav_label, lbl in self.nav_labels.items():
            if nav_label == label:
                lbl.configure(bg=BG_INPUT, fg=ACCENT)
            else:
                lbl.configure(bg=BG_CARD, fg=FG)

        self.panels[label].pack(fill="both", expand=True)
        self.active_panel = label


if __name__ == "__main__":
    app = AdminApp()
    app.mainloop()
