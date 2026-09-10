"""
hosted_rank_check.py

Runs rank-checking for every keyword in a job, in the background, inside
app.py's own process -- no RQ/Redis involved.

Ranking target: the PROJECT'S OWN DOMAIN (the domain entered in Project
Setup -> Create Project), NOT each row's pre-declared landing_page_url.
Every keyword is checked -- a keyword with no landing page is no longer
skipped. The matched Google result URL is stored back on the row in
`page_url_fetched`, and `rank` reflects that domain match.

Multi-pass retry strategy:
1. Primary pass: Bright Data (rank_checker.find_rank_by_domain).
2. Retry rule: if rank == 101 and fewer than ~25 links were fetched (or
   none), retry via Firecrawl (rank_checker_fc.find_rank_by_domain) --
   Firecrawl also returns the real full ranking URL.
3. Final pass: anything still unresolved goes back through Bright Data.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

from core import db
from services import rank_checker, rank_checker_fc

RANK_CHECK_WORKERS = 3


def _should_retry(rank, matched_links):
    """Retry if nothing came back, or rank is 101 off a thin result set."""
    if not matched_links:
        return True
    if (rank is None or rank == 101) and len(matched_links) < 25:
        return True
    return False


def _check_one_brightdata(project_slug, row, country_code, target_domain):
    row_id, keyword = row["id"], row["keyword"]
    try:
        rank, page_url, all_urls = rank_checker.find_rank_by_domain(
            keyword, target_domain, country_code=country_code,
        )
        all_urls = all_urls or []
        rank_meta = {
            "checked_domain": target_domain,
            "match_mode": "domain",
            "top_links": all_urls,
            "provider": "brightdata",
        }
        db.update_keyword_rank(row_id, rank, rank_meta=rank_meta, page_url_fetched=page_url)
        return row, rank, all_urls
    except Exception as e:
        db.update_keyword_rank(
            row_id, None,
            rank_meta={"error": str(e), "top_links": [], "provider": "brightdata", "match_mode": "domain"},
        )
        return row, 101, []


def _check_one_firecrawl(project_slug, row, country_code, target_domain):
    row_id, keyword = row["id"], row["keyword"]
    try:
        rank, page_url, all_urls = rank_checker_fc.find_rank_by_domain(
            keyword, target_domain, country_code=country_code,
        )
        all_urls = all_urls or []
        if all_urls:
            rank_meta = {
                "checked_domain": target_domain,
                "match_mode": "domain",
                "top_links": all_urls,
                "provider": "firecrawl",
            }
            db.update_keyword_rank(row_id, rank, rank_meta=rank_meta, page_url_fetched=page_url)
        return row, rank, all_urls
    except Exception:
        return row, 101, []


def run_rank_check_job(project_slug, rows, country_code):
    """Runs SYNCHRONOUSLY in the calling thread -- callers (app.py) launch
    this in a background thread. `rows`: list of dicts with at least
    id/keyword (e.g. from db.get_categorized_keyword_rows())."""
    domain_record = db.get_domain_by_project_slug(project_slug)
    target_domain = rank_checker.normalize_domain(
        (domain_record or {}).get("domain") or rank_checker.DEFAULT_DOMAIN
    )

    if not target_domain:
        print(f"[hosted_rank_check] Project '{project_slug}' has no domain registered "
              f"(Project Setup -> Create Project). Nothing to rank-check against.")
        for r in rows:
            db.update_keyword_rank(r["id"], None, rank_meta={"skipped": "no_project_domain"})
        return

    if not rows:
        print(f"[hosted_rank_check] No keywords to check for project '{project_slug}'.")
        return

    print(f"[hosted_rank_check] Checking {len(rows)} keywords for domain '{target_domain}' "
          f"(project '{project_slug}').")

    # --- PASS 1: Bright Data ---
    retry_rows = []
    with ThreadPoolExecutor(max_workers=RANK_CHECK_WORKERS) as pool:
        futures = [
            pool.submit(_check_one_brightdata, project_slug, row, country_code, target_domain)
            for row in rows
        ]
        for f in futures:
            row, rank, matched_links = f.result()
            if _should_retry(rank, matched_links):
                retry_rows.append(row)

    if not retry_rows:
        print(f"[hosted_rank_check] Pass 1 complete: all {len(rows)} keywords resolved.")
        return

    print(f"[hosted_rank_check] Pass 1 complete: {len(retry_rows)}/{len(rows)} need retry. "
          f"Starting Pass 2 (Firecrawl)...")

    # --- PASS 2: Firecrawl ---
    still_retry_rows = []
    with ThreadPoolExecutor(max_workers=RANK_CHECK_WORKERS) as pool:
        futures = [
            pool.submit(_check_one_firecrawl, project_slug, row, country_code, target_domain)
            for row in retry_rows
        ]
        for f in futures:
            row, rank, matched_links = f.result()
            if _should_retry(rank, matched_links):
                still_retry_rows.append(row)

    if not still_retry_rows:
        print(f"[hosted_rank_check] Pass 2 complete: all retry keywords resolved via Firecrawl.")
        return

    print(f"[hosted_rank_check] Pass 2 complete: {len(still_retry_rows)}/{len(retry_rows)} "
          f"still unresolved. Starting Pass 3 (Bright Data retry)...")

    # --- PASS 3: Bright Data again ---
    with ThreadPoolExecutor(max_workers=RANK_CHECK_WORKERS) as pool:
        futures = [
            pool.submit(_check_one_brightdata, project_slug, row, country_code, target_domain)
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
