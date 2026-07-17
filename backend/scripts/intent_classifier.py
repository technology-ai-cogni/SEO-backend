"""
intent_classifier.py

Renamed/moved into scripts/ from the standalone subtype.py you provided
-- content and behavior UNCHANGED. Classifies each of a keyword's top-3
SERP results as Informational or Commercial by actually fetching the
destination page (via its own headless Chrome, since several real sites
block plain `requests` fetches or only render via JS) and asking OpenAI
to judge intent from the page's real signals (title, meta description,
headings, CTA buttons, price signals, structured data) -- then takes a
majority vote across the up to 3 results.

Imported by scripts/run_pipeline.py, which calls classify_single_result()
per URL and majority_subtype() to get one Informational/Commercial value
per keyword, reusing this file's logic directly rather than re-implementing
any of it. close_all_drivers() must be called once at the end of a run to
quit every thread's headless Chrome instance.

Can still be run standalone on a top3-style CSV (needs a "Top 3 Results
(JSON)" or "Top 3 URLs (JSON)" column) exactly as before:
    python -m scripts.intent_classifier <input_csv> [-o output.csv] [--workers N]
"""

import argparse
import csv
import json
import os
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup
from openai import OpenAI, APIConnectionError, APITimeoutError, RateLimitError
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, WebDriverException

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")

FETCH_TIMEOUT = 15
MAX_FETCH_RETRIES = 2
FETCH_RETRY_BACKOFF_SECONDS = 2
RENDER_WAIT_SECONDS = 2.5

MAX_LLM_RETRIES = 3
LLM_RETRY_BACKOFF_SECONDS = 3

MAIN_CONTENT_MAX_CHARS = 8000

DEFAULT_WORKERS = 8

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

INFORMATIONAL = "Informational"
COMMERCIAL = "Commercial"
UNKNOWN = "Unknown"

CTA_PATTERN = re.compile(
    r"\b(buy now|add to cart|start free trial|free trial|book a? ?demo|"
    r"schedule a? ?demo|request a? ?demo|contact sales|talk to sales|"
    r"request a? ?quote|get a? ?quote|checkout|subscribe|sign ?up|"
    r"get started|book now|shop now|order now|download now|try for free)\b",
    re.IGNORECASE,
)

PRICE_PATTERN = re.compile(
    r"[$â¬Â£â¹]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|INR|EUR|GBP)\b"
)

SYSTEM_PROMPT = """You are an expert Webpage Intent Classifier.

Your task is to determine the **primary intent** of a webpage based on the information provided by the user.

The user may provide some or all of the following:

* URL
* Page title
* Meta description
* H1/H2/H3 headings
* Main page content
* Call-to-action (CTA) buttons
* Product pricing
* Forms
* Structured data
* Other extracted webpage information

Your job is to classify the page into exactly one of these categories:

1. **INFORMATIONAL**

* The primary purpose is to educate, explain, answer questions, or provide knowledge.
* Examples include:

  * Blog posts
  * Tutorials
  * Documentation
  * Guides
  * Research articles
  * Educational resources
  * FAQs whose purpose is to help users understand a topic

Typical signals:

* Long explanatory content
* Definitions
* Step-by-step instructions
* Examples
* Code snippets
* Educational headings
* Author information
* Publication date
* Very few sales-oriented CTAs

---

2. **COMMERCIAL**

* The primary purpose is to market, promote, or sell a product or service, generate leads, or encourage business actions.
* Examples include:

  * Product pages
  * Service pages
  * SaaS landing pages
  * Pricing pages
  * Ecommerce pages
  * Company marketing pages

Typical signals:

* Buy Now
* Add to Cart
* Pricing
* Plans
* Start Free Trial
* Book Demo
* Contact Sales
* Request Quote
* Checkout
* Subscription plans
* Product comparisons
* Customer testimonials
* Feature lists focused on selling
* Lead generation forms

---

### Classification Rules

1. Determine the **primary purpose** of the page, not individual elements.

2. Ignore unrelated advertisements.

3. If the page mainly teaches or explains, classify it as **INFORMATIONAL**, even if it contains a few CTA buttons.

4. If the page mainly promotes, markets, or sells a product or service, classify it as **COMMERCIAL**, even if it contains educational sections.

5. If both intents are present, choose the dominant one.

6. Base your decision on all available evidence.

7. If the provided information is insufficient to confidently classify the page, return **UNKNOWN** and explain what additional information is needed.

---

### Input

The user will provide webpage information in JSON or plain text.

---

### Output

Return only valid JSON.

{
"classification": "INFORMATIONAL | COMMERCIAL",
"confidence": 0,
"reason": "Brief explanation of why this classification was chosen.",
"evidence": [
"Evidence 1",
"Evidence 2",
"Evidence 3"
]
}
"""


def get_openai_client():
    """Deliberately NOT cached at module level -- see category_checker.py's
    get_openai_client() docstring: a persistent client's connection pool
    is unsafe to share across worker threads/processes long-term. Built
    fresh per call, right where it's used."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set. Fill it in in .env.")
    return OpenAI(api_key=OPENAI_API_KEY)


# --- Scraping (Selenium) ---------------------------------------------------
# A real browser, not `requests`, is needed here -- several sites in
# practice (Swiggy, Instagram, Justdial, ...) either block plain HTTP
# fetches or only render their content via JS, so a raw requests.get()
# comes back empty/blocked and everything falls through to UNKNOWN.
#
# Each ThreadPoolExecutor worker thread gets its OWN Chrome driver
# (thread-local, lazily created on first use, reused for every row that
# thread goes on to process) -- a single Selenium driver isn't safe to
# share across threads. All drivers created this way are tracked and
# quit() together at the end of the run via close_all_drivers().

_thread_local = threading.local()
_all_drivers = []
_drivers_lock = threading.Lock()


def _new_chrome_driver():
    options = Options()
    # Non-headless -- see serp_fetch.py's get_driver() for why this needs
    # Xvfb + DISPLAY on a server with no attached display. Up to
    # INTENT_WORKERS of these can run concurrently -- each one is a real
    # Chrome window rendered into the virtual framebuffer, not literally
    # shown on any physical screen.
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument(f"user-agent={USER_AGENT}")
    options.page_load_strategy = "eager"

    try:
        from webdriver_manager.chrome import ChromeDriverManager
        service = Service(ChromeDriverManager().install())
    except ImportError:
        service = Service()

    driver = webdriver.Chrome(service=service, options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    driver.set_page_load_timeout(FETCH_TIMEOUT)
    return driver


def get_thread_driver():
    driver = getattr(_thread_local, "driver", None)
    if driver is not None:
        return driver
    driver = _new_chrome_driver()
    _thread_local.driver = driver
    with _drivers_lock:
        _all_drivers.append(driver)
    return driver


def close_all_drivers():
    with _drivers_lock:
        drivers, _all_drivers[:] = list(_all_drivers), []
    for driver in drivers:
        try:
            driver.quit()
        except Exception:
            pass


def fetch_page(url):
    """Fetch a URL's rendered HTML via this thread's Chrome driver.
    Returns (html, error) -- error is None on success. Retries only on a
    page-load timeout; any other WebDriver error fails fast (no point
    retrying, e.g. an invalid URL or a driver crash)."""
    driver = get_thread_driver()
    last_error = None
    for attempt in range(1, MAX_FETCH_RETRIES + 1):
        try:
            driver.get(url)
            time.sleep(RENDER_WAIT_SECONDS)
            html = driver.page_source
            if not html or len(html) < 200:
                last_error = "empty or too-short page source"
                if attempt < MAX_FETCH_RETRIES:
                    time.sleep(FETCH_RETRY_BACKOFF_SECONDS)
                continue
            return html, None
        except TimeoutException:
            last_error = "page load timeout"
            if attempt < MAX_FETCH_RETRIES:
                time.sleep(FETCH_RETRY_BACKOFF_SECONDS)
        except WebDriverException as e:
            return None, str(e)

    return None, last_error


def extract_page_signals(url, html):
    """Pull the fields the intent-classifier prompt asks for out of raw
    HTML. Order matters: headings/CTAs/structured-data are read from the
    ORIGINAL soup (CTAs commonly live in nav/header, and stripping happens
    before that would lose them; JSON-LD lives in <script> tags that get
    removed below), THEN boilerplate tags are stripped before pulling the
    main body text so the LLM isn't paying attention/tokens on nav/footer
    chrome."""
    soup = BeautifulSoup(html, "html.parser")

    title = soup.title.get_text(strip=True) if soup.title else ""

    meta_description = ""
    meta_tag = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    if meta_tag and meta_tag.get("content"):
        meta_description = meta_tag["content"].strip()

    headings = {level: [] for level in ("h1", "h2", "h3")}
    for level in headings:
        for tag in soup.find_all(level):
            text = tag.get_text(strip=True)
            if text:
                headings[level].append(text)

    structured_data_types = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        entries = data if isinstance(data, list) else [data]
        for entry in entries:
            if isinstance(entry, dict) and entry.get("@type"):
                structured_data_types.append(str(entry["@type"]))

    cta_buttons = sorted({
        tag.get_text(strip=True)
        for tag in soup.find_all(["button", "a", "input"])
        if tag.get_text(strip=True) and CTA_PATTERN.search(tag.get_text(strip=True))
    })[:20]

    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()
    main_text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))[:MAIN_CONTENT_MAX_CHARS]

    price_signals = sorted(set(PRICE_PATTERN.findall(main_text)))[:10]

    return {
        "url": url,
        "title": title,
        "meta_description": meta_description,
        "h1": headings["h1"][:10],
        "h2": headings["h2"][:15],
        "h3": headings["h3"][:15],
        "main_content": main_text,
        "cta_buttons": cta_buttons,
        "price_signals": price_signals,
        "structured_data_types": sorted(set(structured_data_types)),
    }


# --- LLM classification ----------------------------------------------------

def classify_page_intent(signals):
    """One OpenAI call, per the Webpage Intent Classifier prompt. Retries
    on transient API errors (rate limit / connection / timeout) only."""
    client = get_openai_client()
    user_payload = json.dumps(signals, ensure_ascii=False)

    last_error = None
    for attempt in range(1, MAX_LLM_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model=OPENAI_CHAT_MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_payload},
                ],
                temperature=0,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            break
        except (RateLimitError, APIConnectionError, APITimeoutError) as e:
            last_error = e
            if attempt < MAX_LLM_RETRIES:
                time.sleep(LLM_RETRY_BACKOFF_SECONDS * attempt)
    else:
        return {
            "classification": UNKNOWN, "confidence": 0,
            "reason": f"OpenAI request failed after retries: {last_error}", "evidence": [],
        }

    raw = resp.choices[0].message.content.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {
            "classification": UNKNOWN, "confidence": 0,
            "reason": "Model returned unparseable JSON", "evidence": [],
        }

    classification = str(parsed.get("classification", "")).strip().upper()
    label_by_code = {"INFORMATIONAL": INFORMATIONAL, "COMMERCIAL": COMMERCIAL, "UNKNOWN": UNKNOWN}
    parsed["classification"] = label_by_code.get(classification, UNKNOWN)
    return parsed


def classify_single_result(url, title):
    """Scrape + classify ONE (url, title) SERP result. Falls back to
    classifying on just url/title (flagging the fetch error) if scraping
    fails -- the model itself will usually return UNKNOWN with too little
    to go on, per rule 7 of the prompt, rather than us guessing here."""
    if not url:
        return None

    html, fetch_error = fetch_page(url)
    if html:
        signals = extract_page_signals(url, html)
    else:
        signals = {"url": url, "title": title, "fetch_error": fetch_error}

    result = classify_page_intent(signals)
    result["url"] = url
    return result


def fetch_page_via_requests(url):
    """Selenium-free fetch, for environments with no real browser
    available (e.g. app.py's hosted /projects/{project}/categorize
    endpoint on Render) -- a plain HTTP GET instead of a headless Chrome
    driver. Best-effort: several JS-heavy sites won't render fully via a
    raw GET the way they do through fetch_page() above, but
    classify_page_intent() already degrades gracefully to title-only
    signals when a fetch fails entirely, same as it does for a failed
    Selenium fetch -- so this is a reasonable tradeoff for a deployment
    that can't run a browser at all, not a replacement for fetch_page()
    where a browser IS available."""
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=FETCH_TIMEOUT)
        resp.raise_for_status()
        return resp.text, None
    except requests.exceptions.RequestException as e:
        return None, str(e)


def classify_single_result_via_requests(url, title):
    """Same as classify_single_result() above, but via
    fetch_page_via_requests() instead of a headless Chrome driver -- no
    thread-local browser is created or tracked, so close_all_drivers()
    is a no-op for calls made through this path."""
    if not url:
        return None

    html, fetch_error = fetch_page_via_requests(url)
    if html:
        signals = extract_page_signals(url, html)
    else:
        signals = {"url": url, "title": title, "fetch_error": fetch_error}

    result = classify_page_intent(signals)
    result["url"] = url
    return result


def majority_subtype(results):
    """Majority vote across up to 3 classified results. UNKNOWN votes
    don't count toward the majority (they're "no signal", not a third
    category to win on). A 1-1 tie between Informational and Commercial
    (possible when only 2 of 3 results were usable) is broken by whichever
    label had the higher average model-reported confidence; a further tie
    there falls back alphabetically, for determinism."""
    usable = [r for r in results if r and r.get("classification") in (INFORMATIONAL, COMMERCIAL)]
    if not usable:
        return UNKNOWN

    counts = Counter(r["classification"] for r in usable)
    max_count = max(counts.values())
    winners = [label for label, c in counts.items() if c == max_count]

    if len(winners) == 1:
        return winners[0]

    avg_confidence = {}
    for label in winners:
        scores = [r.get("confidence") or 0 for r in usable if r["classification"] == label]
        avg_confidence[label] = sum(scores) / len(scores) if scores else 0

    return max(winners, key=lambda label: (avg_confidence[label], label))


# --- Main enrichment pass (standalone CLI use only) ------------------------

TOP3_COLUMN_CANDIDATES = ("Top 3 Results (JSON)", "Top 3 URLs (JSON)")


def _top3_column(fieldnames):
    for col in TOP3_COLUMN_CANDIDATES:
        if col in fieldnames:
            return col
    raise ValueError(
        f"No top-3 results column found. Expected one of {TOP3_COLUMN_CANDIDATES}, "
        f"got: {fieldnames}"
    )


def process_row(row, top3_column):
    raw_json = row.get(top3_column) or "[]"
    try:
        top3 = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        top3 = []

    results = []
    for r in (top3 or [])[:3]:
        url = (r or {}).get("url")
        title = (r or {}).get("title")
        if not url:
            continue
        try:
            results.append(classify_single_result(url, title))
        except Exception as e:
            results.append({"classification": UNKNOWN, "confidence": 0, "reason": f"Error: {e}", "evidence": [], "url": url})

    row["Subtype"] = majority_subtype(results)
    row["URL Classifications (JSON)"] = json.dumps(
        [{"url": r.get("url"), "classification": r.get("classification")} for r in results if r],
        ensure_ascii=False,
    )
    return row


def enrich(input_path, output_path, workers):
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    top3_column = _top3_column(fieldnames)

    new_fieldnames = list(fieldnames)
    for col in ("Subtype", "URL Classifications (JSON)"):
        if col not in new_fieldnames:
            new_fieldnames.append(col)

    total = len(rows)
    subtype_counts = Counter()
    done = 0

    print(f"\n{'='*60}")
    print(f"  Webpage Intent Classifier (Informational / Commercial)")
    print(f"  Input   : {input_path}")
    print(f"  Output  : {output_path}")
    print(f"  Rows    : {total}")
    print(f"  Workers : {workers}")
    print(f"{'='*60}\n")

    with open(output_path, "w", newline="", encoding="utf-8-sig") as out_file:
        writer = csv.DictWriter(out_file, fieldnames=new_fieldnames)
        writer.writeheader()

        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(process_row, row, top3_column): row for row in rows}
                for future in as_completed(futures):
                    row = futures[future]
                    keyword = row.get("Keyword", "")
                    try:
                        result_row = future.result()
                    except Exception as e:
                        print(f"  [ERROR] \"{keyword}\": {e}")
                        result_row = dict(row)
                        result_row["Subtype"] = UNKNOWN
                        result_row["URL Classifications (JSON)"] = json.dumps([])

                    writer.writerow(result_row)
                    out_file.flush()

                    done += 1
                    subtype = result_row.get("Subtype", UNKNOWN)
                    subtype_counts[subtype] += 1
                    print(f"[{done}/{total}] \"{keyword}\" -> {subtype}")
        finally:
            close_all_drivers()

    print(f"\n{'='*60}")
    print(f"  DONE -- {total} keywords processed")
    print(f"  Subtype breakdown: {dict(subtype_counts)}")
    print(f"  Results: {output_path}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="Add an Informational/Commercial Subtype column to a top3-style CSV.")
    parser.add_argument("input_csv", help="Path to a CSV with a Top-3 results JSON column")
    parser.add_argument("-o", "--output", default=None, help="Output path (default: <input>_subtype.csv)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help=f"Thread pool size (default: {DEFAULT_WORKERS})")
    args = parser.parse_args()

    output_path = args.output
    if not output_path:
        if args.input_csv.lower().endswith(".csv"):
            output_path = args.input_csv[:-4] + "_subtype.csv"
        else:
            output_path = args.input_csv + "_subtype.csv"

    enrich(args.input_csv, output_path, args.workers)


if __name__ == "__main__":
    main()
