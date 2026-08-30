"""
cluster_assigner.py

Clustering as its own separate stage/agent -- deliberately NOT part of
category_assigner.py (category assignment and clustering are different
concerns; category_checker.py's own docstring says the same: "Clustering
is a SEPARATE, deterministic, non-LLM step that runs once per job --
AFTER every keyword in that job has been categorized -- over the
domain's ENTIRE category list").

Grouping logic is a SELF-CONTAINED rewrite (not a call into
category_checker.cluster_all_categories() anymore) -- everything else
about clustering stays deterministic/non-LLM, and word-significance
filtering, singularization, and surface-form picking are still reused
UNCHANGED from category_checker.py (pure helpers, not the flawed loop).

Why the original algorithm needed replacing: it repeatedly picked
whichever SINGLE word was shared by the most remaining categories, and
pulled every category containing that word into one cluster in that one
pass. That works fine when categories are topically diverse, but breaks
down on a dataset where nearly every category shares a common word (e.g.
"digital", "marketing") -- that word wins the very first round and
drags EVERY category into one giant cluster before a more specific,
actually-differentiating word (agency vs. company vs. media) ever gets a
chance to split them apart. Observed in practice: "digital marketing
agency", "digital marketing agencies", and "digital marketing companies"
were all landing in one identical "Digital Marketing Companies" cluster.

New rule: two categories only belong in the same cluster if one's
significant-word set is a SUBSET of the other's (directly, or
transitively through a chain of other categories) -- e.g. "digital
marketing companies" {digital, marketing, company} and "digital media
companies marketing" {digital, media, company, marketing} merge (the
first is a subset of the second), but "digital marketing agency"
{digital, marketing, agency} and "digital marketing companies" {digital,
marketing, company} do NOT merge just because they share "digital" and
"marketing" -- "agency" vs. "company" is a real, meaningful difference,
not noise.
"""

import re

from core import db
from services.category_checker import _cluster_significant_words, _singularize_word, _display_form


def _find(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent, a, b):
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


_BEST_TOP_PREFIX_RE = re.compile(r"^(best/top|best|top)\s+", re.IGNORECASE)


def _strip_best_top(label):
    """Cluster names must never carry a Best/Top prefix -- that's a
    per-CATEGORY tag (whether THIS specific keyword's own titles said
    best/top), not a cluster-level concept, and categories sharing one
    cluster can disagree on it. _cluster_significant_words() already
    excludes "best"/"top" from the word sets used to BUILD a multi-member
    label, but the singleton-cluster fallback below reuses a category's
    RAW name verbatim (and the multi-member path also falls back to the
    raw name if no shared words survive) -- either path can otherwise let
    "Best/Top " straight through. Applied as a final safety net to every
    label this function returns, regardless of which path produced it."""
    stripped = _BEST_TOP_PREFIX_RE.sub("", label).strip()
    return stripped or label


def _find_dominant_cluster_word(categories: list) -> str:
    """Finds the most frequent, significant entity word across a list of categories to use as a 1-word cluster name."""
    cat_str = " ".join(categories).lower()
    if "school" in cat_str:
        return "Schools"

    word_counts = {}
    for cat in categories:
        cleaned = _strip_best_top(cat)
        words = re.findall(r"[A-Za-z0-9]+", cleaned.lower())
        for w in set(words):
            if w in ("best", "top", "in", "for", "of", "and", "the", "a", "an", "education", "fees", "admissions") or len(w) <= 2:
                continue
            singular = _singularize_word(w)
            word_counts[singular] = word_counts.get(singular, 0) + 1

    if word_counts:
        best_word, _ = max(word_counts.items(), key=lambda x: x[1])
        return _display_form(best_word, categories).title()

    return "Schools"


import math


def cluster_categories(categories: list) -> dict:
    """
    Groups categories into parent clusters enforcing:
    1. Cluster Name Length: 1 WORD default (e.g. 'Schools', 'Admissions', 'Education').
       Only if a single word is not meaningful, use AT MOST 2 WORDS (e.g. 'CBSE Schools').
    2. Cluster Scaling Ratio:
       - 1 to 5 categories -> 1 cluster (math.ceil(N / 5))
       - 6 to 10 categories -> 2 clusters
       - 11 to 15 categories -> 3 clusters, and so on.
    Returns: {category_name: cluster_label}
    """
    if not categories:
        return {}

    unique_cats = list(dict.fromkeys(categories))
    total_count = len(unique_cats)
    target_cluster_count = max(1, math.ceil(total_count / 5))

    # Single cluster optimization: pick dominant entity word (e.g. 'Schools')
    if target_cluster_count == 1:
        dominant_label = _find_dominant_cluster_word(unique_cats)
        return {cat: dominant_label for cat in unique_cats}

    try:
        from services import category_checker
        client = category_checker.get_openai_client()

        cat_list_str = "\n".join(f"- {c}" for c in unique_cats)

        system_prompt = (
            f"You are an expert SEO taxonomy engine. You are given a list of {total_count} category names.\n"
            f"Your task is to group these categories into EXACTLY {target_cluster_count} parent cluster(s).\n\n"
            "STRICT CLUSTER NAMING RULES:\n"
            "1. Each cluster name MUST be 1 WORD (e.g. 'Schools', 'Admissions', 'Education', 'Preschool', 'Fees').\n"
            "2. ONLY if a single word is not meaningful, you may use AT MOST 2 WORDS (e.g. 'CBSE Schools', 'International Schools').\n"
            "3. NEVER use more than 2 words for any cluster name.\n"
            "4. NEVER include 'Best' or 'Top' in any cluster name.\n"
            "5. Capitalize cluster names properly (Title Case).\n\n"
            "OUTPUT FORMAT:\n"
            "Return ONLY a JSON object mapping each category string to its assigned Cluster name verbatim:\n"
            "{\n"
            '  "mappings": {\n'
            '    "Category Name 1": "Cluster Name A",\n'
            '    "Category Name 2": "Cluster Name A"\n'
            "  }\n"
            "}"
        )

        user_prompt = f"TARGET CLUSTER COUNT: {target_cluster_count}\n\nCATEGORIES:\n{cat_list_str}"

        resp = client.chat.completions.create(
            model=category_checker.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0
        )

        res_text = resp.choices[0].message.content.strip()
        parsed = json.loads(res_text).get("mappings", {})

        assignment = {}
        for cat in unique_cats:
            assigned = parsed.get(cat)
            if not assigned:
                for k, v in parsed.items():
                    if k.lower() == cat.lower():
                        assigned = v
                        break

            if assigned:
                cleaned = _strip_best_top(assigned)
                words = cleaned.split()
                if len(words) > 2:
                    cleaned = " ".join(words[:2])
                assignment[cat] = cleaned
            else:
                words = _strip_best_top(cat).split()
                assignment[cat] = words[0] if len(words) >= 1 else "General"

        # Enforce EXACT unique cluster count limit (target_cluster_count)
        distinct_clusters = list(dict.fromkeys(assignment.values()))
        if len(distinct_clusters) > target_cluster_count:
            allowed_clusters = distinct_clusters[:target_cluster_count]
            primary_cluster = allowed_clusters[0]

            for cat, current_cluster in list(assignment.items()):
                if current_cluster not in allowed_clusters:
                    matched = False
                    for allowed in allowed_clusters:
                        if allowed.lower() in current_cluster.lower() or current_cluster.lower() in allowed.lower():
                            assignment[cat] = allowed
                            matched = True
                            break
                    if not matched:
                        assignment[cat] = primary_cluster

        return assignment

    except Exception as e:
        print(f"[cluster_categories] Error: {e}")
        fallback_label = _find_dominant_cluster_word(unique_cats)
        return {cat: fallback_label for cat in unique_cats}
import json


def _extract_titles_from_meta(meta_obj):
    titles = []
    if isinstance(meta_obj, str):
        try:
            meta_obj = json.loads(meta_obj)
        except Exception:
            return []
    if isinstance(meta_obj, dict):
        top3 = meta_obj.get("top3") or []
        for item in top3:
            if isinstance(item, dict) and item.get("title"):
                titles.append(item["title"])
    return titles


def batch_map_small_categories_to_major(small_categories_data: list, major_categories: list) -> dict:
    """
    Passes all small categories, their keywords, AND their SERP metadata (titles)
    to OpenAI in a SINGLE batch call and returns a dict: { "Small Category Name": "Matched Major Category Name" }
    """
    if not small_categories_data or not major_categories:
        return {}

    try:
        from services import category_checker
        client = category_checker.get_openai_client()

        major_list_str = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(major_categories))
        
        small_items = []
        for item in small_categories_data:
            small_cat = item["category"]
            sample_kws = ", ".join((item.get("keywords") or [])[:5])
            sample_titles = " | ".join((item.get("serp_titles") or [])[:6])
            
            entry_str = f"- Category: '{small_cat}'\n  Keywords: {sample_kws}"
            if sample_titles:
                entry_str += f"\n  SERP Page Titles: {sample_titles}"
            small_items.append(entry_str)
        
        small_list_str = "\n\n".join(small_items)

        system_prompt = (
            "You are an expert SEO taxonomist. Your job is to consolidate low-volume categories "
            "(<= 5 keywords) into the SINGLE MOST SUITABLE Major Category from the provided list.\n\n"
            "You are given each small category's name, its keywords, AND its SERP Metadata (top Google search result titles).\n\n"
            "INSTRUCTIONS:\n"
            "1. Analyze the category name, keywords, AND SERP page titles to determine true search intent.\n"
            "2. You MUST assign every single Small Category to the BEST-FITTING Major Category.\n"
            "3. Pick the Major Category that has the closest search intent, topic, or subject overlap.\n"
            "4. Return ONLY a valid JSON object mapping each small category to its chosen Major Category verbatim.\n"
            "Example Output:\n"
            "{\n"
            '  "mappings": {\n'
            '    "Small Category 1": "Major Category A",\n'
            '    "Small Category 2": "Major Category B"\n'
            "  }\n"
            "}"
        )

        user_prompt = (
            f"MAJOR CATEGORIES (Choose only from these):\n{major_list_str}\n\n"
            f"SMALL CATEGORIES TO MERGE (WITH KEYWORDS & SERP METADATA):\n{small_list_str}"
        )

        resp = client.chat.completions.create(
            model=category_checker.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0
        )

        res_text = resp.choices[0].message.content.strip()
        parsed = json.loads(res_text).get("mappings", {})

        validated = {}
        for small_cat, assigned_major in parsed.items():
            if not assigned_major:
                continue
            for major in major_categories:
                if major.lower() == assigned_major.lower() or major.lower() in assigned_major.lower():
                    validated[small_cat] = major
                    break

        return validated
    except Exception as e:
        print(f"[batch_map_small_categories_to_major] Error: {e}")
        return {}


def consolidate_small_categories(domain: str, min_threshold: int = 5):
    """
    Second pass check after full categorization:
    Finds categories with <= min_threshold (5) keywords and reassigns ALL of their keywords
    to the most suitable major category (> min_threshold keywords) via a single batch OpenAI call
    incorporating keyword names AND SERP metadata (page titles).
    """
    try:
        with db.engine.begin() as conn:
            rows = conn.execute(db.text("""
                SELECT category, count(*) AS keyword_count,
                       array_agg(keyword) AS keywords,
                       array_agg(meta) AS metas
                FROM keyword_categories
                WHERE project_name = :project_name AND category IS NOT NULL AND TRIM(category) != ''
                GROUP BY category
                ORDER BY keyword_count DESC
            """), {"project_name": domain}).mappings().fetchall()

            if not rows:
                return

            rows_dict = []
            for r in rows:
                r_dict = dict(r)
                serp_titles = []
                for m in (r_dict.get("metas") or []):
                    serp_titles.extend(_extract_titles_from_meta(m))
                r_dict["serp_titles"] = list(dict.fromkeys(serp_titles))  # dedupe titles
                rows_dict.append(r_dict)

            major_categories = [r["category"] for r in rows_dict if r["keyword_count"] > min_threshold]
            small_category_rows = [r for r in rows_dict if r["keyword_count"] <= min_threshold]

            if not small_category_rows:
                return

            # Edge case: no category exceeds the threshold (e.g. small project with < 10 total KWs).
            # Use the category with the most keywords as the single consolidation target.
            if not major_categories:
                majority_cat = rows_dict[0]["category"]  # rows are ORDER BY keyword_count DESC
                print(f"[consolidate_small_categories] No major categories found for '{domain}' -- all categories have <= {min_threshold} KWs. Merging all into majority category: '{majority_cat}'")
                for row in rows_dict[1:]:  # skip the majority category itself
                    small_cat = row["category"]
                    if small_cat == majority_cat:
                        continue
                    print(f"[consolidate_small_categories] Merging '{small_cat}' ({row['keyword_count']} KWs) -> '{majority_cat}'")
                    conn.execute(db.text("""
                        UPDATE keyword_categories
                        SET category = :new_category
                        WHERE project_name = :project_name AND category = :old_category
                    """), {
                        "new_category": majority_cat,
                        "project_name": domain,
                        "old_category": small_cat
                    })
                    conn.execute(db.text("""
                        DELETE FROM categories
                        WHERE project_name = :project_name AND name = :old_category
                    """), {
                        "project_name": domain,
                        "old_category": small_cat
                    })
                return

            print(f"[consolidate_small_categories] Found {len(small_category_rows)} small categories (<= {min_threshold} KWs) and {len(major_categories)} major categories for '{domain}'. Batch mapping using SERP metadata...")

            mappings = batch_map_small_categories_to_major(small_category_rows, major_categories)

            for small_row in small_category_rows:
                small_cat = small_row["category"]
                matched_major = mappings.get(small_cat)

                # Fallback to the top major category if no explicit mapping was returned
                if not matched_major:
                    matched_major = major_categories[0]

                if matched_major and matched_major != small_cat:
                    print(f"[consolidate_small_categories] Merging '{small_cat}' ({small_row['keyword_count']} KWs) -> '{matched_major}'")
                    conn.execute(db.text("""
                        UPDATE keyword_categories
                        SET category = :new_category
                        WHERE project_name = :project_name AND category = :old_category
                    """), {
                        "new_category": matched_major,
                        "project_name": domain,
                        "old_category": small_cat
                    })
                    conn.execute(db.text("""
                        DELETE FROM categories
                        WHERE project_name = :project_name AND name = :old_category
                    """), {
                        "project_name": domain,
                        "old_category": small_cat
                    })
    except Exception as e:
        print(f"[consolidate_small_categories] Error consolidating categories for {domain}: {e}")


def cluster_project(domain):
    """Consolidates small categories (<= 5 keywords) into suitable major categories first,
    then re-clusters this project's ENTIRE category list from scratch
    and persists the new cluster assignment. Returns {category_name: cluster_name}."""
    consolidate_small_categories(domain, min_threshold=5)
    categories = db.list_category_names(domain)
    assignment = cluster_categories(categories)
    db.replace_domain_clusters(domain, assignment)
    return assignment


def recluster_only(domain):
    """Runs ONLY parent clustering on existing categories WITHOUT modifying or consolidating categories."""
    categories = db.list_category_names(domain)
    assignment = cluster_categories(categories)
    db.replace_domain_clusters(domain, assignment)
    return assignment
