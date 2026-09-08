"""
category_rag.py

Retrieval-Augmented Generation (RAG) Category & Real-Time Clustering Engine.

Incorporates:
1. 3-Tier RAG Category Matching (Tier 1 Instant Match >= 0.88, Tier 2 Candidate Selection 0.70-0.88, Tier 3 New Creation < 0.70).
2. Original LLM SEO Categorization Prompt & Rules (Pluralization, generic entity extraction, location/brand filtering, 3-word cap).
3. Best/Top Rule integration (Detects Best/Top in SERP titles and applies "Best/Top " prefix to category).
4. Real-Time Vector Cluster Assignment.
"""

import os
import re
import json
from collections import Counter
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
from sqlalchemy import text
from dotenv import load_dotenv

from core.db import engine_kwargs, DATABASE_URL
from sqlalchemy import create_engine

load_dotenv()

_db_engine = create_engine(DATABASE_URL, **engine_kwargs)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

def _get_openai_client():
    if not OPENAI_API_KEY:
        return None
    try:
        from openai import OpenAI
        return OpenAI(api_key=OPENAI_API_KEY)
    except Exception as e:
        print(f"[RAG Engine] OpenAI client init error: {e}")
        return None


def get_embedding(text_to_embed: str) -> List[float]:
    """Generates a 1536-dimensional vector embedding using OpenAI text-embedding-3-small."""
    cleaned = (text_to_embed or "").strip().replace("\n", " ")
    if not cleaned:
        return [0.0] * 1536

    client = _get_openai_client()
    if not client:
        np.random.seed(abs(hash(cleaned)) % (2**32))
        vec = np.random.randn(1536)
        norm = np.linalg.norm(vec)
        return (vec / norm).tolist()

    try:
        response = client.embeddings.create(
            input=[cleaned],
            model="text-embedding-3-small"
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"[RAG Engine] Embedding generation error: {e}")
        np.random.seed(abs(hash(cleaned)) % (2**32))
        vec = np.random.randn(1536)
        norm = np.linalg.norm(vec)
        return (vec / norm).tolist()


_LOCATION_WORDS_SET = {
    "london", "uk", "usa", "ny", "york", "delhi", "mumbai", "sydney", "toronto",
    "chicago", "california", "dubai", "pune", "bangalore", "hyderabad", "chennai",
    "kolkata", "ahmedabad", "noida", "gurgaon", "gurugram", "india", "australia",
    "canada", "singapore", "us", "uae", "tx", "texas", "fl", "florida", "ca",
    "san", "francisco", "boston", "seattle", "austin", "dallas", "houston"
}


def _extract_frequent_serp_words(keyword: str, serp_titles: Optional[List[str]]) -> str:
    """
    Extracts words that appear at least 2 times across the fetched Top 3 SERP titles (or in keyword).
    Excludes stop words, numbers, and location names.
    """
    stop_words = {
        "in", "for", "near", "at", "of", "the", "and", "a", "an", "is", "to", "with", "by", "from",
        "best", "top", "which", "what", "how", "where", "who", "why"
    }
    
    all_text = (keyword or "") + " "
    if serp_titles:
        all_text += " ".join(serp_titles[:3])

    words = re.findall(r"\b[A-Za-z0-9]+\b", all_text)
    counts = Counter([w.lower() for w in words])
    
    kw_words = set(re.findall(r"\b[A-Za-z0-9]+\b", (keyword or "").lower()))
    
    frequent_words = []
    seen = set()
    for w in words:
        w_lower = w.lower()
        # Exclude stop words, short words, numbers, and locations
        if w_lower in stop_words or len(w_lower) <= 2 or re.search(r"\d", w) or w_lower in _LOCATION_WORDS_SET:
            continue
        # Words must appear at least 2 times across SERP titles (or present in target keyword)
        if counts[w_lower] >= 2 or w_lower in kw_words:
            if w_lower not in seen:
                seen.add(w_lower)
                frequent_words.append(w.capitalize())

    return " ".join(frequent_words) if frequent_words else (keyword or "").title()


def _validate_and_clean_category(category_name: str, keyword: str, serp_titles: Optional[List[str]]) -> str:
    """
    FINAL VERIFICATION STEP:
    1. Removes any numbers/digits.
    2. Removes any city, state, country, or location names.
    3. Final Frequency Check: Verifies every word in the category appears 
       at least 2 times across the Top 3 SERP titles (or in target keyword).
    """
    if not category_name:
        return category_name

    has_bt = category_name.lower().startswith("best/top")
    clean = re.sub(r"^(best/top|best|top)\s+", "", category_name, flags=re.IGNORECASE).strip()

    all_text = (keyword or "") + " "
    if serp_titles:
        all_text += " ".join(serp_titles[:3])

    raw_words = re.findall(r"\b[A-Za-z0-9]+\b", all_text)
    counts = Counter([w.lower() for w in raw_words])
    kw_words = set(re.findall(r"\b[A-Za-z0-9]+\b", (keyword or "").lower()))

    words = clean.split()
    valid_words = []

    for w in words:
        w_lower = w.lower()
        # 1. No Numbers/Digits
        if re.search(r"\d", w):
            continue
        # 2. No Location/Place Names
        if w_lower in _LOCATION_WORDS_SET:
            continue
        # 3. Final Frequency Check: Must appear >= 2 times across SERP titles (or in target keyword)
        if counts[w_lower] >= 2 or w_lower in kw_words:
            valid_words.append(w.capitalize() if w.islower() or w.istitle() else w)

    if not valid_words:
        valid_words = [w.capitalize() for w in kw_words if not re.search(r"\d", w) and w.lower() not in _LOCATION_WORDS_SET]

    res = " ".join(valid_words[:3])
    return f"Best/Top {res}".strip() if has_bt else res.strip()


def search_similar_categories(project_slug: str, query_text: str, top_k: int = 5, has_best_top: bool = False) -> List[Dict[str, Any]]:
    """Performs vector similarity search against existing categories in pgvector."""
    query_vec = get_embedding(query_text)
    vec_str = "[" + ",".join(str(x) for x in query_vec) + "]"

    query_sql = text("""
        SELECT name, description, 
               1 - (embedding <=> CAST(:vec AS vector)) AS similarity
        FROM categories
        WHERE (project_name = :project_slug OR project_name IS NULL OR project_name = 'global')
          AND embedding IS NOT NULL
        ORDER BY embedding <=> CAST(:vec AS vector) ASC
        LIMIT :top_k
    """)

    results = []
    try:
        with _db_engine.connect() as conn:
            rows = conn.execute(query_sql, {
                "vec": vec_str,
                "project_slug": project_slug,
                "top_k": top_k * 2
            }).fetchall()
            for r in rows:
                is_bt = r.name.lower().startswith("best/top")
                if has_best_top == is_bt or not results:
                    results.append({
                        "name": r.name,
                        "description": r.description or "",
                        "similarity": float(r.similarity) if r.similarity is not None else 0.0
                    })
                if len(results) >= top_k:
                    break
    except Exception as e:
        print(f"[RAG Engine] Vector similarity search error: {e}", flush=True)

    return results


def search_similar_clusters(project_slug: str, category_name: str, top_k: int = 3) -> List[Dict[str, Any]]:
    """Performs vector similarity search against existing clusters in pgvector."""
    clean_cat = re.sub(r"^(best/top|best|top)\s+", "", category_name, flags=re.IGNORECASE).strip()
    cat_vec = get_embedding(clean_cat)
    vec_str = "[" + ",".join(str(x) for x in cat_vec) + "]"

    query_sql = text("""
        SELECT name, 1 - (embedding <=> CAST(:vec AS vector)) AS similarity
        FROM clusters
        WHERE (project_name = :project_slug OR project_name IS NULL OR project_name = 'global')
          AND embedding IS NOT NULL
        ORDER BY embedding <=> CAST(:vec AS vector) ASC
        LIMIT :top_k
    """)

    results = []
    try:
        with _db_engine.connect() as conn:
            rows = conn.execute(query_sql, {
                "vec": vec_str,
                "project_slug": project_slug,
                "top_k": top_k
            }).fetchall()
            for r in rows:
                results.append({
                    "name": r.name,
                    "similarity": float(r.similarity) if r.similarity is not None else 0.0
                })
    except Exception as e:
        print(f"[RAG Engine] Cluster vector search error: {e}", flush=True)

    return results


def _refine_category_with_llm(frequent_words: str, keyword: str) -> str:
    """
    Applies LLM categorization prompt on frequent SERP words:
    - Removes brand/school/business names (e.g. D.A.V., EuroSchool).
    - Removes cities/locations (London, Mumbai, Delhi).
    - Retains specific topic modifiers (CBSE, ICSE, International, Digital).
    - Capped at maximum 3 words.
    - No hardcoded pluralization.
    """
    client = _get_openai_client()
    if not client:
        return frequent_words

    prompt = (
        f"You are an expert SEO categorizer. Frequent candidate words extracted from SERP titles (frequency >= 2) for keyword '{keyword}' are '{frequent_words}'.\n"
        "Understand the search intent and arrange/phrase them into a single, clean, grammatically meaningful, professional SEO category name.\n"
        "CRITICAL RULES:\n"
        "1. FREQUENCY RULE: ONLY use words provided in the candidate list above (which appeared at least 2 times in SERP titles).\n"
        "2. NEVER include question words (e.g. 'which', 'what', 'how') or filler metadata words (e.g. 'child', 'parents', 'insights').\n"
        "3. REMOVE any specific brand name, business name, or school name (e.g. 'D.A.V.', 'EuroSchool', 'Horizon'). Keep category generic.\n"
        "4. REMOVE any specific city, state, or neighborhood name (e.g. 'London', 'Navi', 'Mumbai', 'Airoli', 'UK', 'USA').\n"
        "5. Retain specific topic modifiers (e.g. 'ICSE', 'CBSE', 'international', 'digital', 'marketing').\n"
        "6. Keep it concise (maximum 3 words). Do not add 'Best' or 'Top' (handled separately).\n"
        "Output ONLY the refined category name, nothing else."
    )

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0
        )
        refined = resp.choices[0].message.content.strip().strip("\"'")
        return refined if refined else frequent_words
    except Exception as e:
        print(f"[RAG Engine] LLM category refinement error: {e}", flush=True)
        return frequent_words


def _ensure_project_exists(project_slug: str):
    if not project_slug or project_slug.strip() == "":
        return
    sql = text("""
        INSERT INTO projects (name, slug)
        VALUES (:name, :slug)
        ON CONFLICT (slug) DO NOTHING
    """)
    try:
        with _db_engine.begin() as conn:
            conn.execute(sql, {
                "name": project_slug.replace("_", " ").title(),
                "slug": project_slug
            })
    except Exception as e:
        pass


def upsert_category_vector(project_slug: str, category_name: str, description: str = ""):
    _ensure_project_exists(project_slug)
    emb = get_embedding(category_name + " " + description)
    vec_str = "[" + ",".join(str(x) for x in emb) + "]"

    sql = text("""
        INSERT INTO categories (project_name, name, description, embedding, created_at)
        VALUES (:project_slug, :name, :description, CAST(:vec AS vector), now())
        ON CONFLICT (project_name, name) 
        DO UPDATE SET embedding = EXCLUDED.embedding, description = EXCLUDED.description
    """)

    try:
        with _db_engine.begin() as conn:
            conn.execute(sql, {
                "project_slug": project_slug,
                "name": category_name,
                "description": description,
                "vec": vec_str
            })
    except Exception as e:
        print(f"[RAG Engine] Error upserting category vector: {e}")


def upsert_cluster_vector(project_slug: str, cluster_name: str):
    _ensure_project_exists(project_slug)
    emb = get_embedding(cluster_name)
    vec_str = "[" + ",".join(str(x) for x in emb) + "]"

    sql = text("""
        INSERT INTO clusters (project_name, name, embedding, created_at)
        VALUES (:project_slug, :name, CAST(:vec AS vector), now())
        ON CONFLICT (project_name, name)
        DO UPDATE SET embedding = EXCLUDED.embedding
    """)

    try:
        with _db_engine.begin() as conn:
            conn.execute(sql, {
                "project_slug": project_slug,
                "name": cluster_name,
                "vec": vec_str
            })
    except Exception as e:
        print(f"[RAG Engine] Error upserting cluster vector: {e}")


def assign_cluster_rag(project_slug: str, category_name: str) -> str:
    """
    Dynamically assigns a category to a broad cluster.
    RULE: The cluster name MUST be contained within (or derived directly from) the category name itself.
    """
    if not category_name or category_name.strip() in ("General", "Uncategorized", "—"):
        return "General"

    # Strip Best/Top prefix for cluster concept
    clean_cat = re.sub(r"^(best/top|best|top)\s+", "", category_name, flags=re.IGNORECASE).strip()
    clean_cat_lower = clean_cat.lower()

    # Search existing vector clusters
    similar_clusters = search_similar_clusters(project_slug, clean_cat, top_k=5)

    # Filter matched clusters: Cluster name MUST be present inside the category_name
    for cls_item in similar_clusters:
        cls_name = cls_item["name"]
        cls_lower = cls_name.lower()
        if cls_item["similarity"] >= 0.75 and (cls_lower in category_name.lower() or cls_lower in clean_cat_lower):
            _map_category_to_cluster(project_slug, category_name, cls_name)
            print(f"[RAG CLUSTER MATCH] Category: '{category_name}' -> Cluster: '{cls_name}' (Cosine Sim: {cls_item['similarity']:.4f})", flush=True)
            return cls_name

    # Derive cluster directly FROM the category name itself
    words = [w.capitalize() for w in clean_cat.split() if w.lower() not in ("best", "top", "in", "for", "near", "and", "the", "a", "an")]
    
    if len(words) >= 2:
        broad_cluster = " ".join(words)
    elif words:
        broad_cluster = words[0]
    else:
        broad_cluster = clean_cat.title()

    upsert_cluster_vector(project_slug, broad_cluster)
    _map_category_to_cluster(project_slug, category_name, broad_cluster)
    print(f"[RAG NEW CLUSTER CREATED FROM CATEGORY] Category: '{category_name}' -> Derived Cluster: '{broad_cluster}'", flush=True)
    return broad_cluster


def _map_category_to_cluster(project_slug: str, category: str, cluster: str):
    _ensure_project_exists(project_slug)
    sql = text("""
        INSERT INTO category_cluster_map (project_name, category, cluster, updated_at)
        VALUES (:project_slug, :category, :cluster, now())
        ON CONFLICT (project_name, category)
        DO UPDATE SET cluster = EXCLUDED.cluster, updated_at = now()
    """)
    try:
        with _db_engine.begin() as conn:
            conn.execute(sql, {
                "project_slug": project_slug,
                "category": category,
                "cluster": cluster
            })
    except Exception as e:
        print(f"[RAG Engine] Error updating category_cluster_map: {e}", flush=True)


def _has_best_or_top(titles: Optional[List[str]]) -> bool:
    """Detects whether SERP titles signal Best/Top query intent."""
    if not titles:
        return False
    bt_regex = re.compile(r"\b(best|top)\b", re.IGNORECASE)
    return any(bt_regex.search(t) for t in titles if t)


def categorize_keyword_rag(project_slug: str, keyword: str, serp_titles: Optional[List[str]] = None) -> Tuple[str, str, float, str]:
    """
    3-Tier Category & Cluster RAG Pipeline with Best/Top Rule & Previous LLM Rules.
    Returns (assigned_category, assigned_cluster, similarity_score, match_tier)
    """
    has_best_top = _has_best_or_top(serp_titles) or bool(re.search(r"\b(best|top)\b", keyword, re.IGNORECASE))
    
    context_text = f"Keyword: {keyword}"
    if serp_titles:
        context_text += "\nSERP Titles: " + " | ".join(serp_titles[:3])

    print(f"[RAG START] Processing Keyword: '{keyword}' (Project: '{project_slug}')", flush=True)

    # Search existing categories in pgvector
    candidates = search_similar_categories(project_slug, context_text, top_k=5, has_best_top=has_best_top)

    assigned_category = None
    similarity_score = 0.0
    match_tier = "tier_3_new"

    # Tier 1: Instant Match (Cosine Similarity >= 0.88)
    if candidates and candidates[0]["similarity"] >= 0.88:
        assigned_category = candidates[0]["name"]
        similarity_score = candidates[0]["similarity"]
        match_tier = "tier_1_exact"
        print(f"[RAG TIER 1 - INSTANT VECTOR MATCH] '{keyword}' -> '{assigned_category}' (Sim: {similarity_score:.4f}, Latency: <10ms, Tokens: 0)", flush=True)

    # Tier 2: RAG Candidate Selection (0.70 <= Cosine Similarity < 0.88)
    elif candidates and candidates[0]["similarity"] >= 0.70:
        top_candidates = [c["name"] for c in candidates if c["similarity"] >= 0.70]
        client = _get_openai_client()

        if client and top_candidates:
            prompt = f"""Target Keyword: "{keyword}"
Context: "{context_text}"

Top Candidate Categories:
{json.dumps(top_candidates, indent=2)}

Instructions:
1. Choose the single BEST matching category from the list above.
2. If none are an accurate fit, respond with "NONE".
3. Return ONLY a valid JSON object with format: {{"category": "<Chosen Category or NONE>"}}"""

            try:
                res = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                    response_format={"type": "json_object"}
                )
                parsed = json.loads(res.choices[0].message.content)
                choice = parsed.get("category")
                if choice and choice != "NONE" and choice in top_candidates:
                    assigned_category = choice
                    similarity_score = candidates[0]["similarity"]
                    match_tier = "tier_2_rag"
                    print(f"[RAG TIER 2 - LLM CANDIDATE MATCH] '{keyword}' -> '{assigned_category}' (Sim: {similarity_score:.4f}, Candidates: {len(top_candidates)})", flush=True)
            except Exception as e:
                print(f"[RAG Engine] Tier 2 LLM selection failed: {e}", flush=True)

    # Tier 3: New Category Creation (< 0.70 Similarity or Tier 2 fallback)
    if not assigned_category:
        frequent_words = _extract_frequent_serp_words(keyword, serp_titles)
        refined_name = _refine_category_with_llm(frequent_words, keyword)
        
        # Apply Best/Top rule prefix if SERP titles / keyword signal best/top
        if has_best_top and not refined_name.lower().startswith("best/top"):
            refined_name = f"Best/Top {refined_name}".strip()
            
        # FINAL VERIFICATION STEP: Ensure no numbers, no locations, and word frequency >= 2 across SERP data
        assigned_category = _validate_and_clean_category(refined_name, keyword, serp_titles)
        similarity_score = candidates[0]["similarity"] if candidates else 0.50
        match_tier = "tier_3_new"

        # Index new category into vector store
        upsert_category_vector(project_slug, assigned_category, f"Category for {keyword}")
        print(f"[RAG TIER 3 - NEW CATEGORY CREATED & INDEXED] '{keyword}' -> '{assigned_category}' (Vector Store Updated)", flush=True)

    # Assign Cluster in Real-Time
    assigned_cluster = assign_cluster_rag(project_slug, assigned_category)

    return assigned_category, assigned_cluster, similarity_score, match_tier
