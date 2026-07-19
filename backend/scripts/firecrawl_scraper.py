#!/usr/bin/env python3
"""
firecrawl_scraper.py

A script that uses Firecrawl's /v2/search API to retrieve the top 3 Google organic search results
(url, title, and ranking) for a batch of keywords, using concurrent request execution.

Reads from: backend/datasets/its category test 14 july - Sheet1_categories.csv
Writes to: backend/datasets/its category.csv
           backend/datasets/its category.json
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

INPUT_FILE = "backend/datasets/its category test 14 july - Sheet1_categories.csv"
OUTPUT_FILE = "backend/datasets/its category.csv"
OUTPUT_JSON_FILE = "backend/datasets/its category.json"
CONCURRENCY_LIMIT = 10

# Use user's Firecrawl Key from environment, or fallback to the provided token
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "fc-71975f3c37884f65b8dc034031adb99d")
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


def fetch_top3_via_firecrawl(keyword: str) -> list[dict]:
    """Fetch the top 3 Google organic results via Firecrawl /v2/search endpoint."""
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "query": keyword,
        "limit": 3
    }
    
    try:
        resp = requests.post(FIRECRAWL_SEARCH_URL, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        res_data = resp.json()
        
        if not res_data.get("success"):
            print(f"  [Firecrawl Warning] API returned unsuccessful search for '{keyword}'")
            return []
            
        # Parse result elements under data.web
        web_results = res_data.get("data", {}).get("web", [])
        top3 = []
        for item in web_results[:3]:
            top3.append({
                "url": item.get("url", ""),
                "title": item.get("title", ""),
                "position": item.get("position")
            })
        return top3
    except Exception as e:
        print(f"  [Firecrawl Error] Search failed for '{keyword}': {e}")
        return []


def process_keyword(keyword: str, idx: int, total_keywords: int) -> dict:
    """Worker task to process a single keyword."""
    print(f"[{idx}/{total_keywords}] Fetching: '{keyword}'...")
    top3 = fetch_top3_via_firecrawl(keyword)
    
    # Structure row data for CSV writing
    row_data = [keyword]
    for res in top3:
        row_data.extend([res["url"], res["title"]])
    while len(row_data) < 7:
        row_data.extend(["", ""])
        
    return {
        "keyword": keyword,
        "row_data": row_data,
        "results": [{"rank": rank, "url": item["url"], "title": item["title"]} for rank, item in enumerate(top3, 1)]
    }


def main():
    print(f"\n{'='*60}")
    print(f"  Google Top-3 URL Fetcher (Firecrawl)")
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

    # Execute keyword searches concurrently
    with ThreadPoolExecutor(max_workers=CONCURRENCY_LIMIT) as executor:
        futures = {executor.submit(process_keyword, kw, i, total): kw for i, kw in enumerate(keywords, 1)}
        for future in as_completed(futures):
            res = future.result()
            csv_rows.append(res["row_data"])
            json_results.append({
                "keyword": res["keyword"],
                "results": res["results"]
            })

    # Save CSV output
    try:
        with open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["Keyword", "Rank 1 URL", "Rank 1 Title", "Rank 2 URL", "Rank 2 Title", "Rank 3 URL", "Rank 3 Title"])
            # Keep order consistent with loaded keyword list
            keyword_order = {kw: i for i, kw in enumerate(keywords)}
            csv_rows.sort(key=lambda r: keyword_order.get(r[0], 9999))
            writer.writerows(csv_rows)
    except Exception as ex:
        print(f"Error saving CSV file: {ex}")

    # Save JSON output
    try:
        with open(OUTPUT_JSON_FILE, "w", encoding="utf-8") as f:
            # Maintain consistency with order
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
