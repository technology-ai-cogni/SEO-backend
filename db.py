"""
Database layer, backed by Postgres (Supabase).

Everything is scoped by DOMAIN -- each domain behaves like its own
isolated project. Categories, clusters, and the category->cluster cache
are matched only against other entries in the SAME domain, so importing a
sheet for a different domain never mixes data with another domain's
categories/clusters.

Tables:
    jobs                  -- one row per import batch, tagged with domain
    categories             -- distinct category names, scoped per domain
    clusters                -- distinct cluster names, scoped per domain
    category_cluster_map    -- deterministic category->cluster cache, per domain
    keyword_categories      -- one row per keyword processed EVER (history kept)

Setup:
    1. Create a free project at https://supabase.com
    2. Project Settings -> Database -> Connection string (URI format,
       "Transaction" pooler mode is fine for this use case)
    3. Put it in your .env as DATABASE_URL (see .env.example)
    4. Run `python db.py` once to create the tables
"""

import os
import json
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


def init_db():
    """Create tables if they don't exist yet. Safe to run repeatedly."""
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
        conn.execute(text("""
            ALTER TABLE jobs ADD COLUMN IF NOT EXISTS clustering_triggered_at TIMESTAMPTZ
        """))
        conn.execute(text("""
            ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country_name TEXT
        """))
        conn.execute(text("""
            ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country_code TEXT
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_jobs_domain ON jobs (domain)
        """))

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
        conn.execute(text("""
            ALTER TABLE keyword_categories ADD COLUMN IF NOT EXISTS meta JSONB
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_keyword_categories_job
            ON keyword_categories (job_id)
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_keyword_categories_domain
            ON keyword_categories (domain)
        """))


# --- Jobs -------------------------------------------------------------

def create_job(filename, domain, country_name, country_code, total):
    job_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO jobs (id, filename, domain, country_name, country_code, job_type, status, total, processed)
            VALUES (:id, :filename, :domain, :country_name, :country_code, 'category', 'pending', :total, 0)
        """), {
            "id": job_id, "filename": filename, "domain": domain,
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
    """Distinct domains that have at least one job -- for populating a
    domain picker in your UI."""
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


# --- Categories (domain-scoped) --------------------------------------------

def list_category_names(domain):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT name FROM categories WHERE domain = :domain ORDER BY id
        """), {"domain": domain}).fetchall()
        return [r.name for r in rows]


def add_category(domain, name):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO categories (domain, name) VALUES (:domain, :name)
            ON CONFLICT (domain, name) DO NOTHING
        """), {"domain": domain, "name": name})


# --- Clusters (domain-scoped) -----------------------------------------
# IMPORTANT: run only ONE category worker at a time -- category AND
# cluster assignment are both inherently sequential within a domain.

def list_cluster_names(domain):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT name FROM clusters WHERE domain = :domain ORDER BY id
        """), {"domain": domain}).fetchall()
        return [r.name for r in rows]


def add_cluster(domain, name):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO clusters (domain, name) VALUES (:domain, :name)
            ON CONFLICT (domain, name) DO NOTHING
        """), {"domain": domain, "name": name})


def get_cluster_for_category(domain, category_name):
    """Deterministic cache lookup, scoped per domain: has this EXACT
    category already been assigned a cluster in this domain before?"""
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT cluster FROM category_cluster_map
            WHERE domain = :domain AND category = :category
        """), {"domain": domain, "category": category_name}).fetchone()
        return row.cluster if row else None


def set_cluster_for_category(domain, category_name, cluster_name):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO category_cluster_map (domain, category, cluster, updated_at)
            VALUES (:domain, :category, :cluster, now())
            ON CONFLICT (domain, category) DO UPDATE SET cluster = :cluster, updated_at = now()
        """), {"domain": domain, "category": category_name, "cluster": cluster_name})


def replace_domain_clusters(domain, category_to_cluster):
    """Overwrite this domain's ENTIRE cluster assignment in one pass --
    used by the post-categorization clustering step, which re-clusters
    the whole domain's category list from scratch every time it runs
    (new categories can shift which word is now the 'most common', so a
    full recompute keeps clustering consistent rather than just patching
    in new categories against stale groupings)."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM clusters WHERE domain = :domain"), {"domain": domain})
        for cluster_name in sorted(set(category_to_cluster.values())):
            conn.execute(text("""
                INSERT INTO clusters (domain, name) VALUES (:domain, :name)
                ON CONFLICT (domain, name) DO NOTHING
            """), {"domain": domain, "name": cluster_name})

        conn.execute(text("DELETE FROM category_cluster_map WHERE domain = :domain"), {"domain": domain})
        for category_name, cluster_name in category_to_cluster.items():
            conn.execute(text("""
                INSERT INTO category_cluster_map (domain, category, cluster, updated_at)
                VALUES (:domain, :category, :cluster, now())
            """), {"domain": domain, "category": category_name, "cluster": cluster_name})

            conn.execute(text("""
                UPDATE keyword_categories SET cluster = :cluster
                WHERE domain = :domain AND category = :category
            """), {"domain": domain, "category": category_name, "cluster": cluster_name})


# --- Keyword results ----------------------------------------------------

def insert_category_result(job_id, domain, keyword, category, cluster, status, meta=None, error=None):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO keyword_categories (job_id, domain, keyword, category, cluster, status, meta, error)
            VALUES (:job_id, :domain, :keyword, :category, :cluster, :status, CAST(:meta AS JSONB), :error)
        """), {
            "job_id": job_id, "domain": domain, "keyword": keyword, "category": category,
            "cluster": cluster, "status": status,
            "meta": json.dumps(meta) if meta is not None else None,
            "error": error,
        })


def get_job_category_results(job_id):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT keyword, category, cluster, status, error, meta, checked_at
            FROM keyword_categories WHERE job_id = :job_id ORDER BY id
        """), {"job_id": job_id}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_domain_results(domain):
    """All keyword results ever processed for a domain, across every job
    -- this is what your UI's per-domain 'project table' view reads from."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT keyword, category, cluster, status, error, meta, checked_at, job_id
            FROM keyword_categories WHERE domain = :domain ORDER BY checked_at DESC
        """), {"domain": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_categories_overview(domain):
    """Every distinct category in this domain, with keyword count and one
    example audit trail (top-3 titles/urls that produced it) -- lets you
    see WHY a category exists without opening every keyword individually."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT category, cluster, count(*) AS keyword_count,
                   array_agg(keyword ORDER BY checked_at) AS keywords,
                   (array_agg(meta ORDER BY checked_at))[1] AS example_meta
            FROM keyword_categories
            WHERE domain = :domain AND category IS NOT NULL
            GROUP BY category, cluster
            ORDER BY keyword_count DESC
        """), {"domain": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


def get_clusters_overview(domain):
    """Every distinct cluster in this domain, with the list of categories
    inside it and total keyword count -- shows exactly which categories
    got grouped together and why (the shared word is visible directly in
    the category names)."""
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT cluster, count(DISTINCT category) AS category_count,
                   count(*) AS keyword_count,
                   array_agg(DISTINCT category) AS categories
            FROM keyword_categories
            WHERE domain = :domain AND cluster IS NOT NULL
            GROUP BY cluster
            ORDER BY keyword_count DESC
        """), {"domain": domain}).mappings().fetchall()
        return [dict(r) for r in rows]


if __name__ == "__main__":
    # Run this file directly once to create the tables:
    #   python db.py
    init_db()
    print("Tables created (or already existed).")
