#!/usr/bin/env python3
"""
Soundboard Admin — helper script for managing soundboard data.

Usage:
  python soundboard-admin.py add <board> <category> <file> [--label "Custom Label"] [--quote "Quote text"]
  python soundboard-admin.py bulk <board> <category> <file1> <file2> ...
  python soundboard-admin.py new-board <id> <name> <icon>
  python soundboard-admin.py new-category <board> <category>
  python soundboard-admin.py remove <board> <category> <file>
  python soundboard-admin.py add-quote <board> "Quote text"
  python soundboard-admin.py remove-quote <board> "Quote text"
  python soundboard-admin.py add-icon <board> <category> <image-file>
  python soundboard-admin.py remove-icon <board> <category> <image-path>
  python soundboard-admin.py list [board]
  python soundboard-admin.py sync

Examples:
  python soundboard-admin.py add halflife G-Man choose2.wav
  python soundboard-admin.py add halflife G-Man choose2.wav --label "The Right Man"
  python soundboard-admin.py add halflife G-Man choose2.wav --label "The Right Man" --quote "The right man in the wrong place"
  python soundboard-admin.py bulk halflife Scientists hello.wav goodbye.wav
  python soundboard-admin.py new-board quake2 "Quake 2" "👾"
  python soundboard-admin.py new-category halflife "Vortigaunts"
  python soundboard-admin.py remove halflife Scientists stench.wav
  python soundboard-admin.py add-quote halflife "Unforeseen consequences"
  python soundboard-admin.py remove-quote halflife "Unforeseen consequences"
  python soundboard-admin.py add-icon halflife Scientists MyScientist_No_BG.png
  python soundboard-admin.py add-icon theyhunger default Zombie_No_BG.png
  python soundboard-admin.py list
  python soundboard-admin.py list halflife
  python soundboard-admin.py sync
"""

import json
import os
import sys
import re
import io

# Fix Windows console encoding for emoji output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data", "soundboards")
AUDIO_DIR = os.path.join(SCRIPT_DIR, "audio")
ICONS_DIR = os.path.join(SCRIPT_DIR, "img", "Icons", "Soundboards")
INDEX_FILE = os.path.join(DATA_DIR, "index.json")


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
    """Derive a human-readable label from a filename.
    e.g. 'helloFreeman.wav' -> 'Hello Freeman'
         'cant_be_serious.wav' -> 'Cant Be Serious'
         'choose1.wav' -> 'Choose 1'
    """
    name = os.path.splitext(filename)[0]
    # Replace underscores/hyphens with spaces
    name = name.replace("_", " ").replace("-", " ")
    # Insert spaces before uppercase letters (camelCase splitting)
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    # Insert space between letters and numbers
    name = re.sub(r"(?<=[a-zA-Z])(?=\d)", " ", name)
    name = re.sub(r"(?<=\d)(?=[a-zA-Z])", " ", name)
    # Title case
    return name.title()


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


def find_category(data, cat_name):
    for cat in data.get("categories", []):
        if cat["name"].lower() == cat_name.lower():
            return cat
    return None


def cmd_add(args):
    if len(args) < 3:
        print("Usage: add <board> <category> <file> [--label \"Label\"] [--quote \"Quote\"]")
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

    # Check audio file exists
    audio_path = os.path.join(AUDIO_DIR, board_id, filename)
    if not os.path.exists(audio_path):
        print(f"WARNING: Audio file not found: audio/{board_id}/{filename}")
        print("  Make sure to place the file there before deploying.")

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' has no data file. Run 'new-board' first.")
        sys.exit(1)

    cat = find_category(data, cat_name)
    if cat is None:
        print(f"Error: Category '{cat_name}' not found in board '{board_id}'.")
        print(f"  Available categories: {', '.join(c['name'] for c in data.get('categories', []))}")
        print(f"  Run 'new-category {board_id} \"{cat_name}\"' to create it.")
        sys.exit(1)

    # Check for duplicate
    for clip in cat["clips"]:
        if clip["file"] == filename:
            print(f"Clip '{filename}' already exists in {cat_name}. Skipping.")
            return

    cat["clips"].append({"label": label, "file": filename})

    # Add quote if provided via flag
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

    # Interactive: offer to add a subtitle/quote
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


def cmd_bulk(args):
    if len(args) < 3:
        print("Usage: bulk <board> <category> <file1> <file2> ...")
        sys.exit(1)

    board_id, cat_name = args[0], args[1]
    files = args[2:]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' has no data file.")
        sys.exit(1)

    cat = find_category(data, cat_name)
    if cat is None:
        print(f"Error: Category '{cat_name}' not found. Run 'new-category' first.")
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

    # Interactive: offer to add subtitles/quotes
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


def cmd_new_board(args):
    if len(args) < 3:
        print("Usage: new-board <id> <name> <icon>")
        print("  Example: new-board quake2 \"Quake 2\" \"👾\"")
        sys.exit(1)

    board_id, name, icon = args[0], args[1], args[2]

    index = load_index()
    for b in index:
        if b["id"] == board_id:
            print(f"Board '{board_id}' already exists in index.")
            sys.exit(1)

    # Add to index
    index.append({"id": board_id, "name": name, "icon": icon, "clipCount": 0})
    save_index(index)

    # Create empty board JSON
    board_path = board_json_path(board_id)
    if not os.path.exists(board_path):
        save_board(board_id, {"categories": []})
        print(f"Created: data/soundboards/{board_id}.json")

    # Create audio directory
    audio_dir = os.path.join(AUDIO_DIR, board_id)
    os.makedirs(audio_dir, exist_ok=True)
    print(f"Created: audio/{board_id}/")

    print(f"Board '{name}' ({icon}) is ready. Add categories with 'new-category'.")


def cmd_new_category(args):
    if len(args) < 2:
        print("Usage: new-category <board> <category>")
        sys.exit(1)

    board_id, cat_name = args[0], args[1]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' has no data file. Run 'new-board' first.")
        sys.exit(1)

    if find_category(data, cat_name):
        print(f"Category '{cat_name}' already exists in '{board_id}'.")
        sys.exit(1)

    data["categories"].append({"name": cat_name, "clips": []})
    save_board(board_id, data)
    print(f"Added category '{cat_name}' to board '{board_id}'.")


def cmd_remove(args):
    if len(args) < 3:
        print("Usage: remove <board> <category> <file>")
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


def icons_folder_for_board(board_id):
    """Find the existing Icons/Soundboards subfolder for a board.
    Falls back to the board_id if no match is found."""
    if not os.path.isdir(ICONS_DIR):
        return board_id
    for name in os.listdir(ICONS_DIR):
        if name.lower().replace("_", "").replace("-", "") == board_id.lower().replace("_", "").replace("-", ""):
            return name
    # Check index.json icon path for folder name
    index = load_index()
    for b in index:
        if b["id"] == board_id and "/" in b.get("icon", ""):
            parts = b["icon"].replace("\\", "/").split("/")
            # Path like img/Icons/Soundboards/Half-Life/file.png
            for i, p in enumerate(parts):
                if p == "Soundboards" and i + 1 < len(parts) - 1:
                    return parts[i + 1]
    return board_id


def cmd_add_icon(args):
    if len(args) < 3:
        print("Usage: add-icon <board> <category> <image-file>")
        print("  <category> can be a category name (e.g. 'Scientists') or 'default' for all categories.")
        print("  <image-file> is an image file. If it's not already in the board's icon folder,")
        print("  it will be copied there automatically.")
        sys.exit(1)

    board_id, cat_name, image_file = args[0], args[1], args[2]

    data = load_board(board_id)
    if data is None:
        print(f"Error: Board '{board_id}' not found.")
        sys.exit(1)

    # Determine the board's icon folder
    folder_name = icons_folder_for_board(board_id)
    dest_dir = os.path.join(ICONS_DIR, folder_name)
    os.makedirs(dest_dir, exist_ok=True)

    # If the image is an absolute/relative path to an existing file, copy it in
    if os.path.exists(image_file):
        dest_path = os.path.join(dest_dir, os.path.basename(image_file))
        if os.path.abspath(image_file) != os.path.abspath(dest_path):
            shutil.copy2(image_file, dest_path)
            print(f"Copied: {image_file} -> {dest_path}")
        rel_path = "img/Icons/Soundboards/" + folder_name + "/" + os.path.basename(image_file)
    else:
        # Assume the file is already in the board's icon folder
        check_path = os.path.join(dest_dir, image_file)
        if not os.path.exists(check_path):
            print(f"WARNING: Image not found: {check_path}")
            print("  Make sure the file exists before deploying.")
        rel_path = "img/Icons/Soundboards/" + folder_name + "/" + image_file

    # Update the board JSON icons map
    if "icons" not in data:
        data["icons"] = {}

    existing = data["icons"].get(cat_name)
    if existing is None:
        # First icon for this category
        data["icons"][cat_name] = rel_path
        print(f"Added icon for '{cat_name}': {rel_path}")
    elif isinstance(existing, str):
        if existing == rel_path:
            print(f"Icon already exists for '{cat_name}': {rel_path}")
            return
        # Convert to array for rotation
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


def cmd_remove_icon(args):
    if len(args) < 3:
        print("Usage: remove-icon <board> <category> <image-path>")
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


def cmd_add_quote(args):
    if len(args) < 2:
        print("Usage: add-quote <board> \"Quote text\"")
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


def cmd_remove_quote(args):
    if len(args) < 2:
        print("Usage: remove-quote <board> \"Quote text\"")
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


def cmd_list(args):
    index = load_index()
    if len(args) == 0:
        # List all boards
        print("Soundboards:")
        print("-" * 40)
        for b in index:
            status = f"{b['clipCount']} clips" if b["clipCount"] > 0 else "empty"
            print(f"  {b['icon']}  {b['name']} ({b['id']}) — {status}")
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
            exists = "✓" if os.path.exists(audio_path) else "✗ MISSING"
            print(f"    {clip['label']:30s}  {clip['file']:25s}  {exists}")


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        sys.exit(0)

    command = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "add": cmd_add,
        "bulk": cmd_bulk,
        "new-board": cmd_new_board,
        "new-category": cmd_new_category,
        "remove": cmd_remove,
        "add-quote": cmd_add_quote,
        "remove-quote": cmd_remove_quote,
        "add-icon": cmd_add_icon,
        "remove-icon": cmd_remove_icon,
        "list": cmd_list,
        "sync": lambda a: sync_clip_counts(),
    }

    if command not in commands:
        print(f"Unknown command: {command}")
        print(f"Available: {', '.join(commands.keys())}")
        sys.exit(1)

    commands[command](args)


if __name__ == "__main__":
    main()
