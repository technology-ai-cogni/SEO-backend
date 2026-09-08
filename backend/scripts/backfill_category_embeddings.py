"""
backfill_category_embeddings.py

Populates 1536-dimensional vector embeddings for all categories and clusters 
in the database using OpenAI text-embedding-3-small via category_rag.
"""

import sys
import os
from sqlalchemy import text
from dotenv import load_dotenv

# Add parent backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.db import engine_kwargs, DATABASE_URL
from sqlalchemy import create_engine
from services.category_rag import get_embedding

load_dotenv()

db_engine = create_engine(DATABASE_URL, **engine_kwargs)


def backfill_all():
    print("[Backfill] Starting 100% vector embedding backfill for categories and clusters...")
    
    with db_engine.begin() as conn:
        # Fetch categories lacking embeddings
        cat_rows = conn.execute(text("SELECT id, project_name, name, description FROM categories WHERE embedding IS NULL")).fetchall()
        print(f"[Backfill] Found {len(cat_rows)} categories to embed.")

        for idx, row in enumerate(cat_rows, 1):
            text_val = f"{row.name} {row.description or ''}"
            vec = get_embedding(text_val)
            vec_str = "[" + ",".join(str(x) for x in vec) + "]"
            conn.execute(
                text("UPDATE categories SET embedding = :vec::vector WHERE id = :id"),
                {"vec": vec_str, "id": row.id}
            )
            if idx % 100 == 0 or idx == len(cat_rows):
                print(f"[Backfill] Categories: {idx}/{len(cat_rows)} completed.")

        # Fetch clusters lacking embeddings
        cls_rows = conn.execute(text("SELECT id, project_name, name FROM clusters WHERE embedding IS NULL")).fetchall()
        print(f"[Backfill] Found {len(cls_rows)} clusters to embed.")

        for idx, row in enumerate(cls_rows, 1):
            vec = get_embedding(row.name)
            vec_str = "[" + ",".join(str(x) for x in vec) + "]"
            conn.execute(
                text("UPDATE clusters SET embedding = :vec::vector WHERE id = :id"),
                {"vec": vec_str, "id": row.id}
            )
            if idx % 50 == 0 or idx == len(cls_rows):
                print(f"[Backfill] Clusters: {idx}/{len(cls_rows)} completed.")

    print("[Backfill] Vector backfill completed successfully!")


if __name__ == "__main__":
    backfill_all()
