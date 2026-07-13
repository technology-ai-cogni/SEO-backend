"""
run_pipeline.py

The "major" orchestrator -- imports each stage as a function from its
own file and wires them together. It does NOT reimplement any stage's
logic itself:

    scripts/serp_scraper.py             -- run_search_pool() (Selenium, unchanged)
    scripts/category_assigner.py        -- categorize_from_top3() (OpenAI + Postgres)
    scripts/landing_blog_classifier.py  -- classify_landing_or_blog() (deterministic)
    scripts/intent_classifier.py        -- classify_single_result() / majority_subtype() (OpenAI, per-URL fetch)
    scripts/cluster_assigner.py         -- cluster_project() (deterministic, final pass)

Output columns: Keyword, Start Time, Stop Time, Top 3 URLs (JSON),
Category, Cluster, Landing/Blog Page, Informational/Commercial Page.

--- Data flow --------------------------------------------------------

Input file (.csv/.xlsx with a "Keywords" column)
        |
        v
serp_scraper.load_data()
        |
        v
+--------------------------------------------------------------------+
| MAIN THREAD: serp_scraper.run_search_pool(..., on_result=_on_result)|
| Same Chrome/10-tab round-robin scraper as running serp_scraper.py  |
| directly -- fetches each keyword's top-3 (url, title). The ONLY    |
| addition is the on_result callback, called the instant each tab's  |
| job finishes.                                                      |
+--------------------------------------------------------------------+
        |
        | on_result() fans each finished (keyword, top3) out to TWO
        | independent, concurrent downstream stages:
        |
        +---------------------------------+----------------------------------+
        v                                                                    v
+----------------------------------+                    +----------------------------------+
| CATEGORY THREAD (exactly one)     |                    | INFO/COMM THREAD POOL (8 workers) |
| category_assigner                 |                    | intent_classifier                 |
|   .categorize_from_top3()         |                    |   .classify_single_result() x<=3  |
| landing_blog_classifier            |                    |   .majority_subtype()             |
|   .classify_landing_or_blog()     |                    |                                    |
| ("side by side" -- both computed  |                    | (fetches each of the up-to-3      |
|  in the same thread/step, right   |                    |  destination pages via its own    |
|  after each other, since target-  |                    |  headless Chrome, independent of  |
|  type is deterministic/instant)   |                    |  the SERP-scraping browser above) |
+----------------------------------+                    +----------------------------------+
        |                                                                    |
        +---------------------------------+----------------------------------+
                                           v
                    shared `partial` dict, one entry per row, keyed by a
                    stable row id (NOT keyword text -- duplicate keywords
                    can appear in the input) -- guarded by a lock. The row
                    is written to the output CSV the instant BOTH sides
                    have reported in for it (Cluster is left blank here --
                    clustering needs the FULL category list, which isn't
                    known until every row is categorized).
                                           |
                                           v
        after every row is written: cluster_assigner.cluster_project(domain)
        -> one deterministic pass over ALL categories now in this project
        -> re-open the output CSV, fill in Cluster per row, rewrite once
        (same backup-then-rewrite convention as category_assigner.py)

Why category runs in exactly ONE dedicated thread (never a pool), same
requirement category_checker.py already documents: category matching is
inherently sequential per project (each decision depends on categories
already created by prior keywords) -- concurrent categorization would
race on "which categories already exist." Landing/blog classification is
deterministic and effectively free, so it rides along in that same
thread rather than needing its own stage.

Info/comm classification has no such sequential dependency (each
keyword's classification is fully independent), so it runs across a
real thread pool for throughput -- reusing intent_classifier.py's own
per-thread headless-Chrome-driver pattern unchanged.

Run from the `backend/` directory:
    python -m scripts.run_pipeline "datasets/your_input_file.csv" "your project name"

Arguments:
    1. input file path (.csv or .xlsx with a "Keywords" column) -- required
    2. project display name (Postgres-backed category storage) --
       optional, defaults to the input file's base name

Output: "<input file, without extension>_pipeline.csv"
"""

import csv
import json
import os
import queue
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from core import db
from scripts import serp_scraper
from scripts.category_assigner import categorize_from_top3, reset_categories_for_project
from scripts.landing_blog_classifier import classify_landing_or_blog
from scripts.intent_classifier import classify_single_result, majority_subtype, close_all_drivers, DEFAULT_WORKERS
from scripts.cluster_assigner import cluster_project

OUTPUT_HEADER = [
    "Keyword", "Start Time", "Stop Time", "Top 3 URLs (JSON)",
    "Category", "Cluster", "Landing/Blog Page", "Informational/Commercial Page",
]

_CATEGORY_SENTINEL = None


def _classify_intent(top3_results):
    """Runs in an intent-pool worker thread: classify each of the (up to
    3) SERP results' destination pages, then take the majority vote."""
    results = []
    for r in (top3_results or [])[:3]:
        url = (r or {}).get("url")
        title = (r or {}).get("title")
        if not url:
            continue
        try:
            results.append(classify_single_result(url, title))
        except Exception as e:
            results.append({"classification": "Unknown", "confidence": 0, "reason": f"Error: {e}", "url": url})
    return majority_subtype(results)


class PipelineRun:
    """Holds the shared, lock-guarded state for one run of the pipeline
    -- the `partial` dict is how the category thread and the info/comm
    thread pool converge on a single output row per keyword without
    stepping on each other."""

    def __init__(self, domain, output_path):
        self.domain = domain
        self.output_path = output_path
        self.lock = threading.Lock()
        self.partial = {}
        self.category_queue = queue.Queue()
        self.intent_pool = ThreadPoolExecutor(max_workers=DEFAULT_WORKERS)
        self.out_file = open(output_path, "w", newline="", encoding="utf-8-sig")
        self.writer = csv.writer(self.out_file)
        self.writer.writerow(OUTPUT_HEADER)
        self._next_id = 0
        self._category_thread = threading.Thread(target=self._category_worker, daemon=False)
        self._category_thread.start()

    def _next_row_id(self):
        row_id = self._next_id
        self._next_id += 1
        return row_id

    def _category_worker(self):
        """The ONE dedicated category thread -- strictly sequential,
        matching category_checker.py's documented single-worker
        requirement. Landing/blog is computed right alongside category
        here since it's deterministic/instant, not because it needs to
        be sequential itself."""
        while True:
            item = self.category_queue.get()
            if item is _CATEGORY_SENTINEL:
                self.category_queue.task_done()
                break

            row_id, keyword, top3_results = item
            try:
                category = categorize_from_top3(keyword, top3_results, self.domain)
            except Exception as e:
                print(f"  [CATEGORY ERROR] '{keyword}': {e}")
                category = ""

            target_type = classify_landing_or_blog(top3_results) or ""

            self._report(row_id, category=category, target_type=target_type)
            self.category_queue.task_done()

    def _report(self, row_id, **fields):
        with self.lock:
            entry = self.partial.setdefault(row_id, {
                "keyword": None, "start": None, "stop": None, "top3": None,
                "category": None, "target_type": None, "subtype": None,
                "category_done": False, "subtype_done": False,
            })
            if "category" in fields:
                entry["category"] = fields["category"]
                entry["target_type"] = fields["target_type"]
                entry["category_done"] = True
            if "subtype" in fields:
                entry["subtype"] = fields["subtype"]
                entry["subtype_done"] = True

            if entry["category_done"] and entry["subtype_done"]:
                self.writer.writerow([
                    entry["keyword"], entry["start"], entry["stop"],
                    json.dumps(entry["top3"], ensure_ascii=False),
                    entry["category"] or "", "",  # Cluster filled in later, in one final pass
                    entry["target_type"] or "", entry["subtype"] or "",
                ])
                self.out_file.flush()

                # Same row, also persisted straight to Supabase (no queue/
                # worker involved) -- cluster gets backfilled in bulk by
                # cluster_project() once every keyword here has a category.
                try:
                    db.insert_pipeline_result(
                        self.domain, entry["keyword"], entry["category"],
                        entry["target_type"], entry["subtype"],
                        meta={"top3": entry["top3"], "start": entry["start"], "stop": entry["stop"]},
                    )
                except Exception as e:
                    print(f"  [DB ERROR] '{entry['keyword']}': {e}")

                print(f"  [ROW DONE] '{entry['keyword']}' -> category={entry['category']!r} "
                      f"target_type={entry['target_type']!r} subtype={entry['subtype']!r}")
                del self.partial[row_id]

    def submit(self, keyword, top3_results, start_time, stop_time):
        row_id = self._next_row_id()
        with self.lock:
            self.partial[row_id] = {
                "keyword": keyword, "start": start_time, "stop": stop_time, "top3": top3_results,
                "category": None, "target_type": None, "subtype": None,
                "category_done": False, "subtype_done": False,
            }
        self.category_queue.put((row_id, keyword, top3_results))
        self.intent_pool.submit(self._intent_job, row_id, top3_results)

    def _intent_job(self, row_id, top3_results):
        try:
            subtype = _classify_intent(top3_results)
        except Exception as e:
            print(f"  [INTENT ERROR] row {row_id}: {e}")
            subtype = "Unknown"
        self._report(row_id, subtype=subtype)

    def finish(self):
        self.category_queue.put(_CATEGORY_SENTINEL)
        self._category_thread.join()

        self.intent_pool.shutdown(wait=True)
        close_all_drivers()

        if self.partial:
            print(f"\n  [WARNING] {len(self.partial)} row(s) never fully completed: "
                  f"{[e['keyword'] for e in self.partial.values()]}")

        self.out_file.close()


def _apply_clusters(output_path, domain):
    """Final pass: cluster the project's whole category list (now that
    every row has been categorized), then fill in the Cluster column."""
    assignment = cluster_project(domain)
    print(f"\nClustered {len(assignment)} categories into "
          f"{len(set(assignment.values()))} clusters for this project.")

    with open(output_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    for row in rows:
        category = row.get("Category") or ""
        row["Cluster"] = assignment.get(category, "") if category else ""

    backup_path = output_path + ".bak"
    import shutil
    shutil.copyfile(output_path, backup_path)

    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _merge_retry_results_into_csv(output_path, updated_rows):
    """Rewrites ONLY the retried keywords' rows in the already-written
    output CSV, in place -- every other row is left exactly as the main
    pass wrote it. Runs BEFORE _apply_clusters(), so Cluster is still
    blank for every row at this point (same as the main pass leaves it)."""
    with open(output_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    for row in rows:
        keyword = row.get("Keyword")
        if keyword in updated_rows:
            row.update(updated_rows[keyword])

    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _retry_failed_keywords(failed_rows, domain, output_path, num_tabs):
    """Additive retry pass -- run ONCE, after the main loop finishes, for
    only the keywords whose first attempt came back with an empty top-3
    list (a tab timeout in serp_scraper.run_search_pool, or a search that
    genuinely returned no extractable organic results). Re-scrapes just
    those keywords, then re-runs category + landing/blog + info/comm for
    whichever of them now have real results, and merges those rows into
    the output CSV (and Supabase, via the same db.insert_pipeline_result()
    the main pass uses). Does not touch PipelineRun or run_search_pool --
    it just calls them again on a smaller row list.

    Not a retry loop -- if a keyword is STILL empty after this one retry,
    it's left as-is (logged), same as it would have been without this
    step at all.
    """
    if not failed_rows:
        return

    print(f"\nRetrying {len(failed_rows)} keyword(s) that came back with an empty top-3 list...\n")

    retried = {}

    def on_retry_result(row, results, start_time, stop_time):
        retried[row["keyword"]] = (results, start_time, stop_time)

    driver = serp_scraper.get_driver()
    try:
        serp_scraper.run_search_pool(driver, failed_rows, output_path=None, on_result=on_retry_result, num_tabs=num_tabs)
    finally:
        driver.quit()

    updated_rows = {}
    for keyword, (results, start_time, stop_time) in retried.items():
        if not results:
            print(f"  [RETRY STILL EMPTY] '{keyword}' -- still no top-3 results after retry")
            continue

        category, target_type, subtype = "", "", "Unknown"
        try:
            category = categorize_from_top3(keyword, results, domain) or ""
        except Exception as e:
            print(f"  [RETRY CATEGORY ERROR] '{keyword}': {e}")
        try:
            target_type = classify_landing_or_blog(results) or ""
        except Exception as e:
            print(f"  [RETRY LANDING/BLOG ERROR] '{keyword}': {e}")
        try:
            subtype = _classify_intent(results)
        except Exception as e:
            print(f"  [RETRY INTENT ERROR] '{keyword}': {e}")

        try:
            db.insert_pipeline_result(
                domain, keyword, category, target_type, subtype,
                meta={"top3": results, "start": start_time, "stop": stop_time, "retried": True},
            )
        except Exception as e:
            print(f"  [RETRY DB ERROR] '{keyword}': {e}")

        updated_rows[keyword] = {
            "Keyword": keyword, "Start Time": start_time, "Stop Time": stop_time,
            "Top 3 URLs (JSON)": json.dumps(results, ensure_ascii=False),
            "Category": category, "Landing/Blog Page": target_type,
            "Informational/Commercial Page": subtype,
        }
        print(f"  [RETRY DONE] '{keyword}' -> category={category!r} target_type={target_type!r} subtype={subtype!r}")

    close_all_drivers()

    if updated_rows:
        _merge_retry_results_into_csv(output_path, updated_rows)


def run_pipeline(input_path, project_display_name=None, num_tabs=serp_scraper.NUM_TABS):
    rows = serp_scraper.load_data(input_path)
    if not rows:
        print("No rows found. Exiting.")
        return None

    base, _ext = os.path.splitext(input_path)
    output_path = base + "_pipeline.csv"

    project_display_name = project_display_name or os.path.basename(base)
    domain = db.get_or_create_project(project_display_name)
    reset_categories_for_project(domain)
    print(f"Using project '{project_display_name}' (slug: {domain}) -- reset to a clean category slate\n")

    run = PipelineRun(domain, output_path)
    empty_top3_rows = []  # keywords whose first pass came back with no top-3 results

    def on_result(row, results, start_time, stop_time):
        if not results:
            empty_top3_rows.append(row)
        run.submit(row["keyword"], results, start_time, stop_time)

    driver = serp_scraper.get_driver()
    try:
        serp_scraper.run_search_pool(driver, rows, output_path=None, on_result=on_result, num_tabs=num_tabs)
    finally:
        driver.quit()

    print("\nAll keywords fetched -- waiting for category + info/comm stages to finish draining...\n")
    run.finish()

    _retry_failed_keywords(empty_top3_rows, domain, output_path, num_tabs)

    _apply_clusters(output_path, domain)

    print(f"\nDone -- wrote {len(rows)} fully-enriched rows to {output_path}")
    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.run_pipeline <input_file.csv|.xlsx> [project name]")
        sys.exit(1)

    input_arg = sys.argv[1]
    project_arg = sys.argv[2] if len(sys.argv) > 2 else None
    run_pipeline(input_arg, project_arg)
