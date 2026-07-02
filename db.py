"""
Database layer, backed by Postgres (Supabase).

Tables:
    jobs                -- one row per category-check batch
    categories          -- master list of distinct category names (matched
                            against for every new keyword)
    keyword_categories   -- one row per keyword categorized EVER (history
                            kept, not overwritten)

Setup:
    1. Create a free project at https://supabase.com
    2. Project Settings -> Database -> Connection string (URI format,
       "Transaction" pooler mode is fine for this use case)
    3. Put it in your .env as DATABASE_URL (see .env.example)
    4. Run `python db.py` once to create the tables
"""

import os
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
                job_type TEXT NOT NULL DEFAULT 'category',
                status TEXT NOT NULL DEFAULT 'pending',
                total INTEGER NOT NULL DEFAULT 0,
                processed INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                completed_at TIMESTAMPTZ
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS categories (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS keyword_categories (
                id BIGSERIAL PRIMARY KEY,
                job_id UUID REFERENCES jobs(id),
                keyword TEXT NOT NULL,
                category TEXT,
                status TEXT,
                error TEXT,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_keyword_categories_job
            ON keyword_categories (job_id)
        """))


# --- Jobs -------------------------------------------------------------

def create_job(filename, total):
    job_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO jobs (id, filename, job_type, status, total, processed)
            VALUES (:id, :filename, 'category', 'pending', :total, 0)
        """), {"id": job_id, "filename": filename, "total": total})
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


# --- Categories ------------------------------------------------------------
# IMPORTANT: run only ONE category worker at a time -- category assignment
# is inherently sequential (each decision depends on categories already
# created by prior keywords in the run).

def list_category_names():
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT name FROM categories ORDER BY id")).fetchall()
        return [r.name for r in rows]


def add_category(name):
    """Insert a new category name. No-op if it already exists (unique constraint)."""
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO categories (name) VALUES (:name)
            ON CONFLICT (name) DO NOTHING
        """), {"name": name})


def insert_category_result(job_id, keyword, category, status, error=None):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO keyword_categories (job_id, keyword, category, status, error)
            VALUES (:job_id, :keyword, :category, :status, :error)
        """), {
            "job_id": job_id, "keyword": keyword, "category": category,
            "status": status, "error": error,
        })


def get_job_category_results(job_id):
    with engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT keyword, category, status, error, checked_at
            FROM keyword_categories WHERE job_id = :job_id ORDER BY id
        """), {"job_id": job_id}).mappings().fetchall()
        return [dict(r) for r in rows]


if __name__ == "__main__":
    # Run this file directly once to create the tables:
    #   python db.py
    init_db()
    print("Tables created (or already existed).")
