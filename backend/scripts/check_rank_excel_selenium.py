import os
import sys
import time
import random
import zipfile
import tempfile
import threading
import argparse
from urllib.parse import quote_plus, urlparse
from datetime import datetime

import pandas as pd
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException, StaleElementReferenceException, WebDriverException
)

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(backend_dir)
load_dotenv(os.path.join(backend_dir, ".env"))

# ── Configuration ─────────────────────────────────────────────────────────────
DEFAULT_NUM_BROWSERS = 1    # number of separate Chrome browser processes
DEFAULT_TABS_PER_BROWSER = 6  # tabs per browser (total parallelism = browsers × tabs)
DEFAULT_RESULTS     = 30   # how many SERP results to check
RESULTS_PER_PAGE    = 10   # Google shows 10 results per page
TAB_TIMEOUT         = 50   # seconds to wait for a tab to load
DELAY_MIN           = 3
DELAY_MAX           = 7
SAVE_EVERY          = 10   # save intermediate results every N completed keywords
# ─────────────────────────────────────────────────────────────────────────────


def _get_domain(url: str) -> str:
    """Extract the netloc (domain) from a URL, ignoring www prefix."""
    try:
        parsed = urlparse(url)
        netloc = parsed.netloc.lower()
        return netloc.lstrip("www.")
    except Exception:
        return url.lower().lstrip("www.")


def _url_matches_target(result_url: str, target_url: str, target_domain: str) -> bool:
    """
    Returns True if result_url matches the target URL or its domain.
    Matches by full URL prefix first, then falls back to domain-only match.
    """
    if not result_url:
        return False

    result_lower = result_url.rstrip("/").lower()
    target_lower = target_url.rstrip("/").lower() if target_url else ""

    # Try exact / prefix match first (e.g. target URL is a specific page)
    if target_lower and (result_lower == target_lower or result_lower.startswith(target_lower)):
        return True

    # Fall back to domain-only match
    result_domain = _get_domain(result_url)
    return bool(target_domain and result_domain and result_domain == target_domain)


def create_proxy_auth_extension(proxy_url: str) -> str:
    """Dynamically build a Chrome extension zip that handles proxy authentication."""
    parsed = urlparse(proxy_url)
    host     = parsed.hostname
    port     = parsed.port or 80
    username = parsed.username
    password = parsed.password

    manifest_json = """{
        "version": "1.0.0",
        "manifest_version": 2,
        "name": "Chrome Proxy",
        "permissions": ["proxy","tabs","unlimitedStorage","storage","<all_urls>","webRequest","webRequestBlocking"],
        "background": {"scripts": ["background.js"]},
        "minimum_chrome_version": "22.0.0"
    }"""

    background_js = f"""
    var config = {{
        mode: "fixed_servers",
        rules: {{ singleProxy: {{ scheme: "http", host: "{host}", port: parseInt({port}) }}, bypassList: [] }}
    }};
    chrome.proxy.settings.set({{value: config, scope: "regular"}}, function() {{}});
    chrome.webRequest.onAuthRequired.addListener(
        function callback(details) {{
            return {{ authCredentials: {{ username: "{username}", password: "{password}" }} }};
        }},
        {{urls: ["<all_urls>"]}},
        ["blocking"]
    );
    """

    plugin_file = os.path.join(tempfile.gettempdir(), f"proxy_auth_plugin_{port}.zip")
    with zipfile.ZipFile(plugin_file, "w") as zp:
        zp.writestr("manifest.json", manifest_json)
        zp.writestr("background.js", background_js)
    return plugin_file


def get_driver(country_code: str = "in") -> webdriver.Chrome:
    """Build and return a stealth headless Chrome driver, optionally with proxy."""
    options = Options()

    proxy_url = os.environ.get("SCRAPING_PROXY")
    if proxy_url:
        try:
            plugin_file = create_proxy_auth_extension(proxy_url)
            options.add_extension(plugin_file)
            print(f"[selenium] Configured proxy extension via {proxy_url.split('@')[-1]}")
        except Exception as e:
            print(f"[selenium] Warning: failed to configure proxy extension: {e}")

    # options.add_argument("--headless=new")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--start-maximized")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
    options.page_load_strategy = "eager"

    try:
        from webdriver_manager.chrome import ChromeDriverManager
        service = Service(ChromeDriverManager().install())
    except ImportError:
        service = Service()

    driver = webdriver.Chrome(service=service, options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    return driver


def accept_consent(driver: webdriver.Chrome):
    """Dismiss any Google consent/cookie popup if present."""
    try:
        btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[.//span[contains(text(),'Accept all')]]"))
        )
        btn.click()
        time.sleep(1)
    except TimeoutException:
        pass


def _build_serp_url(keyword: str, country_code: str, start: int = 0) -> str:
    """Build a Google Search URL for a given keyword, country, and result offset."""
    gl  = country_code.lower() if country_code else "in"
    hl  = "en"
    num = RESULTS_PER_PAGE
    q   = quote_plus(keyword)
    url = f"https://www.google.com/search?q={q}&num={num}&hl={hl}&gl={gl}"
    if start > 0:
        url += f"&start={start}"
    return url


def extract_organic_urls(driver: webdriver.Chrome) -> list[str]:
    """Extract all organic result URLs from the currently loaded SERP page."""
    urls = []

    # Primary selector used by Google for main result links
    anchors = driver.find_elements(By.CSS_SELECTOR, 'a[jsname="UWckNb"]')
    if not anchors:
        anchors = driver.find_elements(By.CSS_SELECTOR, 'div.g a[href]')

    for a in anchors:
        try:
            href = a.get_attribute("href") or ""
            if not href.startswith("http"):
                continue
            if any(s in href for s in [
                "webcache", "google.com/search", "google.com/url",
                "accounts.google", "javascript:", "#:~:text="
            ]):
                continue
            # Must have an h3 child (organic result title) to be a real result
            try:
                a.find_element(By.TAG_NAME, "h3")
            except NoSuchElementException:
                continue
            urls.append(href)
        except StaleElementReferenceException:
            continue

    return urls


def tab_has_results(driver: webdriver.Chrome) -> bool:
    """Non-blocking check: has the current tab's SERP loaded?"""
    return bool(driver.find_elements(By.ID, "search"))


def open_tabs(driver: webdriver.Chrome, count: int) -> list[str]:
    """Open `count` tabs in the given driver and return their handles."""
    handles = list(driver.window_handles)
    while len(handles) < count:
        driver.switch_to.window(handles[-1])
        driver.execute_script("window.open('about:blank', '_blank');")
        handles = list(driver.window_handles)
    return handles[:count]


# ── Core parallel rank-checking ───────────────────────────────────────────────

class _RankJob:
    """Represents one queued or in-flight keyword rank-check."""
    def __init__(self, row_index: int, keyword: str, target_url: str, country_code: str, num_results: int):
        self.row_index    = row_index
        self.keyword      = keyword
        self.target_url   = target_url
        self.target_domain = _get_domain(target_url) if target_url else ""
        self.country_code = country_code
        self.num_results  = num_results

        # Pagination state
        self.page         = 0                        # current page being fetched (0-indexed)
        self.total_pages  = (num_results + RESULTS_PER_PAGE - 1) // RESULTS_PER_PAGE
        self.all_urls: list[str] = []               # accumulated URLs across pages

        self.start_time   = time.time()
        self.deadline     = time.time() + TAB_TIMEOUT
        self.retried      = False

    def next_url(self) -> str:
        return _build_serp_url(self.keyword, self.country_code, start=self.page * RESULTS_PER_PAGE)

    def find_rank(self) -> tuple[int, str | None]:
        """Scan accumulated URLs for the target. Returns (rank, matched_url)."""
        for i, url in enumerate(self.all_urls):
            if _url_matches_target(url, self.target_url, self.target_domain):
                return i + 1, url
        return 101, None


def run_rank_pool(
    driver: webdriver.Chrome,
    jobs_input: list[dict],
    country_code: str,
    num_results: int,
    num_tabs: int,
    on_done,           # callback(row_index, rank, matched_url)
    total: int,
):
    """
    Parallel tab pool: multiple tabs run Google searches simultaneously.
    Each job may span multiple pages (to cover top-30 results) — the tab
    navigates to each SERP page in turn, accumulating URLs, before the
    rank is computed.
    """
    handles  = open_tabs(driver, num_tabs)
    print(f"  Opened {len(handles)} browser tabs\n")

    # Warm up first tab so the consent screen is handled once
    driver.switch_to.window(handles[0])
    driver.get("https://www.google.com")
    accept_consent(driver)

    queue: list[_RankJob] = [
        _RankJob(
            row_index   = item["row_index"],
            keyword     = item["keyword"],
            target_url  = item["target_url"],
            country_code = country_code,
            num_results = num_results,
        )
        for item in jobs_input
    ]

    done        = 0
    jobs: dict[str, _RankJob | None] = {h: None for h in handles}
    cooldown: dict[str, float]       = {h: 0.0   for h in handles}

    def label(h):
        return f"[Tab {handles.index(h) + 1}]"

    while queue or any(j is not None for j in jobs.values()):
        for h in handles:
            try:
                driver.switch_to.window(h)
            except WebDriverException:
                continue

            job = jobs[h]

            # ── Assign a new job to an idle tab ──────────────────────────────
            if job is None:
                if not queue or time.time() < cooldown[h]:
                    continue
                job = queue.pop(0)
                print(f"{label(h)} [{done + 1}/{total}] Checking rank for: '{job.keyword}' (Target: {job.target_url or 'Any'})")
                try:
                    driver.get(job.next_url())
                    job.page   += 1
                    job.deadline = time.time() + TAB_TIMEOUT
                    jobs[h] = job
                except Exception as e:
                    print(f"{label(h)}   -> Error loading page: {e}")
                    on_done(job.row_index, "error", None)
                    done += 1
                continue

            # ── Check if the current page has loaded ─────────────────────────
            if not tab_has_results(driver):
                if time.time() > job.deadline and not job.retried:
                    accept_consent(driver)
                    job.retried  = True
                    job.deadline = time.time() + TAB_TIMEOUT
                elif time.time() > job.deadline:
                    # Timeout — report what we have so far
                    rank, matched_url = job.find_rank()
                    print(f"{label(h)}   Timeout — assigning rank: {rank}")
                    on_done(job.row_index, rank, matched_url)
                    done += 1
                    cooldown[h] = time.time() + random.uniform(DELAY_MIN, DELAY_MAX)
                    jobs[h] = None
                continue

            # ── Page loaded: extract URLs ─────────────────────────────────────
            try:
                page_urls = extract_organic_urls(driver)
            except Exception as e:
                print(f"{label(h)}   -> Error extracting results: {e}")
                on_done(job.row_index, "error", None)
                done += 1
                cooldown[h] = time.time() + random.uniform(DELAY_MIN, DELAY_MAX)
                jobs[h] = None
                continue

            job.all_urls.extend(page_urls)

            # Check if target already found — no need to fetch more pages
            current_rank, matched_url = job.find_rank()
            if matched_url is not None:
                print(f"{label(h)}   -> Rank: {current_rank} | Matched URL: {matched_url}")
                on_done(job.row_index, current_rank, matched_url)
                done += 1
                cooldown[h] = time.time() + random.uniform(DELAY_MIN, DELAY_MAX)
                jobs[h] = None
                print(f"{label(h)} [{done}/{total}] Done\n")
                continue

            # More pages to fetch?
            if job.page < job.total_pages:
                try:
                    driver.get(job.next_url())
                    job.page    += 1
                    job.deadline = time.time() + TAB_TIMEOUT
                    job.retried  = False
                except Exception as e:
                    print(f"{label(h)}   -> Error navigating to next page: {e}")
                    on_done(job.row_index, "error", None)
                    done += 1
                    cooldown[h] = time.time() + random.uniform(DELAY_MIN, DELAY_MAX)
                    jobs[h] = None
                continue

            # All pages fetched — target not found
            print(f"{label(h)}   -> Rank: 101 | Not found in top {num_results} results")
            on_done(job.row_index, 101, None)
            done += 1
            cooldown[h] = time.time() + random.uniform(DELAY_MIN, DELAY_MAX)
            jobs[h] = None
            print(f"{label(h)} [{done}/{total}] Done\n")

        time.sleep(0.3)


# ── Main entry point ──────────────────────────────────────────────────────────

def _browser_worker(
    browser_id: int,
    jobs_input: list,
    country_code: str,
    num_results: int,
    tabs_per_browser: int,
    on_done,
    total: int,
):
    """Runs one Chrome instance with `tabs_per_browser` tabs, processing its slice of jobs."""
    print(f"[Browser {browser_id}] Starting Chrome with {tabs_per_browser} tabs ({len(jobs_input)} keywords)...")
    driver = None
    try:
        driver = get_driver(country_code)
        run_rank_pool(
            driver           = driver,
            jobs_input       = jobs_input,
            country_code     = country_code,
            num_results      = num_results,
            num_tabs         = tabs_per_browser,
            on_done          = on_done,
            total            = total,
        )
    except Exception as e:
        print(f"[Browser {browser_id}] Fatal error: {e}")
        # Mark any jobs that didn't get a result as error
        for item in jobs_input:
            on_done(item["row_index"], "error", None)
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
    print(f"[Browser {browser_id}] Done.")


def process_excel_selenium(
    input_path: str,
    output_path: str,
    country_code: str = "in",
    num_browsers: int = DEFAULT_NUM_BROWSERS,
    tabs_per_browser: int = DEFAULT_TABS_PER_BROWSER,
    num_results: int = DEFAULT_RESULTS,
):
    if not os.path.exists(input_path):
        print(f"Error: Input file '{input_path}' not found.")
        return

    print(f"Reading input file: {input_path}")
    df = pd.read_excel(input_path)

    kw_col  = None
    url_col = None
    for col in df.columns:
        col_lower = str(col).strip().lower()
        if col_lower in ["keyword", "keywords", "kw"]:
            kw_col = col
        elif col_lower in ["landing page", "target url", "url", "landing_page", "domain"]:
            url_col = col

    if not kw_col:
        print("Error: Could not find 'Keyword' column in Excel file.")
        return

    total_parallel = num_browsers * tabs_per_browser
    print(f"  Keyword column  : '{kw_col}'")
    if url_col:
        print(f"  Target URL col  : '{url_col}'")
    print(f"  Rows            : {len(df)}")
    print(f"  Browsers        : {num_browsers}")
    print(f"  Tabs/browser    : {tabs_per_browser}")
    print(f"  Total parallel  : {total_parallel}")
    print(f"  Results/kw      : top {num_results}")
    print(f"  Country         : {country_code}\n")

    # Build job list (only rows with a keyword)
    jobs_input = []
    for idx, row in df.iterrows():
        kw  = str(row[kw_col]).strip() if pd.notna(row[kw_col]) else ""
        url = str(row[url_col]).strip() if url_col and pd.notna(row[url_col]) else ""
        if kw:
            jobs_input.append({"row_index": idx, "keyword": kw, "target_url": url})

    total = len(jobs_input)
    print(f"Starting {num_browsers} Chrome browsers × {tabs_per_browser} tabs each ({total} keywords total)...\n")

    # Split jobs evenly across browsers
    chunks = [[] for _ in range(num_browsers)]
    for i, job in enumerate(jobs_input):
        chunks[i % num_browsers].append(job)

    # Thread-safe results dict: row_index -> (rank, matched_url)
    results: dict[int, tuple] = {}
    lock = threading.Lock()

    def on_done(row_index: int, rank: int, matched_url):
        with lock:
            results[row_index] = (rank, matched_url)
            completed = len(results)
        if completed % SAVE_EVERY == 0 or completed == total:
            with lock:
                _save_progress(df, dict(results), output_path)

    # Launch each browser in its own thread
    threads = []
    for b_id, chunk in enumerate(chunks, start=1):
        if not chunk:
            continue
        t = threading.Thread(
            target=_browser_worker,
            args=(b_id, chunk, country_code, num_results, tabs_per_browser, on_done, total),
            daemon=True,
            name=f"Browser-{b_id}",
        )
        threads.append(t)
        t.start()
        # Stagger browser launches by 2s so they don't all hit Google simultaneously
        time.sleep(2)

    for t in threads:
        t.join()

    # ── Retry pass: rerun any rows that came back as "error" ─────────────────
    with lock:
        error_indices = {idx for idx, (rank, _) in results.items() if rank == "error"}

    if error_indices:
        print(f"\n{'='*60}")
        print(f"  Retry pass: {len(error_indices)} keyword(s) had errors — retrying sequentially...")
        print(f"{'='*60}\n")

        retry_jobs = [
            item for item in jobs_input if item["row_index"] in error_indices
        ]

        # Reset error rows so on_done can update them
        with lock:
            for idx in error_indices:
                results.pop(idx, None)

        retry_total = len(retry_jobs)

        def on_retry_done(row_index: int, rank, matched_url):
            with lock:
                results[row_index] = (rank, matched_url)
                completed = len([v for v in results.values() if v[0] != "error"])
            print(f"  [Retry] Row {row_index} -> Rank: {rank} | URL: {matched_url or 'None'}")
            _save_progress(df, dict(results), output_path)

        # Run retries as a single browser with the same tabs-per-browser setting
        retry_thread = threading.Thread(
            target=_browser_worker,
            args=("Retry", retry_jobs, country_code, num_results, tabs_per_browser, on_retry_done, retry_total),
            daemon=True,
        )
        retry_thread.start()
        retry_thread.join()

        with lock:
            still_errors = [idx for idx, (rank, _) in results.items() if rank == "error"]
        if still_errors:
            print(f"\n[WARNING] {len(still_errors)} row(s) still failed after retry: rows {still_errors}")
        else:
            print("\n[Retry] All error rows resolved successfully.")

    # Final save
    with lock:
        _save_progress(df, dict(results), output_path)
    print(f"\nCompleted successfully! All results saved to: {output_path}")


def _save_progress(df: pd.DataFrame, results: dict, output_path: str):
    df_out = df.copy()
    ranks       = []
    matched_urls = []
    for idx in df_out.index:
        r = results.get(idx)
        if r is None:
            ranks.append("")
            matched_urls.append("")
        else:
            ranks.append(r[0])
            matched_urls.append(r[1] or "")
    df_out["Checked Rank"]        = ranks
    df_out["Matched Ranking URL"] = matched_urls
    df_out.to_excel(output_path, index=False)


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Check Google keyword rankings via 3 Chrome browsers × 3 tabs each."
    )
    parser.add_argument("--input",    default="Book1.xlsx",                   help="Path to input Excel file")
    parser.add_argument("--output",   default="Book1_ranked_selenium.xlsx",   help="Path to output Excel file")
    parser.add_argument("--country",  default="in",                           help="2-letter country code for Google search (default: in)")
    parser.add_argument("--browsers", type=int, default=DEFAULT_NUM_BROWSERS, help=f"Number of Chrome browser instances (default: {DEFAULT_NUM_BROWSERS})")
    parser.add_argument("--tabs",     type=int, default=DEFAULT_TABS_PER_BROWSER, help=f"Tabs per browser (default: {DEFAULT_TABS_PER_BROWSER})")
    parser.add_argument("--results",  type=int, default=DEFAULT_RESULTS,      help=f"How many SERP results to check per keyword (default: {DEFAULT_RESULTS})")

    args = parser.parse_args()
    process_excel_selenium(
        input_path       = args.input,
        output_path      = args.output,
        country_code     = args.country,
        num_browsers     = args.browsers,
        tabs_per_browser = args.tabs,
        num_results      = args.results,
    )
