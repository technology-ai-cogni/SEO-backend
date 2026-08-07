"""
hosted_rank_check.py

Runs rank-checking for every keyword in a job, in the background, inside
app.py's own process -- no RQ/Redis involved.

Multi-pass Retry Strategy:
1. Primary Pass: Bright Data (rank_checker.find_rank) for all keywords.
2. Retry Rule: If rank == 101 and top_links length < 30 (or empty),
   flag for retry in Pass 2 using Firecrawl (rank_checker_fc.find_rank).
3. Post-Dataset Pass 3: If still rank == 101 and top_links length < 30,
   retry once more using Bright Data.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

from core import db
from services import rank_checker, rank_checker_fc

RANK_CHECK_WORKERS = 3


def _should_retry(rank, matched_links):
    """Flags a keyword for retry if top_links is empty or if rank is 101 and fewer than 30 links were fetched."""
    if not matched_links or len(matched_links) == 0:
        return True
    if (rank is None or rank == 101) and len(matched_links) < 30:
        return True
    return False


def _check_one_brightdata(project_slug, row, country_code, default_domain):
    row_id, keyword, landing_page_url = row["id"], row["keyword"], row["landing_page_url"]
    try:
        rank, matched_links = rank_checker.find_rank(
            keyword, landing_page_url, default_domain=default_domain, country_code=country_code,
        )
        matched_links = matched_links or []
        rank_meta = {
            "checked_domain": default_domain,
            "used_landing_page": bool((landing_page_url or "").strip()),
            "top_links": matched_links,
            "provider": "brightdata"
        }
        db.update_keyword_rank(row_id, rank, rank_meta=rank_meta)
        return row, rank, matched_links
    except Exception as e:
        db.update_keyword_rank(row_id, None, rank_meta={"error": str(e), "top_links": [], "provider": "brightdata"})
        return row, 101, []


def _check_one_firecrawl(project_slug, row, country_code, default_domain):
    row_id, keyword, landing_page_url = row["id"], row["keyword"], row["landing_page_url"]
    try:
        rank, matched_links = rank_checker_fc.find_rank(
            keyword, landing_page_url, default_domain=default_domain, country_code=country_code,
        )
        matched_links = matched_links or []
        if matched_links:
            rank_meta = {
                "checked_domain": default_domain,
                "used_landing_page": bool((landing_page_url or "").strip()),
                "top_links": matched_links,
                "provider": "firecrawl"
            }
            db.update_keyword_rank(row_id, rank, rank_meta=rank_meta)
        return row, rank, matched_links
    except Exception as e:
        return row, 101, []


def run_rank_check_job(project_slug, rows, country_code):
    """Runs SYNCHRONOUSLY in the calling thread -- callers (app.py) are
    responsible for launching this in a background thread. `rows`: list
    of dicts with id/keyword/landing_page_url (e.g. from
    db.get_job_keyword_rows_for_rank_check())."""
    domain_record = db.get_domain_by_project_slug(project_slug)
    default_domain = (domain_record or {}).get("domain") or rank_checker.DEFAULT_DOMAIN

    # --- PASS 1: Primary check via Bright Data ---
    retry_rows = []
    with ThreadPoolExecutor(max_workers=RANK_CHECK_WORKERS) as pool:
        futures = [
            pool.submit(_check_one_brightdata, project_slug, row, country_code, default_domain)
            for row in rows
        ]
        for f in futures:
            row, rank, matched_links = f.result()
            if _should_retry(rank, matched_links):
                retry_rows.append(row)

    if not retry_rows:
        print(f"[hosted_rank_check] Pass 1 complete: All {len(rows)} keywords resolved with valid ranks / 30+ links.")
        return

    print(f"[hosted_rank_check] Pass 1 complete: {len(retry_rows)}/{len(rows)} keywords need retry (rank=101 with <30 links or empty). Starting Pass 2 (Firecrawl)...")

    # --- PASS 2: Retry incomplete keywords using Firecrawl ---
    still_retry_rows = []
    with ThreadPoolExecutor(max_workers=RANK_CHECK_WORKERS) as pool:
        futures = [
            pool.submit(_check_one_firecrawl, project_slug, row, country_code, default_domain)
            for row in retry_rows
        ]
        for f in futures:
            row, rank, matched_links = f.result()
            if _should_retry(rank, matched_links):
                still_retry_rows.append(row)

    if not still_retry_rows:
        print(f"[hosted_rank_check] Pass 2 complete: All retry keywords resolved via Firecrawl.")
        return

    print(f"[hosted_rank_check] Pass 2 complete: {len(still_retry_rows)}/{len(retry_rows)} keywords still need retry. Starting Pass 3 (Bright Data Retry)...")

    # --- PASS 3: Final fallback for remaining incomplete keywords via Bright Data ---
    with ThreadPoolExecutor(max_workers=RANK_CHECK_WORKERS) as pool:
        futures = [
            pool.submit(_check_one_brightdata, project_slug, row, country_code, default_domain)
            for row in still_retry_rows
        ]
        for f in futures:
            f.result()

    print(f"[hosted_rank_check] All passes complete for project '{project_slug}'.")


def run_rank_check_job_in_background(project_slug, rows, country_code):
    """Fire-and-forget entry point for app.py."""
    thread = threading.Thread(
        target=run_rank_check_job, args=(project_slug, rows, country_code), daemon=True,
    )
    thread.start()
