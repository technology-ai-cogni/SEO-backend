#!/usr/bin/env python3
"""
Web Scraping Website Competitor Classifier
===========================================
Workflow:
CSV -> Read 'Top 3 URLs (JSON)' -> Extract URLs -> BeautifulSoup Scrape (Title, Meta, Content) -> Gemini REST API -> Results CSV

Displays real-time live runtime execution data directly in the terminal.
"""

import os
import sys
import re
import csv
import json
import time
import argparse
import traceback
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
from bs4 import BeautifulSoup, Comment
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_READ_TIMEOUT = 20.0
DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
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
URL_REGEX = re.compile(r"https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:/[^\s'\"]*)?", re.IGNORECASE)


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


def parse_top3_urls(cell_value: str) -> List[str]:
    """Parses URLs from the Top 3 URLs (JSON) cell string."""
    if not cell_value or not cell_value.strip():
        return []

    text = cell_value.strip()
    urls = []

    try:
        data = json.loads(text)
        urls.extend(_extract_urls_from_obj(data))
    except Exception:
        try:
            fixed_text = text.replace("'", '"')
            data = json.loads(fixed_text)
            urls.extend(_extract_urls_from_obj(data))
        except Exception:
            pass

    if not urls:
        matches = URL_REGEX.findall(text)
        for m in matches:
            clean = m.rstrip("',\"}]")
            if clean.startswith("http") and clean not in urls:
                urls.append(clean)

    unique_urls = []
    for u in urls:
        if u not in unique_urls:
            unique_urls.append(u)

    return unique_urls


def _extract_urls_from_obj(data: Any) -> List[str]:
    """Helper to recursively extract URL strings from parsed JSON structures."""
    extracted = []
    if isinstance(data, list):
        for item in data:
            extracted.extend(_extract_urls_from_obj(item))
    elif isinstance(data, dict):
        for key in ["url", "urls", "link", "website", "href"]:
            if key in data and isinstance(data[key], str) and data[key].startswith("http"):
                extracted.append(data[key].strip())
                break
        if not extracted:
            for val in data.values():
                if isinstance(val, str) and val.startswith("http"):
                    extracted.append(val.strip())
    elif isinstance(data, str) and data.startswith("http"):
        extracted.append(data.strip())

    return extracted


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
        result["error"] = f"HTTP Error {response.status_code if 'response' in locals() else 'unknown'}"
    except Exception as e:
        result["error"] = f"Extraction failure: {str(e)}"

    return result


def classify_scraped_website(
    session: requests.Session,
    api_key: str,
    raw_url: str,
    original_row: dict,
    current_row: int,
    total_rows: int,
    url_index: int,
    total_urls_in_row: int,
    model: str = DEFAULT_GEMINI_MODEL
) -> dict[str, str]:
    """Scrapes URL with BeautifulSoup and sends title + metadata + snippet to Gemini REST API."""
    print("=" * 60, flush=True)
    print(f"ROW: {current_row} / {total_rows} (URL {url_index}/{total_urls_in_row})", flush=True)
    print("=" * 60, flush=True)

    print("\nCSV INPUT", flush=True)
    print("-" * 60, flush=True)
    try:
        print(json.dumps(original_row, indent=4), flush=True)
    except Exception:
        print(str(original_row), flush=True)

    print("\nExtracted URL", flush=True)
    print("-" * 60, flush=True)
    print(raw_url, flush=True)

    # 1. BeautifulSoup Web Scraping Step
    page_data = scrape_website(session, raw_url)

    print("\nEXTRACTED WEBPAGE METADATA (BeautifulSoup)", flush=True)
    print("-" * 60, flush=True)
    print("Domain:", page_data["domain"], flush=True)
    print("Page Title:", page_data["title"] or "(None)", flush=True)
    print("Meta Description:", page_data["description"] or "(None)", flush=True)
    print("Meta Keywords:", page_data["keywords"] or "(None)", flush=True)
    print("Visible Content Snippet:", page_data["text_snippet"][:200] + ("..." if len(page_data["text_snippet"]) > 200 else "") or "(None)", flush=True)
    if page_data["error"]:
        print("Scrape Warning:", page_data["error"], flush=True)
    print("-" * 60, flush=True)

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

    print("\nPROMPT SENT TO GEMINI", flush=True)
    print("-" * 60, flush=True)
    print(prompt, flush=True)

    candidate_models = [model, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"]
    seen_models = []
    for m in candidate_models:
        if m and m not in seen_models:
            seen_models.append(m)

    for current_model in seen_models:
        endpoint = f"{GEMINI_REST_URL_TEMPLATE.format(model=current_model)}?key={api_key}"
        headers = {"Content-Type": "application/json", "X-goog-api-key": api_key}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
        }

        print("\nHTTP REQUEST", flush=True)
        print("-" * 60, flush=True)
        print("Method: POST", flush=True)
        print("Endpoint:", flush=True)
        print(endpoint, flush=True)
        print("\nHeaders:", flush=True)
        print(json.dumps(headers, indent=4), flush=True)
        print("\nPayload:", flush=True)
        print(json.dumps(payload, indent=4), flush=True)
        print("-" * 60, flush=True)

        for attempt in range(5):
            try:
                res = session.post(endpoint, headers=headers, json=payload, timeout=30)

                print("\nHTTP RESPONSE", flush=True)
                print("-" * 60, flush=True)
                print(f"Status Code: {res.status_code}", flush=True)
                print("\nHeaders:", flush=True)
                try:
                    print(json.dumps(dict(res.headers), indent=4), flush=True)
                except Exception:
                    print(dict(res.headers), flush=True)
                print("\nRaw Response Body:", flush=True)
                print(res.text, flush=True)
                print("-" * 60, flush=True)

                if res.status_code == 200:
                    text_content = ""
                    try:
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

                            print("\nParsed JSON", flush=True)
                            print("-" * 60, flush=True)
                            print(json.dumps(parsed_json, indent=4), flush=True)

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

                            result_dict = {
                                "url": page_data["original_url"],
                                "domain": page_data["domain"],
                                "website_type": w_type,
                                "is_competitor": is_comp
                            }

                            print("\nFinal Classification", flush=True)
                            print("-" * 60, flush=True)
                            print(f"Website Type: {w_type}", flush=True)
                            print(f"Competitor: {is_comp}", flush=True)

                            print("\nCSV OUTPUT ROW", flush=True)
                            print("-" * 60, flush=True)
                            print(json.dumps(result_dict, indent=4), flush=True)
                            print("=" * 60, flush=True)

                            return result_dict
                        else:
                            print("\nJSON PARSING FAILURE (No JSON Match)", flush=True)
                            print("-" * 60, flush=True)
                            print("Raw Response Body:", res.text, flush=True)
                            print("Extracted Text:", text_content, flush=True)
                            print("-" * 60, flush=True)

                    except Exception as json_err:
                        print("\nJSON PARSING EXCEPTION", flush=True)
                        print("-" * 60, flush=True)
                        print("Raw Response Body:", res.text, flush=True)
                        print("Exception:", str(json_err), flush=True)
                        print("Stack Trace:\n", traceback.format_exc(), flush=True)
                        print("-" * 60, flush=True)

                elif res.status_code == 429:
                    print("\nHTTP ERROR 429 (RATE LIMIT)", flush=True)
                    print("-" * 60, flush=True)
                    print(f"Status Code: {res.status_code}", flush=True)
                    print("Headers:\n", json.dumps(dict(res.headers), indent=4), flush=True)
                    print("Response Body:\n", res.text, flush=True)
                    wait_sec = 20
                    m_sec = re.search(r"retry in (\d+\.?\d*)s", res.text, re.IGNORECASE)
                    if m_sec:
                        wait_sec = int(float(m_sec.group(1))) + 2
                    print(f"Waiting {wait_sec}s for rate limit window reset...", flush=True)
                    print("-" * 60, flush=True)
                    time.sleep(wait_sec)
                    continue

                elif res.status_code == 404:
                    print(f"\nHTTP ERROR 404 (Model '{current_model}' Not Found)", flush=True)
                    print("-" * 60, flush=True)
                    print("Response Body:\n", res.text, flush=True)
                    print("-" * 60, flush=True)
                    break

                else:
                    print(f"\nHTTP ERROR {res.status_code}", flush=True)
                    print("-" * 60, flush=True)
                    print("Headers:\n", json.dumps(dict(res.headers), indent=4), flush=True)
                    print("Response Body:\n", res.text, flush=True)
                    print("-" * 60, flush=True)
                    time.sleep(3)

            except Exception as req_err:
                print("\nHTTP REQUEST EXCEPTION", flush=True)
                print("-" * 60, flush=True)
                print("Exception:", str(req_err), flush=True)
                print("Stack Trace:\n", traceback.format_exc(), flush=True)
                print("-" * 60, flush=True)
                time.sleep(3)

    fallback_dict = {
        "url": page_data["original_url"],
        "domain": page_data["domain"],
        "website_type": "Platform",
        "is_competitor": "NO"
    }

    print("\nFinal Classification (Fallback)", flush=True)
    print("-" * 60, flush=True)
    print("Website Type: Platform", flush=True)
    print("Competitor: NO", flush=True)

    print("\nCSV OUTPUT ROW", flush=True)
    print("-" * 60, flush=True)
    print(json.dumps(fallback_dict, indent=4), flush=True)
    print("=" * 60, flush=True)

    return fallback_dict


def find_top3_column(fieldnames: List[str]) -> str:
    for col in fieldnames:
        c_lower = col.strip().lower()
        if "top 3" in c_lower or "top3" in c_lower or "top_3" in c_lower:
            return col
    for col in fieldnames:
        c_lower = col.strip().lower()
        if "json" in c_lower and "landing" not in c_lower:
            return col
    return None


def process_csv(input_csv: str, output_csv: str, api_key: str, model: str = DEFAULT_GEMINI_MODEL):
    if not os.path.exists(input_csv):
        print(f"[Error] Input CSV not found: {input_csv}", flush=True)
        sys.exit(1)

    with open(input_csv, "r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("[Error] Empty CSV file.", flush=True)
            sys.exit(1)

        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    top3_col = find_top3_column(fieldnames)

    if not top3_col:
        print("=" * 64, flush=True)
        print("[ERROR] 'Top 3 URLs (JSON)' column was NOT found in your CSV!", flush=True)
        print(f"Columns found in '{input_csv}': {fieldnames}", flush=True)
        print("Please ensure your CSV includes a 'Top 3 URLs (JSON)' or 'Top 3 URLs' column.", flush=True)
        print("=" * 64, flush=True)
        sys.exit(1)

    keyword_col = "Keyword" if "Keyword" in fieldnames else ("Keywords" if "Keywords" in fieldnames else fieldnames[0])
    total_rows = len(rows)

    fieldnames_out = ["Keyword", "URL", "Domain", "Website Type", "Competitor"]
    session = create_http_session()
    cache = {}

    with open(output_csv, "w", newline="", encoding="utf-8") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=fieldnames_out)
        writer.writeheader()

        for idx, row in enumerate(rows, start=1):
            keyword = row.get(keyword_col, row.get(fieldnames[0], "")).strip()
            cell_val = row.get(top3_col, "")

            urls = parse_top3_urls(cell_val)
            total_urls_in_row = len(urls)

            for u_idx, target_url in enumerate(urls, start=1):
                if target_url in cache:
                    res = cache[target_url]
                    print("=" * 60, flush=True)
                    print(f"ROW: {idx} / {total_rows} (URL {u_idx}/{total_urls_in_row} - CACHED)", flush=True)
                    print("=" * 60, flush=True)
                    print("\nCSV INPUT\n", json.dumps(row, indent=4), flush=True)
                    print("\nExtracted URL\n", target_url, flush=True)
                    print("\nFinal Classification (Cached)\n", f"Website Type: {res['website_type']}\nCompetitor: {res['is_competitor']}", flush=True)
                    print("\nCSV OUTPUT ROW\n", json.dumps({
                        "Keyword": keyword,
                        "URL": res["url"],
                        "Domain": res["domain"],
                        "Website Type": res["website_type"],
                        "Competitor": res["is_competitor"]
                    }, indent=4), flush=True)
                    print("=" * 60, flush=True)
                else:
                    res = classify_scraped_website(
                        session=session,
                        api_key=api_key,
                        raw_url=target_url,
                        original_row=row,
                        current_row=idx,
                        total_rows=total_rows,
                        url_index=u_idx,
                        total_urls_in_row=total_urls_in_row,
                        model=model
                    )
                    cache[target_url] = res
                    time.sleep(2)

                out_row = {
                    "Keyword": keyword,
                    "URL": res["url"],
                    "Domain": res["domain"],
                    "Website Type": res["website_type"],
                    "Competitor": res["is_competitor"]
                }
                writer.writerow(out_row)
                out_f.flush()


def main():
    parser = argparse.ArgumentParser(description="Web Scraping Competitor Classifier")
    parser.add_argument("-i", "--input", default="input.csv", help="Input CSV path (default: input.csv)")
    parser.add_argument("-o", "--output", default="results.csv", help="Output CSV path (default: results.csv)")
    parser.add_argument("--api-key", default=os.getenv("GEMINI_API_KEY"), help="Gemini API Key")
    parser.add_argument("--model", default=DEFAULT_GEMINI_MODEL, help="Gemini Model ID")
    args = parser.parse_args()

    api_key = args.api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[Error] GEMINI_API_KEY is required! Pass --api-key or set in .env", flush=True)
        sys.exit(1)

    process_csv(args.input, args.output, api_key=api_key, model=args.model)


if __name__ == "__main__":
    main()
