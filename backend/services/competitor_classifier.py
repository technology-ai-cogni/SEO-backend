"""
Service for classifying URLs into website types ("Official Entity" vs "Platform")
and determining competitor status ("YES" vs "NO") using OpenAI API.
Provides both high-concurrency Async I/O (httpx.AsyncClient + AsyncOpenAI)
and synchronous helper methods with connection pooling and caching.
"""

import os
import re
import json
import time
import asyncio
import logging
from typing import Dict, Any, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
from bs4 import BeautifulSoup, Comment
from dotenv import load_dotenv
import httpx
from openai import OpenAI, AsyncOpenAI

load_dotenv()

logger = logging.getLogger(__name__)

DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_READ_TIMEOUT = 20.0
DEFAULT_OPENAI_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")

try:
    from core.rate_limiter import external_api_limiter
except ImportError:
    try:
        from backend.core.rate_limiter import external_api_limiter
    except ImportError:
        external_api_limiter = None

REALISTIC_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

COOKIE_BANNER_PATTERNS = re.compile(
    r"cookie|gdpr|consent|privacy-banner|cookie-banner|onetrust|ccpa",
    re.IGNORECASE,
)

SYSTEM_CLASSIFICATION_PROMPT = (
    "You are an expert website classification AI. "
    "Analyze website metadata and content snippet to classify it into exactly one of two categories:\n\n"
    "1. 'Official Entity': The website belongs to one specific organization, business, company, institution, university, school, college, hospital, hotel, restaurant, government department, NGO, SaaS company, manufacturer, retailer, startup, real estate firm, or brand (is_competitor: YES).\n"
    "   Note: An official school/company site is 'Official Entity' even if the URL path is a blog/guide page on their domain.\n\n"
    "2. 'Platform': Operating as a third-party marketplace, directory, listing portal, review aggregator, independent news/media portal, blog platform, search engine, or comparison portal (is_competitor: NO).\n\n"
    "Respond ONLY in valid raw JSON with exact keys: 'website_type' ('Official Entity' or 'Platform') and 'is_competitor' ('YES' or 'NO')."
)


def create_http_session() -> requests.Session:
    """Creates a reusable HTTP session with connection pooling and standard headers."""
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET", "POST", "HEAD"],
        raise_on_status=False
    )
    adapter = HTTPAdapter(pool_connections=20, pool_maxsize=50, max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update(REALISTIC_HEADERS)
    return session


def _normalize_scrape_target(url: str) -> Tuple[str, str]:
    """Normalize input URL or domain to root domain and standard https target URL."""
    raw = (url or "").strip()
    if not raw:
        return "", ""
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw

    try:
        domain = urlparse(raw).netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        if not domain:
            domain = raw.replace("https://", "").replace("http://", "").split("/")[0].replace("www.", "")
    except Exception:
        domain = raw.replace("https://", "").replace("http://", "").split("/")[0].replace("www.", "")

    return domain, f"https://{domain}" if domain else raw


def _parse_scraped_soup(html_bytes: bytes, target_url: str, final_url: str, status_code: Optional[int], max_words: int = 300) -> Dict[str, Any]:
    """Shared parsing logic for extracted HTML content across sync and async scraper."""
    domain, _ = _normalize_scrape_target(final_url or target_url)
    result = {
        "original_url": target_url,
        "final_url": final_url,
        "domain": domain,
        "title": "",
        "description": "",
        "keywords": "",
        "text_snippet": "",
        "status_code": status_code,
        "error": None
    }

    try:
        soup = BeautifulSoup(html_bytes, "lxml")

        # Decompose non-content tags
        for tag in soup(["script", "style", "svg", "noscript", "iframe"]):
            tag.decompose()

        # Remove comments
        for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
            comment.extract()

        # Remove cookie banners & hidden elements
        for element in list(soup.find_all(True)):
            if element is None or not hasattr(element, "get") or element.parent is None:
                continue

            elem_id = str(element.get("id") or "")
            raw_class = element.get("class") or []
            elem_class = " ".join(raw_class) if isinstance(raw_class, list) else str(raw_class)

            if COOKIE_BANNER_PATTERNS.search(elem_id) or COOKIE_BANNER_PATTERNS.search(elem_class):
                element.decompose()
                continue

            style = str(element.get("style") or "").lower()
            aria_hidden = str(element.get("aria-hidden") or "").lower()
            if "display:none" in style.replace(" ", "") or "visibility:hidden" in style.replace(" ", "") or aria_hidden == "true":
                element.decompose()

        # Extract Title
        if soup.title and soup.title.string:
            result["title"] = soup.title.string.strip()

        # Meta Description
        meta_desc = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)}) or \
                    soup.find("meta", attrs={"property": re.compile(r"^og:description$", re.I)})
        if meta_desc and hasattr(meta_desc, "get") and meta_desc.get("content"):
            result["description"] = str(meta_desc.get("content")).strip()

        # Meta Keywords
        meta_key = soup.find("meta", attrs={"name": re.compile(r"^keywords$", re.I)})
        if meta_key and hasattr(meta_key, "get") and meta_key.get("content"):
            result["keywords"] = str(meta_key.get("content")).strip()

        # Body visible text
        raw_words = soup.get_text(separator=" ", strip=True).split()
        cleaned_words = [w for w in raw_words if w][:max_words]
        result["text_snippet"] = " ".join(cleaned_words)
    except Exception as e:
        result["error"] = f"Extraction failure: {str(e)}"

    return result


def scrape_website(session: requests.Session, url: str, max_words: int = 300) -> Dict[str, Any]:
    """Synchronous URL fetch via requests and HTML parsing with root domain fallback."""
    domain, target_url = _normalize_scrape_target(url)
    if not target_url:
        return {
            "original_url": url, "final_url": url, "domain": "", "title": "",
            "description": "", "keywords": "", "text_snippet": "", "status_code": None,
            "error": "Empty URL/domain"
        }

    try:
        try:
            response = session.get(
                target_url,
                timeout=(DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT),
                allow_redirects=True
            )
        except Exception:
            target_url = f"http://{domain}"
            response = session.get(
                target_url,
                timeout=(DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT),
                allow_redirects=True
            )

        response.raise_for_status()
        return _parse_scraped_soup(response.content, target_url, str(response.url), response.status_code, max_words)
    except Exception as e:
        return {
            "original_url": url,
            "final_url": target_url,
            "domain": domain,
            "title": "",
            "description": "",
            "keywords": "",
            "text_snippet": "",
            "status_code": getattr(getattr(e, "response", None), "status_code", None),
            "error": str(e)
        }


async def async_scrape_website(client: httpx.AsyncClient, url: str, max_words: int = 300) -> Dict[str, Any]:
    """Asynchronous URL fetch via httpx.AsyncClient and HTML parsing with root domain fallback."""
    domain, target_url = _normalize_scrape_target(url)
    if not target_url:
        return {
            "original_url": url, "final_url": url, "domain": "", "title": "",
            "description": "", "keywords": "", "text_snippet": "", "status_code": None,
            "error": "Empty URL/domain"
        }

    try:
        try:
            response = await client.get(
                target_url,
                headers=REALISTIC_HEADERS,
                follow_redirects=True,
                timeout=15.0
            )
        except Exception:
            target_url = f"http://{domain}"
            response = await client.get(
                target_url,
                headers=REALISTIC_HEADERS,
                follow_redirects=True,
                timeout=15.0
            )

        response.raise_for_status()
        return _parse_scraped_soup(response.content, target_url, str(response.url), response.status_code, max_words)
    except Exception as e:
        return {
            "original_url": url,
            "final_url": target_url,
            "domain": domain,
            "title": "",
            "description": "",
            "keywords": "",
            "text_snippet": "",
            "status_code": getattr(getattr(e, "response", None), "status_code", None),
            "error": str(e)
        }


# ─── Async URL Classification (AsyncOpenAI + Token Bucket Semaphores) ────────

async def async_classify_url(
    url: str,
    http_client: Optional[httpx.AsyncClient] = None,
    openai_client: Optional[AsyncOpenAI] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None
) -> Dict[str, str]:
    """
    Asynchronously classifies a single URL with httpx + AsyncOpenAI.
    Protected by external_api_limiter semaphore.
    """
    resolved_api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not resolved_api_key:
        raise ValueError("OPENAI_API_KEY is not configured.")

    target_model = model or DEFAULT_OPENAI_MODEL

    # 1. Check DB cache first
    try:
        from core import db
        cached = db.get_url_classification(url)
        if cached and cached.get("website_type"):
            return {
                "url": url,
                "website_type": cached["website_type"],
                "is_competitor": cached.get("is_competitor", "NO")
            }
    except Exception:
        pass

    # 2. Async Scrape
    if http_client:
        page_data = await async_scrape_website(http_client, url)
    else:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as local_http:
            page_data = await async_scrape_website(local_http, url)

    user_prompt = f"""Extracted Website Data:
- Target URL: {page_data['original_url']}
- Domain: {page_data['domain']}
- Page Title: {page_data['title']}
- Meta Description: {page_data['description']}
- Meta Keywords: {page_data['keywords']}
- Page Text Content: {page_data['text_snippet']}
"""

    ai_client = openai_client or AsyncOpenAI(api_key=resolved_api_key)
    candidate_models = [target_model, "gpt-4o-mini", "gpt-4o"]
    seen_models = []
    for m in candidate_models:
        if m and m not in seen_models:
            seen_models.append(m)

    for current_model in seen_models:
        for attempt in range(3):
            try:
                if external_api_limiter:
                    async with external_api_limiter.limit("openai"):
                        response = await ai_client.chat.completions.create(
                            model=current_model,
                            messages=[
                                {"role": "system", "content": SYSTEM_CLASSIFICATION_PROMPT},
                                {"role": "user", "content": user_prompt}
                            ],
                            temperature=0.1,
                            response_format={"type": "json_object"}
                        )
                else:
                    response = await ai_client.chat.completions.create(
                        model=current_model,
                        messages=[
                            {"role": "system", "content": SYSTEM_CLASSIFICATION_PROMPT},
                            {"role": "user", "content": user_prompt}
                        ],
                        temperature=0.1,
                        response_format={"type": "json_object"}
                    )

                content = response.choices[0].message.content.strip()
                parsed_json = json.loads(content)

                w_type = str(parsed_json.get("website_type", "Platform")).strip()
                is_comp = str(parsed_json.get("is_competitor", "NO")).strip().upper()

                if "Official" in w_type:
                    w_type = "Official Entity"
                    is_comp = "YES"
                else:
                    w_type = "Platform"
                    is_comp = "NO"

                return {
                    "url": url,
                    "website_type": w_type,
                    "is_competitor": is_comp
                }
            except Exception as req_err:
                logger.error(f"Async OpenAI classification error (model: {current_model}, attempt {attempt+1}): {req_err}")
                await asyncio.sleep(1.5)

    return {
        "url": url,
        "website_type": "Platform",
        "is_competitor": "NO"
    }


async def async_classify_urls(
    keyword: str,
    urls: List[str],
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    batch_info: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    High-concurrency async batch classification with non-blocking I/O.
    """
    try:
        from core import db
    except Exception:
        db = None

    cache: Dict[str, Dict[str, str]] = {}
    uncached_urls: List[str] = []

    # 1. Check DB Cache
    for u in urls:
        clean_u = u.strip()
        if not clean_u:
            continue
        if clean_u in cache:
            continue
        if db:
            try:
                db_res = db.get_url_classification(clean_u)
                if db_res:
                    cache[clean_u] = db_res
                    continue
            except Exception:
                pass
        if clean_u not in uncached_urls:
            uncached_urls.append(clean_u)

    resolved_api_key = api_key or os.getenv("OPENAI_API_KEY")

    if uncached_urls and resolved_api_key:
        sem = asyncio.Semaphore(15)
        ai_client = AsyncOpenAI(api_key=resolved_api_key)

        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http_client:
            async def _process_single(u_target: str):
                async with sem:
                    try:
                        res = await async_classify_url(
                            url=u_target,
                            http_client=http_client,
                            openai_client=ai_client,
                            api_key=resolved_api_key,
                            model=model
                        )
                        wtype = res.get("website_type", "Platform")
                        is_comp = res.get("is_competitor", "NO")
                        if db:
                            try:
                                db.save_url_classification(u_target, wtype, is_comp)
                                db.update_competitor_website_type(u_target, wtype)
                            except Exception:
                                pass
                        return u_target, res
                    except Exception as e:
                        fallback = {"url": u_target, "website_type": "Platform", "is_competitor": "NO"}
                        if db:
                            try:
                                db.save_url_classification(u_target, "Platform", "NO")
                                db.update_competitor_website_type(u_target, "Platform")
                            except Exception:
                                pass
                        return u_target, fallback

            tasks = [_process_single(u) for u in uncached_urls]
            results_tuples = await asyncio.gather(*tasks, return_exceptions=False)
            for u_k, u_res in results_tuples:
                cache[u_k] = u_res

    results = [cache[u.strip()] for u in urls if u.strip() in cache]
    return {
        "keyword": keyword,
        "results": results
    }


# ─── Synchronous Wrapper Methods (Backward Compatibility) ────────────────────

def classify_url(
    url: str,
    session: Optional[requests.Session] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None
) -> Dict[str, str]:
    """
    Classifies a single URL using BeautifulSoup scraping + OpenAI API.
    Returns: {"url": str, "website_type": str, "is_competitor": str}
    """
    resolved_api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not resolved_api_key:
        raise ValueError("OPENAI_API_KEY is not configured in environment variables or request parameters.")

    target_model = model or DEFAULT_OPENAI_MODEL
    close_session = False
    if session is None:
        session = create_http_session()
        close_session = True

    # 1. Check DB cache first
    try:
        from core import db
        cached = db.get_url_classification(url)
        if cached and cached.get("website_type"):
            return {
                "url": url,
                "website_type": cached["website_type"],
                "is_competitor": cached.get("is_competitor", "NO")
            }
    except Exception as cache_err:
        logger.warning(f"Failed to check classification cache for '{url}': {cache_err}")

    try:
        page_data = scrape_website(session, url)
        user_prompt = f"""Extracted Website Data:
- Target URL: {page_data['original_url']}
- Domain: {page_data['domain']}
- Page Title: {page_data['title']}
- Meta Description: {page_data['description']}
- Meta Keywords: {page_data['keywords']}
- Page Text Content: {page_data['text_snippet']}
"""

        client = OpenAI(api_key=resolved_api_key)
        candidate_models = [target_model, "gpt-4o-mini", "gpt-4o"]
        seen_models = []
        for m in candidate_models:
            if m and m not in seen_models:
                seen_models.append(m)

        for current_model in seen_models:
            for attempt in range(3):
                try:
                    response = client.chat.completions.create(
                        model=current_model,
                        messages=[
                            {"role": "system", "content": SYSTEM_CLASSIFICATION_PROMPT},
                            {"role": "user", "content": user_prompt}
                        ],
                        temperature=0.1,
                        response_format={"type": "json_object"}
                    )
                    content = response.choices[0].message.content.strip()
                    parsed_json = json.loads(content)

                    w_type = str(parsed_json.get("website_type", "Platform")).strip()
                    is_comp = str(parsed_json.get("is_competitor", "NO")).strip().upper()

                    if "Official" in w_type:
                        w_type = "Official Entity"
                        is_comp = "YES"
                    else:
                        w_type = "Platform"
                        is_comp = "NO"

                    return {
                        "url": url,
                        "website_type": w_type,
                        "is_competitor": is_comp
                    }
                except Exception as req_err:
                    logger.error(f"OpenAI API request error (model: {current_model}, attempt {attempt+1}): {str(req_err)}")
                    time.sleep(1.5)

        return {
            "url": url,
            "website_type": "Platform",
            "is_competitor": "NO"
        }
    finally:
        if close_session:
            session.close()


def classify_urls(
    keyword: str,
    urls: List[str],
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    batch_info: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Classifies a list of top URLs for a given keyword using parallel threads.
    Returns: {"keyword": str, "results": List[Dict[str, str]]}
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    try:
        from core import db
    except Exception:
        db = None

    session = create_http_session()
    cache: Dict[str, Dict[str, str]] = {}
    uncached_urls: List[str] = []

    try:
        # Step 1: Check DB cache first for all URLs
        for u in urls:
            clean_u = u.strip()
            if not clean_u:
                continue

            if clean_u in cache:
                continue

            if db:
                try:
                    db_res = db.get_url_classification(clean_u)
                    if db_res:
                        cache[clean_u] = db_res
                        continue
                except Exception:
                    pass

            if clean_u not in uncached_urls:
                uncached_urls.append(clean_u)

        total_urls = len(urls)
        unclassified_count = len(uncached_urls)

        # Step 2: Process uncached URLs concurrently in parallel worker threads
        if uncached_urls:
            def process_single_url(target_u: str):
                local_sess = create_http_session()
                try:
                    res = classify_url(
                        url=target_u,
                        session=local_sess,
                        api_key=api_key,
                        model=model
                    )
                    wtype = res.get("website_type", "Platform")
                    is_comp = res.get("is_competitor", "NO")
                    if db:
                        try:
                            db.save_url_classification(target_u, wtype, is_comp)
                            db.update_competitor_website_type(target_u, wtype)
                        except Exception:
                            pass
                    return target_u, res
                except Exception as e:
                    fallback = {"url": target_u, "website_type": "Platform", "is_competitor": "NO"}
                    if db:
                        try:
                            db.save_url_classification(target_u, "Platform", "NO")
                            db.update_competitor_website_type(target_u, "Platform")
                        except Exception:
                            pass
                    return target_u, fallback
                finally:
                    local_sess.close()

            max_workers = min(15, len(uncached_urls))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_url = {executor.submit(process_single_url, u): u for u in uncached_urls}
                for future in as_completed(future_to_url):
                    try:
                        u_key, u_res = future.result()
                        cache[u_key] = u_res
                    except Exception:
                        u_target = future_to_url[future]
                        cache[u_target] = {"url": u_target, "website_type": "Platform", "is_competitor": "NO"}

        results = [cache[u.strip()] for u in urls if u.strip() in cache]
        return {
            "keyword": keyword,
            "results": results
        }
    finally:
        session.close()
