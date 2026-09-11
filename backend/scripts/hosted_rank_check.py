"""
hosted_rank_check.py

Runs rank-checking for every keyword in a job, in the background, inside
app.py's own process -- with high-concurrency Async I/O (httpx.AsyncClient)
and external token-bucket protection.

Ranking target: the PROJECT'S OWN DOMAIN (the domain entered in Project
Setup -> Create Project), NOT each row's pre-declared landing_page_url.
Every keyword is checked -- a keyword with no landing page is no longer
skipped. The matched Google result URL is stored back on the row in
`page_url_fetched`, and `rank` reflects that domain match.

Multi-pass retry strategy:
1. Primary pass: Bright Data (rank_checker.async_find_rank_by_domain).
2. Retry rule: if rank == 101 and fewer than ~25 links were fetched (or
   none), retry via Firecrawl (rank_checker_fc.async_find_rank_by_domain) --
   Firecrawl also returns the real full ranking URL.
3. Final pass: anything still unresolved goes back through Bright Data.
"""

import threading
import asyncio
from typing import List, Dict, Any, Tuple, Optional
from concurrent.futures import ThreadPoolExecutor
import httpx

from core import db
from services import rank_checker, rank_checker_fc

CONCURRENT_RANK_WORKERS = 8


def _should_retry(rank, matched_links):
    """Retry if nothing came back, or rank is 101 off a thin result set."""
    if not matched_links:
        return True
    if (rank is None or rank == 101) and len(matched_links) < 25:
        return True
    return False


async def _async_check_one_brightdata(
    row: dict, country_code: Optional[str], target_domain: str, client: httpx.AsyncClient
) -> Tuple[dict, int, list, dict]:
    row_id, keyword = row["id"], row["keyword"]
    try:
        rank, page_url, all_urls = await rank_checker.async_find_rank_by_domain(
            keyword, target_domain, country_code=country_code, client=client
        )
        all_urls = all_urls or []
        rank_meta = {
            "checked_domain": target_domain,
            "match_mode": "domain",
            "top_links": all_urls,
            "provider": "brightdata",
        }
        update_payload = {
            "id": row_id, "rank": rank, "rank_meta": rank_meta, "page_url_fetched": page_url
        }
        return row, rank, all_urls, update_payload
    except Exception as e:
        update_payload = {
            "id": row_id, "rank": None,
            "rank_meta": {"error": str(e), "top_links": [], "provider": "brightdata", "match_mode": "domain"},
            "page_url_fetched": None
        }
        return row, 101, [], update_payload


async def _async_check_one_firecrawl(
    row: dict, country_code: Optional[str], target_domain: str, client: httpx.AsyncClient
) -> Tuple[dict, int, list, Optional[dict]]:
    row_id, keyword = row["id"], row["keyword"]
    try:
        rank, page_url, all_urls = await rank_checker_fc.async_find_rank_by_domain(
            keyword, target_domain, country_code=country_code, client=client
        )
        all_urls = all_urls or []
        if all_urls:
            rank_meta = {
                "checked_domain": target_domain,
                "match_mode": "domain",
                "top_links": all_urls,
                "provider": "firecrawl",
            }
            update_payload = {
                "id": row_id, "rank": rank, "rank_meta": rank_meta, "page_url_fetched": page_url
            }
            return row, rank, all_urls, update_payload
        return row, rank, all_urls, None
    except Exception:
        return row, 101, [], None


async def async_run_rank_check_job(project_slug: str, rows: list, country_code: Optional[str]):
    """Runs high-concurrency rank check job using async connection-pooled httpx clients."""
    domain_record = db.get_domain_by_project_slug(project_slug)
    target_domain = rank_checker.normalize_domain(
        (domain_record or {}).get("domain") or rank_checker.DEFAULT_DOMAIN
    )

    if not target_domain:
        print(f"[hosted_rank_check] Project '{project_slug}' has no domain registered. Skipping rank check.")
        skipped_updates = [
            {"id": r["id"], "rank": None, "rank_meta": {"skipped": "no_project_domain"}, "page_url_fetched": None}
            for r in rows
        ]
        db.bulk_update_keyword_ranks(skipped_updates)
        return

    if not rows:
        return

    print(f"[hosted_rank_check] Async checking {len(rows)} keywords for domain '{target_domain}' (project '{project_slug}').")

    sem = asyncio.Semaphore(CONCURRENT_RANK_WORKERS)
    limits = httpx.Limits(max_connections=30, max_keepalive_connections=15)

    async with httpx.AsyncClient(limits=limits, timeout=120.0) as http_client:
        # --- PASS 1: Bright Data ---
        retry_rows = []
        pass1_updates = []

        async def _bound_pass1(r):
            async with sem:
                return await _async_check_one_brightdata(r, country_code, target_domain, http_client)

        pass1_results = await asyncio.gather(*[_bound_pass1(r) for r in rows], return_exceptions=False)
        for row, rank, matched_links, update in pass1_results:
            if update:
                pass1_updates.append(update)
            if len(pass1_updates) >= 25:
                db.bulk_update_keyword_ranks(pass1_updates)
                pass1_updates = []
            if _should_retry(rank, matched_links):
                retry_rows.append(row)

        if pass1_updates:
            db.bulk_update_keyword_ranks(pass1_updates)

        if not retry_rows:
            print(f"[hosted_rank_check] Pass 1 complete: all {len(rows)} keywords resolved.")
            return

        print(f"[hosted_rank_check] Pass 1 complete: {len(retry_rows)}/{len(rows)} need retry. Starting Pass 2 (Firecrawl)...")

        # --- PASS 2: Firecrawl ---
        still_retry_rows = []
        pass2_updates = []

        async def _bound_pass2(r):
            async with sem:
                return await _async_check_one_firecrawl(r, country_code, target_domain, http_client)

        pass2_results = await asyncio.gather(*[_bound_pass2(r) for r in retry_rows], return_exceptions=False)
        for row, rank, matched_links, update in pass2_results:
            if update:
                pass2_updates.append(update)
            if len(pass2_updates) >= 25:
                db.bulk_update_keyword_ranks(pass2_updates)
                pass2_updates = []
            if _should_retry(rank, matched_links):
                still_retry_rows.append(row)

        if pass2_updates:
            db.bulk_update_keyword_ranks(pass2_updates)

        if not still_retry_rows:
            print(f"[hosted_rank_check] Pass 2 complete: all retry keywords resolved via Firecrawl.")
            return

        print(f"[hosted_rank_check] Pass 2 complete: {len(still_retry_rows)}/{len(retry_rows)} still unresolved. Starting Pass 3 (Bright Data retry)...")

        # --- PASS 3: Bright Data Final Pass ---
        pass3_updates = []
        pass3_results = await asyncio.gather(*[_bound_pass1(r) for r in still_retry_rows], return_exceptions=False)
        for row, rank, matched_links, update in pass3_results:
            if update:
                pass3_updates.append(update)
            if len(pass3_updates) >= 25:
                db.bulk_update_keyword_ranks(pass3_updates)
                pass3_updates = []

        if pass3_updates:
            db.bulk_update_keyword_ranks(pass3_updates)

        print(f"[hosted_rank_check] All passes complete for project '{project_slug}'.")


def run_rank_check_job(project_slug, rows, country_code):
    """Synchronous entry point that runs the async event loop."""
    try:
        asyncio.run(async_run_rank_check_job(project_slug, rows, country_code))
    except Exception as e:
        print(f"[hosted_rank_check] Error running async rank check: {e}")


def run_rank_check_job_in_background(project_slug, rows, country_code):
    """Fire-and-forget entry point for app.py."""
    thread = threading.Thread(
        target=run_rank_check_job, args=(project_slug, rows, country_code), daemon=True,
    )
    thread.start()

