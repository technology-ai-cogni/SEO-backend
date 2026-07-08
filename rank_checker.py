"""
Core Google-rank-checking logic against Bright Data's Web Unlocker zone.

Runs as a THIRD pipeline stage, after category and cluster are both
settled for a job (see category_tasks.py's cluster_domain_task, which
enqueues one check_rank_task per keyword once clustering completes).

CONCURRENCY: unlike category assignment (which must run on a single
worker because each decision depends on categories already created by
prior keywords), rank-checking has NO ordering dependency between
keywords -- checking keyword A's rank has zero effect on checking
keyword B's rank. This module is safe to run under MULTIPLE concurrent
RQ workers on the `rank_checks` queue (see job_queue.py / rank_tasks.py).
Each RQ job runs in its own forked work-horse PROCESS (not a thread), so
there is no shared state between concurrent rank-checks to worry about --
every call to fetch_serp_page makes its own plain, independent HTTP
request (deliberately NOT reusing a shared requests.Session across calls:
an earlier version of this file tried session reuse via
threading.local(), but that provided no real benefit under this
per-process concurrency model and is suspected of causing SIGSEGV crashes
under macOS's fork() -- a Session's internal connection-pool locks/socket
state surviving a fork() boundary is a classic native-crash source).
"""

import os
import time
from urllib.parse import quote, urlparse

import requests
from bs4 import BeautifulSoup

# --- Bright Data credentials -----------------------------------------------
BRIGHTDATA_API_KEY = os.environ.get("BRIGHTDATA_API_KEY")
BRIGHTDATA_SERP_ZONE = os.environ.get("BRIGHTDATA_SERP_ZONE", "serp_api1")
BRIGHTDATA_REQUEST_URL = "https://api.brightdata.com/request"

DEFAULT_DOMAIN = os.environ.get("DEFAULT_DOMAIN", "")
TOP_N = int(os.environ.get("TOP_N", "40"))
NOT_FOUND_RANK = 101
RESULTS_PER_PAGE = 10

GOOGLE_DOMAIN = "www.google.com"
COUNTRY_CODE = os.environ.get("SERP_COUNTRY", "in")
LANGUAGE_CODE = os.environ.get("SERP_LANGUAGE", "en")

REQUEST_TIMEOUT = 90
SLEEP_BETWEEN_REQUESTS = 0.5
MAX_REQUEST_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5
RETRYABLE_HTTP_STATUSES = {429, 500, 502, 503, 504}


def clean_url(url):
    """Normalize a URL for comparison (scheme + netloc + path, no trailing
    slash, no leading "www."). Stripping "www." matters: a landing page
    stored as "https://example.com/page" and Google returning
    "https://www.example.com/page" are the SAME page, and without this
    normalization they'd never match, silently reporting a genuinely
    ranking page as "not found."""
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


def fetch_serp_page(keyword, start=0, country_code=None):
    """Request one page of Google results through the Bright Data zone.
    Returns HTML or None. `country_code` overrides the .env default
    SERP_COUNTRY for this search -- pass the SAME region the job's
    categorization step used, so rank and category are checked against
    the same Google region."""
    if not BRIGHTDATA_API_KEY:
        raise RuntimeError("BRIGHTDATA_API_KEY is not set. Fill it in in .env.")

    gl = country_code or COUNTRY_CODE
    search_url = (
        f"https://{GOOGLE_DOMAIN}/search?q={quote(keyword)}"
        f"&gl={gl}&hl={LANGUAGE_CODE}&start={start}"
    )

    payload = {
        "zone": BRIGHTDATA_SERP_ZONE,
        "url": search_url,
        "format": "raw",
    }
    headers = {
        "Authorization": f"Bearer {BRIGHTDATA_API_KEY}",
        "Content-Type": "application/json",
    }

    resp = None
    last_error = None

    for attempt in range(1, MAX_REQUEST_RETRIES + 1):
        try:
            resp = requests.post(
                BRIGHTDATA_REQUEST_URL, headers=headers, json=payload, timeout=REQUEST_TIMEOUT
            )
            resp.raise_for_status()
            last_error = None
            break
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_error = e
            if attempt < MAX_REQUEST_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)))
        except requests.exceptions.HTTPError as e:
            last_error = e
            status = e.response.status_code if e.response is not None else None
            if status in RETRYABLE_HTTP_STATUSES and attempt < MAX_REQUEST_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)))
            else:
                break
        except Exception as e:
            last_error = e
            break

    if last_error is not None or resp is None:
        return None

    content_type = resp.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            data = resp.json()
        except Exception:
            return None
        html = data.get("body", "")
    else:
        html = resp.text

    if not html or "<html" not in html.lower():
        return None

    return html


def parse_organic_links_from_html(html):
    """Extract organic result links from a raw Google SERP HTML page."""
    soup = BeautifulSoup(html, "html.parser")
    links = []
    seen = set()

    container = soup.find("div", id="rso") or soup.find("div", id="search")
    if container is None:
        return links

    for a in container.find_all("a", href=True):
        if a.find("h3") is None:
            continue
        href = a["href"]
        if not href.startswith("http"):
            continue
        if "google." in href or "gstatic." in href or "googleapis." in href:
            continue
        cleaned = clean_url(href)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        links.append(href)

    return links


def get_top_n_organic_links(keyword, n=TOP_N, country_code=None):
    """Fetch up to n organic result links for `keyword`, paginating as needed."""
    links = []
    seen = set()
    start = 0

    while len(links) < n:
        html = fetch_serp_page(keyword, start=start, country_code=country_code)
        if html is None:
            break

        page_links = parse_organic_links_from_html(html)
        if not page_links:
            break

        new_links = [href for href in page_links if clean_url(href) not in seen]
        if not new_links:
            break

        for href in new_links:
            seen.add(clean_url(href))
        links.extend(new_links)
        start += RESULTS_PER_PAGE

        if start > n * 3:
            break

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    return links[:n]


def find_rank(keyword, landing_page, default_domain=None, country_code=None):
    """
    Search the top TOP_N organic results for a match.

    - If a landing_page URL is provided: match ONLY that exact URL. No
      domain-based fallback is used, even if the domain matches elsewhere
      in the results -- the row specified an exact page, so only that page
      counts.
    - If no landing_page is provided: match against default_domain instead
      (first result whose domain contains default_domain).

    Returns (rank:int, matched_links:list[str]) -- rank is NOT_FOUND_RANK if
    no match was found in the top TOP_N.
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