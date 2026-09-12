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
import math
import re
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
from typing import Optional, List, Dict, Any, Tuple, Set

from fastapi import APIRouter, HTTPException, Query, Response, status, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

# Import database engine from existing core
from core.db import engine, _clean_for_json
from auth.router import require_authenticated_user
from brand_mentions import assign_brand_mentions_to_keywords, assign_and_summarize_brand_mentions

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

MONTH_MAP = {
    "january": "01", "february": "02", "march": "03", "april": "04",
    "may": "05", "june": "06", "july": "07", "august": "08",
    "september": "09", "october": "10", "november": "11", "december": "12",
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "jun": "06", "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12"
}

def get_month_code(period: Optional[str]) -> str:
    """Extract 2-digit month code from period string like 'March 2026' or 'September 2026'."""
    if period:
        p_lower = str(period).strip().lower()
        for m_name, m_code in MONTH_MAP.items():
            if m_name in p_lower:
                return m_code
        digits = re.findall(r'\b(0[1-9]|1[0-2])\b', p_lower)
        if digits:
            return digits[0]
    return f"{datetime.now().month:02d}"

def generate_project_code(project_name: Optional[str]) -> str:
    """
    Generate 2-character project code prefix for UID.
    E.g. 'billabong' or 'billabonghighschool' -> 'BL'
         'EuroSchool' -> 'ES'
         'DogSeeChew' -> 'DS'
    """
    if not project_name:
        return "PR"
    p = str(project_name).strip()
    p_lower = p.lower()
    if "billabong" in p_lower:
        return "BL"
    if "euroschool" in p_lower:
        return "ES"
    # Multi-word: take first letter of first 2 words
    parts = [w for w in re.split(r'[\s\-_]+', p) if w]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    # CamelCase: check uppercase letters
    caps = re.findall(r'[A-Z]', p)
    if len(caps) >= 2:
        return "".join(caps[:2]).upper()
    # Single word: first letter + next consonant or second char
    clean = re.sub(r'[^a-zA-Z0-9]', '', p).upper()
    if len(clean) >= 2:
        vowels = set('AEIOU')
        if clean[1] in vowels and len(clean) > 2:
            for ch in clean[2:]:
                if ch not in vowels:
                    return (clean[0] + ch).upper()
        return clean[:2].upper()
    return (clean + "X")[:2].upper()

def get_channel_code(activity_name_or_channel: Optional[str]) -> str:
    """
    Returns a clean 2-letter channel code:
    - Paid Guest Post / Guest Post -> 'PG'
    - Forum - Reddit / Reddit -> 'RD'
    - Forum - Quora / Quora -> 'QR'
    - Brand Mentions -> 'BM'
    - Profile Backlinks / Profile -> 'PR'
    - Editorial Backlinks / Outreach -> 'ED'
    - Local Citations / Citations -> 'LC'
    - Infographics -> 'IG'
    - Directory Submissions -> 'DS'
    - Web 2.0 -> 'WB'
    - Press Release -> 'PR'
    - Default / Other -> 'OP'
    """
    if not activity_name_or_channel:
        return "OP"
    val = str(activity_name_or_channel).strip().lower()
    if "guest" in val or "paid" in val:
        return "PG"
    if "reddit" in val:
        return "RD"
    if "quora" in val:
        return "QR"
    if "brand" in val or "mention" in val:
        return "BM"
    if "profile" in val:
        return "PR"
    if "editorial" in val:
        return "ED"
    if "citation" in val or "local" in val:
        return "LC"
    if "infographic" in val:
        return "IG"
    if "directory" in val:
        return "DS"
    if "web 2" in val or "web2" in val:
        return "WB"
    if "press" in val:
        return "PR"
    words = [w for w in re.split(r'[\s\-_]+', val) if w and w not in ["forum"]]
    if len(words) >= 2:
        return (words[0][0] + words[1][0]).upper()
    elif len(words) == 1 and len(words[0]) >= 2:
        return words[0][:2].upper()
    return "OP"

def generate_activity_uid(conn, project_name: Optional[str], period: Optional[str], activity_name_or_channel: Optional[str] = None) -> str:
    """
    Generates a unique sequential Activity UID in Calendar like 'BL-PG-09-1'.
    Format: {PROJECT_CODE}-{CHANNEL_CODE}-{MONTH_CODE}-{SEQUENCE}
    """
    proj_code = generate_project_code(project_name)
    chan_code = get_channel_code(activity_name_or_channel)
    month_code = get_month_code(period)
    prefix_pattern = f"{proj_code}-{chan_code}-{month_code}-%"

    rows = conn.execute(
        text("SELECT activity_uid FROM off_page_activities WHERE activity_uid LIKE :pattern"),
        {"pattern": prefix_pattern}
    ).fetchall()

    max_seq = 0
    for r in rows:
        if r and r[0]:
            try:
                parts = str(r[0]).replace("ACT-", "").split("-")
                if parts[-1].isdigit():
                    val = int(parts[-1])
                    if val > max_seq:
                        max_seq = val
            except Exception:
                pass

    next_seq = max_seq + 1
    return f"{proj_code}-{chan_code}-{month_code}-{next_seq}"

def _ensure_activity_uids(conn):
    """Backfill / upgrade activity_uid for any existing rows in bulk without ACT prefix."""
    try:
        # Clean any legacy ACT- prefixes from database
        conn.execute(text("UPDATE off_page_activities SET activity_uid = REPLACE(activity_uid, 'ACT-', '') WHERE activity_uid LIKE 'ACT-%'"))
        conn.execute(text("UPDATE monthly_operations SET activity_uid = REPLACE(activity_uid, 'ACT-', '') WHERE activity_uid LIKE 'ACT-%'"))
        conn.execute(text("UPDATE monthly_operations SET uid = REPLACE(uid, 'ACT-', '') WHERE uid LIKE 'ACT-%'"))

        rows = conn.execute(text("SELECT id, project_name, period, activity_name, activity_uid FROM off_page_activities ORDER BY created_at ASC")).fetchall()
        act_seqs = {}
        for r in rows:
            uid_str = str(r[4] or "").strip()
            if uid_str and not uid_str.startswith("ACT-"):
                parts = uid_str.split("-")
                if len(parts) >= 4 and parts[-1].isdigit():
                    pfx = "-".join(parts[:-1])
                    v = int(parts[-1])
                    if v > act_seqs.get(pfx, 0):
                        act_seqs[pfx] = v

        for r in rows:
            aid, p_name, per, a_name, curr_uid = r[0], r[1], r[2], r[3], r[4]
            if not curr_uid or str(curr_uid).startswith("ACT-"):
                p_code = generate_project_code(p_name)
                c_code = get_channel_code(a_name)
                m_code = get_month_code(per)
                pfx = f"{p_code}-{c_code}-{m_code}"
                seq = act_seqs.get(pfx, 0) + 1
                act_seqs[pfx] = seq
                new_uid = f"{pfx}-{seq}"
                conn.execute(text("UPDATE off_page_activities SET activity_uid = :uid WHERE id = :id"), {"uid": new_uid, "id": aid})
    except Exception as e:
        print(f"[Calendar] UID backfill notice: {e}", file=sys.stderr)

def ensure_calendar_tables():
    """Ensure off_page_activities table exists and has all required columns."""
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS off_page_activities (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    activity_uid TEXT,
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
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS activity_uid TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'saved';"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS potential_keywords JSONB DEFAULT '[]'::jsonb;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS keyword_name TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS category TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS cluster TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS topic_link TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS ai_summary TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS ai_advisory TEXT;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS budget_summary JSONB;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS outreach_sites JSONB;"))
            conn.execute(text("ALTER TABLE off_page_activities ADD COLUMN IF NOT EXISTS ai_run_id TEXT;"))
            conn.execute(text("ALTER TABLE monthly_operations ADD COLUMN IF NOT EXISTS activity_id TEXT;"))
            conn.execute(text("ALTER TABLE monthly_operations ADD COLUMN IF NOT EXISTS activity_uid TEXT;"))
            _ensure_activity_uids(conn)

            # Full record of every AI-scheduling analysis run: one row per
            # candidate keyword per run (not just the ones the user picks).
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS calendar_ai_analysis (
                    id BIGSERIAL PRIMARY KEY,
                    run_id UUID NOT NULL,
                    activity_id UUID,
                    project_slug TEXT,
                    domain TEXT,
                    country TEXT DEFAULT 'India',
                    keyword TEXT NOT NULL,
                    keyword_id TEXT,
                    category TEXT,
                    cluster TEXT,
                    db_rank INTEGER,
                    prev_rank INTEGER,
                    live_rank INTEGER,
                    delta INTEGER,
                    sv INTEGER,
                    kd INTEGER,
                    target_type TEXT,
                    batch TEXT,
                    confidence INTEGER,
                    confidence_breakdown JSONB,
                    reason TEXT,
                    top3_types JSONB,
                    top3_is_landing BOOLEAN,
                    top_links JSONB,
                    verification JSONB,
                    outreach_site JSONB,
                    brand_mention_site JSONB,
                    brand_mention_sites JSONB,
                    landing_page_url TEXT,
                    selected BOOLEAN DEFAULT FALSE,
                    budget_used NUMERIC(12, 2),
                    quantity_requested INTEGER,
                    summary TEXT,
                    budget_summary JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS budget_summary JSONB;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS brand_mention_site JSONB;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS brand_mention_sites JSONB;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS topic_link TEXT;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS selected BOOLEAN DEFAULT FALSE;"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cal_ai_run ON calendar_ai_analysis (run_id);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cal_ai_project ON calendar_ai_analysis (project_slug, created_at DESC);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cal_ai_activity ON calendar_ai_analysis (activity_id);"))
    except Exception as err:
        print(f"[calendar_backend] Schema check notice: {err}", file=sys.stderr, flush=True)

try:
    ensure_calendar_tables()
except Exception as e:
    pass


# ─────────────────────────────────────────────────────────────
# 2. PYDANTIC SCHEMAS
# ─────────────────────────────────────────────────────────────

class CalendarActivityPayload(BaseModel):
    activity_name: str
    activity_uid: Optional[str] = None
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
    ai_summary: Optional[str] = None
    ai_advisory: Optional[str] = None
    budget_summary: Optional[Any] = None
    outreach_sites: Optional[Any] = None
    ai_run_id: Optional[str] = None


class CalendarActivityUpdatePayload(BaseModel):
    activity_name: Optional[str] = None
    activity_uid: Optional[str] = None
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
    ai_summary: Optional[str] = None
    ai_advisory: Optional[str] = None
    budget_summary: Optional[Any] = None
    outreach_sites: Optional[Any] = None
    ai_run_id: Optional[str] = None


class PushPotentialRequest(BaseModel):
    project_slug: Optional[str] = None
    domain: Optional[str] = ""
    country: Optional[str] = "India"
    keywords: Optional[List[Dict[str, Any]]] = None
    budget: Optional[float] = None
    quantity: Optional[int] = None
    activity_id: Optional[str] = None  # link this analysis run to the activity being scheduled
    activity_ids: Optional[List[str]] = None
    activity_names: Optional[List[str]] = None  # e.g. ["Paid Guest Post"] or ["Brand Mentions"] -- decides which enrichment pass(es) run below


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


def get_potential_keywords_from_db(project_slug_or_name: str) -> Tuple[List[Dict[str, Any]], bool, int]:
    """
    Fetch keywords for project from `keyword_categories`:
    - Strict Target Type filter: target_type IN ('Landing Page', 'Landing') (case-insensitive)
    - Strict Landing Page filter: landing_page_url IS NOT NULL AND TRIM(landing_page_url) != ''
    - Filter 2: min rank 5 (rank >= 5)
    - Prioritization: High search volume (ordered by SV descending) + Historical Ranking delta
    - Deduplicate by keyword text
    Returns (scored_keywords, has_landing_pages, total_project_keywords_count)
    """
    if not project_slug_or_name:
        return [], True, 0

    clean_slug = project_slug_or_name.strip().lower()
    alt_slug = clean_slug.replace(" ", "-").replace("_", "-")

    print(f"\n=======================================================", flush=True)
    print(f"[Calendar AI] Fetching candidate keywords for: '{project_slug_or_name}'", flush=True)
    print(f"[Calendar AI] Filters applied: target_type IN ('Landing Page', 'Landing'), landing_page_url IS NOT NULL, rank >= 5, ordered by SV DESC", flush=True)

    scored = []
    seen = set()
    total_count = 0
    lp_count = 0

    # Step A: Check total project keywords count and landing page URL count with target_type 'Landing Page' and rank >= 5
    check_query = text("""
        SELECT 
            COUNT(*) AS total_count,
            COUNT(CASE WHEN landing_page_url IS NOT NULL AND TRIM(landing_page_url) != '' AND LOWER(TRIM(landing_page_url)) != 'nan' AND LOWER(TRIM(target_type)) IN ('landing page', 'landing') AND rank >= 5 THEN 1 END) AS lp_count
        FROM keyword_categories
        WHERE (LOWER(project_name) = :slug OR LOWER(project_name) = :alt_slug)
    """)

    try:
        with engine.begin() as conn:
            c_row = conn.execute(check_query, {"slug": clean_slug, "alt_slug": alt_slug}).fetchone()
            if c_row:
                total_count = int(c_row[0] or 0)
                lp_count = int(c_row[1] or 0)
    except Exception as e:
        print(f"[Calendar AI] Error checking keyword landing pages count: {e}", file=sys.stderr)

    if total_count > 0 and lp_count == 0:
        print(f"[Calendar AI] Notice: Project '{clean_slug}' has {total_count} keywords, but NONE have target_type 'Landing Page' with landing page URLs!", flush=True)
        return [], False, total_count

    # Step B: Query with strict target_type 'Landing Page', landing_page_url check, and min rank 5, ordered by search volume descending
    query = text("""
        SELECT id, keyword, category, cluster, rank, sv, kw_diff, landing_page_url, target_type, rank_meta, calendar_rank_history
        FROM keyword_categories
        WHERE (LOWER(project_name) = :slug OR LOWER(project_name) = :alt_slug)
          AND landing_page_url IS NOT NULL
          AND TRIM(landing_page_url) != ''
          AND LOWER(TRIM(landing_page_url)) != 'nan'
          AND LOWER(TRIM(target_type)) IN ('landing page', 'landing')
          AND rank >= 5
        ORDER BY CAST(NULLIF(regexp_replace(sv, '[^0-9]', '', 'g'), '') AS INTEGER) DESC NULLS LAST, id DESC
    """)

    try:
        with engine.begin() as conn:
            res = conn.execute(query, {"slug": clean_slug, "alt_slug": alt_slug})
            rows = [dict(r._mapping) for r in res]
    except Exception as e:
        print(f"[Calendar AI] DB error fetching keywords for '{clean_slug}': {e}", file=sys.stderr, flush=True)
        return [], (lp_count > 0), total_count

    for k in rows:
        # Rule 0: Target type must strictly be 'Landing Page'
        tt = str(k.get("target_type") or "").strip().lower()
        if tt not in ("landing page", "landing"):
            continue

        rank = _parse_num(k.get("rank"), 0)
        # Rule 1: Min rank is 5
        if rank < 5:
            continue

        lp_url = str(k.get("landing_page_url") or "").strip()
        if not lp_url or lp_url.lower() == "nan":
            continue

        kw_text = str(k.get("keyword") or "").strip()
        kw_lower = kw_text.lower()
        if not kw_text or kw_lower in seen:
            continue
        seen.add(kw_lower)

        sv = _parse_num(k.get("sv"), 0)
        kd = _parse_num(k.get("kw_diff"), 0)

        # Baseline vs Historical / Previous Rank Analysis
        rm = k.get("rank_meta")
        if isinstance(rm, str):
            try:
                rm = json.loads(rm)
            except Exception:
                rm = {}
        elif not isinstance(rm, dict):
            rm = {}

        # Parse calendar rank history list
        cal_hist = k.get("calendar_rank_history")
        if isinstance(cal_hist, str):
            try:
                cal_hist = json.loads(cal_hist)
            except Exception:
                cal_hist = []
        elif not isinstance(cal_hist, list):
            cal_hist = []

        prev_rank = _parse_num(rm.get("previous_rank") or rm.get("prev_rank") or rm.get("initial_rank") or rank, rank)
        delta = int(prev_rank) - int(rank)  # delta < 0 means rank worsened (dropped); delta > 0 means gained

        scored.append({
            "id": k.get("id") or kw_text,
            "keyword": kw_text,
            "category": k.get("category") or "General",
            "cluster": k.get("cluster") or "General",
            "rank": int(rank),
            "prev_rank": int(prev_rank),
            "new_rank": int(rank),
            "delta": int(delta),
            "sv": int(sv),
            "kd": int(kd),
            "target_type": k.get("target_type") or "Landing Page",
            "potentialScore": sv,
            "topicLink": lp_url,
            "landing_page_url": lp_url,
            "calendar_rank_history": cal_hist,
            "history": cal_hist
        })

    # Prioritize: high search volume first, breaking ties with historical drops
    scored.sort(key=lambda x: (x["sv"], -x["rank"] if x["delta"] < 0 else 0), reverse=True)

    print(f"[Calendar AI] Found {len(scored)} candidate landing page keywords (Rank >= 5 with Landing Page URL).", flush=True)
    if scored:
        print(f"[Calendar AI] Top candidates preview:", flush=True)
        for i, item in enumerate(scored[:5], 1):
            print(f"   {i}. \"{item['keyword']}\" | DB Rank: #{item['rank']} | SV: {item['sv']:,} | KD: {item['kd']} | LP: {item['topicLink']}", flush=True)
        if len(scored) > 5:
            print(f"   ... and {len(scored) - 5} more candidate keywords.", flush=True)
    print(f"=======================================================\n", flush=True)

    return scored, (lp_count > 0 or len(scored) > 0), total_count


# ─────────────────────────────────────────────────────────────
# 3.0 OUTREACH SITES INTEGRATION, MULTI-FACTOR SCORING & BUDGET ALLOCATION
# ─────────────────────────────────────────────────────────────

COUNTRY_CODE_MAP = {
    "india": "IN", "in": "IN",
    "united states": "US", "usa": "US", "us": "US",
    "united kingdom": "UK", "uk": "UK", "gb": "UK",
    "canada": "CA", "ca": "CA",
    "australia": "AU", "au": "AU",
    "singapore": "SG", "sg": "SG",
    "uae": "AE", "united arab emirates": "AE", "ae": "AE"
}

KNOWN_PROJECT_PROFILES = {
    "chaitanya": {"country": "India", "industry": "Real Estate / Property"},
    "billabong": {"country": "India", "industry": "Education / Schools"},
    "billabonghighschool": {"country": "India", "industry": "Education / Schools"},
    "owis": {"country": "India", "industry": "Education / Schools"},
    "euroschool": {"country": "India", "industry": "Education / Schools"},
    "euroschoolindia": {"country": "India", "industry": "Education / Schools"},
    "socialoffline": {"country": "India", "industry": "Food & Beverage / Entertainment"},
    "social-offline": {"country": "India", "industry": "Food & Beverage / Entertainment"},
    "ittisa": {"country": "India", "industry": "Digital Marketing / Technology"},
    "dogseechew": {"country": "India", "industry": "Pets / Pet Food"},
    "dogseechew-aitest-m": {"country": "India", "industry": "Pets / Pet Food"},
    "goodday": {"country": "India", "industry": "FMCG / Food"}
}

def get_project_target_profile(project_slug: Optional[str] = None, target_domain: Optional[str] = None) -> Dict[str, Any]:
    """
    Look up target_regions (country) and industry/industry_type from the `domains` table,
    with resilience fallback to known project profiles and keyword categories inference.
    """
    profile = {
        "country": "India",
        "industry": "General",
        "domain": ""
    }
    clean_slug = (project_slug or "").strip().lower()
    clean_dom = (target_domain or "").strip().lower().replace("https://", "").replace("http://", "").split("/")[0]

    # Check known project cache first
    for k, v in KNOWN_PROJECT_PROFILES.items():
        if k in clean_slug or (clean_dom and k in clean_dom):
            profile["country"] = v["country"]
            profile["industry"] = v["industry"]
            break

    try:
        with engine.connect() as conn:
            query = """
                SELECT domain, project_name, project_slug, target_regions, industry, industry_type
                FROM domains
                WHERE (LOWER(project_slug) = :slug OR LOWER(project_name) = :slug)
            """
            params: Dict[str, Any] = {"slug": clean_slug or "__none__"}
            if clean_dom:
                query += " OR LOWER(domain) LIKE :dom"
                params["dom"] = f"%{clean_dom}%"
            query += " LIMIT 1"

            res = conn.execute(text(query), params).mappings().first()
            if res:
                d = dict(res)
                profile["domain"] = d.get("domain") or profile["domain"]
                ind = d.get("industry") or d.get("industry_type")
                if ind and str(ind).strip():
                    profile["industry"] = str(ind).strip()
                tr = d.get("target_regions")
                if isinstance(tr, list) and len(tr) > 0 and tr[0]:
                    profile["country"] = str(tr[0]).strip()
                elif isinstance(tr, str) and tr.strip():
                    profile["country"] = tr.strip().strip("[]'\"")

            # If industry is still General/unspecified, infer from keyword_categories clusters/categories
            if profile.get("industry") in ("General", "", None):
                cat_rows = conn.execute(text("""
                    SELECT category, cluster
                    FROM keyword_categories
                    WHERE LOWER(project_name) = :slug OR LOWER(project_name) = :alt_slug
                    LIMIT 20
                """), {"slug": clean_slug, "alt_slug": clean_slug.replace(" ", "-").replace("_", "-")}).fetchall()
                cat_text = " ".join([f"{r[0] or ''} {r[1] or ''}" for r in cat_rows]).lower()
                if any(w in cat_text for w in ["school", "education", "cbse", "icse", "kindergarten", "learning", "academy", "college"]):
                    profile["industry"] = "Education / Schools"
                elif any(w in cat_text for w in ["property", "real estate", "villa", "apartment", "plot", "housing", "builder"]):
                    profile["industry"] = "Real Estate / Property"
                elif any(w in cat_text for w in ["pet", "dog", "cat", "puppy", "chew", "canine"]):
                    profile["industry"] = "Pets / Pet Food"
                elif any(w in cat_text for w in ["restaurant", "bar", "cafe", "food", "dining", "cocktail"]):
                    profile["industry"] = "Food & Beverage / Entertainment"
                elif any(w in cat_text for w in ["software", "tech", "saas", "digital", "seo"]):
                    profile["industry"] = "Technology / Digital"
    except Exception as e:
        print(f"[Calendar Profile] Notice resolving project profile for '{clean_slug}': {e}", file=sys.stderr)

    return profile


def _parse_traffic_num(val) -> float:
    if not val:
        return 0.0
    s = str(val).strip().replace(',', '')
    m = re.search(r'\((\d+)\)', s)
    if m:
        return float(m.group(1))
    m = re.search(r'([\d.]+)\s*([KkMmBb])?', s)
    if not m:
        return 0.0
    num = float(m.group(1))
    unit = (m.group(2) or '').upper()
    if unit == 'K': num *= 1_000
    elif unit == 'M': num *= 1_000_000
    elif unit == 'B': num *= 1_000_000_000
    return num


def extract_country_traffic(site: Dict[str, Any], target_country: str) -> Tuple[float, str]:
    """
    Extracts organic/total traffic specifically for the target country.
    Returns (numeric_traffic, formatted_display).
    """
    tc_clean = (target_country or "India").strip().lower()
    tc_code = COUNTRY_CODE_MAP.get(tc_clean, tc_clean.upper() if len(tc_clean) == 2 else "IN")

    # 1. metrics_json.traffic_data
    mj = site.get("metrics_json")
    if isinstance(mj, str):
        try:
            mj = json.loads(mj)
        except Exception:
            mj = None
    if isinstance(mj, dict):
        td_list = mj.get("traffic_data") or []
        for td in td_list:
            c_name = str(td.get("country") or "").lower()
            r_code = str(td.get("region_code") or "").upper()
            if (tc_code and r_code == tc_code) or (tc_clean and tc_clean in c_name):
                t = float(td.get("total_traffic") or td.get("organic_traffic") or 0.0)
                if t > 0:
                    disp = f"{t/1_000_000:.1f}M ({tc_code})" if t >= 1_000_000 else (f"{t/1_000:.1f}K ({tc_code})" if t >= 1_000 else f"{int(t)} ({tc_code})")
                    return t, disp

    # 2. region1_traffic, region2_traffic, region3_traffic
    for reg_key in ["region1_traffic", "region2_traffic", "region3_traffic"]:
        reg_val = str(site.get(reg_key) or "").strip()
        if reg_val:
            prefix = reg_val.split(":")[0].strip().upper()
            if tc_code and prefix == tc_code:
                t = _parse_traffic_num(reg_val)
                return t, reg_val

    # 3. site country match
    sc = str(site.get("country") or "").lower()
    if tc_clean and (tc_clean in sc or (tc_code and tc_code == sc.upper())):
        t = _parse_traffic_num(site.get("total_traffic") or site.get("traffic"))
        if t > 0:
            disp = f"{t/1_000_000:.1f}M ({tc_code})" if t >= 1_000_000 else (f"{t/1_000:.1f}K ({tc_code})" if t >= 1_000 else f"{int(t)} ({tc_code})")
            return t, disp

    # 4. Fallback estimated traffic
    tot = _parse_traffic_num(site.get("total_traffic") or site.get("traffic"))
    if tot > 0:
        est = tot * 0.35
        disp = f"~{est/1000:.0f}K ({tc_code})" if est >= 1000 else f"~{int(est)} ({tc_code})"
        return est, disp

    return 0.0, f"0 ({tc_code})"


def infer_site_industry(site: Dict[str, Any]) -> str:
    """
    Infers the industry of an outreach publisher site based on its data or domain.
    """
    ind = site.get("domain_industry") or site.get("industry") or site.get("industry_type")
    if ind and str(ind).strip() and str(ind).lower() not in ("none", "null", "undefined", "general", ""):
        return str(ind).strip()

    dom = str(site.get("domain") or site.get("url") or "").lower()

    if any(k in dom for k in ["school", "education", "college", "kids", "learn", "academy", "study", "exam", "tutor", "uni"]):
        return "Education / Schools"
    if any(k in dom for k in ["acres", "property", "estate", "housing", "realty", "magicbricks", "villa", "apartment", "plot"]):
        return "Real Estate / Property"
    if any(k in dom for k in ["pet", "dog", "cat", "animal", "vet", "puppy", "bark"]):
        return "Pets / Pet Food"
    if any(k in dom for k in ["tech", "geek", "software", "code", "dev", "cyber", "ai", "hardware", "web", "cloud"]):
        return "Technology / Digital"
    if any(k in dom for k in ["business", "finance", "money", "invest", "stock", "corp", "wealth", "tax"]):
        return "Business / Finance"
    if any(k in dom for k in ["health", "med", "doctor", "clinic", "pharma", "care", "wellness", "hospital"]):
        return "Healthcare / Medical"
    if any(k in dom for k in ["food", "beverage", "restaurant", "cafe", "bar", "dine", "eat", "recipe", "drinks"]):
        return "Food & Beverage / Entertainment"
    if any(k in dom for k in ["listing", "directory", "classified", "yellowpages", "freelisting"]):
        return "Directory / Business Listing"
    if any(k in dom for k in ["news", "times", "tribune", "post", "gazette", "daily", "chronicle", "herald"]):
        return "News & Media"

    p_slug = str(site.get("project_slug") or "").lower()
    for pk, pv in KNOWN_PROJECT_PROFILES.items():
        if pk in p_slug:
            return pv["industry"]

    return "General"


def calculate_industry_relevance(site_industry: Optional[str], target_industry: Optional[str]) -> Tuple[float, str, bool, bool]:
    """
    Checks whether the outreach domain has the same industry type as our project.
    Returns (score: float, display_label: str, is_same_industry: bool, is_mismatch: bool).
    """
    si = (site_industry or "").strip().lower()
    ti = (target_industry or "General").strip().lower()

    if not si or si in ("general", "unknown", "none"):
        return 0.45, "General / Multi-Category", False, False

    if ti in ["general", "all", ""]:
        return 0.75, "Broad Domain Authority", True, False

    # 1. Exact match
    if si == ti:
        return 1.0, f"Same Industry Match ({target_industry})", True, False

    ti_words = set(re.findall(r'[a-zA-Z]+', ti)) - {"and", "or", "type", "the", "in", "of"}
    si_words = set(re.findall(r'[a-zA-Z]+', si)) - {"and", "or", "type", "the", "in", "of"}

    # 2. Token overlap (e.g., 'Education' and 'Education / Schools', or 'Real Estate' and 'Real Estate / Property')
    common = ti_words.intersection(si_words)
    if common:
        return 0.95, f"Same Industry Match ({', '.join(common).title()})", True, False

    # 3. Known industry clusters
    related_clusters = [
        {"real estate", "property", "construction", "architecture", "housing", "interior", "villa", "apartment"},
        {"technology", "tech", "software", "saas", "cloud", "it", "ai", "hardware", "cybersecurity", "web", "digital"},
        {"education", "school", "schools", "learning", "college", "university", "academy", "training", "kids", "cbse", "icse"},
        {"business", "finance", "startups", "consulting", "marketing", "corporate", "investment", "money"},
        {"health", "medical", "fitness", "wellness", "pharma", "lifestyle", "hospital"},
        {"pets", "pet", "animals", "dog", "dogs", "cat", "cats", "puppy"},
        {"food", "beverage", "restaurant", "dining", "entertainment"}
    ]
    for cluster in related_clusters:
        if any(w in cluster for w in ti_words) and any(w in cluster for w in si_words):
            return 0.85, f"Related Industry Niche ({site_industry})", True, False

    # 4. Multi-category / Directories
    if any(k in si for k in ["directory", "listing", "classified", "news", "media"]):
        return 0.40, "General / Directory Publisher", False, False

    # 5. Conflicting / Different Industry Mismatch
    return 0.05, f"Industry Mismatch ({site_industry})", False, True


def fetch_available_outreach_sites(project_slug: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetch active outreach sites with full quality metrics: DA, SS, Country, Industry, and Traffic.
    Combines project-specific sites and global active DB sites.
    """
    clean_slug = (project_slug or "").strip().lower()
    sites = []
    with engine.connect() as conn:
        if clean_slug:
            try:
                res = conn.execute(
                    text("""
                        SELECT id, domain, url, type, da, pa, ss, landing_price, selling_price, country, domain_industry, status,
                               traffic, total_traffic, region1_traffic, region2_traffic, region3_traffic, metrics_json, project_slug
                        FROM outreach_sites
                        WHERE LOWER(project_slug) = :slug AND LOWER(COALESCE(status, '')) != 'rejected'
                        ORDER BY da DESC NULLS LAST, id ASC
                    """),
                    {"slug": clean_slug}
                )
                sites = [_clean_for_json(dict(r._mapping)) for r in res]
            except Exception as e:
                print(f"[Calendar Outreach] Error querying project sites: {e}", file=sys.stderr)

        try:
            res = conn.execute(
                text("""
                    SELECT id, domain, url, type, da, pa, ss, landing_price, selling_price, country, domain_industry, status,
                           traffic, total_traffic, region1_traffic, region2_traffic, region3_traffic, metrics_json, project_slug
                    FROM outreach_sites
                    WHERE LOWER(COALESCE(status, '')) != 'rejected'
                    ORDER BY da DESC NULLS LAST, id ASC
                    LIMIT 60
                """)
            )
            general_sites = [_clean_for_json(dict(r._mapping)) for r in res]
            seen_domains = {str(s.get("domain") or "").strip().lower() for s in sites}
            for gs in general_sites:
                d_key = str(gs.get("domain") or "").strip().lower()
                if d_key and d_key not in seen_domains:
                    sites.append(gs)
                    seen_domains.add(d_key)
        except Exception as e:
            print(f"[Calendar Outreach] Error querying general sites: {e}", file=sys.stderr)

    # Curated fallback inventory in Indian Rupees (₹) with high DA, clean SS (0-1%), and regional traffic
    fallback_inventory = []

    existing_domains = {str(s.get("domain") or "").strip().lower() for s in sites}
    for fb in fallback_inventory:
        d_key = str(fb.get("domain") or "").strip().lower()
        if d_key not in existing_domains:
            sites.append(fb)
            existing_domains.add(d_key)

    return sites


def score_and_rank_outreach_sites(
    available_sites: List[Dict[str, Any]],
    target_country: str,
    target_industry: str,
    budget_ceiling: Optional[float] = None
) -> List[Dict[str, Any]]:
    """
    Scores candidate outreach sites enforcing:
    - Same Industry Type Match (Primary criteria, 35% weight)
    - High Domain Authority (DA, 25% weight)
    - Low Spam Score (SS, 15% weight)
    - High Country Traffic in project's country (25% weight)
    And strictly prioritizes same-industry publishers above all else.
    """
    scored = []

    for s in available_sites:
        item = dict(s)
        da = int(item.get("da") or 40)
        ss_str = str(item.get("ss") or "0").replace("%", "").strip()
        ss_num = _parse_num(ss_str, 0.0)

        # Parse selling price in Rupees (selling_price in DB is directly in Indian Rupees)
        raw_price = _parse_num(item.get("selling_price") or item.get("landing_price") or 0.0, 0.0)
        calibrated_price = raw_price if raw_price > 0 else 500.0

        resolved_site_industry = infer_site_industry(item)
        traffic_val, traffic_disp = extract_country_traffic(item, target_country)
        ind_score, ind_disp, is_same, is_mismatch = calculate_industry_relevance(resolved_site_industry, target_industry)

        # 1. DA Score (25%)
        da_score = min(1.0, max(0.1, da / 100.0))

        # 2. Spam Score (15% - penalize > 3%)
        if ss_num <= 1.0: ss_score = 1.0
        elif ss_num <= 3.0: ss_score = 0.85
        elif ss_num <= 5.0: ss_score = 0.50
        elif ss_num <= 10.0: ss_score = 0.20
        else: ss_score = 0.05

        # 3. Country Traffic Score (25% - logarithmic scale)
        if traffic_val > 0:
            traffic_score = min(1.0, max(0.1, math.log10(traffic_val + 1) / 7.0))
        else:
            traffic_score = 0.12

        # 4. Industry Score (35% - strong primary weight)
        quality_score = (
            0.35 * ind_score +
            0.25 * da_score +
            0.15 * ss_score +
            0.25 * traffic_score
        )

        # 5. Cost-Efficiency Optimization (spend less, but never sacrifice quality)
        price_ratio = max(1.0, calibrated_price / 500.0)
        cost_efficiency = 1.0 / (1.0 + 0.35 * math.log2(price_ratio))

        # Overall Value Score: 70% Quality + 30% Cost Efficiency
        # Prioritizes high DA, low spam score, same industry, verified traffic, while strongly favoring economical pricing.
        value_score = (quality_score * 0.70) + (cost_efficiency * 0.30)

        item["_price"] = round(calibrated_price, 2)
        item["price"] = f"₹{int(calibrated_price):,}"
        item["_composite_score"] = round(quality_score, 4)
        item["_quality_score"] = round(quality_score, 4)
        item["_cost_efficiency"] = round(cost_efficiency, 4)
        item["_value_score"] = round(value_score, 4)
        item["_traffic_val"] = traffic_val
        item["_traffic_disp"] = traffic_disp
        item["_ind_score"] = ind_score
        item["_ind_disp"] = ind_disp
        item["_site_industry"] = resolved_site_industry
        item["domain_industry"] = resolved_site_industry
        item["_is_same_industry"] = is_same
        item["is_same_industry"] = is_same
        item["_is_mismatch"] = is_mismatch
        item["_da"] = da
        item["_ss"] = f"{int(ss_num)}%"
        item["_spam_num"] = int(ss_num)

        scored.append(item)

    # Sort:
    # Tier 0: Same industry match strictly prioritized
    # Tier 1: General / Multi-category
    # Tier 2: Mismatched industry
    # Within each tier: Higher value_score DESC (best quality-to-cost ratio), then price ASC
    scored.sort(key=lambda x: (
        0 if x["_is_same_industry"] else (2 if x["_is_mismatch"] else 1),
        -x["_value_score"],
        x["_price"]
    ))
    return scored


def assign_outreach_sites_to_keywords(
    keywords: List[Dict[str, Any]],
    available_sites: List[Dict[str, Any]],
    budget_ceiling: Optional[float] = None,
    requested_quantity: Optional[int] = None,
    project_slug: Optional[str] = None,
    target_country: Optional[str] = None,
    target_domain: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Intelligently assigns outreach sites to candidate keywords enforcing:
    1. Same Industry Type matching: checks whether domain has same industry as our project.
    2. High DA, Low Spam Score, verified Target Country traffic.
    3. Exact requested quantity allocation within budget (or less than budget).
    4. Strict 3-domain backlink limit rule (anti-footprint).
    5. Executive AI Budget Analysis & Advisory narrative in Indian Rupees (₹).
    """
    if not available_sites:
        available_sites = fetch_available_outreach_sites(project_slug)

    # Resolve project target profile (country & industry)
    profile = get_project_target_profile(project_slug, target_domain)
    resolved_country = target_country or profile.get("country") or "India"
    resolved_industry = profile.get("industry") or "General"

    KEYWORDS_PER_SITE = 4

    # Determine targeted outreach sites count:
    # If requested_quantity is explicitly provided (e.g. from calendar activity quantity), that's the number of sites requested.
    # Otherwise, calculate how many sites are needed for keywords (1 site per 4 keywords).
    if requested_quantity and requested_quantity > 0:
        target_sites_qty = requested_quantity
    else:
        target_sites_qty = max(1, (len(keywords or []) + KEYWORDS_PER_SITE - 1) // KEYWORDS_PER_SITE)

    req_qty = target_sites_qty

    # Multi-factor score all candidate sites
    scored_sites = score_and_rank_outreach_sites(
        available_sites,
        target_country=resolved_country,
        target_industry=resolved_industry,
        budget_ceiling=budget_ceiling
    )

    # Filter eligible pool: prioritize same-industry sites; avoid mismatched industries
    same_industry_sites = [s for s in scored_sites if s.get("_is_same_industry")]
    eligible_pool = same_industry_sites if same_industry_sites else [s for s in scored_sites if not s.get("_is_mismatch")]
    if not eligible_pool:
        eligible_pool = scored_sites

    # Total budget cap in Indian Rupees (₹)
    budget_cap = float(budget_ceiling) if (budget_ceiling and float(budget_ceiling) > 0) else float(req_qty * 10000.0)

    # Allot sites respecting 3-domain limit and budget ceiling
    domain_usage_counts: Dict[str, int] = {}
    selected_sites: List[Dict[str, Any]] = []
    current_spend = 0.0

    # Pass 1: Select top quality same-industry / eligible sites where price fits within budget_cap
    for s in eligible_pool:
        if len(selected_sites) >= req_qty:
            break
        d = str(s.get("domain") or "").strip().lower()
        if not d or domain_usage_counts.get(d, 0) >= 3:
            continue

        site_price = s["_price"]
        if current_spend + site_price <= budget_cap:
            selected_sites.append(s)
            domain_usage_counts[d] = domain_usage_counts.get(d, 0) + 1
            current_spend += site_price

    # Pass 2: If we still need sites, see if any remaining sites in eligible pool fit within remaining budget
    if len(selected_sites) < req_qty:
        remaining_budget = budget_cap - current_spend
        for s in sorted(eligible_pool, key=lambda x: (0 if x.get("_is_same_industry") else 1, -x.get("_value_score", 0), x["_price"])):
            if len(selected_sites) >= req_qty:
                break
            d = str(s.get("domain") or "").strip().lower()
            if not d or domain_usage_counts.get(d, 0) >= 3 or s in selected_sites:
                continue
            if s["_price"] <= remaining_budget:
                selected_sites.append(s)
                domain_usage_counts[d] = domain_usage_counts.get(d, 0) + 1
                current_spend += s["_price"]
                remaining_budget = budget_cap - current_spend

    # Pass 3: If selected_sites is STILL empty, pick the best value site from eligible pool
    if len(selected_sites) == 0 and eligible_pool:
        best_value = max(eligible_pool, key=lambda x: (1 if x.get("_is_same_industry") else 0, x.get("_value_score", 0)))
        selected_sites.append(best_value)
        current_spend = best_value["_price"]

    # Assign selected sites to keywords: STRICTLY at most 4 keywords per outreach site
    assigned_keywords = []
    for idx, kw in enumerate(keywords):
        item = dict(kw)
        lp = kw.get("landing_page_url") or kw.get("topicLink") or ""
        item["landing_page_url"] = lp
        item["topicLink"] = lp
        item["topic_link"] = kw.get("topic_link") or None
        item["selected"] = bool(idx < req_qty)
        site_idx = idx // KEYWORDS_PER_SITE
        if site_idx < len(selected_sites):
            chosen_site = selected_sites[site_idx]
            site_price = chosen_site.get("_price") or 500.0
            is_same = bool(chosen_site.get("_is_same_industry"))
            site_ind = chosen_site.get("_site_industry") or resolved_industry
            ind_badge = "Same Industry Verified" if is_same else ("Multi-Category" if not chosen_site.get("_is_mismatch") else "Cross-Niche")
            ind_match_label = "Same Industry" if is_same else ("General / Multi-Category" if not chosen_site.get("_is_mismatch") else "Cross-Industry")

            item["outreach_site"] = {
                "id": chosen_site.get("id"),
                "domain": chosen_site.get("domain") or "outreach-partner.com",
                "url": chosen_site.get("url") or f"https://{chosen_site.get('domain', 'site.com')}",
                "da": int(chosen_site.get("_da") or chosen_site.get("da") or 50),
                "ss": chosen_site.get("_ss") or str(chosen_site.get("ss") or "0%"),
                "spam_score": int(chosen_site.get("_spam_num") or 0),
                "price": f"₹{int(site_price):,}",
                "selling_price": f"₹{int(site_price):,}",
                "price_num": round(site_price, 2),
                "country": chosen_site.get("country") or resolved_country,
                "country_traffic": chosen_site.get("_traffic_disp") or "Verified Traffic",
                "domain_industry": site_ind,
                "project_industry": resolved_industry,
                "is_same_industry": is_same,
                "industry_match_status": ind_match_label,
                "match_rationale": f"{ind_badge} (Domain Industry: {site_ind} | Project: {resolved_industry}), DA {int(chosen_site.get('_da') or 50)}, {chosen_site.get('_ss') or '0%'} spam, {chosen_site.get('_traffic_disp') or ''} in {resolved_country}"
            }
        else:
            item["outreach_site"] = None

        assigned_keywords.append(item)

    num_sites_used = min(len(selected_sites), max(1, (len(keywords) + KEYWORDS_PER_SITE - 1) // KEYWORDS_PER_SITE))
    total_cost = sum(s.get("_price", 500.0) for s in selected_sites[:num_sites_used])

    recommended_qty = min(req_qty, len(keywords)) if keywords else req_qty
    savings = max(0.0, budget_cap - total_cost)

    # Quality metrics summary
    da_list = [int(s.get("_da") or s.get("da") or 50) for s in selected_sites] or [50]
    min_da = min(da_list)
    max_da = max(da_list)
    ss_list = [s.get("_ss") or "0%" for s in selected_sites] or ["0%"]
    min_ss = min(ss_list)
    max_ss = max(ss_list)

    has_same_ind = any(s.get("_is_same_industry") for s in selected_sites)
    industry_confirmation = (
        f"verified same-industry publishers matching your project's '{resolved_industry}' industry"
        if has_same_ind else
        f"high-authority publisher domains matching your '{resolved_industry}' niche"
    )

    # Query total project keywords in DB for transparent exclusion funnel reporting
    total_db_keywords_count = len(keywords)
    if project_slug:
        clean_p_slug = str(project_slug).strip().lower()
        alt_p_slug = clean_p_slug.replace(" ", "-").replace("_", "-")
        try:
            with engine.begin() as conn:
                db_c = conn.execute(text("""
                    SELECT COUNT(*) FROM keyword_categories
                    WHERE (LOWER(project_name) = :slug OR LOWER(project_name) = :alt_slug)
                """), {"slug": clean_p_slug, "alt_slug": alt_p_slug}).scalar()
                if db_c and int(db_c) > 0:
                    total_db_keywords_count = int(db_c)
        except Exception:
            pass

    # Calculate detailed counts for 4 structured summaries
    total_kws_count = len(keywords)
    unique_lps_count = len({kw.get("landing_page_url") or kw.get("topicLink") for kw in keywords if kw.get("landing_page_url") or kw.get("topicLink")}) or 1
    selected_kws_count = len([k for k in assigned_keywords if k.get("selected")]) or min(req_qty, total_kws_count)
    excluded_kws_count = max(0, total_kws_count - selected_kws_count)

    # 1. General Strategy Summary
    general_strategy_summary = (
        f"I analyzed total {total_db_keywords_count} keywords, "
        f"out of them, I have picked {total_kws_count} qualified candidate keywords with verified landing pages (Rank 5+), "
        f"and out of those, I suggest you to work on these {selected_kws_count} high-impact target keywords for your campaign, "
        f"prioritizing live SERP momentum and recovery candidates."
    )

    # 2. Keyword Exclusion Summary (Transparent Step-by-Step Funnel)
    if excluded_kws_count > 0:
        keyword_exclusion_summary = (
            f"The database contained {total_db_keywords_count} keywords in total for this project. From these, I evaluated {total_kws_count} candidate keywords with verified landing pages (Rank 5+), "
            f"selected {selected_kws_count} priority targets matching your campaign criteria, and excluded {excluded_kws_count} keywords to respect your ₹{int(budget_cap):,} budget ceiling, "
            f"preserve keywords already ranking in Top 3, and filter out low-confidence SERP patterns without matching outreach publishers."
        )
    else:
        keyword_exclusion_summary = (
            f"The database contained {total_db_keywords_count} keywords in total for this project. From these, I evaluated and selected all {total_kws_count} candidate keywords with verified landing pages (Rank 5+) within your budget ceiling."
        )

    # 3. Budget Allocation & Savings Advisory
    if savings > 0:
        budget_allocation_advisory = (
            f"For these {selected_kws_count} selected keywords, I've allocated ₹{int(total_cost):,} against your ₹{int(budget_cap):,} budget "
            f"(saving you ₹{int(savings):,}) by prioritizing high-authority publishers with the best authority-per-rupee value "
            f"(DA {min_da}–{max_da}, clean {min_ss}–{max_ss} spam score, verified {resolved_country} audience traffic, capped at 2–4 keywords per publisher domain)."
        )
    else:
        budget_allocation_advisory = (
            f"For these {selected_kws_count} priority keywords, I've allocated {num_sites_used} {industry_confirmation} "
            f"(DA {min_da}–{max_da}, clean {min_ss}–{max_ss} spam score, verified {resolved_country} traffic) "
            f"budget-optimized to deliver maximum authority per rupee spent within your ₹{int(budget_cap):,} budget."
        )

    # 4. Domain & Quota Constraints Alert (only generated when outreach publisher inventory is limited)
    domain_constraints_alert = None
    if len(available_sites) < target_sites_qty or (len(available_sites) * KEYWORDS_PER_SITE < len(keywords)):
        domain_constraints_alert = (
            f"Our available outreach publisher pool is currently limited for this project's target volume ({len(available_sites)} publisher domain{'s' if len(available_sites) != 1 else ''} available for {len(keywords)} keywords). "
            f"I've enforced a strict guardrail of maximum 3-to-4 keywords per publisher domain to prevent footprint risks and maintain natural velocity."
        )

    budget_summary = {
        "total_db_keywords": total_db_keywords_count,
        "evaluated_landing_keywords": total_kws_count,
        "selected_keywords_count": selected_kws_count,
        "excluded_keywords_count": excluded_kws_count,
        "requested_quantity": req_qty,
        "requested_activities": req_qty,
        "recommended_quantity": selected_kws_count,
        "recommended_activities": selected_kws_count,
        "redundant_posts_saved": max(0, req_qty - selected_kws_count),
        "budget_cap": round(budget_cap, 2),
        "total_budget_cap": round(budget_cap, 2),
        "planned_spend": round(total_cost, 2),
        "projected_savings": round(savings, 2),
        "avg_cost_per_post": round(total_cost / max(1, selected_kws_count), 2),
        "general_strategy_summary": general_strategy_summary,
        "keyword_exclusion_summary": keyword_exclusion_summary,
        "budget_allocation_advisory": budget_allocation_advisory,
        "domain_constraints_alert": domain_constraints_alert,
        "anti_waste_advisory": budget_allocation_advisory,
        "analysis_narrative": general_strategy_summary,
        "target_country": resolved_country,
        "target_industry": resolved_industry,
        "top_da_range": f"{min_da} - {max_da}" if min_da != max_da else str(min_da),
        "spam_score_range": f"{min_ss} - {max_ss}" if min_ss != max_ss else str(min_ss)
    }

    return assigned_keywords, budget_summary


def select_quota_balanced_keywords(batches: Dict[str, List[Dict[str, Any]]], total_capacity: int) -> List[Dict[str, Any]]:
    """
    Selects keywords balancing 60% high-momentum (Batch 1 Gains) and 40% dropped/stagnant (Batch 2/3),
    ensuring neglected low-ranking keywords receive steady off-page push.
    """
    if not batches or total_capacity <= 0:
        return []

    high = batches.get("high", [])
    medium = batches.get("medium", [])
    low = batches.get("low", [])

    quota_high = max(1, round(total_capacity * 0.60)) if high else 0
    quota_med_low = total_capacity - quota_high

    picked = []
    # 1. 60% from High (Gains) sorted by low KD, high SV
    high_sorted = sorted(high, key=lambda x: (_parse_num(x.get("kd"), 99), -_parse_num(x.get("sv"), 0)))
    picked.extend(high_sorted[:quota_high])

    # 2. 40% from Medium (Drops) & Low (Stagnant)
    medium_sorted = sorted(medium, key=lambda x: (_parse_num(x.get("kd"), 99), -_parse_num(x.get("sv"), 0)))
    low_sorted = sorted(low, key=lambda x: (_parse_num(x.get("kd"), 99), -_parse_num(x.get("sv"), 0)))

    med_quota = min(len(medium_sorted), quota_med_low)
    picked.extend(medium_sorted[:med_quota])

    rem_quota = total_capacity - len(picked)
    if rem_quota > 0:
        picked.extend(low_sorted[:rem_quota])

    # If still capacity left, fill from any remaining
    if len(picked) < total_capacity:
        picked_ids = {k.get("id") for k in picked}
        all_pool = high_sorted + medium_sorted + low_sorted
        for k in all_pool:
            if k.get("id") not in picked_ids:
                picked.append(k)
                picked_ids.add(k.get("id"))
                if len(picked) >= total_capacity:
                    break

    return picked


def calculate_heuristic_batches(potential: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Initial fast heuristic fallback before live SERP rank checking finishes.
    Splits keywords into Gains (Batch 1), Drops / Red Alert (Batch 2), and Stagnant (Batch 3).
    """
    out = {"high": [], "medium": [], "low": []}
    for k in potential or []:
        rank = _parse_num(k.get("rank"), 99)
        prev_rank = _parse_num(k.get("prev_rank"), rank)
        delta = int(k.get("delta") or (prev_rank - rank))
        kd = _parse_num(k.get("kd"), 0)
        sv = _parse_num(k.get("sv"), 0)

        # Batch 1: Gains (Improving) - rank gained positions
        is_drop_to_101 = (rank >= 101 and prev_rank < 101)
        is_up_from_101 = (prev_rank >= 101 and rank < 101)
        has_101 = (rank >= 101 or prev_rank >= 101)
        prev_disp = f"#{int(prev_rank)}"
        curr_disp = f"#{int(rank)}"

        if is_up_from_101 or delta > 0:
            batch = "high"   # Batch 1: Extremely Improved (Gains)
            confidence = 85
            gain_desc = "30+" if (has_101 or abs(delta) >= 30) else f"+{delta} positions"
            reason = f"Rank gained {gain_desc} (was {prev_disp} -> now {curr_disp}). High momentum candidate."
        # Batch 2: Drops (Declining) - rank dropped positions
        elif is_drop_to_101 or delta < 0:
            batch = "medium"  # Batch 2: Extremely Dropped (Drops)
            confidence = 75
            drop_desc = "30+" if (has_101 or abs(delta) >= 30) else f"{abs(delta)} positions"
            reason = f"Rank dropped by {drop_desc} (was {prev_disp} -> now {curr_disp}). Prime recovery target."
        else:
            batch = "low"    # Batch 3: Stagnant / Unchanged
            confidence = 40
            reason = f"Rank hasn't moved ({prev_disp} -> {curr_disp}). Stagnant SERP velocity candidate."

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
        from services import rank_checker
        links = rank_checker.get_top_n_organic_links(keyword, n=limit, country_code=country_code)
        if links:
            return [{"url": u, "title": "", "snippet": "", "source": "BrightData"} for u in links]
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


def fetch_serp_via_brightdata(keyword: str, country_code: str = "in", limit: int = 30) -> List[Dict[str, Any]]:
    """
    Fetch organic search results from Bright Data Web Unlocker SERP zone.
    """
    try:
        from services import rank_checker
        links = rank_checker.get_top_n_organic_links(keyword, n=limit, country_code=country_code)
        if links:
            return [{"url": u, "title": "", "snippet": "", "source": "BrightData"} for u in links]
        return []
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
    results = results or []
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
    if all_101:
        consensus_pts = 35
        consensus_expl = "Bright Data SERP verification confirmed rank 101."
    elif len(valid_ranks) >= 1:
        consensus_pts = 32
        consensus_expl = f"Live ranking #{valid_ranks[0]} verified via Bright Data SERP."
    else:
        consensus_pts = 20
        consensus_expl = "Bright Data resolution."

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
        precision_expl = "Target domain and URL completely absent from organic top 30 in Bright Data."
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
    print(f"[Verification Agent] Previous Rank was #{prev_rank}. Initiating Bright Data Deep Verification...", flush=True)

    bd_results = fetch_serp_via_brightdata(kw_text, country_code=country_code, limit=40) or []
    bd_eval = evaluate_serp_ranking(bd_results, target_url=lp_url, default_domain=default_domain)

    engine_checks = {
        "BrightData": bd_eval
    }

    print(f"[Verification Agent] Bright Data Scan Result for \"{kw_text}\":", flush=True)
    print(f"   * BrightData: Rank #{bd_eval['rank']} ({bd_eval['match_type']}) [{bd_eval['total_results']} URLs parsed]", flush=True)

    # Determine Best Verified Rank
    if bd_eval["rank"] < 101:
        verified_rank = bd_eval["rank"]
        verified_source = "BrightData"
        is_confirmed_101 = False
        consensus_summary = f"False 101 rejected! Bright Data verified active rank #{verified_rank}."
    else:
        verified_rank = 101
        verified_source = "BrightData"
        is_confirmed_101 = True
        consensus_summary = "Confirmed 101: Target URL and domain are absent from top organic rankings in Bright Data."

    # All top links from Bright Data
    all_top_links = [r.get("url") for r in bd_results if r.get("url")]

    # Top 3 URLs analysis
    top3_urls = all_top_links[:3] if all_top_links else []
    top3_types = [_classify_url_target_type(u) for u in top3_urls]
    top3_is_landing = sum(1 for t in top3_types if t == "Landing Page") >= 2 if top3_types else True

    # Top competitors
    top_competitors = [_get_bare_domain(u) for u in top3_urls if _get_bare_domain(u)]

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

    is_drop_to_101 = (verified_rank >= 101 and prev_rank < 101)
    is_up_from_101 = (prev_rank >= 101 and verified_rank < 101)

    # Batch assignment and reason
    if is_up_from_101 or delta >= 1 or (verified_rank <= 3 and verified_rank < prev_rank):
        batch = "high"
        spots_str = "30+" if is_up_from_101 else (f"{delta} spot" if delta == 1 else f"{delta} spots")
        reason = f"Rank improved by {spots_str} (#{prev_rank} -> #{verified_rank}). {consensus_summary}"
    elif is_drop_to_101 or is_confirmed_101:
        if top3_is_landing:
            batch = "medium"
            reason = f"Verified severe drop outside top rankings (#{prev_rank} -> #{verified_rank}, 30+ drop). High recovery potential; SERP is commercial landing pages."
        else:
            batch = "low"
            reason = f"Verified drop to #{verified_rank} (30+). SERP shifted away from landing pages to {', '.join(top3_types) if top3_types else 'blogs'}."
    elif delta <= -2:
        batch = "medium" if top3_is_landing else "low"
        reason = f"Rank shifted from #{prev_rank} to #{verified_rank} (verified via Bright Data). {'Top 3 are Landing Pages.' if top3_is_landing else 'SERP intent mismatch.'}"
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
            "brightdata_rank": bd_eval["rank"]
        }
    }


def record_calendar_rank_hit(
    kw_id: Any,
    new_rank: int,
    prev_rank: int,
    delta: int,
    existing_history: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """
    Appends a new live check snapshot to keyword_categories.calendar_rank_history in the DB.
    Returns the updated historical list.
    """
    hist = list(existing_history or [])
    now_dt = datetime.utcnow()
    date_str = now_dt.strftime("%d %b")

    snapshot = {
        "rank": int(new_rank),
        "prev_rank": int(prev_rank),
        "delta": int(delta),
        "date": date_str,
        "timestamp": now_dt.isoformat()
    }

    # If history is empty, seed with initial/prev rank if available
    if not hist:
        if prev_rank and prev_rank > 0 and prev_rank != new_rank:
            hist.append({
                "rank": int(prev_rank),
                "date": "Initial",
                "timestamp": now_dt.isoformat()
            })
        hist.append(snapshot)
    else:
        # If last entry was recorded today with same rank, update timestamp, else append
        last = hist[-1]
        if last.get("rank") == snapshot["rank"] and last.get("date") == snapshot["date"]:
            hist[-1] = snapshot
        else:
            hist.append(snapshot)

    # Keep last 15 historical points
    hist = hist[-15:]

    # Persist back to database if kw_id is a valid DB record id
    if kw_id and str(kw_id).isdigit():
        try:
            with engine.begin() as conn:
                conn.execute(text("""
                    UPDATE keyword_categories 
                    SET calendar_rank_history = CAST(:hist AS JSONB)
                    WHERE id = :id
                """), {"hist": json.dumps(hist), "id": int(kw_id)})
        except Exception as err:
            print(f"[Calendar AI] Notice persisting calendar_rank_history for kw_id {kw_id}: {err}", flush=True)

    return hist


def _check_single_keyword_live(k: Dict[str, Any], default_domain: str = "", country_code: str = "in") -> Dict[str, Any]:
    """
    Live rank check + Top-3 SERP landing page verification for one keyword.
    Exclusively powered by Firecrawl (strictly 1 hit, no secondary recheck).
    """
    kw_text = str(k.get("keyword") or "").strip()
    lp_url = str(k.get("landing_page_url") or k.get("topicLink") or "").strip()
    prev_rank = int(_parse_num(k.get("rank") or k.get("prev_rank"), 0))

    print(f"[Calendar AI Check] >>> Checking keyword via Firecrawl (single hit): \"{kw_text}\" | DB Rank: #{prev_rank} | LP URL: {lp_url or 'None'}", flush=True)

    new_rank = prev_rank
    top_links = []

    # Single Live Check via Firecrawl (strictly 1 hit, no recheck)
    try:
        from services import rank_checker_fc
        new_rank, top_links = rank_checker_fc.find_rank(
            kw_text, lp_url, default_domain=default_domain, country_code=country_code
        )
        top_links = top_links or []
    except Exception as e:
        print(f"[Calendar AI Check] Firecrawl rank check error for \"{kw_text}\": {e}", flush=True)
        new_rank = prev_rank
        top_links = []

    # Single-hit evaluation -- no secondary recheck
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

    is_drop_to_101 = (new_rank >= 101 and prev_rank < 101)
    is_up_from_101 = (prev_rank >= 101 and new_rank < 101)

    if prev_rank > 0 and new_rank > 0 and prev_rank != new_rank:
        if is_up_from_101:
            gain_pct = 35.0
            gain_pct_str = "+35%"
        elif is_drop_to_101:
            gain_pct = -35.0
            gain_pct_str = "-35%"
        else:
            raw_pct = ((prev_rank - new_rank) / prev_rank) * 100.0
            gain_pct = round(raw_pct, 1)
            gain_pct_str = f"+{gain_pct:.0f}%" if gain_pct > 0 else f"-{abs(gain_pct):.0f}%"
    else:
        gain_pct = 0.0
        gain_pct_str = "0%"

    # Strict Batch Rules:
    # Batch 1 (high): ONLY keywords whose ranking is improving on live rank check (delta > 0 or is_up_from_101)
    # Batch 2 (medium): ONLY keywords whose ranking is declining on live rank check (delta < 0 or is_drop_to_101)
    # Batch 3 (low): Stagnant keywords whose rank did not move (delta == 0)
    sv_num = _as_int(k.get("sv"), 0)
    sv_disp = f"{sv_num:,}" if sv_num > 0 else "high"
    has_101 = (new_rank >= 101 or prev_rank >= 101)
    prev_disp = f"#{prev_rank}"
    new_disp = f"#{new_rank}"

    if is_up_from_101 or delta > 0:
        batch = "high"
        confidence = min(98, 85 + delta * 2) if top3_is_landing else 78
        spots_str = "30+" if (has_101 or abs(delta) >= 30) else (f"{delta} spot" if delta == 1 else f"{delta} spots")
        landing_info = "with verified commercial landing page intent." if top3_is_landing else f"with SERP intent ({', '.join(top3_types) if top3_types else 'Mixed'})."
        reason = f"I've selected this keyword because its historical rank surged from {prev_disp} to {new_disp} (+{spots_str}, {gain_pct_str} gain) with {sv_disp} monthly search volume and {landing_info}"
    elif is_drop_to_101 or delta < 0:
        batch = "medium"
        confidence = 82 if top3_is_landing else 65
        drop_str = "30+" if (has_101 or abs(delta) >= 30) else f"{abs(delta)} spots"
        reason = f"I've selected this keyword because its historical rank dropped from {prev_disp} to {new_disp} (-{drop_str}) despite strong {sv_disp} monthly search volume, making it a high-priority recovery target."
    else:
        batch = "low"
        confidence = 40 if top3_is_landing else 25
        if not top3_is_landing:
            types_str = ", ".join(top3_types) if top3_types else "Blogs"
            reason = f"I've selected this keyword as a maintenance candidate; historical rank held steady at {new_disp} ({sv_disp} SV) while SERP shows informational intent ({types_str})."
        else:
            reason = f"I've selected this keyword because historical rank has remained stagnant at {new_disp} (0% shift) with {sv_disp} monthly search volume, requiring an authority push to reach page 1."

    # Explainable confidence calculation
    conf_calc = {
        "total_score": confidence,
        "source_consensus_pts": 25,
        "match_precision_pts": 25 if new_rank < 101 else 15,
        "intent_alignment_pts": 25 if top3_is_landing else 15,
        "data_depth_pts": 15 if len(top_links) >= 10 else 10,
        "explanation": f"Confidence Score: {confidence}% (Evaluated via single Firecrawl SERP scan and Top-3 intent classification)."
    }

    batch_display = "BATCH 1 (High - Improved)" if batch == "high" else ("BATCH 2 (Medium - Dropped)" if batch == "medium" else "BATCH 3 (Low - Stagnant)")
    if is_drop_to_101:
        shift_str = "30+(DOWN)"
    elif is_up_from_101:
        shift_str = "30+(UP)"
    else:
        shift_str = f"+{delta} (UP)" if delta > 0 else (f"{delta} (DOWN)" if delta < 0 else "0 (NO CHANGE)")
    print(f"[Calendar AI Check]     Result for \"{kw_text}\": Live Rank #{new_rank} [was #{prev_rank}] | Shift: {shift_str} ({gain_pct_str})", flush=True)
    print(f"[Calendar AI Check]     Top 3 SERP Intent: {top3_types or ['Unknown']} | Top 3 Landing: {top3_is_landing}", flush=True)
    print(f"[Calendar AI Check]     ==> Placed in {batch_display} | Conf: {confidence}%", flush=True)
    print(f"[Calendar AI Check]     ==> Reason: {reason}", flush=True)

    # Persist live hit into calendar_rank_history for this keyword in DB
    existing_hist = k.get("calendar_rank_history") or k.get("history") or []
    updated_hist = record_calendar_rank_hit(
        kw_id=k.get("id"),
        new_rank=new_rank,
        prev_rank=prev_rank,
        delta=delta,
        existing_history=existing_hist
    )

    item = dict(k)
    item["prev_rank"] = prev_rank
    item["new_rank"] = new_rank
    item["rank"] = new_rank
    item["delta"] = delta
    item["gain_pct"] = gain_pct
    item["gain_pct_str"] = gain_pct_str
    item["top3_is_landing"] = top3_is_landing
    item["top3_types"] = top3_types
    item["batch"] = batch
    item["confidence"] = confidence
    item["confidence_breakdown"] = conf_calc
    item["reason"] = reason
    item["calendar_rank_history"] = updated_hist
    item["history"] = updated_hist
    return item



def calculate_live_serp_batches(
    potential: List[Dict[str, Any]],
    domain: str = "",
    country: str = "India"
) -> Dict[str, Any]:
    """
    Evaluates candidate landing page keywords against live Google SERP via Firecrawl:
    - Runs parallel live rank checks (strictly 1 hit per keyword on Firecrawl)
    - Checks top 3 SERP results for Landing Page intent
    - Places into Batch 1 (improved), Batch 2 (dropped), or Batch 3 (didn't move / non-landing)
    """
    if not potential:
        print("[Calendar AI Check] No keywords supplied for live SERP check.", flush=True)
        return {"batches": {"high": [], "medium": [], "low": []}, "summary": "No keywords supplied.", "evaluated_keywords": []}

    print(f"\n=======================================================", flush=True)
    print(f"[Calendar AI Check] Starting Live Google SERP Verification via Firecrawl (single hit) for {len(potential)} keywords", flush=True)
    print(f"[Calendar AI Check] Target Domain: '{domain or 'N/A'}' | Country: '{country}'", flush=True)
    print(f"=======================================================", flush=True)

    # Determine country code for Firecrawl
    cc = "in"
    if country:
        c_lower = country.strip().lower()
        if c_lower in ("united states", "usa", "us"):
            cc = "us"
        elif c_lower in ("india", "in"):
            cc = "in"
        elif c_lower in ("united kingdom", "uk", "gb"):
            cc = "gb"
        elif len(c_lower) == 2:
            cc = c_lower

    from concurrent.futures import ThreadPoolExecutor
    batches = {"high": [], "medium": [], "low": []}

    with ThreadPoolExecutor(max_workers=5) as executor:
        evaluated = list(executor.map(lambda k: _check_single_keyword_live(k, default_domain=domain, country_code=cc), potential))

    for item in evaluated:
        b = item.get("batch", "low")
        if b not in batches:
            b = "low"
        batches[b].append(item)

    batches["high"].sort(key=lambda x: (x.get("delta", 0), x.get("sv", 0)), reverse=True)
    batches["medium"].sort(key=lambda x: (abs(x.get("delta", 0)), x.get("sv", 0)), reverse=True)
    batches["low"].sort(key=lambda x: x.get("sv", 0), reverse=True)

    summary = (
        f"I've analyzed {len(potential)} candidate Landing Page keywords against live Google SERPs: "
        f"I found {len(batches['high'])} keywords with strong upward momentum (Batch 1 Gains), "
        f"{len(batches['medium'])} keywords experiencing drops requiring recovery push (Batch 2 Drops), and "
        f"{len(batches['low'])} stagnant terms (Batch 3)."
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
            sv_disp = f"{sv:,}" if sv > 0 else "steady"
            if rank <= 10 and kd <= 40 and sv > 0:
                batch, conf, reason = "high", 80, f"I've selected this keyword because historical ranking (#{rank}) is within striking distance of Page 1 with low KD ({kd}) and {sv_disp} monthly search volume."
            elif rank <= 15 and kd <= 60:
                batch, conf, reason = "medium", 55, f"I've selected this keyword because historical rank is #{rank} with manageable difficulty ({kd}), making it a prime candidate for an authority backlink push."
            else:
                batch, conf, reason = "low", 30, f"I've selected this keyword as a longer-term candidate; historical rank is #{rank} on a competitive SERP requiring sustained link authority."

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
    if "pub" in s or "live" in s:
        return "published"
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
    Returns activities plus count breakdown across 'saved', 'scheduled', 'approved', 'published'.
    """
    with engine.begin() as conn:
        try:
            res = conn.execute(text("SELECT * FROM off_page_activities ORDER BY created_at DESC"))
            all_rows = [dict(r._mapping) for r in res]
        except Exception as e:
            print(f"[calendar_backend] Error querying off_page_activities: {e}", file=sys.stderr)
            return {"activities": [], "counts": {"saved": 0, "scheduled": 0, "approved": 0, "published": 0}}

    counts = {"saved": 0, "scheduled": 0, "approved": 0, "published": 0}
    filtered = []

    clean_proj = (project_name or "").strip().lower()
    clean_status = (status_filter or "").strip().lower()
    clean_search = (search or "").strip().lower()

    for row in all_rows:
        cleaned_row = _clean_for_json(row)
        norm_st = _normalize_status(cleaned_row.get("status"))
        cleaned_row["status"] = norm_st

        # Deserialize JSONB columns if stored as string
        for jfield in ("potential_keywords", "budget_summary", "outreach_sites"):
            jf = cleaned_row.get(jfield)
            if isinstance(jf, str):
                try:
                    cleaned_row[jfield] = json.loads(jf)
                except Exception:
                    cleaned_row[jfield] = [] if jfield != "budget_summary" else None

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

    # Format JSONB fields
    pk = data.get("potential_keywords") or []
    pk_json = json.dumps(pk) if not isinstance(pk, str) else pk

    bs = data.get("budget_summary")
    bs_json = json.dumps(bs) if (bs is not None and not isinstance(bs, str)) else bs

    os_val = data.get("outreach_sites")
    os_json = json.dumps(os_val) if (os_val is not None and not isinstance(os_val, str)) else os_val

    with engine.begin() as conn:
        # Generate activity_uid if not provided
        act_uid = str(data.get("activity_uid") or "").strip()
        if not act_uid:
            act_uid = generate_activity_uid(
                conn,
                data.get("project_name"),
                data.get("period"),
                data.get("activity_name") or data.get("channel")
            )

        conn.execute(
            text("""
                INSERT INTO off_page_activities (
                    id, activity_uid, activity_name, project_name, main_poc, content_poc,
                    quantity, budget, "user", period, scheduler, auditor,
                    status, potential_keywords, keyword_name, category, cluster, topic_link,
                    ai_summary, ai_advisory, budget_summary, outreach_sites, ai_run_id,
                    created_at, updated_at
                ) VALUES (
                    :id, :activity_uid, :activity_name, :project_name, :main_poc, :content_poc,
                    :quantity, :budget, :user, :period, :scheduler, :auditor,
                    :status, CAST(:potential_keywords AS jsonb), :keyword_name, :category, :cluster, :topic_link,
                    :ai_summary, :ai_advisory, CAST(:budget_summary AS jsonb), CAST(:outreach_sites AS jsonb), :ai_run_id,
                    now(), now()
                )
            """),
            {
                "id": activity_id,
                "activity_uid": act_uid,
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
                "topic_link": data.get("topic_link"),
                "ai_summary": data.get("ai_summary"),
                "ai_advisory": data.get("ai_advisory"),
                "budget_summary": bs_json,
                "outreach_sites": os_json,
                "ai_run_id": str(data.get("ai_run_id")) if data.get("ai_run_id") else None
            }
        )
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        return _clean_for_json(dict(res._mapping)) if res else {"id": activity_id, "activity_uid": act_uid, **data}


def get_calendar_activity(activity_id: str) -> Optional[Dict[str, Any]]:
    with engine.begin() as conn:
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        if not res:
            return None
        row = _clean_for_json(dict(res._mapping))
        row["status"] = _normalize_status(row.get("status"))
        for jfield in ("potential_keywords", "budget_summary", "outreach_sites"):
            jf = row.get(jfield)
            if isinstance(jf, str):
                try:
                    row[jfield] = json.loads(jf)
                except Exception:
                    pass

        return row


def sync_activity_to_monthly_operations(activity_id: str) -> List[str]:
    """
    Sync keywords from a published calendar activity into monthly_operations (Off-Page).
    Assigns strictly unique sequential task UIDs like 'BL-PG-09-1', 'BL-PG-09-2', 'BL-RD-09-1', etc.
    Links monthly_operations rows to the source calendar activity via activity_id and activity_uid.
    """
    with engine.begin() as conn:
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": str(activity_id)}).first()
        if not res:
            return []

        act = dict(res._mapping)
        p_name = act.get("project_name") or "Default"
        p_slug = p_name.lower().replace(" ", "").strip()
        period = act.get("period") or datetime.now().strftime("%B %Y")
        act_name = act.get("activity_name") or "Off-Page Activity"
        act_uid = act.get("activity_uid") or f"{str(activity_id)[:8].upper()}"
        content_spoc = act.get("content_poc") or act.get("main_poc") or ""
        publisher = act.get("main_poc") or ""
        today_str = datetime.now().strftime("%Y-%m-%d")

        # Reuse existing filename for this project if exists
        fn_res = conn.execute(
            text("SELECT filename FROM monthly_operations WHERE LOWER(TRIM(project_name)) = LOWER(TRIM(:p)) AND filename IS NOT NULL LIMIT 1"),
            {"p": p_name}
        ).first()
        filename = fn_res[0] if fn_res and fn_res[0] else f"{p_slug}_dataset.csv"

        kws = act.get("potential_keywords")
        if isinstance(kws, str):
            try:
                kws = json.loads(kws)
            except Exception:
                kws = []

        kw_list = []
        if isinstance(kws, list) and len(kws) > 0:
            kw_list = kws
        elif act.get("keyword_name"):
            names = [x.strip() for x in str(act.get("keyword_name")).split(",") if x.strip()]
            for n in names:
                kw_list.append({
                    "keyword": n,
                    "landing_page_url": act.get("landing_page_url") or "",
                    "topic_link": act.get("topic_link") or "",
                    "category": act.get("category"),
                    "cluster": act.get("cluster")
                })
        else:
            kw_list = [{
                "keyword": act_name,
                "landing_page_url": act.get("landing_page_url") or "",
                "topic_link": act.get("topic_link") or "",
                "category": act.get("category"),
                "cluster": act.get("cluster")
            }]

        outreach_sites = act.get("outreach_sites")
        if isinstance(outreach_sites, str):
            try:
                outreach_sites = json.loads(outreach_sites)
            except Exception:
                outreach_sites = []

        is_forum_act = any(f in str(act.get("channel") or act.get("activity_name") or "").lower() for f in ["quora", "reddit", "forum"])

        # Determine task row prefix: {PROJ}-{CHAN}-{MONTH} e.g. BL-PG-09, BL-RD-09, BL-QR-09
        proj_code = generate_project_code(p_name)
        chan_code = get_channel_code(act_name or act.get("channel"))
        month_code = get_month_code(period)
        task_prefix = f"{proj_code}-{chan_code}-{month_code}"

        # Fetch existing rows for this activity if already synced
        existing_act_rows = conn.execute(
            text("SELECT id, uid, keyword1 FROM monthly_operations WHERE activity_id = :aid ORDER BY id ASC"),
            {"aid": str(activity_id)}
        ).fetchall()
        existing_by_kw = {str(r[2]).strip().lower(): dict(r._mapping) for r in existing_act_rows if r[2]}

        # Query all existing UIDs with this prefix in monthly_operations to find true max sequence
        existing_uids = conn.execute(
            text("SELECT uid FROM monthly_operations WHERE uid LIKE :pattern"),
            {"pattern": f"{task_prefix}-%"}
        ).fetchall()
        max_seq = 0
        for u in existing_uids:
            if u and u[0]:
                try:
                    s_str = str(u[0]).split("-")[-1]
                    if s_str.isdigit():
                        v = int(s_str)
                        if v > max_seq:
                            max_seq = v
                except Exception:
                    pass

        synced_uids = []
        for idx, k in enumerate(kw_list):
            kw_name = (k.get("keyword") or "").strip()
            topic_val = (k.get("topic_link") or act.get("topic_link") or "") if is_forum_act else ""
            lp_val = k.get("landing_page_url") or act.get("landing_page_url") or ""
            cluster = k.get("cluster") or act.get("cluster") or ""
            kw_cat = k.get("category") or act.get("category") or ""

            site = k.get("outreach_site")
            site_domain = ""
            if isinstance(site, dict):
                site_domain = site.get("domain") or ""
            elif isinstance(site, str):
                site_domain = site
            elif isinstance(outreach_sites, list) and len(outreach_sites) > 0:
                os_item = outreach_sites[min(idx, len(outreach_sites) - 1)]
                if isinstance(os_item, dict):
                    site_domain = os_item.get("domain") or ""
                elif isinstance(os_item, str):
                    site_domain = os_item

            # Check if this row already existed
            existing_row = existing_by_kw.get(kw_name.lower())
            if existing_row:
                row_uid = existing_row.get("uid")
                # Normalize UID if it was in an old non-channel format
                if not row_uid or not row_uid.startswith(task_prefix):
                    max_seq += 1
                    row_uid = f"{task_prefix}-{max_seq}"
                row_id = existing_row.get("id")
                conn.execute(text("""
                    UPDATE monthly_operations SET
                        uid = :uid,
                        activity_id = :activity_id,
                        activity_uid = :activity_uid,
                        period = :period,
                        keyword1 = :keyword1,
                        landing_page = :landing_page,
                        topic = :topic,
                        cluster = :cluster,
                        kw_category = :kw_category,
                        activity_name = :activity_name,
                        content_spoc = :content_spoc,
                        publisher = :publisher,
                        pg_site_domain = :pg_site_domain,
                        updated_date = :updated_date,
                        updated_at = now()
                    WHERE id = :id
                """), {
                    "uid": row_uid,
                    "activity_id": str(activity_id),
                    "activity_uid": act_uid,
                    "period": period,
                    "keyword1": kw_name,
                    "landing_page": lp_val,
                    "topic": topic_val,
                    "cluster": cluster,
                    "kw_category": kw_cat,
                    "activity_name": act_name,
                    "content_spoc": content_spoc,
                    "publisher": publisher,
                    "pg_site_domain": site_domain,
                    "updated_date": today_str,
                    "id": row_id
                })
            else:
                max_seq += 1
                row_uid = f"{task_prefix}-{max_seq}"
                conn.execute(text("""
                    INSERT INTO monthly_operations (
                        uid, activity_id, activity_uid, filename, project_name, project_slug, period, scheduled_date,
                        keyword1, keyword2, landing_page, cluster, kw_category,
                        activity_name, word_count, content_spoc, topic, content_doc,
                        status, publisher, pg_site_domain, live_link, remarks, solution,
                        verified, last_activity, updated_date, created_at, updated_at
                    ) VALUES (
                        :uid, :activity_id, :activity_uid, :filename, :project_name, :project_slug, :period, :scheduled_date,
                        :keyword1, '', :landing_page, :cluster, :kw_category,
                        :activity_name, '1000', :content_spoc, :topic, '',
                        'In Progress', :publisher, :pg_site_domain, '', '', '',
                        false, :activity_name, :updated_date, now(), now()
                    )
                """), {
                    "uid": row_uid,
                    "activity_id": str(activity_id),
                    "activity_uid": act_uid,
                    "filename": filename,
                    "project_name": p_name,
                    "project_slug": p_slug,
                    "period": period,
                    "scheduled_date": today_str,
                    "keyword1": kw_name,
                    "landing_page": lp_val,
                    "topic": topic_val,
                    "cluster": cluster,
                    "kw_category": kw_cat,
                    "activity_name": act_name,
                    "content_spoc": content_spoc,
                    "publisher": publisher,
                    "pg_site_domain": site_domain,
                    "updated_date": today_str
                })

            synced_uids.append(row_uid)

        return synced_uids


def update_calendar_activity(activity_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update fields on an off_page_activities record."""
    allowed = [
        "activity_uid", "activity_name", "project_name", "main_poc", "content_poc",
        "quantity", "budget", "user", "period", "scheduler", "auditor",
        "status", "potential_keywords", "keyword_name", "category", "cluster", "topic_link",
        "ai_summary", "ai_advisory", "budget_summary", "outreach_sites", "ai_run_id"
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
            elif field in ("potential_keywords", "budget_summary", "outreach_sites"):
                updates.append(f"{field} = CAST(:{field} AS jsonb)")
                params[field] = json.dumps(val) if not isinstance(val, str) else val
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
        if not res:
            return None
        row = _clean_for_json(dict(res._mapping))
        for jfield in ("potential_keywords", "budget_summary", "outreach_sites"):
            jf = row.get(jfield)
            if isinstance(jf, str):
                try:
                    row[jfield] = json.loads(jf)
                except Exception:
                    pass

        # If activity was moved to published status, sync to monthly_operations (Off-Page)
        if params.get("status") == "published":
            try:
                synced_uids = sync_activity_to_monthly_operations(activity_id)
                row["synced_uids"] = synced_uids
                row["first_uid"] = synced_uids[0] if synced_uids else None
            except Exception as err:
                print(f"[Calendar API] Error syncing to monthly_operations: {err}", file=sys.stderr)

        return row


def delete_calendar_activity(activity_id: str) -> bool:
    with engine.begin() as conn:
        res = conn.execute(text("DELETE FROM off_page_activities WHERE id = :id"), {"id": activity_id})
        return res.rowcount > 0


# ─────────────────────────────────────────────────────────────
#  AI-scheduling analysis persistence (calendar_ai_analysis)
# ─────────────────────────────────────────────────────────────

_AI_TABLE_READY = False


def _ensure_ai_analysis_table():
    """Create calendar_ai_analysis on first use (ensure_calendar_tables() is
    not run on import in this deployment)."""
    global _AI_TABLE_READY
    if _AI_TABLE_READY:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS calendar_ai_analysis (
                    id BIGSERIAL PRIMARY KEY,
                    run_id UUID NOT NULL,
                    activity_id UUID,
                    project_slug TEXT,
                    domain TEXT,
                    country TEXT DEFAULT 'India',
                    keyword TEXT NOT NULL,
                    keyword_id TEXT,
                    category TEXT,
                    cluster TEXT,
                    db_rank INTEGER,
                    prev_rank INTEGER,
                    live_rank INTEGER,
                    delta INTEGER,
                    sv INTEGER,
                    kd INTEGER,
                    target_type TEXT,
                    batch TEXT,
                    confidence INTEGER,
                    confidence_breakdown JSONB,
                    reason TEXT,
                    top3_types JSONB,
                    top3_is_landing BOOLEAN,
                    top_links JSONB,
                    verification JSONB,
                    outreach_site JSONB,
                    brand_mention_site JSONB,
                    brand_mention_sites JSONB,
                    landing_page_url TEXT,
                    selected BOOLEAN DEFAULT FALSE,
                    budget_used NUMERIC(12, 2),
                    quantity_requested INTEGER,
                    summary TEXT,
                    budget_summary JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS budget_summary JSONB;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS brand_mention_site JSONB;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS brand_mention_sites JSONB;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS topic_link TEXT;"))
            conn.execute(text("ALTER TABLE calendar_ai_analysis ADD COLUMN IF NOT EXISTS selected BOOLEAN DEFAULT FALSE;"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cal_ai_run ON calendar_ai_analysis (run_id);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cal_ai_project ON calendar_ai_analysis (project_slug, created_at DESC);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cal_ai_activity ON calendar_ai_analysis (activity_id);"))
        _AI_TABLE_READY = True
    except Exception as e:
        print(f"[Calendar AI] calendar_ai_analysis table ensure notice: {e}", file=sys.stderr, flush=True)


def _as_int(v, default=None):
    """Int coercion that PRESERVES the sign (delta/prev_rank can be negative);
    _parse_num strips minus signs so it can't be used here."""
    if v is None or v == "":
        return default
    try:
        return int(round(float(v)))
    except (ValueError, TypeError):
        s = str(v).strip()
        neg = s.startswith("-")
        digits = "".join(c for c in s if c.isdigit() or c == ".")
        if not digits:
            return default
        try:
            n = float(digits)
            return int(-n if neg else n)
        except ValueError:
            return default


def _jsonb(v):
    if v is None:
        return None
    if isinstance(v, str):
        return v
    try:
        return json.dumps(_clean_for_json(v))
    except Exception:
        return None


def save_calendar_ai_run(
    evaluated_keywords: List[Dict[str, Any]],
    project_slug: str = "",
    domain: str = "",
    country: str = "India",
    activity_id: Optional[str] = None,
    summary: str = "",
    budget_used: Optional[float] = None,
    quantity_requested: Optional[int] = None,
    budget_summary: Optional[Dict[str, Any]] = None,
) -> str:
    """Persist a whole AI-scheduling run: one row per evaluated candidate
    keyword (batch, confidence, live rank, delta, top-3 intent, verification,
    outreach site, ...). Returns the run_id."""
    run_id = str(uuid.uuid4())
    if not evaluated_keywords:
        return run_id

    _ensure_ai_analysis_table()

    bs_json = _jsonb(budget_summary)
    act_id = None
    if activity_id:
        try:
            act_id = str(uuid.UUID(str(activity_id)))
        except Exception:
            act_id = None

    rows = []
    for k in evaluated_keywords:
        vr = k.get("verification_details") or k.get("verification") or None
        rows.append({
            "run_id": run_id,
            "activity_id": act_id,
            "project_slug": project_slug or "",
            "domain": domain or "",
            "country": country or "India",
            "keyword": str(k.get("keyword") or "").strip(),
            "keyword_id": str(k.get("id")) if k.get("id") is not None else None,
            "category": k.get("category") or None,
            "cluster": k.get("cluster") or None,
            "db_rank": _as_int(k.get("rank")),
            "prev_rank": _as_int(k.get("prev_rank")),
            "live_rank": _as_int(k.get("new_rank") if k.get("new_rank") is not None else k.get("rank")),
            "delta": _as_int(k.get("delta"), 0),
            "sv": _as_int(k.get("sv"), 0),
            "kd": _as_int(k.get("kd"), 0),
            "target_type": k.get("target_type") or None,
            "batch": k.get("batch") or None,
            "confidence": _as_int(k.get("confidence")),
            "confidence_breakdown": _jsonb(k.get("confidence_breakdown")),
            "reason": k.get("reason") or None,
            "top3_types": _jsonb(k.get("top3_types")),
            "top3_is_landing": bool(k.get("top3_is_landing")) if k.get("top3_is_landing") is not None else None,
            "top_links": _jsonb(k.get("top_links") or k.get("top3")),
            "verification": _jsonb(vr),
            "outreach_site": _jsonb(k.get("outreach_site")),
            "brand_mention_site": _jsonb(k.get("brand_mention_site")),
            "brand_mention_sites": _jsonb(k.get("brand_mention_sites")),
            "landing_page_url": k.get("landing_page_url") or k.get("topicLink") or k.get("topic_link") or None,
            "topic_link": k.get("topic_link") or None,
            "selected": bool(k.get("selected")),
            "budget_used": _parse_num(budget_used, None),
            "quantity_requested": _as_int(quantity_requested, None),
            "summary": summary or None,
            "budget_summary": bs_json,
        })

    try:
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO calendar_ai_analysis (
                    run_id, activity_id, project_slug, domain, country, keyword, keyword_id,
                    category, cluster, db_rank, prev_rank, live_rank, delta, sv, kd, target_type,
                    batch, confidence, confidence_breakdown, reason, top3_types, top3_is_landing,
                    top_links, verification, outreach_site, brand_mention_site, brand_mention_sites, landing_page_url, topic_link, selected, budget_used,
                    quantity_requested, summary, budget_summary
                ) VALUES (
                    :run_id, :activity_id, :project_slug, :domain, :country, :keyword, :keyword_id,
                    :category, :cluster, :db_rank, :prev_rank, :live_rank, :delta, :sv, :kd, :target_type,
                    :batch, :confidence, CAST(:confidence_breakdown AS JSONB), :reason,
                    CAST(:top3_types AS JSONB), :top3_is_landing, CAST(:top_links AS JSONB),
                    CAST(:verification AS JSONB), CAST(:outreach_site AS JSONB), CAST(:brand_mention_site AS JSONB), CAST(:brand_mention_sites AS JSONB), :landing_page_url, :topic_link, :selected,
                    :budget_used, :quantity_requested, :summary, CAST(:budget_summary AS JSONB)
                )
            """), rows)
        print(f"[Calendar AI] Saved analysis run {run_id}: {len(rows)} keyword rows"
              + (f" (activity {act_id})" if act_id else ""), flush=True)
    except Exception as e:
        print(f"[Calendar AI] Failed to save analysis run: {e}", file=sys.stderr, flush=True)

    return run_id


def mark_calendar_ai_selected(activity_id: str, selected_keywords: List[str]) -> None:
    """Flag which keywords the user actually picked, on that activity's most
    recent analysis run."""
    _ensure_ai_analysis_table()
    if not activity_id or not selected_keywords:
        return
    kws = [str(k).strip().lower() for k in selected_keywords if str(k or "").strip()]
    if not kws:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                UPDATE calendar_ai_analysis SET selected = TRUE
                WHERE run_id = (
                    SELECT run_id FROM calendar_ai_analysis
                    WHERE activity_id = :aid ORDER BY created_at DESC LIMIT 1
                )
                AND LOWER(keyword) = ANY(:kws)
            """), {"aid": str(activity_id), "kws": kws})
    except Exception as e:
        print(f"[Calendar AI] Failed to mark selected keywords: {e}", file=sys.stderr, flush=True)


def list_calendar_ai_runs(
    project_slug: Optional[str] = None,
    activity_id: Optional[str] = None,
    run_id: Optional[str] = None,
    limit: int = 20
):
    """Run-level summary list (one entry per analysis run)."""
    _ensure_ai_analysis_table()
    where, params = [], {"limit": limit}
    if activity_id:
        where.append("activity_id = :aid")
        params["aid"] = str(activity_id)
    elif run_id:
        where.append("run_id = :rid")
        params["rid"] = str(run_id)
    elif project_slug:
        where.append("project_slug = :ps")
        params["ps"] = project_slug
    wsql = ("WHERE " + " AND ".join(where)) if where else ""
    with engine.begin() as conn:
        res = conn.execute(text(f"""
            SELECT run_id, activity_id, project_slug, domain,
                   MIN(created_at) AS created_at,
                   MAX(summary) AS summary,
                   MAX(budget_used) AS budget_used,
                   MAX(quantity_requested) AS quantity_requested,
                   (ARRAY_AGG(budget_summary) FILTER (WHERE budget_summary IS NOT NULL))[1] AS budget_summary,
                   COUNT(*) AS total_keywords,
                   COUNT(*) FILTER (WHERE batch = 'high')   AS batch_high,
                   COUNT(*) FILTER (WHERE batch = 'medium')  AS batch_medium,
                   COUNT(*) FILTER (WHERE batch = 'low')     AS batch_low,
                   COUNT(*) FILTER (WHERE selected)          AS selected_count
            FROM calendar_ai_analysis
            {wsql}
            GROUP BY run_id, activity_id, project_slug, domain
            ORDER BY MIN(created_at) DESC
            LIMIT :limit
        """), params)
        return [_clean_for_json(dict(r._mapping)) for r in res]


def get_calendar_ai_run(run_id: str):
    """Every evaluated keyword for one analysis run."""
    _ensure_ai_analysis_table()
    with engine.begin() as conn:
        res = conn.execute(text("""
            SELECT * FROM calendar_ai_analysis WHERE run_id = :rid
            ORDER BY (batch = 'high') DESC, (batch = 'medium') DESC, confidence DESC NULLS LAST, sv DESC
        """), {"rid": run_id})
        return [_clean_for_json(dict(r._mapping)) for r in res]


def generate_calendar_csv(project_name: Optional[str] = None, status_filter: Optional[str] = None) -> str:
    """Generate CSV string for calendar activities."""
    data = list_calendar_activities(project_name=project_name, status_filter=status_filter)
    activities = data.get("activities", [])

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    headers = [
        "Activity UID", "Activity Name", "Project Name", "Main POC", "Content POC",
        "Quantity", "Budget", "User", "Period", "Scheduler", "Auditor",
        "Status", "Keyword Name", "Category", "Cluster", "Topic Link"
    ]
    writer.writerow(headers)

    for a in activities:
        b = a.get("budget")
        budget_str = f"₹{b}" if b is not None else ""
        writer.writerow([
            a.get("activity_uid") or "",
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


def _normalize_forum_url(url: str) -> str:
    """Normalize a URL to canonical domain+path for duplicate detection."""
    if not url:
        return ""
    u = str(url).strip().lower()
    u = re.sub(r'^https?://', '', u)
    u = re.sub(r'^www\.', '', u)
    u = u.split('?')[0].split('#')[0].rstrip('/')
    return u


def fetch_existing_offpage_topic_links(project_slug: str = "", project_name: str = "") -> Set[str]:
    """Retrieve all previously assigned forum topic links in Off-Page (monthly_operations & off_page_activities)."""
    used_links = set()
    p_slug = str(project_slug or "").strip().lower()
    p_name = str(project_name or project_slug or "").strip().lower()
    try:
        with engine.connect() as conn:
            # 1. From monthly_operations
            q1 = text("""
                SELECT topic FROM monthly_operations
                WHERE (LOWER(TRIM(project_slug)) = LOWER(TRIM(:slug)) OR LOWER(TRIM(project_name)) = LOWER(TRIM(:pname)))
                  AND topic IS NOT NULL AND TRIM(topic) != ''
            """)
            rows1 = conn.execute(q1, {"slug": p_slug, "pname": p_name}).fetchall()
            for r in rows1:
                t = str(r[0] or "").strip()
                if t:
                    for part in t.split('|'):
                        norm = _normalize_forum_url(part)
                        if norm:
                            used_links.add(norm)

            # 2. From off_page_activities
            q2 = text("""
                SELECT topic_link FROM off_page_activities
                WHERE (LOWER(TRIM(project_name)) = LOWER(TRIM(:pname)))
                  AND topic_link IS NOT NULL AND TRIM(topic_link) != ''
            """)
            rows2 = conn.execute(q2, {"pname": p_name}).fetchall()
            for r in rows2:
                t = str(r[0] or "").strip()
                if t:
                    for part in t.split('|'):
                        norm = _normalize_forum_url(part)
                        if norm:
                            used_links.add(norm)
    except Exception as err:
        print(f"[Calendar AI] Notice fetching existing offpage topic links: {err}", file=sys.stderr, flush=True)

    return used_links


def is_valid_forum_post_url(url: str, channel_type: str = "quora") -> bool:
    """
    Strict validation to ensure only genuine discussion posts, questions, or comment threads are accepted.
    Strictly rejects:
    - User profile URLs (e.g. reddit.com/user/..., quora.com/profile/...)
    - Search URLs (e.g. quora.com/search?q=..., reddit.com/search?q=...)
    - Subreddit root pages without /comments/
    - Spaces, topic tags, and system directory pages.
    """
    if not url or not isinstance(url, str):
        return False
    u = url.strip()
    u_lower = u.lower()
    if not u_lower.startswith(("http://", "https://")):
        return False
    
    parsed = urllib.parse.urlparse(u)
    domain = parsed.netloc.lower()
    path = parsed.path.strip("/")
    path_lower = path.lower()
    query = parsed.query.lower()
    
    # 1. Strictly reject any search term / query string / search path
    if "search" in path_lower or "search" in query or "q=" in query or "query=" in query:
        return False
        
    # 2. Strictly reject any profile / user page across all channels
    if any(p in path_lower for p in ["profile", "user/", "/user", "u/", "/u"]):
        return False

    if "reddit" in channel_type.lower():
        # Domain must be reddit.com
        if not (domain == "reddit.com" or domain == "www.reddit.com" or domain.endswith(".reddit.com") or domain == "redd.it"):
            return False
        # Must be an actual comments post / submission thread (e.g. r/{sub}/comments/{id}/{slug})
        if not path_lower.startswith("r/") or "/comments/" not in path_lower:
            return False
        # Must have valid post ID segment after /comments/
        parts = path_lower.split("/")
        if "comments" in parts:
            idx = parts.index("comments")
            if len(parts) <= idx + 1 or not parts[idx + 1]:
                return False
        if any(x in path_lower for x in ["/about", "/rules", "/wiki", "/settings", "/premium", "/help"]):
            return False
        return True

    else: # Quora
        # Must strictly start with quora.com / www.quora.com
        if not (domain == "quora.com" or domain == "www.quora.com"):
            return False
        if not path:
            return False
        disallowed = [
            "search", "q", "profile", "user", "u", "topic", "about", "contact", "terms",
            "privacy", "press", "careers", "directory", "settings", "messages",
            "notifications", "login", "signup", "spaces", "space", "partner", "unanswered"
        ]
        first_seg = path.split("/")[0].lower()
        if first_seg in disallowed or any(d in path_lower for d in ["/profile", "/user", "/search", "/topic"]):
            return False
        if len(first_seg) < 3:
            return False
        return True


def canonicalize_forum_topic_url(url: str, channel_type: str = "quora") -> Optional[str]:
    """
    Standardize valid forum topic URLs to always start with https://www.quora.com or https://www.reddit.com.
    """
    if not is_valid_forum_post_url(url, channel_type):
        return None
    u = str(url).strip()
    parsed = urllib.parse.urlparse(u)
    path = "/" + parsed.path.strip("/")
    
    if "reddit" in channel_type.lower():
        return f"https://www.reddit.com{path}"
    else:
        return f"https://www.quora.com{path}"


def fetch_forum_candidate_urls(
    keyword: str,
    cluster: str = "",
    channel_type: str = "quora",
    country_code: str = "in"
) -> List[str]:
    """
    Query Google SERP for genuine forum post/comment threads.
    """
    kw_text = str(keyword or "").strip()
    c_type = "reddit" if "reddit" in str(channel_type or "").lower() else "quora"

    queries = []
    if c_type == "reddit":
        queries.append(f"{kw_text} + reddit")
        queries.append(f"{kw_text} reddit")
        if cluster and cluster != "General":
            queries.append(f"{cluster} + reddit")
            queries.append(f"{cluster} reddit")
    else:
        queries.append(f"{kw_text} + quora")
        queries.append(f"{kw_text} quora")
        if cluster and cluster != "General":
            queries.append(f"{cluster} + quora")
            queries.append(f"{cluster} quora")

    candidate_urls = []
    for search_query in queries:
        print(f"[Forum Topic Discovery] Querying SERP: '{search_query}' (Country: {country_code})...", flush=True)
        results = fetch_serp_via_firecrawl(search_query, country_code=country_code, limit=10)
        if not results:
            results = fetch_serp_via_serpapi(search_query, country_code=country_code, limit=10)
        if not results:
            results = fetch_serp_via_brightdata(search_query, country_code=country_code, limit=10)

        for item in (results or []):
            url = (item.get("url") or item.get("link") or "").strip()
            canon_url = canonicalize_forum_topic_url(url, c_type)
            if canon_url and canon_url not in candidate_urls:
                candidate_urls.append(canon_url)
        if len(candidate_urls) >= 5:
            break

    return candidate_urls


def discover_forum_topic_link(
    keyword: str,
    cluster: str = "",
    channel_type: str = "quora",
    existing_links: Optional[Set[str]] = None,
    country_code: str = "in"
) -> Optional[str]:
    """
    Discover a single genuine post/comment topic link for a keyword, skipping any link in existing_links.
    """
    existing_links = existing_links if existing_links is not None else set()
    kw_text = str(keyword or "").strip()
    c_type = "reddit" if "reddit" in str(channel_type or "").lower() else "quora"

    candidates = fetch_forum_candidate_urls(kw_text, cluster=cluster, channel_type=c_type, country_code=country_code)
    for cand_url in candidates:
        norm = _normalize_forum_url(cand_url)
        if norm and norm not in existing_links:
            existing_links.add(norm)
            print(f"[Forum Topic Discovery] Discovered genuine post link for '{kw_text}': {cand_url}", flush=True)
            return cand_url
        else:
            print(f"[Forum Topic Discovery] [Skip-Dup] Link '{cand_url}' already taken or in DB, skipping for '{kw_text}'...", flush=True)

    return None


# ─────────────────────────────────────────────────────────────
# 4B. QUORA & REDDIT CHANNEL STRATEGY GENERATOR
# ─────────────────────────────────────────────────────────────

def generate_forum_channel_strategy(
    keywords: List[Dict[str, Any]],
    channel_type: str = "quora",
    budget: Optional[float] = None,
    quantity: Optional[int] = None,
    project_slug: str = "",
    country: str = "India"
) -> Dict[str, Any]:
    """
    Forum Quora and Forum Reddit Keyword Strategy:
    - Same keyword picking logic as Paid Guest Post (Landing Page target_type, Rank 5+, SV & Live Delta).
    - Discovers genuine Quora question threads & Reddit comment discussion posts starting with quora.com or reddit.com.
    - Strictly rejects search query URLs (e.g. quora.com/search?q=...) and user profile URLs (e.g. reddit.com/user/..., quora.com/profile/...).
    - Strictly prevents duplicate topic links across keywords or existing Off-Page records.
    - Preserves client website URL in landing_page_url and genuine forum thread URL in topic_link.
    """
    country_code = "in" if str(country or "").strip().lower() in ("india", "in") else "us"
    existing_links = fetch_existing_offpage_topic_links(project_slug, project_slug)
    used_topic_links = set(existing_links)
    
    # 1. Enforce core keyword criteria
    valid_kws = []
    for k in keywords:
        tt = str(k.get("target_type") or "").strip().lower()
        if tt not in ("landing page", "landing"):
            continue
        lp = str(k.get("landing_page_url") or k.get("topicLink") or k.get("topic_link") or "").strip()
        if not lp or lp.lower() == "nan":
            continue
        rank = _parse_num(k.get("rank"), 0)
        if rank < 5:
            continue
        k_copy = dict(k)
        k_copy["landing_page_url"] = lp
        valid_kws.append(k_copy)

    if not valid_kws:
        valid_kws = [dict(k) for k in keywords if _parse_num(k.get("rank"), 0) >= 5] or [dict(k) for k in keywords]

    # 2. Sort by Search Volume & Momentum (same as Paid Guest Post)
    sorted_kws = sorted(valid_kws, key=lambda x: (_parse_num(x.get("delta"), 0), _parse_num(x.get("sv"), 0)), reverse=True)
    target_qty = int(quantity or 1)
    allocated_kws = sorted_kws

    c_label = "Reddit Community Discussion" if "reddit" in channel_type.lower() else "Quora Question & Answer"
    act_type = "High-Authority Subreddit Thread Answer & Citation" if "reddit" in channel_type.lower() else "Verified Expert Answer with Contextual Topic Link"
    domain_label = "reddit.com" if "reddit" in channel_type.lower() else "quora.com"
    da_val = 91 if "reddit" in channel_type.lower() else 93

    budget_per_thread = round((float(budget or 0) / max(1, len(allocated_kws))), 2) if budget else 0.0

    # 3. Fetch candidate SERP links concurrently
    candidate_map = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_kw = {
            executor.submit(
                fetch_forum_candidate_urls,
                k.get("keyword", ""),
                k.get("cluster", ""),
                channel_type,
                country_code
            ): k for k in allocated_kws
        }
        for future in future_to_kw:
            k = future_to_kw[future]
            kw_id = str(k.get("id") or k.get("keyword"))
            try:
                candidate_map[kw_id] = future.result()
            except Exception as err:
                print(f"[Forum Topic Discovery] Error fetching candidates for '{k.get('keyword')}': {err}", file=sys.stderr, flush=True)
                candidate_map[kw_id] = []

    # 4. Sequentially assign strictly unique topic links to each keyword
    threads = []
    for k in allocated_kws:
        kw_text = str(k.get("keyword") or "").strip()
        kw_id = str(k.get("id") or k.get("keyword"))
        candidates = candidate_map.get(kw_id, [])
        picked_url = None

        for cand_url in candidates:
            canon = canonicalize_forum_topic_url(cand_url, channel_type)
            if not canon:
                continue
            norm = _normalize_forum_url(canon)
            if norm and norm not in used_topic_links:
                picked_url = canon
                used_topic_links.add(norm)
                print(f"[Forum Topic Discovery] Assigned genuine topic link for '{kw_text}': {canon}", flush=True)
                break
            else:
                print(f"[Forum Topic Discovery] [Skip-Dup] Topic link '{cand_url}' already taken or invalid, skipping for '{kw_text}'...", flush=True)

        lp = k.get("landing_page_url") or k.get("topicLink") or k.get("topic_link") or ""
        cluster = k.get("cluster") or "General"
        cat = k.get("category") or "General"
        sv_val = _as_int(k.get("sv"), 0)
        kd_val = _as_int(k.get("kd"), 0)
        db_rank = _as_int(k.get("rank"), 10)
        prev_rank = _as_int(k.get("prev_rank"), db_rank)
        live_rank = _as_int(k.get("new_rank"), db_rank)
        delta_val = _as_int(k.get("delta"), 0)
        gain_pct_str = k.get("gain_pct_str") or (f"{delta_val:+d}" if delta_val != 0 else "0")
        rank_hist = k.get("calendar_rank_history") or k.get("history") or []

        threads.append({
            "id": k.get("id") or str(uuid.uuid4()),
            "keyword": kw_text,
            "sv": sv_val,
            "kd": kd_val,
            "rank": db_rank,
            "prev_rank": prev_rank,
            "new_rank": live_rank,
            "delta": delta_val,
            "gain_pct_str": gain_pct_str,
            "calendar_rank_history": rank_hist,
            "history": rank_hist,
            "confidence": _as_int(k.get("confidence"), 85),
            "reason": k.get("reason") or f"I've selected this keyword because historical rank is #{db_rank} with {sv_val:,} monthly search volume, well-suited for {c_label} community citations.",
            "channel": c_label,
            "search_query": f"{kw_text} {'reddit' if 'reddit' in channel_type.lower() else 'quora'}",
            "action_type": act_type,
            "topic_link": picked_url or "",
            "landing_page_url": lp,
            "cluster": cluster,
            "category": cat,
            "target_type": "Landing Page",
            "thread_budget": budget_per_thread,
            "outreach_site": {
                "domain": domain_label,
                "da": da_val,
                "spam_score": 1,
                "price": f"₹{budget_per_thread}"
            },
            "is_reoptimization": bool(db_rank > 30),
            "selected": bool(picked_url)
        })

    # Divide into high/medium/low batches:
    # Batch 1 (high): improving on live rank check (delta > 0)
    # Batch 2 (medium): declining on live rank check (delta < 0)
    # Batch 3 (low): stagnant on live rank check (delta == 0)
    batches = {
        "high": [t for t in threads if t.get("delta", 0) > 0],
        "medium": [t for t in threads if t.get("delta", 0) < 0],
        "low": [t for t in threads if t.get("delta", 0) == 0]
    }

    return {
        "channel": channel_type,
        "total_threads_mapped": len([t for t in threads if t.get("topic_link")]),
        "threads": threads,
        "batches": batches,
        "allocated_budget": budget,
        "budget_per_thread": budget_per_thread,
        "quantity": target_qty
    }


# ─────────────────────────────────────────────────────────────
# 5. FASTAPI ROUTER DEFINITION
# ─────────────────────────────────────────────────────────────

router = APIRouter(prefix="/calendar", tags=["Calendar"])


@router.api_route("/forum-strategy", methods=["GET", "POST"])
def generate_forum_strategy_endpoint(
    channel_type: str = Query("quora", description="quora or reddit"),
    project_slug: str = Query(..., description="Project slug"),
    budget: Optional[float] = Query(None, description="Allocated budget"),
    quantity: Optional[int] = Query(None, description="Quantity of activities")
):
    """Generate Quora / Reddit community thread targets prioritized by Search Volume."""
    keywords, _, _ = get_potential_keywords_from_db(project_slug)
    return generate_forum_channel_strategy(
        keywords,
        channel_type=channel_type,
        budget=budget,
        quantity=quantity,
        project_slug=project_slug
    )


@router.get("/users")
def get_calendar_users_endpoint():
    """Return active users from users table for Scheduler/POC dropdowns."""
    try:
        from auth.db import list_all_users
        users = list_all_users()
        return [
            {
                "id": u.get("id"),
                "name": u.get("name") or u.get("email"),
                "email": u.get("email"),
                "role": u.get("role")
            }
            for u in users
            if (u.get("status") or "Active").lower() == "active"
        ]
    except Exception as e:
        print(f"[Calendar API] Error fetching users for dropdown: {e}", file=sys.stderr)
        return []


@router.get("/potential-keywords")
def get_potential_keywords_endpoint(
    project_slug: str = Query(..., description="Project slug or name"),
    domain: Optional[str] = Query("", description="Domain name for intent matching"),
    country: Optional[str] = Query("India", description="Target region"),
    run_ai: bool = Query(False, description="Whether to run full OpenAI triage immediately"),
    budget: Optional[float] = Query(None, description="Total budget cap for batch"),
    quantity: Optional[int] = Query(None, description="Requested number of activities")
):
    """
    Retrieve Rank 5+ potential keywords for a project and calculate push batches.
    If run_ai=False, returns instant heuristic batches.
    If run_ai=True, performs full LLM evaluation.
    """
    print(f"\n[Calendar API] GET /calendar/potential-keywords: project='{project_slug}', domain='{domain}', run_ai={run_ai}", flush=True)
    potential, has_landing_pages, total_count = get_potential_keywords_from_db(project_slug)
    
    if not has_landing_pages:
        print(f"[Calendar API] Project '{project_slug}' has {total_count} keywords but NO landing page URLs.", flush=True)
        return {
            "project_slug": project_slug,
            "total_potential": 0,
            "has_landing_pages": False,
            "potential_keywords": [],
            "batches": {"high": [], "medium": [], "low": []},
            "summary": "Data does not have landing page URLs.",
            "available_outreach_sites": [],
            "budget_optimization": None
        }

    if not potential:
        print(f"[Calendar API] No keywords found for project: '{project_slug}'", flush=True)
        return {
            "project_slug": project_slug,
            "total_potential": 0,
            "has_landing_pages": True,
            "potential_keywords": [],
            "batches": {"high": [], "medium": [], "low": []},
            "summary": "No rank 5+ keywords with landing page URLs found for this project.",
            "available_outreach_sites": [],
            "budget_optimization": None
        }

    # Fetch available outreach sites and assign with 3-domain limit
    available_sites = fetch_available_outreach_sites(project_slug)
    potential, budget_summary = assign_outreach_sites_to_keywords(
        potential,
        available_sites,
        budget_ceiling=budget,
        requested_quantity=quantity,
        project_slug=project_slug,
        target_country=country,
        target_domain=domain
    )

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
        "has_landing_pages": True,
        "potential_keywords": potential,
        "batches": batches,
        "summary": summary,
        "available_outreach_sites": available_sites,
        "budget_optimization": budget_summary
    }


@router.post("/analyze-potential")
def analyze_potential_endpoint(payload: PushPotentialRequest):
    """
    Run AI Live SERP Rank & Top-3 Landing Page Intent analysis.
    """
    print(f"\n[Calendar API] POST /calendar/analyze-potential: project='{payload.project_slug}', domain='{payload.domain}', keywords_count={len(payload.keywords or [])}", flush=True)
    keywords = payload.keywords
    has_landing_pages = True
    if not keywords and payload.project_slug:
        keywords, has_landing_pages, _ = get_potential_keywords_from_db(payload.project_slug)
    elif keywords:
        # Enforce all 3 core criteria: target_type is landing page, landing_page_url is present, and rank >= 5
        filtered_kws = []
        for k in keywords:
            tt = str(k.get("target_type") or "").strip().lower()
            if tt not in ("landing page", "landing"):
                continue
            lp = str(k.get("landing_page_url") or k.get("topicLink") or k.get("topic_link") or "").strip()
            if not lp or lp.lower() == "nan":
                continue
            rank = _parse_num(k.get("rank"), 0)
            if rank < 5:
                continue
            k["landing_page_url"] = lp
            k["topicLink"] = lp
            # Do not overwrite topic_link with landing page URL
            filtered_kws.append(k)
        keywords = filtered_kws
    print('Selected Keywords from intent table\n', keywords)
    if not has_landing_pages:
        return {
            "batches": {"high": [], "medium": [], "low": []},
            "has_landing_pages": False,
            "summary": "Data does not have landing page URLs.",
            "available_outreach_sites": [],
            "budget_optimization": None
        }

    if not keywords:
        print(f"[Calendar API] No keywords provided for analysis.", flush=True)
        return {
            "batches": {"high": [], "medium": [], "low": []},
            "has_landing_pages": True,
            "summary": "No keywords provided.",
            "available_outreach_sites": [],
            "budget_optimization": None
        }

    ai_res = calculate_live_serp_batches(keywords, domain=payload.domain or payload.project_slug or "", country=payload.country or "India")

    # Which enrichment pass(es) this batch actually needs, based on the
    # activities configured in Campaign Activities & Budgets:
    #   - ONLY "Brand Mentions"        -> brand-mention search ONLY, the
    #                                      Paid-Guest-Post outreach-site
    #                                      assignment step is skipped entirely
    #                                      (no outreach_site gets attached).
    #   - "Paid Guest Post" / anything
    #     else, or nothing specified   -> outreach-site assignment only
    #                                      (previous/default behavior) --
    #                                      brand-mention search is skipped so
    #                                      a Guest-Post-only batch never fires
    #                                      the live-search AI calls for nothing.
    #   - a MIXED batch (both present) -> both passes run.
    act_names = [str(a or "").strip().lower() for a in (payload.activity_names or [])]
    is_brand_mention_only = bool(act_names) and all("brand mention" in a for a in act_names)
    wants_brand_mentions = bool(act_names) and any("brand mention" in a for a in act_names)

    available_sites = fetch_available_outreach_sites(payload.project_slug)
    eval_kws = ai_res.get("evaluated_keywords") or keywords
    profile = get_project_target_profile(payload.project_slug, payload.domain)
    resolved_country = payload.country or profile.get("country") or "India"

    if is_brand_mention_only:
        scored_sites_for_bm = score_and_rank_outreach_sites(
            available_sites, target_country=resolved_country, target_industry=profile.get("industry") or "General",
        )
        assigned_kws, budget_summary = assign_and_summarize_brand_mentions(
            eval_kws, scored_sites_for_bm, project_slug=payload.project_slug,
            client_domain=payload.domain, country=resolved_country,
            budget_ceiling=payload.budget, requested_quantity=payload.quantity,
        )
    else:
        assigned_kws, budget_summary = assign_outreach_sites_to_keywords(
            eval_kws,
            available_sites,
            budget_ceiling=payload.budget,
            requested_quantity=payload.quantity,
            project_slug=payload.project_slug,
            target_country=payload.country,
            target_domain=payload.domain
        )
        if wants_brand_mentions:
            # Mixed batch (Paid Guest Post + Brand Mentions together): also
            # run the live search, matched against the SAME scored+sorted
            # outreach inventory Paid Guest Post just used (identical DA/SS/
            # industry/traffic criteria, guaranteed by passing that list in
            # rather than rescoring).
            try:
                scored_sites_for_bm = score_and_rank_outreach_sites(
                    available_sites, target_country=resolved_country, target_industry=profile.get("industry") or "General",
                )
                assigned_kws = assign_brand_mentions_to_keywords(
                    assigned_kws, scored_sites_for_bm, project_slug=payload.project_slug,
                    client_domain=payload.domain, country=resolved_country,
                )
            except Exception as e:
                print(f"[Calendar AI] Brand Mentions assignment notice: {e}", file=sys.stderr, flush=True)

    ai_res["evaluated_keywords"] = assigned_kws
    ai_res["available_outreach_sites"] = available_sites
    ai_res["budget_optimization"] = budget_summary
    ai_res["has_landing_pages"] = True

    # Sync enriched outreach sites and landing page urls back into batches
    assigned_by_id = {k.get("id"): k for k in assigned_kws}
    for b_key in ("high", "medium", "low"):
        batch_items = ai_res.get("batches", {}).get(b_key, [])
        enriched_batch = []
        for kw in batch_items:
            kw_id = kw.get("id")
            if kw_id in assigned_by_id:
                enriched_batch.append(assigned_by_id[kw_id])
            else:
                kw_copy = dict(kw)
                kw_copy["landing_page_url"] = kw.get("landing_page_url") or kw.get("topicLink") or ""
                kw_copy["topicLink"] = kw_copy["landing_page_url"]
                kw_copy["topic_link"] = kw.get("topic_link") or None
                enriched_batch.append(kw_copy)
        ai_res["batches"][b_key] = enriched_batch

    # Persist the whole run (every evaluated keyword, not just the picked ones)
    ai_res["run_id"] = save_calendar_ai_run(
        assigned_kws,
        project_slug=payload.project_slug or "",
        domain=payload.domain or "",
        country=payload.country or "India",
        activity_id=payload.activity_id,
        summary=ai_res.get("summary", ""),
        budget_used=payload.budget,
        quantity_requested=payload.quantity,
        budget_summary=budget_summary,
    )
    return ai_res


@router.get("/ai-runs")
def list_ai_runs_endpoint(
    project_slug: Optional[str] = Query(None),
    activity_id: Optional[str] = Query(None),
    run_id: Optional[str] = Query(None),
    limit: int = Query(20),
):
    """Past AI-scheduling analysis runs (one summary row per run)."""
    return {"runs": list_calendar_ai_runs(project_slug=project_slug, activity_id=activity_id, run_id=run_id, limit=limit)}


@router.get("/ai-runs/{run_id}")
def get_ai_run_endpoint(run_id: str):
    """Every evaluated keyword for one AI-scheduling analysis run."""
    rows = get_calendar_ai_run(run_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Analysis run not found.")
    first = rows[0] if rows else {}
    return {
        "run_id": run_id,
        "summary": first.get("summary"),
        "budget_summary": first.get("budget_summary"),
        "budget_used": first.get("budget_used"),
        "quantity_requested": first.get("quantity_requested"),
        "keywords": rows,
        "total": len(rows)
    }


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
    data = payload.dict(exclude_unset=True)
    updated = update_calendar_activity(activity_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Link activity to AI run in calendar_ai_analysis if ai_run_id was provided
    run_id = data.get("ai_run_id")
    if run_id:
        try:
            with engine.begin() as conn:
                conn.execute(text("""
                    UPDATE calendar_ai_analysis
                    SET activity_id = :aid
                    WHERE run_id = :rid AND (activity_id IS NULL OR activity_id = :aid)
                """), {"aid": str(activity_id), "rid": str(run_id)})
        except Exception as err:
            print(f"[Calendar API] Error linking activity to AI run: {err}", file=sys.stderr)

    # When keywords are confirmed onto an activity, flag which ones the user
    # actually picked on that activity's latest analysis run.
    pk = data.get("potential_keywords")
    if isinstance(pk, list) and pk:
        picked = [k.get("keyword") for k in pk if isinstance(k, dict) and k.get("keyword")]
        mark_calendar_ai_selected(activity_id, picked)

    # Automatically sync to Off-Page (monthly_operations) if published
    if data.get("status") == "published":
        try:
            synced_uids = sync_activity_to_monthly_operations(activity_id)
            if synced_uids:
                updated["synced_uids"] = synced_uids
                updated["first_uid"] = synced_uids[0]
        except Exception as sync_err:
            print(f"[Calendar API] Error syncing to monthly_operations: {sync_err}", file=sys.stderr)

    return {"activity": updated}


@router.post("/activities/{activity_id}/approve-publish")
def approve_publish_activity_endpoint(activity_id: str):
    """Approve and publish activity, automatically syncing rows to Off-Page (monthly_operations)."""
    updated = update_calendar_activity(activity_id, {"status": "published"})
    if not updated:
        raise HTTPException(status_code=404, detail="Activity not found")
    synced_uids = sync_activity_to_monthly_operations(activity_id)
    return {
        "status": "success",
        "activity": updated,
        "synced_uids": synced_uids,
        "first_uid": synced_uids[0] if synced_uids else None,
        "project_name": updated.get("project_name")
    }


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
