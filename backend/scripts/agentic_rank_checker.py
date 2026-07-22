"""
agentic_rank_checker.py

Agentic (Claude-driven) rank checker -- a heavier, LLM-analyzed
alternative to services/rank_checker.py's pure Bright Data + deterministic
matching approach. For each keyword, fetches up to N organic Google
results (trying Crawl4AI first, then SerpApi/Bright Data as a fallback),
then hands the whole SERP (not just the target URL check) to Claude to
determine rank, match type, top competitors, search intent, and an
actionable SEO recommendation.

Adapted to this project's actual layout -- the only change from what was
given is the config section: this repo has no `app.core.config` module,
so `settings` here is a small local shim reading straight from
environment variables (via python-dotenv's load_dotenv(), same
convention services/rank_checker.py and services/category_checker.py
already use), rather than removed -- every `settings.X` reference below
still works unchanged.

Dependencies (in requirements.txt): anthropic, crawl4ai, requests,
beautifulsoup4, pydantic, python-dotenv. Crawl4AI drives its own
Chromium under the hood, so it needs `playwright install chromium` run
once (crawl4ai depends on playwright internally even though this script
no longer imports it directly).

Env vars used (add to .env as needed):
    ANTHROPIC_API_KEY, ANTHROPIC_CHAT_MODEL (default "claude-sonnet-5")
    BRIGHTDATA_API_KEY, BRIGHTDATA_SERP_ZONE (default "serp_api1")
    SERPAPI_API_KEY
    SERP_COUNTRY (default "in"), SERP_LANGUAGE (default "en")
    TOP_N (default 40)

Run standalone:
    python -m scripts.agentic_rank_checker --input path/to/sheet.csv
"""

import os
import sys
import time
import json
import csv
import argparse
import random
import asyncio
from urllib.parse import quote, urlparse
from typing import List, Dict, Optional

import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from anthropic import Anthropic
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode, ProxyConfig

load_dotenv()


class _Settings:
    """Local shim standing in for the `app.core.config.settings` object
    this script was originally written against -- every `settings.X`
    attribute access below is unchanged, just backed by plain env vars
    instead of a config module that doesn't exist in this repo."""
    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
    ANTHROPIC_CHAT_MODEL = os.environ.get("ANTHROPIC_CHAT_MODEL", "claude-sonnet-5")
    BRIGHTDATA_API_KEY = os.environ.get("BRIGHTDATA_API_KEY")
    BRIGHTDATA_SERP_ZONE = os.environ.get("BRIGHTDATA_SERP_ZONE", "serp_api1")
    SERPAPI_API_KEY = os.environ.get("SERPAPI_API_KEY")
    SERP_COUNTRY = os.environ.get("SERP_COUNTRY", "in")
    SERP_LANGUAGE = os.environ.get("SERP_LANGUAGE", "en")
    TOP_N = int(os.environ.get("TOP_N", "40"))


settings = _Settings()


# Output schemas using Pydantic
class RankCheckResult(BaseModel):
    keyword: str = Field(..., description="The search query checked")
    target_url: str = Field(..., description="The landing page URL we wanted to find rank for")
    rank: int = Field(..., description="The rank of the target URL in organic search results (1-indexed). Use 101 if not found in top N.")
    match_type: str = Field(..., description="Type of match found: 'exact_url_match', 'domain_match', or 'no_match'")
    matched_url: Optional[str] = Field(None, description="The actual URL from the search results that matched")
    top_competitors: List[str] = Field(..., description="Domains or names of the top 3 ranking competitors")
    serp_intent_analysis: str = Field(..., description="Brief analysis of the search intent behind the ranking pages")
    ranking_reasoning: str = Field(..., description="Reasoning for why our page ranks at this position and what is holding it back")
    actionable_recommendation: str = Field(..., description="Actionable recommendation to improve rank for this keyword")


# Helper functions for URL parsing and normalisation
def clean_url(url: str) -> str:
    """Normalize URL path and scheme for comparison (scheme + netloc + path, no trailing slash/www)."""
    if not url or str(url).strip() == "" or str(url).lower() == "nan":
        return ""
    url = str(url).strip().rstrip("/").lower()
    if not url.startswith("http"):
        url = "https://" + url
    try:
        parsed = urlparse(url)
        netloc = parsed.netloc[4:] if parsed.netloc.startswith("www.") else parsed.netloc
        return f"{parsed.scheme}://{netloc}{parsed.path}".rstrip("/").lower()
    except Exception:
        return url.lower()


def get_domain(url: str) -> str:
    """Extract bare domain name (no www.) from a URL."""
    if not url:
        return ""
    if not url.startswith("http"):
        url = "https://" + url
    try:
        netloc = urlparse(url).netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


# SERP page fetching
def parse_serp_results_from_html(html: str) -> List[Dict[str, str]]:
    """Extract organic result links, titles, and snippets from a raw Google SERP HTML page."""
    soup = BeautifulSoup(html, "html.parser")
    results = []
    seen_urls = set()

    # Try standard Google search result containers
    containers = soup.select("div.g, div.MjjYud, div.Ww4gTb")

    for container in containers:
        a = container.find("a", href=True)
        if not a:
            continue
        h3 = a.find("h3")
        if not h3:
            continue

        url = a["href"]
        if not url.startswith("http") or "google.com" in url or "webcache.googleusercontent" in url:
            continue

        cleaned = clean_url(url)
        if not cleaned or cleaned in seen_urls:
            continue
        seen_urls.add(cleaned)

        title = h3.get_text(strip=True)

        # Extract snippet/description
        snippet = ""
        snippet_el = container.find("div", class_=lambda c: c and any(k in c for k in ["VwiC3b", "yDqZfe", "kb0PBd"]))
        if snippet_el:
            snippet = snippet_el.get_text(strip=True)
        else:
            # Fallback to other text containers that don't match the h3 title text
            for el in container.find_all(["div", "span"]):
                text = el.get_text(strip=True)
                if text and len(text) > 40 and title not in text and url not in text:
                    snippet = text[:250]
                    break

        results.append({
            "url": url,
            "title": title,
            "snippet": snippet
        })

    # Fallback to all a tags containing h3 if containers yielded nothing
    if not results:
        for a in soup.find_all("a", href=True):
            h3 = a.find("h3")
            if not h3:
                continue
            url = a["href"]
            if not url.startswith("http") or "google.com" in url or "webcache.googleusercontent" in url:
                continue
            cleaned = clean_url(url)
            if not cleaned or cleaned in seen_urls:
                continue
            seen_urls.add(cleaned)
            title = h3.get_text(strip=True)
            results.append({
                "url": url,
                "title": title,
                "snippet": ""
            })

    return results


def fetch_serp_brightdata(keyword: str, start: int = 0, country_code: str = None) -> List[Dict[str, str]]:
    """Request a single page of Google results through the Bright Data SERP zone."""
    if not settings.BRIGHTDATA_API_KEY:
        raise RuntimeError("BRIGHTDATA_API_KEY is not configured; cannot fetch live SERP data.")

    gl = country_code or settings.SERP_COUNTRY
    search_url = (
        f"https://www.google.com/search?q={quote(keyword)}"
        f"&gl={gl}&hl={settings.SERP_LANGUAGE}&start={start}"
    )

    payload = {
        "zone": settings.BRIGHTDATA_SERP_ZONE,
        "url": search_url,
        "format": "raw",
    }
    headers = {
        "Authorization": f"Bearer {settings.BRIGHTDATA_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(
            "https://api.brightdata.com/request",
            headers=headers,
            json=payload,
            timeout=90
        )
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            html = resp.json().get("body", "")
        else:
            html = resp.text

        if not html or "<html" not in html.lower():
            print(f"[Bright Data Warn] HTML content is invalid or missing for keyword '{keyword}'")
            return []

        return parse_serp_results_from_html(html)
    except Exception as e:
        print(f"[Bright Data Error] Failed to fetch results for '{keyword}' (start={start}): {e}")
        return []


async def _crawl_google_with_crawl4ai(search_url: str) -> str:
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
        except Exception as e:
            print(f"[agentic_rank_checker] Warning: Failed to parse SCRAPING_PROXY: {e}")

    browser_config = BrowserConfig(
        headless=True,
        viewport_width=1280,
        viewport_height=800,
        proxy_config=proxy_config
    )
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS
    )
    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(search_url, config=run_config)
        if result.success:
            return result.html
        else:
            raise Exception(f"Crawl4AI failed: {result.error_message}")


def fetch_serp_crawl4ai(keyword: str, start: int = 0, country_code: str = None) -> List[Dict[str, str]]:
    """Scrape Google Search using Crawl4AI AsyncWebCrawler run synchronously."""
    gl = country_code or settings.SERP_COUNTRY
    search_url = (
        f"https://www.google.com/search?q={quote(keyword)}"
        f"&gl={gl}&hl={settings.SERP_LANGUAGE}&start={start}"
    )
    try:
        html = asyncio.run(_crawl_google_with_crawl4ai(search_url))
        if not html:
            return []

        if "captcha" in html.lower() or "recaptcha" in html.lower() or "unusual traffic" in html.lower():
            print(f"[Captcha Warning] Crawl4AI encountered a CAPTCHA challenge.")
            raise ValueError("Crawl4AI hit a CAPTCHA challenge.")

        # Verify if search results exist in page html
        if "class=\"g\"" not in html and "id=\"search\"" not in html and "id=\"rso\"" not in html:
            raise ValueError("Google Search results container not found in page HTML.")

        return parse_serp_results_from_html(html)
    except Exception as e:
        print(f"[Crawl4AI Error] Scrape failed for '{keyword}' (start={start}): {e}")
        return []


def fetch_serp_serpapi(keyword: str, start: int = 0, country_code: str = None) -> List[Dict[str, str]]:
    """Fetch organic search results via SerpApi."""
    if not settings.SERPAPI_API_KEY:
        raise RuntimeError("SERPAPI_API_KEY is not configured; cannot fetch live SerpApi data.")

    gl = country_code or settings.SERP_COUNTRY
    params = {
        "engine": "google",
        "q": keyword,
        "gl": gl,
        "hl": settings.SERP_LANGUAGE,
        "start": start,
        "num": 10,
        "api_key": settings.SERPAPI_API_KEY,
    }

    try:
        resp = requests.get("https://serpapi.com/search.json", params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        error = data.get("error")
        if error:
            print(f"[SerpApi Error] '{keyword}' (start={start}): {error}")
            return []

        results = []
        for result in data.get("organic_results", []):
            url = result.get("link")
            if not url:
                continue
            results.append({
                "url": url,
                "title": result.get("title", ""),
                "snippet": result.get("snippet", "")
            })
        return results
    except Exception as e:
        print(f"[SerpApi Error] Failed to fetch results for '{keyword}' (start={start}): {e}")
        return []


def get_top_n_serp_results(keyword: str, n: int = 40, country_code: str = None, target_url: str = None) -> List[Dict[str, str]]:
    """Retrieve and combine up to N organic results from the preferred search API."""
    results = []
    seen = set()
    start = 0

    # Choose parser/API depending on environment configuration
    use_serpapi = bool(settings.SERPAPI_API_KEY)
    use_brightdata = bool(settings.BRIGHTDATA_API_KEY)

    if not use_serpapi and not use_brightdata:
        print("[Warn] Neither SERPAPI_API_KEY nor BRIGHTDATA_API_KEY is configured. Falling back to mock results.")
        # Fallback Mock results for development / testing without keys
        mock_results = [
            {"url": "https://www.euroschoolindia.com/best-schools-in-mumbai/icse-airoli-navi-mumbai/", "title": "Best ICSE Schools in Airoli, Navi Mumbai | EuroSchool", "snippet": "EuroSchool Airoli is one of the best ICSE schools in Navi Mumbai, offering world-class infrastructure and a balanced curriculum for student development."},
            {"url": "https://www.parentree.in/schools/mumbai/navi-mumbai/airoli", "title": "Top Schools in Airoli, Navi Mumbai - Admission & Reviews", "snippet": "Find the top 10 best schools in Airoli, Navi Mumbai. Read reviews, compare ratings, admission processes, and fee structure of leading schools."},
            {"url": "https://www.edustoke.com/navi-mumbai/schools-in-airoli", "title": "Best Schools in Airoli, Navi Mumbai - Admissions, Fees", "snippet": "List of top schools in Airoli Navi Mumbai with details of fees, reviews, admissions, curriculum, address and contact information."},
        ]
        return mock_results

    while len(results) < n:
        page_results = []
        try:
            print(f"[Scraper] Attempting Crawl4AI fetch for '{keyword}' (start={start})...")
            page_results = fetch_serp_crawl4ai(keyword, start=start, country_code=country_code)
        except Exception as ce:
            print(f"[Scraper Fallback] Crawl4AI failed: {ce}. Trying HTTP fallback...")
            page_results = []

        if not page_results:
            if use_serpapi:
                page_results = fetch_serp_serpapi(keyword, start=start, country_code=country_code)
            elif use_brightdata:
                page_results = fetch_serp_brightdata(keyword, start=start, country_code=country_code)

        if not page_results:
            break

        new_results = []
        for r in page_results:
            cleaned = clean_url(r["url"])
            if cleaned not in seen:
                seen.add(cleaned)
                new_results.append(r)

        if not new_results:
            break

        results.extend(new_results)

        # Check if target_url or target domain is already in results to exit loop early
        if target_url:
            target_clean = clean_url(target_url)
            target_dom = get_domain(target_url)
            found = False
            for r in new_results:
                r_clean = clean_url(r["url"])
                if r_clean == target_clean or (target_dom and target_dom in get_domain(r["url"])):
                    found = True
                    break
            if found:
                break

        start += 10

        if start > n * 2:  # Safety guard
            break

        # Add randomized delay between page pagination requests to avoid predictable patterns
        delay = random.uniform(2.0, 5.0)
        time.sleep(delay)

    return results[:n]


# Agent implementation using Claude API
class RankCheckAgent:
    def __init__(self):
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY must be set in settings to use RankCheckAgent.")
        self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = settings.ANTHROPIC_CHAT_MODEL

    def check_keyword_rank(self, keyword: str, target_url: str, country_code: str = None) -> RankCheckResult:
        """
        Query search results for a keyword, then pass the SERP data to Claude
        to check, confirm, analyze the rank of the target URL, and extract competitors,
        intent, and actionable recommendations.
        """
        # 1. Fetch organic results
        results = get_top_n_serp_results(keyword, n=settings.TOP_N, country_code=country_code, target_url=target_url)

        # 2. Package SERP results for prompt
        serp_entries = []
        for idx, res in enumerate(results, start=1):
            serp_entries.append({
                "rank": idx,
                "url": res["url"],
                "title": res["title"],
                "snippet": res.get("snippet", "")
            })

        # 3. Construct System and User prompts for Claude
        system_prompt = (
            "You are an expert AI SEO Analyst. Your objective is to review search engine result pages (SERP) "
            "and accurately evaluate the search engine ranking position (rank) of a target URL for a given keyword query.\n\n"
            "Analyze the organic SERP results against the target URL according to these strict logic constraints:\n"
            "1. MATCHING LOGIC:\n"
            "   - Exact Match ('exact_url_match'): If the path and parameters of a result URL exactly or substantively match the target URL (ignoring 'www.', protocols, and trailing slashes).\n"
            "   - Domain Match ('domain_match'): If the target URL is NOT found, but another URL belonging to the exact same domain name is found in the search results.\n"
            "   - No Match ('no_match'): If neither the target URL nor any page on its domain appears in the SERP list.\n"
            "2. RANK ASSIGNMENT:\n"
            "   - If an 'exact_url_match' is found, assign the 1-indexed position of that match.\n"
            "   - If a 'domain_match' is found (but no exact match), assign the 1-indexed position of the domain match.\n"
            "   - If no match of either type is found, assign the rank number 101.\n"
            "3. ANALYSIS:\n"
            "   - List the domains of the top 3 ranking competitors.\n"
            "   - Classify and summarize search intent (informational, commercial, navigational, transactional).\n"
            "   - Deduce why the page is ranking where it is (or why it is absent) based on titles and snippets of higher-ranking pages.\n"
            "   - Formulate a precise, actionable recommendation on how to optimize the target page to improve or capture the rank.\n\n"
            "You must output a single, raw, valid JSON object matching the requested schema. Do not enclose it in markdown blocks, explanations, or any text other than the JSON itself."
        )

        prompt_content = {
            "keyword": keyword,
            "target_url": target_url,
            "serp_results": serp_entries
        }

        user_prompt = (
            "Please analyze the following keyword query and organic Google Search results to determine and verify the rank "
            "of the target URL. Return a JSON object complying with the following schema structure:\n"
            "{\n"
            '  "keyword": "string",\n'
            '  "target_url": "string",\n'
            '  "rank": integer,\n'
            '  "match_type": "exact_url_match" | "domain_match" | "no_match",\n'
            '  "matched_url": "string" or null,\n'
            '  "top_competitors": ["string", "string", "string"],\n'
            '  "serp_intent_analysis": "string",\n'
            '  "ranking_reasoning": "string",\n'
            '  "actionable_recommendation": "string"\n'
            "}\n\n"
            f"Data to analyze:\n{json.dumps(prompt_content, indent=2)}"
        )

        # 4. Call Claude API
        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=1500,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": user_prompt}
                ]
            )

            response_text = ""
            for block in message.content:
                if getattr(block, "type", None) == "text" or hasattr(block, "text"):
                    response_text = block.text.strip()
                    break
            if not response_text:
                raise ValueError("No text block found in Claude response.")

            # Extract JSON if model wrapped it in markdown code block
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()

            data = json.loads(response_text)

            # Map JSON to Pydantic Model
            return RankCheckResult(**data)

        except Exception as e:
            print(f"[Agentic Rank Check Error] LLM analysis failed for keyword '{keyword}': {e}")
            # Fallback output
            # Check locally first to see if we can find it
            rank = 101
            match_type = "no_match"
            matched_url = None

            target_clean = clean_url(target_url)
            target_dom = get_domain(target_url)

            for idx, r in enumerate(results, start=1):
                r_clean = clean_url(r["url"])
                if r_clean == target_clean:
                    rank = idx
                    match_type = "exact_url_match"
                    matched_url = r["url"]
                    break
                elif target_dom and target_dom in get_domain(r["url"]) and match_type == "no_match":
                    rank = idx
                    match_type = "domain_match"
                    matched_url = r["url"]

            competitors = []
            for r in results[:3]:
                dom = get_domain(r["url"])
                if dom and dom not in competitors:
                    competitors.append(dom)

            return RankCheckResult(
                keyword=keyword,
                target_url=target_url,
                rank=rank,
                match_type=match_type,
                matched_url=matched_url,
                top_competitors=competitors,
                serp_intent_analysis="Analysis failed; fallback parsing triggered.",
                ranking_reasoning=f"An error occurred during LLM processing: {str(e)}",
                actionable_recommendation="Ensure the Anthropic API is active and retry."
            )


def extract_keyword_and_landing_page(row: Dict[str, str]):
    """Accept common keyword/landing-page column-name variants from CSV files."""
    if not row:
        return "", ""

    normalized = {}
    for key, value in row.items():
        if key is None:
            continue
        normalized[key.strip().lower()] = (value or "").strip()

    keyword = (
        normalized.get("keyword")
        or normalized.get("keywords")
        or normalized.get("search keyword")
        or normalized.get("query")
        or ""
    )
    landing_page = (
        normalized.get("landing page")
        or normalized.get("landing_page")
        or normalized.get("target url")
        or normalized.get("target_url")
        or normalized.get("url")
        or ""
    )
    return keyword, landing_page


def save_output_json(results: List[RankCheckResult], output_path: str):
    """Save results as a clean structured JSON array."""
    data = [res.model_dump() for res in results]
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def save_output_markdown(results: List[RankCheckResult], output_path: str):
    """Save results as a beautiful Markdown report with tables and deep dive analyses."""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("# Agentic Rank Checking Report\n\n")
        f.write(f"Generated at: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")

        # Summary table
        f.write("## Executive Summary Table\n\n")
        f.write("| Keyword | Landing Page | Rank | Match Type | Top Competitors |\n")
        f.write("| :--- | :--- | :---: | :---: | :--- |\n")
        for res in results:
            competitors = ", ".join(res.top_competitors)
            f.write(f"| **{res.keyword}** | [{res.target_url}]({res.target_url}) | **{res.rank}** | `{res.match_type}` | {competitors} |\n")

        f.write("\n---\n\n")
        f.write("## Keyword Deep Dives\n\n")
        for idx, res in enumerate(results, start=1):
            f.write(f"### {idx}. {res.keyword}\n\n")
            f.write(f"- **Target URL**: [{res.target_url}]({res.target_url})\n")
            f.write(f"- **Rank**: {res.rank} (`{res.match_type}`)\n")
            if res.matched_url:
                f.write(f"- **Matched URL**: [{res.matched_url}]({res.matched_url})\n")
            f.write(f"- **Top Competitors**: {', '.join(res.top_competitors)}\n\n")

            f.write("#### Search Intent Analysis\n")
            f.write(f"{res.serp_intent_analysis}\n\n")

            f.write("#### Ranking Reasoning & Dynamics\n")
            f.write(f"{res.ranking_reasoning}\n\n")

            f.write("#### Actionable Recommendation\n")
            f.write(f"> {res.actionable_recommendation}\n\n")
            f.write("---\n\n")


# CLI Execution Block
def main():
    parser = argparse.ArgumentParser(description="Agentic Google Search rank checker using Claude API")
    parser.add_argument(
        "--input",
        type=str,
        default="/Users/manish/Backend/backend/datasets/its category test 14 july - Sheet1.csv",
        help="Path to the input CSV dataset containing Keyword and Landing Page columns"
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Path to save the output rank check results CSV"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit the number of rows processed (useful for testing)"
    )
    parser.add_argument(
        "--country",
        type=str,
        default=None,
        help="Override search country code (e.g. 'in', 'us')"
    )
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    if not os.path.exists(input_path):
        print(f"Error: Input dataset file not found at: {input_path}")
        sys.exit(1)

    output_path = args.output
    if not output_path:
        base_name = os.path.splitext(input_path)[0]
        output_path = f"{base_name}_ranks.csv"
    output_path = os.path.abspath(output_path)

    # Derived JSON and Markdown output paths
    base_output_dir = os.path.dirname(output_path)
    base_output_name = os.path.splitext(os.path.basename(output_path))[0]
    json_output_path = os.path.join(base_output_dir, f"{base_output_name}.json")
    md_output_path = os.path.join(base_output_dir, f"{base_output_name}.md")

    print(f"\n============================================================")
    print(f"Agentic Rank Checker Starting...")
    print(f"Input Dataset  : {input_path}")
    print(f"Output Dataset : {output_path}")
    print(f"Claude Model   : {settings.ANTHROPIC_CHAT_MODEL}")
    if args.limit:
        print(f"Limit          : {args.limit} rows")
    print(f"============================================================\n")

    # Read rows from input CSV
    rows_to_process = []
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            kw, lp = extract_keyword_and_landing_page(row)
            if kw:
                rows_to_process.append({"Keyword": kw, "Landing Page": lp})

    if not rows_to_process:
        print("No valid keywords found in input file.")
        sys.exit(0)

    if args.limit:
        rows_to_process = rows_to_process[:args.limit]

    print(f"Found {len(rows_to_process)} keywords to check. Starting processing...\n")

    agent = RankCheckAgent()
    results_records = []

    # Prepare output headers
    headers = [
        "Keyword", "Landing Page", "Rank", "Match Type", "Matched URL",
        "Top Competitors", "Serp Intent Analysis", "Ranking Reasoning", "Actionable Recommendation"
    ]

    # Open output file for incremental writing
    with open(output_path, "w", newline="", encoding="utf-8-sig") as out_f:
        writer = csv.writer(out_f)
        writer.writerow(headers)

        for idx, row in enumerate(rows_to_process, start=1):
            keyword = row["Keyword"]
            landing_page = row["Landing Page"]

            print(f"[{idx}/{len(rows_to_process)}] Processing Keyword: '{keyword}' | Target URL: '{landing_page}'")

            # Execute agent check
            result: RankCheckResult = agent.check_keyword_rank(keyword, landing_page, country_code=args.country)

            # Print quick summary
            print(f"    -> Rank: {result.rank} ({result.match_type})")
            if result.rank != 101:
                print(f"    -> Matched: {result.matched_url}")
            print(f"    -> Intent: {result.serp_intent_analysis[:100]}...")
            print(f"    -> Competitors: {', '.join(result.top_competitors)}")
            print("-" * 50)

            # Write to CSV
            writer.writerow([
                result.keyword,
                result.target_url,
                result.rank,
                result.match_type,
                result.matched_url or "",
                ", ".join(result.top_competitors),
                result.serp_intent_analysis,
                result.ranking_reasoning,
                result.actionable_recommendation
            ])
            # Save all results incrementally to JSON & Markdown formats
            results_records.append(result)
            try:
                save_output_json(results_records, json_output_path)
                save_output_markdown(results_records, md_output_path)
            except Exception as se:
                print(f"[Save Error] Failed to write JSON/Markdown incremental output: {se}")

            # Add randomized delay to avoid aggressive rate limiting and predictable request patterns
            delay = random.uniform(5.0, 12.0)
            print(f"    -> Sleeping for {delay:.2f}s before next query...")
            time.sleep(delay)

    print(f"\nProcessing complete! Outputs saved to:")
    print(f"  CSV:  {output_path}")
    print(f"  JSON: {json_output_path}")
    print(f"  MD:   {md_output_path}\n")


if __name__ == "__main__":
    main()
