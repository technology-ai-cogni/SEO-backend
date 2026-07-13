"""
hosted_rank_check.py

Runs rank-checking for every keyword in a job, in the background, inside
app.py's own process -- no RQ/Redis involved. services/rank_checker.py
was already Selenium-free (Bright Data + plain `requests`, see that
file's own module docstring), so no hosted-safe swap is needed here the
way hosted_categorize.py needed one for info/comm -- this just runs
rank_checker.find_rank() directly from a thread pool.

Unlike categorization, rank-checking has NO ordering dependency between
keywords (see rank_checker.py's docstring), so this runs with real
concurrency via a thread pool instead of a single lock.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

from core import db
from services import rank_checker

RANK_CHECK_WORKERS = 8


def _check_one(project_slug, row, country_code, default_domain):
    row_id, keyword, landing_page_url = row["id"], row["keyword"], row["landing_page_url"]
    try:
        rank, matched_links = rank_checker.find_rank(
            keyword, landing_page_url, default_domain=default_domain, country_code=country_code,
        )
        rank_meta = {
            "checked_domain": default_domain,
            "used_landing_page": bool((landing_page_url or "").strip()),
            "top_links": matched_links,
        }
        db.update_keyword_rank(row_id, rank, rank_meta=rank_meta)
    except Exception as e:
        db.update_keyword_rank(row_id, None, rank_meta={"error": str(e)})


def run_rank_check_job(project_slug, rows, country_code):
    """Runs SYNCHRONOUSLY in the calling thread -- callers (app.py) are
    responsible for launching this in a background thread. `rows`: list
    of dicts with id/keyword/landing_page_url (e.g. from
    db.get_job_keyword_rows_for_rank_check())."""
    domain_record = db.get_domain_by_project_slug(project_slug)
    default_domain = (domain_record or {}).get("domain") or rank_checker.DEFAULT_DOMAIN

    with ThreadPoolExecutor(max_workers=RANK_CHECK_WORKERS) as pool:
        futures = [
            pool.submit(_check_one, project_slug, row, country_code, default_domain)
            for row in rows
        ]
        for f in futures:
            f.result()


def run_rank_check_job_in_background(project_slug, rows, country_code):
    """Fire-and-forget entry point for app.py."""
    thread = threading.Thread(
        target=run_rank_check_job, args=(project_slug, rows, country_code), daemon=True,
    )
    thread.start()
