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
import json
import uuid
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("[Warning] DATABASE_URL is not set in environment. Database features will require DATABASE_URL.")
    DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(DATABASE_URL)


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
    repeatedly."""
    if not os.environ.get("DATABASE_URL"):
        print("[Warning] Skipping DB init: DATABASE_URL is not set.")
        return
    with engine.begin() as conn:
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
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS clustering_triggered_at TIMESTAMPTZ"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country_name TEXT"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country_code TEXT"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS project_name TEXT"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_jobs_domain ON jobs (domain)"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS projects (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))

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
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
        conn.execute(text("ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS rank INTEGER"))
        conn.execute(text("ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS rank_checked_at TIMESTAMPTZ"))
        conn.execute(text("ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS rank_meta JSONB"))
        # Informational/Commercial classification from scripts/intent_classifier.py,
        # written by scripts/run_pipeline.py. target_type (Landing/Blog Page,
        # from scripts/landing_blog_classifier.py) already has a column above.
        conn.execute(text("ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS subtype TEXT"))
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
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_competitors_project ON competitors (project_slug)"))

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
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_competitor ON competitor_snapshots (competitor_id, created_at DESC)"))
        # {keyword: position} this competitor ranked at in this run -- lets
        # the detail view show which specific keywords it's ranking on, not
        # just the aggregate ranking_keywords count.
        conn.execute(text("ALTER TABLE competitor_snapshots ADD COLUMN IF NOT EXISTS keyword_positions JSONB"))


# --- Projects -------------------------------------------------------------

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
        row = conn.execute(text("SELECT slug FROM projects WHERE name = :name"), {"name": name}).fetchone()
        if row:
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


def get_project_by_name(name):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM projects WHERE name = :name"), {"name": name}).mappings().fetchone()
        return dict(row) if row else None


def get_project_by_slug(slug):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM projects WHERE slug = :slug"), {"slug": slug}).mappings().fetchone()
        return dict(row) if row else None


def list_projects():
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM projects ORDER BY created_at DESC")).mappings().fetchall()
        return [dict(r) for r in rows]


def delete_project(slug):
    """Removes a project and everything scoped to it in one transaction --
    domains, keyword_categories, categories, clusters,
    category_cluster_map, and pages all carry a FK on projects.slug, so
    they have to go before the projects row itself or the DB rejects the
    delete.

    Runs over the same direct Postgres connection as the rest of this
    module, which is why this lives here rather than in the frontend --
    the frontend's Supabase client is subject to RLS policies that only
    permit it to touch domains/projects/keyword_categories, not the
    categories/clusters/category_cluster_map/pages tables."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM keyword_categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM domains WHERE project_slug = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM clusters WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM category_cluster_map WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM pages WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})


def delete_project_kw_data(slug):
    """Removes just this project's KW Cluster data (keyword_categories,
    categories, clusters, category_cluster_map) -- leaves the project
    itself, its domain registration, and its pages untouched, so it still
    shows up on the Domain and Pages tabs afterward. This is what the KW
    Cluster tab's delete button calls -- unlike delete_project() above,
    which removes the project everywhere."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM keyword_categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM categories WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM clusters WHERE project_name = :slug"), {"slug": slug})
        conn.execute(text("DELETE FROM category_cluster_map WHERE project_name = :slug"), {"slug": slug})


def delete_project_pages(slug):
    """Removes just this project's page rows (Add Pages uploads) -- leaves
    the project, its domain registration, and its KW Cluster data
    untouched, so it still shows up on the Domain and KW Cluster tabs
    afterward. This is what the Pages tab's delete button calls."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM pages WHERE project_name = :slug"), {"slug": slug})


# --- Domains (the "Create Project" form) --------------------------------

def create_domain(domain, project_name=None, target_regions=None, platforms=None,
                   domain_authority=None, users=None):
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

    with engine.begin() as conn:
        existing = conn.execute(text("SELECT 1 FROM domains WHERE domain = :domain"), {"domain": domain}).fetchone()
        if existing:
            raise ValueError(f"Domain '{domain}' already exists.")

        conn.execute(text("""
            INSERT INTO domains (domain, project_name, project_slug, target_regions, platforms, domain_authority, users)
            VALUES (:domain, :project_name, :project_slug, :target_regions, :platforms, :domain_authority, CAST(:users AS JSONB))
        """), {
            "domain": domain, "project_name": project_name, "project_slug": project_slug,
            "target_regions": target_regions or [], "platforms": platforms or [],
            "domain_authority": domain_authority,
            "users": json.dumps(users) if users is not None else None,
        })

    return project_slug


def get_domain_record(domain):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM domains WHERE domain = :domain"), {"domain": domain}).mappings().fetchone()
        return dict(row) if row else None


def list_domain_records():
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT * FROM domains ORDER BY created_at DESC")).mappings().fetchall()
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
            SELECT name FROM categories WHERE project_name = :project_name ORDER BY id
        """), {"project_name": domain}).fetchall()
        return [r.name for r in rows]


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
                params[f"kw_diff{i}"] = r.get("kw_diff")
                params[f"type{i}"] = r.get("type")
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
    """{project_slug: page_count} for every project that currently has at
    least one page row -- lets the Pages tab know upfront (without
    fetching each project's full page list) which projects to list, so a
    project whose pages were all deleted stops showing up there without
    needing a per-row 'hidden' flag anywhere."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT project_name, COUNT(*) AS count FROM pages GROUP BY project_name
        """)).mappings().fetchall()
        return {r["project_name"]: r["count"] for r in rows}


def get_pages_stats():
    """Per-project {total, commercial, blog} counts computed from the pages
    table's own target_type/target_category columns (set via the Pages
    detail view's dropdowns or Bulk Edit) -- lets the Pages tab list show
    Commercial vs Others / Blog Pages sourced from actual page rows instead
    of KW Cluster's keyword counts."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT project_name,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE target_type = 'Commercial') AS commercial,
                   COUNT(*) FILTER (WHERE target_category = 'Blogs') AS blog
            FROM pages GROUP BY project_name
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
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM pages WHERE id = :id"), {"id": row_id})


def bulk_delete_page_rows(ids):
    if not ids:
        return
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM pages WHERE id = ANY(:ids)"), {"ids": ids})


# --- Competitors (each scoped to a project via project_slug) --------------

_COMPETITOR_UPDATABLE_COLUMNS = {"name", "domain", "da", "target_regions", "project_slug"}


def insert_competitor(domain, name=None, da=None, target_regions=None, project_slug=None):
    """The analytics columns (common_kw/total_kw/ai_comp_level/
    serp_comp_level/comp_level and their *_change counterparts) have no
    real computation pipeline behind them yet -- they start at 0, same as
    a freshly-added KW Cluster/Pages project shows 0 until real data
    exists, rather than fabricating numbers."""
    with engine.begin() as conn:
        row = conn.execute(text("""
            INSERT INTO competitors
                (domain, name, da, target_regions, project_slug, common_kw, common_kw_change,
                 total_kw, total_kw_change, ai_comp_level, ai_comp_change, serp_comp_level, comp_level)
            VALUES (:domain, :name, :da, :target_regions, :project_slug, 0, 0, 0, 0, 0, 0, 0, 0)
            RETURNING *
        """), {"domain": domain, "name": name, "da": da, "target_regions": target_regions or [], "project_slug": project_slug}).mappings().fetchone()
        return dict(row)


def get_competitors(project_slug=None):
    with engine.begin() as conn:
        if project_slug:
            rows = conn.execute(
                text("SELECT * FROM competitors WHERE project_slug = :project_slug ORDER BY created_at DESC"),
                {"project_slug": project_slug},
            ).mappings().fetchall()
        else:
            rows = conn.execute(text("SELECT * FROM competitors ORDER BY created_at DESC")).mappings().fetchall()
        return [dict(r) for r in rows]


def update_competitor(competitor_id, updates):
    """Updates whichever of name/domain/da/target_regions/project_slug are
    present in `updates` (snake_case keys) -- silently ignores anything
    else (the analytics columns aren't user-editable)."""
    fields = {k: v for k, v in updates.items() if k in _COMPETITOR_UPDATABLE_COLUMNS}
    if not fields:
        return
    set_sql = ", ".join(f"{k} = :{k}" for k in fields) + ", updated_at = now()"
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE competitors SET {set_sql} WHERE id = :id"), {**fields, "id": competitor_id})


def delete_competitor(competitor_id):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM competitors WHERE id = :id"), {"id": competitor_id})


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
