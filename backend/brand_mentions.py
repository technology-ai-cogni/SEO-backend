"""
brand_mentions.py -- "Brand Mentions" off-page activity.

Triggered from calendar_backend.py's AI-scheduling endpoint
(analyze_potential_endpoint / POST /calendar/analyze-potential), once per
keyword that passed the hard gate (Landing Page + rank >= 5) -- EVERY such
keyword gets processed, no cap, no subset.

NO live OpenAI web search happens in this module anymore. Per keyword:

  1. FETCH -- reuse the real organic SERP URLs already fetched for this
     EXACT keyword during rank-checking (hosted_rank_check.py writes them to
     keyword_categories.rank_meta.top_links when it rank-checks a keyword,
     which every keyword reaching this module has already been through --
     that's the Landing-Page/rank>=5 hard gate). This is free: no new
     search call, just a DB read.

  2. NARROW -- of those fetched URLs, keep only the ones whose domain is
     already in this project's own `outreach_sites` inventory AND has
     status = 'Shortlisted' there (cheap set-intersection, no API calls,
     no DA/SS/PA re-checking -- the outreach table's own Validate Sites
     workflow already did that). This is usually a handful of URLs out of
     the ~40 fetched, since your outreach table is finite.

  3. CLASSIFY -- for that small narrowed set, classify each via the EXACT
     SAME logic the Competitors tab already uses: BeautifulSoup-scrape the
     page + one OpenAI call classifying it as "Official Entity" (a specific
     business's own site) vs "Platform" (directory/listing/marketplace/
     review-aggregator/news/blog/comparison portal) --
     services.competitor_classifier.classify_url(), including its existing
     url_classifications DB cache, so repeat domains across keywords/runs
     don't get rescraped or reclassified. Only "Platform" results count as
     ALLOCATED for Brand Mentions -- an "Official Entity" hit (e.g. a
     competing school's own page that happens to be Shortlisted in outreach
     for a different reason) is not a listing/submission-type page, so it's
     excluded even though it passed step 2.

Two distinct results land on every keyword dict:
  - `brand_mention_sites` (plural)  = every URL FETCHED from that keyword's
    already-stored rank-check SERP results -- the raw audit trail, before
    any outreach/status/classification filtering.
  - `brand_mention_site`  (singular name, but holds a LIST)  = the
    ALLOCATED sites -- fetched URLs whose domain is in the outreach table,
    status = Shortlisted, AND classified as "Platform", best-first (by the
    same Paid-Guest-Post DA/spam-score/industry/traffic ranking, run by the
    caller and passed in here -- never re-derived in this module). Empty
    list if none qualified.
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy import text

from core.db import engine

# Hard allocation gate -- a fetched URL only becomes an "allocated" site if
# its domain is in outreach_sites, its status there is this (case-insensitive),
# AND it classifies as "Platform" (see step 3 in the module docstring).
BRAND_MENTION_REQUIRED_STATUS = "shortlisted"

# Classification (BeautifulSoup scrape + 1 OpenAI call) only ever runs on the
# narrowed, already-outreach-matched set, so this is a light pool -- most
# keywords have 0-2 candidates to classify, not 40.
BRAND_MENTION_WORKERS = 5


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


def fetch_top_links_for_keyword(project_slug: str, keyword: str) -> List[str]:
    """Reuses the real organic SERP URLs already fetched for this exact
    keyword during rank-checking (hosted_rank_check.py stores them in
    keyword_categories.rank_meta.top_links) -- no new live search here."""
    if not project_slug or not keyword:
        return []
    try:
        with engine.connect() as conn:
            row = conn.execute(text("""
                SELECT rank_meta FROM keyword_categories
                WHERE LOWER(project_name) = LOWER(:slug) AND LOWER(keyword) = LOWER(:kw)
                  AND rank_meta IS NOT NULL
                ORDER BY rank_checked_at DESC NULLS LAST, checked_at DESC
                LIMIT 1
            """), {"slug": project_slug, "kw": keyword}).mappings().first()
        if not row:
            return []
        rm = row.get("rank_meta")
        if isinstance(rm, str):
            try:
                rm = json.loads(rm)
            except Exception:
                return []
        if not isinstance(rm, dict):
            return []
        links = rm.get("top_links") or []
        return [str(u).strip() for u in links if u and str(u).strip()]
    except Exception as e:
        print(f"[BrandMentions] fetch_top_links_for_keyword failed for {keyword!r}: {e}", file=sys.stderr, flush=True)
        return []


def _to_display_site(scored_site: Dict[str, Any], matched_url: str) -> Dict[str, Any]:
    """Normalize a score_and_rank_outreach_sites() result into the SAME
    clean shape calendar_backend.py's assign_outreach_sites_to_keywords()
    already builds for `outreach_site` (Paid Guest Post) -- domain, url, da,
    ss, spam_score, price, country_traffic -- rather than leaking its
    internal `_`-prefixed scoring fields. `url` is the ACTUAL ranking page
    that matched (from rank-check SERP data), not a guessed homepage."""
    da = int(scored_site.get("_da") or scored_site.get("da") or 0)
    ss_disp = scored_site.get("_ss") or str(scored_site.get("ss") or "0%")
    price = scored_site.get("_price") or 0
    return {
        "id": scored_site.get("id"),
        "domain": scored_site.get("domain") or "",
        "url": matched_url or scored_site.get("url") or (f"https://{scored_site.get('domain')}" if scored_site.get("domain") else ""),
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


def find_brand_mention_matches(keyword: str, project_slug: str, scored_outreach_sites: List[Dict[str, Any]],
                                client_domain: Optional[str] = None) -> Tuple[List[Dict[str, str]], List[Dict[str, Any]]]:
    """
    Returns:
      fetched   -- every URL already fetched for this keyword during
                   rank-checking, as [{"domain", "url"}], regardless of
                   outreach/status/classification.
      allocated -- the subset whose domain is in `scored_outreach_sites`,
                   status = Shortlisted, AND classifies as "Platform" via
                   the Competitors tab's scrape+classify logic. Full display
                   shape (da, ss, price, ...), best-first (same scoring/
                   order Paid Guest Post uses).
    """
    top_links = fetch_top_links_for_keyword(project_slug, keyword)
    client_d = _domain_only(client_domain) if client_domain else ""

    fetched, seen = [], set()
    for u in top_links:
        d = _domain_only(u)
        if not d or d == client_d or d in seen:
            continue
        seen.add(d)
        fetched.append({"domain": d, "url": u})

    if not fetched or not scored_outreach_sites:
        return fetched, []

    outreach_by_domain: Dict[str, Dict[str, Any]] = {}
    for site in scored_outreach_sites:
        d = str(site.get("domain") or "").strip().lower()
        if d and d not in outreach_by_domain:   # scored_outreach_sites is already best-first sorted
            outreach_by_domain[d] = site

    # Step 2: narrow to Shortlisted outreach-table matches -- cheap, no API calls.
    candidates = []   # [(url, site)]
    for f in fetched:
        site = outreach_by_domain.get(f["domain"])
        if site and _passes_hard_gate(site):
            candidates.append((f["url"], site))

    if not candidates:
        return fetched, []

    # Step 3: classify only the narrowed candidates -- SAME BeautifulSoup-scrape
    # + OpenAI logic the Competitors tab uses (with its own DB cache).
    from services.competitor_classifier import classify_url, create_http_session
    session = create_http_session()
    allocated = []
    try:
        for url, site in candidates:
            try:
                result = classify_url(url, session=session)
            except Exception as e:
                print(f"[BrandMentions] classify_url failed for {url!r}: {e}", file=sys.stderr, flush=True)
                continue
            if result.get("website_type") == "Platform":
                allocated.append(_to_display_site(site, url))
    finally:
        session.close()

    return fetched, allocated


def assign_brand_mentions_to_keywords(keywords: List[Dict[str, Any]],
                                       scored_outreach_sites: List[Dict[str, Any]],
                                       project_slug: Optional[str] = None,
                                       client_domain: Optional[str] = None,
                                       country: Optional[str] = None) -> List[Dict[str, Any]]:
    """Attaches to EVERY keyword dict passed in (no cap -- no live search
    happens here, so there's no per-keyword API cost to guard against):
      - `brand_mention_sites`: every URL already fetched for that keyword
        during rank-checking -- the raw audit trail.
      - `brand_mention_site`: the ALLOCATED sites -- outreach + Shortlisted +
        classified "Platform", best-first. Empty list if none qualified.
    Returns NEW dicts (does not mutate the input list). `country` is accepted
    for call-signature compatibility with the rest of the AI-scheduling
    pipeline but unused -- rank-check SERP data is already country-scoped
    from when it was fetched."""
    out = [dict(k) for k in (keywords or [])]
    if not project_slug:
        for item in out:
            item["brand_mention_sites"] = []
            item["brand_mention_site"] = []
        return out

    with ThreadPoolExecutor(max_workers=BRAND_MENTION_WORKERS) as pool:
        futures = {}
        for item in out:
            kw = str(item.get("keyword") or "").strip()
            if not kw:
                item["brand_mention_sites"] = []
                item["brand_mention_site"] = []
                continue
            futures[pool.submit(find_brand_mention_matches, kw, project_slug, scored_outreach_sites, client_domain)] = item

        for fut in as_completed(futures):
            item = futures[fut]
            try:
                fetched, allocated = fut.result()
            except Exception as e:
                print(f"[BrandMentions] match failed for {item.get('keyword')!r}: {e}", file=sys.stderr, flush=True)
                fetched, allocated = [], []
            item["brand_mention_sites"] = fetched
            item["brand_mention_site"] = allocated

    return out


def assign_and_summarize_brand_mentions(
    keywords: List[Dict[str, Any]],
    scored_outreach_sites: List[Dict[str, Any]],
    project_slug: Optional[str] = None,
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

    assigned = assign_brand_mentions_to_keywords(
        normalized, scored_outreach_sites, project_slug=project_slug, client_domain=client_domain, country=country
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
        f"Checked already-fetched rank-check SERP results for {total_kws} candidate keyword(s) "
        f"({fetched_total} ranking URLs in total). {allocated_count} keyword(s) had at least one URL whose "
        f"domain is in your outreach inventory (status = Shortlisted) and classifies as a listing/directory "
        f"Platform page."
    )
    keyword_exclusion_summary = (
        f"All {total_kws} candidate keywords had at least one allocated listing site."
        if allocated_count >= total_kws and total_kws > 0 else
        f"{total_kws - allocated_count} keyword(s) had no ranking URL that's both a Shortlisted outreach "
        f"domain and classifies as a listing/directory Platform page."
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
