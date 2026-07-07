"""
Database layer, backed by Postgres (Supabase).

PROJECTS: each project gets its OWN dedicated set of physical tables --
this is a real, hard isolation boundary, not just a WHERE-filtered shared
table. A project is created (tables and all) the first time you call
get_or_create_project(name) with a new name -- typically from the
/jobs/category upload endpoint when someone types a project name.

Per project <slug>, four tables are created:
    categories_<slug>            -- distinct category names for this project
    clusters_<slug>                -- distinct cluster names for this project
    category_cluster_map_<slug>     -- deterministic category->cluster cache
    keyword_categories_<slug>        -- one row per keyword processed EVER

<slug> is derived from the user-typed project name by _slugify_project_name
(lowercased, non [a-z0-9_] characters replaced, length-capped) and is
re-validated by _assert_safe_identifier immediately before it's ever
spliced into a SQL string -- table/column names can't be parameterized
the way values can, so this whitelist-and-recheck approach is what keeps
project names from becoming a SQL-injection vector.

Two tables remain SHARED across all projects (not per-project):
    jobs      -- one row per import batch; has a `domain` column holding
                 the owning project's SLUG, and a `project_name` column
                 holding the human-typed display name -- so job listing/
                 history works with one query across every project.
    projects  -- the name -> slug registry itself.

Legacy note: tables named exactly `categories`, `clusters`,
`category_cluster_map`, `keyword_categories` (no suffix) are the OLD
shared, domain-filtered tables from before per-project tables existed.
They are left in place (nothing drops them) so no historical data is
lost, but new code never reads/writes them directly -- see
migrate_legacy_domain_to_project() below for a one-time copy into a
project's new dedicated tables.

Setup:
    1. Create a free project at https://supabase.com
    2. Project Settings -> Database -> Connection string (URI format,
       "Transaction" pooler mode is fine for this use case)
    3. Put it in your .env as DATABASE_URL (see .env.example)
    4. Run `python db.py` once to create the shared tables
    5. (one-time, only if you have pre-existing data under the old
       shared tables) run:
           python db.py migrate default "My Project Display Name"
       to copy domain='default' rows into that project's own new tables.
"""

import os
import re
import json
import sys
import uuid

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


# --- Project name -> safe SQL identifier ---------------------------------
# Postgres identifiers are capped at 63 bytes. Our longest table prefix is
# "category_cluster_map_" (21 chars), so we cap the slug itself well under
# (63 - 21) to leave comfortable headroom for every prefix we use.
MAX_SLUG_LENGTH = 40
_SLUG_SAFE_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _slugify_project_name(name):
    """Turn an arbitrary user-typed project name into a safe, lowercase
    snake_case SQL identifier fragment: only [a-z0-9_], never starting
    with a digit, length-capped. Raises ValueError if nothing usable is
    left after sanitizing (e.g. a name that's only punctuation)."""
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    slug = re.sub(r"_+", "_", slug).strip("_")

    if not slug:
        raise ValueError("Project name must contain at least one letter or number.")

    if slug[0].isdigit():
        slug = f"p_{slug}"

    slug = slug[:MAX_SLUG_LENGTH].rstrip("_")

    if not slug:
        raise ValueError("Project name produced an empty table identifier after sanitizing.")

    return slug


def _assert_safe_identifier(identifier):
    """Defense in depth: re-validate right before an identifier is
    spliced into any SQL string, even though _slugify_project_name should
    already guarantee this. Never skip this check -- it's the only thing
    standing between a project slug and a SQL-injection bug, since table
    names can't go through parameterized query placeholders."""
    if not identifier or not _SLUG_SAFE_RE.match(identifier):
        raise ValueError(f"Unsafe table identifier rejected: {identifier!r}")
    return identifier


def _project_table_names(project_slug):
    """The 4 per-project table names for this slug. Re-validates the slug
    every time it's called -- this is the single choke point every
    dynamic-SQL function below goes through before building a query."""
    slug = _assert_safe_identifier(project_slug)
    return {
        "categories": f"categories_{slug}",
        "clusters": f"clusters_{slug}",
        "category_cluster_map": f"category_cluster_map_{slug}",
        "keyword_categories": f"keyword_categories_{slug}",
    }


def _create_project_tables(conn, project_slug):
    """Create this project's 4 dedicated tables if they don't exist yet.
    Called inside the same transaction as the `projects` registry insert,
    so a project row never exists without its tables (or vice versa)."""
    t = _project_table_names(project_slug)

    conn.execute(text(f"""
        CREATE TABLE IF NOT EXISTS {t['categories']} (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))

    conn.execute(text(f"""
        CREATE TABLE IF NOT EXISTS {t['clusters']} (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))

    conn.execute(text(f"""
        CREATE TABLE IF NOT EXISTS {t['category_cluster_map']} (
            category TEXT PRIMARY KEY,
            cluster TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))

    conn.execute(text(f"""
        CREATE TABLE IF NOT EXISTS {t['keyword_categories']} (
            id BIGSERIAL PRIMARY KEY,
            job_id UUID REFERENCES jobs(id),
            keyword TEXT NOT NULL,
            category TEXT,
            cluster TEXT,
            status TEXT,
            error TEXT,
            meta JSONB,
            checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    # Short, fixed-prefix index name (NOT just "idx_" + full table name) --
    # keeps us safely under Postgres's 63-char identifier limit even at
    # MAX_SLUG_LENGTH, instead of relying on silent truncation.
    conn.execute(text(f"""
        CREATE INDEX IF NOT EXISTS idx_kc_{project_slug}_job
        ON {t['keyword_categories']} (job_id)
    """))


def init_db():
    """Create the SHARED tables (jobs, projects) if they don't exist yet,
    plus the LEGACY shared category/cluster tables (kept only so old data
    isn't lost -- new code doesn't write to them). Safe to run repeatedly.
    Per-project tables are created lazily by get_or_create_project()."""
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
        # `domain` now holds the owning project's SLUG (kept under its
        # original column name to avoid an in-place rename); this new
        # column holds the human-typed display name for that same project.
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

        # --- LEGACY shared tables (pre-per-project). Left in place only
        # so existing historical rows are never lost. New code does not
        # read or write these -- see migrate_legacy_domain_to_project().
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS categories (
                id BIGSERIAL PRIMARY KEY,
                domain TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (domain, name)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS clusters (
                id BIGSERIAL PRIMARY KEY,
                domain TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (domain, name)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS category_cluster_map (
                domain TEXT NOT NULL,
                category TEXT NOT NULL,
                cluster TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (domain, category)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS keyword_categories (
                id BIGSERIAL PRIMARY KEY,
                job_id UUID REFERENCES jobs(id),
                domain TEXT NOT NULL DEFAULT '',
                keyword TEXT NOT NULL,
                category TEXT,
                cluster TEXT,
                status TEXT,
                error TEXT,
                meta JSONB,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS meta JSONB"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_keyword_categories_job ON keyword_categories (job_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_keyword_categories_domain ON keyword_categories (domain)"))


# --- Projects -------------------------------------------------------------

def get_or_create_project(name):
    """Look up a project by its display name, creating it (and its 4
    dedicated tables) on first use, all in one transaction. Returns the
    project's table-safe slug.

    If the sanitized slug would collide with a DIFFERENT existing
    project's slug (e.g. "Real Estate!" and "Real Estate?" both wanting
    to become "real_estate"), a numeric suffix is appended until it's
    unique -- the display names stay distinct in the `projects` table
    even though their slugs had to diverge."""
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
        _create_project_tables(conn, slug)

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


# --- Jobs (shared across all projects) --------------------------------

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
    have at least one job. Prefer list_projects() for new code (it also
    gives you the human-readable display name, not just the slug)."""
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


# --- Categories (per-project table) ------------------------------------
# NOTE: the parameter is named `domain` in a few places below purely to
# keep category_checker.py / category_tasks.py working UNCHANGED (they
# already just pass this value straight through) -- semantically it is
# now a PROJECT SLUG, not a shared-table filter value.

def list_category_names(domain):
    t = _project_table_names(domain)
    with engine.begin() as conn:
        rows = conn.execute(text(f"SELECT name FROM {t['categories']} ORDER BY id")).fetchall()
        return [r.name for r in rows]


def add_category(domain, name):
    t = _project_table_names(domain)
    with engine.begin() as conn:
        conn.execute(text(f"""
            INSERT INTO {t['categories']} (name) VALUES (:name)
            ON CONFLICT (name) DO NOTHING
        """), {"name": name})


# --- Clusters (per-project table) --------------------------------------
# IMPORTANT: run only ONE category worker at a time -- category AND
# cluster assignment are both inherently sequential within a project.

def list_cluster_names(domain):
    t = _project_table_names(domain)
    with engine.begin() as conn:
        rows = conn.execute(text(f"SELECT name FROM {t['clusters']} ORDER BY id")).fetchall()
        return [r.name for r in rows]


def add_cluster(domain, name):
    t = _project_table_names(domain)
    with engine.begin() as conn:
        conn.execute(text(f"""
            INSERT INTO {t['clusters']} (name) VALUES (:name)
            ON CONFLICT (name) DO NOTHING
        """), {"name": name})


def get_cluster_for_category(domain, category_name):
    """Deterministic cache lookup: has this EXACT category already been
    assigned a cluster in this project before?"""
    t = _project_table_names(domain)
    with engine.begin() as conn:
        row = conn.execute(text(f"""
            SELECT cluster FROM {t['category_cluster_map']} WHERE category = :category
        """), {"category": category_name}).fetchone()
        return row.cluster if row else None


def set_cluster_for_category(domain, category_name, cluster_name):
    t = _project_table_names(domain)
    with engine.begin() as conn:
        conn.execute(text(f"""
            INSERT INTO {t['category_cluster_map']} (category, cluster, updated_at)
            VALUES (:category, :cluster, now())
            ON CONFLICT (category) DO UPDATE SET cluster = :cluster, updated_at = now()
        """), {"category": category_name, "cluster": cluster_name})


def replace_domain_clusters(domain, category_to_cluster):
    """Overwrite this project's ENTIRE cluster assignment in one pass --
    used by the post-categorization clustering step, which re-clusters
    the whole project's category list from scratch every time it runs
    (new categories can shift which word is now the 'most common', so a
    full recompute keeps clustering consistent rather than just patching
    in new categories against stale groupings)."""
    t = _project_table_names(domain)
    with engine.begin() as conn:
        conn.execute(text(f"DELETE FROM {t['clusters']}"))
        for cluster_name in sorted(set(category_to_cluster.values())):
            conn.execute(text(f"""
                INSERT INTO {t['clusters']} (name) VALUES (:name)
                ON CONFLICT (name) DO NOTHING
            """), {"name": cluster_name})

        conn.execute(text(f"DELETE FROM {t['category_cluster_map']}"))
        for category_name, cluster_name in category_to_cluster.items():
            conn.execute(text(f"""
                INSERT INTO {t['category_cluster_map']} (category, cluster, updated_at)
                VALUES (:category, :cluster, now())
            """), {"category": category_name, "cluster": cluster_name})

            conn.execute(text(f"""
                UPDATE {t['keyword_categories']} SET cluster = :cluster
                WHERE category = :category
            """), {"category": category_name, "cluster": cluster_name})


# --- Keyword results (per-project table) --------------------------------

def insert_category_result(job_id, domain, keyword, category, cluster, status, meta=None, error=None):
    t = _project_table_names(domain)
    with engine.begin() as conn:
        conn.execute(text(f"""
            INSERT INTO {t['keyword_categories']} (job_id, keyword, category, cluster, status, meta, error)
            VALUES (:job_id, :keyword, :category, :cluster, :status, CAST(:meta AS JSONB), :error)
        """), {
            "job_id": job_id, "keyword": keyword, "category": category,
            "cluster": cluster, "status": status,
            "meta": json.dumps(meta) if meta is not None else None,
            "error": error,
        })


def get_job_category_results(job_id):
    """Looks up the job first to find which project's table to query --
    callers don't need to know/pass the project slug separately."""
    job = get_job(job_id)
    if job is None:
        return []
    t = _project_table_names(job["domain"])
    with engine.begin() as conn:
        rows = conn.execute(text(f"""
            SELECT keyword, category, cluster, status, error, meta, checked_at
            FROM {t['keyword_categories']} WHERE job_id = :job_id ORDER BY id
        """), {"job_id": job_id}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_domain_results(domain):
    """All keyword results ever processed for a project, across every job
    -- this is what your UI's per-project 'project table' view reads from."""
    t = _project_table_names(domain)
    with engine.begin() as conn:
        rows = conn.execute(text(f"""
            SELECT keyword, category, cluster, status, error, meta, checked_at, job_id
            FROM {t['keyword_categories']} ORDER BY checked_at DESC
        """)).mappings().fetchall()
        return [dict(r) for r in rows]


def get_categories_overview(domain):
    """Every distinct category in this project, with keyword count and one
    example audit trail (top-3 titles/urls that produced it)."""
    t = _project_table_names(domain)
    with engine.begin() as conn:
        rows = conn.execute(text(f"""
            SELECT category, cluster, count(*) AS keyword_count,
                   array_agg(keyword ORDER BY checked_at) AS keywords,
                   (array_agg(meta ORDER BY checked_at))[1] AS example_meta
            FROM {t['keyword_categories']}
            WHERE category IS NOT NULL
            GROUP BY category, cluster
            ORDER BY keyword_count DESC
        """)).mappings().fetchall()
        return [dict(r) for r in rows]


def get_clusters_overview(domain):
    """Every distinct cluster in this project, with the categories inside
    it and total keyword count."""
    t = _project_table_names(domain)
    with engine.begin() as conn:
        rows = conn.execute(text(f"""
            SELECT cluster, count(DISTINCT category) AS category_count,
                   count(*) AS keyword_count,
                   array_agg(DISTINCT category) AS categories
            FROM {t['keyword_categories']}
            WHERE cluster IS NOT NULL
            GROUP BY cluster
            ORDER BY keyword_count DESC
        """)).mappings().fetchall()
        return [dict(r) for r in rows]


# --- One-time legacy migration ------------------------------------------

def _chunked(items, size=500):
    items = list(items)
    for i in range(0, len(items), size):
        yield items[i:i + size]


def migrate_legacy_domain_to_project(legacy_domain, project_name):
    """Copy rows from the OLD shared tables (categories/clusters/
    category_cluster_map/keyword_categories, filtered by domain=
    legacy_domain) into a brand-new project's own dedicated tables.
    Creates the project if it doesn't exist yet. Safe to re-run for
    categories/clusters/category_cluster_map (ON CONFLICT DO NOTHING) --
    NOT safe to re-run after a fully successful commit for
    keyword_categories, since those rows have no natural unique key and
    would be duplicated; re-running after an INTERRUPTED attempt (nothing
    committed) is fine.

    Does NOT touch or delete the legacy rows -- purely additive.

    Uses chunked multi-row INSERTs (500 rows per statement) rather than
    one round-trip per row -- inserting hundreds/thousands of rows
    one-at-a-time over a network connection to Supabase is what made the
    previous version feel like it had hung."""
    project_slug = get_or_create_project(project_name)
    t = _project_table_names(project_slug)

    with engine.begin() as conn:
        cat_rows = conn.execute(text("""
            SELECT name FROM categories WHERE domain = :domain
        """), {"domain": legacy_domain}).fetchall()
        for chunk in _chunked(cat_rows):
            values_sql = ", ".join(f"(:name{i})" for i in range(len(chunk)))
            params = {f"name{i}": r.name for i, r in enumerate(chunk)}
            conn.execute(text(f"""
                INSERT INTO {t['categories']} (name) VALUES {values_sql}
                ON CONFLICT (name) DO NOTHING
            """), params)
        print(f"  categories: {len(cat_rows)} rows")

        clus_rows = conn.execute(text("""
            SELECT name FROM clusters WHERE domain = :domain
        """), {"domain": legacy_domain}).fetchall()
        for chunk in _chunked(clus_rows):
            values_sql = ", ".join(f"(:name{i})" for i in range(len(chunk)))
            params = {f"name{i}": r.name for i, r in enumerate(chunk)}
            conn.execute(text(f"""
                INSERT INTO {t['clusters']} (name) VALUES {values_sql}
                ON CONFLICT (name) DO NOTHING
            """), params)
        print(f"  clusters: {len(clus_rows)} rows")

        map_rows = conn.execute(text("""
            SELECT category, cluster FROM category_cluster_map WHERE domain = :domain
        """), {"domain": legacy_domain}).fetchall()
        for chunk in _chunked(map_rows):
            values_sql = ", ".join(f"(:category{i}, :cluster{i}, now())" for i in range(len(chunk)))
            params = {}
            for i, r in enumerate(chunk):
                params[f"category{i}"] = r.category
                params[f"cluster{i}"] = r.cluster
            conn.execute(text(f"""
                INSERT INTO {t['category_cluster_map']} (category, cluster, updated_at)
                VALUES {values_sql}
                ON CONFLICT (category) DO NOTHING
            """), params)
        print(f"  category->cluster mappings: {len(map_rows)} rows")

        kw_rows = conn.execute(text("""
            SELECT job_id, keyword, category, cluster, status, error, meta, checked_at
            FROM keyword_categories WHERE domain = :domain
        """), {"domain": legacy_domain}).mappings().fetchall()
        for chunk_num, chunk in enumerate(_chunked(kw_rows), start=1):
            values_sql = ", ".join(
                f"(:job_id{i}, :keyword{i}, :category{i}, :cluster{i}, :status{i}, "
                f":error{i}, CAST(:meta{i} AS JSONB), :checked_at{i})"
                for i in range(len(chunk))
            )
            params = {}
            for i, r in enumerate(chunk):
                params[f"job_id{i}"] = r["job_id"]
                params[f"keyword{i}"] = r["keyword"]
                params[f"category{i}"] = r["category"]
                params[f"cluster{i}"] = r["cluster"]
                params[f"status{i}"] = r["status"]
                params[f"error{i}"] = r["error"]
                params[f"meta{i}"] = json.dumps(r["meta"]) if r["meta"] is not None else None
                params[f"checked_at{i}"] = r["checked_at"]
            conn.execute(text(f"""
                INSERT INTO {t['keyword_categories']}
                    (job_id, keyword, category, cluster, status, error, meta, checked_at)
                VALUES {values_sql}
            """), params)
            print(f"  keyword_categories: chunk {chunk_num} ({len(chunk)} rows) done")
        print(f"  keyword_categories: {len(kw_rows)} rows total")

        # Re-point existing jobs' `domain`/`project_name` so their history
        # shows up under the new project going forward.
        conn.execute(text("""
            UPDATE jobs SET domain = :new_slug, project_name = :project_name
            WHERE domain = :legacy_domain
        """), {"new_slug": project_slug, "project_name": project_name, "legacy_domain": legacy_domain})

    print(f"Migrated {len(cat_rows)} categories, {len(clus_rows)} clusters, "
          f"{len(map_rows)} category->cluster mappings, {len(kw_rows)} keyword rows "
          f"from legacy domain '{legacy_domain}' into project '{project_name}' (slug: {project_slug}).")
    return project_slug


if __name__ == "__main__":
    # Create/update the shared tables:
    #   python db.py
    #
    # One-time migration of old shared-table data into a real project:
    #   python db.py migrate <legacy_domain> "<Project Display Name>"
    if len(sys.argv) >= 4 and sys.argv[1] == "migrate":
        init_db()
        migrate_legacy_domain_to_project(sys.argv[2], sys.argv[3])
    else:
        init_db()
        print("Tables created (or already existed).")
