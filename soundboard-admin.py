#!/usr/bin/env python3
"""
Soundboard Admin — helper script for managing soundboard data.

Usage:
  python soundboard-admin.py add <board> <category> <file> [--label "Custom Label"]
  python soundboard-admin.py bulk <board> <category> <file1> <file2> ...
  python soundboard-admin.py new-board <id> <name> <icon>
  python soundboard-admin.py new-category <board> <category>
  python soundboard-admin.py remove <board> <category> <file>
  python soundboard-admin.py list [board]
  python soundboard-admin.py sync

Examples:
  python soundboard-admin.py add halflife G-Man choose2.wav
  python soundboard-admin.py add halflife G-Man choose2.wav --label "The Right Man"
  python soundboard-admin.py bulk halflife Scientists hello.wav goodbye.wav
  python soundboard-admin.py new-board quake2 "Quake 2" "👾"
  python soundboard-admin.py new-category halflife "Vortigaunts"
  python soundboard-admin.py remove halflife Scientists stench.wav
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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data", "soundboards")
AUDIO_DIR = os.path.join(SCRIPT_DIR, "audio")
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
        print("Usage: add <board> <category> <file> [--label \"Label\"]")
        sys.exit(1)

    board_id, cat_name, filename = args[0], args[1], args[2]
    label = None
    if "--label" in args:
        li = args.index("--label")
        if li + 1 < len(args):
            label = args[li + 1]

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
    save_board(board_id, data)
    sync_clip_counts()
    print(f"Added: \"{label}\" ({filename}) -> {board_id}/{cat_name}")


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
