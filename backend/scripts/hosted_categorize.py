"""
hosted_categorize.py

Category/landing-blog/info-comm engine driven by app.py's /jobs/category
and /projects/{project}/categorize endpoints (background thread inside
this same process, no RQ/Redis). Driven by the SAME `jobs` table status/
progress tracking the frontend already polls (db.create_job/
set_job_status/increment_job_progress/get_job).

Two engines live here, switched by the USE_SELENIUM_PIPELINE env var:

  SELENIUM ENGINE (default, USE_SELENIUM_PIPELINE unset or true)
    Uses scripts/exp_category_pipeline UNCHANGED -- serp_fetch.py's real
    Selenium tab pool for SERP fetch, scripts/intent_classifier.py's real
    headless-Chrome fetch + OpenAI classification for metadata/info-
    comm, category_namer.py's independent (no cross-referencing)
    category naming, cluster_grouper.py's deterministic clustering.
    Category assignment does NOT need to run sequentially per-project
    with this engine (each keyword's category comes only from its own
    metadata), unlike the legacy engine below.

  BRIGHT DATA ENGINE (fallback, USE_SELENIUM_PIPELINE=false)
    The ORIGINAL engine, UNCHANGED: services/category_checker's Bright
    Data SERP fetch, scripts/category_assigner.py's sequential/cross-
    referencing category matching, scripts/landing_blog_classifier.py,
    scripts/intent_classifier.py's plain-requests fetch path, scripts/
    cluster_assigner.py. Needed because a real browser isn't available on
    a hosted deployment like Render -- set USE_SELENIUM_PIPELINE=false in
    that environment's variables. Category assignment MUST run
    sequentially per project with this engine (each decision depends on
    categories already created by prior keywords) -- _category_lock
    ensures only one categorize job runs at a time across this whole
    process, matching the "run only ONE category worker" rule the old
    RQ-based deployment enforced by only ever running one
    `category_checks` worker.

Either way, `_category_lock` also caps this process to one categorize
job at a time, so two jobs (Selenium or not) never contend for the same
CPU/Chrome sessions or race on the same project's categories.
"""

import os
import threading
from concurrent.futures import ThreadPoolExecutor

from core import db
from services import category_checker
from scripts.category_assigner import categorize_from_top3
from scripts.landing_blog_classifier import classify_landing_or_blog, force_blog_if_best_top
from scripts.intent_classifier import classify_single_result_via_requests, majority_subtype
from scripts.cluster_assigner import cluster_project

from scripts import intent_classifier
from scripts.exp_category_pipeline import serp_fetch, category_namer, classifiers, cluster_grouper

INTENT_WORKERS = 15

# Only one categorize job runs at a time across this whole process --
# see module docstring for why both engines need this.
_category_lock = threading.Lock()


def _use_selenium_pipeline():
    """Explicit env-var switch -- sniffing for a real Chrome install via
    PATH isn't reliable across platforms (macOS's Chrome.app isn't on
    PATH either), so this is controlled directly. Defaults to True
    (Selenium/exp_category_pipeline) for local development; set
    USE_SELENIUM_PIPELINE=false in any environment without a real browser
    (e.g. a standard Render web service, no Dockerfile/Chrome installed)."""
    return os.environ.get("USE_SELENIUM_PIPELINE", "true").strip().lower() not in ("false", "0", "no")


# =====================================================================
# SELENIUM ENGINE -- scripts/exp_category_pipeline, unmodified
# =====================================================================

def _process_keyword_selenium(keyword, top3):
    """One keyword's metadata fetch + info/comm + category + landing/blog,
    all via scripts/intent_classifier.py (real headless Chrome) and
    scripts/exp_category_pipeline (category_namer.py, classifiers.py) --
    exactly the same logic scripts/exp_category_pipeline/run_experiment.py
    uses, reused here as-is rather than reimplemented."""
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
            print(f"[hosted_categorize/selenium] intent error '{keyword}' / '{url}': {e}")

    info_comm = intent_classifier.majority_subtype(per_url_results)

    category = ""
    try:
        category = category_namer.categorize_from_metadata(keyword, signals_list)
    except Exception as e:
        print(f"[hosted_categorize/selenium] category error '{keyword}': {e}")

    landing_blog = None
    if signals_list:
        try:
            landing_blog = classifiers.classify_landing_or_blog(signals_list)
        except Exception as e:
            print(f"[hosted_categorize/selenium] landing/blog error '{keyword}': {e}")

    # HARD override: a Best/Top category is always a Blog Page, no
    # matter what the classifier above decided.
    landing_blog = force_blog_if_best_top(category, landing_blog)

    return {"top3": top3, "category": category, "target_type": landing_blog or "", "subtype": info_comm}


def _run_categorize_job_selenium(job_id, domain, rows):
    """`rows`: list of dicts with at least `id` and `keyword`. Fetches
    top-3 for every keyword via ONE Selenium browser (tab pool), fanning
    each keyword's metadata+info/comm+category+landing/blog work out to a
    pool the instant its top-3 lands -- same flow as
    exp_category_pipeline/run_experiment.py, just writing results into
    Postgres instead of a CSV."""
    keywords = [r["keyword"] for r in rows]
    records = {}

    intent_pool = ThreadPoolExecutor(max_workers=INTENT_WORKERS)
    pending = []

    def _submit(keyword, top3):
        pending.append(intent_pool.submit(lambda: records.__setitem__(keyword, _process_keyword_selenium(keyword, top3))))

    try:
        serp_fetch.fetch_top3_batch(keywords, num_tabs=serp_fetch.NUM_TABS, on_result=_submit)
        for f in pending:
            f.result()

        empty_keywords = [kw for kw in keywords if not records.get(kw, {}).get("top3")]
        if empty_keywords:
            retry_pending = []

            def _submit_retry(keyword, top3):
                if top3:
                    retry_pending.append(
                        intent_pool.submit(lambda: records.__setitem__(keyword, _process_keyword_selenium(keyword, top3)))
                    )

            retry_tabs = min(serp_fetch.NUM_TABS, len(empty_keywords))
            serp_fetch.fetch_top3_batch(empty_keywords, num_tabs=retry_tabs, on_result=_submit_retry)
            for f in retry_pending:
                f.result()
    finally:
        intent_pool.shutdown(wait=True)
        intent_classifier.close_all_drivers()

    for row in rows:
        row_id, keyword = row["id"], row["keyword"]
        record = records.get(keyword, {})
        category = record.get("category") or None
        try:
            if category:
                db.add_category(domain, category)
            db.update_keyword_result(
                domain, row_id, category, None, "processed" if category else "no_data",
                meta={"top3": record.get("top3", [])},
                computed_target_type=record.get("target_type"),
                computed_subtype=record.get("subtype"),
            )
        except Exception as e:
            db.update_keyword_result(domain, row_id, None, None, "error", error=str(e))
        finally:
            db.increment_job_progress(job_id)

    job = db.get_job(job_id)
    if job and job["status"] == "completed":
        if db.try_mark_clustering_triggered(job_id):
            try:
                categories = db.list_category_names(domain)
                assignment = cluster_grouper.cluster_categories(
                    categories,
                    location_words=category_namer._LOCATION_WORDS,
                    extra_stopwords=category_namer._FILLER_WORDS,
                )
                db.replace_domain_clusters(domain, assignment)
            except Exception as e:
                print(f"[hosted_categorize/selenium] cluster error for job {job_id}: {e}")


# =====================================================================
# BRIGHT DATA ENGINE -- the original engine, UNCHANGED
# =====================================================================

def _classify_intent(top3_results):
    results = []
    for r in (top3_results or [])[:5]:
        url = (r or {}).get("url")
        title = (r or {}).get("title")
        if not url:
            continue
        try:
            results.append(classify_single_result_via_requests(url, title))
        except Exception as e:
            results.append({"classification": "Unknown", "confidence": 0, "reason": f"Error: {e}", "url": url})
    return majority_subtype(results)


def _process_one_keyword_bright_data(job_id, domain, row, country_code, intent_pool):
    row_id, keyword = row["id"], row["keyword"]
    try:
        import time
        top3 = []
        for attempt in range(1, 4):
            try:
                top3 = category_checker.get_top3_for_category(keyword, country_code)
                if top3:
                    break
                print(f"[hosted_categorize/bright_data] Attempt {attempt} for '{keyword}' returned empty. Retrying...")
            except Exception as e:
                print(f"[hosted_categorize/bright_data] Attempt {attempt} for '{keyword}' failed: {e}")
                if attempt == 3:
                    raise e
            time.sleep(2)

        if not top3:
            db.update_keyword_result(domain, row_id, None, None, "no_data")
            return

        category = categorize_from_top3(keyword, top3, domain)
        target_type = classify_landing_or_blog(top3)
        # HARD override: a Best/Top category is always a Blog Page, no
        # matter what the classifier above decided.
        target_type = force_blog_if_best_top(category, target_type)
        subtype = intent_pool.submit(_classify_intent, top3).result()

        db.update_keyword_result(
            domain, row_id, category, None, "processed" if category else "no_data",
            meta={"top3": top3}, computed_target_type=target_type, computed_subtype=subtype,
        )
    except Exception as e:
        db.update_keyword_result(domain, row_id, None, None, "error", error=str(e))
    finally:
        db.increment_job_progress(job_id)


def _run_categorize_job_bright_data(job_id, domain, rows, country_code):
    with ThreadPoolExecutor(max_workers=INTENT_WORKERS) as intent_pool:
        for row in rows:
            _process_one_keyword_bright_data(job_id, domain, row, country_code, intent_pool)

    job = db.get_job(job_id)
    if job and job["status"] == "completed":
        if db.try_mark_clustering_triggered(job_id):
            try:
                cluster_project(domain)
            except Exception as e:
                print(f"[hosted_categorize/bright_data] cluster error for job {job_id}: {e}")


# =====================================================================
# Dispatcher -- SAME entry point app.py already calls, unchanged signature
# =====================================================================

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
        if _use_selenium_pipeline():
            _run_categorize_job_selenium(job_id, domain, rows)
        else:
            _run_categorize_job_bright_data(job_id, domain, rows, country_code)
    finally:
        _category_lock.release()


def run_categorize_job_in_background(job_id, domain, rows, country_code):
    """Fire-and-forget entry point for app.py -- starts run_categorize_job()
    on a daemon thread and returns immediately."""
    thread = threading.Thread(
        target=run_categorize_job, args=(job_id, domain, rows, country_code), daemon=True,
    )
    thread.start()
