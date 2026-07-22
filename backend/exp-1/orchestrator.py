#!/usr/bin/env python3
"""
Orchestrator — concurrent multi-agent SEO keyword enrichment
=============================================================

Dispatches keywords to one or more agents in parallel using ThreadPoolExecutor.
Each completed keyword is saved to the agent's CSV immediately (thread-safe).

Agents:
  gemini → datasets/20 july test ai overview sheet.csv   (Gemini 3.5 Flash + Google Search)
  openai → datasets/20 july test - Sheet1.csv            (GPT-4o-search-preview)

Usage:
  # Run Gemini agent on all pending keywords, 5 workers in parallel
  python3 exp/orchestrator.py --agent gemini

  # Run OpenAI agent on first 3 keywords, re-process
  python3 exp/orchestrator.py --agent openai --limit 3 --overwrite

  # Run BOTH agents concurrently on first 5 keywords
  python3 exp/orchestrator.py --agent all --limit 5 --overwrite

  # Control concurrency (default 5)
  python3 exp/orchestrator.py --agent gemini --workers 3

Options:
  --agent    gemini | openai | all          (default: all)
  --limit    N                              process first N keywords only
  --overwrite                               re-process already-done rows
  --workers  N                              parallel keyword threads (default: 5)
"""

import sys
import csv
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Make sure exp-1 and parent dirs are importable
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents import AGENTS, DATASETS_DIR


# ── CSV helpers ───────────────────────────────────────────────────────────────

def load_csv(path: Path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader     = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows       = list(reader)
    return fieldnames, rows


def save_csv(path: Path, fieldnames: list, rows: list):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def ensure_columns(fieldnames: list, rows: list, new_cols: list):
    for col in new_cols:
        if col not in fieldnames:
            fieldnames.append(col)
    for row in rows:
        for col in new_cols:
            row.setdefault(col, "")


# ── single-agent runner ──────────────────────────────────────────────────────

def run_agent(agent, limit, overwrite: bool, workers: int):
    """
    Run one agent across its CSV concurrently.
    Worker threads push results to a queue; the main thread drains the
    queue and writes the CSV once — no inter-thread file corruption.
    Returns (processed_count, ok_count, err_count).
    """
    csv_path = agent.csv_path

    if not csv_path.exists():
        print(f"  [{agent.name}] ❌ CSV not found: {csv_path}")
        return 0, 0, 0

    fieldnames, rows = load_csv(csv_path)

    # Output columns this pipeline needs
    output_cols = ["top_10_results", "competitors", "total_found",
                   "confidence_score", "ai_answer", "seo_summary", "status"]
    ensure_columns(fieldnames, rows, output_cols)

    # Keyword column
    keyword_col = next(
        (c for c in fieldnames if c.strip().lower() == "keywords"), None
    )
    if not keyword_col:
        print(f"  [{agent.name}] ❌ 'Keywords' column not found.")
        return 0, 0, 0

    # Candidates
    candidates = [
        (i, row) for i, row in enumerate(rows)
        if row.get(keyword_col, "").strip()
    ]
    if limit:
        candidates = candidates[:limit]

    # Clear if overwrite
    if overwrite:
        for i, row in candidates:
            for col in output_cols:
                rows[i][col] = ""
        save_csv(csv_path, fieldnames, rows)
        print(f"  [{agent.name}] Cleared {len(candidates)} rows.")

    # Pending
    pending = [
        (i, row) for i, row in candidates
        if not row.get("status", "").strip()
    ]

    total  = len(pending)
    ok     = 0
    errors = 0

    print(f"  [{agent.name.upper()}] Starting {total} keywords | {workers} workers\n")

    if total == 0:
        print(f"  [{agent.name}] Nothing pending. Use --overwrite to rerun.")
        return 0, 0, 0

    def process_one(item: tuple) -> tuple:
        row_i, row = item
        keyword = row[keyword_col].strip()
        try:
            result = agent.run_keyword(keyword)
        except Exception as e:
            result = {col: "" for col in output_cols}
            result["status"] = f"Error: {e}"
        return row_i, keyword, result

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(process_one, item): item for item in pending}
        for future in as_completed(futures):
            row_i, keyword, result = future.result()
            done += 1
            status = result.get("status", "")
            found  = result.get("total_found", 0)
            conf   = result.get("confidence_score", 0)

            if status == "ok":
                ok += 1
                print(f"  [{agent.name}] ✓ [{done}/{total}] {keyword!r} "
                      f"| {found} URLs | confidence: {conf}/100", flush=True)
            else:
                errors += 1
                print(f"  [{agent.name}] ✗ [{done}/{total}] {keyword!r} "
                      f"| {status[:80]}", flush=True)

            for col, val in result.items():
                if col in output_cols:
                    rows[row_i][col] = val

            save_csv(csv_path, fieldnames, rows)

    print(f"\n  [{agent.name}] ✅ Saved → {csv_path.name}", flush=True)
    return total, ok, errors


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Orchestrate SEO keyword enrichment agents concurrently"
    )
    parser.add_argument(
        "--agent", choices=["gemini", "openai", "claude", "all"], default="all",
        help="Which agent(s) to run (default: all)"
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Process only the first N keywords"
    )
    parser.add_argument(
        "--overwrite", action="store_true",
        help="Re-process rows that already have results"
    )
    parser.add_argument(
        "--workers", type=int, default=5,
        help="Number of parallel keyword workers per agent (default: 5)"
    )
    args = parser.parse_args()

    # Which agents to run
    if args.agent == "all":
        selected = list(AGENTS.keys())
    else:
        selected = [args.agent]

    print(f"\n{'='*60}")
    print(f"  SEO Orchestrator")
    print(f"  Agents  : {', '.join(selected)}")
    print(f"  Limit   : {args.limit or 'all'}")
    print(f"  Workers : {args.workers} per agent")
    print(f"  Overwrite: {args.overwrite}")
    print(f"{'='*60}\n")

    # If running both agents concurrently, use ThreadPoolExecutor
    if len(selected) > 1:
        results = {}

        def run_one(name):
            agent = AGENTS[name]()
            t, ok, err = run_agent(agent, args.limit, args.overwrite, args.workers)
            results[name] = (t, ok, err)

        with ThreadPoolExecutor(max_workers=len(selected)) as executor:
            for name in selected:
                executor.submit(run_one, name)

    else:
        name  = selected[0]
        agent = AGENTS[name]()
        total, ok, err = run_agent(agent, args.limit, args.overwrite, args.workers)
        results = {name: (total, ok, err)}

    # Summary
    print(f"\n{'='*60}")
    print("  SUMMARY")
    print(f"{'='*60}")
    for name, (total, ok, err) in results.items():
        print(f"  {name.upper():10} | Processed: {total} | ✓ OK: {ok} | ✗ Errors: {err}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
