"""Shared paths and small IO helpers for the UAP Shape Census toolkit.

Stdlib only. The toolkit runs locally (Dell Optiplex), reads raw books from
ufo-shapes/sources/<id>/, and writes the derived, committable JSON into
data/ufo-shapes/. See PLAN-ufo-shapes.md for the full design.
"""
import json
import os

TOOLKIT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(TOOLKIT_DIR)

SOURCES_DIR = os.path.join(TOOLKIT_DIR, "sources")            # raw + segments (gitignored)
SHAPES_PATH = os.path.join(TOOLKIT_DIR, "shapes.json")        # the taxonomy

WORK_DIR = os.path.join(TOOLKIT_DIR, "work")                  # local-only (gitignored)
MENTIONS_FULL = os.path.join(WORK_DIR, "mentions.full.json")  # ALL mentions, high + review

DATA_DIR = os.path.join(REPO_ROOT, "data", "ufo-shapes")      # committed outputs (PUBLISHED)
SOURCES_JSON = os.path.join(DATA_DIR, "sources.json")
MENTIONS_JSON = os.path.join(DATA_DIR, "mentions.json")       # high-confidence only (the gate)
SUMMARY_JSON = os.path.join(DATA_DIR, "summary.json")


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def segments_path(source_id):
    return os.path.join(SOURCES_DIR, source_id, "segments.jsonl")
