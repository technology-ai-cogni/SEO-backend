"""
hosted_categorize.py

Selenium-free version of the category/landing-blog/info-comm pipeline,
meant to run INSIDE app.py's own process on a hosted deployment (Render)
where a real browser isn't available and there's no separate RQ/Redis
worker anymore. Reuses the exact same per-stage modules
scripts/run_pipeline.py uses wherever they don't need a browser --
nothing here reimplements category_assigner.py, landing_blog_
classifier.py, or cluster_assigner.py. Only the two browser-dependent
pieces are swapped for hosted-safe equivalents:

    SERP fetch  -- services/category_checker.get_top3_for_category()
                   (Bright Data's SERP zone), instead of
                   scripts/serp_scraper.py's Selenium tab pool.
    info/comm   -- scripts/intent_classifier.classify_single_result_via_requests()
                   (plain requests.get), instead of its Selenium-based
                   classify_single_result().

Driven by the SAME `jobs` table status/progress tracking the frontend
already polls (db.create_job/set_job_status/increment_job_progress/
get_job) -- no RQ/Redis involved, just a background thread started from
app.py's endpoint (see run_categorize_job_in_background below).

Category assignment must stay strictly sequential PER PROJECT (each
decision depends on categories already created by prior keywords, same
requirement category_checker.py's own docstring states) -- _category_lock
below ensures only one categorize job runs at a time across this whole
process, matching the "run only ONE category worker" rule the old
RQ-based deployment enforced by only ever running one `category_checks`
worker.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

from core import db
from services import category_checker
from scripts.category_assigner import categorize_from_top3
from scripts.landing_blog_classifier import classify_landing_or_blog
from scripts.intent_classifier import classify_single_result_via_requests, majority_subtype
from scripts.cluster_assigner import cluster_project

INTENT_WORKERS = 8

# Only one categorize job runs at a time across this whole process --
# category matching is inherently sequential per project (see module
# docstring above), and a hosted Render deployment here is a single
# process (WEB_CONCURRENCY=1), so a simple in-process lock is enough --
# no cross-process coordination (Redis, Postgres advisory lock, etc.)
# needed.
_category_lock = threading.Lock()


def _classify_intent(top3_results):
    results = []
    for r in (top3_results or [])[:3]:
        url = (r or {}).get("url")
        title = (r or {}).get("title")
        if not url:
            continue
        try:
            results.append(classify_single_result_via_requests(url, title))
        except Exception as e:
            results.append({"classification": "Unknown", "confidence": 0, "reason": f"Error: {e}", "url": url})
    return majority_subtype(results)


def _process_one_keyword(job_id, domain, row, country_code, intent_pool):
    row_id, keyword = row["id"], row["keyword"]
    try:
        top3 = category_checker.get_top3_for_category(keyword, country_code)

        if not top3:
            db.update_keyword_result(domain, row_id, None, None, "no_data")
            return

        category = categorize_from_top3(keyword, top3, domain)
        target_type = classify_landing_or_blog(top3)
        subtype = intent_pool.submit(_classify_intent, top3).result()

        db.update_keyword_result(
            domain, row_id, category, None, "processed" if category else "no_data",
            meta={"top3": top3}, computed_target_type=target_type, computed_subtype=subtype,
        )
    except Exception as e:
        db.update_keyword_result(domain, row_id, None, None, "error", error=str(e))
    finally:
        db.increment_job_progress(job_id)


def run_categorize_job(job_id, domain, rows, country_code):
    """Runs SYNCHRONOUSLY in the calling thread -- callers (app.py) are
    responsible for launching this in a background thread so the HTTP
    request that triggered it returns immediately. `rows`: list of dicts
    with at least `id` and `keyword` (e.g. from
    db.get_uncategorized_keyword_rows())."""
    if not _category_lock.acquire(blocking=False):
        db.set_job_status(job_id, "failed", error="Another categorization job is already running on this server -- try again shortly.")
        return

    try:
        with ThreadPoolExecutor(max_workers=INTENT_WORKERS) as intent_pool:
            for row in rows:
                _process_one_keyword(job_id, domain, row, country_code, intent_pool)

        job = db.get_job(job_id)
        if job and job["status"] == "completed":
            if db.try_mark_clustering_triggered(job_id):
                try:
                    cluster_project(domain)
                except Exception as e:
                    print(f"[hosted_categorize] cluster error for job {job_id}: {e}")
    finally:
        _category_lock.release()


def run_categorize_job_in_background(job_id, domain, rows, country_code):
    """Fire-and-forget entry point for app.py -- starts run_categorize_job()
    on a daemon thread and returns immediately."""
    thread = threading.Thread(
        target=run_categorize_job, args=(job_id, domain, rows, country_code), daemon=True,
    )
    thread.start()
