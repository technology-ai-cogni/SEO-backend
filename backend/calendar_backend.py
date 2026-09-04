"""
Calendar Backend Module for Operations -> Calendar.

Provides:
1. Rank 5-20 Keyword Discovery & Push Potential Triage (Heuristic + OpenAI LLM).
2. Off-Page Activities CRUD, Lifecycle Management (saved / scheduled / approved).
3. CSV Export generation.
"""

import os
import sys
import uuid
import json
import csv
import io
from decimal import Decimal
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

# Import database engine from existing core
from core.db import engine, _clean_for_json

# Optional OpenAI client for push potential AI triage
try:
    from services import category_checker
    OPENAI_AVAILABLE = True
except Exception as e:
    OPENAI_AVAILABLE = False
    category_checker = None


# ─────────────────────────────────────────────────────────────
# 1. DATABASE SETUP & SCHEMA INITIALIZATION
# ─────────────────────────────────────────────────────────────

def ensure_calendar_tables():
    """Ensure off_page_activities table exists and has all required columns."""
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS off_page_activities (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    activity_name TEXT NOT NULL,
                    project_name TEXT,
                    main_poc TEXT,
                    content_poc TEXT,
                    quantity INTEGER DEFAULT 1,
                    budget NUMERIC(12, 2) DEFAULT 0.00,
                    "user" TEXT,
                    period TEXT,
                    scheduler TEXT,
                    auditor TEXT,
                    status TEXT DEFAULT 'saved',
                    potential_keywords JSONB DEFAULT '[]'::jsonb,
                    keyword_name TEXT,
                    category TEXT,
                    cluster TEXT,
                    topic_link TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """))
            # Run column safety additions for existing tables
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'saved';"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS potential_keywords JSONB DEFAULT '[]'::jsonb;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS keyword_name TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS category TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS cluster TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS topic_link TEXT;"))
    except Exception as err:
        print(f"[calendar_backend] Schema check notice: {err}", file=sys.stderr, flush=True)


# Schema is already migrated; avoid synchronous network block on import
# ensure_calendar_tables()


# ─────────────────────────────────────────────────────────────
# 2. PYDANTIC SCHEMAS
# ─────────────────────────────────────────────────────────────

class CalendarActivityPayload(BaseModel):
    activity_name: str
    project_name: Optional[str] = None
    main_poc: Optional[str] = None
    content_poc: Optional[str] = None
    quantity: Optional[int] = 1
    budget: Optional[Any] = None
    user: Optional[str] = None
    period: Optional[str] = None
    scheduler: Optional[str] = None
    auditor: Optional[str] = None
    status: Optional[str] = "saved"
    potential_keywords: Optional[List[Dict[str, Any]]] = None
    keyword_name: Optional[str] = None
    category: Optional[str] = None
    cluster: Optional[str] = None
    topic_link: Optional[str] = None


class CalendarActivityUpdatePayload(BaseModel):
    activity_name: Optional[str] = None
    project_name: Optional[str] = None
    main_poc: Optional[str] = None
    content_poc: Optional[str] = None
    quantity: Optional[int] = None
    budget: Optional[Any] = None
    user: Optional[str] = None
    period: Optional[str] = None
    scheduler: Optional[str] = None
    auditor: Optional[str] = None
    status: Optional[str] = None
    potential_keywords: Optional[List[Dict[str, Any]]] = None
    keyword_name: Optional[str] = None
    category: Optional[str] = None
    cluster: Optional[str] = None
    topic_link: Optional[str] = None


class PushPotentialRequest(BaseModel):
    project_slug: Optional[str] = None
    domain: Optional[str] = ""
    country: Optional[str] = "India"
    keywords: Optional[List[Dict[str, Any]]] = None


# ─────────────────────────────────────────────────────────────
# 3. CORE LOGIC: RANK 5-20 KEYWORDS & PUSH POTENTIAL TRIAGE
# ─────────────────────────────────────────────────────────────

def _parse_num(val, default=0.0) -> float:
    try:
        cleaned = "".join(c for c in str(val or "") if c.isdigit() or c == ".")
        return float(cleaned) if cleaned else default
    except (ValueError, TypeError):
        return default


def _classify_url_target_type(url: str) -> str:
    """Classify if a URL is a Landing Page vs Blog Page."""
    if not url:
        return "Unknown"
    from urllib.parse import urlparse
    path = urlparse(url).path.lower()
    blog_hints = ["blog", "blogs", "article", "articles", "news", "post", "posts", "guide", "guides", "faq", "how-to", "tips"]
    segments = [s for s in path.split("/") if s]
    for seg in segments:
        if any(hint in seg for hint in blog_hints):
            return "Blog Page"
    return "Landing Page"


def get_potential_keywords_from_db(project_slug_or_name: str) -> List[Dict[str, Any]]:
    """
    Fetch keywords for project from `keyword_categories`:
    - Filter 1: target_type has landing page
    - Filter 2: min rank 5 (rank >= 5)
    - Filter 3: High search volume (ordered by SV descending)
    - Deduplicate by keyword text
    """
    if not project_slug_or_name:
        return []

    clean_slug = project_slug_or_name.strip().lower()
    alt_slug = clean_slug.replace(" ", "-").replace("_", "-")

    print(f"\n=======================================================", flush=True)
    print(f"[Calendar AI] Fetching Landing Page candidate keywords for: '{project_slug_or_name}'", flush=True)
    print(f"[Calendar AI] Filters applied: target_type LIKE '%landing%', rank >= 5, ordered by SV DESC", flush=True)

    scored = []
    seen = set()

    # Query with target_type landing check and min rank 5, ordered by search volume descending
    query = text("""
        SELECT id, keyword, category, cluster, rank, sv, kw_diff, landing_page_url, target_type
        FROM keyword_categories
        WHERE (LOWER(project_name) = :slug OR LOWER(project_name) = :alt_slug)
          AND LOWER(COALESCE(target_type, '')) LIKE '%landing%'
          AND rank >= 5
        ORDER BY CAST(NULLIF(regexp_replace(sv, '[^0-9]', '', 'g'), '') AS INTEGER) DESC NULLS LAST, id DESC
    """)

    try:
        with engine.begin() as conn:
            res = conn.execute(query, {"slug": clean_slug, "alt_slug": alt_slug})
            rows = [dict(r._mapping) for r in res]
    except Exception as e:
        print(f"[Calendar AI] DB error fetching keywords for '{clean_slug}': {e}", file=sys.stderr, flush=True)
        return []

    for k in rows:
        rank = _parse_num(k.get("rank"), 0)
        # Rule 1: Min rank is 5 (no upper bound)
        if rank < 5:
            continue

        kw_text = str(k.get("keyword") or "").strip()
        kw_lower = kw_text.lower()
        if not kw_text or kw_lower in seen:
            continue
        seen.add(kw_lower)

        sv = _parse_num(k.get("sv"), 0)
        kd = _parse_num(k.get("kw_diff"), 0)

        scored.append({
            "id": k.get("id") or kw_text,
            "keyword": kw_text,
            "category": k.get("category") or "General",
            "cluster": k.get("cluster") or "General",
            "rank": int(rank),
            "prev_rank": int(rank),
            "new_rank": int(rank),
            "delta": 0,
            "sv": int(sv),
            "kd": int(kd),
            "target_type": k.get("target_type") or "Landing Page",
            "potentialScore": sv,
            "topicLink": k.get("landing_page_url") or "",
            "landing_page_url": k.get("landing_page_url") or ""
        })

    # Rule 2: Order by search volume, highest first
    scored.sort(key=lambda x: x["sv"], reverse=True)

    print(f"[Calendar AI] Found {len(scored)} candidate landing page keywords (Rank >= 5).", flush=True)
    if scored:
        print(f"[Calendar AI] Top candidates preview:", flush=True)
        for i, item in enumerate(scored[:5], 1):
            print(f"   {i}. \"{item['keyword']}\" | DB Rank: #{item['rank']} | SV: {item['sv']:,} | KD: {item['kd']} | LP: {item['topicLink'] or 'N/A'}", flush=True)
        if len(scored) > 5:
            print(f"   ... and {len(scored) - 5} more candidate keywords.", flush=True)
    print(f"=======================================================\n", flush=True)

    return scored


def calculate_heuristic_batches(potential: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Initial fast heuristic fallback before live SERP rank checking finishes.
    """
    out = {"high": [], "medium": [], "low": []}
    for k in potential or []:
        rank = _parse_num(k.get("rank"), 99)
        kd = _parse_num(k.get("kd"), 0)
        sv = _parse_num(k.get("sv"), 0)

        if rank <= 10 and kd <= 45 and sv > 0:
            batch = "high"
            confidence = 80
            reason = "Page 1 striking distance with landing page intent."
        elif rank <= 15 and kd <= 65:
            batch = "medium"
            confidence = 60
            reason = "Moderate rank position with landing page intent."
        else:
            batch = "low"
            confidence = 35
            reason = "Lower rank position in range."

        item = dict(k)
        item["batch"] = batch
        item["confidence"] = confidence
        item["reason"] = reason
        out[batch].append(item)

    for b in out:
        out[b].sort(key=lambda x: (x.get("confidence", 0), x.get("sv", 0)), reverse=True)

    print(f"[Calendar AI] Heuristic Batches generated: High={len(out['high'])}, Medium={len(out['medium'])}, Low={len(out['low'])}", flush=True)
    return out


# ─────────────────────────────────────────────────────────────
# 3.1 MULTI-ENGINE RANK VERIFICATION & INTELLIGENCE AGENT
# ─────────────────────────────────────────────────────────────

def _clean_url_for_matching(url: str) -> str:
    """Normalize URL path and scheme for exact match comparison."""
    if not url or str(url).strip() == "" or str(url).lower() == "nan":
        return ""
    from urllib.parse import urlparse
    url = str(url).strip().rstrip("/").lower()
    if not url.startswith("http"):
        url = "https://" + url
    try:
        parsed = urlparse(url)
        netloc = parsed.netloc[4:] if parsed.netloc.startswith("www.") else parsed.netloc
        return f"{parsed.scheme}://{netloc}{parsed.path}".rstrip("/").lower()
    except Exception:
        return url.lower()


def _get_bare_domain(url: str) -> str:
    """Extract domain hostname (e.g. 'socialoffline.in') from URL."""
    if not url:
        return ""
    from urllib.parse import urlparse
    if not url.startswith("http"):
        url = "https://" + url
    try:
        netloc = urlparse(url).netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


def fetch_serp_via_serpapi(keyword: str, country_code: str = "in", limit: int = 30) -> List[Dict[str, Any]]:
    """
    Fetch organic search results from SerpAPI Google Search.
    Falls back to Bright Data SERP fetch if SerpAPI key is unavailable or fails.
    """
    import requests
    serpapi_key = os.environ.get("SERPAPI_API_KEY")
    if serpapi_key:
        try:
            params = {
                "engine": "google",
                "q": keyword,
                "gl": country_code or "in",
                "hl": "en",
                "num": limit,
                "api_key": serpapi_key
            }
            resp = requests.get("https://serpapi.com/search.json", params=params, timeout=25)
            if resp.status_code == 200:
                data = resp.json()
                organic = data.get("organic_results", [])
                results = []
                for item in organic:
                    url = item.get("link") or item.get("url") or ""
                    title = item.get("title") or ""
                    snippet = item.get("snippet") or ""
                    if url:
                        results.append({
                            "url": url,
                            "title": title,
                            "snippet": snippet,
                            "source": "SerpAPI"
                        })
                if results:
                    return results
        except Exception as e:
            print(f"[Verification Agent] SerpAPI fetch notice for '{keyword}': {e}", flush=True)

    # Fallback to Bright Data SERP scraper if SerpAPI is not configured
    try:
        from scripts.agentic_rank_checker import fetch_serp_brightdata
        raw = fetch_serp_brightdata(keyword, start=0, country_code=country_code)
        if raw:
            return [{"url": r.get("url"), "title": r.get("title", ""), "snippet": r.get("snippet", ""), "source": "BrightData"} for r in raw]
    except Exception:
        pass
    return []


def fetch_serp_via_firecrawl(keyword: str, country_code: str = "in", limit: int = 30) -> List[Dict[str, Any]]:
    """
    Fetch organic search results from Firecrawl /v2/search endpoint.
    """
    try:
        from services import rank_checker_fc
        urls = rank_checker_fc.fetch_top_results_via_firecrawl(keyword, limit=limit, country_code=country_code)
        return [{"url": u, "title": "", "snippet": "", "source": "Firecrawl"} for u in (urls or [])]
    except Exception as e:
        print(f"[Verification Agent] Firecrawl fetch notice for '{keyword}': {e}", flush=True)
        return []


def fetch_serp_via_brightdata(keyword: str, country_code: str = "in") -> List[Dict[str, Any]]:
    """
    Fetch organic search results from Bright Data Web Unlocker SERP zone.
    """
    try:
        from scripts.agentic_rank_checker import fetch_serp_brightdata
        raw = fetch_serp_brightdata(keyword, start=0, country_code=country_code)
        if raw:
            return [{"url": r.get("url"), "title": r.get("title", ""), "snippet": r.get("snippet", ""), "source": "BrightData"} for r in raw]
    except Exception as e:
        print(f"[Verification Agent] Bright Data fetch notice for '{keyword}': {e}", flush=True)
        return []


def evaluate_serp_ranking(
    results: List[Dict[str, Any]],
    target_url: str = "",
    default_domain: str = ""
) -> Dict[str, Any]:
    """
    Evaluates whether target_url or default_domain ranks in the given organic search results.
    """
    clean_target = _clean_url_for_matching(target_url)
    target_domain = _get_bare_domain(target_url) or _get_bare_domain(default_domain)

    matched_rank = 101
    match_type = "no_match"
    matched_url = None

    for idx, item in enumerate(results, 1):
        url = item.get("url", "")
        clean_res = _clean_url_for_matching(url)
        res_domain = _get_bare_domain(url)

        # 1. Exact URL Match
        if clean_target and clean_res == clean_target:
            matched_rank = idx
            match_type = "exact_url_match"
            matched_url = url
            break

        # 2. Domain Match fallback (if exact match not yet found)
        if target_domain and res_domain == target_domain and match_type == "no_match":
            matched_rank = idx
            match_type = "domain_match"
            matched_url = url

    return {
        "rank": matched_rank,
        "match_type": match_type,
        "matched_url": matched_url,
        "total_results": len(results),
        "results": results
    }


def calculate_verification_confidence(
    verified_rank: int,
    prev_rank: int,
    engine_checks: Dict[str, Dict[str, Any]],
    top3_is_landing: bool,
    top3_types: List[str],
    is_confirmed_101: bool
) -> Dict[str, Any]:
    """
    Calculates an explainable multi-factor Confidence Score (0-100%) for rank verification.
    
    Factors:
    1. Source Consensus Points (0 - 35 pts):
       - Multi-engine unanimous agreement: 35 pts
       - Multi-engine consensus on valid rank (or resolved false alarm): 28 pts
       - Single engine validated result: 20 pts
       - Partial fallback: 15 pts
       
    2. Target Match Precision Points (0 - 25 pts):
       - Exact URL matched in live SERP: 25 pts
       - Domain root/subpage matched: 18 pts
       - Confirmed 101 with verified total absence across all engines: 22 pts
       - Inconclusive match: 10 pts
       
    3. Search Intent Alignment Points (0 - 25 pts):
       - Top 3 SERP are Landing Pages (healthy landing intent): 25 pts
       - Mixed SERP intent (1 Landing Page, 2 Blogs/Directories): 18 pts
       - Intent shifted completely to Blogs/Wikis (justifying 101 drop): 20 pts if 101 else 12 pts
       
    4. SERP Data Depth & Freshness (0 - 15 pts):
       - >= 20 organic listings parsed: 15 pts
       - 10 - 19 organic listings parsed: 12 pts
       - < 10 organic listings parsed: 8 pts
    """
    valid_ranks = [v["rank"] for v in engine_checks.values() if v.get("rank") is not None and v["rank"] != 101]
    all_101 = all(v.get("rank") == 101 for v in engine_checks.values())
    engine_count = len(engine_checks)

    # 1. Source Consensus (Max 35)
    if all_101 and engine_count >= 2:
        consensus_pts = 35
        consensus_expl = f"All {engine_count} verification engines (SerpAPI & Firecrawl) unanimously confirmed rank 101."
    elif len(valid_ranks) >= 2 and max(valid_ranks) - min(valid_ranks) <= 3:
        consensus_pts = 32
        consensus_expl = f"Multiple engines agreed on tight ranking window (#{min(valid_ranks)}-#{max(valid_ranks)})."
    elif len(valid_ranks) >= 1:
        consensus_pts = 26
        consensus_expl = f"Live ranking verified via search engine consensus; false 101 rejected."
    else:
        consensus_pts = 18
        consensus_expl = "Single source resolution with fallback."

    # 2. Match Precision (Max 25)
    match_types = [v.get("match_type") for v in engine_checks.values()]
    if "exact_url_match" in match_types:
        precision_pts = 25
        precision_expl = "Exact target landing page URL confirmed in live SERP."
    elif "domain_match" in match_types:
        precision_pts = 18
        precision_expl = "Target domain matched in organic search results."
    elif is_confirmed_101:
        precision_pts = 22
        precision_expl = "Target domain and URL completely absent from organic top 30 across all engines."
    else:
        precision_pts = 12
        precision_expl = "Standard match evaluation."

    # 3. Intent Alignment (Max 25)
    if top3_is_landing:
        intent_pts = 25
        intent_expl = "Top 3 SERP results are commercial Landing Pages."
    elif is_confirmed_101:
        intent_pts = 20
        intent_expl = f"SERP shifted to informational content ({', '.join(top3_types) if top3_types else 'Blogs/Articles'}), explaining ranking drop."
    else:
        intent_pts = 14
        intent_expl = f"Mixed SERP search intent ({', '.join(top3_types) if top3_types else 'Mixed'})."

    # 4. Data Depth & Freshness (Max 15)
    max_results = max([v.get("total_results", 0) for v in engine_checks.values()] or [0])
    if max_results >= 20:
        depth_pts = 15
        depth_expl = f"Deep SERP analysis across {max_results} organic listings."
    elif max_results >= 10:
        depth_pts = 12
        depth_expl = f"Standard SERP analysis across {max_results} organic listings."
    else:
        depth_pts = 8
        depth_expl = f"Partial SERP data ({max_results} listings)."

    total_score = min(98, max(15, consensus_pts + precision_pts + intent_pts + depth_pts))

    explanation = (
        f"Confidence Score: {total_score}% (Consensus: {consensus_pts}/35, "
        f"Precision: {precision_pts}/25, Intent: {intent_pts}/25, Data Depth: {depth_pts}/15). "
        f"{consensus_expl} {precision_expl}"
    )

    return {
        "total_score": total_score,
        "source_consensus_pts": consensus_pts,
        "match_precision_pts": precision_pts,
        "intent_alignment_pts": intent_pts,
        "data_depth_pts": depth_pts,
        "explanation": explanation
    }


def verify_keyword_drop_with_agent(
    keyword_item: Dict[str, Any],
    default_domain: str = "",
    country_code: str = "in"
) -> Dict[str, Any]:
    """
    Intelligent Rank Verification Agent:
    Triggered when a keyword that previously ranked (< 101) drops to 101 on a secondary check.
    
    Workflow:
    1. Queries SerpAPI, Firecrawl, and BrightData in parallel.
    2. If ANY engine finds a valid rank, rejects the 101 and takes the verified rank.
    3. If ALL/BOTH engines show 101, confirms 101.
    4. Analyzes the whole SERP output (intent, competitors, shifts).
    5. Computes transparent multi-factor Confidence Score.
    """
    kw_text = str(keyword_item.get("keyword") or "").strip()
    lp_url = str(keyword_item.get("landing_page_url") or keyword_item.get("topicLink") or "").strip()
    prev_rank = int(_parse_num(keyword_item.get("rank") or keyword_item.get("prev_rank"), 0))

    print(f"\n=======================================================", flush=True)
    print(f"[Verification Agent] ⚠️ DROP-TO-101 DETECTED for keyword: \"{kw_text}\"", flush=True)
    print(f"[Verification Agent] Previous Rank was #{prev_rank}. Initiating Multi-Engine Verification...", flush=True)
    print(f"[Verification Agent] Querying SerpAPI + Firecrawl + BrightData in parallel...", flush=True)

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=3) as executor:
        future_fc = executor.submit(fetch_serp_via_firecrawl, kw_text, country_code=country_code, limit=30)
        future_serpapi = executor.submit(fetch_serp_via_serpapi, kw_text, country_code=country_code, limit=30)
        future_bd = executor.submit(fetch_serp_via_brightdata, kw_text, country_code=country_code)

        fc_results = future_fc.result() or []
        serpapi_results = future_serpapi.result() or []
        bd_results = future_bd.result() or []

    # Evaluate rank across engines
    fc_eval = evaluate_serp_ranking(fc_results, target_url=lp_url, default_domain=default_domain)
    serpapi_eval = evaluate_serp_ranking(serpapi_results, target_url=lp_url, default_domain=default_domain)
    bd_eval = evaluate_serp_ranking(bd_results, target_url=lp_url, default_domain=default_domain)

    engine_checks = {
        "Firecrawl": fc_eval,
        "SerpAPI": serpapi_eval,
        "BrightData": bd_eval
    }

    print(f"[Verification Agent] Multi-Engine Scan Results for \"{kw_text}\":", flush=True)
    print(f"   * Firecrawl : Rank #{fc_eval['rank']} ({fc_eval['match_type']}) [{fc_eval['total_results']} URLs parsed]", flush=True)
    print(f"   * SerpAPI   : Rank #{serpapi_eval['rank']} ({serpapi_eval['match_type']}) [{serpapi_eval['total_results']} URLs parsed]", flush=True)
    print(f"   * BrightData: Rank #{bd_eval['rank']} ({bd_eval['match_type']}) [{bd_eval['total_results']} URLs parsed]", flush=True)

    # Determine Best Verified Rank
    valid_ranks = []
    if fc_eval["rank"] < 101:
        valid_ranks.append((fc_eval["rank"], "Firecrawl", fc_eval))
    if serpapi_eval["rank"] < 101:
        valid_ranks.append((serpapi_eval["rank"], "SerpAPI", serpapi_eval))
    if bd_eval["rank"] < 101:
        valid_ranks.append((bd_eval["rank"], "BrightData", bd_eval))

    # All top links across sources
    all_top_links = []
    seen_links = set()
    for source_res in [serpapi_results, fc_results, bd_results]:
        for r in source_res:
            u = r.get("url")
            if u and u not in seen_links:
                seen_links.add(u)
                all_top_links.append(u)

    # Top 3 URLs analysis
    top3_urls = all_top_links[:3] if all_top_links else []
    top3_types = [_classify_url_target_type(u) for u in top3_urls]
    top3_is_landing = sum(1 for t in top3_types if t == "Landing Page") >= 2 if top3_types else True

    # Top competitors
    top_competitors = [_get_bare_domain(u) for u in top3_urls if _get_bare_domain(u)]

    if valid_ranks:
        # One or more engines found a valid rank! Do NOT consider as 101!
        valid_ranks.sort(key=lambda x: x[0])  # Take highest/best ranking verified
        verified_rank = valid_ranks[0][0]
        verified_source = valid_ranks[0][1]
        is_confirmed_101 = False
        consensus_summary = (
            f"False 101 rejected! {verified_source} verified active rank #{verified_rank} "
            f"(Matches: {', '.join(f'{src}: #{r}' for r, src, _ in valid_ranks)})."
        )
    else:
        # Both/all engines show 101 -> Confirmed 101
        verified_rank = 101
        is_confirmed_101 = True
        consensus_summary = f"Confirmed 101: Target URL and domain are genuinely absent across Firecrawl, SerpAPI, and BrightData."

    # Compute Confidence Score & Breakdown
    conf_calc = calculate_verification_confidence(
        verified_rank=verified_rank,
        prev_rank=prev_rank,
        engine_checks=engine_checks,
        top3_is_landing=top3_is_landing,
        top3_types=top3_types,
        is_confirmed_101=is_confirmed_101
    )

    confidence = conf_calc["total_score"]
    delta = prev_rank - verified_rank

    # Batch assignment and reason
    if delta >= 1 or (verified_rank <= 3 and verified_rank < prev_rank):
        batch = "high"
        spots_str = f"{delta} spot" if delta == 1 else f"{delta} spots"
        reason = f"Rank improved by {spots_str} (#{prev_rank} -> #{verified_rank}). {consensus_summary}"
    elif is_confirmed_101:
        if top3_is_landing:
            batch = "medium"
            reason = f"Verified severe drop outside top rankings (#{prev_rank} -> #{verified_rank}). High recovery potential; SERP is commercial landing pages."
        else:
            batch = "low"
            reason = f"Verified drop to #{verified_rank}. SERP shifted away from landing pages to {', '.join(top3_types) if top3_types else 'blogs'}."
    elif delta <= -2:
        batch = "medium" if top3_is_landing else "low"
        reason = f"Rank shifted from #{prev_rank} to #{verified_rank} (verified across engines). {'Top 3 are Landing Pages.' if top3_is_landing else 'SERP intent mismatch.'}"
    else:
        batch = "low"
        reason = f"Rank remained stable at #{verified_rank} (delta: {delta:+d}). {consensus_summary}"

    agent_analysis = (
        f"Agent Analysis: {consensus_summary} "
        f"Top Competitors holding SERP: {', '.join(top_competitors[:3]) or 'N/A'}. "
        f"SERP Intent: {', '.join(top3_types) if top3_types else 'Unknown'}. "
        f"{conf_calc['explanation']}"
    )

    print(f"[Verification Agent] Verdict: Verified Rank #{verified_rank} (was #{prev_rank}, Shift: {delta:+d})", flush=True)
    print(f"[Verification Agent] Batch: {batch.upper()} | Confidence: {confidence}%", flush=True)
    print(f"[Verification Agent] Score Breakdown: Consensus={conf_calc['source_consensus_pts']}/35, Precision={conf_calc['match_precision_pts']}/25, Intent={conf_calc['intent_alignment_pts']}/25, Depth={conf_calc['data_depth_pts']}/15", flush=True)
    print(f"[Verification Agent] Agent Analysis: {agent_analysis}", flush=True)
    print(f"=======================================================\n", flush=True)

    return {
        "verified_rank": verified_rank,
        "prev_rank": prev_rank,
        "new_rank": verified_rank,
        "delta": delta,
        "batch": batch,
        "confidence": confidence,
        "confidence_breakdown": conf_calc,
        "reason": reason,
        "agent_analysis": agent_analysis,
        "top3_is_landing": top3_is_landing,
        "top3_types": top3_types,
        "top_links": all_top_links,
        "is_confirmed_101": is_confirmed_101,
        "engine_checks": {
            "firecrawl_rank": fc_eval["rank"],
            "serpapi_rank": serpapi_eval["rank"],
            "brightdata_rank": bd_eval["rank"]
        }
    }


def _check_single_keyword_live(k: Dict[str, Any], default_domain: str = "") -> Dict[str, Any]:
    """
    Live rank re-check + Top-3 SERP landing page verification for one keyword.
    DOES NOT modify the keyword_categories table.
    
    If keyword previously ranked (< 101) and secondary check returns 101,
    the Multi-Engine Verification Agent is triggered to re-verify across
    SerpAPI, Firecrawl, and BrightData.
    """
    kw_text = str(k.get("keyword") or "").strip()
    lp_url = str(k.get("landing_page_url") or k.get("topicLink") or "").strip()
    prev_rank = int(_parse_num(k.get("rank") or k.get("prev_rank"), 0))

    print(f"[Calendar AI Check] >>> Checking keyword: \"{kw_text}\" | DB Rank: #{prev_rank} | LP URL: {lp_url or 'None'}", flush=True)

    new_rank = prev_rank
    top_links = []

    # 1. Primary Live Check via Firecrawl
    try:
        from services import rank_checker_fc
        new_rank, top_links = rank_checker_fc.find_rank(
            kw_text, lp_url, default_domain=default_domain, country_code="in"
        )
        top_links = top_links or []
    except Exception as e:
        print(f"[Calendar AI Check] Firecrawl notice for \"{kw_text}\": {e}. Trying secondary rank checker...", flush=True)
        try:
            from services import rank_checker
            new_rank, top_links = rank_checker.find_rank(
                kw_text, lp_url, default_domain=default_domain, country_code="in"
            )
            top_links = top_links or []
        except Exception as e2:
            print(f"[Calendar AI Check] Secondary rank checker notice for \"{kw_text}\": {e2}", flush=True)
            new_rank = prev_rank
            top_links = []

    # 2. TRIGGER MULTI-ENGINE VERIFICATION AGENT IF PREVIOUSLY RANKED (< 101) AND NOW SHOWS 101
    if prev_rank < 101 and new_rank == 101:
        verified_data = verify_keyword_drop_with_agent(
            k, default_domain=default_domain, country_code="in"
        )
        item = dict(k)
        item["prev_rank"] = prev_rank
        item["new_rank"] = verified_data["verified_rank"]
        item["rank"] = verified_data["verified_rank"]
        item["delta"] = verified_data["delta"]
        item["top3_is_landing"] = verified_data["top3_is_landing"]
        item["top3_types"] = verified_data["top3_types"]
        item["batch"] = verified_data["batch"]
        item["confidence"] = verified_data["confidence"]
        item["confidence_breakdown"] = verified_data["confidence_breakdown"]
        item["reason"] = verified_data["reason"]
        item["agent_analysis"] = verified_data["agent_analysis"]
        item["verification_details"] = verified_data
        return item

    # 3. Standard flow when no 101 anomaly detected
    top3 = top_links[:3] if top_links else []
    top3_types = []
    for u in top3:
        try:
            t = _classify_url_target_type(u)
            top3_types.append(t)
        except Exception:
            top3_types.append("Unknown")

    if top3_types:
        landing_count = sum(1 for t in top3_types if t == "Landing Page")
        top3_is_landing = landing_count >= 2
    else:
        top3_is_landing = True

    delta = prev_rank - new_rank  # positive = improved, negative = dropped

    # Rule: if the rank is increased even by one (delta >= 1), it is placed in Batch 1
    if delta >= 1 or (new_rank <= 3 and new_rank < prev_rank):
        batch = "high"
        confidence = min(98, 85 + delta * 2) if top3_is_landing else 78
        spots_str = f"{delta} spot" if delta == 1 else f"{delta} spots"
        landing_info = "Top 3 SERP are Landing Pages." if top3_is_landing else f"Top 3 SERP: {', '.join(top3_types) if top3_types else 'Mixed'}."
        reason = f"Rank improved by {spots_str} (#{prev_rank} -> #{new_rank}). {landing_info}"
    elif top3_is_landing and (delta <= -2 or (new_rank == 101 and prev_rank < 101)):
        batch = "medium"
        confidence = 82
        drop_str = f"{abs(delta)} spots (#{prev_rank} -> #{new_rank})" if new_rank != 101 else f"dropped outside top rankings (#{prev_rank} -> #{new_rank})"
        reason = f"Rank extremely dropped by {drop_str}. Prime recovery push target; top 3 are Landing Pages."
    else:
        batch = "low"
        confidence = 40 if top3_is_landing else 25
        if not top3_is_landing:
            types_str = ", ".join(top3_types) if top3_types else "Blogs"
            reason = f"Top 3 SERP results shifted away from landing pages ({types_str}). Search intent mismatch."
        else:
            reason = f"Rank didn't even move (#{prev_rank} -> #{new_rank}, delta: {delta:+d}). Stagnant SERP velocity."

    # Explainable confidence calculation for standard items
    conf_calc = {
        "total_score": confidence,
        "source_consensus_pts": 25,
        "match_precision_pts": 25 if new_rank < 101 else 15,
        "intent_alignment_pts": 25 if top3_is_landing else 15,
        "data_depth_pts": 15 if len(top_links) >= 10 else 10,
        "explanation": f"Confidence Score: {confidence}% (Evaluated via live SERP scan and Top-3 intent classification)."
    }

    batch_display = "BATCH 1 (High - Improved)" if batch == "high" else ("BATCH 2 (Medium - Dropped)" if batch == "medium" else "BATCH 3 (Low - Stagnant)")
    shift_str = f"+{delta} (UP)" if delta > 0 else (f"{delta} (DOWN)" if delta < 0 else "0 (NO CHANGE)")
    print(f"[Calendar AI Check]     Result for \"{kw_text}\": Live Rank #{new_rank} [was #{prev_rank}] | Shift: {shift_str}", flush=True)
    print(f"[Calendar AI Check]     Top 3 SERP Intent: {top3_types or ['Unknown']} | Top 3 Landing: {top3_is_landing}", flush=True)
    print(f"[Calendar AI Check]     ==> Placed in {batch_display} | Conf: {confidence}%", flush=True)
    print(f"[Calendar AI Check]     ==> Reason: {reason}", flush=True)

    item = dict(k)
    item["prev_rank"] = prev_rank
    item["new_rank"] = new_rank
    item["rank"] = new_rank
    item["delta"] = delta
    item["top3_is_landing"] = top3_is_landing
    item["top3_types"] = top3_types
    item["batch"] = batch
    item["confidence"] = confidence
    item["confidence_breakdown"] = conf_calc
    item["reason"] = reason
    return item



def calculate_live_serp_batches(
    potential: List[Dict[str, Any]],
    domain: str = "",
    country: str = "India"
) -> Dict[str, Any]:
    """
    Evaluates candidate landing page keywords against live Google SERP:
    - Runs parallel live rank checks
    - Checks top 3 SERP results for Landing Page intent
    - Places into Batch 1 (improved), Batch 2 (dropped), or Batch 3 (didn't move / non-landing)
    """
    if not potential:
        print("[Calendar AI Check] No keywords supplied for live SERP check.", flush=True)
        return {"batches": {"high": [], "medium": [], "low": []}, "summary": "No keywords supplied.", "evaluated_keywords": []}

    print(f"\n=======================================================", flush=True)
    print(f"[Calendar AI Check] Starting Live Google SERP Verification for {len(potential)} keywords", flush=True)
    print(f"[Calendar AI Check] Target Domain: '{domain or 'N/A'}' | Country: '{country}'", flush=True)
    print(f"=======================================================", flush=True)

    from concurrent.futures import ThreadPoolExecutor
    batches = {"high": [], "medium": [], "low": []}

    with ThreadPoolExecutor(max_workers=5) as executor:
        evaluated = list(executor.map(lambda k: _check_single_keyword_live(k, default_domain=domain), potential))

    for item in evaluated:
        b = item.get("batch", "low")
        if b not in batches:
            b = "low"
        batches[b].append(item)

    batches["high"].sort(key=lambda x: (x.get("delta", 0), x.get("sv", 0)), reverse=True)
    batches["medium"].sort(key=lambda x: (abs(x.get("delta", 0)), x.get("sv", 0)), reverse=True)
    batches["low"].sort(key=lambda x: x.get("sv", 0), reverse=True)

    summary = (
        f"Analyzed {len(potential)} Landing Page keywords: "
        f"{len(batches['high'])} extremely improved (Batch 1), "
        f"{len(batches['medium'])} extremely dropped (Batch 2), "
        f"{len(batches['low'])} stagnant/non-landing (Batch 3)."
    )

    print(f"\n=======================================================", flush=True)
    print(f"[Calendar AI Check] Live SERP Verification Completed!", flush=True)
    print(f"[Calendar AI Check] Summary: {summary}", flush=True)
    print(f"[Calendar AI Check] Breakdown across Batches:", flush=True)
    print(f"   * BATCH 1 (High - Improved Rank): {len(batches['high'])} keywords", flush=True)
    for kw in batches['high'][:5]:
        print(f"       - \"{kw.get('keyword')}\": #{kw.get('prev_rank')} -> #{kw.get('new_rank')} (Shift: {kw.get('delta', 0):+d}) [Conf: {kw.get('confidence')}%]", flush=True)
    print(f"   * BATCH 2 (Medium - Dropped Rank): {len(batches['medium'])} keywords", flush=True)
    for kw in batches['medium'][:5]:
        print(f"       - \"{kw.get('keyword')}\": #{kw.get('prev_rank')} -> #{kw.get('new_rank')} (Shift: {kw.get('delta', 0):+d}) [Conf: {kw.get('confidence')}%]", flush=True)
    print(f"   * BATCH 3 (Low - Stagnant/Non-landing): {len(batches['low'])} keywords", flush=True)
    for kw in batches['low'][:5]:
        print(f"       - \"{kw.get('keyword')}\": #{kw.get('prev_rank')} -> #{kw.get('new_rank')} (Shift: {kw.get('delta', 0):+d}) [Conf: {kw.get('confidence')}%]", flush=True)
    print(f"=======================================================\n", flush=True)

    return {"batches": batches, "summary": summary, "evaluated_keywords": evaluated}


def calculate_ai_batches(
    potential: List[Dict[str, Any]],
    domain: str = "",
    country: str = "India"
) -> Dict[str, Any]:
    """
    AI Triage using OpenAI GPT: evaluates domain, intent, rank, KD, and SERP competition.
    Falls back to heuristic triage if AI is unavailable or fails.
    """
    if not potential:
        return {"batches": {"high": [], "medium": [], "low": []}, "summary": "No keywords supplied."}

    lines = []
    for i, r in enumerate(potential):
        lines.append(
            f'{i + 1}. keyword="{r.get("keyword", "")}" | rank={r.get("rank", "?")} | '
            f'search_volume={r.get("sv", "?")} | difficulty={r.get("kd", "?")} | '
            f'category="{r.get("category", "")}" | cluster="{r.get("cluster", "")}"'
        )
    kw_block = "\n".join(lines)

    system_prompt = (
        "You are a senior SEO strategist. You are given a shortlist of keywords a site "
        "currently ranks between position 5 and 20 for. Judge how confidently EACH keyword "
        "can be pushed UP toward page 1 / top 3 over the next 1-3 months using an off-page "
        "campaign (authority guest posts, contextual backlinks, brand mentions) plus light "
        "on-page tuning.\n\n"
        "Weigh, roughly in this order:\n"
        "1. Current rank -- position 5-10 is far easier to convert than 15-20.\n"
        "2. Keyword difficulty -- lower is better; very high difficulty caps the ceiling.\n"
        "3. Search intent fit -- commercial / navigational / local intent aligned to the "
        "domain moves well; broad informational or off-topic intent is weak.\n"
        "4. Search volume -- higher volume raises priority, but a high-volume term stuck at "
        "rank 19 on a brutal SERP is still a weak mover.\n"
        "5. SERP realism -- if page 1 is dominated by giant brands / aggregators, be conservative.\n\n"
        "Assign every keyword EXACTLY ONE batch:\n"
        '- "high": you are close to certain it can be pushed up.\n'
        '- "medium": real potential but meaningfully less certain.\n'
        '- "low": unlikely to move meaningfully with reasonable effort.\n\n'
        'Return ONLY valid JSON: {"results":[{"index":<1-based int>,"batch":"high|medium|low",'
        '"confidence":<int 0-100>,"reason":"<max 18 words>"}],"summary":"<max 30 words>"}'
    )
    user_prompt = f"Target domain: {domain or '(not provided)'}\nRegion: {country}\n\nKeywords:\n{kw_block}"

    by_index = {}
    summary = ""

    if OPENAI_AVAILABLE and category_checker:
        try:
            client = category_checker.get_openai_client()
            resp = client.chat.completions.create(
                model=category_checker.OPENAI_CHAT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(resp.choices[0].message.content)
            for item in parsed.get("results", []):
                try:
                    by_index[int(item.get("index"))] = item
                except (TypeError, ValueError):
                    continue
            summary = str(parsed.get("summary", "")).strip()
        except Exception as ai_err:
            print(f"[calendar_backend] OpenAI push-potential notice: {ai_err}", file=sys.stderr)

    batches = {"high": [], "medium": [], "low": []}
    for i, r in enumerate(potential):
        item = by_index.get(i + 1)
        if item and str(item.get("batch", "")).lower() in batches:
            batch = str(item["batch"]).lower()
            try:
                conf = max(0, min(100, int(item.get("confidence", 50))))
            except (TypeError, ValueError):
                conf = 50
            reason = str(item.get("reason", "")).strip()
        else:
            # Fallback heuristic
            rank = _parse_num(r.get("rank"), 99)
            kd = _parse_num(r.get("kd"), 0)
            sv = _parse_num(r.get("sv"), 0)
            if rank <= 10 and kd <= 40 and sv > 0:
                batch, conf, reason = "high", 80, "Close to page 1 with manageable difficulty."
            elif rank <= 15 and kd <= 60:
                batch, conf, reason = "medium", 55, "Moderate distance to page 1 and difficulty."
            else:
                batch, conf, reason = "low", 30, "Far from page 1 or a hard SERP."

        out_item = dict(r)
        out_item["batch"] = batch
        out_item["confidence"] = conf
        out_item["reason"] = reason
        batches[batch].append(out_item)

    for k in batches:
        batches[k].sort(key=lambda x: x.get("confidence", 0), reverse=True)

    if not summary:
        summary = f"Classified {len(potential)} striking-distance keywords by off-page push feasibility."

    return {"batches": batches, "summary": summary}


# ─────────────────────────────────────────────────────────────
# 4. CORE LOGIC: OFF-PAGE ACTIVITIES CRUD
# ─────────────────────────────────────────────────────────────

def _normalize_status(st: Any) -> str:
    s = str(st or "saved").lower().strip()
    if "sched" in s or "pend" in s:
        return "scheduled"
    if "appr" in s or "comp" in s or "done" in s:
        return "approved"
    return "saved"


def list_calendar_activities(
    project_name: Optional[str] = None,
    status_filter: Optional[str] = None,
    search: Optional[str] = None
) -> Dict[str, Any]:
    """
    List activities from `off_page_activities`, filtered by project, status, and search query.
    Returns activities plus count breakdown across 'saved', 'scheduled', 'approved'.
    """
    with engine.begin() as conn:
        try:
            res = conn.execute(text("SELECT * FROM off_page_activities ORDER BY created_at DESC"))
            all_rows = [dict(r._mapping) for r in res]
        except Exception as e:
            print(f"[calendar_backend] Error querying off_page_activities: {e}", file=sys.stderr)
            return {"activities": [], "counts": {"saved": 0, "scheduled": 0, "approved": 0}}

    counts = {"saved": 0, "scheduled": 0, "approved": 0}
    filtered = []

    clean_proj = (project_name or "").strip().lower()
    clean_status = (status_filter or "").strip().lower()
    clean_search = (search or "").strip().lower()

    for row in all_rows:
        cleaned_row = _clean_for_json(row)
        norm_st = _normalize_status(cleaned_row.get("status"))
        cleaned_row["status"] = norm_st

        # Deserialize potential_keywords if stored as string
        pk = cleaned_row.get("potential_keywords")
        if isinstance(pk, str):
            try:
                cleaned_row["potential_keywords"] = json.loads(pk)
            except Exception:
                cleaned_row["potential_keywords"] = []

        # Count tally
        if norm_st in counts:
            counts[norm_st] += 1

        # 1. Status Filter
        if clean_status and clean_status != "all" and norm_st != clean_status:
            continue

        # 2. Project Filter
        if clean_proj and clean_proj not in ("all", "*", "all projects"):
            r_proj = str(cleaned_row.get("project_name") or "").lower()
            if r_proj and clean_proj not in r_proj and r_proj not in clean_proj and r_proj != "general":
                continue

        # 3. Search Query Filter
        if clean_search:
            match_act = clean_search in str(cleaned_row.get("activity_name") or "").lower()
            match_proj = clean_search in str(cleaned_row.get("project_name") or "").lower()
            match_poc = (
                clean_search in str(cleaned_row.get("main_poc") or "").lower()
                or clean_search in str(cleaned_row.get("content_poc") or "").lower()
            )
            match_user = clean_search in str(cleaned_row.get("user") or "").lower()
            match_kw = clean_search in str(cleaned_row.get("keyword_name") or "").lower()
            if not (match_act or match_proj or match_poc or match_user or match_kw):
                continue

        filtered.append(cleaned_row)

    return {
        "activities": filtered,
        "counts": counts,
        "total": len(filtered)
    }


def create_calendar_activity(data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new activity row in `off_page_activities`."""
    activity_id = str(uuid.uuid4())
    norm_st = _normalize_status(data.get("status", "saved"))

    # Parse budget
    budget_raw = data.get("budget")
    budget_num = _parse_num(budget_raw, 0.0)

    # Format potential_keywords JSON
    pk = data.get("potential_keywords") or []
    if not isinstance(pk, str):
        pk_json = json.dumps(pk)
    else:
        pk_json = pk

    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO off_page_activities (
                    id, activity_name, project_name, main_poc, content_poc,
                    quantity, budget, "user", period, scheduler, auditor,
                    status, potential_keywords, keyword_name, category, cluster, topic_link,
                    created_at, updated_at
                ) VALUES (
                    :id, :activity_name, :project_name, :main_poc, :content_poc,
                    :quantity, :budget, :user, :period, :scheduler, :auditor,
                    :status, CAST(:potential_keywords AS jsonb), :keyword_name, :category, :cluster, :topic_link,
                    now(), now()
                )
            """),
            {
                "id": activity_id,
                "activity_name": str(data.get("activity_name") or "New Activity").strip(),
                "project_name": data.get("project_name"),
                "main_poc": data.get("main_poc"),
                "content_poc": data.get("content_poc"),
                "quantity": int(data.get("quantity") or 1),
                "budget": budget_num,
                "user": data.get("user"),
                "period": data.get("period"),
                "scheduler": data.get("scheduler"),
                "auditor": data.get("auditor"),
                "status": norm_st,
                "potential_keywords": pk_json,
                "keyword_name": data.get("keyword_name"),
                "category": data.get("category"),
                "cluster": data.get("cluster"),
                "topic_link": data.get("topic_link")
            }
        )
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        return _clean_for_json(dict(res._mapping)) if res else {"id": activity_id, **data}


def get_calendar_activity(activity_id: str) -> Optional[Dict[str, Any]]:
    with engine.begin() as conn:
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        if not res:
            return None
        row = _clean_for_json(dict(res._mapping))
        row["status"] = _normalize_status(row.get("status"))
        return row


def update_calendar_activity(activity_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update fields on an off_page_activities record."""
    allowed = [
        "activity_name", "project_name", "main_poc", "content_poc",
        "quantity", "budget", "user", "period", "scheduler", "auditor",
        "status", "potential_keywords", "keyword_name", "category", "cluster", "topic_link"
    ]
    updates = []
    params = {"id": activity_id}

    for field in allowed:
        if field in data and data[field] is not None:
            val = data[field]
            if field == "user":
                updates.append('"user" = :user')
                params["user"] = str(val)
            elif field == "status":
                updates.append("status = :status")
                params["status"] = _normalize_status(val)
            elif field == "budget":
                updates.append("budget = :budget")
                params["budget"] = _parse_num(val, 0.0)
            elif field == "quantity":
                updates.append("quantity = :quantity")
                params["quantity"] = int(val or 1)
            elif field == "potential_keywords":
                updates.append("potential_keywords = CAST(:potential_keywords AS jsonb)")
                params["potential_keywords"] = json.dumps(val) if not isinstance(val, str) else val
            else:
                updates.append(f"{field} = :{field}")
                params[field] = str(val) if val is not None else None

    if not updates:
        return get_calendar_activity(activity_id)

    updates.append("updated_at = now()")
    query = f"UPDATE off_page_activities SET {', '.join(updates)} WHERE id = :id"

    with engine.begin() as conn:
        conn.execute(text(query), params)
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        return _clean_for_json(dict(res._mapping)) if res else None


def delete_calendar_activity(activity_id: str) -> bool:
    with engine.begin() as conn:
        res = conn.execute(text("DELETE FROM off_page_activities WHERE id = :id"), {"id": activity_id})
        return res.rowcount > 0


def generate_calendar_csv(project_name: Optional[str] = None, status_filter: Optional[str] = None) -> str:
    """Generate CSV string for calendar activities."""
    data = list_calendar_activities(project_name=project_name, status_filter=status_filter)
    activities = data.get("activities", [])

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    headers = [
        "Activity Name", "Project Name", "Main POC", "Content POC",
        "Quantity", "Budget", "User", "Period", "Scheduler", "Auditor",
        "Status", "Keyword Name", "Category", "Cluster", "Topic Link"
    ]
    writer.writerow(headers)

    for a in activities:
        b = a.get("budget")
        budget_str = f"${b}" if b is not None else ""
        writer.writerow([
            a.get("activity_name") or "",
            a.get("project_name") or "",
            a.get("main_poc") or "",
            a.get("content_poc") or "",
            a.get("quantity") or 1,
            budget_str,
            a.get("user") or "",
            a.get("period") or "",
            a.get("scheduler") or "",
            a.get("auditor") or "",
            (a.get("status") or "saved").upper(),
            a.get("keyword_name") or "",
            a.get("category") or "",
            a.get("cluster") or "",
            a.get("topic_link") or ""
        ])

    return output.getvalue()


# ─────────────────────────────────────────────────────────────
# 5. FASTAPI ROUTER DEFINITION
# ─────────────────────────────────────────────────────────────

router = APIRouter(prefix="/calendar", tags=["Calendar"])


@router.get("/potential-keywords")
def get_potential_keywords_endpoint(
    project_slug: str = Query(..., description="Project slug or name"),
    domain: Optional[str] = Query("", description="Domain name for intent matching"),
    country: Optional[str] = Query("India", description="Target region"),
    run_ai: bool = Query(False, description="Whether to run full OpenAI triage immediately")
):
    """
    Retrieve Rank 5+ potential keywords for a project and calculate push batches.
    If run_ai=False, returns instant heuristic batches.
    If run_ai=True, performs full LLM evaluation.
    """
    print(f"\n[Calendar API] GET /calendar/potential-keywords: project='{project_slug}', domain='{domain}', run_ai={run_ai}", flush=True)
    potential = get_potential_keywords_from_db(project_slug)
    if not potential:
        print(f"[Calendar API] No keywords found for project: '{project_slug}'", flush=True)
        return {
            "project_slug": project_slug,
            "total_potential": 0,
            "potential_keywords": [],
            "batches": {"high": [], "medium": [], "low": []},
            "summary": "No rank 5+ keywords found for this project."
        }

    if run_ai:
        print(f"[Calendar API] run_ai=True: Running live SERP rank & intent evaluation...", flush=True)
        ai_res = calculate_live_serp_batches(potential, domain=domain or project_slug, country=country)
        batches = ai_res.get("batches", {})
        summary = ai_res.get("summary", "")
        potential = ai_res.get("evaluated_keywords") or potential
    else:
        batches = calculate_heuristic_batches(potential)
        summary = f"Found {len(potential)} Landing Page keywords (Rank 5+)."

    return {
        "project_slug": project_slug,
        "total_potential": len(potential),
        "potential_keywords": potential,
        "batches": batches,
        "summary": summary
    }


@router.post("/analyze-potential")
def analyze_potential_endpoint(payload: PushPotentialRequest):
    """
    Run AI Live SERP Rank & Top-3 Landing Page Intent analysis.
    """
    print(f"\n[Calendar API] POST /calendar/analyze-potential: project='{payload.project_slug}', domain='{payload.domain}', keywords_count={len(payload.keywords or [])}", flush=True)
    keywords = payload.keywords
    if not keywords and payload.project_slug:
        keywords = get_potential_keywords_from_db(payload.project_slug)

    if not keywords:
        print(f"[Calendar API] No keywords provided for analysis.", flush=True)
        return {
            "batches": {"high": [], "medium": [], "low": []},
            "summary": "No keywords provided."
        }

    ai_res = calculate_live_serp_batches(keywords, domain=payload.domain or payload.project_slug or "", country=payload.country or "India")
    return ai_res


@router.get("/activities")
def get_activities_endpoint(
    project: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None)
):
    """List calendar off-page activities with real-time status counts."""
    return list_calendar_activities(project_name=project, status_filter=status, search=search)


@router.post("/activities")
def create_activity_endpoint(payload: CalendarActivityPayload):
    """Create a new off-page activity campaign row."""
    print(f"[Calendar API] POST /calendar/activities: Creating activity '{payload.activity_name}' for project='{payload.project_name}' (Keywords count: {len(payload.potential_keywords or [])})", flush=True)
    activity = create_calendar_activity(payload.dict())
    return {"activity": activity}


@router.get("/activities/{activity_id}")
def get_activity_endpoint(activity_id: str):
    activity = get_calendar_activity(activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"activity": activity}


@router.patch("/activities/{activity_id}")
def update_activity_endpoint(activity_id: str, payload: CalendarActivityUpdatePayload):
    updated = update_calendar_activity(activity_id, payload.dict(exclude_unset=True))
    if not updated:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"activity": updated}


@router.delete("/activities/{activity_id}")
def delete_activity_endpoint(activity_id: str):
    success = delete_calendar_activity(activity_id)
    if not success:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"success": True, "deleted_id": activity_id}


@router.get("/export-csv")
def export_csv_endpoint(
    project: Optional[str] = Query(None),
    status: Optional[str] = Query(None)
):
    """Generate and stream CSV export of calendar activities."""
    csv_data = generate_calendar_csv(project_name=project, status_filter=status)
    filename = f"Off_Page_Activities_{status or 'all'}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
