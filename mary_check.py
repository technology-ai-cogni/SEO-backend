#!/usr/bin/env python3
"""
Mary Check - Google Search & AI Overview Rank Checker via SerpApi
==================================================================

Performs comprehensive keyword search analysis using SerpApi:
  1. Google Organic Search Ranking (Position 1-100, exact URL vs domain match)
  2. Google AI Overview & Generative AI Mode (Presence, citations, source links, brand mentions)
  3. Search Intent Classification (Informational, Commercial, Transactional, Navigational)
  4. SERP Features & Top Competitor Landscape

Usage:
  # Single keyword check:
  python mary_check.py --keyword "top 10 international schools in india" --domain "euroschoolindia.com"

  # With custom country code and landing page:
  python mary_check.py -k "international schools in bangalore" -d "https://www.euroschoolindia.com/schools/bangalore" -c "in"

  # Batch check from CSV:
  python mary_check.py --input keywords.csv --domain "euroschoolindia.com" --output results.csv
"""

import os
import sys
import re
import json
import csv
import time
import argparse
import urllib.parse
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import warnings
warnings.filterwarnings("ignore")

try:
    import requests
except ImportError:
    requests = None

# ── Load Environment Variables ───────────────────────────────────────────────
CURRENT_DIR = Path(__file__).resolve().parent
ENV_LOCATIONS = [
    CURRENT_DIR / "backend" / ".env",
    CURRENT_DIR / ".env",
    Path.cwd() / "backend" / ".env",
    Path.cwd() / ".env",
]

for env_path in ENV_LOCATIONS:
    if env_path.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(env_path)
            break
        except ImportError:
            # Fallback manual env loader if dotenv is not installed
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k not in os.environ:
                            os.environ[k] = v
            break

SERPAPI_API_KEY = os.environ.get("SERPAPI_API_KEY", "")
SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
NOT_FOUND_RANK = 101


# ── URL & Domain Helpers ─────────────────────────────────────────────────────

def clean_url(url: str) -> str:
    """Normalize URL path and scheme for exact URL comparison."""
    if not url or str(url).strip() == "" or str(url).lower() == "nan":
        return ""
    url = str(url).strip().rstrip("/")
    if not url.startswith("http"):
        url = "https://" + url
    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc[4:] if parsed.netloc.lower().startswith("www.") else parsed.netloc
        path = parsed.path.rstrip("/")
        return f"{parsed.scheme}://{netloc.lower()}{path}".lower()
    except Exception:
        return url.lower()


def extract_domain(url_or_domain: str) -> str:
    """Extract bare hostname/domain (without www. or protocol/paths)."""
    if not url_or_domain:
        return ""
    url = str(url_or_domain).strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        # Remove any port
        netloc = netloc.split(":")[0]
        return netloc.strip()
    except Exception:
        clean = re.sub(r"^https?://(www\.)?", "", str(url_or_domain).lower())
        return clean.split("/")[0].split("?")[0].strip()


def extract_brand_tokens(domain: str) -> List[str]:
    """Derive recognizable brand token words from domain name (e.g. euroschoolindia -> ['euroschool', 'euroschoolindia'])."""
    bare = extract_domain(domain).split(".")[0]
    tokens = [bare]
    # Split common suffixes or compound words
    for suffix in ["india", "school", "schools", "global", "group", "edu", "tech"]:
        if bare.endswith(suffix) and len(bare) > len(suffix) + 3:
            root = bare[:-len(suffix)]
            tokens.append(root)
    return list(set([t for t in tokens if len(t) >= 3]))


# ── Search Intent Classifier ─────────────────────────────────────────────────

def detect_search_intent(keyword: str, top_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Determines search intent based on keyword semantics and ranking SERP pages.
    Categories: Informational, Commercial Investigation, Transactional, Navigational.
    """
    kw_lower = keyword.lower()

    # Rule-based keyword matching patterns
    patterns = {
        "Transactional": [
            r"\b(buy|order|purchase|admission|admissions|apply online|fees|pricing|cost|enroll|enrollment|register|hire|cheap|discount)\b"
        ],
        "Commercial": [
            r"\b(best|top|vs|versus|review|reviews|comparison|compare|ranked|ratings|near me|in [a-z]+)\b"
        ],
        "Informational": [
            r"\b(how to|what is|why|guide|tips|tutorial|syllabus|meaning|benefits|procedure|documents required|eligibility|steps|overview)\b"
        ],
        "Navigational": [
            r"\b(login|portal|official site|website|app|customer care|contact number|address|helpline)\b"
        ]
    }

    scores = {"Informational": 0, "Commercial": 0, "Transactional": 0, "Navigational": 0}

    # Keyword text heuristics
    for intent, regex_list in patterns.items():
        for r in regex_list:
            if re.search(r, kw_lower):
                scores[intent] += 3

    # SERP titles and snippets analysis (top 5 organic)
    for r in top_results[:5]:
        text = (r.get("title", "") + " " + r.get("snippet", "")).lower()
        if any(w in text for w in ["best", "top 10", "top 5", "reviews", "comparison", "list of"]):
            scores["Commercial"] += 1
        if any(w in text for w in ["how to", "guide", "what is", "about", "overview", "wiki", "definition"]):
            scores["Informational"] += 1
        if any(w in text for w in ["admission", "apply", "buy", "fees", "cost", "register", "contact"]):
            scores["Transactional"] += 1
        if any(w in text for w in ["official", "login", "portal", "home"]):
            scores["Navigational"] += 1

    # Default fallback
    if max(scores.values()) == 0:
        scores["Informational"] = 1

    primary_intent = max(scores, key=scores.get)

    return {
        "primary_intent": primary_intent,
        "scores": scores,
        "is_commercial_or_transactional": primary_intent in ["Commercial", "Transactional"]
    }


# ── SerpApi Query Logic ──────────────────────────────────────────────────────

def fetch_serpapi_data(
    keyword: str,
    country: str = "in",
    language: str = "en",
    num_results: int = 100,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fetch comprehensive Google SERP response from SerpApi, including
    Organic Results, AI Overview, Answer Box, Knowledge Graph, and PAA.
    """
    key = api_key or os.environ.get("SERPAPI_API_KEY") or SERPAPI_API_KEY
    if not key:
        raise ValueError(
            "SERPAPI_API_KEY is not configured! Please set SERPAPI_API_KEY in backend/.env "
            "or pass it via --api-key argument."
        )

    params = {
        "engine": "google",
        "q": keyword,
        "gl": country,
        "hl": language,
        "num": num_results,
        "api_key": key,
        "google_domain": "google.com" if country == "us" else f"google.co.{country}" if country in ["in", "uk"] else "google.com",
    }

    if requests is not None:
        resp = requests.get(SERPAPI_ENDPOINT, params=params, timeout=45)
        if resp.status_code != 200:
            try:
                err_data = resp.json()
                msg = err_data.get("error", resp.text)
            except Exception:
                msg = resp.text
            raise RuntimeError(f"SerpApi Error (Status {resp.status_code}): {msg}")
        return resp.json()
    else:
        import urllib.request
        query_str = urllib.parse.urlencode(params)
        req = urllib.request.Request(f"{SERPAPI_ENDPOINT}?{query_str}")
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))


# ── Rank & AI Overview Extractor ─────────────────────────────────────────────

def analyze_serp_for_target(
    serp_data: Dict[str, Any],
    keyword: str,
    target_domain_or_url: str
) -> Dict[str, Any]:
    """
    Analyzes SerpApi response to find:
      - Target domain/URL organic rank position
      - AI Overview generative text, citations, and target presence
      - Search intent classification
      - Top ranking competitors
      - SERP features (Answer Box, PAA, Knowledge Graph)
    """
    target_clean_url = clean_url(target_domain_or_url)
    target_domain = extract_domain(target_domain_or_url)
    brand_tokens = extract_brand_tokens(target_domain)

    organic_results = serp_data.get("organic_results", [])
    
    # 1. Organic Rank Matching
    matched_rank = NOT_FOUND_RANK
    matched_url = None
    matched_title = None
    matched_snippet = None
    match_type = "no_match"

    # Exact URL Match check first
    for item in organic_results:
        pos = item.get("position")
        item_url = item.get("link") or item.get("url") or ""
        cleaned_item_url = clean_url(item_url)
        item_domain = extract_domain(item_url)

        if target_clean_url and cleaned_item_url == target_clean_url:
            matched_rank = pos
            matched_url = item_url
            matched_title = item.get("title", "")
            matched_snippet = item.get("snippet", "")
            match_type = "exact_url_match"
            break

    # Domain Match check if no exact URL matched
    if match_type == "no_match" and target_domain:
        for item in organic_results:
            pos = item.get("position")
            item_url = item.get("link") or item.get("url") or ""
            item_domain = extract_domain(item_url)

            if target_domain in item_domain or item_domain in target_domain:
                matched_rank = pos
                matched_url = item_url
                matched_title = item.get("title", "")
                matched_snippet = item.get("snippet", "")
                match_type = "domain_match"
                break

    # 2. AI Overview Analysis
    ai_overview = serp_data.get("ai_overview", {})
    has_ai_overview = bool(ai_overview)
    ai_text_blocks = []
    ai_sources = []
    target_in_ai_sources = False
    target_ai_source_position = None
    target_mentioned_in_ai_text = False
    ai_matching_snippets = []

    if has_ai_overview:
        # Extract text snippets / blocks
        if isinstance(ai_overview, dict):
            # Text blocks / snippets
            for tb in ai_overview.get("text_blocks", []):
                snippet = tb.get("snippet") or tb.get("text") or ""
                if snippet:
                    ai_text_blocks.append(snippet)
            
            # Overview text string if present
            if "overview" in ai_overview and isinstance(ai_overview["overview"], str):
                ai_text_blocks.append(ai_overview["overview"])
            if "snippet" in ai_overview and isinstance(ai_overview["snippet"], str):
                ai_text_blocks.append(ai_overview["snippet"])

            # Sources / References in AI Overview
            raw_sources = ai_overview.get("sources", []) or ai_overview.get("references", [])
            for idx, src in enumerate(raw_sources, start=1):
                src_link = src.get("link") or src.get("url") or ""
                src_title = src.get("title") or src.get("source") or ""
                src_domain = extract_domain(src_link)
                
                source_entry = {
                    "position": idx,
                    "title": src_title,
                    "link": src_link,
                    "domain": src_domain
                }
                ai_sources.append(source_entry)

                # Check if target domain is cited as an AI source
                if target_domain and (target_domain in src_domain or src_domain in target_domain):
                    target_in_ai_sources = True
                    target_ai_source_position = idx

        # Check if brand tokens / domain are mentioned in the AI Overview text
        full_ai_text = " ".join(ai_text_blocks)
        for token in brand_tokens:
            if re.search(r"\b" + re.escape(token) + r"\b", full_ai_text, re.IGNORECASE):
                target_mentioned_in_ai_text = True
                # Extract sentence mentioning the brand
                sentences = re.split(r"[.!?]\s+", full_ai_text)
                for s in sentences:
                    if re.search(r"\b" + re.escape(token) + r"\b", s, re.IGNORECASE):
                        ai_matching_snippets.append(s.strip())

    # 3. Competitors Landscape (Top 5)
    top_competitors = []
    for item in organic_results[:5]:
        c_url = item.get("link") or item.get("url") or ""
        c_domain = extract_domain(c_url)
        top_competitors.append({
            "rank": item.get("position"),
            "domain": c_domain,
            "title": item.get("title", ""),
            "url": c_url
        })

    # 4. Search Intent Analysis
    intent_data = detect_search_intent(keyword, organic_results)

    # 5. SERP Features Presence
    answer_box = serp_data.get("answer_box", {})
    knowledge_graph = serp_data.get("knowledge_graph", {})
    related_questions = serp_data.get("related_questions", [])

    return {
        "keyword": keyword,
        "target_domain": target_domain,
        "target_query": target_domain_or_url,
        "rank": matched_rank,
        "rank_display": f"#{matched_rank}" if matched_rank <= 100 else "101 (Not in Top 100)",
        "match_type": match_type,
        "matched_url": matched_url,
        "matched_title": matched_title,
        "matched_snippet": matched_snippet,
        "search_intent": intent_data["primary_intent"],
        "intent_breakdown": intent_data["scores"],
        # AI Overview metrics
        "has_ai_overview": has_ai_overview,
        "ai_overview_cited_target": target_in_ai_sources,
        "ai_overview_source_position": target_ai_source_position,
        "ai_overview_mentions_brand": target_mentioned_in_ai_text,
        "ai_overview_text_snippets": ai_text_blocks[:3],
        "ai_overview_brand_mentions": ai_matching_snippets[:2],
        "ai_sources_count": len(ai_sources),
        "ai_sources": ai_sources[:5],
        # SERP Features
        "has_featured_snippet": bool(answer_box),
        "has_knowledge_graph": bool(knowledge_graph),
        "paa_questions_count": len(related_questions),
        "paa_questions": [q.get("question") for q in related_questions[:3]],
        "top_competitors": top_competitors,
        "total_organic_fetched": len(organic_results),
    }


# ── Report Display Formatter ─────────────────────────────────────────────────

def print_rank_report(res: Dict[str, Any]) -> None:
    """Print an aesthetically structured SERP & AI Overview report."""
    print("\n" + "=" * 70)
    print(f"       SERP & AI OVERVIEW RANK REPORT: '{res['keyword']}'")
    print("=" * 70)

    print(f"Target Queried       : {res['target_query']}")
    print(f"Target Domain        : {res['target_domain']}")
    print(f"Search Intent        : {res['search_intent']} (Scores: {res['intent_breakdown']})")
    print(f"Organic Rank         : {res['rank_display']}")
    print(f"Match Type           : {res['match_type']}")
    if res['matched_url']:
        print(f"Matched Ranking URL  : {res['matched_url']}")
        print(f"Ranking Title        : {res['matched_title']}")

    print("-" * 70)
    print(" [AI OVERVIEW / GENERATIVE AI MODE]")
    if res["has_ai_overview"]:
        print("  Status             : ACTIVE on Google SERP")
        print(f"  Target In Sources  : {'YES (Cited at #' + str(res['ai_overview_source_position']) + ')' if res['ai_overview_cited_target'] else 'NO'}")
        print(f"  Brand Mentioned    : {'YES' if res['ai_overview_mentions_brand'] else 'NO'}")
        if res["ai_overview_brand_mentions"]:
            print(f"  Brand Context      : \"{res['ai_overview_brand_mentions'][0]}\"")
        if res["ai_sources"]:
            print("  Top Cited Sources  :")
            for s in res["ai_sources"]:
                marker = " [TARGET]" if s['domain'] == res['target_domain'] else ""
                print(f"    - #{s['position']} {s['domain']}: {s['title'][:50]}...{marker}")
    else:
        print("  Status             : No AI Overview triggered for this query.")

    print("-" * 70)
    print(" [SERP FEATURES]")
    print(f"  Featured Snippet   : {'YES' if res['has_featured_snippet'] else 'NO'}")
    print(f"  Knowledge Graph    : {'YES' if res['has_knowledge_graph'] else 'NO'}")
    print(f"  PAA Questions      : {res['paa_questions_count']} found")
    if res["paa_questions"]:
        for q in res["paa_questions"]:
            print(f"    • {q}")

    print("-" * 70)
    print(" [TOP 5 ORGANIC COMPETITORS]")
    for comp in res["top_competitors"]:
        marker = " ⭐️ [OUR SITE]" if comp['domain'] == res['target_domain'] else ""
        print(f"  Rank #{comp['rank']:<2} | {comp['domain']:<28} | {comp['title'][:35]}...{marker}")

    print("=" * 70 + "\n")


# ── Batch Processor ──────────────────────────────────────────────────────────

def process_single_keyword(kw: str, domain: str, country: str, api_key: str) -> Dict[str, Any]:
    """Helper for concurrent execution in batch runs."""
    try:
        raw_data = fetch_serpapi_data(kw, country=country, api_key=api_key)
        return analyze_serp_for_target(raw_data, kw, domain)
    except Exception as e:
        return {
            "keyword": kw,
            "target_domain": extract_domain(domain),
            "target_query": domain,
            "rank": NOT_FOUND_RANK,
            "rank_display": "Error",
            "match_type": "error",
            "matched_url": None,
            "search_intent": "Unknown",
            "has_ai_overview": False,
            "ai_overview_cited_target": False,
            "ai_overview_mentions_brand": False,
            "error": str(e),
            "top_competitors": []
        }


def run_batch_check(
    input_file: str,
    domain: str,
    output_file: Optional[str] = None,
    country: str = "in",
    api_key: Optional[str] = None,
    max_workers: int = 4
) -> List[Dict[str, Any]]:
    """Process a batch of keywords from a CSV file."""
    if not os.path.exists(input_file):
        raise FileNotFoundError(f"Input file '{input_file}' not found.")

    keywords = []
    with open(input_file, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        kw_col = 0
        if header:
            for idx, col in enumerate(header):
                if col.lower() in ["keyword", "keywords", "query", "search term"]:
                    kw_col = idx
                    break
            else:
                keywords.append(header[0].strip())

        for row in reader:
            if row and len(row) > kw_col and row[kw_col].strip():
                keywords.append(row[kw_col].strip())

    if not keywords:
        print("[!] No keywords found in input file.")
        return []

    print(f"Starting batch rank check for {len(keywords)} keywords against target '{domain}'...")
    results = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(process_single_keyword, kw, domain, country, api_key): kw
            for kw in keywords
        }
        for fut in as_completed(futures):
            kw = futures[fut]
            try:
                res = fut.result()
                results.append(res)
                print(f"  ✓ [{res['rank_display']}] {kw} | Intent: {res.get('search_intent')} | AI Overview: {'YES' if res.get('has_ai_overview') else 'NO'}")
            except Exception as e:
                print(f"  ✗ Error on '{kw}': {e}")

    # Export to CSV if output path is specified
    if output_file:
        fieldnames = [
            "Keyword", "Target Domain", "Organic Rank", "Match Type", "Matched URL",
            "Search Intent", "AI Overview Active", "Target In AI Overview Sources",
            "Brand In AI Overview Text", "Featured Snippet Present", "Top 1 Competitor"
        ]
        with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(fieldnames)
            for r in results:
                top1_comp = r["top_competitors"][0]["domain"] if r.get("top_competitors") else "N/A"
                writer.writerow([
                    r.get("keyword"),
                    r.get("target_domain"),
                    r.get("rank"),
                    r.get("match_type"),
                    r.get("matched_url") or "",
                    r.get("search_intent"),
                    "YES" if r.get("has_ai_overview") else "NO",
                    "YES" if r.get("ai_overview_cited_target") else "NO",
                    "YES" if r.get("ai_overview_mentions_brand") else "NO",
                    "YES" if r.get("has_featured_snippet") else "NO",
                    top1_comp
                ])
        print(f"\n[✓] Results successfully exported to: {output_file}")

    return results


# ── Main Entrypoint ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Google Search, AI Overview & Intent Rank Checker via SerpApi"
    )
    parser.add_argument("-k", "--keyword", type=str, default="which are the top 10 international schools in india",
                        help="Keyword to check (default: 'which are the top 10 international schools in india')")
    parser.add_argument("-d", "--domain", type=str, default="euroschoolindia.com",
                        help="Target domain or specific URL (default: 'euroschoolindia.com')")
    parser.add_argument("-c", "--country", type=str, default="in",
                        help="Google search country code gl (e.g. 'in', 'us', 'uk', default: 'in')")
    parser.add_argument("--api-key", type=str, default=None,
                        help="SerpApi API Key (overrides SERPAPI_API_KEY environment variable)")
    parser.add_argument("-i", "--input", type=str, default=None,
                        help="Input CSV file containing keywords for batch checking")
    parser.add_argument("-o", "--output", type=str, default=None,
                        help="Output CSV file for saving batch results")
    parser.add_argument("--workers", type=int, default=4,
                        help="Number of concurrent workers for batch check (default: 4)")
    parser.add_argument("--json", action="store_true",
                        help="Print raw JSON response instead of human-readable report")

    parser.add_argument("--demo", action="store_true",
                        help="Run with demo mock SerpApi response for instant testing without API key")

    args = parser.parse_args()

    # Demo / Simulation Mode
    if args.demo:
        print("\n[★] Running in DEMO / SIMULATION mode with sample SerpApi Google & AI Overview payload...\n")
        sample_serp = {
            "search_parameters": {"q": args.keyword, "engine": "google", "gl": args.country},
            "ai_overview": {
                "overview": "India is home to top-ranking international schools offering IB, IGCSE, and CBSE curricula.",
                "text_blocks": [
                    {"snippet": "Top international schools include Dhirubhai Ambani International School, The Doon School, and EuroSchool India campuses."},
                    {"snippet": "EuroSchool India provides globally aligned experiential learning across major metro cities."}
                ],
                "sources": [
                    {"title": "Best International Schools in India - EducationWorld", "link": "https://www.educationworld.in/schools", "source": "EducationWorld"},
                    {"title": "EuroSchool India - Admissions & Campuses", "link": "https://www.euroschoolindia.com/schools", "source": "EuroSchool India"},
                    {"title": "Top 10 IB Schools in India", "link": "https://www.thelearningpoint.net/ib-schools", "source": "The Learning Point"}
                ]
            },
            "answer_box": {
                "type": "organic_result",
                "title": "Top International Schools in India List",
                "snippet": "Dhirubhai Ambani, EuroSchool, Woodstock School..."
            },
            "organic_results": [
                {"position": 1, "title": "Top 10 International Schools in India - Rankings 2026", "link": "https://www.educationworld.in/top-schools", "snippet": "Detailed rankings of international schools across India."},
                {"position": 2, "title": "Best International Schools in India - EuroSchool", "link": "https://www.euroschoolindia.com/schools/top-international-schools-in-india", "snippet": "Discover EuroSchool India's world-class international curriculum and modern campus facilities."},
                {"position": 3, "title": "International Baccalaureate Schools in India", "link": "https://www.ibo.org/programmes/find-an-ib-school", "snippet": "Official list of IB World Schools located in India."},
                {"position": 4, "title": "Best CBSE & IGCSE International Schools", "link": "https://www.schooldekho.org/best-schools", "snippet": "Compare top school fees, infrastructure, and board affiliations."},
                {"position": 5, "title": "Top Schools in Bangalore & Mumbai", "link": "https://www.indiatoday.in/education-today/top-schools", "snippet": "Annual school ranking survey and awards."}
            ],
            "related_questions": [
                {"question": "Which is the #1 international school in India?"},
                {"question": "What is the fee structure for international schools in India?"},
                {"question": "Is IB or IGCSE better in India?"}
            ]
        }
        analysis = analyze_serp_for_target(sample_serp, args.keyword, args.domain)
        if args.json:
            print(json.dumps(analysis, indent=2))
        else:
            print_rank_report(analysis)
        return

    # Batch mode
    if args.input:
        run_batch_check(
            input_file=args.input,
            domain=args.domain,
            output_file=args.output,
            country=args.country,
            api_key=args.api_key,
            max_workers=args.workers
        )
        return

    # Single keyword mode
    print(f"\n[+] Fetching Google Search & AI Overview via SerpApi for:")
    print(f"    Keyword: \"{args.keyword}\"")
    print(f"    Domain : \"{args.domain}\"")
    print(f"    Country: \"{args.country}\"")

    try:
        serp_data = fetch_serpapi_data(
            keyword=args.keyword,
            country=args.country,
            api_key=args.api_key
        )
        analysis = analyze_serp_for_target(serp_data, args.keyword, args.domain)

        if args.json:
            print(json.dumps(analysis, indent=2))
        else:
            print_rank_report(analysis)

    except Exception as exc:
        print(f"\n[ERROR] Rank check failed: {exc}")
        if "SERPAPI_API_KEY is not configured" in str(exc):
            print("\nTip: Add SERPAPI_API_KEY=your_key_here to backend/.env or pass --api-key <key>")
        sys.exit(1)


if __name__ == "__main__":
    main()
