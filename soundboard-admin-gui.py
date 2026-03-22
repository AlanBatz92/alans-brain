#!/usr/bin/env python3
"""
Soundboard Admin GUI — visual tool for managing soundboard data.
Launch:  python soundboard-admin-gui.py
"""

import json
import os
import re
import shutil
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data", "soundboards")
AUDIO_DIR = os.path.join(SCRIPT_DIR, "audio")
INDEX_FILE = os.path.join(DATA_DIR, "index.json")

# -- Colors (matching the site's dark theme) --
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


# ── Data helpers (same logic as CLI script) ──────────────────────────


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


# ── GUI ──────────────────────────────────────────────────────────────


class SoundboardAdminApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Soundboard Admin")
        self.geometry("960x700")
        self.configure(bg=BG)
        self.minsize(800, 550)

        # State
        self.current_board_id = None
        self.current_category = None

        self._build_ui()
        self._refresh_boards()

    # ── UI construction ──────────────────────────────────────────────

    def _build_ui(self):
        # Top bar
        top = tk.Frame(self, bg=BG_CARD, pady=10, padx=16)
        top.pack(fill="x")
        tk.Label(
            top, text="Soundboard Admin", font=("Segoe UI", 16, "bold"),
            bg=BG_CARD, fg=ACCENT,
        ).pack(side="left")

        btn_frame = tk.Frame(top, bg=BG_CARD)
        btn_frame.pack(side="right")
        self._make_btn(btn_frame, "+ New Board", self._on_new_board, ACCENT)
        self._make_btn(btn_frame, "Sync Counts", self._on_sync, FG_DIM)

        # Main paned layout: left (boards+categories) | right (clips)
        paned = tk.PanedWindow(
            self, orient="horizontal", bg=BG, sashwidth=4, sashrelief="flat",
        )
        paned.pack(fill="both", expand=True, padx=8, pady=8)

        # ── Left panel ───────────────────────────────────────────────
        left = tk.Frame(paned, bg=BG, width=280)
        paned.add(left, minsize=220)

        # Boards list
        lbl_boards = tk.Label(
            left, text="BOARDS", font=("Segoe UI", 10, "bold"),
            bg=BG, fg=FG_DIM, anchor="w",
        )
        lbl_boards.pack(fill="x", padx=4, pady=(0, 4))

        self.boards_frame = tk.Frame(left, bg=BG)
        self.boards_frame.pack(fill="x", padx=4)

        # Separator
        tk.Frame(left, bg=BORDER, height=1).pack(fill="x", padx=4, pady=10)

        # Categories list
        cat_header = tk.Frame(left, bg=BG)
        cat_header.pack(fill="x", padx=4)
        tk.Label(
            cat_header, text="CATEGORIES", font=("Segoe UI", 10, "bold"),
            bg=BG, fg=FG_DIM, anchor="w",
        ).pack(side="left")
        self.btn_new_cat = self._make_btn(
            cat_header, "+ Add", self._on_new_category, ACCENT, small=True,
        )

        self.cats_frame = tk.Frame(left, bg=BG)
        self.cats_frame.pack(fill="both", expand=True, padx=4, pady=(4, 0))

        # ── Right panel (clips) ──────────────────────────────────────
        right = tk.Frame(paned, bg=BG)
        paned.add(right, minsize=400)

        # Clips header
        clips_header = tk.Frame(right, bg=BG)
        clips_header.pack(fill="x", padx=4, pady=(0, 6))
        self.clips_title = tk.Label(
            clips_header, text="Select a board and category",
            font=("Segoe UI", 12, "bold"), bg=BG, fg=FG, anchor="w",
        )
        self.clips_title.pack(side="left")
        self.btn_add_clips = self._make_btn(
            clips_header, "+ Add Sounds", self._on_add_clips, ACCENT,
        )

        # Scrollable clip list
        canvas_frame = tk.Frame(right, bg=BG)
        canvas_frame.pack(fill="both", expand=True)

        self.clips_canvas = tk.Canvas(canvas_frame, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(
            canvas_frame, orient="vertical", command=self.clips_canvas.yview,
        )
        self.clips_inner = tk.Frame(self.clips_canvas, bg=BG)

        self.clips_inner.bind(
            "<Configure>",
            lambda e: self.clips_canvas.configure(
                scrollregion=self.clips_canvas.bbox("all")
            ),
        )
        self.clips_canvas.create_window((0, 0), window=self.clips_inner, anchor="nw")
        self.clips_canvas.configure(yscrollcommand=scrollbar.set)

        self.clips_canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Mouse wheel scrolling
        self.clips_canvas.bind_all(
            "<MouseWheel>",
            lambda e: self.clips_canvas.yview_scroll(-1 * (e.delta // 120), "units"),
        )

        # Status bar
        self.status = tk.Label(
            self, text="Ready", font=("Segoe UI", 9),
            bg=BG_CARD, fg=FG_DIM, anchor="w", padx=12, pady=4,
        )
        self.status.pack(fill="x", side="bottom")

    # ── Widget helpers ───────────────────────────────────────────────

    def _make_btn(self, parent, text, command, color, small=False):
        font = ("Segoe UI", 9) if small else ("Segoe UI", 10, "bold")
        py = 2 if small else 5
        px = 8 if small else 14
        btn = tk.Label(
            parent, text=text, font=font, bg=color, fg=BG,
            padx=px, pady=py, cursor="hand2",
        )
        btn.pack(side="right" if not small else "right", padx=(6, 0))
        btn.bind("<Button-1>", lambda e: command())
        btn.bind("<Enter>", lambda e: btn.configure(bg=ACCENT_HOVER if color == ACCENT else RED_HOVER if color == RED else color))
        btn.bind("<Leave>", lambda e: btn.configure(bg=color))
        return btn

    def _set_status(self, msg):
        self.status.configure(text=msg)

    # ── Refresh functions ────────────────────────────────────────────

    def _refresh_boards(self):
        for w in self.boards_frame.winfo_children():
            w.destroy()

        index = load_index()
        for b in index:
            bid = b["id"]
            is_active = bid == self.current_board_id
            bg = BG_INPUT if is_active else BG_CARD
            fg_color = ACCENT if is_active else FG

            row = tk.Frame(self.boards_frame, bg=bg, pady=6, padx=10, cursor="hand2")
            row.pack(fill="x", pady=2)
            row.bind("<Button-1>", lambda e, _id=bid: self._select_board(_id))

            icon_lbl = tk.Label(
                row, text=b["icon"], font=("Segoe UI Emoji", 14),
                bg=bg, fg=fg_color,
            )
            icon_lbl.pack(side="left")
            icon_lbl.bind("<Button-1>", lambda e, _id=bid: self._select_board(_id))

            info = tk.Frame(row, bg=bg)
            info.pack(side="left", padx=(8, 0))
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

            tk.Label(
                row, text=cname, font=("Segoe UI", 10, "bold"),
                bg=bg, fg=fg_color,
            ).pack(side="left")
            for child in row.winfo_children():
                child.bind("<Button-1>", lambda e, _c=cname: self._select_category(_c))

            tk.Label(
                row, text=f"({count})", font=("Segoe UI", 9),
                bg=bg, fg=FG_DIM,
            ).pack(side="left", padx=(6, 0))

            # Delete category button
            del_lbl = tk.Label(
                row, text="x", font=("Segoe UI", 9, "bold"),
                bg=bg, fg=RED, cursor="hand2", padx=4,
            )
            del_lbl.pack(side="right")
            del_lbl.bind("<Button-1>", lambda e, _c=cname: self._on_delete_category(_c))

    def _refresh_clips(self):
        for w in self.clips_inner.winfo_children():
            w.destroy()

        if not self.current_board_id or not self.current_category:
            self.clips_title.configure(text="Select a board and category")
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
            return

        # Column headers
        header = tk.Frame(self.clips_inner, bg=BG, pady=4)
        header.pack(fill="x", padx=4)
        tk.Label(header, text="LABEL", font=("Segoe UI", 9, "bold"), bg=BG, fg=FG_DIM, width=28, anchor="w").pack(side="left")
        tk.Label(header, text="FILE", font=("Segoe UI", 9, "bold"), bg=BG, fg=FG_DIM, width=24, anchor="w").pack(side="left")
        tk.Label(header, text="STATUS", font=("Segoe UI", 9, "bold"), bg=BG, fg=FG_DIM, width=10, anchor="w").pack(side="left")

        for i, clip in enumerate(cat["clips"]):
            stripe_bg = BG_CARD if i % 2 == 0 else BG
            row = tk.Frame(self.clips_inner, bg=stripe_bg, pady=6, padx=8)
            row.pack(fill="x", padx=4, pady=1)

            # Editable label
            lbl = tk.Label(
                row, text=clip["label"], font=("Segoe UI", 10),
                bg=stripe_bg, fg=FG, width=28, anchor="w", cursor="hand2",
            )
            lbl.pack(side="left")
            lbl.bind("<Double-Button-1>", lambda e, _c=clip, _cat=cat["name"]: self._on_edit_label(_c, _cat))

            # Filename
            tk.Label(
                row, text=clip["file"], font=("Consolas", 9),
                bg=stripe_bg, fg=FG_DIM, width=24, anchor="w",
            ).pack(side="left")

            # File exists indicator
            audio_path = os.path.join(AUDIO_DIR, self.current_board_id, clip["file"])
            if os.path.exists(audio_path):
                tk.Label(row, text="OK", font=("Segoe UI", 9, "bold"), bg=stripe_bg, fg=ACCENT, width=10, anchor="w").pack(side="left")
            else:
                tk.Label(row, text="MISSING", font=("Segoe UI", 9, "bold"), bg=stripe_bg, fg=RED, width=10, anchor="w").pack(side="left")

            # Delete button
            del_btn = tk.Label(
                row, text="Remove", font=("Segoe UI", 9),
                bg=stripe_bg, fg=RED, cursor="hand2", padx=6,
            )
            del_btn.pack(side="right")
            del_btn.bind(
                "<Button-1>",
                lambda e, _f=clip["file"], _cat=cat["name"]: self._on_remove_clip(_f, _cat),
            )

    # ── Selection handlers ───────────────────────────────────────────

    def _select_board(self, board_id):
        self.current_board_id = board_id
        self.current_category = None

        data = load_board(board_id)
        if data and data.get("categories"):
            self.current_category = data["categories"][0]["name"]

        self._refresh_boards()
        self._refresh_categories()
        self._refresh_clips()
        self._set_status(f"Board: {board_id}")

    def _select_category(self, cat_name):
        self.current_category = cat_name
        self._refresh_categories()
        self._refresh_clips()

    # ── Action handlers ──────────────────────────────────────────────

    def _on_new_board(self):
        dlg = _NewBoardDialog(self)
        self.wait_window(dlg)
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
            self._set_status(f"Created board: {name}")

    def _on_new_category(self):
        if not self.current_board_id:
            messagebox.showinfo("Info", "Select a board first.")
            return
        name = simpledialog.askstring(
            "New Category", "Category name:",
            parent=self,
        )
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
        self._set_status(f"Added category: {name}")

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
        self._set_status(f"Deleted category: {cat_name}")

    def _on_add_clips(self):
        if not self.current_board_id or not self.current_category:
            messagebox.showinfo("Info", "Select a board and category first.")
            return

        files = filedialog.askopenfilenames(
            title="Select sound files to add",
            filetypes=[
                ("Audio files", "*.wav *.mp3 *.ogg *.flac *.m4a *.aac"),
                ("All files", "*.*"),
            ],
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

            # Copy the audio file into the board's audio folder
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
        self._set_status(msg)

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
        self._set_status(f"Removed: {filename}")

    def _on_edit_label(self, clip, cat_name):
        new_label = simpledialog.askstring(
            "Edit Label", "New label:", initialvalue=clip["label"],
            parent=self,
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
        self._set_status(f"Renamed to: {new_label.strip()}")

    def _on_sync(self):
        sync_clip_counts()
        self._refresh_boards()
        self._set_status("Clip counts synced.")


# ── New Board dialog ─────────────────────────────────────────────────


class _NewBoardDialog(tk.Toplevel):
    def __init__(self, parent):
        super().__init__(parent)
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

        tk.Label(self, text="Icon (emoji):", bg=BG_CARD, fg=FG, font=("Segoe UI", 10)).pack(anchor="w", **pad)
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
            icon = "🔊"
        self.result = (bid, name, icon)
        self.destroy()


if __name__ == "__main__":
    app = SoundboardAdminApp()
    app.mainloop()
