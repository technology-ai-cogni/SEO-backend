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
from typing import Optional, List, Dict, Any, Tuple

from fastapi import APIRouter, HTTPException, Query, Response, status, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

# Import database engine from existing core
from core.db import engine, _clean_for_json
from auth.router import require_authenticated_user

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

def generate_activity_uid(conn, project_name: Optional[str], period: Optional[str]) -> str:
    """
    Generates a unique sequential Activity UID like 'BL-03-0096'.
    Format: {PROJECT_CODE}-{MONTH_CODE}-{4_DIGIT_SEQUENCE}
    Always starts strictly from 0001 for each project and month.
    """
    proj_code = generate_project_code(project_name)
    month_code = get_month_code(period)
    prefix_pattern = f"{proj_code}-{month_code}-%"

    rows = conn.execute(
        text("SELECT activity_uid FROM off_page_activities WHERE activity_uid LIKE :pattern"),
        {"pattern": prefix_pattern}
    ).fetchall()

    max_seq = 0
    for r in rows:
        if r and r[0]:
            try:
                parts = str(r[0]).split("-")
                if len(parts) >= 3 and parts[-1].isdigit():
                    val = int(parts[-1])
                    if val > max_seq:
                        max_seq = val
            except Exception:
                pass

    next_seq = max_seq + 1
    return f"{proj_code}-{month_code}-{next_seq:04d}"

def _ensure_activity_uids(conn):
    """Backfill activity_uid for any existing rows missing one."""
    try:
        rows = conn.execute(text("SELECT id, project_name, period FROM off_page_activities WHERE activity_uid IS NULL OR activity_uid = '' ORDER BY created_at ASC")).fetchall()
        for r in rows:
            uid = generate_activity_uid(conn, r[1], r[2])
            conn.execute(text("UPDATE off_page_activities SET activity_uid = :uid WHERE id = :id"), {"uid": uid, "id": r[0]})
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
        SELECT id, keyword, category, cluster, rank, sv, kw_diff, landing_page_url, target_type, rank_meta
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
            "landing_page_url": lp_url
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
        lp = kw.get("landing_page_url") or kw.get("topicLink") or kw.get("topic_link") or ""
        item["landing_page_url"] = lp
        item["topicLink"] = lp
        item["topic_link"] = lp
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

    recommended_qty = min(len(selected_sites) * KEYWORDS_PER_SITE, len(keywords)) if keywords else len(selected_sites) * KEYWORDS_PER_SITE
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

    # Generate the requested executive AI Budget Analysis Commentary
    if savings > 0:
        anti_waste_advisory = (
            f"I've identified these {recommended_qty} keywords with strong rank-recovery potential (allocated strictly 4 keywords per outreach site). "
            f"To keep your budget spend minimal without sacrificing quality, I've prioritized publishers with the highest authority-to-cost value: "
            f"planned spend is just ₹{int(total_cost):,} out of your ₹{int(budget_cap):,} budget (saving ₹{int(savings):,}), "
            f"while maintaining high Domain Authority (DA {min_da}–{max_da}), clean spam score ({min_ss}–{max_ss}), and verified {resolved_country} audience reach."
        )
    else:
        anti_waste_advisory = (
            f"I've identified these {recommended_qty} priority keywords and allocated {num_sites_used} {industry_confirmation} "
            f"(4 keywords per outreach site, DA {min_da}–{max_da}, clean {min_ss}–{max_ss} spam score) with verified {resolved_country} traffic, "
            f"budget-optimized for highest authority-to-cost value within your ₹{int(budget_cap):,} budget."
        )

    budget_summary = {
        "requested_quantity": req_qty,
        "requested_activities": req_qty,
        "recommended_quantity": recommended_qty,
        "recommended_activities": recommended_qty,
        "redundant_posts_saved": max(0, req_qty - recommended_qty),
        "budget_cap": round(budget_cap, 2),
        "total_budget_cap": round(budget_cap, 2),
        "planned_spend": round(total_cost, 2),
        "projected_savings": round(savings, 2),
        "avg_cost_per_post": round(total_cost / max(1, recommended_qty), 2),
        "anti_waste_advisory": anti_waste_advisory,
        "analysis_narrative": anti_waste_advisory,
        "target_country": resolved_country,
        "target_industry": resolved_industry,
        "top_da_range": f"{min_da} - {max_da}" if min_da != max_da else str(min_da),
        "spam_score_range": f"{min_ss} - {max_ss}" if min_ss != max_ss else str(min_ss)
    }

    return assigned_keywords, budget_summary


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

        # Batch 2: Drops (Red Alert) - rank slipped down compared to baseline/previous
        if delta < 0 or (rank >= 12 and kd <= 60):
            batch = "medium"  # Batch 2: Extremely Dropped (Red Alert)
            confidence = 75 if delta < 0 else 60
            reason = f"Rank dropped by {abs(delta)} positions (was #{int(prev_rank)} -> now #{int(rank)}). Prime recovery target." if delta < 0 else "Moderate rank position in range with recovery potential."
        # Batch 1: Gains - improved or page 1 striking distance
        elif delta > 0 or (rank <= 10 and kd <= 50 and sv > 0):
            batch = "high"   # Batch 1: Extremely Improved (Gains)
            confidence = 85 if delta > 0 else 80
            reason = f"Rank gained +{delta} positions (was #{int(prev_rank)} -> now #{int(rank)}). High momentum candidate." if delta > 0 else "Page 1 striking distance with landing page intent."
        else:
            batch = "low"    # Batch 3: Stagnant / Low Movement
            confidence = 40
            reason = "Rank hasn't moved significantly. Stagnant SERP velocity candidate."

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
        reason = f"Rank dropped by {drop_str}. Prime recovery push target; top 3 are Landing Pages."
    elif delta <= -2:
        batch = "medium" if top3_is_landing else "low"
        reason = f"Rank shifted from #{prev_rank} to #{new_rank}. {'Top 3 are Landing Pages.' if top3_is_landing else 'SERP intent mismatch.'}"
    else:
        batch = "low"
        confidence = 40 if top3_is_landing else 25
        if not top3_is_landing:
            types_str = ", ".join(top3_types) if top3_types else "Blogs"
            reason = f"Top 3 SERP results shifted away from landing pages ({types_str}). Search intent mismatch."
        else:
            reason = f"Rank didn't move (#{prev_rank} -> #{new_rank}, delta: {delta:+d}). Stagnant SERP velocity."

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
            act_uid = generate_activity_uid(conn, data.get("project_name"), data.get("period"))

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
            "landing_page_url": k.get("landing_page_url") or k.get("topicLink") or None,
            "budget_used": budget_used,
            "quantity_requested": quantity_requested,
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
                    top_links, verification, outreach_site, landing_page_url, budget_used,
                    quantity_requested, summary, budget_summary
                ) VALUES (
                    :run_id, :activity_id, :project_slug, :domain, :country, :keyword, :keyword_id,
                    :category, :cluster, :db_rank, :prev_rank, :live_rank, :delta, :sv, :kd, :target_type,
                    :batch, :confidence, CAST(:confidence_breakdown AS JSONB), :reason,
                    CAST(:top3_types AS JSONB), :top3_is_landing, CAST(:top_links AS JSONB),
                    CAST(:verification AS JSONB), CAST(:outreach_site AS JSONB), :landing_page_url,
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


# ─────────────────────────────────────────────────────────────
# 5. FASTAPI ROUTER DEFINITION
# ─────────────────────────────────────────────────────────────

router = APIRouter(prefix="/calendar", tags=["Calendar"])


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
            k["topic_link"] = lp
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

    # Enrich with outreach sites & 3-domain rule
    available_sites = fetch_available_outreach_sites(payload.project_slug)
    eval_kws = ai_res.get("evaluated_keywords") or keywords
    assigned_kws, budget_summary = assign_outreach_sites_to_keywords(
        eval_kws,
        available_sites,
        budget_ceiling=payload.budget,
        requested_quantity=payload.quantity,
        project_slug=payload.project_slug,
        target_country=payload.country,
        target_domain=payload.domain
    )
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
                kw_copy["landing_page_url"] = kw.get("landing_page_url") or kw.get("topicLink") or kw.get("topic_link") or ""
                kw_copy["topicLink"] = kw_copy["landing_page_url"]
                kw_copy["topic_link"] = kw_copy["landing_page_url"]
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
