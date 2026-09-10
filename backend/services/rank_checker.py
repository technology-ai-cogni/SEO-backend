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
import re
import json
import time
from urllib.parse import quote, urlparse
import requests
from dotenv import load_dotenv

load_dotenv()

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

REQUEST_TIMEOUT = 150
SLEEP_BETWEEN_REQUESTS = 1
MAX_REQUEST_RETRIES = 7
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


def fetch_serp_page(keyword, start=0, country_code=None, num=None):
    """Request one page of Google results through the Bright Data SERP zone.

    Appends &brd_json=1 so Bright Data returns its OWN parsed result set
    ({"organic": [...]}) instead of raw Google HTML. The previous raw-HTML
    parser (parse_organic_links_from_html) required the result's <h3> to sit
    INSIDE its <a>, which current Google markup no longer does -- it was
    extracting 0-9 links per page and reporting genuinely-ranking pages as
    "not found" (101). Returns the parsed JSON dict, or None.

    `country_code` overrides the .env default SERP_COUNTRY for this search."""
    if not BRIGHTDATA_API_KEY:
        raise RuntimeError("BRIGHTDATA_API_KEY is not set. Fill it in in .env.")

    gl = country_code or COUNTRY_CODE
    num_param = f"&num={num}" if num else ""
    search_url = (
        f"https://{GOOGLE_DOMAIN}/search?q={quote(keyword)}"
        f"&gl={gl}&hl={LANGUAGE_CODE}&start={start}{num_param}&brd_json=1"
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

    # Transient Bright Data SERP errors ("redirect location was rejected",
    # "recently failed -- wait 15s") come back as HTTP 200 + an error header.
    # Retry a few times so a real live SERP still lands.
    for _brd_try in range(1, 4):
        brd_error = resp.headers.get("x-brd-err-msg") or resp.headers.get("x-brd-error")
        if not brd_error:
            break
        print(f"[Bright Data API Error] (try {_brd_try}/3) {brd_error}")
        time.sleep(16 if "recently failed" in str(brd_error).lower() else 4)
        try:
            resp = requests.post(
                BRIGHTDATA_REQUEST_URL, headers=headers, json=payload, timeout=REQUEST_TIMEOUT
            )
            resp.raise_for_status()
        except Exception:
            return None
    else:
        return None

    # With &brd_json=1 the body IS the parsed SERP JSON.
    try:
        data = resp.json()
    except Exception:
        try:
            data = json.loads(resp.text or "")
        except Exception:
            return None

    if not isinstance(data, dict) or "organic" not in data:
        return None
    return data


def _display_link_to_url(display_link):
    """Bright Data's `display_link` is Google's *shown* URL, e.g.
        'https://www.euroschoolindia.com › Thane'  ->  'https://www.euroschoolindia.com/Thane'
    Google no longer exposes the true href for organic results (the real
    <a href> is an encrypted /goto?url=... redirect), so this breadcrumb
    is the best URL available. Domain is always clean; deep path may be
    truncated with '...'. Returns '' if unusable."""
    if not display_link or not isinstance(display_link, str):
        return ""
    parts = [p.strip() for p in re.split(r"[›>»]", display_link) if p.strip()]
    base = parts[0] if parts else ""
    if not base:
        return ""
    host = base[base.index("://") + 3:] if "://" in base else base
    host = host.split("/")[0]
    # base must actually look like a hostname, not snippet text
    # ("140+ comments · 3 years ago", "30+ answers", etc.)
    if " " in host or "." not in host or not re.match(r"^[a-z0-9.-]+$", host, re.I):
        return ""
    if not base.startswith("http"):
        base = "https://" + base
    tail = [p.strip("/") for p in parts[1:] if p and "..." not in p and " " not in p]
    return base.rstrip("/") + ("/" + "/".join(tail) if tail else "")


def parse_organic_results(data):
    """Extract organic results (in rank order) from Bright Data's parsed SERP
    JSON as a list of {"url": <best-available URL>, "domain": <bare domain>}.

    Prefers a real http `link`; falls back to the `display_link` breadcrumb
    (Full JSON only -- Light JSON returns display_link=null, in which case the
    only field is the encrypted /goto link and the result is skipped)."""
    out = []
    seen = set()
    organic = data.get("organic") if isinstance(data, dict) else None
    for item in (organic or []):
        href = item.get("link") or item.get("url") or item.get("href") or ""
        if href.startswith("http") and "/goto?url=" not in href and "google." not in href \
                and "gstatic." not in href and "googleapis." not in href:
            url = href
        else:
            url = _display_link_to_url(item.get("display_link"))
        if not url:
            continue
        dom = get_domain(url)
        if not dom or "google." in dom:
            continue
        cleaned = clean_url(url)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        out.append({"url": url, "domain": dom})
    return out


def parse_organic_links_from_html(data):
    """Back-compat shim: same as parse_organic_results but returns just the
    list of URL strings (used by calendar_backend's potential-keyword gate)."""
    return [r["url"] for r in parse_organic_results(data)]


def get_top_n_organic_links(keyword, n=TOP_N, country_code=None):
    """Fetch up to n organic result links for `keyword` across Google SERP pages (start=0, 10, 20, 30...)."""
    links = []
    seen = set()

    # Step 1: Try single request with num=40 first
    html = fetch_serp_page(keyword, start=0, country_code=country_code, num=max(n, 40))
    if html:
        page_links = parse_organic_links_from_html(html)
        for href in page_links:
            cleaned = clean_url(href)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                links.append(href)
                if len(links) >= n:
                    return links[:n]

    # Step 2: Step through page offsets (0, 10, 20, 30, 40...) to reach n links
    max_pages = max(5, (n // 10) + 2)
    empty_page_count = 0

    for page_idx in range(max_pages):
        if len(links) >= n:
            break

        start = page_idx * RESULTS_PER_PAGE  # 0, 10, 20, 30, 40...

        # Skip start=0 if we already fetched page 0 in Step 1
        if start == 0 and len(links) > 0:
            continue

        html = fetch_serp_page(keyword, start=start, country_code=country_code)
        if not html:
            empty_page_count += 1
            if empty_page_count >= 2:
                break
            continue

        page_links = parse_organic_links_from_html(html)
        added_on_this_page = 0
        for href in page_links:
            cleaned = clean_url(href)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                links.append(href)
                added_on_this_page += 1
                if len(links) >= n:
                    break

        if added_on_this_page == 0:
            empty_page_count += 1
            if empty_page_count >= 2:
                break
        else:
            empty_page_count = 0

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


def normalize_domain(value):
    """'https://www.EuroSchoolIndia.com/foo' -> 'euroschoolindia.com'."""
    if not value:
        return ""
    v = str(value).strip().lower()
    if "://" not in v:
        v = "https://" + v
    return get_domain(v)


def _domain_matches(result_domain, target_domain):
    rd, td = (result_domain or "").lower(), (target_domain or "").lower()
    if not rd or not td:
        return False
    return rd == td or rd.endswith("." + td) or td.endswith("." + rd)


def get_top_n_organic_results(keyword, n=TOP_N, country_code=None):
    """Like get_top_n_organic_links but keeps EVERY organic result in SERP
    order (only exact-URL repeats are dropped) so positions map 1:1 to
    Google rank. Returns a list of {"url", "domain"} dicts."""
    results, seen = [], set()
    max_pages = max(5, (n // 10) + 2)
    empty = 0
    for page_idx in range(max_pages):
        if len(results) >= n:
            break
        start = page_idx * RESULTS_PER_PAGE
        num = max(n, 40) if start == 0 else None
        data = fetch_serp_page(keyword, start=start, country_code=country_code, num=num)
        if not data:
            empty += 1
            if empty >= 2:
                break
            continue
        added = 0
        for r in parse_organic_results(data):
            key = clean_url(r["url"])
            if key in seen:
                continue
            seen.add(key)
            results.append(r)
            added += 1
            if len(results) >= n:
                break
        empty = 0 if added else empty + 1
        if empty >= 2:
            break
        time.sleep(SLEEP_BETWEEN_REQUESTS)
    return results[:n]


def find_rank_by_domain(keyword, target_domain, country_code=None):
    """Rank of the project's OWN DOMAIN for `keyword` (ignores any
    pre-declared landing page). Matches the first organic result whose
    domain is `target_domain` (or a sub-domain of it).

    Returns (rank:int, page_url:str, all_urls:list[str]).
      - rank      = NOT_FOUND_RANK if the domain isn't in the top TOP_N
      - page_url  = the actual Google result URL that matched ('' if none)
      - all_urls  = every organic URL fetched, in rank order
    """
    td = normalize_domain(target_domain)
    results = get_top_n_organic_results(keyword, TOP_N, country_code=country_code)
    all_urls = [r["url"] for r in results]
    if not td:
        return NOT_FOUND_RANK, "", all_urls
    for rank, r in enumerate(results, start=1):
        if _domain_matches(r["domain"], td):
            return rank, r["url"], all_urls
    return NOT_FOUND_RANK, "", all_urls