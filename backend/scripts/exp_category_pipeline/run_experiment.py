"""
run_experiment.py -- experimental orchestrator

A separate test pipeline exploring an alternative to the currently-
running scripts/run_pipeline.py. Nothing here touches or runs
scripts/run_pipeline.py, category_assigner.py, landing_blog_classifier.py,
serp_scraper.py, or services/category_checker.py -- category naming and
clustering are still this package's own independent, standalone logic
(category_namer.py, cluster_grouper.py). No Postgres/core.db involved
either -- output is a plain CSV, so this can never affect real project
data.

ONE deliberate exception to the "zero imports from production files"
rule: metadata fetch + Informational/Commercial classification are now
sourced directly from the REAL scripts/intent_classifier.py (its own
headless-Chrome thread-local page fetch, its own OpenAI prompt) instead
of this package's own metadata_fetch.py/classifiers.py info/comm code --
per an explicit request to reuse intent_classifier.py rather than
duplicate it.

--- Flow (the actual behavior change under test) ----------------------

  1. SERP + INTENT STAGE: one Selenium browser, `serp_tabs` tabs,
     round-robins EVERY keyword's top-3 fetch (serp_fetch.fetch_top3_batch)
     -- and the INSTANT a keyword's top-3 lands, its metadata fetch +
     Informational/Commercial classification (via intent_classifier.py,
     pooled across `metadata_workers` threads) fires immediately,
     concurrently with the SERP tab loop still working through the rest
     of the keyword list. This is the "along with fetching top-3" part.

  1b. RETRY: any keyword whose top-3 came back empty (a tab timeout, not
     a genuine "no results") gets ONE retry, in a second, smaller
     Selenium batch for just those keywords -- also feeding the same
     intent-classification pool.

  2. GATE: nothing in step 3 starts until EVERY keyword above has
     finished both its top-3 fetch AND its info/comm classification.

  3. CATEGORY + LANDING/BLOG STAGE (pooled across keywords, OpenAI only,
     no browser): each keyword's category name (category_namer.py, no
     cross-referencing against any other keyword) and Landing/Blog label
     (classifiers.py) are both derived from the SAME page metadata
     intent_classifier.py already fetched in stage 1.

  4. CLUSTER STAGE (once, at the end): cluster_grouper.cluster_categories
     groups the whole batch's derived category names by shared
     significant words -- the only place categories from different
     keywords interact at all.

Run from the `backend/` directory:
    python -m scripts.exp_category_pipeline.run_experiment \\
        --input "datasets/its category test 14 july - Sheet1.csv"
"""

import argparse
import csv
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from scripts import intent_classifier
from scripts.exp_category_pipeline import serp_fetch
from scripts.exp_category_pipeline import classifiers
from scripts.exp_category_pipeline import category_namer
from scripts.exp_category_pipeline import cluster_grouper

DEFAULT_INPUT = "/Users/manish/Backend/backend/datasets/its category test 14 july - Sheet1.csv"
DEFAULT_SERP_TABS = serp_fetch.NUM_TABS
DEFAULT_METADATA_WORKERS = 8
DEFAULT_CATEGORY_WORKERS = 8


def _extract_keyword_and_landing_page(row):
    normalized = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k is not None}
    keyword = (
        normalized.get("keywords") or normalized.get("keyword")
        or normalized.get("search keyword") or normalized.get("query") or ""
    )
    landing_page = (
        normalized.get("landing page") or normalized.get("landing_page")
        or normalized.get("target url") or normalized.get("target_url")
        or normalized.get("url") or ""
    )
    return keyword, landing_page


def _fetch_metadata_and_info_comm(keyword, top3):
    """Stage 1's per-keyword worker: for each of top3's (up to 3) URLs,
    fetch full page metadata AND classify Informational/Commercial using
    the REAL scripts/intent_classifier.py -- its own headless-Chrome
    thread-local driver, its own extract_page_signals(), its own
    classify_page_intent(). Returns (signals_list, info_comm_label),
    never raises."""
    signals_list = []
    per_url_results = []

    for r in (top3 or [])[:5]:
        url = (r or {}).get("url")
        title = (r or {}).get("title")
        if not url:
            continue
        try:
            html, fetch_error = intent_classifier.fetch_page(url)
            if html:
                signals = intent_classifier.extract_page_signals(url, html)
            else:
                signals = {"url": url, "title": title, "fetch_error": fetch_error}
            signals_list.append(signals)
            per_url_results.append(intent_classifier.classify_page_intent(signals))
        except Exception as e:
            print(f"  [INTENT ERROR] '{keyword}' / '{url}': {e}")

    info_comm = intent_classifier.majority_subtype(per_url_results)
    return signals_list, info_comm


def _run_category_and_landing_blog(record, row_index, total):
    """Stage 3, one keyword: category name AND Landing/Blog label, both
    derived from THIS keyword's own already-fetched page signals -- no
    other keyword's data is visible here, and no browser/Selenium
    involved (category_namer.py + classifiers.py, OpenAI only)."""
    keyword = record["keyword"]
    signals_list = record.get("signals", [])

    try:
        category = category_namer.categorize_from_metadata(keyword, signals_list)
    except Exception as e:
        print(f"  [CATEGORY ERROR] '{keyword}': {e}")
        category = ""

    landing_blog = None
    if signals_list:
        try:
            landing_blog = classifiers.classify_landing_or_blog(signals_list)
        except Exception as e:
            print(f"  [LANDING/BLOG ERROR] '{keyword}': {e}")

    record["category"] = category
    record["landing_blog"] = landing_blog or ""
    print(f"[{row_index}/{total}] CATEGORY+LANDING/BLOG done: '{keyword}' -> "
          f"category={category!r} landing_blog={landing_blog!r}")
    return record


def run_experiment(input_path, output_path=None, limit=None,
                    serp_tabs=DEFAULT_SERP_TABS,
                    metadata_workers=DEFAULT_METADATA_WORKERS,
                    category_workers=DEFAULT_CATEGORY_WORKERS,
                    in_place=False):
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        original_fieldnames = list(reader.fieldnames)
        rows = list(reader)

    keyword_rows = []
    for row in rows:
        kw, lp = _extract_keyword_and_landing_page(row)
        if kw:
            keyword_rows.append({"keyword": kw, "landing_page": lp})

    if limit:
        keyword_rows = keyword_rows[:limit]

    if not keyword_rows:
        print("No valid keywords found in input file.")
        return None

    total = len(keyword_rows)
    print(f"\n{'='*70}")
    print("Experimental category pipeline")
    print(f"Input          : {input_path}")
    print(f"Keywords       : {total}")
    print(f"SERP           : Selenium, {serp_tabs} browser tabs, round-robin (no Bright Data/SerpApi)")
    print(f"Metadata+Intent: {metadata_workers} workers, via scripts/intent_classifier.py")
    print(f"Category pool  : {category_workers} workers")
    print(f"{'='*70}\n")

    records_by_keyword = {}
    landing_pages_by_keyword = {kr["keyword"]: kr["landing_page"] for kr in keyword_rows}

    # --- Stage 1: SERP fetch (Selenium tab pool, whole batch) fans each
    # keyword's metadata+info/comm work out to a pool the INSTANT its
    # top-3 lands -- concurrent with the tab loop still working through
    # the rest of the keyword list. ---
    intent_pool = ThreadPoolExecutor(max_workers=metadata_workers)
    pending = []

    def _submit_intent_job(keyword, top3):
        def _job():
            print(f"[INTENT] start: '{keyword}'")
            signals_list, info_comm = _fetch_metadata_and_info_comm(keyword, top3)
            records_by_keyword[keyword] = {
                "keyword": keyword,
                "landing_page": landing_pages_by_keyword.get(keyword, ""),
                "top3": top3,
                "signals": signals_list,
                "info_comm": info_comm,
            }
            print(f"[INTENT] done: '{keyword}' -> info_comm={info_comm!r} ({len(signals_list)} pages)")
        pending.append(intent_pool.submit(_job))

    try:
        t0 = time.time()
        all_keywords = [kr["keyword"] for kr in keyword_rows]
        serp_fetch.fetch_top3_batch(all_keywords, num_tabs=serp_tabs, on_result=_submit_intent_job)

        for f in pending:
            f.result()
        print(f"\nSERP + metadata/info-comm stage complete for all {total} keyword(s) in {time.time() - t0:.1f}s.\n")

        # --- Retry pass: any keyword whose top-3 came back empty (a tab
        # timeout, not a genuine "no results") gets ONE retry, in a
        # second, smaller Selenium batch -- also feeding the intent pool. ---
        empty_keywords = [kw for kw in all_keywords if not records_by_keyword.get(kw, {}).get("top3")]
        if empty_keywords:
            print(f"{len(empty_keywords)} keyword(s) came back with an empty top-3 list -- retrying those...\n")
            retry_pending = []

            def _submit_retry_job(keyword, top3):
                if top3:
                    def _job():
                        print(f"[RETRY INTENT] start: '{keyword}'")
                        signals_list, info_comm = _fetch_metadata_and_info_comm(keyword, top3)
                        records_by_keyword[keyword] = {
                            "keyword": keyword,
                            "landing_page": landing_pages_by_keyword.get(keyword, ""),
                            "top3": top3,
                            "signals": signals_list,
                            "info_comm": info_comm,
                        }
                        print(f"  [RETRY OK] '{keyword}' -- now has {len(top3)} result(s)")
                    retry_pending.append(intent_pool.submit(_job))
                else:
                    print(f"  [RETRY STILL EMPTY] '{keyword}'")

            retry_tabs = min(serp_tabs, len(empty_keywords))
            serp_fetch.fetch_top3_batch(empty_keywords, num_tabs=retry_tabs, on_result=_submit_retry_job)
            for f in retry_pending:
                f.result()
            print()
    finally:
        intent_pool.shutdown(wait=True)
        intent_classifier.close_all_drivers()

    print("Starting category stage now.\n")

    # --- GATE: every keyword's metadata + info/comm classification is in hand before this line ---

    # --- Stage 3 (independent per keyword, no cross-referencing) ---
    t1 = time.time()
    with ThreadPoolExecutor(max_workers=category_workers) as pool:
        futures = [
            pool.submit(_run_category_and_landing_blog, record, i + 1, total)
            for i, record in enumerate(records_by_keyword.values())
        ]
        for future in futures:
            future.result()  # categorize in place on the shared record dict

    print(f"\nCategory stage complete in {time.time() - t1:.1f}s -- clustering now.\n")

    # --- Stage 4 (once, over the whole batch, in memory) ---
    all_categories = [r.get("category", "") for r in records_by_keyword.values() if r.get("category")]
    assignment = cluster_grouper.cluster_categories(
        all_categories,
        location_words=category_namer._LOCATION_WORDS,
        extra_stopwords=category_namer._FILLER_WORDS,
    )
    print(f"Clustered {len(assignment)} categories into {len(set(assignment.values()))} clusters.\n")

    # --- Terminal results summary (every row, not just the log lines above) ---
    print(f"{'='*70}")
    print("RESULTS")
    print(f"{'='*70}")
    for kr in keyword_rows:
        record = records_by_keyword.get(kr["keyword"], {})
        category = record.get("category", "")
        print(f"- {kr['keyword']!r}")
        print(f"    Landing/Blog : {record.get('landing_blog', '') or '(none)'}")
        print(f"    Info/Comm    : {record.get('info_comm', '') or '(none)'}")
        print(f"    Category     : {category or '(none)'}")
        print(f"    Cluster      : {assignment.get(category, '') if category else '(none)'}")
    print(f"{'='*70}\n")

    # --- Write output -------------------------------------------------
    # New columns appended to the SAME sheet's existing columns (Keywords,
    # Landing Page, ...) -- nothing already in the CSV is renamed/dropped.
    new_columns = [
        "Top 3 URLs (JSON)", "Landing/Blog Page",
        "Informational/Commercial Page", "Category", "Cluster",
    ]
    output_fieldnames = list(original_fieldnames)
    for col in new_columns:
        if col not in output_fieldnames:
            output_fieldnames.append(col)

    if in_place:
        output_path = input_path
        backup_path = input_path + ".bak"
        import shutil
        shutil.copyfile(input_path, backup_path)
        print(f"Backed up original sheet to {backup_path}")
    elif not output_path:
        base_name = os.path.splitext(input_path)[0]
        output_path = f"{base_name}_exp_pipeline.csv"

    for row in rows:
        kw, _lp = _extract_keyword_and_landing_page(row)
        record = records_by_keyword.get(kw, {}) if kw else {}
        category = record.get("category", "")
        row["Top 3 URLs (JSON)"] = json.dumps(record.get("top3", []), ensure_ascii=False) if record else ""
        row["Landing/Blog Page"] = record.get("landing_blog", "")
        row["Informational/Commercial Page"] = record.get("info_comm", "")
        row["Category"] = category
        row["Cluster"] = assignment.get(category, "") if category else ""

    with open(output_path, "w", newline="", encoding="utf-8-sig") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=output_fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done -- wrote {len(rows)} row(s) ({total} processed) to {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Experimental category/cluster pipeline test")
    parser.add_argument("--input", type=str, default=DEFAULT_INPUT, help="Path to input CSV (Keywords column)")
    parser.add_argument("--output", type=str, default=None, help="Path to output CSV (default: <input>_exp_pipeline.csv)")
    parser.add_argument("--in-place", action="store_true",
                         help="Write results back into --input itself (new columns appended), "
                              "backing up the original to <input>.bak first")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of rows processed (for a quick test run)")
    parser.add_argument("--serp-tabs", type=int, default=DEFAULT_SERP_TABS,
                         help=f"Number of Chrome tabs the Selenium SERP fetch opens (default: {DEFAULT_SERP_TABS})")
    parser.add_argument("--metadata-workers", type=int, default=DEFAULT_METADATA_WORKERS)
    parser.add_argument("--category-workers", type=int, default=DEFAULT_CATEGORY_WORKERS)
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    if not os.path.exists(input_path):
        print(f"Error: input file not found at {input_path}")
        sys.exit(1)

    run_experiment(
        input_path,
        output_path=args.output,
        limit=args.limit,
        serp_tabs=args.serp_tabs,
        metadata_workers=args.metadata_workers,
        category_workers=args.category_workers,
        in_place=args.in_place,
    )


if __name__ == "__main__":
    main()
