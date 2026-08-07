"""
Core Google-rank-checking logic using Firecrawl's /v2/search API.
Extracts top organic ranking URLs accurately via Firecrawl search.
"""

import os
import time
from urllib.parse import urlparse
import requests
from dotenv import load_dotenv

load_dotenv()

# --- Firecrawl credentials -----------------------------------------------
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "fc-3897dbc7f2da4e3ba0da80d146edd393")
FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search"

DEFAULT_DOMAIN = os.environ.get("DEFAULT_DOMAIN", "")
TOP_N = int(os.environ.get("TOP_N", "30"))
NOT_FOUND_RANK = 101
COUNTRY_CODE = os.environ.get("SERP_COUNTRY", "in")


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
            res_data = resp.json()

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