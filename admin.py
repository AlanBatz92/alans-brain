#!/usr/bin/env python3
"""
Alan's Brain — Admin CLI

Unified management script for soundboards, media optimization, and future
admin tasks.  Extensible: each command group is a self-contained section
that registers its commands in the GROUPS dict.

Usage:
  python admin.py <group> <command> [args...]
  python admin.py gui                        Launch the GUI

Groups:
  soundboard   Manage soundboard clips, boards, categories, quotes, icons
  media        Compress images, generate WebP, convert audio

Examples:
  python admin.py soundboard add halflife Scientists hello.wav
  python admin.py soundboard list
  python admin.py media art --dry-run
  python admin.py media report
  python admin.py gui
"""

import json
import os
import sys
import re
import io
import shutil
import glob
import subprocess

# Fix Windows console encoding for emoji output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    from PIL import Image
except ImportError:
    Image = None

# ── Paths ─────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data", "soundboards")
AUDIO_DIR = os.path.join(SCRIPT_DIR, "audio")
ICONS_DIR = os.path.join(SCRIPT_DIR, "img", "Icons", "Soundboards")
INDEX_FILE = os.path.join(DATA_DIR, "index.json")
IMG_DIR = os.path.join(SCRIPT_DIR, "img")

# ── JSON helpers ──────────────────────────────────────────────────────


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
    """Derive a human-readable label from a filename."""
    name = os.path.splitext(filename)[0]
    name = name.replace("_", " ").replace("-", " ")
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    name = re.sub(r"(?<=[a-zA-Z])(?=\d)", " ", name)
    name = re.sub(r"(?<=\d)(?=[a-zA-Z])", " ", name)
    return name.title()


def find_category(data, cat_name):
    for cat in data.get("categories", []):
        if cat["name"].lower() == cat_name.lower():
            return cat
    return None


def sync_clip_counts():
    """Recalculate all clipCount values in index.json from actual board data."""
    index = load_index()
    changes = []
    for board in index:
        bid = board["id"]
        data = load_board(bid)
        if data:
            total = sum(len(cat["clips"]) for cat in data.get("categories", []))
        else:
            total = 0
        if board["clipCount"] != total:
            changes.append(f"  {board['name']}: {board['clipCount']} -> {total}")
            board["clipCount"] = total
    save_index(index)
    if changes:
        print("Updated clip counts:")
        for c in changes:
            print(c)
    else:
        print("All clip counts already in sync.")


def icons_folder_for_board(board_id):
    """Find the existing Icons/Soundboards subfolder for a board."""
    if not os.path.isdir(ICONS_DIR):
        return board_id
    for name in os.listdir(ICONS_DIR):
        if name.lower().replace("_", "").replace("-", "") == board_id.lower().replace("_", "").replace("-", ""):
            return name
    index = load_index()
    for b in index:
        if b["id"] == board_id and "/" in b.get("icon", ""):
            parts = b["icon"].replace("\\", "/").split("/")
            for i, p in enumerate(parts):
                if p == "Soundboards" and i + 1 < len(parts) - 1:
                    return parts[i + 1]
    return board_id


# =====================================================================
#  GROUP: soundboard
# =====================================================================


def sb_add(args):
    if len(args) < 3:
        print("Usage: soundboard add <board> <category> <file> [--label \"Label\"] [--quote \"Quote\"]")
        sys.exit(1)

    board_id, cat_name, filename = args[0], args[1], args[2]
    label = None
    quote = None
    if "--label" in args:
        li = args.index("--label")
        if li + 1 < len(args):
            label = args[li + 1]
    if "--quote" in args:
        qi = args.index("--quote")
        if qi + 1 < len(args):
            quote = args[qi + 1]

    if label is None:
        label = label_from_filename(filename)

    audio_path = os.path.join(AUDIO_DIR, board_id, filename)
    if not os.path.exists(audio_path):
        print(f"WARNING: Audio file not found: audio/{board_id}/{filename}")
        print("  Make sure to place the file there before deploying.")

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' has no data file. Run 'soundboard new-board' first.")
        sys.exit(1)

    cat = find_category(data, cat_name)
    if cat is None:
        print(f"Error: Category '{cat_name}' not found in board '{board_id}'.")
        print(f"  Available: {', '.join(c['name'] for c in data.get('categories', []))}")
        sys.exit(1)

    for clip in cat["clips"]:
        if clip["file"] == filename:
            print(f"Clip '{filename}' already exists in {cat_name}. Skipping.")
            return

    cat["clips"].append({"label": label, "file": filename})

    if quote:
        if "quotes" not in data:
            data["quotes"] = []
        if quote not in data["quotes"]:
            data["quotes"].append(quote)
            print(f"Quote added: \"{quote}\"")
        else:
            print(f"Quote already exists: \"{quote}\"")

    save_board(board_id, data)
    sync_clip_counts()
    print(f"Added: \"{label}\" ({filename}) -> {board_id}/{cat_name}")

    if not quote:
        try:
            q = input("Add a subtitle/quote for this board? (Enter to skip): ").strip()
            if q:
                if "quotes" not in data:
                    data["quotes"] = []
                if q not in data["quotes"]:
                    data["quotes"].append(q)
                    save_board(board_id, data)
                    print(f"Quote added: \"{q}\"")
                else:
                    print(f"Quote already exists: \"{q}\"")
        except (EOFError, KeyboardInterrupt):
            pass


def sb_bulk(args):
    if len(args) < 3:
        print("Usage: soundboard bulk <board> <category> <file1> <file2> ...")
        sys.exit(1)

    board_id, cat_name = args[0], args[1]
    files = args[2:]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' has no data file.")
        sys.exit(1)

    cat = find_category(data, cat_name)
    if cat is None:
        print(f"Error: Category '{cat_name}' not found. Run 'soundboard new-category' first.")
        sys.exit(1)

    existing = {clip["file"] for clip in cat["clips"]}
    added = 0
    for filename in files:
        if filename in existing:
            print(f"  Skipped (duplicate): {filename}")
            continue
        audio_path = os.path.join(AUDIO_DIR, board_id, filename)
        if not os.path.exists(audio_path):
            print(f"  WARNING: {filename} not found in audio/{board_id}/")
        label = label_from_filename(filename)
        cat["clips"].append({"label": label, "file": filename})
        print(f"  Added: \"{label}\" ({filename})")
        added += 1

    save_board(board_id, data)
    sync_clip_counts()
    print(f"\nDone: {added} clip(s) added to {board_id}/{cat_name}")

    if added > 0:
        try:
            while True:
                q = input("Add a subtitle/quote? (Enter to skip, or type quote): ").strip()
                if not q:
                    break
                if "quotes" not in data:
                    data["quotes"] = []
                if q not in data["quotes"]:
                    data["quotes"].append(q)
                    save_board(board_id, data)
                    print(f"  Quote added: \"{q}\"")
                else:
                    print(f"  Quote already exists: \"{q}\"")
        except (EOFError, KeyboardInterrupt):
            pass


def sb_new_board(args):
    if len(args) < 3:
        print("Usage: soundboard new-board <id> <name> <icon>")
        sys.exit(1)

    board_id, name, icon = args[0], args[1], args[2]

    index = load_index()
    for b in index:
        if b["id"] == board_id:
            print(f"Board '{board_id}' already exists in index.")
            sys.exit(1)

    index.append({"id": board_id, "name": name, "icon": icon, "clipCount": 0})
    save_index(index)

    board_path = board_json_path(board_id)
    if not os.path.exists(board_path):
        save_board(board_id, {"categories": []})
        print(f"Created: data/soundboards/{board_id}.json")

    audio_dir = os.path.join(AUDIO_DIR, board_id)
    os.makedirs(audio_dir, exist_ok=True)
    print(f"Created: audio/{board_id}/")
    print(f"Board '{name}' ({icon}) is ready. Add categories with 'soundboard new-category'.")


def sb_new_category(args):
    if len(args) < 2:
        print("Usage: soundboard new-category <board> <category>")
        sys.exit(1)

    board_id, cat_name = args[0], args[1]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' has no data file.")
        sys.exit(1)

    if find_category(data, cat_name):
        print(f"Category '{cat_name}' already exists in '{board_id}'.")
        sys.exit(1)

    data["categories"].append({"name": cat_name, "clips": []})
    save_board(board_id, data)
    print(f"Added category '{cat_name}' to board '{board_id}'.")


def sb_remove(args):
    if len(args) < 3:
        print("Usage: soundboard remove <board> <category> <file>")
        sys.exit(1)

    board_id, cat_name, filename = args[0], args[1], args[2]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' not found.")
        sys.exit(1)

    cat = find_category(data, cat_name)
    if cat is None:
        print(f"Error: Category '{cat_name}' not found.")
        sys.exit(1)

    original_len = len(cat["clips"])
    cat["clips"] = [c for c in cat["clips"] if c["file"] != filename]
    if len(cat["clips"]) == original_len:
        print(f"Clip '{filename}' not found in {cat_name}.")
        sys.exit(1)

    save_board(board_id, data)
    sync_clip_counts()
    print(f"Removed '{filename}' from {board_id}/{cat_name}.")


def sb_add_icon(args):
    if len(args) < 3:
        print("Usage: soundboard add-icon <board> <category> <image-file>")
        sys.exit(1)

    board_id, cat_name, image_file = args[0], args[1], args[2]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' not found.")
        sys.exit(1)

    folder_name = icons_folder_for_board(board_id)
    dest_dir = os.path.join(ICONS_DIR, folder_name)
    os.makedirs(dest_dir, exist_ok=True)

    if os.path.exists(image_file):
        dest_path = os.path.join(dest_dir, os.path.basename(image_file))
        if os.path.abspath(image_file) != os.path.abspath(dest_path):
            shutil.copy2(image_file, dest_path)
            print(f"Copied: {image_file} -> {dest_path}")
        rel_path = "img/Icons/Soundboards/" + folder_name + "/" + os.path.basename(image_file)
    else:
        check_path = os.path.join(dest_dir, image_file)
        if not os.path.exists(check_path):
            print(f"WARNING: Image not found: {check_path}")
        rel_path = "img/Icons/Soundboards/" + folder_name + "/" + image_file

    if "icons" not in data:
        data["icons"] = {}

    existing = data["icons"].get(cat_name)
    if existing is None:
        data["icons"][cat_name] = rel_path
        print(f"Added icon for '{cat_name}': {rel_path}")
    elif isinstance(existing, str):
        if existing == rel_path:
            print(f"Icon already exists for '{cat_name}': {rel_path}")
            return
        data["icons"][cat_name] = [existing, rel_path]
        print(f"Added icon for '{cat_name}': {rel_path}")
        print(f"  Now rotates between {len(data['icons'][cat_name])} images.")
    elif isinstance(existing, list):
        if rel_path in existing:
            print(f"Icon already exists for '{cat_name}': {rel_path}")
            return
        existing.append(rel_path)
        print(f"Added icon for '{cat_name}': {rel_path}")
        print(f"  Now rotates between {len(existing)} images.")

    save_board(board_id, data)


def sb_remove_icon(args):
    if len(args) < 3:
        print("Usage: soundboard remove-icon <board> <category> <image-path>")
        sys.exit(1)

    board_id, cat_name, image_path = args[0], args[1], args[2]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' not found.")
        sys.exit(1)

    icons = data.get("icons", {})
    existing = icons.get(cat_name)
    if existing is None:
        print(f"No icons found for category '{cat_name}' in '{board_id}'.")
        sys.exit(1)

    if isinstance(existing, str):
        if existing == image_path:
            del icons[cat_name]
            print(f"Removed icon for '{cat_name}': {image_path}")
        else:
            print(f"Icon not found: {image_path}")
            print(f"  Current: {existing}")
            sys.exit(1)
    elif isinstance(existing, list):
        if image_path not in existing:
            print(f"Icon not found: {image_path}")
            print(f"  Current: {existing}")
            sys.exit(1)
        existing.remove(image_path)
        if len(existing) == 1:
            icons[cat_name] = existing[0]
        elif len(existing) == 0:
            del icons[cat_name]
        print(f"Removed icon for '{cat_name}': {image_path}")
        remaining = icons.get(cat_name)
        if remaining:
            count = len(remaining) if isinstance(remaining, list) else 1
            print(f"  {count} icon(s) remaining.")

    save_board(board_id, data)


def sb_add_quote(args):
    if len(args) < 2:
        print("Usage: soundboard add-quote <board> \"Quote text\"")
        sys.exit(1)

    board_id, quote = args[0], args[1]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' not found.")
        sys.exit(1)

    if "quotes" not in data:
        data["quotes"] = []

    if quote in data["quotes"]:
        print(f"Quote already exists in '{board_id}'.")
        return

    data["quotes"].append(quote)
    save_board(board_id, data)
    print(f"Added quote to {board_id}: \"{quote}\"")
    print(f"  Total quotes: {len(data['quotes'])}")


def sb_remove_quote(args):
    if len(args) < 2:
        print("Usage: soundboard remove-quote <board> \"Quote text\"")
        sys.exit(1)

    board_id, quote = args[0], args[1]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' not found.")
        sys.exit(1)

    quotes = data.get("quotes", [])
    if quote not in quotes:
        print(f"Quote not found in '{board_id}'.")
        if quotes:
            print("  Existing quotes:")
            for q in quotes:
                print(f"    \"{q}\"")
        sys.exit(1)

    data["quotes"].remove(quote)
    save_board(board_id, data)
    print(f"Removed quote from {board_id}: \"{quote}\"")
    print(f"  Remaining quotes: {len(data['quotes'])}")


def sb_list(args):
    index = load_index()
    if len(args) == 0:
        print("Soundboards:")
        print("-" * 40)
        for b in index:
            status = f"{b['clipCount']} clips" if b["clipCount"] > 0 else "empty"
            print(f"  {b['name']} ({b['id']}) — {status}")
        return

    board_id = args[0]
    data = load_board(board_id)
    if data is None:
        print(f"Board '{board_id}' has no data file.")
        return

    board_name = board_id
    for b in index:
        if b["id"] == board_id:
            board_name = b["name"]
            break

    print(f"Board: {board_name}")
    print("-" * 40)
    quotes = data.get("quotes", [])
    if quotes:
        print(f"\n  Quotes ({len(quotes)}):")
        for q in quotes:
            print(f"    \"{q}\"")
    icons = data.get("icons", {})
    if icons:
        print(f"\n  Icons ({len(icons)} categories):")
        for cat_name, val in icons.items():
            if isinstance(val, list):
                print(f"    {cat_name}: [{len(val)} images, rotates]")
                for v in val:
                    print(f"      {v}")
            else:
                print(f"    {cat_name}: {val}")
    for cat in data.get("categories", []):
        print(f"\n  {cat['name']} ({len(cat['clips'])} clips):")
        for clip in cat["clips"]:
            audio_path = os.path.join(AUDIO_DIR, board_id, clip["file"])
            exists = "OK" if os.path.exists(audio_path) else "MISSING"
            print(f"    {clip['label']:30s}  {clip['file']:25s}  {exists}")


SOUNDBOARD_COMMANDS = {
    "add": sb_add,
    "bulk": sb_bulk,
    "new-board": sb_new_board,
    "new-category": sb_new_category,
    "remove": sb_remove,
    "add-quote": sb_add_quote,
    "remove-quote": sb_remove_quote,
    "add-icon": sb_add_icon,
    "remove-icon": sb_remove_icon,
    "list": sb_list,
    "sync": lambda a: sync_clip_counts(),
}


# =====================================================================
#  GROUP: media
# =====================================================================


def fmt_size(n):
    if n < 1024:
        return f"{n}B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f}KB"
    return f"{n / (1024 * 1024):.1f}MB"


def get_file_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def require_pillow():
    if Image is None:
        print("Error: Pillow is required. Install with: pip install Pillow")
        sys.exit(1)


def find_images(directory, extensions=("*.png", "*.jpg", "*.jpeg")):
    files = []
    for ext in extensions:
        files.extend(glob.glob(os.path.join(directory, "**", ext), recursive=True))
        files.extend(glob.glob(os.path.join(directory, ext)))
    return sorted(set(files))


def optimize_png(path, max_size=None, quantize=False, dry_run=False):
    before = get_file_size(path)
    img = Image.open(path)
    if max_size and (img.width > max_size or img.height > max_size):
        img.thumbnail((max_size, max_size), Image.LANCZOS)
    if quantize and img.mode in ("RGBA", "RGB"):
        if img.mode == "RGBA":
            img = img.quantize(colors=256, method=Image.FASTOCTREE).convert("RGBA")
        else:
            img = img.quantize(colors=256, method=Image.MEDIANCUT).convert("RGB")
    if not dry_run:
        img.save(path, "PNG", optimize=True)
    after = get_file_size(path) if not dry_run else before
    return before, after, img


def optimize_jpeg(path, max_width=None, quality=82, dry_run=False):
    before = get_file_size(path)
    img = Image.open(path)
    if img.mode == "RGBA":
        img = img.convert("RGB")
    if max_width and img.width > max_width:
        ratio = max_width / img.width
        new_h = int(img.height * ratio)
        img = img.resize((max_width, new_h), Image.LANCZOS)
    if not dry_run:
        img.save(path, "JPEG", quality=quality, optimize=True)
    after = get_file_size(path) if not dry_run else before
    return before, after, img


def generate_webp(img, original_path, quality=80, dry_run=False):
    base, _ = os.path.splitext(original_path)
    webp_path = base + ".webp"
    if img.mode == "P":
        img = img.convert("RGBA")
    if not dry_run:
        img.save(webp_path, "WEBP", quality=quality)
    size = get_file_size(webp_path) if not dry_run else 0
    return webp_path, size


def print_media_result(path, before, after, webp_path=None, webp_size=0, dry_run=False):
    rel = os.path.relpath(path, SCRIPT_DIR)
    saved = before - after
    tag = "[DRY RUN] " if dry_run else ""
    line = f"  {tag}{rel}: {fmt_size(before)} -> {fmt_size(after)} (saved {fmt_size(saved)})"
    if webp_path:
        webp_rel = os.path.relpath(webp_path, SCRIPT_DIR)
        line += f" | WebP: {fmt_size(webp_size)} ({webp_rel})"
    print(line)


def media_art(dry_run=False):
    require_pillow()
    full_dir = os.path.join(IMG_DIR, "art", "full")
    thumb_dir = os.path.join(IMG_DIR, "art", "thumbs")
    total_before = total_after = total_webp = 0

    print("=== Art: Full-size images ===")
    for path in find_images(full_dir, ("*.jpg", "*.jpeg")):
        before, after, img = optimize_jpeg(path, max_width=2000, quality=82, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_media_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print("\n=== Art: Thumbnails ===")
    for path in find_images(thumb_dir, ("*.jpg", "*.jpeg")):
        before, after, img = optimize_jpeg(path, max_width=400, quality=75, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=75, dry_run=dry_run)
        print_media_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nArt total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def media_youtube(dry_run=False):
    require_pillow()
    yt_dir = os.path.join(IMG_DIR, "youtube")
    total_before = total_after = total_webp = 0

    print("=== YouTube channel icons ===")
    for path in find_images(yt_dir, ("*.png",)):
        before, after, img = optimize_png(path, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_media_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nYouTube total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def media_icons(dry_run=False):
    require_pillow()
    icons_dir = os.path.join(IMG_DIR, "Icons", "icons")
    total_before = total_after = total_webp = 0

    print("=== UI/Nav icons ===")
    for path in find_images(icons_dir, ("*.png",)):
        before, after, img = optimize_png(path, max_size=96, quantize=True, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_media_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nIcons total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def media_soundboards(dry_run=False):
    require_pillow()
    sb_dir = os.path.join(IMG_DIR, "Icons", "Soundboards")
    total_before = total_after = total_webp = 0

    print("=== Soundboard character images ===")
    for path in find_images(sb_dir, ("*.png",)):
        before, after, img = optimize_png(path, max_size=300, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_media_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nSoundboards total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def media_audio(dry_run=False):
    total_before = total_after = 0

    print("=== Audio: WAV -> OGG ===")
    wav_files = glob.glob(os.path.join(AUDIO_DIR, "**", "*.wav"), recursive=True)
    if not wav_files:
        print("  No WAV files found.")
        return

    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("Error: ffmpeg not found on PATH.")
        return

    for wav_path in sorted(wav_files):
        base, _ = os.path.splitext(wav_path)
        ogg_path = base + ".ogg"
        before = get_file_size(wav_path)
        rel = os.path.relpath(wav_path, SCRIPT_DIR)
        tag = "[DRY RUN] " if dry_run else ""

        if not dry_run:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", wav_path, "-c:a", "libvorbis", "-q:a", "3", ogg_path],
                capture_output=True,
            )
            if result.returncode != 0:
                print(f"  {tag}{rel}: FAILED - {result.stderr.decode('utf-8', errors='replace')[:200]}")
                continue

        after = get_file_size(ogg_path) if not dry_run else 0
        total_before += before
        total_after += after
        print(f"  {tag}{rel}: {fmt_size(before)} -> OGG {fmt_size(after)}")

    print(f"\nAudio total: {fmt_size(total_before)} -> {fmt_size(total_after)}")


def media_report(dry_run=False):
    print("=== Media Size Report ===\n")

    dirs = [
        ("img/youtube", "YouTube channel icons"),
        ("img/art/full", "Art full-size"),
        ("img/art/thumbs", "Art thumbnails"),
        ("img/Icons/icons", "UI/Nav icons"),
        ("img/Icons/Soundboards", "Soundboard characters"),
        ("audio", "Audio files"),
    ]

    grand_total = 0
    for rel_dir, label in dirs:
        full_path = os.path.join(SCRIPT_DIR, rel_dir)
        if not os.path.isdir(full_path):
            print(f"  {label}: (directory not found)")
            continue

        total = 0
        count = 0
        largest_file = ""
        largest_size = 0

        for root, _, files in os.walk(full_path):
            for f in files:
                fp = os.path.join(root, f)
                size = get_file_size(fp)
                total += size
                count += 1
                if size > largest_size:
                    largest_size = size
                    largest_file = f

        grand_total += total
        print(f"  {label}: {count} files, {fmt_size(total)}")
        if largest_file:
            print(f"    Largest: {largest_file} ({fmt_size(largest_size)})")

    print(f"\n  TOTAL: {fmt_size(grand_total)}")


def media_all(dry_run=False):
    media_art(dry_run)
    print()
    media_youtube(dry_run)
    print()
    media_icons(dry_run)
    print()
    media_soundboards(dry_run)
    print()
    media_audio(dry_run)


def media_dispatch(args):
    if len(args) < 1:
        print("Usage: media <command> [--dry-run]")
        print(f"  Commands: {', '.join(MEDIA_COMMANDS.keys())}")
        sys.exit(1)

    command = args[0]
    dry_run = "--dry-run" in args

    if command not in MEDIA_COMMANDS:
        print(f"Unknown media command: {command}")
        print(f"  Available: {', '.join(MEDIA_COMMANDS.keys())}")
        sys.exit(1)

    MEDIA_COMMANDS[command](dry_run)


MEDIA_COMMANDS = {
    "art": media_art,
    "youtube": media_youtube,
    "icons": media_icons,
    "soundboards": media_soundboards,
    "audio": media_audio,
    "all": media_all,
    "report": media_report,
}


# =====================================================================
#  Group registry — add new groups here
# =====================================================================

GROUPS = {
    "soundboard": {
        "description": "Manage soundboard clips, boards, categories, quotes, icons",
        "commands": SOUNDBOARD_COMMANDS,
    },
    "media": {
        "description": "Compress images, generate WebP, convert audio",
        "commands": MEDIA_COMMANDS,
        "dispatch": media_dispatch,
    },
}


# =====================================================================
#  Main
# =====================================================================


def print_help():
    print(__doc__)
    print("Commands by group:\n")
    for gname, ginfo in GROUPS.items():
        print(f"  {gname:14s}  {ginfo['description']}")
        for cname in ginfo["commands"]:
            print(f"    {gname} {cname}")
        print()


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print_help()
        sys.exit(0)

    group = sys.argv[1]

    # Launch GUI
    if group == "gui":
        # Import and launch from the GUI module
        script = os.path.join(SCRIPT_DIR, "admin-gui.py")
        os.execv(sys.executable, [sys.executable, script] + sys.argv[2:])

    if group not in GROUPS:
        print(f"Unknown group: {group}")
        print(f"Available groups: {', '.join(GROUPS.keys())}, gui")
        sys.exit(1)

    ginfo = GROUPS[group]

    # Groups with a custom dispatch (media handles --dry-run)
    if "dispatch" in ginfo:
        ginfo["dispatch"](sys.argv[2:])
        return

    # Standard command dispatch
    if len(sys.argv) < 3:
        print(f"Usage: admin.py {group} <command> [args...]")
        print(f"  Commands: {', '.join(ginfo['commands'].keys())}")
        sys.exit(1)

    command = sys.argv[2]
    args = sys.argv[3:]

    if command not in ginfo["commands"]:
        print(f"Unknown {group} command: {command}")
        print(f"  Available: {', '.join(ginfo['commands'].keys())}")
        sys.exit(1)

    ginfo["commands"][command](args)


if __name__ == "__main__":
    main()
