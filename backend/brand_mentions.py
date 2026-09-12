"""
brand_mentions.py -- "Brand Mentions" off-page activity.

Triggered from calendar_backend.py's AI-scheduling endpoint
(analyze_potential_endpoint / POST /calendar/analyze-potential), once per
keyword that passed the hard gate (Landing Page + rank >= 5).

Per keyword:
  1. FETCH -- hits Bright Data LIVE for the top BRAND_MENTION_TOP_N (10)
     organic results, via services.rank_checker.get_top_n_organic_results()
     -- the EXACT SAME SERP fetch rank-checking itself uses (same Bright
     Data key/zone, same display_link parsing). This is a real, fresh live
     search call per keyword (not free, not instant) -- no more relying on
     rank_meta.top_links being already populated from a prior rank-check.

  2. CLASSIFY -- every fetched URL is scraped (via the Competitors tab's
     scrape_website() helper) and sent through ONE dedicated OpenAI call
     (_classify_as_listing() below) that answers a single yes/no question:
     is this a LISTING/DIRECTORY/AGGREGATOR page (a page that lists many
     businesses/schools for a visitor to browse or submit to), or not. This
     is a separate, dedicated prompt/function from
     services.competitor_classifier.classify_url() -- that shared function
     only distinguishes "Official Entity" vs "Platform" (used by the
     Competitors tab) and its DB cache is keyed by URL only, so reusing it
     here would both misclassify (no "Listing" concept) and pollute its
     cache with a different classification question. No caching here (yet)
     -- every fetched URL gets a fresh OpenAI call per run.

  NOTE: matching against this project's outreach_sites inventory (DA/SS/
  Shortlisted-status gating) has been REMOVED for now, per explicit
  instruction -- every URL that classifies as a listing-type page is kept,
  whether or not it's already in your outreach table.

Two results land on every keyword dict:
  - `brand_mention_sites` (plural)  = every URL FETCHED from Bright Data for
    that keyword (up to 10) -- the raw audit trail, before classification.
  - `brand_mention_site`  (singular name, but holds a LIST)  = the subset
    classified "Listing" -- these are what the Brand Mentions column shows.
"""

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from services.rank_checker import get_top_n_organic_results
from services.category_checker import resolve_country_code

# Real live Bright Data SERP hit per keyword -- top 10 organic results (one
# SERP page, no pagination needed).
BRAND_MENTION_TOP_N = 10

# Classification (BeautifulSoup scrape + 1 OpenAI call) runs on every fetched
# URL now (no outreach-table pre-filter to shrink the pool), so keep the
# per-keyword worker pool modest.
BRAND_MENTION_WORKERS = 5

_LISTING_SYSTEM_PROMPT = """You are analyzing a webpage's scraped metadata to decide if it is a \
LISTING / DIRECTORY / AGGREGATOR page.

A LISTING page displays or compares MULTIPLE businesses, schools, products, or service \
providers for a visitor to browse, compare, or submit their own business to -- examples: \
Justdial, Sulekha, a school-directory site, a "Top 10 schools in <city>" roundup/aggregator \
page, Yellow-Pages-style pages, review-aggregator pages listing many providers.

It is NOT a listing page if it is:
- A single business/organization's own official website (even if it has multiple pages)
- A blog article or news article (even if it mentions multiple businesses in passing)
- A government or educational-board page
- A generic search engine or social media page

Respond ONLY in valid raw JSON with exact keys: 'website_type' ('Listing' or 'Not Listing')."""

_LISTING_MODEL = os.getenv("OPENAI_CHAT_MODEL") or "gpt-4o-mini"
_LISTING_MODEL_FALLBACKS = ["gpt-4o-mini", "gpt-4o"]


def _classify_as_listing(url: str, session) -> Dict[str, str]:
    """Scrapes `url` and asks OpenAI whether it's a Listing/Directory page.
    Returns {"url", "website_type"} where website_type is "Listing" or
    "Not Listing". On total OpenAI failure (e.g. no credits), returns
    "Not Listing" so the URL is simply excluded rather than the whole batch
    erroring out."""
    from openai import OpenAI
    from services.competitor_classifier import scrape_website

    page = scrape_website(session, url)
    user_prompt = f"""Extracted Website Data:
- Target URL: {page.get('original_url')}
- Domain: {page.get('domain')}
- Page Title: {page.get('title')}
- Meta Description: {page.get('description')}
- Meta Keywords: {page.get('keywords')}
- Page Text Content: {page.get('text_snippet')}
"""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not configured.")
    client = OpenAI(api_key=api_key)

    candidate_models = [_LISTING_MODEL] + [m for m in _LISTING_MODEL_FALLBACKS if m != _LISTING_MODEL]
    for model in candidate_models:
        for attempt in range(2):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": _LISTING_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.1,
                    response_format={"type": "json_object"},
                )
                parsed = json.loads(response.choices[0].message.content.strip())
                w_type = "Listing" if "listing" in str(parsed.get("website_type", "")).strip().lower() else "Not Listing"
                return {"url": url, "website_type": w_type}
            except Exception as e:
                print(f"[BrandMentions] classify_as_listing error (model: {model}, attempt {attempt + 1}) for {url!r}: {e}", file=sys.stderr, flush=True)
                time.sleep(1.5)

    return {"url": url, "website_type": "Not Listing"}


def _domain_only(url_or_host: str) -> str:
    """Strip scheme/path/query/port and a leading 'www.' -- DOMAIN ONLY."""
    if not url_or_host:
        return ""
    s = str(url_or_host).strip()
    if not s:
        return ""
    if "://" not in s:
        s = "https://" + s
    try:
        netloc = urlparse(s).netloc.lower()
    except Exception:
        return ""
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc.split(":")[0].strip()


def find_brand_mention_matches(keyword: str, client_domain: Optional[str] = None,
                                country: Optional[str] = None) -> Tuple[List[Dict[str, str]], List[Dict[str, Any]]]:
    """
    Returns:
      fetched -- every URL Bright Data returned for `keyword` (up to
                 BRAND_MENTION_TOP_N), as [{"domain", "url"}].
      listing -- the subset classify_url() labels specifically "Listing"
                 (not "Platform" or "Official Entity"), as
                 [{"domain", "url", "website_type"}]. NOT matched against
                 outreach_sites -- that step is removed for now.
    """
    # Bright Data's `gl` parameter needs a 2-letter ISO code (e.g. "in"), not
    # a full country name -- `country` here is typically "India" (whatever
    # the project's target_regions/payload.country says), so resolve it.
    gl = resolve_country_code(country) or "in"
    results = get_top_n_organic_results(keyword, n=BRAND_MENTION_TOP_N, country_code=gl) or []
    client_d = _domain_only(client_domain) if client_domain else ""

    fetched, seen = [], set()
    for r in results:
        url = r.get("url") if isinstance(r, dict) else None
        d = (r.get("domain") if isinstance(r, dict) else None) or _domain_only(url)
        if not url or not d or d == client_d or d in seen:
            continue
        seen.add(d)
        fetched.append({"domain": d, "url": url})

    if not fetched:
        return fetched, []

    # Classify every fetched URL via the dedicated Listing/Not-Listing OpenAI
    # call (see _classify_as_listing() above).
    from services.competitor_classifier import create_http_session
    session = create_http_session()
    listing = []
    try:
        for f in fetched:
            try:
                result = _classify_as_listing(f["url"], session)
            except Exception as e:
                print(f"[BrandMentions] classify_as_listing failed for {f['url']!r}: {e}", file=sys.stderr, flush=True)
                continue
            if str(result.get("website_type") or "").strip().lower() == "listing":
                listing.append({
                    "domain": f["domain"],
                    "url": f["url"],
                    "website_type": result.get("website_type"),
                })
    finally:
        session.close()

    return fetched, listing


def assign_brand_mentions_to_keywords(keywords: List[Dict[str, Any]],
                                       client_domain: Optional[str] = None,
                                       country: Optional[str] = None) -> List[Dict[str, Any]]:
    """Attaches to EVERY keyword dict passed in:
      - `brand_mention_sites`: every URL Bright Data fetched for that
        keyword -- the raw audit trail.
      - `brand_mention_site`: the URLs classified as listing-type pages.
    Returns NEW dicts (does not mutate the input list). Each keyword
    triggers one live Bright Data SERP call plus one classify_url() call per
    fetched URL (cached on repeat domains)."""
    out = [dict(k) for k in (keywords or [])]

    with ThreadPoolExecutor(max_workers=BRAND_MENTION_WORKERS) as pool:
        futures = {}
        for item in out:
            kw = str(item.get("keyword") or "").strip()
            if not kw:
                item["brand_mention_sites"] = []
                item["brand_mention_site"] = []
                continue
            futures[pool.submit(find_brand_mention_matches, kw, client_domain, country)] = item

        for fut in as_completed(futures):
            item = futures[fut]
            try:
                fetched, listing = fut.result()
            except Exception as e:
                print(f"[BrandMentions] match failed for {item.get('keyword')!r}: {e}", file=sys.stderr, flush=True)
                fetched, listing = [], []
            item["brand_mention_sites"] = fetched
            item["brand_mention_site"] = listing

    return out


def assign_and_summarize_brand_mentions(
    keywords: List[Dict[str, Any]],
    client_domain: Optional[str] = None,
    country: Optional[str] = None,
    budget_ceiling: Optional[float] = None,
    requested_quantity: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Brand-Mentions-only counterpart of calendar_backend.py's
    assign_outreach_sites_to_keywords() -- used when EVERY activity in the
    batch is 'Brand Mentions', so the Paid-Guest-Post outreach-site
    assignment step is skipped entirely (no `outreach_site` gets attached).
    Normalizes landing-page fields, attaches brand_mention_sites/brand_mention_site
    per keyword, and returns a budget_summary in the SAME shape the frontend's
    Executive Allocation card already renders -- just narrated for Brand
    Mentions instead of Paid Guest Post outreach-site language."""
    normalized = []
    for kw in (keywords or []):
        item = dict(kw)
        lp = kw.get("landing_page_url") or kw.get("topicLink") or kw.get("topic_link") or ""
        item["landing_page_url"] = lp
        item["topicLink"] = lp
        item["topic_link"] = lp
        item["outreach_site"] = None
        normalized.append(item)

    assigned = assign_brand_mentions_to_keywords(normalized, client_domain=client_domain, country=country)

    total_kws = len(assigned)
    listing_kws = [k for k in assigned if k.get("brand_mention_site")]
    listing_count = len(listing_kws)
    fetched_total = sum(len(k.get("brand_mention_sites") or []) for k in assigned)
    req_qty = requested_quantity or max(1, total_kws)
    budget_cap = float(budget_ceiling) if (budget_ceiling and float(budget_ceiling) > 0) else 0.0

    general_strategy_summary = (
        f"Live-searched Google for {total_kws} candidate keyword(s) ({fetched_total} organic URLs fetched in "
        f"total, top {BRAND_MENTION_TOP_N} per keyword). {listing_count} keyword(s) had at least one result "
        f"classified as a listing/directory-type page (not your client's own site)."
    )
    keyword_exclusion_summary = (
        f"All {total_kws} candidate keywords had at least one listing-type page found."
        if listing_count >= total_kws and total_kws > 0 else
        f"{total_kws - listing_count} keyword(s) had no fetched result that classified as a listing/directory page."
    )
    budget_allocation_advisory = (
        f"Brand Mentions batch: {listing_count} of {total_kws} keyword(s) found a listing-type page in the "
        f"live top {BRAND_MENTION_TOP_N}. Not matched against your outreach inventory -- that gating is removed "
        f"for now. No Paid Guest Post outreach-site budget allocation applies to this activity."
    )
    domain_constraints_alert = (
        "Brand Mentions matching does not apply the Paid Guest Post 3-to-4 domain reuse limit -- each "
        "keyword's listing pages are found independently via a live search."
    )

    budget_summary = {
        "requested_quantity": req_qty,
        "requested_activities": req_qty,
        "recommended_quantity": listing_count,
        "recommended_activities": listing_count,
        "redundant_posts_saved": max(0, total_kws - listing_count),
        "budget_cap": round(budget_cap, 2),
        "total_budget_cap": round(budget_cap, 2),
        "planned_spend": 0.0,
        "projected_savings": round(budget_cap, 2),
        "avg_cost_per_post": 0.0,
        "general_strategy_summary": general_strategy_summary,
        "keyword_exclusion_summary": keyword_exclusion_summary,
        "budget_allocation_advisory": budget_allocation_advisory,
        "domain_constraints_alert": domain_constraints_alert,
        "anti_waste_advisory": budget_allocation_advisory,
        "analysis_narrative": general_strategy_summary,
        "target_country": country or "India",
        "target_industry": None,
        "top_da_range": "n/a (outreach matching removed)",
        "spam_score_range": "n/a (outreach matching removed)",
    }
    return assigned, budget_summary
