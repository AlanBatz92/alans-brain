#!/usr/bin/env python3
"""
Media Optimizer — compress images, generate WebP, convert audio.

Requirements:
  pip install Pillow
  ffmpeg on PATH (for audio conversion)

Usage:
  python optimize-media.py art [--dry-run]
  python optimize-media.py youtube [--dry-run]
  python optimize-media.py icons [--dry-run]
  python optimize-media.py soundboards [--dry-run]
  python optimize-media.py audio [--dry-run]
  python optimize-media.py all [--dry-run]
  python optimize-media.py report
"""

import os
import sys
import io
import subprocess
import glob

# Fix Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    from PIL import Image
except ImportError:
    Image = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(SCRIPT_DIR, "img")
AUDIO_DIR = os.path.join(SCRIPT_DIR, "audio")


def fmt_size(n):
    """Format byte count as human-readable string."""
    if n < 1024:
        return f"{n}B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f}KB"
    return f"{n / (1024 * 1024):.1f}MB"


def get_file_size(path):
    """Get file size in bytes, 0 if missing."""
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def require_pillow():
    if Image is None:
        print("Error: Pillow is required. Install with: pip install Pillow")
        sys.exit(1)


def find_images(directory, extensions=("*.png", "*.jpg", "*.jpeg")):
    """Recursively find image files in a directory."""
    files = []
    for ext in extensions:
        files.extend(glob.glob(os.path.join(directory, "**", ext), recursive=True))
        files.extend(glob.glob(os.path.join(directory, ext)))
    # Deduplicate and sort
    return sorted(set(files))


def optimize_png(path, max_size=None, quantize=False, dry_run=False):
    """Compress a PNG in-place. Optionally resize and quantize."""
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
    """Compress a JPEG in-place. Optionally resize."""
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
    """Save a WebP copy alongside the original file."""
    base, _ = os.path.splitext(original_path)
    webp_path = base + ".webp"

    if img.mode == "P":
        img = img.convert("RGBA")

    if not dry_run:
        img.save(webp_path, "WEBP", quality=quality)

    size = get_file_size(webp_path) if not dry_run else 0
    return webp_path, size


def print_result(path, before, after, webp_path=None, webp_size=0, dry_run=False):
    """Print a single file result line."""
    rel = os.path.relpath(path, SCRIPT_DIR)
    saved = before - after
    tag = "[DRY RUN] " if dry_run else ""
    line = f"  {tag}{rel}: {fmt_size(before)} -> {fmt_size(after)} (saved {fmt_size(saved)})"
    if webp_path:
        webp_rel = os.path.relpath(webp_path, SCRIPT_DIR)
        line += f" | WebP: {fmt_size(webp_size)} ({webp_rel})"
    print(line)


# ── Subcommands ──────────────────────────────────────────────

def cmd_art(dry_run=False):
    """Optimize art images: resize full-size to max 2000px, generate WebP."""
    require_pillow()
    full_dir = os.path.join(IMG_DIR, "art", "full")
    thumb_dir = os.path.join(IMG_DIR, "art", "thumbs")
    total_before = total_after = total_webp = 0

    print("=== Art: Full-size images ===")
    for path in find_images(full_dir, ("*.jpg", "*.jpeg")):
        before, after, img = optimize_jpeg(path, max_width=2000, quality=82, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print("\n=== Art: Thumbnails ===")
    for path in find_images(thumb_dir, ("*.jpg", "*.jpeg")):
        before, after, img = optimize_jpeg(path, max_width=400, quality=75, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=75, dry_run=dry_run)
        print_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nArt total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def cmd_youtube(dry_run=False):
    """Optimize YouTube channel PNGs and generate WebP."""
    require_pillow()
    yt_dir = os.path.join(IMG_DIR, "youtube")
    total_before = total_after = total_webp = 0

    print("=== YouTube channel icons ===")
    for path in find_images(yt_dir, ("*.png",)):
        before, after, img = optimize_png(path, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nYouTube total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def cmd_icons(dry_run=False):
    """Optimize UI/nav icon PNGs: resize to 96px, quantize, generate WebP."""
    require_pillow()
    icons_dir = os.path.join(IMG_DIR, "Icons", "icons")
    total_before = total_after = total_webp = 0

    print("=== UI/Nav icons ===")
    for path in find_images(icons_dir, ("*.png",)):
        before, after, img = optimize_png(path, max_size=96, quantize=True, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nIcons total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def cmd_soundboards(dry_run=False):
    """Optimize soundboard character PNGs: resize to 300px, generate WebP."""
    require_pillow()
    sb_dir = os.path.join(IMG_DIR, "Icons", "Soundboards")
    total_before = total_after = total_webp = 0

    print("=== Soundboard character images ===")
    for path in find_images(sb_dir, ("*.png",)):
        before, after, img = optimize_png(path, max_size=300, dry_run=dry_run)
        webp_path, webp_size = generate_webp(img, path, quality=80, dry_run=dry_run)
        print_result(path, before, after, webp_path, webp_size, dry_run)
        total_before += before
        total_after += after
        total_webp += webp_size

    print(f"\nSoundboards total: {fmt_size(total_before)} -> {fmt_size(total_after)} + {fmt_size(total_webp)} WebP")


def cmd_audio(dry_run=False):
    """Convert WAV files to OGG Vorbis via ffmpeg."""
    total_before = total_after = 0

    print("=== Audio: WAV -> OGG ===")
    wav_files = glob.glob(os.path.join(AUDIO_DIR, "**", "*.wav"), recursive=True)
    if not wav_files:
        print("  No WAV files found.")
        return

    # Check ffmpeg availability
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("Error: ffmpeg not found on PATH. Install ffmpeg for audio conversion.")
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
                capture_output=True
            )
            if result.returncode != 0:
                print(f"  {tag}{rel}: FAILED - {result.stderr.decode('utf-8', errors='replace')[:200]}")
                continue

        after = get_file_size(ogg_path) if not dry_run else 0
        total_before += before
        total_after += after
        print(f"  {tag}{rel}: {fmt_size(before)} -> OGG {fmt_size(after)}")

    print(f"\nAudio total: {fmt_size(total_before)} -> {fmt_size(total_after)}")


def cmd_report():
    """Print a size report of all media directories without modifying anything."""
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


def cmd_all(dry_run=False):
    """Run all optimization subcommands."""
    cmd_art(dry_run)
    print()
    cmd_youtube(dry_run)
    print()
    cmd_icons(dry_run)
    print()
    cmd_soundboards(dry_run)
    print()
    cmd_audio(dry_run)


# ── CLI ──────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    commands = {
        "art": cmd_art,
        "youtube": cmd_youtube,
        "icons": cmd_icons,
        "soundboards": cmd_soundboards,
        "audio": cmd_audio,
        "all": cmd_all,
        "report": cmd_report,
    }

    if command not in commands:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)

    if command == "report":
        cmd_report()
    else:
        commands[command](dry_run)


if __name__ == "__main__":
    main()
