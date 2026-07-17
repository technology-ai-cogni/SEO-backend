"""
crawl4ai_scraper.py

A script that uses crawl4ai to scrape the top 5 Google organic search results
(url and title) in the exact order they are listed in a browser, using
10 concurrent headless workers.

Reads from: backend/datasets/its category test 14 july - Sheet1.csv
Writes to: backend/datasets/its category test 14 july - Sheet1_crawl4ai_top5.csv
           backend/datasets/its category test 14 july - Sheet1_crawl4ai_top5.json
"""

import csv
import json
import os
import random
import asyncio
import requests
from urllib.parse import quote_plus
from datetime import datetime
from bs4 import BeautifulSoup

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode, ProxyConfig

INPUT_FILE = "backend/datasets/its category test 14 july - Sheet1_categories.csv"
OUTPUT_FILE = "backend/datasets/its category.csv"
OUTPUT_JSON_FILE = "backend/datasets/its category.json"
CONCURRENCY_LIMIT = 10

# Lock for writing to CSV file safely across async tasks
csv_write_lock = asyncio.Lock()


def fetch_top5_via_brightdata(keyword: str) -> list[dict]:
    """Fallback fetcher using Bright Data SERP API when Crawl4AI fails or hits a CAPTCHA."""
    api_key = os.environ.get("BRIGHTDATA_API_KEY")
    zone = os.environ.get("BRIGHTDATA_SERP_ZONE", "serp_api1")
    if not api_key:
        print("  [Fallback Warning] BRIGHTDATA_API_KEY is not configured in .env. Cannot run fallback.")
        return []

    search_url = f"https://www.google.com/search?q={quote_plus(keyword)}&num=10&hl=en"
    payload = {
        "zone": zone,
        "url": search_url,
        "format": "raw"
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        resp = requests.post("https://api.brightdata.com/request", json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            html = resp.json().get("body", "")
        else:
            html = resp.text

        if html:
            return extract_organic_results(html)
    except Exception as e:
        print(f"  [Fallback Error] Bright Data fetch failed for '{keyword}': {e}")
    return []


def extract_organic_results(html_content: str) -> list[dict]:
    """Extract organic search result URLs and titles in the exact order they appear in the HTML."""
    soup = BeautifulSoup(html_content, "html.parser")
    results = []
    seen_urls = set()

    # Try standard Google search result containers first to maintain hierarchy
    containers = soup.select("div.g, div.tF2Cxc, div.MjjYud, div.Ww4gTb")
    for container in containers:
        a_tag = container.find("a", href=True)
        if not a_tag:
            continue
        h3_tag = a_tag.find("h3")
        if not h3_tag:
            continue

        url = a_tag["href"].strip()
        title = h3_tag.get_text(strip=True)

        if not url.startswith("http") or "google.com" in url or "webcache.googleusercontent" in url:
            continue

        if url not in seen_urls:
            seen_urls.add(url)
            results.append({"url": url, "title": title})

    # Fallback to scanning all direct <a> links with <h3> children (in order of appearance)
    if len(results) < 5:
        for a_tag in soup.find_all("a", href=True):
            h3_tag = a_tag.find("h3")
            if not h3_tag:
                continue

            url = a_tag["href"].strip()
            title = h3_tag.get_text(strip=True)

            if not url.startswith("http") or "google.com" in url or "webcache.googleusercontent" in url:
                continue

            if url not in seen_urls:
                seen_urls.add(url)
                results.append({"url": url, "title": title})

    return results[:5]


def load_keywords(path: str) -> list[str]:
    """Load keywords from the CSV file."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Input file not found: {path}")

    keywords = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        all_rows = list(reader)

    if not all_rows:
        raise ValueError(f"CSV file is empty: {path}")

    headers = [h.strip().lower() for h in all_rows[0]]
    
    keyword_col = None
    for i, h in enumerate(headers):
        if h in ("keywords", "keyword", "kw"):
            keyword_col = i
            break

    if keyword_col is None:
        raise ValueError(f"'Keyword' column not found in headers: {headers}")

    for line in all_rows[1:]:
        if len(line) > keyword_col:
            kw = line[keyword_col].strip()
            if kw:
                keywords.append(kw)

    return keywords


async def scrape_keyword(crawler, keyword, idx, total_keywords, semaphore, run_config, writer, json_results):
    """Scrape a single keyword with concurrency control."""
    async with semaphore:
        print(f"[{idx}/{total_keywords}] Scraping: '{keyword}'...")
        search_url = f"https://www.google.com/search?q={quote_plus(keyword)}&num=10&hl=en"
        
        try:
            result = await crawler.arun(search_url, config=run_config)
            
            html = result.html if result.success else ""
            is_captcha = "captcha" in html.lower() or "recaptcha" in html.lower() or "unusual traffic" in html.lower()
            top5 = []
            
            if result.success and not is_captcha:
                top5 = extract_organic_results(html)
            
            # Fallback to Bright Data if Crawl4AI failed, hit a captcha, or yielded no organic results
            if not result.success or is_captcha or not top5:
                reason = "Crawl failed" if not result.success else ("CAPTCHA hit" if is_captcha else "No organic results found")
                print(f"[{idx}/{total_keywords}] Crawl4AI Warning: {reason}. Falling back to Bright Data SERP API...")
                
                # Execute the synchronous HTTP call in a thread pool to avoid blocking the asyncio loop
                loop = asyncio.get_running_loop()
                top5 = await loop.run_in_executor(None, fetch_top5_via_brightdata, keyword)
                
                if top5:
                    print(f"[{idx}/{total_keywords}] Bright Data fallback succeeded. Found {len(top5)} results.")
                else:
                    print(f"[{idx}/{total_keywords}] Bright Data fallback failed or returned empty.")

            row_data = [keyword]
            for rank_idx, res in enumerate(top5, 1):
                row_data.extend([res['url'], res['title']])

            # Pad row data if less than 5 results are found
            while len(row_data) < 11:
                row_data.extend(["", ""])

            # Safely write to CSV using the lock
            async with csv_write_lock:
                writer.writerow(row_data)

            # Append to JSON results list (thread-safe in standard asyncio)
            json_results.append({
                "keyword": keyword,
                "results": [{"rank": r_idx, "url": r["url"], "title": r["title"]} for r_idx, r in enumerate(top5, 1)]
            })

        except Exception as ex:
            print(f"[{idx}/{total_keywords}] Error occurred: {ex}")
            async with csv_write_lock:
                writer.writerow([keyword] + [""] * 10)
            json_results.append({"keyword": keyword, "results": []})

        # Add a tiny randomized delay inside the worker to prevent simultaneous hits
        await asyncio.sleep(random.uniform(1.0, 3.0))


async def main():
    from dotenv import load_dotenv
    load_dotenv()

    print(f"\n{'='*60}")
    print(f"  Google Top-5 URL Fetcher (Crawl4AI)")
    print(f"  Input File  : {INPUT_FILE}")
    print(f"  CSV Output  : {OUTPUT_FILE}")
    print(f"  JSON Output : {OUTPUT_JSON_FILE}")
    print(f"  Workers     : {CONCURRENCY_LIMIT} concurrent tasks (Non-Headless)")
    print(f"  Started     : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    try:
        keywords = load_keywords(INPUT_FILE)
    except Exception as e:
        print(f"Error loading keywords: {e}")
        return

    print(f"Loaded {len(keywords)} keywords from input sheet.\n")

    proxy_url = os.environ.get("SCRAPING_PROXY")
    proxy_config = None
    if proxy_url:
        from urllib.parse import urlparse
        try:
            parsed = urlparse(proxy_url)
            server_url = f"{parsed.scheme}://{parsed.hostname}"
            if parsed.port:
                server_url += f":{parsed.port}"
            
            proxy_config = ProxyConfig(
                server=server_url,
                username=parsed.username,
                password=parsed.password
            )
            print(f"Configuring Crawl4AI proxy to route through: {server_url}")
        except Exception as e:
            print(f"Warning: Failed to parse SCRAPING_PROXY: {e}")

    browser_config = BrowserConfig(
        headless=True,
        viewport_width=1280,
        viewport_height=800,
        extra_args=["--disable-blink-features=AutomationControlled"],
        proxy_config=proxy_config
    )
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=30000
    )

    out_file = open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig")
    writer = csv.writer(out_file)
    writer.writerow(["Keyword", "Rank 1 URL", "Rank 1 Title", "Rank 2 URL", "Rank 2 Title", "Rank 3 URL", "Rank 3 Title", "Rank 4 URL", "Rank 4 Title", "Rank 5 URL", "Rank 5 Title"])

    json_results = []
    
    # Initialize semaphore to limit concurrency to 10
    semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)

    try:
        async with AsyncWebCrawler(config=browser_config) as crawler:
            tasks = []
            for idx, keyword in enumerate(keywords, 1):
                tasks.append(
                    scrape_keyword(crawler, keyword, idx, len(keywords), semaphore, run_config, writer, json_results)
                )
            
            # Run all tasks concurrently up to the semaphore limit
            await asyncio.gather(*tasks)
    finally:
        out_file.close()

        # Save JSON output at the end
        try:
            with open(OUTPUT_JSON_FILE, "w", encoding="utf-8") as json_f:
                json.dump(json_results, json_f, indent=2, ensure_ascii=False)
        except Exception as ex:
            print(f"Error saving JSON file: {ex}")

    print(f"\n{'='*60}")
    print(f"  DONE — Results saved to:")
    print(f"  CSV  : {OUTPUT_FILE}")
    print(f"  JSON : {OUTPUT_JSON_FILE}")
    print(f"  Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
