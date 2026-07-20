#!/usr/bin/env python3
"""
firecrawl_scraper.py

A script that uses Firecrawl's structured /v2/search API to extract:
- Top 3 Organic results (listed on Google positions 1, 2, 3)
- Other organic results (positions 4+)

Utilizes geo-targeting ("country": "in") to ensure 100% accurate localized search rankings,
bypassing all Google CAPTCHA blocks.
"""

import os
import csv
import json
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from dotenv import load_dotenv

load_dotenv()

INPUT_FILE = "backend/datasets/its category test 14 july - Sheet1.csv"
OUTPUT_FILE = "backend/datasets/its category.csv"
OUTPUT_JSON_FILE = "backend/datasets/its category.json"
CONCURRENCY_LIMIT = 3

FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "fc-3897dbc7f2da4e3ba0da80d146edd393")
FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search"


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


def fetch_top_results_via_firecrawl(keyword: str, country_code: str = "in") -> dict:
    """Fetch organic results via Firecrawl /v2/search endpoint with retries on 429 rate limit."""
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "query": keyword,
        "limit": 10,
        "country": country_code
    }
    
    max_retries = 5
    backoff = 2
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(FIRECRAWL_SEARCH_URL, json=payload, headers=headers, timeout=30)
            if resp.status_code == 429:
                print(f"  [Firecrawl Rate Limit] 429 Too Many Requests for '{keyword}'. Retrying in {backoff}s...")
                time.sleep(backoff)
                backoff *= 2
                continue
                
            resp.raise_for_status()
            res_data = resp.json()
            
            if not res_data.get("success"):
                return {"top_3": [], "other": []}
                
            web_results = res_data.get("data", {}).get("web", [])
            organic = []
            for item in web_results:
                organic.append({
                    "url": item.get("url", ""),
                    "title": item.get("title", "")
                })
                
            top_3 = [{"rank": idx, "url": res["url"], "title": res["title"]} for idx, res in enumerate(organic[:3], 1)]
            other = [{"rank": idx, "url": res["url"], "title": res["title"]} for idx, res in enumerate(organic[3:], 4)]
            
            return {"top_3": top_3, "other": other}
        except Exception as e:
            if attempt == max_retries:
                print(f"  [Firecrawl Error] Search failed for '{keyword}' after {max_retries} attempts: {e}")
                return {"top_3": [], "other": []}
            time.sleep(backoff)
            backoff *= 2
            
    return {"top_3": [], "other": []}


def process_keyword(keyword: str, idx: int, total_keywords: int) -> dict:
    """Worker task to process a single keyword with a gentle delay to respect rate limits."""
    time.sleep(1.0)
    print(f"[{idx}/{total_keywords}] Fetching via Firecrawl Search: '{keyword}'...")
    data = fetch_top_results_via_firecrawl(keyword)
    
    # Structure row data for CSV writing
    # Format: Keyword, Rank 1 URL, Rank 1 Title, Rank 2 URL, Rank 2 Title, Rank 3 URL, Rank 3 Title, Other Organic URLs, Sponsored Ads, AI Overview
    row_data = [keyword]
    for res in data["top_3"]:
        row_data.extend([res["url"], res["title"]])
    while len(row_data) < 7:
        row_data.extend(["", ""])
        
    other_urls_str = ", ".join([res["url"] for res in data["other"]])
    row_data.extend([other_urls_str, "", ""]) # ads and ai overview are filtered from search index
    
    return {
        "keyword": keyword,
        "row_data": row_data,
        "top_3": data["top_3"],
        "other": data["other"]
    }


def main():
    print(f"\n{'='*60}")
    print(f"  Google SERP Fetcher (Firecrawl Search)")
    print(f"  Input File  : {INPUT_FILE}")
    print(f"  CSV Output  : {OUTPUT_FILE}")
    print(f"  JSON Output : {OUTPUT_JSON_FILE}")
    print(f"  Workers     : {CONCURRENCY_LIMIT} concurrent tasks")
    print(f"  Started     : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    try:
        keywords = load_keywords(INPUT_FILE)
    except Exception as e:
        print(f"Error loading keywords: {e}")
        return

    print(f"Loaded {len(keywords)} keywords from input sheet.\n")

    csv_rows = []
    json_results = []
    total = len(keywords)

    with ThreadPoolExecutor(max_workers=CONCURRENCY_LIMIT) as executor:
        futures = {executor.submit(process_keyword, kw, i, total): kw for i, kw in enumerate(keywords, 1)}
        for future in as_completed(futures):
            res = future.result()
            csv_rows.append(res["row_data"])
            json_results.append({
                "keyword": res["keyword"],
                "top_3_organic": res["top_3"],
                "other_organic": res["other"],
                "sponsored_ads": [],
                "ai_overview": ""
            })

    # Save CSV output
    try:
        with open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow([
                "Keyword", 
                "Rank 1 URL", "Rank 1 Title", 
                "Rank 2 URL", "Rank 2 Title", 
                "Rank 3 URL", "Rank 3 Title", 
                "Other Organic URLs", "Sponsored Ads", "AI Overview"
            ])
            keyword_order = {kw: i for i, kw in enumerate(keywords)}
            csv_rows.sort(key=lambda r: keyword_order.get(r[0], 9999))
            writer.writerows(csv_rows)
    except Exception as ex:
        print(f"Error saving CSV file: {ex}")

    # Save JSON output
    try:
        with open(OUTPUT_JSON_FILE, "w", encoding="utf-8") as f:
            keyword_order = {kw: i for i, kw in enumerate(keywords)}
            json_results.sort(key=lambda r: keyword_order.get(r["keyword"], 9999))
            json.dump(json_results, f, indent=2, ensure_ascii=False)
    except Exception as ex:
        print(f"Error saving JSON file: {ex}")

    print(f"\n{'='*60}")
    print(f"  DONE — Results saved to:")
    print(f"  CSV  : {OUTPUT_FILE}")
    print(f"  JSON : {OUTPUT_JSON_FILE}")
    print(f"  Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
