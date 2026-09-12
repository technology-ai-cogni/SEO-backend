"""
Core Google-rank-checking logic using Firecrawl's /v2/search API.
Extracts top organic ranking URLs accurately via Firecrawl search.
"""

import os
import time
import asyncio
from urllib.parse import urlparse
from typing import List, Tuple, Optional
import requests
import httpx
from dotenv import load_dotenv

load_dotenv()

# --- Firecrawl credentials -----------------------------------------------
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "fc-abbf6aaf1909463a84221dce00e57a6c")
FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search"

DEFAULT_DOMAIN = os.environ.get("DEFAULT_DOMAIN", "")
TOP_N = int(os.environ.get("TOP_N", "40"))
NOT_FOUND_RANK = 101
COUNTRY_CODE = os.environ.get("SERP_COUNTRY", "in")

try:
    from core.rate_limiter import external_api_limiter
except ImportError:
    try:
        from backend.core.rate_limiter import external_api_limiter
    except ImportError:
        external_api_limiter = None


def clean_url(url):
    """Normalize a URL for comparison (scheme + netloc + path, no trailing slash, no leading www)."""
    if not url or str(url).strip() == "" or str(url).lower() == "nan":
        return ""
    url = str(url).strip().rstrip("/").lower()
    if not url.startswith("http"):
        url = "https://" + url
    parsed = urlparse(url)
    netloc = parsed.netloc[4:] if parsed.netloc.startswith("www.") else parsed.netloc
    return f"{parsed.scheme}://{netloc}{parsed.path}".rstrip("/").lower()


def get_domain(url):
    """Extract bare domain (no www.) from a URL."""
    if not url:
        return ""
    if not url.startswith("http"):
        url = "https://" + url
    netloc = urlparse(url).netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc


def _extract_firecrawl_urls(res_data: dict) -> List[str]:
    """Helper to parse and deduplicate URLs from Firecrawl search response JSON."""
    if not res_data.get("success"):
        return []

    data_sec = res_data.get("data", {})
    web_results = []
    if isinstance(data_sec, dict):
        web_results = data_sec.get("web", [])
    elif isinstance(data_sec, list):
        web_results = data_sec

    urls = []
    seen = set()
    for item in web_results:
        if isinstance(item, dict):
            raw_url = item.get("url", "")
        elif isinstance(item, str):
            raw_url = item
        else:
            continue

        cleaned = clean_url(raw_url)
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            urls.append(raw_url)

    return urls


# ─── Async Firecrawl Search (httpx.AsyncClient + Concurrency Limiter) ────────

async def async_fetch_top_results_via_firecrawl(
    keyword: str,
    limit: int = TOP_N,
    country_code: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None
) -> List[str]:
    """
    Asynchronously fetch organic ranking result URLs via Firecrawl /v2/search endpoint.
    Protected by external_api_limiter semaphore to avoid 429 rate limit errors.
    """
    if not FIRECRAWL_API_KEY:
        raise RuntimeError("FIRECRAWL_API_KEY is not set.")

    gl = country_code or COUNTRY_CODE
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "query": keyword,
        "limit": limit,
        "country": gl
    }

    max_retries = 3
    backoff = 2.0

    async def _do_req(http_client: httpx.AsyncClient) -> List[str]:
        nonlocal backoff
        for attempt in range(1, max_retries + 1):
            try:
                if external_api_limiter:
                    async with external_api_limiter.limit("firecrawl"):
                        resp = await http_client.post(
                            FIRECRAWL_SEARCH_URL,
                            json=payload,
                            headers=headers,
                            timeout=60.0
                        )
                else:
                    resp = await http_client.post(
                        FIRECRAWL_SEARCH_URL,
                        json=payload,
                        headers=headers,
                        timeout=60.0
                    )

                if resp.status_code == 429:
                    await asyncio.sleep(backoff)
                    backoff *= 2
                    continue

                resp.raise_for_status()
                return _extract_firecrawl_urls(resp.json())
            except Exception as e:
                if attempt == max_retries:
                    print(f"[Async Firecrawl Error] Search failed for '{keyword}': {e}")
                    return []
                await asyncio.sleep(backoff)
                backoff *= 2
        return []

    if client:
        return await _do_req(client)
    else:
        async with httpx.AsyncClient(timeout=60.0) as local_client:
            return await _do_req(local_client)


async def async_find_rank_by_domain(
    keyword: str,
    target_domain: str,
    country_code: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None
) -> Tuple[int, str, List[str]]:
    """
    Async Firecrawl rank finder by domain.
    Returns: (rank: int, page_url: str, all_urls: list[str])
    """
    td = normalize_domain(target_domain)
    all_urls = await async_fetch_top_results_via_firecrawl(
        keyword, limit=TOP_N, country_code=country_code, client=client
    )
    if not td:
        return NOT_FOUND_RANK, "", all_urls
    for rank, href in enumerate(all_urls, start=1):
        rd = get_domain(href)
        if rd == td or rd.endswith("." + td) or td.endswith("." + rd):
            return rank, href, all_urls
    return NOT_FOUND_RANK, "", all_urls


# ─── Synchronous Firecrawl Search (Backward Compatibility) ───────────────────

def fetch_top_results_via_firecrawl(keyword: str, limit: int = TOP_N, country_code: str = None) -> list:
    """
    Fetch organic ranking result URLs via Firecrawl /v2/search endpoint.
    """
    if not FIRECRAWL_API_KEY:
        raise RuntimeError("FIRECRAWL_API_KEY is not set.")

    gl = country_code or COUNTRY_CODE
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "query": keyword,
        "limit": limit,
        "country": gl
    }

    max_retries = 3
    backoff = 2
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(FIRECRAWL_SEARCH_URL, json=payload, headers=headers, timeout=90)
            if resp.status_code == 429:
                time.sleep(backoff)
                backoff *= 2
                continue
            resp.raise_for_status()
            return _extract_firecrawl_urls(resp.json())
        except Exception as e:
            if attempt == max_retries:
                print(f"[Firecrawl Error] Search failed for '{keyword}': {e}")
                return []
            time.sleep(backoff)
            backoff *= 2

    return []


def get_top_n_organic_links(keyword, n=TOP_N, country_code=None):
    """Fetch up to n organic result links for `keyword` using Firecrawl search."""
    return fetch_top_results_via_firecrawl(keyword, limit=n, country_code=country_code)


def find_rank(keyword, landing_page, default_domain=None, country_code=None):
    """
    Search top TOP_N organic results via Firecrawl for a match.

    Returns (rank: int, matched_links: list[str]).
    """
    links = get_top_n_organic_links(keyword, TOP_N, country_code=country_code)

    landing_clean = clean_url(landing_page)
    has_specific_url = bool(landing_clean)

    if has_specific_url:
        for rank, href in enumerate(links, start=1):
            if clean_url(href) == landing_clean:
                return rank, links
        return NOT_FOUND_RANK, links

    default_domain = (default_domain or "").strip().lower()
    if not default_domain:
        return NOT_FOUND_RANK, links

    for rank, href in enumerate(links, start=1):
        href_domain = get_domain(href)
        if default_domain in href_domain:
            return rank, links

    return NOT_FOUND_RANK, links


def normalize_domain(value):
    if not value:
        return ""
    v = str(value).strip().lower()
    if "://" not in v:
        v = "https://" + v
    return get_domain(v)


def find_rank_by_domain(keyword, target_domain, country_code=None):
    """Firecrawl version of rank_checker.find_rank_by_domain -- returns the
    project domain's rank for `keyword` plus the REAL full ranking URL
    (Firecrawl gives true URLs, not Google's encrypted redirect).

    Returns (rank:int, page_url:str, all_urls:list[str])."""
    td = normalize_domain(target_domain)
    all_urls = get_top_n_organic_links(keyword, TOP_N, country_code=country_code)
    if not td:
        return NOT_FOUND_RANK, "", all_urls
    for rank, href in enumerate(all_urls, start=1):
        rd = get_domain(href)
        if rd == td or rd.endswith("." + td) or td.endswith("." + rd):
            return rank, href, all_urls
    return NOT_FOUND_RANK, "", all_urls