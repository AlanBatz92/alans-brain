#!/usr/bin/env python3
"""classify.py — LLM disambiguation pass (Phase 3 of the UAP Shape Census).

Runs AFTER extract.py and BEFORE build.py. Reads the full lexical mention set
(work/mentions.full.json), and for each candidate asks a model — given the
snippet — whether it actually describes the SHAPE of a witnessed craft/object
(vs. a metaphor or an unrelated use of the word). It then:

  • sets confidence to "llm-confirmed" (kept) or "llm-rejected" (dropped),
  • corrects the canonical shape when the lexical guess was wrong,
  • attaches descriptive modifiers to that specific mention,

and writes the enriched records back to work/mentions.full.json. build.py then
publishes only confirmed mentions (see its publish gate). Because the lexical
pass is high-recall, this is what turns the census from "every keyword hit" into
"passages that actually describe a craft's shape".

Runs LOCALLY where the API key + text live (like the rest of the toolkit). It is
**resumable**: results are cached in work/classify_cache.json keyed by mention id
+ snippet, so a re-run only classifies new/changed items and never re-spends.

Engines:
  claude  — Anthropic API, default claude-haiku-4-5 (needs ANTHROPIC_API_KEY and
            `pip install anthropic`). ~cheap: short, batched calls.
  mock    — no API; marks everything confirmed with the lexical shape. For
            testing the plumbing only.

Usage:
  export ANTHROPIC_API_KEY=...           # or set it in your shell/profile
  python classify.py                     # classify all un-checked mentions
  python classify.py --limit 40          # cheap trial on the first 40
  python classify.py --engine mock       # plumbing test, no API
  python build.py                        # then publish the confirmed set
"""
import argparse
import hashlib
import json
import os
import sys

import _common as C

CACHE_PATH = os.path.join(C.WORK_DIR, "classify_cache.json")
DEFAULT_MODEL = "claude-haiku-4-5"

SYSTEM = (
    "You classify candidate UFO/UAP craft-shape mentions pulled from books by a "
    "keyword matcher. For each item you get the matched TERM, a SHAPE_GUESS "
    "(a canonical shape id), and a SNIPPET of surrounding text. Decide whether "
    "the snippet is actually describing the SHAPE of a witnessed or reported "
    "craft/object/light in the sky — NOT a metaphor (\"love triangle\"), a "
    "figure of speech, an unrelated object (a vinyl disc, a box of files), or "
    "discussion of the word itself. Be strict: when the snippet does not clearly "
    "attribute the shape to a craft/object, mark craft=false.\n"
    "Return ONLY a strict JSON array. Each element: "
    '{"id": <string>, "craft": true|false, "shape": <one canonical id or null>, '
    '"modifiers": [<=4 short adjectives describing the object, e.g. "metallic", '
    '"glowing", "huge">]}. '
    "If craft is false, set shape=null and modifiers=[]. Choose `shape` from the "
    "allowed ids; keep SHAPE_GUESS unless the snippet clearly indicates a "
    "different one."
)


def cache_key(m):
    h = hashlib.sha1((m["id"] + "|" + (m.get("snippet") or "")).encode("utf-8")).hexdigest()
    return h[:16]


def allowed_ids(shapes):
    return [s["id"] for s in shapes]


def build_payload(batch, shapes):
    allowed = ", ".join(s["id"] + " (" + s["label"] + ")" for s in shapes)
    lines = ["Allowed shape ids: " + allowed, "", "Items:"]
    for m in batch:
        snip = (m.get("snippet") or "").replace("\n", " ")
        lines.append(json.dumps({
            "id": m["id"], "term": m.get("raw_term"),
            "shape_guess": m.get("shape"), "snippet": snip,
        }, ensure_ascii=False))
    lines.append("\nReturn the JSON array now.")
    return "\n".join(lines)


def parse_json_array(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    a, b = text.find("["), text.rfind("]")
    if a == -1 or b == -1:
        raise ValueError("no JSON array in model output")
    return json.loads(text[a:b + 1])


# ── Engines ─────────────────────────────────────────────────────────────────

def engine_mock(batch, shapes):
    return [{"id": m["id"], "craft": True, "shape": m.get("shape"), "modifiers": []}
            for m in batch]


def make_claude_engine(model):
    try:
        import anthropic
    except ImportError:
        sys.exit("Claude engine needs the SDK:  pip install anthropic")
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

    def run(batch, shapes):
        resp = client.messages.create(
            model=model, max_tokens=2000, temperature=0, system=SYSTEM,
            messages=[{"role": "user", "content": build_payload(batch, shapes)}],
        )
        return parse_json_array(resp.content[0].text)

    return run


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="LLM disambiguation pass over the lexical mentions.")
    ap.add_argument("--engine", choices=["claude", "mock"], default="claude")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--batch-size", type=int, default=12)
    ap.add_argument("--limit", type=int, default=0, help="Only classify the first N un-checked (trial).")
    ap.add_argument("--refresh", action="store_true", help="Ignore cache; re-classify everything.")
    args = ap.parse_args()

    # Friendly preflight: the Claude engine needs an API key in the environment.
    if args.engine == "claude" and not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit(
            "ANTHROPIC_API_KEY is not set.\n"
            "  Windows (cmd):       set ANTHROPIC_API_KEY=sk-ant-...\n"
            "  Windows (permanent): setx ANTHROPIC_API_KEY \"sk-ant-...\"  (then reopen the terminal)\n"
            "  macOS/Linux:         export ANTHROPIC_API_KEY=sk-ant-...\n"
            "Get a key at console.anthropic.com. Or test the plumbing with --engine mock."
        )

    # Input: prefer the local full lexical set (work/mentions.full.json from extract.py)
    # WHEN IT HAS MENTIONS; otherwise fall back to the COMMITTED published mentions.json —
    # its snippets are all the disambiguation pass needs, so you can run this on a fresh
    # clone WITHOUT the books/segments (and an empty work/ from a no-op extract is ignored).
    # Output always goes to work/mentions.full.json for build.py.
    mentions, src_path = [], None
    if os.path.exists(C.MENTIONS_FULL):
        w = C.load_json(C.MENTIONS_FULL, []) or []
        if w:
            mentions, src_path = w, C.MENTIONS_FULL
    if not mentions and os.path.exists(C.MENTIONS_JSON):
        mentions = C.load_json(C.MENTIONS_JSON, []) or []
        src_path = C.MENTIONS_JSON
    if not mentions:
        sys.exit("No mentions found — run extract.py (with the source files present), "
                 "or ensure data/ufo-shapes/mentions.json exists.")
    print(f"input: {src_path}  ({len(mentions)} mentions)")
    shapes = C.load_json(C.SHAPES_PATH)["shapes"]
    valid = set(allowed_ids(shapes))

    cache = {} if args.refresh else (C.load_json(CACHE_PATH, {}) or {})

    def needs(m):
        if args.refresh:
            return True
        if m.get("confidence") in ("llm-confirmed", "llm-rejected"):
            return False  # already AI-judged (e.g. carried forward from committed data)
        return cache_key(m) not in cache
    pending = [m for m in mentions if needs(m)]
    already = len(mentions) - len(pending)
    todo = pending[:args.limit] if args.limit else pending
    deferred = len(pending) - len(todo)            # not done this run because of --limit
    msg = (f"{len(mentions)} mentions · {already} already classified · "
           f"{len(todo)} to classify this run")
    if deferred:
        msg += f" · {deferred} more still pending (raise/drop --limit for the rest)"
    print(msg + f"  [engine={args.engine}, model={args.model if args.engine=='claude' else '-'}]")

    run = engine_mock if args.engine == "mock" else make_claude_engine(args.model)

    done = 0
    for i in range(0, len(todo), args.batch_size):
        batch = todo[i:i + args.batch_size]
        try:
            results = run(batch, shapes)
        except Exception as e:
            print(f"  batch {i//args.batch_size} failed ({e}); saving progress and stopping.")
            break
        by_id = {r.get("id"): r for r in results}
        for m in batch:
            r = by_id.get(m["id"]) or {"craft": True, "shape": m.get("shape"), "modifiers": []}
            cache[cache_key(m)] = {
                "craft": bool(r.get("craft")),
                "shape": r.get("shape") if r.get("shape") in valid else m.get("shape"),
                "modifiers": [str(x) for x in (r.get("modifiers") or [])][:4],
            }
        done += len(batch)
        C.write_json(CACHE_PATH, cache)
        if done % 120 == 0 or i + args.batch_size >= len(todo):
            print(f"  classified {done}/{len(todo)}")

    # Apply cache → mentions
    confirmed = rejected = 0
    for m in mentions:
        c = cache.get(cache_key(m))
        if not c:
            continue
        if c["craft"]:
            m["confidence"] = "llm-confirmed"
            if c.get("shape") in valid:
                m["shape"] = c["shape"]
            if c.get("modifiers"):
                m["modifiers"] = c["modifiers"]
            confirmed += 1
        else:
            m["confidence"] = "llm-rejected"
            rejected += 1
    C.write_json(C.MENTIONS_FULL, mentions)
    total = confirmed + rejected
    pct = f" ({100*rejected//total}% rejected)" if total else ""
    print(f"Applied to {total} classified mention(s): {confirmed} confirmed, {rejected} rejected{pct}")
    print(f"  → {C.MENTIONS_FULL}")

    # Show a sample of what was rejected so you can sanity-check the model's calls
    # before committing (especially on a --limit trial).
    rej = [m for m in mentions if m.get("confidence") == "llm-rejected"]
    if rej:
        print(f"\nSample of rejected passages (model judged NOT a craft shape):")
        for m in rej[:10]:
            snip = (m.get("snippet") or "").replace("\n", " ")
            print(f"  · [{m['shape']}/{m['raw_term']}] {snip[:120]}")
        print("  If these look like correct drops, run the full pass; if too aggressive, tell Claude Code.")
    print("\nNext: python build.py   (publishes high + AI-confirmed)")


if __name__ == "__main__":
    main()
