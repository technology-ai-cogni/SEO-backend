"""
brand_mentions.py -- "Brand Mentions" off-page activity.

Triggered from calendar_backend.py's AI-scheduling endpoint
(analyze_potential_endpoint / POST /calendar/analyze-potential), once per
keyword that passed the hard gate (Landing Page + rank >= 5) -- EVERY such
keyword gets searched, no cap, no subset.

Per keyword:
  1. FETCH -- one real live web search asking where the client could
     list/submit their own business for that keyword (directories,
     listings, review sites, "best of" roundups). Extracts up to
     BRAND_MENTION_TOP_N (8) candidate DOMAINS ONLY (never full page URLs --
     matching against outreach_sites is by domain, that's what gets
     uploaded there).
  2. ALLOCATE -- of those fetched domains, keep only the ones that BOTH:
       a) already exist in this project's own `outreach_sites` inventory
          (the exact same table Paid Guest Post assigns sites from), AND
       b) have status = 'Shortlisted' in that table.
     No DA/spam-score/PA re-checking happens here -- the outreach table's
     own validation workflow (ProjectSetupPage's "Validate Sites" action,
     which sets status to Shortlisted or Rejected) is what already applies
     those checks, once, when a site enters the table. Re-deriving DA/SS
     thresholds here would be a second, redundant, possibly-inconsistent
     gate on top of that. Sites that pass are still ORDERED using the SAME
     DA/spam-score/industry/country-traffic weighting Paid Guest Post uses
     (score_and_rank_outreach_sites, run by the caller and passed in here --
     never re-derived in this module) -- that's a ranking/tiebreak among
     Shortlisted sites, not a second eligibility gate.

Two distinct results land on every keyword dict:
  - `brand_mention_sites` (plural)  = every domain FETCHED by the search
    (up to 8), regardless of whether it's in the outreach table or what its
    status is -- the raw audit trail of what the AI suggested.
  - `brand_mention_site`  (singular name, but holds a LIST)  = the
    ALLOCATED sites -- the subset of the fetched domains that are both in
    the outreach table and status = Shortlisted, best-first (by the same
    Paid-Guest-Post ranking). Empty list if none qualified.

Search step: OpenAI's dedicated search-grounded chat model
(gpt-4o-search-preview) is deprecated, so live web search goes through the
RESPONSES API with a web_search_preview TOOL attached to a normal model --
confirmed via the `web_search_call` item in the response, with genuine
url_citation annotations (not the model guessing from memory).
"""

import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

try:
    from openai import OpenAI
    _client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
except Exception:
    OpenAI = None
    _client = None

# Real live-search model (via the Responses API + web_search_preview tool --
# see module docstring). Hardcoded, not read from .env, so this doesn't
# silently degrade to a non-searching model.
SEARCH_MODEL = "gpt-4o-mini"

# Exact prompt template requested -- the ONLY substitution is the single
# keyword this run is evaluating.
BRAND_MENTION_PROMPT_TEMPLATE = (
    'Find the best listing, directory, review, and "best of" websites where '
    'I can list/submit my own website/business for the keyword {keyword}. '
    "Prioritize relevant, legitimate, high-authority sites and include the "
    "submission/listing URL where available."
)

BRAND_MENTION_TOP_N = 8            # candidate domains fetched per keyword

# Hard allocation gate -- a fetched domain only becomes an "allocated" site
# if it's in outreach_sites AND its status there is this (case-insensitive).
# No DA/SS/PA re-checking here -- that's what set this status in the first
# place, via the outreach table's own "Validate Sites" workflow.
BRAND_MENTION_REQUIRED_STATUS = "shortlisted"

# Live search calls are slow (a few seconds each) and cost real API spend.
# Every keyword that passed the hard gate gets searched -- no cap -- but
# still run concurrently (small pool) so a big batch doesn't run serially.
# Set max_keywords on assign_brand_mentions_to_keywords() if you ever want
# to cap it again.
BRAND_MENTION_WORKERS = 5


def _domain_only(url_or_host: str) -> str:
    """Strip scheme/path/query/port and a leading 'www.' -- DOMAIN ONLY.
    Matching against the outreach_sites table is by domain (that's what
    gets uploaded there), never the full page URL."""
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


def get_brand_mention_domains(keyword: str, client_domain: Optional[str] = None,
                               country: Optional[str] = None, top_n: int = BRAND_MENTION_TOP_N) -> List[str]:
    """One real, live web search for `keyword`. Returns up to `top_n`
    DOMAINS ONLY (deduped, in the order the search returned them), never
    full page URLs."""
    if not OPENAI_API_KEY or not _client or not keyword:
        return []

    prompt = BRAND_MENTION_PROMPT_TEMPLATE.format(keyword=f"'{keyword}'")
    if country:
        prompt += f" Focus on sites relevant to {country}."

    try:
        response = _client.responses.create(
            model=SEARCH_MODEL,
            tools=[{"type": "web_search_preview"}],
            input=prompt,
        )
    except Exception as e:
        print(f"[BrandMentions] search failed for {keyword!r}: {e}", file=sys.stderr, flush=True)
        return []

    domains, seen = [], set()
    for item in (response.output or []):
        if getattr(item, "type", "") != "message":
            continue
        for block in (getattr(item, "content", None) or []):
            for ann in (getattr(block, "annotations", None) or []):
                if getattr(ann, "type", "") == "url_citation":
                    d = _domain_only(getattr(ann, "url", "") or "")
                    if d and d not in seen:
                        seen.add(d)
                        domains.append(d)

    if not domains:
        # regex fallback on the plain answer text if no structured citations came back
        text_out = getattr(response, "output_text", "") or ""
        for url in re.findall(r"https?://[^\s\)\]\,\"']+", text_out):
            d = _domain_only(url.rstrip("."))
            if d and d not in seen:
                seen.add(d)
                domains.append(d)

    client_d = _domain_only(client_domain) if client_domain else ""
    if client_d:
        # this is a THIRD-PARTY listing hunt -- never suggest the client's own domain
        domains = [d for d in domains if d != client_d]

    return domains[:top_n]


def _to_display_site(scored_site: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a score_and_rank_outreach_sites() result into the SAME
    clean shape calendar_backend.py's assign_outreach_sites_to_keywords()
    already builds for `outreach_site` (Paid Guest Post) -- domain, url, da,
    ss, spam_score, price, country_traffic -- rather than leaking its
    internal `_`-prefixed scoring fields."""
    da = int(scored_site.get("_da") or scored_site.get("da") or 0)
    ss_disp = scored_site.get("_ss") or str(scored_site.get("ss") or "0%")
    price = scored_site.get("_price") or 0
    return {
        "id": scored_site.get("id"),
        "domain": scored_site.get("domain") or "",
        "url": scored_site.get("url") or (f"https://{scored_site.get('domain')}" if scored_site.get("domain") else ""),
        "da": da,
        "ss": ss_disp,
        "spam_score": int(scored_site.get("_spam_num") or 0),
        "price": f"₹{int(price):,}" if price else None,
        "country_traffic": scored_site.get("_traffic_disp") or None,
        "domain_industry": scored_site.get("_site_industry") or scored_site.get("domain_industry") or None,
        "status": scored_site.get("status") or None,
    }


def _passes_hard_gate(scored_site: Dict[str, Any], required_status: str = BRAND_MENTION_REQUIRED_STATUS) -> bool:
    """status == required_status (case-insensitive). No DA/SS/PA re-check
    here -- the outreach table's own Validate Sites workflow already applied
    those checks when it set this status."""
    return str(scored_site.get("status") or "").strip().lower() == required_status


def find_brand_mention_matches(keyword: str, scored_outreach_sites: List[Dict[str, Any]],
                                client_domain: Optional[str] = None,
                                country: Optional[str] = None) -> Tuple[List[Dict[str, str]], List[Dict[str, Any]]]:
    """
    Runs ONE real live search for `keyword` and returns:
      fetched   -- EVERY domain the search returned (up to BRAND_MENTION_TOP_N),
                   as [{"domain", "url"}], regardless of outreach/DA/SS status.
      allocated -- the subset of `fetched` that (a) exists in
                   `scored_outreach_sites` (this project's own outreach
                   inventory) AND (b) passes DA > 25 / spam score < 3, in the
                   FULL display shape (da, ss, price, ...), best-first (same
                   scoring/order Paid Guest Post uses).
    """
    candidates = get_brand_mention_domains(keyword, client_domain=client_domain, country=country)
    fetched = [{"domain": d, "url": f"https://{d}"} for d in candidates]
    if not candidates or not scored_outreach_sites:
        return fetched, []

    cand_set = set(candidates)
    allocated, seen_domains = [], set()
    for site in scored_outreach_sites:
        d = str(site.get("domain") or "").strip().lower()
        if not d or d not in cand_set or d in seen_domains:
            continue
        if not _passes_hard_gate(site):
            continue
        seen_domains.add(d)
        allocated.append(_to_display_site(site))
    return fetched, allocated


def assign_brand_mentions_to_keywords(keywords: List[Dict[str, Any]],
                                       scored_outreach_sites: List[Dict[str, Any]],
                                       client_domain: Optional[str] = None,
                                       country: Optional[str] = None,
                                       max_keywords: Optional[int] = None) -> List[Dict[str, Any]]:
    """Attaches to EVERY keyword dict passed in (no cap by default -- every
    keyword that already passed the Landing-Page/rank-5+ hard gate upstream
    gets searched):
      - `brand_mention_sites`: every domain FETCHED by the search (up to 8),
        regardless of outreach/DA/SS status -- the raw audit trail.
      - `brand_mention_site`: the ALLOCATED sites -- fetched domains that are
        BOTH in this project's outreach inventory AND pass DA>25 / SS<3,
        best-first. Empty list if none qualified.
    Returns NEW dicts (does not mutate the input list). Each keyword triggers
    exactly ONE live search -- both results come from that same call, never
    two separate searches."""
    out = [dict(k) for k in (keywords or [])]
    if not OPENAI_API_KEY or not _client:
        for item in out:
            item["brand_mention_sites"] = []
            item["brand_mention_site"] = []
        return out

    to_search = out if max_keywords is None else out[:max_keywords]
    skipped = [] if max_keywords is None else out[max_keywords:]
    for item in skipped:
        item["brand_mention_sites"] = []
        item["brand_mention_site"] = []

    with ThreadPoolExecutor(max_workers=BRAND_MENTION_WORKERS) as pool:
        futures = {}
        for item in to_search:
            kw = str(item.get("keyword") or "").strip()
            if not kw:
                item["brand_mention_sites"] = []
                item["brand_mention_site"] = []
                continue
            futures[pool.submit(find_brand_mention_matches, kw, scored_outreach_sites, client_domain, country)] = item

        for fut in as_completed(futures):
            item = futures[fut]
            try:
                fetched, allocated = fut.result()
            except Exception as e:
                print(f"[BrandMentions] search/match failed for {item.get('keyword')!r}: {e}", file=sys.stderr, flush=True)
                fetched, allocated = [], []
            item["brand_mention_sites"] = fetched
            item["brand_mention_site"] = allocated

    return out


def assign_and_summarize_brand_mentions(
    keywords: List[Dict[str, Any]],
    scored_outreach_sites: List[Dict[str, Any]],
    client_domain: Optional[str] = None,
    country: Optional[str] = None,
    budget_ceiling: Optional[float] = None,
    requested_quantity: Optional[int] = None,
    max_keywords: Optional[int] = None,
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

    assigned = assign_brand_mentions_to_keywords(
        normalized, scored_outreach_sites, client_domain=client_domain, country=country, max_keywords=max_keywords
    )

    total_kws = len(assigned)
    allocated_kws = [k for k in assigned if k.get("brand_mention_site")]
    allocated_count = len(allocated_kws)
    fetched_total = sum(len(k.get("brand_mention_sites") or []) for k in assigned)
    req_qty = requested_quantity or max(1, total_kws)
    budget_cap = float(budget_ceiling) if (budget_ceiling and float(budget_ceiling) > 0) else 0.0

    da_list = [s.get("da") for k in allocated_kws for s in (k.get("brand_mention_site") or []) if s.get("da") is not None]
    da_range = f"{min(da_list)}–{max(da_list)}" if da_list else "n/a"

    general_strategy_summary = (
        f"Searched live listing/directory/review sites for {total_kws} candidate keyword(s) "
        f"({fetched_total} listing domains fetched in total). {allocated_count} keyword(s) had at least one "
        f"fetched domain that is both in your outreach inventory and status = Shortlisted."
    )
    keyword_exclusion_summary = (
        f"All {total_kws} candidate keywords had at least one allocated listing site."
        if allocated_count >= total_kws and total_kws > 0 else
        f"{total_kws - allocated_count} keyword(s) had no fetched domain that's both in your outreach "
        f"inventory and status = Shortlisted."
    )
    budget_allocation_advisory = (
        f"Brand Mentions batch: {allocated_count} of {total_kws} keyword(s) got an allocated Shortlisted "
        f"listing site (DA {da_range}). No Paid Guest Post outreach-site budget allocation applies to this activity."
    )
    domain_constraints_alert = (
        "Brand Mentions matching does not apply the Paid Guest Post 3-to-4 domain reuse limit -- each "
        "keyword's listing site(s) are allocated independently from your outreach inventory."
    )

    budget_summary = {
        "requested_quantity": req_qty,
        "requested_activities": req_qty,
        "recommended_quantity": allocated_count,
        "recommended_activities": allocated_count,
        "redundant_posts_saved": max(0, total_kws - allocated_count),
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
        "top_da_range": da_range,
        "spam_score_range": "n/a (gated by outreach Shortlisted status, not re-checked here)",
    }
    return assigned, budget_summary
