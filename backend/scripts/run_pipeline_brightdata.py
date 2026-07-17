"""
run_pipeline_brightdata.py

Bright-Data equivalent of run_pipeline.py -- same stages (SERP fetch ->
category + landing/blog -> info/comm -> cluster), same "each stage
imports the real function, never reimplements it" rule, but SERP fetch
is category_checker.get_top3_for_category() (Bright Data, no browser)
instead of serp_scraper.py's Selenium tab pool, and info/comm is
intent_classifier.classify_single_result_via_requests() (plain
requests.get) instead of a headless-Chrome fetch.

Exists because the PRODUCTION Bright Data engine
(hosted_categorize.py's _run_categorize_job_bright_data) currently
processes keywords fully SEQUENTIALLY -- one keyword's SERP fetch fully
completes before the next one starts, no real concurrency at all,
despite INTENT_WORKERS existing (it only governs the info/comm
sub-call, which is submitted to a pool but then immediately awaited via
.result() right where it's submitted, so it provides no actual
overlap). This script fixes that: SERP_FETCH_WORKERS (5) concurrently
fetch from Bright Data, and the moment each keyword's top-5 lands, it's
handed to the SAME single sequential category thread + separate
info/comm pool pattern run_pipeline.py already uses.

Why 5 workers specifically: tested empirically against live Bright Data
-- 15 concurrent requests came back empty ~40% of the time (Bright
Data/Google blocking under bursty concurrent load), 5 concurrent came
back empty ~10% of the time. Neither is 0%, which is why retry-once-at-
the-end (below) exists -- same pattern serp_scraper.py's Selenium tab
pool and run_pipeline.py already use for their own empty-result cases.

Prints every keyword's full result (top-5 URLs/titles, category,
landing/blog, info/comm) to the terminal the instant it's ready, plus a
final summary table and the cluster assignment once computed.

Run from the `backend/` directory:
    python -m scripts.run_pipeline_brightdata "datasets/your_input_file.csv" "project name" [country_code]
"""

import csv
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from core import db
from services import category_checker
from scripts.category_assigner import categorize_from_top3, reset_categories_for_project
from scripts.landing_blog_classifier import classify_landing_or_blog, force_blog_if_best_top
from scripts.intent_classifier import classify_single_result_via_requests, majority_subtype
from scripts.cluster_assigner import cluster_project

SERP_FETCH_WORKERS = 5
INTENT_WORKERS = 5

_CATEGORY_SENTINEL = None


def _load_keywords(input_path):
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = [c.strip() for c in (reader.fieldnames or [])]
        keyword_col = None
        for candidate in ("Keyword", "Keywords", "keyword", "keywords", "KW", "kw"):
            if candidate in fieldnames:
                keyword_col = candidate
                break
        if keyword_col is None:
            raise ValueError(f"No Keyword column found. Headers: {fieldnames}")

        keywords = []
        for row in reader:
            kw = (row.get(keyword_col) or "").strip()
            if kw:
                keywords.append(kw)
    return keywords


def _classify_intent(top5):
    results = []
    for r in (top5 or [])[:5]:
        url = (r or {}).get("url")
        title = (r or {}).get("title")
        if not url:
            continue
        try:
            results.append(classify_single_result_via_requests(url, title))
        except Exception as e:
            results.append({"classification": "Unknown", "confidence": 0, "reason": f"Error: {e}", "url": url})
    return majority_subtype(results)


class Pipeline:
    def __init__(self, domain):
        self.domain = domain
        self.lock = threading.Lock()
        self.partial = {}
        self.results = {}  # keyword -> final record, for the summary table
        self.category_queue = __import__("queue").Queue()
        self.intent_pool = ThreadPoolExecutor(max_workers=INTENT_WORKERS)
        self._category_thread = threading.Thread(target=self._category_worker, daemon=False)
        self._category_thread.start()

    def _category_worker(self):
        while True:
            item = self.category_queue.get()
            if item is _CATEGORY_SENTINEL:
                self.category_queue.task_done()
                break
            keyword, top5 = item
            try:
                category = categorize_from_top3(keyword, top5, self.domain) or ""
            except Exception as e:
                print(f"  [CATEGORY ERROR] '{keyword}': {e}")
                category = ""
            try:
                target_type = classify_landing_or_blog(top5) or ""
                target_type = force_blog_if_best_top(category, target_type)
            except Exception as e:
                print(f"  [LANDING/BLOG ERROR] '{keyword}': {e}")
                target_type = ""
            self._report(keyword, category=category, target_type=target_type)
            self.category_queue.task_done()

    def _report(self, keyword, **fields):
        with self.lock:
            entry = self.partial.setdefault(keyword, {
                "top5": None, "category": None, "target_type": None, "subtype": None,
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
                print(f"\n[DONE] '{keyword}'")
                for i, r in enumerate(entry["top5"] or [], 1):
                    print(f"    {i}. {r.get('title', '')!r} -- {r.get('url', '')}")
                print(f"    Category:          {entry['category']!r}")
                print(f"    Landing/Blog Page: {entry['target_type']!r}")
                print(f"    Info/Comm:         {entry['subtype']!r}")

                try:
                    db.insert_pipeline_result(
                        self.domain, keyword, entry["category"], entry["target_type"], entry["subtype"],
                        meta={"top3": entry["top5"]},
                    )
                except Exception as e:
                    print(f"    [DB ERROR] {e}")

                self.results[keyword] = dict(entry)
                del self.partial[keyword]

    def submit(self, keyword, top5):
        with self.lock:
            self.partial.setdefault(keyword, {
                "top5": None, "category": None, "target_type": None, "subtype": None,
                "category_done": False, "subtype_done": False,
            })
            self.partial[keyword]["top5"] = top5
        self.category_queue.put((keyword, top5))
        self.intent_pool.submit(self._intent_job, keyword, top5)

    def _intent_job(self, keyword, top5):
        try:
            subtype = _classify_intent(top5)
        except Exception as e:
            print(f"  [INTENT ERROR] '{keyword}': {e}")
            subtype = "Unknown"
        self._report(keyword, subtype=subtype)

    def finish(self):
        self.category_queue.put(_CATEGORY_SENTINEL)
        self._category_thread.join()
        self.intent_pool.shutdown(wait=True)

        if self.partial:
            print(f"\n[WARNING] {len(self.partial)} keyword(s) never fully completed: {list(self.partial.keys())}")


def _fetch_batch(keywords, country_code, on_result):
    """Concurrently fetches top-5 for every keyword via SERP_FETCH_WORKERS
    workers, calling on_result(keyword, top5) the instant each one lands."""
    def _fetch_one(kw):
        try:
            top5 = category_checker.get_top3_for_category(kw, country_code)
        except Exception as e:
            print(f"  [SERP FETCH ERROR] '{kw}': {e}")
            top5 = []
        return kw, top5

    with ThreadPoolExecutor(max_workers=SERP_FETCH_WORKERS) as pool:
        futures = [pool.submit(_fetch_one, kw) for kw in keywords]
        for f in futures:
            kw, top5 = f.result()
            on_result(kw, top5)


def run_pipeline(input_path, project_display_name=None, country_code="in"):
    keywords = _load_keywords(input_path)
    if not keywords:
        print("No keywords found. Exiting.")
        return

    project_display_name = project_display_name or input_path
    domain = db.get_or_create_project(project_display_name)
    reset_categories_for_project(domain)
    print(f"Using project '{project_display_name}' (slug: {domain}) -- reset to a clean category slate")
    print(f"{len(keywords)} keyword(s), SERP_FETCH_WORKERS={SERP_FETCH_WORKERS}, INTENT_WORKERS={INTENT_WORKERS}\n")

    pipeline = Pipeline(domain)
    empty_keywords = []

    def on_result(kw, top5):
        if not top5:
            empty_keywords.append(kw)
        pipeline.submit(kw, top5)

    print(f"=== MAIN PASS: fetching top-5 for {len(keywords)} keyword(s) ===")
    _fetch_batch(keywords, country_code, on_result)
    pipeline.finish()

    if empty_keywords:
        print(f"\n=== RETRY PASS: {len(empty_keywords)} keyword(s) came back empty, retrying once ===")
        retry_pipeline = Pipeline(domain)

        def on_retry_result(kw, top5):
            if not top5:
                print(f"  [STILL EMPTY] '{kw}' -- giving up after retry")
            retry_pipeline.submit(kw, top5)

        _fetch_batch(empty_keywords, country_code, on_retry_result)
        retry_pipeline.finish()
        pipeline.results.update(retry_pipeline.results)

    print("\n=== CLUSTERING ===")
    assignment = cluster_project(domain)
    print(f"Clustered {len(assignment)} categories into {len(set(assignment.values()))} clusters.")

    print("\n=== SUMMARY ===")
    print(f"{'Keyword':<45} {'Category':<35} {'Cluster':<30} {'Landing/Blog':<15} {'Info/Comm'}")
    print("-" * 150)
    for kw in keywords:
        entry = pipeline.results.get(kw)
        if not entry:
            print(f"{kw:<45} {'(never completed)'}")
            continue
        category = entry["category"] or ""
        cluster = assignment.get(category, "") if category else ""
        print(f"{kw:<45} {category:<35} {cluster:<30} {entry['target_type']:<15} {entry['subtype']}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.run_pipeline_brightdata <input_file.csv> [project name] [country_code]")
        sys.exit(1)

    input_arg = sys.argv[1]
    project_arg = sys.argv[2] if len(sys.argv) > 2 else None
    country_arg = sys.argv[3] if len(sys.argv) > 3 else "in"
    run_pipeline(input_arg, project_arg, country_arg)
