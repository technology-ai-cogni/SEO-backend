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
    raise RuntimeError(
        "DATABASE_URL is not set. Copy .env.example to .env and fill in your "
        "Supabase connection string."
    )

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


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
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_keyword_categories_job ON keyword_categories (job_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_keyword_categories_project ON keyword_categories (project_name)"))


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
                           computed_target_type=None, computed_region_name=None):
    """Called by the background worker after processing ONE keyword row
    (identified by the id returned from insert_keyword_rows at upload
    time). `row_id` is globally unique (shared table), so no project
    filter is needed in the WHERE clause -- `domain` is accepted for
    signature consistency with the rest of this module but unused here.

    Updates category/cluster/status/meta/error, PLUS:
    - target_type: ALWAYS overwritten with computed_target_type.
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
                target_type = :computed_target_type,
                target_geo = COALESCE(NULLIF(target_geo, ''), :computed_region_name)
            WHERE id = :id
        """), {
            "id": row_id, "category": category, "cluster": cluster, "status": status,
            "meta": json.dumps(meta) if meta is not None else None, "error": error,
            "computed_target_type": computed_target_type, "computed_region_name": computed_region_name,
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
    -- this is what your UI's per-project 'project table' view reads from."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT keyword, category, cluster, status, error, meta, checked_at, job_id,
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
