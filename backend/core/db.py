"""
Database layer, backed by Postgres (Supabase).

PROJECTS: a lightweight registry (`projects`: name <-> slug) -- no longer
tied to per-project physical tables. All category/cluster/keyword data
now lives in ONE shared set of tables (`categories`, `clusters`,
`category_cluster_map`, `keyword_categories`), each scoped by a
`project_name` column (see note below on what that column actually
stores). This replaced an earlier design that gave each project its own
dedicated physical tables -- reverted because a single shared table per
type, filtered by project, is what's actually wanted here.

IMPORTANT NAMING NOTE: the `project_name` column on these shared tables
stores the project's SLUG (e.g. "real_estate_clients"), not the raw
display name someone typed (e.g. "Real Estate Clients") -- the slug is
stable, URL/SQL-safe, and immune to case/whitespace mismatches, so it's
what everything is actually filtered and joined on internally. The
human-typed display name lives in `projects.name` and `domains.project_name`
(the domain-registry table) for anything display-facing. The column is
still literally named `project_name` as requested; just know the value
in it is the slug, linked via a foreign key to `projects(slug)`.

DOMAINS: a separate registry (`domains`) capturing the "Create Project"
form fields (domain, project name, target regions, platforms, domain
authority, users). Creating a domain also registers (or reuses) the
matching project in `projects`, so `domains.project_slug` always points
at a valid, existing project -- one domain, one project. Columns that
only appear in the project LISTING view (traffic, keyword count, target
page count, blog page count) are NOT part of the creation form and are
intentionally left NULL here -- nothing computes or fills them in yet.

Two tables remain fully SHARED / infrastructure, untouched by any of the
above:
    jobs      -- one row per import batch; has a `domain` column holding
                 the owning project's SLUG, and a `project_name` column
                 holding the human-typed display name -- so job listing/
                 history works with one query across every project.
    projects  -- the name -> slug registry itself.

Legacy note: this project has gone through two prior storage designs for
category/cluster/keyword data -- first one shared table filtered by a
`domain` column, then dedicated physical tables per project. Both prior
generations' data get migrated forward by migrate_per_project_tables_to_shared()
below when moving to this (third) design.

Setup:
    1. Create a free project at https://supabase.com
    2. Project Settings -> Database -> Connection string (URI format,
       "Transaction" pooler mode is fine for this use case)
    3. Put it in your .env as DATABASE_URL (see .env.example)
    4. From the `backend/` directory, run `python -m core.db` once to
       create all shared tables
    5. If you have data sitting in per-project physical tables from the
       previous design, run:
           python -m core.db migrate-to-shared
       to copy it all into the new shared tables (see the function's
       docstring for details -- it's safe to re-run).
"""

import os
import re
import uuid
import sys
from decimal import Decimal
import json
from typing import Optional, List, Dict, Any

def _clean_for_json(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v) if (v % 1) != 0 else int(v)
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, dict):
        return {k: _clean_for_json(val) for k, val in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [_clean_for_json(val) for val in v]
    return v


from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("[Warning] DATABASE_URL is not set in environment. Database features will require DATABASE_URL.")
    DATABASE_URL = "sqlite:///:memory:"

engine_kwargs = {"pool_pre_ping": True}
if not DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update({
        "pool_recycle": 300,
        "pool_size": 10,
        "max_overflow": 5
    })

engine = create_engine(DATABASE_URL, **engine_kwargs)


def _chunked(items, size=500):
    """Generic chunking helper for bulk multi-row INSERTs -- splits a
    list into pieces of at most `size` so a single upload doesn't try to
    build one gigantic SQL statement (or issue one round-trip per row)."""
    items = list(items)
    for i in range(0, len(items), size):
        yield items[i:i + size]


# --- Project name -> safe slug -------------------------------------------
# Slugs are no longer used to build table names (there are no more
# per-project physical tables), but they're still the stable, safe,
# collision-checked identifier stored in projects.slug and used as the
# FK value in every shared table's `project_name` column.
MAX_SLUG_LENGTH = 40
_SLUG_SAFE_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _slugify_project_name(name):
    """Turn an arbitrary user-typed project name into a safe, lowercase
    snake_case identifier: only [a-z0-9_], never starting with a digit,
    length-capped. Raises ValueError if nothing usable is left after
    sanitizing (e.g. a name that's only punctuation)."""
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    slug = re.sub(r"_+", "_", slug).strip("_")

    if not slug:
        raise ValueError("Project name must contain at least one letter or number.")

    if slug[0].isdigit():
        slug = f"p_{slug}"

    slug = slug[:MAX_SLUG_LENGTH].rstrip("_")

    if not slug:
        raise ValueError("Project name produced an empty identifier after sanitizing.")

    return slug


def _assert_safe_identifier(identifier):
    """Kept as a general-purpose safety check, still used wherever a
    value derived from user input might end up needing validation."""
    if not identifier or not _SLUG_SAFE_RE.match(identifier):
        raise ValueError(f"Unsafe identifier rejected: {identifier!r}")
    return identifier


# Columns that hold RAW PASS-THROUGH data straight from the uploaded
# sheet (SV/KW Diff/Type/Target Type/Target Subtype/Target Geo/Priority/
# Landing Page URL) -- stored exactly as given at upload time, via
# insert_keyword_rows() below. `category` and `cluster` are deliberately
# NOT in this list -- those are the fields the pipeline is allowed to
# fill in (via update_keyword_result()). Also: target_type gets
# overwritten by the pipeline too (see update_keyword_result), even
# though it's populated here as pass-through at upload time -- whichever
# the pipeline computes wins once processing happens.
_KEYWORD_PASS_THROUGH_COLUMNS = [
    "sv", "kw_diff", "type", "target_type", "target_subtype",
    "target_geo", "priority", "landing_page_url",
]


def init_db():
    """Create every shared table if it doesn't exist yet. Safe to run
    repeatedly.  Uses a lock timeout + retry to avoid deadlocks when
    another process holds an open read lock on the same tables.
    If all retries fail due to locks, the app still starts (tables already exist)."""
    if not os.environ.get("DATABASE_URL"):
        print("[Warning] Skipping DB init: DATABASE_URL is not set.")
        return

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            _init_db_inner()
            return  # success
        except Exception as e:
            err_str = str(e).lower()
            if "deadlock" in err_str or "lock" in err_str:
                print(f"[DB Init] Lock/deadlock on attempt {attempt}/{max_retries}: {e}")
                if attempt < max_retries:
                    import time as _time
                    _time.sleep(2 * attempt)  # backoff: 2s, 4s
                    continue
                else:
                    # All retries failed — but tables already exist on production,
                    # so the app can still run. Log warning and continue.
                    print(f"[DB Init] WARNING: All {max_retries} init_db attempts failed due to database locks.")
                    print(f"[DB Init] Tables already exist — app will continue without migration.")
                    print(f"[DB Init] Run 'python kill_db_locks.py' to clear stuck connections, then restart.")
                    return
            raise  # non-lock error — propagate


def _add_column_if_not_exists(conn, table: str, column: str, col_type: str):
    """Check if a column exists in information_schema before running ALTER TABLE.
    This avoids acquiring an ACCESS EXCLUSIVE lock on active tables during startup."""
    try:
        exists = conn.execute(text("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = :t AND column_name = :c
        """), {"t": table, "c": column}).scalar()
        if not exists:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {col_type}"))
    except Exception as e:
        print(f"[DB Init] Note: column check/add for {table}.{column}: {e}")


def _init_db_inner():
    """Actual init_db logic, separated so the outer function can retry."""
    with engine.begin() as conn:
        # Set a lock timeout so DDL fails fast instead of deadlocking
        conn.execute(text("SET lock_timeout = '5s'"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS jobs (
                id UUID PRIMARY KEY,
                filename TEXT,
                domain TEXT NOT NULL DEFAULT '',
                country_name TEXT,
                country_code TEXT,
                job_type TEXT NOT NULL DEFAULT 'category',
                status TEXT NOT NULL DEFAULT 'pending',
                total INTEGER NOT NULL DEFAULT 0,
                processed INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                clustering_triggered_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                completed_at TIMESTAMPTZ
            )
        """))
        _add_column_if_not_exists(conn, "jobs", "clustering_triggered_at", "TIMESTAMPTZ")
        _add_column_if_not_exists(conn, "jobs", "country_name", "TEXT")
        _add_column_if_not_exists(conn, "jobs", "country_code", "TEXT")
        _add_column_if_not_exists(conn, "jobs", "project_name", "TEXT")
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_jobs_domain ON jobs (domain)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'USER',
                status TEXT NOT NULL DEFAULT 'Active',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        _add_column_if_not_exists(conn, "users", "role", "TEXT NOT NULL DEFAULT 'USER'")
        _add_column_if_not_exists(conn, "users", "status", "TEXT NOT NULL DEFAULT 'Active'")
        _add_column_if_not_exists(conn, "users", "attendance", "TEXT NOT NULL DEFAULT 'Not Present'")
        _add_column_if_not_exists(conn, "users", "assigned_project", "TEXT NOT NULL DEFAULT 'All Projects'")
        _add_column_if_not_exists(conn, "users", "category", "TEXT DEFAULT 'Internal'")
        _add_column_if_not_exists(conn, "users", "section_access", "TEXT DEFAULT 'Default'")
        _add_column_if_not_exists(conn, "users", "permissions", "TEXT DEFAULT 'Default'")
        _add_column_if_not_exists(conn, "users", "client_detail_enabled", "BOOLEAN DEFAULT FALSE")
        _add_column_if_not_exists(conn, "users", "client_name", "TEXT")
        _add_column_if_not_exists(conn, "users", "client_address", "TEXT")
        _add_column_if_not_exists(conn, "users", "client_gst", "TEXT")
        _add_column_if_not_exists(conn, "users", "poc_name", "TEXT")
        _add_column_if_not_exists(conn, "users", "poc_number", "TEXT")
        _add_column_if_not_exists(conn, "users", "poc_address", "TEXT")
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email))"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id BIGSERIAL PRIMARY KEY,
                timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
                user_email TEXT NOT NULL,
                action TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Success',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        _add_column_if_not_exists(conn, "audit_logs", "project_name", "TEXT")
        _add_column_if_not_exists(conn, "audit_logs", "module", "TEXT")

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS recycle_bin (
                id BIGSERIAL PRIMARY KEY,
                item_type TEXT NOT NULL DEFAULT 'project',
                item_id TEXT,
                project_slug TEXT NOT NULL,
                project_name TEXT NOT NULL,
                item_name TEXT NOT NULL DEFAULT '',
                deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                data JSONB NOT NULL
            )
        """))
        _add_column_if_not_exists(conn, "recycle_bin", "item_type", "TEXT NOT NULL DEFAULT 'project'")
        _add_column_if_not_exists(conn, "recycle_bin", "item_id", "TEXT")
        _add_column_if_not_exists(conn, "recycle_bin", "item_name", "TEXT NOT NULL DEFAULT ''")
        conn.execute(text("ALTER TABLE recycle_bin DROP CONSTRAINT IF EXISTS recycle_bin_project_slug_key"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_analysis (
                id BIGSERIAL PRIMARY KEY,
                project_slug TEXT NOT NULL,
                project_name TEXT NOT NULL,
                domain TEXT,
                country TEXT DEFAULT 'India',
                engine TEXT NOT NULL,
                ai_visibility INT DEFAULT 0,
                mentions INT DEFAULT 0,
                cited_pages INT DEFAULT 0,
                total_keywords INT DEFAULT 0,
                mentioned_keywords JSONB DEFAULT '[]'::jsonb,
                cited_pages_list JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS projects (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))

        # --- Domains registry: the "Create Project" form -----------------
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS domains (
                id BIGSERIAL PRIMARY KEY,
                domain TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                project_slug TEXT NOT NULL REFERENCES projects(slug),
                target_regions TEXT[],
                platforms TEXT[],
                domain_authority TEXT,
                users JSONB,
                -- Listing-view-only columns (image 1) -- NOT part of the
                -- creation form, so intentionally NULL until something
                -- else computes/fills them in.
                traffic TEXT,
                keywords_count TEXT,
                target_pages_count TEXT,
                blog_pages_count TEXT,
                status TEXT NOT NULL DEFAULT 'Active',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active'"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS industry_type TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS industry TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_business_centre TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_phone TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_website TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_address TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_email TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_bc_phone TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_bc_website TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_bc_address TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS nap_bc_email TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS business_centres JSONB"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS branded_terms TEXT"))
        # Live domain metrics (DA / Spam Score / organic traffic) fetched from
        # RapidAPI and shown on the Brand Discovery header -- persisted here so
        # the frontend never has to cache them client-side.
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS spam_score TEXT"))
        conn.execute(text("ALTER TABLE domains ADD COLUMN IF NOT EXISTS metrics_updated_at TIMESTAMPTZ"))

        # --- Single Unified Monthly Operations Table -----------------
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS monthly_operations (
                id BIGSERIAL PRIMARY KEY,
                uid TEXT,
                filename TEXT,
                project_name TEXT NOT NULL,
                project_slug TEXT,
                period TEXT,
                scheduled_date TEXT,
                keyword1 TEXT,
                keyword2 TEXT,
                landing_page TEXT,
                cluster TEXT,
                kw_category TEXT,
                activity_name TEXT,
                word_count TEXT,
                content_spoc TEXT,
                topic TEXT,
                content_doc TEXT,
                status TEXT,
                publisher TEXT,
                pg_site_domain TEXT,
                live_link TEXT,
                remarks TEXT,
                solution TEXT,
                last_activity TEXT,
                updated_date TEXT,
                fetched_data JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("ALTER TABLE monthly_operations ADD COLUMN IF NOT EXISTS uid TEXT"))
        conn.execute(text("ALTER TABLE monthly_operations ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE monthly_operations ADD COLUMN IF NOT EXISTS fetched_data JSONB"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS scheduled_activities (
                id BIGSERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                project_name TEXT NOT NULL,
                project_slug TEXT,
                datetime TEXT NOT NULL,
                frequency TEXT DEFAULT 'One-Time',
                status TEXT DEFAULT 'Scheduled',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))

        # --- Shared categories/clusters/category_cluster_map/keyword_categories ---
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS categories (
                id BIGSERIAL PRIMARY KEY,
                project_name TEXT NOT NULL REFERENCES projects(slug),
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (project_name, name)
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS clusters (
                id BIGSERIAL PRIMARY KEY,
                project_name TEXT NOT NULL REFERENCES projects(slug),
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (project_name, name)
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS category_cluster_map (
                project_name TEXT NOT NULL REFERENCES projects(slug),
                category TEXT NOT NULL,
                cluster TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (project_name, category)
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS keyword_categories (
                id BIGSERIAL PRIMARY KEY,
                job_id UUID REFERENCES jobs(id),
                project_name TEXT NOT NULL REFERENCES projects(slug),
                keyword TEXT NOT NULL,
                category TEXT,
                cluster TEXT,
                status TEXT,
                error TEXT,
                meta JSONB,
                sv TEXT,
                kw_diff TEXT,
                type TEXT,
                target_type TEXT,
                target_subtype TEXT,
                target_geo TEXT,
                priority TEXT,
                landing_page_url TEXT,
                rank INTEGER,
                rank_checked_at TIMESTAMPTZ,
                rank_meta JSONB,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        for alter_cmd in [
            "ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS rank INTEGER",
            "ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS rank_checked_at TIMESTAMPTZ",
            "ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS rank_meta JSONB",
            "ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS subtype TEXT"
        ]:
            try:
                conn.execute(text(alter_cmd))
            except Exception as alter_err:
                print(f"[DB Init] Notice skipping table alter: {alter_err}")
        try:
            conn.execute(text("UPDATE keyword_categories SET type = 'Google' WHERE type IS NULL OR TRIM(type) = ''"))
            conn.execute(text("ALTER TABLE keyword_categories ALTER COLUMN type SET DEFAULT 'Google'"))
        except Exception as update_type_err:
            print(f"[DB Init] Notice updating default keyword type: {update_type_err}")
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_keyword_categories_job ON keyword_categories (job_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_keyword_categories_project ON keyword_categories (project_name)"))

        # --- Pages (the frontend's "Add Pages" sheet upload) -------------
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pages (
                id BIGSERIAL PRIMARY KEY,
                project_name TEXT NOT NULL REFERENCES projects(slug),
                page_name TEXT,
                url TEXT,
                cluster TEXT,
                category TEXT,
                target_category TEXT,
                target_type TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_pages_project ON pages (project_name)"))

        # --- Competitor Pages (separate db for Competitors tab Add Pages) ---
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS competitor_pages (
                id BIGSERIAL PRIMARY KEY,
                project_name TEXT NOT NULL REFERENCES projects(slug),
                page_name TEXT,
                url TEXT,
                cluster TEXT,
                category TEXT,
                target_category TEXT,
                target_type TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_competitor_pages_project ON competitor_pages (project_name)"))

        # --- Competitors ---------------------------------------------------
        # Each competitor is tracked against one of the projects registered
        # in the `projects` table (project_slug), so the Competitors tab can
        # be filtered per project.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS competitors (
                id BIGSERIAL PRIMARY KEY,
                domain TEXT NOT NULL,
                name TEXT,
                da TEXT,
                target_regions TEXT[],
                device TEXT,
                location TEXT,
                common_kw NUMERIC,
                common_kw_change NUMERIC,
                total_kw INTEGER,
                total_kw_change INTEGER,
                ai_comp_level INTEGER,
                ai_comp_change INTEGER,
                serp_comp_level INTEGER,
                comp_level INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_competitors_created ON competitors (created_at DESC)"))
        conn.execute(text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS project_slug TEXT"))
        conn.execute(text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS website_type TEXT"))
        conn.execute(text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS type TEXT"))
        conn.execute(text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS category TEXT"))
        conn.execute(text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS cluster TEXT"))
        conn.execute(text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS url TEXT"))
        conn.execute(text("ALTER TABLE competitors ADD COLUMN IF NOT EXISTS urls TEXT[]"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_competitors_project ON competitors (project_slug)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS url_classifications (
                url TEXT PRIMARY KEY,
                domain TEXT,
                website_type TEXT,
                is_competitor TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))

        # --- Competitor snapshots -------------------------------------------
        # One row per "Find Competitors" run for a given competitor -- lets
        # the Competitor detail view show a dated history instead of only
        # ever reflecting the latest analysis.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS competitor_snapshots (
                id BIGSERIAL PRIMARY KEY,
                competitor_id BIGINT NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
                domain TEXT,
                name TEXT,
                target_regions TEXT[],
                da TEXT,
                ranking_keywords INTEGER,
                total_keywords INTEGER,
                common_kw NUMERIC,
                ai_comp_level INTEGER,
                serp_comp_level INTEGER,
                comp_level INTEGER,
                device TEXT,
                location TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_competitor ON competitor_snapshots (competitor_id, created_at DESC)"))
            conn.execute(text("ALTER TABLE competitor_snapshots ADD COLUMN IF NOT EXISTS keyword_positions JSONB"))
        except Exception as idx_err:
            print(f"[DB Init] Notice during startup migration: {idx_err}")

        # --- Outreach Sites Table ---
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS off_page_activities (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                activity_name TEXT NOT NULL,
                project_name TEXT,
                main_poc TEXT,
                content_poc TEXT,
                quantity INTEGER DEFAULT 0,
                budget NUMERIC(12, 2) DEFAULT 0.00,
                "user" TEXT,
                period TEXT,
                scheduler TEXT,
                auditor TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );

            CREATE TABLE IF NOT EXISTS outreach_sites (
                id BIGSERIAL PRIMARY KEY,
                project_slug TEXT NOT NULL REFERENCES projects(slug),
                url TEXT NOT NULL,
                domain TEXT NOT NULL,
                type TEXT,
                da INTEGER,
                pa INTEGER,
                ss TEXT,
                traffic TEXT,
                total_traffic TEXT,
                region1_traffic TEXT,
                region2_traffic TEXT,
                region3_traffic TEXT,
                sourced_by TEXT,
                agency_name TEXT,
                calculate_sp BOOLEAN DEFAULT false,
                sp_percentage TEXT,
                landing_price TEXT,
                selling_price TEXT,
                country TEXT,
                domain_industry TEXT,
                status TEXT DEFAULT 'New site',
                rejected_reason TEXT,
                metrics_json JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        """))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS type TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS sourced_by TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS agency_name TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS calculate_sp BOOLEAN DEFAULT false"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS sp_percentage TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS landing_price TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS selling_price TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS country TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS domain_industry TEXT"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New site'"))
        conn.execute(text("ALTER TABLE outreach_sites ADD COLUMN IF NOT EXISTS rejected_reason TEXT"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_outreach_sites_project ON outreach_sites (project_slug)"))


# --- Outreach Sites Database Functions ------------------------------------

def list_outreach_sites(project_slug: str = None):
    """Fetch all stored outreach sites for a given project slug or all if None."""
    if not os.environ.get("DATABASE_URL"):
        return []
    with engine.connect() as conn:
        if project_slug and str(project_slug).strip().lower() not in ("all projects", "all", "*"):
            slug_list = [s.strip().lower() for s in str(project_slug).split(",") if s.strip()]
            query = text("""
                SELECT id, project_slug, url, domain, type, da, pa, ss, traffic,
                       total_traffic, region1_traffic, region2_traffic, region3_traffic,
                       sourced_by, agency_name, calculate_sp, sp_percentage, landing_price,
                       selling_price, country, domain_industry, status, rejected_reason,
                       metrics_json, created_at
                FROM outreach_sites
                WHERE LOWER(project_slug) = ANY(:slugs)
                ORDER BY id DESC
            """)
            params = {"slugs": slug_list}
        else:
            query = text("""
                SELECT id, project_slug, url, domain, type, da, pa, ss, traffic,
                       total_traffic, region1_traffic, region2_traffic, region3_traffic,
                       sourced_by, agency_name, calculate_sp, sp_percentage, landing_price,
                       selling_price, country, domain_industry, status, rejected_reason,
                       metrics_json, created_at
                FROM outreach_sites
                ORDER BY id DESC
            """)
            params = {}
        res = conn.execute(query, params).mappings().all()
        return [dict(r) for r in res]


def insert_outreach_site(project_slug: str, site_data: dict):
    """Insert or return newly inserted outreach site record."""
    if not os.environ.get("DATABASE_URL"):
        return site_data
    with engine.begin() as conn:
        res = conn.execute(
            text("""
                INSERT INTO outreach_sites (
                    project_slug, url, domain, type, da, pa, ss, traffic,
                    total_traffic, region1_traffic, region2_traffic, region3_traffic,
                    sourced_by, agency_name, calculate_sp, sp_percentage, landing_price,
                    selling_price, country, domain_industry, status, rejected_reason, metrics_json
                )
                VALUES (
                    :project_slug, :url, :domain, :type, :da, :pa, :ss, :traffic,
                    :total_traffic, :region1_traffic, :region2_traffic, :region3_traffic,
                    :sourced_by, :agency_name, :calculate_sp, :sp_percentage, :landing_price,
                    :selling_price, :country, :domain_industry, :status, :rejected_reason, :metrics_json
                )
                RETURNING id, created_at
            """),
            {
                "project_slug": project_slug,
                "url": site_data.get("url"),
                "domain": site_data.get("domain"),
                "type": site_data.get("type"),
                "da": site_data.get("da"),
                "pa": site_data.get("pa"),
                "ss": site_data.get("ss"),
                "traffic": site_data.get("traffic"),
                "total_traffic": site_data.get("total_traffic") or site_data.get("totalTraffic"),
                "region1_traffic": site_data.get("region1_traffic") or site_data.get("region1Traffic"),
                "region2_traffic": site_data.get("region2_traffic") or site_data.get("region2Traffic"),
                "region3_traffic": site_data.get("region3_traffic") or site_data.get("region3Traffic"),
                "sourced_by": site_data.get("sourced_by") or site_data.get("sourcedOption"),
                "agency_name": site_data.get("agency_name") or site_data.get("agencyName"),
                "calculate_sp": bool(site_data.get("calculate_sp") or site_data.get("calculateSp")),
                "sp_percentage": site_data.get("sp_percentage") or site_data.get("spPercentage"),
                "landing_price": site_data.get("landing_price") or site_data.get("landingPrice"),
                "selling_price": site_data.get("selling_price") or site_data.get("sellingPrice"),
                "country": site_data.get("country"),
                "domain_industry": site_data.get("domain_industry") or site_data.get("domainIndustry"),
                "status": site_data.get("status") or "New site",
                "rejected_reason": site_data.get("rejected_reason") or site_data.get("rejectedReason"),
                "metrics_json": json.dumps(site_data.get("metrics_json", {})) if isinstance(site_data.get("metrics_json"), dict) else site_data.get("metrics_json")
            }
        ).mappings().first()
        out = dict(site_data)
        if res:
            out["id"] = res["id"]
        return out


def delete_outreach_site(site_id: int):
    """Delete an outreach site by ID."""
    if not os.environ.get("DATABASE_URL"):
        return True
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM outreach_sites WHERE id = :id"),
            {"id": site_id}
        )
    return True


def update_outreach_site(site_id: int, updates: dict):
    """Update fields for a specific outreach site."""
    if not os.environ.get("DATABASE_URL") or not updates:
        return True
    set_clauses = []
    params = {"id": site_id}
    allowed_keys = [
        "type", "da", "pa", "ss", "traffic", "total_traffic",
        "region1_traffic", "region2_traffic", "region3_traffic",
        "url", "domain", "sourced_by", "agency_name", "calculate_sp",
        "sp_percentage", "landing_price", "selling_price", "country",
        "domain_industry", "status", "rejected_reason"
    ]
    for k, v in updates.items():
        db_key = k
        if db_key not in allowed_keys and k == "site_type":
            db_key = "type"
        elif db_key not in allowed_keys and k == "landingPrice":
            db_key = "landing_price"
        elif db_key not in allowed_keys and k == "sellingPrice":
            db_key = "selling_price"
        elif db_key not in allowed_keys and k == "spPercentage":
            db_key = "sp_percentage"
        elif db_key not in allowed_keys and k == "domainIndustry":
            db_key = "domain_industry"
        elif db_key not in allowed_keys and (k == "sourcedOption" or k == "sourcedBy"):
            db_key = "sourced_by"
        elif db_key not in allowed_keys and k == "agencyName":
            db_key = "agency_name"
        elif db_key not in allowed_keys and k == "calculateSp":
            db_key = "calculate_sp"
        elif db_key not in allowed_keys and k == "rejectedReason":
            db_key = "rejected_reason"
            db_key = "selling_price"
        elif db_key not in allowed_keys and k == "spPercentage":
            db_key = "sp_percentage"
        elif db_key not in allowed_keys and k == "domainIndustry":
            db_key = "domain_industry"
        elif db_key not in allowed_keys and (k == "sourcedOption" or k == "sourcedBy"):
            db_key = "sourced_by"
        elif db_key not in allowed_keys and k == "agencyName":
            db_key = "agency_name"
        elif db_key not in allowed_keys and k == "calculateSp":
            db_key = "calculate_sp"

        if db_key in allowed_keys:
            set_clauses.append(f"{db_key} = :{db_key}")
            params[db_key] = v
    if not set_clauses:
        return True
    query = f"UPDATE outreach_sites SET {', '.join(set_clauses)} WHERE id = :id"
    with engine.begin() as conn:
        conn.execute(text(query), params)
    return True


def bulk_delete_outreach_sites(site_ids: list):
    """Bulk delete outreach sites by IDs."""
    if not os.environ.get("DATABASE_URL") or not site_ids:
        return True
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM outreach_sites WHERE id = ANY(:ids)"),
            {"ids": site_ids}
        )
    return True


def get_or_create_project(name):
    """Look up a project by its display name, registering it if it's new.
    Returns the project's slug. No physical tables are created anymore --
    this just ensures a `projects` row exists.

    If the sanitized slug would collide with a DIFFERENT existing
    project's slug, a numeric suffix is appended until it's unique."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Project name cannot be empty.")

    with engine.begin() as conn:
        row = conn.execute(text("SELECT slug, deleted_at FROM projects WHERE name = :name"), {"name": name}).fetchone()
        if row:
            if row.deleted_at is not None:
                conn.execute(text("UPDATE projects SET deleted_at = NULL WHERE name = :name"), {"name": name})
            return row.slug

        base_slug = _slugify_project_name(name)
        slug = base_slug
        suffix = 2
        while conn.execute(text("SELECT 1 FROM projects WHERE slug = :slug"), {"slug": slug}).fetchone():
            slug = f"{base_slug}_{suffix}"[:MAX_SLUG_LENGTH]
            suffix += 1

        conn.execute(text("INSERT INTO projects (name, slug) VALUES (:name, :slug)"),
                     {"name": name, "slug": slug})

    return slug


def get_project_by_name(name, include_deleted=False):
    with engine.begin() as conn:
        sql = "SELECT * FROM projects WHERE name = :name"
        if not include_deleted:
            sql += " AND deleted_at IS NULL"
        row = conn.execute(text(sql), {"name": name}).mappings().fetchone()
        return dict(row) if row else None


def get_project_by_slug(slug, include_deleted=False):
    with engine.begin() as conn:
        sql = "SELECT * FROM projects WHERE slug = :slug"
        if not include_deleted:
            sql += " AND deleted_at IS NULL"
        row = conn.execute(text(sql), {"slug": slug}).mappings().fetchone()
        return dict(row) if row else None


def get_recycle_bin_project(slug_or_name):
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT * FROM recycle_bin
            WHERE (project_slug = :p OR project_name = :p OR item_id = :p) AND item_type = 'project'
            LIMIT 1
        """), {"p": slug_or_name}).mappings().fetchone()
        return dict(row) if row else None


def list_projects(include_deleted=False, only_deleted=False):
    with engine.begin() as conn:
        if only_deleted:
            rows = conn.execute(text("""
                SELECT id, project_slug AS slug, project_name AS name, deleted_at,
                       COALESCE(data->'domains'->0->>'domain', project_name) AS domain
                FROM recycle_bin
                WHERE item_type = 'project'
                ORDER BY deleted_at DESC
            """)).mappings().fetchall()
            return [dict(r) for r in rows]

        sql = "SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC"
        rows = conn.execute(text(sql)).mappings().fetchall()
        return [dict(r) for r in rows]


def list_recycle_bin_items(item_type=None):
    with engine.begin() as conn:
        sql = """
            SELECT id, item_type, item_id, project_slug, project_name, item_name, deleted_at,
                   COALESCE(data->'domains'->0->>'domain', data->>'domain', data->>'url', '') AS domain
            FROM recycle_bin
        """
        params = {}
        if item_type and item_type != 'all':
            if item_type == 'keyword':
                sql += " WHERE item_type IN ('keyword', 'keywords')"
            elif item_type == 'page':
                sql += " WHERE item_type IN ('page', 'pages')"
            elif item_type == 'competitor':
                sql += " WHERE item_type IN ('competitor', 'competitors')"
            else:
                sql += " WHERE item_type = :item_type"
                params["item_type"] = item_type
        sql += " ORDER BY deleted_at DESC"

        rows = conn.execute(text(sql), params).mappings().fetchall()
        return [dict(r) for r in rows]


def soft_delete_project(slug):
    """Archives a project and all its associated data into the `recycle_bin` table,
    then purges active records from main tables so creating a new project with the same name starts 100% fresh.
    Retries on deadlock/lock errors up to 3 times with backoff."""
    import time as _time

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            _soft_delete_project_inner(slug)
            return  # success
        except Exception as e:
            err_str = str(e).lower()
            if ("deadlock" in err_str or "lock" in err_str) and attempt < max_retries:
                print(f"[DB] soft_delete_project deadlock on attempt {attempt}/{max_retries}, retrying in {2 * attempt}s...")
                _time.sleep(2 * attempt)
                continue
            raise


def _soft_delete_project_inner(slug):
    """Inner logic for soft_delete_project, separated for retry."""
    with engine.begin() as conn:
        conn.execute(text("SET lock_timeout = '10s'"))
        proj_row = conn.execute(text("SELECT * FROM projects WHERE slug = :slug"), {"slug": slug}).mappings().fetchone()
        if not proj_row:
            return

        proj_dict = dict(proj_row)
        domain_rows = [dict(r) for r in conn.execute(text("SELECT * FROM domains WHERE project_slug = :slug"), {"slug": slug}).mappings().fetchall()]
        kw_rows = [dict(r) for r in conn.execute(text("SELECT * FROM keyword_categories WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()]
        cat_rows = [dict(r) for r in conn.execute(text("SELECT * FROM categories WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()]
        cls_rows = [dict(r) for r in conn.execute(text("SELECT * FROM clusters WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()]
        map_rows = [dict(r) for r in conn.execute(text("SELECT * FROM category_cluster_map WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()]
        page_rows = [dict(r) for r in conn.execute(text("SELECT * FROM pages WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()]
        comp_page_rows = [dict(r) for r in conn.execute(text("SELECT * FROM competitor_pages WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()]
        comp_rows = [dict(r) for r in conn.execute(text("SELECT * FROM competitors WHERE project_slug = :slug"), {"slug": slug}).mappings().fetchall()]
        outreach_rows = [dict(r) for r in conn.execute(text("SELECT * FROM outreach_sites WHERE project_slug = :slug"), {"slug": slug}).mappings().fetchall()]

        def _clean_json(obj):
            if isinstance(obj, list):
                return [_clean_json(i) for i in obj]
            if isinstance(obj, dict):
                return {k: (v.isoformat() if hasattr(v, 'isoformat') else str(v) if isinstance(v, uuid.UUID) else v) for k, v in obj.items()}
            return obj

        archive_data = {
            "project": _clean_json(proj_dict),
            "domains": _clean_json(domain_rows),
            "keywords": _clean_json(kw_rows),
            "categories": _clean_json(cat_rows),
            "clusters": _clean_json(cls_rows),
            "category_cluster_map": _clean_json(map_rows),
            "pages": _clean_json(page_rows),
            "competitor_pages": _clean_json(comp_page_rows),
            "competitors": _clean_json(comp_rows),
            "outreach_sites": _clean_json(outreach_rows),
        }

        conn.execute(text("""
            INSERT INTO recycle_bin (item_type, item_id, project_slug, project_name, item_name, deleted_at, data)
            VALUES ('project', :slug, :slug, :name, :name, now(), CAST(:data AS JSONB))
        """), {
            "slug": slug,
            "name": proj_dict.get("name") or slug,
            "data": json.dumps(archive_data)
        })

        conn.execute(text("DELETE FROM keyword_categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM domains WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM clusters WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM category_cluster_map WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM pages WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM competitor_pages WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM competitors WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM outreach_sites WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})


def restore_project(slug):
    """Restores an archived project from `recycle_bin` back into active database tables."""
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT * FROM recycle_bin
            WHERE (project_slug = :slug OR item_id = :slug) AND item_type = 'project'
            LIMIT 1
        """), {"slug": slug}).mappings().fetchone()

        if not row:
            conn.execute(text("UPDATE projects SET deleted_at = NULL WHERE slug = :slug"), {"slug": slug})
            return

        archive_data = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]

        p = archive_data.get("project")
        if p:
            conn.execute(text("""
                INSERT INTO projects (name, slug, created_at)
                VALUES (:name, :slug, now())
                ON CONFLICT (slug) DO UPDATE SET deleted_at = NULL
            """), {"name": p.get("name", slug), "slug": slug})

        for d in archive_data.get("domains", []):
            conn.execute(text("""
                INSERT INTO domains (domain, project_name, project_slug, target_regions, platforms, domain_authority, users, traffic, keywords_count, target_pages_count, blog_pages_count)
                VALUES (:domain, :project_name, :project_slug, :target_regions, :platforms, :domain_authority, CAST(:users AS JSONB), :traffic, :keywords_count, :target_pages_count, :blog_pages_count)
                ON CONFLICT (domain) DO NOTHING
            """), {
                "domain": d.get("domain"),
                "project_name": d.get("project_name", slug),
                "project_slug": slug,
                "target_regions": d.get("target_regions"),
                "platforms": d.get("platforms"),
                "domain_authority": d.get("domain_authority"),
                "users": json.dumps(d.get("users")) if d.get("users") is not None else None,
                "traffic": d.get("traffic"),
                "keywords_count": d.get("keywords_count"),
                "target_pages_count": d.get("target_pages_count"),
                "blog_pages_count": d.get("blog_pages_count"),
            })

        for k in archive_data.get("keywords", []):
            conn.execute(text("""
                INSERT INTO keyword_categories (project_name, keyword, sv, kw_diff, cluster, category, type, target_type, subtype, target_geo, priority, landing_page_url, rank, rank_checked_at)
                VALUES (:project_name, :keyword, :sv, :kw_diff, :cluster, :category, :type, :target_type, :subtype, :target_geo, :priority, :landing_page_url, :rank, :rank_checked_at)
            """), {
                "project_name": slug, "keyword": k.get("keyword"), "sv": k.get("sv"), "kw_diff": k.get("kw_diff"),
                "cluster": k.get("cluster"), "category": k.get("category"), "type": k.get("type"),
                "target_type": k.get("target_type"), "subtype": k.get("subtype"), "target_geo": k.get("target_geo"),
                "priority": k.get("priority"), "landing_page_url": k.get("landing_page_url"),
                "rank": k.get("rank"), "rank_checked_at": k.get("rank_checked_at"),
            })

        for c in archive_data.get("categories", []):
            conn.execute(text("INSERT INTO categories (project_name, name) VALUES (:project_name, :name) ON CONFLICT DO NOTHING"), {"project_name": slug, "name": c.get("name")})
        for c in archive_data.get("clusters", []):
            conn.execute(text("INSERT INTO clusters (project_name, name) VALUES (:project_name, :name) ON CONFLICT DO NOTHING"), {"project_name": slug, "name": c.get("name")})
        for m in archive_data.get("category_cluster_map", []):
            conn.execute(text("INSERT INTO category_cluster_map (project_name, category, cluster) VALUES (:project_name, :category, :cluster) ON CONFLICT DO NOTHING"), {"project_name": slug, "category": m.get("category"), "cluster": m.get("cluster")})

        for pg in archive_data.get("pages", []):
            conn.execute(text("""
                INSERT INTO pages (project_name, page_name, url, cluster, category, target_category, target_type)
                VALUES (:project_name, :page_name, :url, :cluster, :category, :target_category, :target_type)
            """), {
                "project_name": slug, "page_name": pg.get("page_name"), "url": pg.get("url"),
                "cluster": pg.get("cluster"), "category": pg.get("category"),
                "target_category": pg.get("target_category"), "target_type": pg.get("target_type"),
            })

        for comp in archive_data.get("competitors", []):
            conn.execute(text("""
                INSERT INTO competitors (domain, name, da, target_regions, project_slug, category, cluster, type, website_type)
                VALUES (:domain, :name, :da, :target_regions, :project_slug, :category, :cluster, :type, :website_type)
                ON CONFLICT (domain, project_slug) DO NOTHING
            """), {
                "domain": comp.get("domain"), "name": comp.get("name"), "da": comp.get("da"),
                "target_regions": comp.get("target_regions"), "project_slug": slug,
                "category": comp.get("category"), "cluster": comp.get("cluster"),
                "type": comp.get("type"), "website_type": comp.get("website_type"),
            })

        for os in archive_data.get("outreach_sites", []):
            conn.execute(text("""
                INSERT INTO outreach_sites (id, url, domain, type, da, pa, ss, traffic, total_traffic, region1_traffic, region2_traffic, region3_traffic, landing_price, selling_price, sp_percentage, country, domain_industry, status, rejected_reason, project_slug)
                VALUES (:id, :url, :domain, :type, :da, :pa, :ss, :traffic, :total_traffic, :region1_traffic, :region2_traffic, :region3_traffic, :landing_price, :selling_price, :sp_percentage, :country, :domain_industry, :status, :rejected_reason, :project_slug)
                ON CONFLICT (id) DO NOTHING
            """), {
                "id": os.get("id"), "url": os.get("url"), "domain": os.get("domain"), "type": os.get("type"),
                "da": os.get("da"), "pa": os.get("pa"), "ss": os.get("ss"), "traffic": os.get("traffic"),
                "total_traffic": os.get("total_traffic"), "region1_traffic": os.get("region1_traffic"),
                "region2_traffic": os.get("region2_traffic"), "region3_traffic": os.get("region3_traffic"),
                "landing_price": os.get("landing_price"), "selling_price": os.get("selling_price"),
                "sp_percentage": os.get("sp_percentage"), "country": os.get("country"),
                "domain_industry": os.get("domain_industry"), "status": os.get("status"),
                "rejected_reason": os.get("rejected_reason"), "project_slug": slug
            })

        conn.execute(text("DELETE FROM recycle_bin WHERE id = :id"), {"id": row["id"]})


def delete_project(slug):
    """Removes a project completely from both recycle_bin and active tables."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM recycle_bin WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM keyword_categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM domains WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM clusters WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM category_cluster_map WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM pages WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM competitor_pages WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM competitors WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM outreach_sites WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})


def purge_expired_projects():
    """Finds all archived projects in recycle_bin older than 30 days and purges them."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM recycle_bin WHERE deleted_at < now() - INTERVAL '30 days'"))


def delete_project_kw_data(slug):
    """Removes just this project's KW Cluster data (keyword_categories,
    categories, clusters, category_cluster_map) -- leaves the project
    itself, its domain registration, and its pages untouched, so it still
    shows up on the Domain and Pages tabs afterward."""
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM keyword_categories WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()
        if rows:
            def _clean(v):
                return v.isoformat() if hasattr(v, 'isoformat') else str(v) if isinstance(v, uuid.UUID) else v
            clean_rows = [{k: _clean(v) for k, v in dict(r).items()} for r in rows]
            conn.execute(text("""
                INSERT INTO recycle_bin (item_type, item_id, project_slug, project_name, item_name, deleted_at, data)
                VALUES ('keywords', :item_id, :project_slug, :project_name, :item_name, now(), CAST(:data AS JSONB))
            """), {
                "item_id": f"keywords_{slug}",
                "project_slug": slug,
                "project_name": slug,
                "item_name": f"Keywords dataset of {slug}",
                "data": json.dumps(clean_rows)
            })
        conn.execute(text("DELETE FROM keyword_categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM clusters WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM category_cluster_map WHERE project_name = :slug"), {"slug": slug})


def delete_project_pages(slug):
    """Removes just this project's page rows (Add Pages uploads) -- leaves
    the project, its domain registration, and its KW Cluster data
    untouched, so it still shows up on the Domain and KW Cluster tabs
    afterward."""
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM pages WHERE project_name = :slug"), {"slug": slug}).mappings().fetchall()
        if rows:
            def _clean(v):
                return v.isoformat() if hasattr(v, 'isoformat') else str(v) if isinstance(v, uuid.UUID) else v
            clean_rows = [{k: _clean(v) for k, v in dict(r).items()} for r in rows]
            conn.execute(text("""
                INSERT INTO recycle_bin (item_type, item_id, project_slug, project_name, item_name, deleted_at, data)
                VALUES ('pages', :item_id, :project_slug, :project_name, :item_name, now(), CAST(:data AS JSONB))
            """), {
                "item_id": f"pages_{slug}",
                "project_slug": slug,
                "project_name": slug,
                "item_name": f"Pages dataset of {slug}",
                "data": json.dumps(clean_rows)
            })
        conn.execute(text("DELETE FROM pages WHERE project_name = :slug"), {"slug": slug})


# --- Domains (the "Create Project" form) --------------------------------

def create_domain(domain, project_name=None, target_regions=None, platforms=None,
                   domain_authority=None, users=None, industry=None, industry_type=None,
                   nap_business_centre=None, nap_phone=None, nap_website=None,
                   nap_address=None, nap_email=None,
                   nap_bc_phone=None, nap_bc_website=None, nap_bc_address=None, nap_bc_email=None,
                   business_centres=None, branded_terms=None):
    """Registers a new domain <-> project pairing (one domain, one
    project). If project_name is blank, defaults to the domain string
    itself (matching the form's "Auto-generated if left blank" hint --
    this is the simplest reasonable auto-name; swap in something fancier
    if you want different auto-naming behavior).

    Creates the underlying project via get_or_create_project() first, so
    domains.project_slug always points at a valid, existing project.

    target_regions / platforms: lists of strings (Postgres TEXT[]).
    users: list of {"type": ..., "email": ...} dicts (stored as JSONB).

    Raises ValueError if this domain already exists (domain is UNIQUE)."""
    domain = (domain or "").strip()
    if not domain:
        raise ValueError("Domain is required.")

    project_name = (project_name or "").strip() or domain
    project_slug = get_or_create_project(project_name)
    ind_val = industry or industry_type or ""

    with engine.begin() as conn:
        existing_domain = conn.execute(text("SELECT 1 FROM domains WHERE LOWER(domain) = LOWER(:domain)"), {"domain": domain}).fetchone()
        existing_project = conn.execute(text("SELECT 1 FROM domains WHERE LOWER(project_name) = LOWER(:project_name) OR project_slug = :slug"), {"project_name": project_name, "slug": slugify(project_name)}).fetchone()
        if existing_domain or existing_project:
            raise ValueError("Use different domain or project name, it's already used")

        conn.execute(text("""
            INSERT INTO domains (domain, project_name, project_slug, target_regions, platforms, domain_authority, users, industry, industry_type, nap_business_centre, nap_phone, nap_website, nap_address, nap_email, nap_bc_phone, nap_bc_website, nap_bc_address, nap_bc_email, business_centres, branded_terms, status, is_active)
            VALUES (:domain, :project_name, :project_slug, :target_regions, :platforms, :domain_authority, CAST(:users AS JSONB), :industry, :industry_type, :nap_business_centre, :nap_phone, :nap_website, :nap_address, :nap_email, :nap_bc_phone, :nap_bc_website, :nap_bc_address, :nap_bc_email, CAST(:business_centres AS JSONB), :branded_terms, 'Active', TRUE)
        """), {
            "domain": domain, "project_name": project_name, "project_slug": project_slug,
            "target_regions": target_regions or [], "platforms": platforms or [],
            "domain_authority": domain_authority,
            "users": json.dumps(users) if users is not None else None,
            "industry": ind_val,
            "industry_type": ind_val,
            "nap_business_centre": nap_business_centre,
            "nap_phone": nap_phone,
            "nap_website": nap_website,
            "nap_address": nap_address,
            "nap_email": nap_email,
            "nap_bc_phone": nap_bc_phone,
            "nap_bc_website": nap_bc_website,
            "nap_bc_address": nap_bc_address,
            "nap_bc_email": nap_bc_email,
            "business_centres": json.dumps(business_centres) if business_centres is not None else None,
            "branded_terms": branded_terms,
        })

    return project_slug


def get_domain_record(domain):
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT d.* FROM domains d
            JOIN projects p ON d.project_slug = p.slug
            WHERE d.domain = :domain AND p.deleted_at IS NULL
        """), {"domain": domain}).mappings().fetchone()
        return dict(row) if row else None


def list_domain_records():
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT d.* FROM domains d
            JOIN projects p ON d.project_slug = p.slug
            WHERE p.deleted_at IS NULL
            ORDER BY d.created_at DESC
        """)).mappings().fetchall()
        return [dict(r) for r in rows]


def get_domain_by_project_slug(project_slug):
    """Looks up the domain registered for a project -- used as the
    rank-check fallback target when a keyword row has no explicit
    landing_page_url. Returns None if this project has no domain
    registered yet (e.g. a project created directly via /jobs/category
    rather than through the /domains "Create Project" form)."""
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT * FROM domains WHERE project_slug = :project_slug LIMIT 1
        """), {"project_slug": project_slug}).mappings().fetchone()
        return dict(row) if row else None


def update_domain_record(project_slug: str, updates: dict):
    if not project_slug or not updates:
        return

    allowed_keys = {
        "project_name", "target_regions", "platforms", "industry", "industry_type",
        "status", "is_active", "nap_business_centre", "nap_phone", "nap_website",
        "nap_address", "nap_email", "nap_bc_phone", "nap_bc_website", "nap_bc_address",
        "nap_bc_email", "business_centres", "branded_terms",
        "domain_authority", "spam_score", "traffic", "metrics_updated_at"
    }

    field_mappings = {
        "name": "project_name",
        "project_name": "project_name",
        "da": "domain_authority",
        "domain_authority": "domain_authority",
        "spam_score": "spam_score",
        "ss": "spam_score",
        "traffic": "traffic",
        "metrics_updated_at": "metrics_updated_at",
        "regions": "target_regions",
        "targetRegions": "target_regions",
        "target_regions": "target_regions",
        "targetPlatforms": "platforms",
        "platforms": "platforms",
        "industry": "industry",
        "domain_industry": "industry_type",
        "domainIndustry": "industry_type",
        "industry_type": "industry_type",
        "category": "industry",
        "status": "status",
        "isActive": "is_active",
        "napBusinessCentre": "nap_business_centre",
        "napPhone": "nap_phone",
        "napWebsite": "nap_website",
        "napAddress": "nap_address",
        "napEmail": "nap_email",
        "napBcPhone": "nap_bc_phone",
        "napBcWebsite": "nap_bc_website",
        "napBcAddress": "nap_bc_address",
        "napBcEmail": "nap_bc_email",
        "businessCentres": "business_centres",
        "brandedTerms": "branded_terms"
    }

    set_clauses = []
    params = {"project_slug": project_slug}

    for k, v in updates.items():
        db_col = field_mappings.get(k)
        if db_col and db_col in allowed_keys and db_col not in params:
            if db_col in ("business_centres",):
                set_clauses.append(f"{db_col} = CAST(:{db_col} AS JSONB)")
                params[db_col] = json.dumps(v) if isinstance(v, (list, dict)) else v
            else:
                set_clauses.append(f"{db_col} = :{db_col}")
                params[db_col] = v

    ind_val = updates.get("industry") or updates.get("industry_type") or updates.get("domain_industry") or updates.get("category")
    if ind_val is not None:
        if "industry" not in params:
            set_clauses.append("industry = :industry_val")
            params["industry_val"] = ind_val
        if "industry_type" not in params:
            set_clauses.append("industry_type = :industry_type_val")
            params["industry_type_val"] = ind_val

    if not set_clauses:
        return

    set_clauses.append("updated_at = now()")

    with engine.begin() as conn:
        conn.execute(text(f"""
            UPDATE domains
            SET {', '.join(set_clauses)}
            WHERE project_slug = :project_slug OR LOWER(project_name) = LOWER(:project_slug)
        """), params)


# --- Jobs (shared, untouched) --------------------------------------------

def create_job(filename, project_slug, project_name, country_name, country_code, total):
    job_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO jobs (id, filename, domain, project_name, country_name, country_code, job_type, status, total, processed)
            VALUES (:id, :filename, :domain, :project_name, :country_name, :country_code, 'category', 'pending', :total, 0)
        """), {
            "id": job_id, "filename": filename, "domain": project_slug, "project_name": project_name,
            "country_name": country_name, "country_code": country_code, "total": total,
        })
    return job_id


def set_job_status(job_id, status, error=None):
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE jobs SET status = :status, error = :error, updated_at = now(),
                   completed_at = CASE WHEN :status IN ('completed','failed') THEN now() ELSE completed_at END
            WHERE id = :id
        """), {"id": job_id, "status": status, "error": error})


def increment_job_progress(job_id):
    """Atomically increment processed count; auto-marks completed when done."""
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE jobs SET processed = processed + 1, updated_at = now()
            WHERE id = :id
        """), {"id": job_id})
        row = conn.execute(text("""
            SELECT processed, total FROM jobs WHERE id = :id
        """), {"id": job_id}).fetchone()
        if row and row.processed >= row.total and row.total > 0:
            conn.execute(text("""
                UPDATE jobs SET status = 'completed', completed_at = now()
                WHERE id = :id AND status != 'completed'
            """), {"id": job_id})


def get_job(job_id):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM jobs WHERE id = :id"), {"id": job_id}).mappings().fetchone()
        return dict(row) if row else None


def list_jobs():
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM jobs ORDER BY created_at DESC")).mappings().fetchall()
        return [dict(r) for r in rows]


def list_domains():
    """Kept for backward compatibility -- distinct project slugs that
    have at least one job. Prefer list_projects() or list_domain_records()
    for new code."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT domain FROM jobs WHERE domain != '' ORDER BY domain
        """)).fetchall()
        return [r.domain for r in rows]


def try_mark_clustering_triggered(job_id):
    """Atomically claim the right to trigger clustering for this job.
    Returns True only for the ONE caller that wins the race (guards
    against double-triggering if progress updates ever overlap)."""
    with engine.begin() as conn:
        result = conn.execute(text("""
            UPDATE jobs SET clustering_triggered_at = now()
            WHERE id = :id AND clustering_triggered_at IS NULL
        """), {"id": job_id})
        return result.rowcount > 0


# --- Categories (shared table, scoped by project_name) -------------------
# NOTE: the parameter is still named `domain` in these functions purely
# to keep category_checker.py / category_tasks.py working UNCHANGED (they
# already just pass this value straight through) -- it holds a PROJECT
# SLUG, which is what the shared tables' `project_name` column stores.

def list_category_names(domain):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT category FROM keyword_categories
            WHERE project_name = :project_name AND category IS NOT NULL AND TRIM(category) != ''
            ORDER BY category
        """), {"project_name": domain}).fetchall()
        return [r.category for r in rows if r.category]


def add_category(domain, name):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO categories (project_name, name) VALUES (:project_name, :name)
            ON CONFLICT (project_name, name) DO NOTHING
        """), {"project_name": domain, "name": name})


# --- Clusters (shared table, scoped by project_name) ----------------------
# IMPORTANT: run only ONE category worker at a time -- category AND
# cluster assignment are both inherently sequential within a project.

def list_cluster_names(domain):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT name FROM clusters WHERE project_name = :project_name ORDER BY id
        """), {"project_name": domain}).fetchall()
        return [r.name for r in rows]


def add_cluster(domain, name):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO clusters (project_name, name) VALUES (:project_name, :name)
            ON CONFLICT (project_name, name) DO NOTHING
        """), {"project_name": domain, "name": name})


def get_cluster_for_category(domain, category_name):
    """Deterministic cache lookup: has this EXACT category already been
    assigned a cluster in this project before?"""
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT cluster FROM category_cluster_map WHERE project_name = :project_name AND category = :category
        """), {"project_name": domain, "category": category_name}).fetchone()
        return row.cluster if row else None


def set_cluster_for_category(domain, category_name, cluster_name):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO category_cluster_map (project_name, category, cluster, updated_at)
            VALUES (:project_name, :category, :cluster, now())
            ON CONFLICT (project_name, category) DO UPDATE SET cluster = :cluster, updated_at = now()
        """), {"project_name": domain, "category": category_name, "cluster": cluster_name})


def replace_domain_clusters(domain, category_to_cluster):
    """Overwrite this project's ENTIRE cluster assignment in one pass --
    used by the post-categorization clustering step, which re-clusters
    the whole project's category list from scratch every time it runs."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM clusters WHERE project_name = :project_name"), {"project_name": domain})
        for cluster_name in sorted(set(category_to_cluster.values())):
            conn.execute(text("""
                INSERT INTO clusters (project_name, name) VALUES (:project_name, :name)
                ON CONFLICT (project_name, name) DO NOTHING
            """), {"project_name": domain, "name": cluster_name})

        conn.execute(text("DELETE FROM category_cluster_map WHERE project_name = :project_name"), {"project_name": domain})
        for category_name, cluster_name in category_to_cluster.items():
            conn.execute(text("""
                INSERT INTO category_cluster_map (project_name, category, cluster, updated_at)
                VALUES (:project_name, :category, :cluster, now())
            """), {"project_name": domain, "category": category_name, "cluster": cluster_name})

            conn.execute(text("""
                UPDATE keyword_categories SET cluster = :cluster
                WHERE project_name = :project_name AND category = :category
            """), {"project_name": domain, "category": category_name, "cluster": cluster_name})


# --- Keyword results (shared table, scoped by project_name) ---------------

def insert_keyword_rows(job_id, domain, rows):
    """Pre-insert ONE row per keyword at UPLOAD time (called from the
    /jobs/category endpoint), storing ONLY whatever pass-through data
    came from the sheet itself: sv, kw_diff, type, target_type,
    target_subtype, target_geo, priority, landing_page_url. Nothing is
    inferred or generated here -- a column that wasn't present in the
    sheet (or was blank for that row) is stored as NULL, never guessed.

    category/cluster start out NULL and status starts 'queued' -- the
    background pipeline fills those in later via update_keyword_result(),
    which also overwrites target_type and fills in target_geo if blank.

    `rows` is a list of dicts with keys: keyword, sv, kw_diff, type,
    target_type, target_subtype, target_geo, priority, landing_page_url
    (any of the non-keyword keys may be missing/None).

    Returns the list of inserted row ids, in the SAME ORDER as `rows`."""
    ids = []
    with engine.begin() as conn:
        for chunk in _chunked(rows):
            values_sql = ", ".join(
                f"(:job_id{i}, :project_name{i}, :keyword{i}, 'queued', :sv{i}, :kw_diff{i}, :type{i}, "
                f":target_type{i}, :target_subtype{i}, :target_geo{i}, :priority{i}, :landing_page_url{i})"
                for i in range(len(chunk))
            )
            params = {}
            for i, r in enumerate(chunk):
                params[f"job_id{i}"] = job_id
                params[f"project_name{i}"] = domain
                params[f"keyword{i}"] = r.get("keyword")
                params[f"sv{i}"] = r.get("sv")
                type_val = r.get("type")
                params[f"type{i}"] = type_val if (type_val and str(type_val).strip()) else "Google"
                params[f"target_type{i}"] = r.get("target_type")
                params[f"target_subtype{i}"] = r.get("target_subtype")
                params[f"target_geo{i}"] = r.get("target_geo")
                params[f"priority{i}"] = r.get("priority")
                params[f"landing_page_url{i}"] = r.get("landing_page_url")

            result = conn.execute(text(f"""
                INSERT INTO keyword_categories
                    (job_id, project_name, keyword, status, sv, kw_diff, type, target_type,
                     target_subtype, target_geo, priority, landing_page_url)
                VALUES {values_sql}
                RETURNING id
            """), params)
            ids.extend(r.id for r in result.fetchall())
    return ids


def update_keyword_result(domain, row_id, category, cluster, status, meta=None, error=None,
                           computed_target_type=None, computed_region_name=None, computed_subtype=None):
    """Called by the background worker after processing ONE keyword row
    (identified by the id returned from insert_keyword_rows at upload
    time). `row_id` is globally unique (shared table), so no project
    filter is needed in the WHERE clause -- `domain` is accepted for
    signature consistency with the rest of this module but unused here.

    Updates category/cluster/status/meta/error, PLUS:
    - target_type: ALWAYS overwritten with computed_target_type.
    - subtype: ALWAYS overwritten with computed_subtype (Informational/
      Commercial, same column scripts/run_pipeline.py's
      insert_pipeline_result() writes).
    - target_geo: filled in with computed_region_name ONLY IF the row's
      target_geo is currently NULL/blank -- never overwrites a target
      geo the user explicitly supplied in their upload.

    Never touches sv/kw_diff/type/target_subtype/priority/
    landing_page_url, which remain pure pass-through from the original
    upload."""
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE keyword_categories
            SET category = :category, cluster = :cluster, status = :status,
                meta = CAST(:meta AS JSONB), error = :error, checked_at = now(),
                target_type = :computed_target_type, subtype = :computed_subtype,
                target_geo = COALESCE(NULLIF(target_geo, ''), :computed_region_name)
            WHERE id = :id
        """), {
            "id": row_id, "category": category, "cluster": cluster, "status": status,
            "meta": json.dumps(meta) if meta is not None else None, "error": error,
            "computed_target_type": computed_target_type, "computed_region_name": computed_region_name,
            "computed_subtype": computed_subtype,
        })


def update_keyword_rank(row_id, rank, rank_meta=None):
    """Called by the rank-checking worker after checking ONE keyword row.
    Only ever touches rank/rank_checked_at/rank_meta -- never category,
    cluster, or any of the pass-through upload columns."""
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE keyword_categories
            SET rank = :rank, rank_checked_at = now(), rank_meta = CAST(:rank_meta AS JSONB)
            WHERE id = :id
        """), {
            "id": row_id, "rank": rank,
            "rank_meta": json.dumps(rank_meta) if rank_meta is not None else None,
        })


def get_job_keyword_rows_for_rank_check(job_id):
    """Every keyword row for a job, with enough info to enqueue a
    rank-check task per row: id (to write the result back to THIS exact
    row later) and landing_page_url (the pass-through column rank
    checking should match against, if present)."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT id, keyword, landing_page_url
            FROM keyword_categories WHERE job_id = :job_id ORDER BY id
        """), {"job_id": job_id}).mappings().fetchall()
        return [dict(r) for r in rows]


# --- Pages (the frontend's "Add Pages" sheet upload) ----------------------
# Routed through this direct-Postgres module rather than the frontend's
# Supabase client -- new tables aren't reachable by the frontend's
# RLS-restricted anon key until policies are added for them (see
# categories/clusters/category_cluster_map, which hit the same wall), so
# pages goes through this app's own endpoints from the start.

_PAGE_UPDATABLE_COLUMNS = {"page_name", "url", "cluster", "category", "target_category", "target_type"}


def insert_page_rows(project_slug, rows):
    """Bulk-inserts page rows (page_name/url/cluster/category) uploaded via
    the frontend's Add Pages flow. Returns the inserted rows (with ids), in
    the same order as `rows`."""
    if not rows:
        return []
    inserted = []
    with engine.begin() as conn:
        for batch in _chunked(rows, 500):
            values_sql = ", ".join(
                f"(:project_name, :page_name{i}, :url{i}, :cluster{i}, :category{i})"
                for i in range(len(batch))
            )
            params = {"project_name": project_slug}
            for i, r in enumerate(batch):
                params[f"page_name{i}"] = r.get("pageName")
                params[f"url{i}"] = r.get("url")
                params[f"cluster{i}"] = r.get("cluster")
                params[f"category{i}"] = r.get("category")
            result = conn.execute(text(f"""
                INSERT INTO pages (project_name, page_name, url, cluster, category)
                VALUES {values_sql}
                RETURNING id, page_name, url, cluster, category, target_category, target_type
            """), params)
            inserted.extend(dict(r) for r in result.mappings().fetchall())
    return inserted


def get_page_rows(project_slug):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT id, page_name, url, cluster, category, target_category, target_type
            FROM pages WHERE project_name = :project_name ORDER BY id
        """), {"project_name": project_slug}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_pages_counts():
    """{project_slug: page_count} for every active project that currently has at
    least one page row -- lets the Pages tab know upfront (without
    fetching each project's full page list) which projects to list, so a
    project whose pages were deleted/soft-deleted stops showing up there."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT p.project_name, COUNT(*) AS count
            FROM pages p
            JOIN projects pr ON p.project_name = pr.slug
            WHERE pr.deleted_at IS NULL
            GROUP BY p.project_name
        """)).mappings().fetchall()
        return {r["project_name"]: r["count"] for r in rows}


def get_pages_stats():
    """Per-project {total, commercial, blog} counts computed from the pages
    table's own target_type/target_category columns -- excluding soft-deleted projects."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT p.project_name,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE p.target_type = 'Commercial') AS commercial,
                   COUNT(*) FILTER (WHERE p.target_category = 'Blogs') AS blog
            FROM pages p
            JOIN projects pr ON p.project_name = pr.slug
            WHERE pr.deleted_at IS NULL
            GROUP BY p.project_name
        """)).mappings().fetchall()
        return {r["project_name"]: {"total": r["total"], "commercial": r["commercial"], "blog": r["blog"]} for r in rows}


def update_page_row(row_id, updates):
    """Updates whichever of page_name/url/cluster/category/target_category/
    target_type are present in `updates` (snake_case keys) -- silently
    ignores anything else."""
    fields = {k: v for k, v in updates.items() if k in _PAGE_UPDATABLE_COLUMNS}
    if not fields:
        return
    set_sql = ", ".join(f"{k} = :{k}" for k in fields)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE pages SET {set_sql} WHERE id = :id"), {**fields, "id": row_id})


def delete_page_row(row_id):
    archive_and_delete_page(row_id)


def bulk_delete_page_rows(ids):
    if not ids:
        return
    for page_id in ids:
        archive_and_delete_page(page_id)


# --- Competitor Pages (separate db for Competitors tab Add Pages) ---

def insert_competitor_page_rows(project_slug, rows):
    if not rows:
        return []
    inserted = []
    with engine.begin() as conn:
        for batch in _chunked(rows, 500):
            values_sql = ", ".join(
                f"(:project_name, :page_name{i}, :url{i}, :cluster{i}, :category{i})"
                for i in range(len(batch))
            )
            params = {"project_name": project_slug}
            for i, r in enumerate(batch):
                params[f"page_name{i}"] = r.get("pageName")
                params[f"url{i}"] = r.get("url")
                params[f"cluster{i}"] = r.get("cluster")
                params[f"category{i}"] = r.get("category")
            result = conn.execute(text(f"""
                INSERT INTO competitor_pages (project_name, page_name, url, cluster, category)
                VALUES {values_sql}
                RETURNING id, page_name, url, cluster, category, target_category, target_type
            """), params)
            inserted.extend(dict(r) for r in result.mappings().fetchall())
    return inserted


def get_competitor_page_rows(project_slug):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT id, page_name, url, cluster, category, target_category, target_type
            FROM competitor_pages WHERE project_name = :project_name ORDER BY id
        """), {"project_name": project_slug}).mappings().fetchall()
        return [dict(r) for r in rows]


def update_competitor_page_row(row_id, updates):
    fields = {k: v for k, v in updates.items() if k in _PAGE_UPDATABLE_COLUMNS}
    if not fields:
        return
    set_sql = ", ".join(f"{k} = :{k}" for k in fields)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE competitor_pages SET {set_sql} WHERE id = :id"), {**fields, "id": row_id})


def delete_competitor_page_row(row_id):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM competitor_pages WHERE id = :id"), {"id": row_id})


def bulk_delete_competitor_page_rows(ids):
    if not ids:
        return
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM competitor_pages WHERE id = ANY(:ids)"), {"ids": ids})


def delete_pages_by_project(project_slug):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM pages WHERE project_name = :project_slug"), {"project_slug": project_slug})
        conn.execute(text("DELETE FROM competitor_pages WHERE project_name = :project_slug"), {"project_slug": project_slug})


# --- Competitors (each scoped to a project via project_slug) --------------

_COMPETITOR_UPDATABLE_COLUMNS = {"name", "domain", "da", "target_regions", "project_slug", "category", "cluster", "type", "website_type", "url", "urls"}


def insert_competitor(domain, name=None, da=None, target_regions=None, project_slug=None, category=None, cluster=None, type=None, website_type=None, url=None, urls=None):
    wtype = type or website_type
    with engine.begin() as conn:
        row = conn.execute(text("""
            INSERT INTO competitors
                (domain, name, da, target_regions, project_slug, category, cluster, type, website_type, url, urls, common_kw, common_kw_change,
                 total_kw, total_kw_change, ai_comp_level, ai_comp_change, serp_comp_level, comp_level)
            VALUES (:domain, :name, :da, :target_regions, :project_slug, :category, :cluster, :type, :website_type, :url, :urls, 0, 0, 0, 0, 0, 0, 0, 0)
            RETURNING *
        """), {
            "domain": domain, "name": name, "da": da, "target_regions": target_regions or [],
            "project_slug": project_slug, "category": category, "cluster": cluster,
            "type": wtype, "website_type": wtype, "url": url, "urls": urls or []
        }).mappings().fetchone()
        return dict(row)


def get_competitors(project_slug=None):
    with engine.begin() as conn:
        if project_slug:
            rows = conn.execute(
                text("""
                    SELECT c.* FROM competitors c
                    LEFT JOIN projects p ON c.project_slug = p.slug
                    WHERE c.project_slug = :project_slug AND (p.deleted_at IS NULL OR p.slug IS NULL)
                    ORDER BY c.created_at DESC
                """),
                {"project_slug": project_slug},
            ).mappings().fetchall()
        else:
            rows = conn.execute(
                text("""
                    SELECT c.* FROM competitors c
                    LEFT JOIN projects p ON c.project_slug = p.slug
                    WHERE (p.deleted_at IS NULL OR p.slug IS NULL)
                    ORDER BY c.created_at DESC
                """)
            ).mappings().fetchall()
        return [dict(r) for r in rows]


def update_competitor(competitor_id, updates):
    """Updates whichever of name/domain/da/target_regions/project_slug/category/cluster/type are
    present in `updates` (snake_case keys) -- silently ignores anything else."""
    fields = {k: v for k, v in updates.items() if k in _COMPETITOR_UPDATABLE_COLUMNS}
    if not fields:
        return
    set_sql = ", ".join(f"{k} = :{k}" for k in fields) + ", updated_at = now()"
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE competitors SET {set_sql} WHERE id = :id"), {**fields, "id": competitor_id})


def update_competitor_website_type(domain_or_url, website_type):
    if not domain_or_url or not website_type:
        return
    clean_domain = str(domain_or_url).strip().lower()
    if clean_domain.startswith("http://") or clean_domain.startswith("https://"):
        try:
            from urllib.parse import urlparse
            clean_domain = urlparse(clean_domain).netloc.lower()
        except Exception:
            pass
    clean_domain = clean_domain.replace("www.", "")
    if not clean_domain:
        return

    with engine.begin() as conn:
        conn.execute(
            text("UPDATE competitors SET website_type = :wtype, type = :wtype, updated_at = now() WHERE LOWER(domain) LIKE :dom OR LOWER(domain) = :exact"),
            {"wtype": website_type, "dom": f"%{clean_domain}%", "exact": clean_domain}
        )


def batch_update_competitor_website_type(items: list, project_slug: Optional[str] = None, batch_size: int = 5):
    """
    Saves/updates competitor website_types in DB in batches of 5.
    items: list of dicts [{"url": str, "website_type": str, "is_competitor": str}, ...]
    """
    if not items:
        return

    total = len(items)
    for i in range(0, total, batch_size):
        batch = items[i:i + batch_size]
        print(f"[DB BATCH SAVE] Project: '{project_slug or 'All'}' | Saving batch of {len(batch)} items ({i+1} to {min(i+batch_size, total)} of {total})...", flush=True)
        with engine.begin() as conn:
            for item in batch:
                url = item.get("url")
                raw_wtype = item.get("website_type")
                if not url or not raw_wtype:
                    continue

                wtype = "Listing" if raw_wtype == "Platform" else raw_wtype
                clean_dom = str(url).strip().lower().replace("http://", "").replace("https://", "").replace("www.", "").split("/")[0]

                if project_slug:
                    res = conn.execute(
                        text("""
                            UPDATE competitors 
                            SET website_type = :wtype, type = :wtype, updated_at = now() 
                            WHERE project_slug = :pslug 
                              AND (LOWER(domain) LIKE :dom OR LOWER(domain) = :exact OR LOWER(name) LIKE :dom OR LOWER(url) LIKE :dom)
                        """),
                        {"wtype": wtype, "dom": f"%{clean_dom}%", "exact": clean_dom, "pslug": project_slug}
                    )
                else:
                    res = conn.execute(
                        text("""
                            UPDATE competitors 
                            SET website_type = :wtype, type = :wtype, updated_at = now() 
                            WHERE LOWER(domain) LIKE :dom OR LOWER(domain) = :exact OR LOWER(name) LIKE :dom OR LOWER(url) LIKE :dom
                        """),
                        {"wtype": wtype, "dom": f"%{clean_dom}%", "exact": clean_dom}
                    )

                rows_updated = res.rowcount
                print(f"  [DB ROW UPDATED] Project: '{project_slug or 'All'}' | Domain/URL: '{clean_dom}' -> type: '{wtype}' ({rows_updated} competitor DB rows updated)", flush=True)
                save_url_classification(url=url, domain=clean_dom, website_type=wtype, is_competitor=item.get("is_competitor"))


def get_url_classification(url_or_domain: str):
    if not url_or_domain:
        return None
    raw = str(url_or_domain).strip().lower()
    clean_domain = raw
    if clean_domain.startswith("http://") or clean_domain.startswith("https://"):
        try:
            from urllib.parse import urlparse
            clean_domain = urlparse(clean_domain).netloc.lower()
        except Exception:
            pass
    clean_domain = clean_domain.replace("www.", "")

    with engine.begin() as conn:
        # 1. Check url_classifications table
        row = conn.execute(
            text("SELECT * FROM url_classifications WHERE LOWER(url) = :url OR LOWER(domain) = :dom OR LOWER(domain) LIKE :dom_like LIMIT 1"),
            {"url": raw, "dom": clean_domain, "dom_like": f"%{clean_domain}%"}
        ).mappings().fetchone()

        if row and row.get("website_type"):
            return {
                "url": url_or_domain,
                "website_type": row["website_type"],
                "is_competitor": row.get("is_competitor") or ("YES" if "Official" in row["website_type"] else "NO")
            }

        # 2. Check competitors table
        comp_row = conn.execute(
            text("SELECT website_type, type FROM competitors WHERE (website_type IS NOT NULL OR type IS NOT NULL) AND LOWER(domain) LIKE :dom LIMIT 1"),
            {"dom": f"%{clean_domain}%"}
        ).mappings().fetchone()

        if comp_row:
            wtype = comp_row.get("website_type") or comp_row.get("type")
            if wtype:
                return {
                    "url": url_or_domain,
                    "website_type": wtype,
                    "is_competitor": "YES" if "Official" in wtype else "NO"
                }

    return None


def save_url_classification(url: str, website_type: str, is_competitor: str = "NO"):
    if not url or not website_type:
        return
    raw_url = str(url).strip()
    clean_domain = raw_url.lower()
    if clean_domain.startswith("http://") or clean_domain.startswith("https://"):
        try:
            from urllib.parse import urlparse
            clean_domain = urlparse(clean_domain).netloc.lower()
        except Exception:
            pass
    clean_domain = clean_domain.replace("www.", "")

    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO url_classifications (url, domain, website_type, is_competitor, updated_at)
                VALUES (:url, :domain, :wtype, :is_comp, now())
                ON CONFLICT (url) DO UPDATE SET
                    website_type = EXCLUDED.website_type,
                    is_competitor = EXCLUDED.is_competitor,
                    updated_at = now()
            """),
            {"url": raw_url, "domain": clean_domain, "wtype": website_type, "is_comp": is_competitor}
        )

        if clean_domain:
            conn.execute(
                text("UPDATE competitors SET website_type = :wtype, type = :wtype, updated_at = now() WHERE LOWER(domain) LIKE :dom"),
                {"wtype": website_type, "dom": f"%{clean_domain}%"}
            )


def delete_competitor(competitor_id):
    archive_and_delete_competitor(competitor_id)


def delete_competitors_by_project(project_slug):
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM competitors WHERE project_slug = :project_slug"), {"project_slug": project_slug}).mappings().fetchall()
        for row in rows:
            r = dict(row)
            conn.execute(text("""
                INSERT INTO recycle_bin (item_type, item_id, project_slug, project_name, item_name, deleted_at, data)
                VALUES ('competitor', :item_id, :project_slug, :project_name, :item_name, now(), CAST(:data AS JSONB))
            """), {
                "item_id": str(r.get("id")),
                "project_slug": project_slug,
                "project_name": project_slug,
                "item_name": r.get("domain") or r.get("name") or f"Competitor #{r.get('id')}",
                "data": json.dumps(_clean_for_json(r))
            })
        conn.execute(text("DELETE FROM competitors WHERE project_slug = :project_slug"), {"project_slug": project_slug})


def get_competitor(competitor_id):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM competitors WHERE id = :id"), {"id": competitor_id}).mappings().fetchone()
        return dict(row) if row else None


def get_competitor_by_domain_and_project(domain, project_slug):
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT * FROM competitors WHERE domain = :domain AND project_slug = :project_slug"),
            {"domain": domain, "project_slug": project_slug},
        ).mappings().fetchone()
        return dict(row) if row else None


_COMPETITOR_ANALYSIS_COLUMNS = {
    "common_kw", "common_kw_change", "total_kw", "total_kw_change",
    "ai_comp_level", "ai_comp_change", "serp_comp_level", "comp_level",
}


def set_competitor_analysis(competitor_id, fields):
    """Writes the analytics columns (common_kw/total_kw/ai_comp_level/
    serp_comp_level/comp_level and their *_change counterparts) -- the one
    path allowed to touch them, called only from the 'Find Competitors'
    analysis pipeline (update_competitor()'s allowlist deliberately
    excludes these since they aren't user-editable)."""
    fields = {k: v for k, v in fields.items() if k in _COMPETITOR_ANALYSIS_COLUMNS}
    if not fields:
        return
    set_sql = ", ".join(f"{k} = :{k}" for k in fields) + ", updated_at = now()"
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE competitors SET {set_sql} WHERE id = :id"), {**fields, "id": competitor_id})


def insert_competitor_snapshot(competitor_id, domain=None, name=None, target_regions=None, da=None,
                                ranking_keywords=None, total_keywords=None, common_kw=None,
                                ai_comp_level=None, serp_comp_level=None, comp_level=None,
                                device=None, location=None, keyword_positions=None):
    with engine.begin() as conn:
        row = conn.execute(text("""
            INSERT INTO competitor_snapshots
                (competitor_id, domain, name, target_regions, da, ranking_keywords, total_keywords,
                 common_kw, ai_comp_level, serp_comp_level, comp_level, device, location, keyword_positions)
            VALUES (:competitor_id, :domain, :name, :target_regions, :da, :ranking_keywords, :total_keywords,
                    :common_kw, :ai_comp_level, :serp_comp_level, :comp_level, :device, :location,
                    CAST(:keyword_positions AS JSONB))
            RETURNING *
        """), {
            "competitor_id": competitor_id, "domain": domain, "name": name,
            "target_regions": target_regions or [], "da": da,
            "ranking_keywords": ranking_keywords, "total_keywords": total_keywords,
            "common_kw": common_kw, "ai_comp_level": ai_comp_level,
            "serp_comp_level": serp_comp_level, "comp_level": comp_level,
            "device": device, "location": location,
            "keyword_positions": json.dumps(keyword_positions) if keyword_positions is not None else None,
        }).mappings().fetchone()
        return dict(row)


def get_competitor_snapshots(competitor_id):
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT * FROM competitor_snapshots WHERE competitor_id = :competitor_id ORDER BY created_at DESC"),
            {"competitor_id": competitor_id},
        ).mappings().fetchall()
        return [dict(r) for r in rows]


def get_all_keyword_rows(domain):
    """Every keyword_categories row for this project, regardless of
    whether it's already been categorized -- used by the 'trigger
    categorization' endpoint's recluster=True path (re-running AI
    clustering over a project that's already fully categorized, when the
    user explicitly confirms they want to overwrite it), as opposed to
    get_uncategorized_keyword_rows() below, which only picks up rows that
    have never been categorized."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT id, keyword FROM keyword_categories
            WHERE project_name = :project_name
            ORDER BY id
        """), {"project_name": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_uncategorized_keyword_rows(domain):
    """Every keyword_categories row for this project that hasn't been
    categorized yet, ordered by id (i.e. original upload/insertion
    order). Used by the 'trigger categorization' endpoint, which
    categorizes ALREADY-INSERTED rows in place -- it never inserts new
    rows, so it can't create duplicates the way re-uploading the same
    sheet through /jobs/category would.

    Matched on `category IS NULL` rather than `status = 'queued'` --
    that's the real signal a row needs categorizing, and it's robust to
    rows that ended up in this table some other way than the normal
    upload pipeline (e.g. seeded directly via Supabase, or a row whose
    previous categorization attempt errored out) where `status` might be
    NULL or something other than 'queued'."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT id, keyword FROM keyword_categories
            WHERE project_name = :project_name AND category IS NULL
            ORDER BY id
        """), {"project_name": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_categorized_keyword_rows(domain):
    """Every keyword_categories row for this project that already has a
    category (i.e. has already been through AI-Clustering) -- used by the
    project-scoped rank-check endpoint. Deliberately NOT scoped by
    job_id/a specific job the way the old job-based rank-check endpoint
    was: a project's rows may span several categorization runs, or (via
    the frontend's Add Keywords flow, which inserts straight into
    Supabase) may never have had a job_id at all -- rank-checking should
    still work as long as the row has actually been clustered."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT id, keyword, landing_page_url FROM keyword_categories
            WHERE project_name = :project_name AND category IS NOT NULL
            ORDER BY id
        """), {"project_name": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


def set_keyword_rows_job(job_id, row_ids):
    """Backfills job_id onto keyword rows that were inserted directly (no
    job -- e.g. via the frontend's Add Keywords flow, which never creates
    a `jobs` row) once a categorization job picks them up. Without this,
    those rows keep job_id NULL forever, and
    get_job_keyword_rows_for_rank_check(job_id) -- which the "Check
    initial ranking" button relies on to find a project's latest
    completed job's rows -- would always find zero rows for them, so rank
    checks silently enqueue nothing."""
    if not row_ids:
        return
    with engine.begin() as conn:
        conn.execute(text("UPDATE keyword_categories SET job_id = :job_id WHERE id = ANY(:ids)"),
                     {"job_id": job_id, "ids": row_ids})


def insert_category_result(job_id, domain, keyword, category, cluster, status, meta=None, error=None):
    """LEGACY fallback path -- inserts a brand-new row rather than
    updating a pre-inserted one. Kept only so any task already sitting in
    the RQ queue from before insert_keyword_rows()/update_keyword_result()
    existed (i.e. enqueued without a row_id) still completes safely
    during a deploy transition."""
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO keyword_categories (job_id, project_name, keyword, category, cluster, status, meta, error)
            VALUES (:job_id, :project_name, :keyword, :category, :cluster, :status, CAST(:meta AS JSONB), :error)
        """), {
            "job_id": job_id, "project_name": domain, "keyword": keyword, "category": category,
            "cluster": cluster, "status": status,
            "meta": json.dumps(meta) if meta is not None else None,
            "error": error,
        })


def insert_pipeline_result(domain, keyword, category, target_type, subtype, meta=None):
    """Used by scripts/run_pipeline.py -- no RQ/Redis job involved, so
    job_id is always NULL here (no `jobs` row exists for a script-driven
    run). `cluster` is deliberately left out/NULL at insert time -- it's
    filled in afterward, in bulk, by replace_domain_clusters() (called
    from scripts/cluster_assigner.py's cluster_project(), once every
    keyword in the run has a category) matching on project_name+category,
    the same way it already does for the rest of this table."""
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO keyword_categories
                (job_id, project_name, keyword, category, status, target_type, subtype, meta)
            VALUES
                (NULL, :project_name, :keyword, :category, 'processed', :target_type, :subtype, CAST(:meta AS JSONB))
        """), {
            "project_name": domain, "keyword": keyword, "category": category,
            "target_type": target_type, "subtype": subtype,
            "meta": json.dumps(meta) if meta is not None else None,
        })


def get_crawled_keywords(domain):
    """Every keyword in this project that ALREADY has a non-empty top-3
    result stored (meta->'top3' is a real, non-empty JSON array) -- used
    by scripts/run_pipeline.py to skip re-scraping/re-categorizing
    keywords a previous run already finished successfully, so re-running
    the pipeline on the same (or an overlapping) input file only does
    work for keywords that are still missing or came back empty."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT keyword FROM keyword_categories
            WHERE project_name = :project_name
              AND meta IS NOT NULL
              AND jsonb_array_length(COALESCE(meta -> 'top3', '[]'::jsonb)) > 0
        """), {"project_name": domain}).fetchall()
        return {r.keyword for r in rows}


def get_job_category_results(job_id):
    """job_id alone is enough to filter (globally unique in the shared
    table) -- no need to look up the job's project first anymore."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT keyword, category, cluster, status, error, meta, checked_at,
                   sv, kw_diff, type, target_type, target_subtype, target_geo, priority, landing_page_url,
                   rank, rank_checked_at, rank_meta
            FROM keyword_categories WHERE job_id = :job_id ORDER BY id
        """), {"job_id": job_id}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_domain_results(domain):
    """All keyword results ever processed for a project, across every job
    -- this is what your UI's per-project 'project table' view reads from.

    `id` is included so callers can target a specific row for a
    follow-up update (e.g. test_api.py's agentic rank checker calling
    update_keyword_rank(row["id"], ...) below) -- existing callers that
    only read by key are unaffected by the extra field."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT id, keyword, category, cluster, status, error, meta, checked_at, job_id,
                   sv, kw_diff, type, target_type, target_subtype, target_geo, priority, landing_page_url,
                   rank, rank_checked_at, rank_meta
            FROM keyword_categories WHERE project_name = :project_name ORDER BY checked_at DESC
        """), {"project_name": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_categories_overview(domain):
    """Every distinct category in this project, with keyword count and one
    example audit trail (top-3 titles/urls that produced it)."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT category, cluster, count(*) AS keyword_count,
                   array_agg(keyword ORDER BY checked_at) AS keywords,
                   (array_agg(meta ORDER BY checked_at))[1] AS example_meta
            FROM keyword_categories
            WHERE project_name = :project_name AND category IS NOT NULL
            GROUP BY category, cluster
            ORDER BY keyword_count DESC
        """), {"project_name": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_clusters_overview(domain):
    """Every distinct cluster in this project, with the categories inside
    it and total keyword count."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT cluster, count(DISTINCT category) AS category_count,
                   count(*) AS keyword_count,
                   array_agg(DISTINCT category) AS categories
            FROM keyword_categories
            WHERE project_name = :project_name AND cluster IS NOT NULL
            GROUP BY cluster
            ORDER BY keyword_count DESC
        """), {"project_name": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


# --- One-time migration: per-project physical tables -> shared tables ----

def _table_exists(conn, table_name):
    row = conn.execute(text("""
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = :table_name
    """), {"table_name": table_name}).fetchone()
    return row is not None


def _existing_columns(conn, table_name):
    rows = conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :table_name
    """), {"table_name": table_name}).fetchall()
    return {r.column_name for r in rows}


def migrate_per_project_tables_to_shared():
    """One-time migration FROM the previous design (dedicated physical
    tables per project: categories_<slug>, clusters_<slug>,
    category_cluster_map_<slug>, keyword_categories_<slug>) INTO the
    current shared tables (categories/clusters/category_cluster_map/
    keyword_categories, each with a project_name column).

    Each project is migrated in its OWN transaction (see
    _migrate_one_project_to_shared) -- so if one project fails (e.g. an
    older per-project table missing a column added later), every OTHER
    project's migration that already succeeded stays committed. The
    failing project is skipped with an error printed; fix the underlying
    issue and re-run just for that project if needed (safe to re-run the
    whole thing -- categories/clusters/category_cluster_map use ON
    CONFLICT DO NOTHING; keyword_categories rows have no natural unique
    key, so only re-run for a project whose keyword rows didn't fully
    commit yet, or you'll get duplicates).

    Does NOT drop the old per-project tables -- verify counts match, then
    drop them yourself once you're confident (see the SQL printed at the
    end)."""
    projects = list_projects()
    if not projects:
        print("No projects registered -- nothing to migrate.")
        return

    for project in projects:
        slug = project["slug"]
        try:
            _migrate_one_project_to_shared(slug)
        except Exception as e:
            print(f"[{slug}] FAILED, nothing committed for this project: {e}")

    print("\nMigration pass done. After verifying row counts match, you can drop the old")
    print("per-project tables yourself, e.g. for each project slug:")
    print("  DROP TABLE IF EXISTS categories_<slug>;")
    print("  DROP TABLE IF EXISTS clusters_<slug>;")
    print("  DROP TABLE IF EXISTS category_cluster_map_<slug>;")
    print("  DROP TABLE IF EXISTS keyword_categories_<slug>;")


def _migrate_one_project_to_shared(slug):
    """Migrates ONE project inside its OWN transaction -- so a failure on
    one project (e.g. a schema mismatch on an older per-project table)
    can never roll back a different project's already-successful
    migration. Called by migrate_per_project_tables_to_shared() above,
    once per project, each wrapped in its own try/except.

    Also tolerates keyword rows whose job_id no longer exists in `jobs`
    (an orphaned FK reference) -- those rows are still migrated, just
    with job_id set to NULL, rather than aborting the whole project's
    migration on a ForeignKeyViolation."""
    old_categories = f"categories_{slug}"
    old_clusters = f"clusters_{slug}"
    old_map = f"category_cluster_map_{slug}"
    old_keywords = f"keyword_categories_{slug}"

    with engine.begin() as conn:
        if not _table_exists(conn, old_keywords):
            print(f"[{slug}] no old per-project tables found -- skipping.")
            return

        cat_rows = conn.execute(text(f"SELECT name FROM {old_categories}")).fetchall() \
            if _table_exists(conn, old_categories) else []
        for r in cat_rows:
            conn.execute(text("""
                INSERT INTO categories (project_name, name) VALUES (:project_name, :name)
                ON CONFLICT (project_name, name) DO NOTHING
            """), {"project_name": slug, "name": r.name})

        clus_rows = conn.execute(text(f"SELECT name FROM {old_clusters}")).fetchall() \
            if _table_exists(conn, old_clusters) else []
        for r in clus_rows:
            conn.execute(text("""
                INSERT INTO clusters (project_name, name) VALUES (:project_name, :name)
                ON CONFLICT (project_name, name) DO NOTHING
            """), {"project_name": slug, "name": r.name})

        map_rows = conn.execute(text(f"SELECT category, cluster FROM {old_map}")).fetchall() \
            if _table_exists(conn, old_map) else []
        for r in map_rows:
            conn.execute(text("""
                INSERT INTO category_cluster_map (project_name, category, cluster, updated_at)
                VALUES (:project_name, :category, :cluster, now())
                ON CONFLICT (project_name, category) DO NOTHING
            """), {"project_name": slug, "category": r.category, "cluster": r.cluster})

        # Older per-project tables (created before the pass-through
        # columns existed) may be missing sv/kw_diff/type/target_type/
        # target_subtype/target_geo/priority/landing_page_url entirely
        # -- select NULL for whichever of those aren't actually there
        # instead of assuming every old table has the full schema.
        existing_cols = _existing_columns(conn, old_keywords)
        optional_cols = [
            "sv", "kw_diff", "type", "target_type", "target_subtype",
            "target_geo", "priority", "landing_page_url",
        ]
        select_parts = ["job_id", "keyword", "category", "cluster", "status", "error", "meta", "checked_at"]
        select_parts += [
            col if col in existing_cols else f"NULL AS {col}"
            for col in optional_cols
        ]
        select_sql = ", ".join(select_parts)

        kw_rows = conn.execute(text(f"""
            SELECT {select_sql}
            FROM {old_keywords}
        """)).mappings().fetchall()

        # Some old keyword rows may reference a job_id that no longer
        # exists in `jobs` (deleted/orphaned job) -- keyword_categories.
        # job_id is a FK to jobs(id), so inserting those as-is would
        # raise a ForeignKeyViolation and abort this project's entire
        # migration. Instead, null out just the orphaned references --
        # the keyword data itself is still migrated, it just loses its
        # link back to a job that doesn't exist anymore anyway.
        distinct_job_ids = {r["job_id"] for r in kw_rows if r["job_id"] is not None}
        valid_job_ids = set()
        if distinct_job_ids:
            id_list = list(distinct_job_ids)
            found = conn.execute(text("""
                SELECT id FROM jobs WHERE id = ANY(:ids)
            """), {"ids": id_list}).fetchall()
            valid_job_ids = {f.id for f in found}
        orphaned_count = len(distinct_job_ids - valid_job_ids)
        if orphaned_count:
            print(f"[{slug}] {orphaned_count} distinct job_id(s) no longer exist in `jobs` -- "
                  f"nulling those references on migrated rows (keyword data itself is kept).")

        for chunk in _chunked(kw_rows):
            values_sql = ", ".join(
                f"(:job_id{i}, :project_name{i}, :keyword{i}, :category{i}, :cluster{i}, :status{i}, "
                f":error{i}, CAST(:meta{i} AS JSONB), :checked_at{i}, :sv{i}, :kw_diff{i}, :type{i}, "
                f":target_type{i}, :target_subtype{i}, :target_geo{i}, :priority{i}, :landing_page_url{i})"
                for i in range(len(chunk))
            )
            params = {}
            for i, r in enumerate(chunk):
                row_job_id = r["job_id"]
                params[f"job_id{i}"] = row_job_id if row_job_id in valid_job_ids else None
                params[f"project_name{i}"] = slug
                params[f"keyword{i}"] = r["keyword"]
                params[f"category{i}"] = r["category"]
                params[f"cluster{i}"] = r["cluster"]
                params[f"status{i}"] = r["status"]
                params[f"error{i}"] = r["error"]
                params[f"meta{i}"] = json.dumps(r["meta"]) if r["meta"] is not None else None
                params[f"checked_at{i}"] = r["checked_at"]
                params[f"sv{i}"] = r["sv"]
                params[f"kw_diff{i}"] = r["kw_diff"]
                params[f"type{i}"] = r["type"]
                params[f"target_type{i}"] = r["target_type"]
                params[f"target_subtype{i}"] = r["target_subtype"]
                params[f"target_geo{i}"] = r["target_geo"]
                params[f"priority{i}"] = r["priority"]
                params[f"landing_page_url{i}"] = r["landing_page_url"]

                conn.execute(text(f"""
                    INSERT INTO keyword_categories
                        (job_id, project_name, keyword, category, cluster, status, error, meta, checked_at,
                         sv, kw_diff, type, target_type, target_subtype, target_geo, priority, landing_page_url)
                    VALUES {values_sql}
                """), params)

        print(f"[{slug}] migrated {len(cat_rows)} categories, {len(clus_rows)} clusters, "
              f"{len(map_rows)} category->cluster mappings, {len(kw_rows)} keyword rows.")


# --- System Audit Logs Helpers ----------------------------------------------

def insert_audit_log(user_email, action, status='Success', project_name=None, module=None):
    with engine.begin() as conn:
        row = conn.execute(text("""
            INSERT INTO audit_logs (user_email, action, status, project_name, module)
            VALUES (:user_email, :action, :status, :project_name, :module)
            RETURNING id, timestamp, user_email AS user, action, status, project_name, module
        """), {
            "user_email": user_email or 'system',
            "action": action,
            "status": status or 'Success',
            "project_name": project_name,
            "module": module
        }).mappings().fetchone()
        res = dict(row)
        if res.get('timestamp'):
            res['timestamp'] = res['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
        return res


def get_audit_logs(limit=200, status_filter=None, search_query=None):
    with engine.begin() as conn:
        sql = """
            SELECT a.id, a.timestamp, a.user_email AS user, COALESCE(u.name, '') AS user_name,
                   a.action, a.status, a.project_name, a.module
            FROM audit_logs a
            LEFT JOIN users u ON LOWER(a.user_email) = LOWER(u.email)
            WHERE LOWER(a.user_email) != 'system'
        """
        params = {"limit": limit}

        if status_filter and status_filter.lower() != 'all':
            sql += " AND LOWER(a.status) = LOWER(:status)"
            params["status"] = status_filter

        if search_query:
            sql += " AND (LOWER(a.user_email) LIKE :search OR LOWER(u.name) LIKE :search OR LOWER(a.action) LIKE :search OR LOWER(a.project_name) LIKE :search OR LOWER(a.module) LIKE :search)"
            params["search"] = f"%{search_query.lower()}%"

        sql += " ORDER BY a.id DESC LIMIT :limit"

        rows = conn.execute(text(sql), params).mappings().fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get('timestamp'):
                d['timestamp'] = d['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
            result.append(d)
        return result


def clear_audit_logs():
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM audit_logs"))


def archive_and_delete_keyword(kw_id):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM keyword_categories WHERE id = :id"), {"id": kw_id}).mappings().fetchone()
        if row:
            r = dict(row)
            conn.execute(text("""
                INSERT INTO recycle_bin (item_type, item_id, project_slug, project_name, item_name, deleted_at, data)
                VALUES ('keyword', :item_id, :project_slug, :project_name, :item_name, now(), CAST(:data AS JSONB))
            """), {
                "item_id": str(kw_id),
                "project_slug": r.get("project_name", ""),
                "project_name": r.get("project_name", ""),
                "item_name": r.get("keyword") or f"Keyword #{kw_id}",
                "data": json.dumps(_clean_for_json(r))
            })
            conn.execute(text("DELETE FROM keyword_categories WHERE id = :id"), {"id": kw_id})


def archive_and_delete_page(page_id):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM pages WHERE id = :id"), {"id": page_id}).mappings().fetchone()
        if row:
            r = dict(row)
            conn.execute(text("""
                INSERT INTO recycle_bin (item_type, item_id, project_slug, project_name, item_name, deleted_at, data)
                VALUES ('page', :item_id, :project_slug, :project_name, :item_name, now(), CAST(:data AS JSONB))
            """), {
                "item_id": str(page_id),
                "project_slug": r.get("project_name", ""),
                "project_name": r.get("project_name", ""),
                "item_name": r.get("page_name") or r.get("url") or f"Page #{page_id}",
                "data": json.dumps(_clean_for_json(r))
            })
            conn.execute(text("DELETE FROM pages WHERE id = :id"), {"id": page_id})


def archive_and_delete_competitor(comp_id):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM competitors WHERE id = :id"), {"id": comp_id}).mappings().fetchone()
        if row:
            r = dict(row)
            conn.execute(text("""
                INSERT INTO recycle_bin (item_type, item_id, project_slug, project_name, item_name, deleted_at, data)
                VALUES ('competitor', :item_id, :project_slug, :project_name, :item_name, now(), CAST(:data AS JSONB))
            """), {
                "item_id": str(comp_id),
                "project_slug": r.get("project_slug", ""),
                "project_name": r.get("project_slug", ""),
                "item_name": r.get("domain") or r.get("name") or f"Competitor #{comp_id}",
                "data": json.dumps(_clean_for_json(r))
            })
            conn.execute(text("DELETE FROM competitors WHERE id = :id"), {"id": comp_id})


def restore_recycle_bin_item(item_identifier):
    with engine.begin() as conn:
        row = None
        if str(item_identifier).isdigit():
            row = conn.execute(text("SELECT * FROM recycle_bin WHERE id = :id"), {"id": int(item_identifier)}).mappings().fetchone()
        if not row:
            row = conn.execute(text("""
                SELECT * FROM recycle_bin
                WHERE project_slug = :p OR item_id = :p OR item_name = :p
                LIMIT 1
            """), {"p": str(item_identifier)}).mappings().fetchone()

        if not row:
            return None

        r = dict(row)
        item_type = r.get("item_type", "project")
        data = json.loads(r["data"]) if isinstance(r["data"], str) else r["data"]

        if item_type == "project":
            restore_project(r["project_slug"])
            return {"restored": r["project_slug"], "type": "project", "project_slug": r["project_slug"]}

        elif item_type == "page":
            conn.execute(text("""
                INSERT INTO pages (project_name, page_name, url, cluster, category, target_category, target_type)
                VALUES (:project_name, :page_name, :url, :cluster, :category, :target_category, :target_type)
            """), {
                "project_name": data.get("project_name"),
                "page_name": data.get("page_name"),
                "url": data.get("url"),
                "cluster": data.get("cluster"),
                "category": data.get("category"),
                "target_category": data.get("target_category"),
                "target_type": data.get("target_type"),
            })
            conn.execute(text("DELETE FROM recycle_bin WHERE id = :id"), {"id": r["id"]})
            return {"restored": r["item_name"], "type": "page", "project_slug": r["project_slug"]}

        elif item_type == "pages":
            for page in data:
                conn.execute(text("""
                    INSERT INTO pages (project_name, page_name, url, cluster, category, target_category, target_type)
                    VALUES (:project_name, :page_name, :url, :cluster, :category, :target_category, :target_type)
                """), {
                    "project_name": page.get("project_name"),
                    "page_name": page.get("page_name"),
                    "url": page.get("url"),
                    "cluster": page.get("cluster"),
                    "category": page.get("category"),
                    "target_category": page.get("target_category"),
                    "target_type": page.get("target_type"),
                })
            conn.execute(text("DELETE FROM recycle_bin WHERE id = :id"), {"id": r["id"]})
            return {"restored": r["item_name"], "type": "pages", "project_slug": r["project_slug"]}

        elif item_type == "keyword":
            conn.execute(text("""
                INSERT INTO keyword_categories (project_name, keyword, sv, kw_diff, cluster, category, type, target_type, subtype, target_geo, priority, landing_page_url, rank)
                VALUES (:project_name, :keyword, :sv, :kw_diff, :cluster, :category, :type, :target_type, :subtype, :target_geo, :priority, :landing_page_url, :rank)
            """), {
                "project_name": data.get("project_name"), "keyword": data.get("keyword"),
                "sv": data.get("sv"), "kw_diff": data.get("kw_diff"),
                "cluster": data.get("cluster"), "category": data.get("category"),
                "type": data.get("type"), "target_type": data.get("target_type"),
                "subtype": data.get("subtype"), "target_geo": data.get("target_geo"),
                "priority": data.get("priority"), "landing_page_url": data.get("landing_page_url"),
                "rank": data.get("rank")
            })
            conn.execute(text("DELETE FROM recycle_bin WHERE id = :id"), {"id": r["id"]})
            return {"restored": r["item_name"], "type": "keyword", "project_slug": r["project_slug"]}

        elif item_type == "keywords":
            for kw in data:
                conn.execute(text("""
                    INSERT INTO keyword_categories (project_name, keyword, sv, kw_diff, cluster, category, type, target_type, subtype, target_geo, priority, landing_page_url, rank)
                    VALUES (:project_name, :keyword, :sv, :kw_diff, :cluster, :category, :type, :target_type, :subtype, :target_geo, :priority, :landing_page_url, :rank)
                """), {
                    "project_name": kw.get("project_name"), "keyword": kw.get("keyword"),
                    "sv": kw.get("sv"), "kw_diff": kw.get("kw_diff"),
                    "cluster": kw.get("cluster"), "category": kw.get("category"),
                    "type": kw.get("type"), "target_type": kw.get("target_type"),
                    "subtype": kw.get("subtype"), "target_geo": kw.get("target_geo"),
                    "priority": kw.get("priority"), "landing_page_url": kw.get("landing_page_url"),
                    "rank": kw.get("rank")
                })
            conn.execute(text("DELETE FROM recycle_bin WHERE id = :id"), {"id": r["id"]})
            return {"restored": r["item_name"], "type": "keywords", "project_slug": r["project_slug"]}

        elif item_type == "competitor":
            conn.execute(text("""
                INSERT INTO competitors (domain, name, da, target_regions, project_slug, category, cluster, type, website_type)
                VALUES (:domain, :name, :da, :target_regions, :project_slug, :category, :cluster, :type, :website_type)
            """), {
                "domain": data.get("domain"), "name": data.get("name"), "da": data.get("da"),
                "target_regions": data.get("target_regions"), "project_slug": data.get("project_slug"),
                "category": data.get("category"), "cluster": data.get("cluster"),
                "type": data.get("type"), "website_type": data.get("website_type"),
            })
            conn.execute(text("DELETE FROM recycle_bin WHERE id = :id"), {"id": r["id"]})
            return {"restored": r["item_name"], "type": "competitor", "project_slug": r["project_slug"]}

        elif item_type == "competitors":
            for comp in data:
                conn.execute(text("""
                    INSERT INTO competitors (domain, name, da, target_regions, project_slug, category, cluster, type, website_type)
                    VALUES (:domain, :name, :da, :target_regions, :project_slug, :category, :cluster, :type, :website_type)
                """), {
                    "domain": comp.get("domain"), "name": comp.get("name"), "da": comp.get("da"),
                    "target_regions": comp.get("target_regions"), "project_slug": comp.get("project_slug"),
                    "category": comp.get("category"), "cluster": comp.get("cluster"),
                    "type": comp.get("type"), "website_type": comp.get("website_type"),
                })
            conn.execute(text("DELETE FROM recycle_bin WHERE id = :id"), {"id": r["id"]})
            return {"restored": r["item_name"], "type": "competitors", "project_slug": r["project_slug"]}

        return None


def delete_recycle_bin_item(item_identifier):
    with engine.begin() as conn:
        p = str(item_identifier).strip()
        if p.isdigit():
            conn.execute(text("DELETE FROM recycle_bin WHERE id = :id OR item_id = :p"), {"id": int(p), "p": p})
        conn.execute(text("""
            DELETE FROM recycle_bin 
            WHERE project_slug = :p 
               OR project_name = :p 
               OR item_id = :p 
               OR item_name = :p
        """), {"p": p})

def get_latest_ai_analysis_run(project_slug: str, engine_name: str):
    with engine.begin() as conn:
        res = conn.execute(text("""
            SELECT * FROM ai_analysis
            WHERE (project_slug = :p OR project_name = :p) AND LOWER(engine) = :e
            ORDER BY created_at DESC LIMIT 1
        """), {"p": project_slug, "e": engine_name.lower().strip()}).first()
        return _clean_for_json(dict(res._mapping)) if res else None


def save_ai_analysis_run(
    project_slug: str,
    engine_name: str,
    ai_visibility: int,
    mentions: int,
    cited_pages: int,
    total_keywords: int,
    mentioned_keywords: list,
    cited_pages_list: list,
    domain: str = "",
    country: str = "India"
):
    import json
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO ai_analysis (
                project_slug, project_name, domain, country, engine,
                ai_visibility, mentions, cited_pages, total_keywords,
                mentioned_keywords, cited_pages_list, created_at
            ) VALUES (
                :project_slug, :project_name, :domain, :country, :engine,
                :ai_visibility, :mentions, :cited_pages, :total_keywords,
                CAST(:mentioned_keywords AS JSONB), CAST(:cited_pages_list AS JSONB), NOW()
            )
        """), {
            "project_slug": project_slug,
            "project_name": project_slug,
            "domain": domain,
            "country": country,
            "engine": engine_name,
            "ai_visibility": ai_visibility or 0,
            "mentions": mentions or 0,
            "cited_pages": cited_pages or 0,
            "total_keywords": total_keywords or 0,
            "mentioned_keywords": json.dumps(mentioned_keywords or []),
            "cited_pages_list": json.dumps(cited_pages_list or [])
        })


def get_project_summary(project_slug: str):
    """Fast aggregated SQL summary query for instant dashboard metrics load."""
    with engine.begin() as conn:
        slug_like = f"%{project_slug}%"
        # 1. Total Keywords count & SUM of search volume
        kw_res = conn.execute(text("""
            SELECT COUNT(*) AS total_kws, 
                   COALESCE(SUM(NULLIF(regexp_replace(CAST(sv AS TEXT), '[^0-9.]', '', 'g'), '')::numeric), 0) AS total_sv, 
                   COUNT(DISTINCT cluster) AS total_clusters
            FROM keyword_categories
            WHERE project_name = :slug OR project_name ILIKE :slug_like
        """), {"slug": project_slug, "slug_like": slug_like}).fetchone()

        total_kws = kw_res.total_kws if kw_res else 0
        total_sv = float(kw_res.total_sv) if kw_res else 0
        total_clusters = kw_res.total_clusters if kw_res else 0

        # 2. Total pages & blogs count
        page_res = conn.execute(text("""
            SELECT COUNT(*) AS total_pgs,
                   COUNT(CASE WHEN LOWER(target_type) LIKE '%blog%' OR LOWER(url) LIKE '%blog%' THEN 1 END) AS total_blogs
            FROM pages
            WHERE project_name = :slug OR project_name ILIKE :slug_like
        """), {"slug": project_slug, "slug_like": slug_like}).fetchone()

        total_pgs = page_res.total_pgs if page_res else 0
        total_blogs = page_res.total_blogs if page_res else 0

        # 3. Latest AI Analysis summary
        ai_res = conn.execute(text("""
            SELECT engine, ai_visibility, mentions, cited_pages, created_at
            FROM ai_analysis
            WHERE project_slug = :slug OR project_name ILIKE :slug_like
            ORDER BY created_at DESC
            LIMIT 5
        """), {"slug": project_slug, "slug_like": slug_like}).fetchall()

        ai_history = [{
            "engine": r.engine,
            "ai_visibility": r.ai_visibility,
            "mentions": r.mentions,
            "cited_pages": r.cited_pages,
            "created_at": r.created_at.isoformat() if r.created_at else None
        } for r in ai_res]

        return {
            "project_slug": project_slug,
            "kw_count": total_kws,
            "net_potential": total_sv,
            "cluster_count": total_clusters,
            "page_count": total_pgs,
            "blog_count": total_blogs,
            "ai_history": ai_history
        }


# --- Single Unified Monthly Operations Table Functions -------------------

def _generate_uid(custom_uid=None):
    if custom_uid and str(custom_uid).strip():
        return str(custom_uid).strip()
    import uuid
    return f"MO-{uuid.uuid4().hex[:8].upper()}"


def _insert_monthly_operation_rows(conn, filename, project_name, rows_data):
    if not rows_data:
        return

    chunk_size = 200
    for i in range(0, len(rows_data), chunk_size):
        chunk = rows_data[i:i + chunk_size]
        params = {}
        values_sql_parts = []
        for idx, r in enumerate(chunk):
            p = f"_{idx}"
            is_ver = r.get("verified")
            verified_bool = (is_ver is True) or (isinstance(is_ver, str) and is_ver.lower() == "true")
            f_data = r.get("fetched_data", r.get("fetchedData"))
            if isinstance(f_data, (dict, list)):
                f_data_str = json.dumps(f_data)
            elif isinstance(f_data, str) and f_data.strip():
                f_data_str = f_data
            else:
                f_data_str = None

            params.update({
                f"uid{p}": _generate_uid(r.get("uid")),
                f"filename{p}": filename,
                f"project_name{p}": project_name,
                f"period{p}": r.get("period", ""),
                f"scheduled_date{p}": r.get("scheduledDate", r.get("scheduled_date", "")),
                f"keyword1{p}": r.get("keyword1", ""),
                f"keyword2{p}": r.get("keyword2", ""),
                f"landing_page{p}": r.get("landingPage", r.get("landing_page", "")),
                f"cluster{p}": r.get("cluster", ""),
                f"kw_category{p}": r.get("kwCategory", r.get("kw_category", "")),
                f"activity_name{p}": r.get("activityName", r.get("activity_name", "")),
                f"word_count{p}": str(r.get("wordCount", r.get("word_count", ""))),
                f"content_spoc{p}": r.get("contentSpoc", r.get("content_spoc", "")),
                f"topic{p}": r.get("topic", ""),
                f"content_doc{p}": r.get("contentDoc", r.get("content_doc", "")),
                f"status{p}": r.get("status", ""),
                f"publisher{p}": r.get("publisher", ""),
                f"pg_site_domain{p}": r.get("pgSiteDomain", r.get("pg_site_domain", "")),
                f"live_link{p}": r.get("liveLink", r.get("live_link", "")),
                f"remarks{p}": r.get("remarks", ""),
                f"solution{p}": r.get("solution", ""),
                f"verified{p}": verified_bool,
                f"last_activity{p}": r.get("lastActivity", r.get("last_activity", "")),
                f"updated_date{p}": r.get("updatedDate", r.get("updated_date", "")),
                f"fetched_data{p}": f_data_str
            })
            values_sql_parts.append(f"""(
                :uid{p}, :filename{p}, :project_name{p}, :period{p}, :scheduled_date{p}, :keyword1{p}, :keyword2{p},
                :landing_page{p}, :cluster{p}, :kw_category{p}, :activity_name{p}, :word_count{p},
                :content_spoc{p}, :topic{p}, :content_doc{p}, :status{p}, :publisher{p},
                :pg_site_domain{p}, :live_link{p}, :remarks{p}, :solution{p}, :verified{p}, :last_activity{p}, :updated_date{p},
                CAST(:fetched_data{p} AS jsonb)
            )""")

        sql = f"""
            INSERT INTO monthly_operations (
                uid, filename, project_name, period, scheduled_date, keyword1, keyword2,
                landing_page, cluster, kw_category, activity_name, word_count,
                content_spoc, topic, content_doc, status, publisher,
                pg_site_domain, live_link, remarks, solution, verified, last_activity, updated_date,
                fetched_data
            ) VALUES {','.join(values_sql_parts)}
        """
        conn.execute(text(sql), params)


def list_monthly_imports():
    with engine.begin() as conn:
        all_rows = conn.execute(text("""
            SELECT id, uid, filename, project_name, period, scheduled_date as "scheduledDate",
                   keyword1, keyword2, landing_page as "landingPage", cluster,
                   kw_category as "kwCategory", activity_name as "activityName",
                   word_count as "wordCount", content_spoc as "contentSpoc",
                   topic, content_doc as "contentDoc", status, publisher,
                   pg_site_domain as "pgSiteDomain", live_link as "liveLink",
                   remarks, solution, verified, last_activity as "lastActivity",
                   updated_date as "updatedDate", fetched_data as "fetchedData",
                   fetched_data, created_at
            FROM monthly_operations
            ORDER BY id ASC
        """)).mappings().fetchall()

        grouped = {}
        for r in all_rows:
            p_name = r["project_name"] or "Default"
            key = p_name.lower().strip() if isinstance(p_name, str) else p_name
            if key not in grouped:
                grouped[key] = {
                    "id": r["id"],
                    "filename": r["filename"] or f"{p_name}_dataset.csv",
                    "project": p_name,
                    "project_name": p_name,
                    "rows": 0,
                    "date": r["created_at"].strftime("%m/%d/%Y %I:%M %p") if r.get("created_at") else "",
                    "status": "Success",
                    "rowsData": []
                }
            grouped[key]["rowsData"].append(dict(r))
            grouped[key]["rows"] += 1

        result = list(grouped.values())
        return _clean_for_json(result)


def save_monthly_import(filename, project_name, rows, date, rows_data):
    with engine.begin() as conn:
        _insert_monthly_operation_rows(conn, filename, project_name, rows_data)
        res = conn.execute(text("SELECT MAX(id) FROM monthly_operations WHERE project_name = :p"), {"p": project_name}).fetchone()
        return res[0] if res else 1


def update_monthly_import(import_id, rows_data=None, filename=None, rows=None, date=None, project_name=None):
    with engine.begin() as conn:
        p_name = project_name
        f_name = filename
        if import_id:
            target = conn.execute(text("SELECT project_name, filename FROM monthly_operations WHERE id = :id LIMIT 1"), {"id": import_id}).fetchone()
            if target:
                if not p_name:
                    p_name = target[0]
                if not f_name:
                    f_name = target[1]

        if not p_name and isinstance(import_id, str):
            p_name = import_id

        if not p_name and rows_data:
            for r in rows_data:
                if r.get("id"):
                    row_target = conn.execute(text("SELECT project_name, filename FROM monthly_operations WHERE id = :id LIMIT 1"), {"id": r.get("id")}).fetchone()
                    if row_target:
                        p_name = row_target[0]
                        if not f_name:
                            f_name = row_target[1]
                        break

        if rows_data is not None:
            if not p_name:
                first_db = conn.execute(text("SELECT project_name, filename FROM monthly_operations LIMIT 1")).fetchone()
                if first_db:
                    p_name = first_db[0]
                    if not f_name:
                        f_name = first_db[1]
                else:
                    p_name = "Default Project"
                    f_name = "dataset.csv"

            # 1. Fetch existing database IDs for this project
            existing_rows = conn.execute(
                text("SELECT id FROM monthly_operations WHERE LOWER(TRIM(project_name)) = LOWER(TRIM(:p))"),
                {"p": p_name}
            ).fetchall()
            existing_ids = {r[0] for r in existing_rows}

            input_ids = set()
            update_param_list = []
            new_rows_list = []

            for r in rows_data:
                r_id = r.get("id")
                r_uid = _generate_uid(r.get("uid"))
                is_ver = r.get("verified")
                verified_bool = (is_ver is True) or (isinstance(is_ver, str) and is_ver.lower() == "true")
                f_data = r.get("fetched_data", r.get("fetchedData"))
                if isinstance(f_data, (dict, list)):
                    f_data_str = json.dumps(f_data)
                elif isinstance(f_data, str) and f_data.strip():
                    f_data_str = f_data
                else:
                    f_data_str = None

                if r_id and isinstance(r_id, int) and r_id in existing_ids:
                    input_ids.add(r_id)
                    update_param_list.append({
                        "id": r_id,
                        "uid": r_uid,
                        "filename": f_name,
                        "project_name": p_name,
                        "period": r.get("period", ""),
                        "scheduled_date": r.get("scheduledDate", r.get("scheduled_date", "")),
                        "keyword1": r.get("keyword1", ""),
                        "keyword2": r.get("keyword2", ""),
                        "landing_page": r.get("landingPage", r.get("landing_page", "")),
                        "cluster": r.get("cluster", ""),
                        "kw_category": r.get("kwCategory", r.get("kw_category", "")),
                        "activity_name": r.get("activityName", r.get("activity_name", "")),
                        "word_count": str(r.get("wordCount", r.get("word_count", ""))),
                        "content_spoc": r.get("contentSpoc", r.get("content_spoc", "")),
                        "topic": r.get("topic", ""),
                        "content_doc": r.get("contentDoc", r.get("content_doc", "")),
                        "status": r.get("status", ""),
                        "publisher": r.get("publisher", ""),
                        "pg_site_domain": r.get("pgSiteDomain", r.get("pg_site_domain", "")),
                        "live_link": r.get("liveLink", r.get("live_link", "")),
                        "remarks": r.get("remarks", ""),
                        "solution": r.get("solution", ""),
                        "verified": verified_bool,
                        "last_activity": r.get("lastActivity", r.get("last_activity", "")),
                        "updated_date": r.get("updatedDate", r.get("updated_date", "")),
                        "fetched_data": f_data_str
                    })
                else:
                    new_rows_list.append(r)

            # Batch UPDATE existing rows using single multi-row VALUES query
            if update_param_list:
                chunk_size = 200
                for i in range(0, len(update_param_list), chunk_size):
                    chunk = update_param_list[i:i + chunk_size]
                    params = {}
                    values_parts = []
                    for idx, u in enumerate(chunk):
                        p = f"_{idx}"
                        params.update({
                            f"id{p}": u["id"],
                            f"uid{p}": u["uid"],
                            f"filename{p}": u["filename"],
                            f"project_name{p}": u["project_name"],
                            f"period{p}": u["period"],
                            f"scheduled_date{p}": u["scheduled_date"],
                            f"keyword1{p}": u["keyword1"],
                            f"keyword2{p}": u["keyword2"],
                            f"landing_page{p}": u["landing_page"],
                            f"cluster{p}": u["cluster"],
                            f"kw_category{p}": u["kw_category"],
                            f"activity_name{p}": u["activity_name"],
                            f"word_count{p}": u["word_count"],
                            f"content_spoc{p}": u["content_spoc"],
                            f"topic{p}": u["topic"],
                            f"content_doc{p}": u["content_doc"],
                            f"status{p}": u["status"],
                            f"publisher{p}": u["publisher"],
                            f"pg_site_domain{p}": u["pg_site_domain"],
                            f"live_link{p}": u["live_link"],
                            f"remarks{p}": u["remarks"],
                            f"solution{p}": u["solution"],
                            f"verified{p}": u["verified"],
                            f"last_activity{p}": u["last_activity"],
                            f"updated_date{p}": u["updated_date"],
                            f"fetched_data{p}": u["fetched_data"]
                        })
                        values_parts.append(f"""(
                            CAST(:id{p} AS bigint), :uid{p}, :filename{p}, :project_name{p}, :period{p}, :scheduled_date{p},
                            :keyword1{p}, :keyword2{p}, :landing_page{p}, :cluster{p}, :kw_category{p}, :activity_name{p},
                            :word_count{p}, :content_spoc{p}, :topic{p}, :content_doc{p}, :status{p}, :publisher{p},
                            :pg_site_domain{p}, :live_link{p}, :remarks{p}, :solution{p}, CAST(:verified{p} AS boolean), :last_activity{p}, :updated_date{p},
                            CAST(:fetched_data{p} AS jsonb)
                        )""")

                    sql = f"""
                        UPDATE monthly_operations AS m SET
                            uid = COALESCE(v.uid, m.uid),
                            filename = COALESCE(v.filename, m.filename),
                            project_name = COALESCE(v.project_name, m.project_name),
                            period = v.period,
                            scheduled_date = v.scheduled_date,
                            keyword1 = v.keyword1,
                            keyword2 = v.keyword2,
                            landing_page = v.landing_page,
                            cluster = v.cluster,
                            kw_category = v.kw_category,
                            activity_name = v.activity_name,
                            word_count = v.word_count,
                            content_spoc = v.content_spoc,
                            topic = v.topic,
                            content_doc = v.content_doc,
                            status = v.status,
                            publisher = v.publisher,
                            pg_site_domain = v.pg_site_domain,
                            live_link = v.live_link,
                            remarks = v.remarks,
                            solution = v.solution,
                            verified = v.verified,
                            last_activity = v.last_activity,
                            updated_date = v.updated_date,
                            fetched_data = COALESCE(v.fetched_data, m.fetched_data),
                            updated_at = now()
                        FROM (VALUES {','.join(values_parts)}) AS v(
                            id, uid, filename, project_name, period, scheduled_date,
                            keyword1, keyword2, landing_page, cluster, kw_category, activity_name,
                            word_count, content_spoc, topic, content_doc, status, publisher,
                            pg_site_domain, live_link, remarks, solution, verified, last_activity, updated_date,
                            fetched_data
                        )
                        WHERE m.id = v.id
                    """
                    conn.execute(text(sql), params)

            # Batch INSERT new rows
            if new_rows_list:
                _insert_monthly_operation_rows(conn, f_name, p_name, new_rows_list)

            # 2. Safely delete ONLY rows explicitly deleted from frontend
            to_delete = existing_ids - input_ids
            if to_delete:
                for del_id in to_delete:
                    conn.execute(text("DELETE FROM monthly_operations WHERE id = :id"), {"id": del_id})


def delete_monthly_import(import_id):
    with engine.begin() as conn:
        target = conn.execute(text("SELECT project_name FROM monthly_operations WHERE id = :id"), {"id": import_id}).fetchone()
        if target:
            conn.execute(text("DELETE FROM monthly_operations WHERE project_name = :p"), {"p": target[0]})
        else:
            conn.execute(text("DELETE FROM monthly_operations WHERE id = :id"), {"id": import_id})


def list_scheduled_activities():
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM scheduled_activities ORDER BY created_at DESC")).mappings().fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["project"] = d.get("project_name")
            result.append(d)
        return _clean_for_json(result)


def save_scheduled_activity(action, project_name, datetime, frequency='One-Time', status='Scheduled'):
    with engine.begin() as conn:
        res = conn.execute(text("""
            INSERT INTO scheduled_activities (action, project_name, datetime, frequency, status)
            VALUES (:action, :project_name, :datetime, :frequency, :status)
            RETURNING id
        """), {
            "action": action, "project_name": project_name,
            "datetime": datetime, "frequency": frequency, "status": status
        })
        row = res.fetchone()
        return row[0] if row else None


def update_scheduled_activity_status(schedule_id, status):
    with engine.begin() as conn:
        conn.execute(text("UPDATE scheduled_activities SET status = :status WHERE id = :id"), {"id": schedule_id, "status": status})


def delete_scheduled_activity(schedule_id):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM scheduled_activities WHERE id = :id"), {"id": schedule_id})


def list_users() -> list:
    """List all registered users from Supabase users table or Postgres database."""
    if supabase:
        try:
            res = supabase.from_("users").select("*").execute()
            if res.data:
                return _clean_for_json(res.data)
        except Exception as e:
            print(f"[db] Notice in list_users Supabase fetch: {e}")
    with engine.begin() as conn:
        try:
            res = conn.execute(text("SELECT * FROM users ORDER BY created_at DESC"))
            rows = [dict(r._mapping) for r in res]
            return _clean_for_json(rows)
        except Exception:
            return []




def list_off_page_activities(project_name=None) -> list:
    with engine.begin() as conn:
        try:
            if project_name:
                res = conn.execute(
                    text("SELECT * FROM off_page_activities WHERE project_name = :p ORDER BY created_at DESC"),
                    {"p": project_name}
                )
            else:
                res = conn.execute(text("SELECT * FROM off_page_activities ORDER BY created_at DESC"))
            rows = [dict(r._mapping) for r in res]
            return _clean_for_json(rows)
        except Exception as e:
            print(f"[db] Notice in list_off_page_activities: {e}")
            return []


def create_off_page_activity(data: dict) -> dict:
    activity_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO off_page_activities (
                    id, activity_name, project_name, main_poc, content_poc,
                    quantity, budget, "user", period, scheduler, auditor
                ) VALUES (
                    :id, :activity_name, :project_name, :main_poc, :content_poc,
                    :quantity, :budget, :user, :period, :scheduler, :auditor
                )
            """),
            {
                "id": activity_id,
                "activity_name": data.get("activity_name", ""),
                "project_name": data.get("project_name"),
                "main_poc": data.get("main_poc"),
                "content_poc": data.get("content_poc"),
                "quantity": int(data.get("quantity") or 0),
                "budget": float(data.get("budget") or 0.0),
                "user": data.get("user"),
                "period": data.get("period"),
                "scheduler": data.get("scheduler"),
                "auditor": data.get("auditor")
            }
        )
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        return _clean_for_json(dict(res._mapping)) if res else {}


def get_off_page_activity(activity_id: str):
    with engine.begin() as conn:
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        return _clean_for_json(dict(res._mapping)) if res else None


def update_off_page_activity(activity_id: str, data: dict):
    allowed = ["activity_name", "project_name", "main_poc", "content_poc", "quantity", "budget", "user", "period", "scheduler", "auditor"]
    updates = []
    params = {"id": activity_id}

    for field in allowed:
        if field in data and data[field] is not None:
            if field == "user":
                updates.append('"user" = :user')
            else:
                updates.append(f"{field} = :{field}")
            params[field] = data[field]

    if not updates:
        return get_off_page_activity(activity_id)

    updates.append("updated_at = now()")
    query = f"UPDATE off_page_activities SET {', '.join(updates)} WHERE id = :id"

    with engine.begin() as conn:
        conn.execute(text(query), params)
        res = conn.execute(text("SELECT * FROM off_page_activities WHERE id = :id"), {"id": activity_id}).first()
        return _clean_for_json(dict(res._mapping)) if res else None


def delete_off_page_activity(activity_id: str) -> bool:
    with engine.begin() as conn:
        res = conn.execute(text("DELETE FROM off_page_activities WHERE id = :id"), {"id": activity_id})
        return res.rowcount > 0



def bulk_insert_off_page_activities(records: list) -> list:
    with engine.begin() as conn:
        for rec in records:
            activity_id = str(uuid.uuid4())
            conn.execute(
                text("""
                    INSERT INTO off_page_activities (
                        id, activity_name, project_name, main_poc, content_poc,
                        quantity, budget, "user", period, scheduler, auditor
                    ) VALUES (
                        :id, :activity_name, :project_name, :main_poc, :content_poc,
                        :quantity, :budget, :user, :period, :scheduler, :auditor
                    )
                """),
                {
                    "id": activity_id,
                    "activity_name": str(rec.get("activity_name") or rec.get("Activity Name") or "Untitled Activity"),
                    "project_name": rec.get("project_name") or rec.get("Project Name"),
                    "main_poc": rec.get("main_poc") or rec.get("Main POC"),
                    "content_poc": rec.get("content_poc") or rec.get("Content POC"),
                    "quantity": int(rec.get("quantity") or rec.get("Quantity") or 0),
                    "budget": float(rec.get("budget") or rec.get("Budget") or 0.0),
                    "user": rec.get("user") or rec.get("User"),
                    "period": rec.get("period") or rec.get("Period"),
                    "scheduler": rec.get("scheduler") or rec.get("Scheduler"),
                    "auditor": rec.get("auditor") or rec.get("Auditor")
                }
            )
    return list_off_page_activities()

if __name__ == "__main__":
    # Create/update the shared tables (run from the `backend/` directory):
    #   python -m core.db
    #
    # One-time migration from the old per-project physical tables:
    #   python -m core.db migrate-to-shared
    if len(sys.argv) >= 2 and sys.argv[1] == "migrate-to-shared":
        init_db()
        migrate_per_project_tables_to_shared()
    else:
        init_db()
        print("Tables created (or already existed).")


def get_ai_analysis_history(project_slug: str, engine_name: str = None, limit: int = 50):
    """Retrieve historical AI Analysis runs for a project from Supabase PostgreSQL database."""
    with engine.begin() as conn:
        slug_like = f"%{project_slug}%"
        if engine_name and engine_name.strip():
            res = conn.execute(text("""
                SELECT id, project_slug, project_name, domain, country, engine,
                       ai_visibility, mentions, cited_pages, total_keywords,
                       mentioned_keywords, cited_pages_list, created_at
                FROM ai_analysis
                WHERE (project_slug = :slug OR project_name ILIKE :slug_like)
                  AND LOWER(engine) LIKE :eng_like
                ORDER BY created_at DESC
                LIMIT :limit
            """), {
                "slug": project_slug,
                "slug_like": slug_like,
                "eng_like": f"%{engine_name.lower().strip()}%",
                "limit": limit
            }).fetchall()
        else:
            res = conn.execute(text("""
                SELECT id, project_slug, project_name, domain, country, engine,
                       ai_visibility, mentions, cited_pages, total_keywords,
                       mentioned_keywords, cited_pages_list, created_at
                FROM ai_analysis
                WHERE project_slug = :slug OR project_name ILIKE :slug_like
                ORDER BY created_at DESC
                LIMIT :limit
            """), {
                "slug": project_slug,
                "slug_like": slug_like,
                "limit": limit
            }).fetchall()

        history = []
        for r in res:
            m_kws = r.mentioned_keywords if isinstance(r.mentioned_keywords, list) else (json.loads(r.mentioned_keywords) if r.mentioned_keywords else [])
            c_list = r.cited_pages_list if isinstance(r.cited_pages_list, list) else (json.loads(r.cited_pages_list) if r.cited_pages_list else [])
            history.append({
                "id": r.id,
                "project_slug": r.project_slug,
                "project_name": r.project_name,
                "domain": r.domain,
                "country": r.country,
                "engine": r.engine,
                "ai_visibility": r.ai_visibility,
                "mentions": r.mentions,
                "cited_pages": r.cited_pages,
                "total_keywords": r.total_keywords,
                "mentioned_keywords": m_kws,
                "cited_pages_list": c_list,
                "created_at": r.created_at.isoformat() if hasattr(r.created_at, 'isoformat') else str(r.created_at)
            })
        return history
