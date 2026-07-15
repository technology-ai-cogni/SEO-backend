"""
category_cluster_only.py -- experimental, standalone

Runs ONLY the category + cluster step -- nothing else. Reads titles
straight out of an already-populated sheet's "Top 3 URLs (JSON)" column
(written earlier by run_experiment.py) -- no SERP re-fetch, no page
metadata re-fetch, no info/comm or landing/blog classification. Those
columns are left exactly as they already are.

Category naming: category_namer.categorize_from_title_words() -- the
FULL existing rule chain from category_namer.py (>=2-occurrence, LLM
naming from the allowed word list only, location-leak strip, single
entity-type rule, dedupe-redundant-words including singular/plural
merging, Best/Top rule), completely unchanged -- the ONLY difference
from category_namer.categorize_from_metadata() is the input vocabulary:
only the first `--words-per-title` words of each of the (up to 3) stored
titles feed the >=2-occurrence rule, instead of each page's full title +
meta_description text. No cross-referencing against any other keyword's
category at all -- each keyword's name comes only from its own titles.
Runs pooled (independent per keyword, same as run_experiment.py's
category stage) since nothing here depends on any other row's result.

Clustering: cluster_grouper.cluster_categories() -- unchanged, one
deterministic pass over the whole batch's derived names at the very end,
still filtering location/filler words there too so a generic word
repeated across many categories can't act as a hub and collapse the
whole batch into one cluster.

Run from the `backend/` directory:
    python -m scripts.exp_category_pipeline.category_cluster_only \\
        --input "datasets/its category test 14 july - Sheet1.csv" --in-place
"""

import argparse
import csv
import json
import os
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from scripts.exp_category_pipeline import category_namer
from scripts.exp_category_pipeline import cluster_grouper

DEFAULT_INPUT = "/Users/manish/Backend/backend/datasets/its category test 14 july - Sheet1.csv"
DEFAULT_WORKERS = 8


def _extract_keyword(row):
    normalized = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k is not None}
    return (
        normalized.get("keywords") or normalized.get("keyword")
        or normalized.get("search keyword") or normalized.get("query") or ""
    )


def _categorize_row(i, total, keyword, row, words_per_title):
    raw_top3 = (row.get("Top 3 URLs (JSON)") or "").strip()
    try:
        top3 = json.loads(raw_top3) if raw_top3 else []
    except json.JSONDecodeError:
        top3 = []

    titles = [(r or {}).get("title", "") for r in top3[:3]]
    try:
        category = category_namer.categorize_from_title_words(keyword, titles, words_per_title)
    except Exception as e:
        print(f"[{i}/{total}] '{keyword}' -> ERROR: {e}")
        category = ""

    print(f"[{i}/{total}] '{keyword}' -> {category!r}")
    return category


def run(input_path, output_path=None, limit=None, in_place=False,
        words_per_title=3, workers=DEFAULT_WORKERS):
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    if "Top 3 URLs (JSON)" not in fieldnames:
        print("Error: input sheet has no 'Top 3 URLs (JSON)' column -- run run_experiment.py first.")
        sys.exit(1)

    process_rows = rows[:limit] if limit else rows
    total = len(process_rows)

    print(f"\n{'='*70}")
    print("CATEGORY + CLUSTER ONLY -- category_namer.py's full rule chain, "
          f"input = first {words_per_title} words/title, no cross-referencing")
    print(f"Input   : {input_path}")
    print(f"Rows    : {total}")
    print(f"Workers : {workers}")
    print(f"{'='*70}\n")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_categorize_row, i, total, _extract_keyword(row), row, words_per_title): row
            for i, row in enumerate(process_rows, start=1)
        }
        for future in as_completed(futures):
            row = futures[future]
            row["Category"] = future.result()

    all_categories = [r.get("Category", "") for r in process_rows if r.get("Category")]
    assignment = cluster_grouper.cluster_categories(
        all_categories,
        location_words=category_namer._LOCATION_WORDS,
        extra_stopwords=category_namer._FILLER_WORDS,
    )
    print(f"\nClustered {len(assignment)} categories into {len(set(assignment.values()))} clusters.\n")

    for row in process_rows:
        category = row.get("Category", "")
        row["Cluster"] = assignment.get(category, "") if category else ""

    print(f"{'='*70}")
    print("RESULTS")
    print(f"{'='*70}")
    for row in process_rows:
        keyword = _extract_keyword(row)
        print(f"- {keyword!r}")
        print(f"    Category : {row.get('Category') or '(none)'}")
        print(f"    Cluster  : {row.get('Cluster') or '(none)'}")
    print(f"{'='*70}\n")

    if in_place:
        output_path = input_path
        backup_path = input_path + ".bak3"
        shutil.copyfile(input_path, backup_path)
        print(f"Backed up sheet to {backup_path}")
    elif not output_path:
        base_name = os.path.splitext(input_path)[0]
        output_path = f"{base_name}_title3word.csv"

    with open(output_path, "w", newline="", encoding="utf-8-sig") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done -- wrote {len(rows)} row(s) to {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Category+cluster only, category_namer.py's full rule chain over first-N-words-per-title input")
    parser.add_argument("--input", type=str, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--in-place", action="store_true", help="Overwrite --input (backs up to <input>.bak3 first)")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--words-per-title", type=int, default=3)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    if not os.path.exists(input_path):
        print(f"Error: input file not found at {input_path}")
        sys.exit(1)

    run(
        input_path,
        output_path=args.output,
        limit=args.limit,
        in_place=args.in_place,
        words_per_title=args.words_per_title,
        workers=args.workers,
    )


if __name__ == "__main__":
    main()
