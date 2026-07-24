"""
Service for classifying URLs into website types ("Official Entity" vs "Platform")
and determining competitor status ("YES" vs "NO") using Gemini API.
"""

import os
import re
import json
import time
import logging
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
from bs4 import BeautifulSoup, Comment
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_READ_TIMEOUT = 20.0
DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_REST_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

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


def scrape_website(session: requests.Session, url: str, max_words: int = 300) -> Dict[str, Any]:
    """Fetches URL via HTTP and extracts Title, Meta Description, Keywords, and Top 300 words."""
    result = {
        "original_url": url,
        "final_url": url,
        "domain": "",
        "title": "",
        "description": "",
        "keywords": "",
        "text_snippet": "",
        "status_code": None,
        "error": None
    }

    target_url = url.strip()
    if not target_url.startswith(("http://", "https://")):
        target_url = "https://" + target_url

    try:
        result["domain"] = urlparse(target_url).netloc.lower().replace("www.", "")
    except Exception:
        result["domain"] = target_url

    try:
        response = session.get(
            target_url,
            timeout=(DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT),
            allow_redirects=True
        )
        result["status_code"] = response.status_code
        result["final_url"] = response.url
        try:
            result["domain"] = urlparse(response.url).netloc.lower().replace("www.", "")
        except Exception:
            pass

        response.raise_for_status()

        soup = BeautifulSoup(response.content, "lxml")

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

    except requests.exceptions.Timeout:
        result["error"] = "Request timeout"
    except requests.exceptions.SSLError:
        result["error"] = "SSL certificate verification failed"
    except requests.exceptions.ConnectionError:
        result["error"] = "DNS or connection failure"
    except requests.exceptions.HTTPError as e:
        status_code = getattr(e.response, "status_code", "unknown") if hasattr(e, "response") else "unknown"
        result["error"] = f"HTTP Error {status_code}"
    except Exception as e:
        result["error"] = f"Extraction failure: {str(e)}"

    return result


def _classify_with_openai(prompt: str, url: str) -> Optional[Dict[str, str]]:
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        return None
    try:
        model_name = os.getenv("OPENAI_CHAT_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
        logger.info(f"Attempting OpenAI fallback ({model_name}) for {url}...")
        headers = {
            "Authorization": f"Bearer {openai_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": "You are an expert website competitor classifier. Respond strictly in raw JSON."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        }
        res = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=25)
        if res.status_code == 200:
            text = res.json()["choices"][0]["message"]["content"].strip()
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                parsed_json = json.loads(match.group(0))
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
        else:
            logger.error(f"OpenAI fallback HTTP error {res.status_code}: {res.text}")
    except Exception as e:
        logger.error(f"OpenAI fallback error: {str(e)}")
    return None


def classify_url(
    url: str,
    session: Optional[requests.Session] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None
) -> Dict[str, str]:
    """
    Classifies a single URL using BeautifulSoup scraping + Gemini API (with OpenAI fallback).
    Returns: {"url": str, "website_type": str, "is_competitor": str}
    """
    resolved_api_key = api_key or os.getenv("GEMINI_API_KEY")
    target_model = model or DEFAULT_GEMINI_MODEL
    close_session = False
    if session is None:
        session = create_http_session()
        close_session = True

    try:
        page_data = scrape_website(session, url)
        if page_data.get("error"):
            logger.warning(f"Scrape warning for URL '{url}': {page_data['error']}")

        prompt = f"""You are an expert website classification AI.

Analyze the provided website metadata and content snippet to classify it into exactly one of two categories:

1. "Official Entity": The website belongs to one specific organization, business, company, institution, university, school, college, hospital, hotel, restaurant, government department, NGO, SaaS company, manufacturer, retailer, startup, real estate firm, or brand (is_competitor: YES).
   Note: An official school/company site is "Official Entity" even if the URL path is a blog/guide page on their domain.

2. "Platform": Operating as a third-party marketplace, directory, listing portal, review aggregator, independent news/media portal, blog platform, search engine, or comparison portal (is_competitor: NO).

Extracted Website Data:
- Target URL: {page_data['original_url']}
- Domain: {page_data['domain']}
- Page Title: {page_data['title']}
- Meta Description: {page_data['description']}
- Meta Keywords: {page_data['keywords']}
- Page Text Content: {page_data['text_snippet']}

Respond ONLY in valid raw JSON:
{{
  "website_type": "Official Entity" or "Platform",
  "is_competitor": "YES" or "NO"
}}
"""

        if resolved_api_key:
            candidate_models = [target_model, "gemini-2.0-flash", "gemini-1.5-flash"]
            seen_models = []
            for m in candidate_models:
                if m and m not in seen_models:
                    seen_models.append(m)

            for current_model in seen_models:
                endpoint = f"{GEMINI_REST_URL_TEMPLATE.format(model=current_model)}?key={resolved_api_key}"
                headers = {"Content-Type": "application/json", "X-goog-api-key": resolved_api_key}
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
                }

                for attempt in range(3):
                    try:
                        res = session.post(endpoint, headers=headers, json=payload, timeout=25)
                        if res.status_code == 200:
                            text_content = ""
                            res_data = res.json()
                            candidates = res_data.get("candidates", [])
                            if candidates and "content" in candidates[0]:
                                text_content = candidates[0]["content"].get("parts", [{}])[0].get("text", "").strip()

                            clean_text = re.sub(r"^```json\s*", "", text_content, flags=re.I)
                            clean_text = re.sub(r"^```\s*", "", clean_text)
                            clean_text = re.sub(r"```$", "", clean_text).strip()

                            match = re.search(r"\{.*\}", clean_text, re.DOTALL)
                            if match:
                                parsed_json = json.loads(match.group(0))
                                w_type = str(parsed_json.get("website_type", "Platform")).strip()
                                is_comp = str(parsed_json.get("is_competitor", "NO")).strip().upper()

                                if is_comp not in ["YES", "NO"]:
                                    is_comp = "YES" if "Official" in w_type else "NO"
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
                        elif res.status_code == 429:
                            wait_sec = 5
                            time.sleep(wait_sec)
                            continue
                        elif res.status_code == 404:
                            break
                        else:
                            time.sleep(1)
                    except Exception:
                        time.sleep(1)

        # Fallback to OpenAI if Gemini is missing, fails, or rate-limited
        openai_res = _classify_with_openai(prompt, url)
        if openai_res:
            return openai_res

        # Default fallback if both Gemini and OpenAI fail
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
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Classifies a list of top URLs for a given keyword.
    Checks DB cache first to avoid re-classifying existing URLs/domains.
    Returns: {"keyword": str, "results": List[Dict[str, str]]}
    """
    try:
        from core import db
    except Exception:
        db = None

    session = create_http_session()
    cache: Dict[str, Dict[str, str]] = {}
    results: List[Dict[str, str]] = []

    try:
        for u in urls:
            clean_u = u.strip()
            if not clean_u:
                continue

            if clean_u in cache:
                results.append(cache[clean_u])
                continue

            # 1. Check Database cache first!
            if db:
                try:
                    db_res = db.get_url_classification(clean_u)
                    if db_res:
                        logger.info(f"DB Cache Hit for {clean_u}: {db_res['website_type']}")
                        cache[clean_u] = db_res
                        results.append(db_res)
                        continue
                except Exception as db_err:
                    logger.warning(f"DB lookup warning for {clean_u}: {db_err}")

            # 2. Run AI Scraping & Classification if not cached
            res = classify_url(
                url=clean_u,
                session=session,
                api_key=api_key,
                model=model
            )

            # 3. Save new classification to DB
            if db:
                try:
                    db.save_url_classification(clean_u, res.get("website_type", "Platform"), res.get("is_competitor", "NO"))
                except Exception as db_save_err:
                    logger.warning(f"DB save warning for {clean_u}: {db_save_err}")

            cache[clean_u] = res
            results.append(res)

        return {
            "keyword": keyword,
            "results": results
        }
    finally:
        session.close()
