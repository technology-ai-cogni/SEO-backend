"""
category_assigner.py (renamed from categorize_generalized.py)

Category-ONLY module -- assigns a category to a keyword given its top-3
SERP titles. Deliberately separate from clustering, which is its own
module (scripts/cluster_assigner.py), and from landing/blog and
info/comm classification (scripts/landing_blog_classifier.py,
scripts/intent_classifier.py). categorize_from_top3() below is imported
directly by scripts/run_pipeline.py -- the orchestrator never
reimplements this logic itself.

Still runnable standalone (see main() at the bottom) on a CSV that
already has a Top-3 JSON column, same as before.

Structured the same way as scripts/categorize_owis_csv.py -- one
keyword at a time, in order, reusing category_checker.py's category
pipeline UNCHANGED (build_majority_titles, the Best/Top rule,
derive_category_name, the plural-variant dedup, find_matching_category)
and the same Postgres-backed per-project category list via core/db.py.

The only difference from categorize_owis_csv.py: category_checker's
find_matching_category() is intentionally strict (only merges
genuinely-identical specific topics). None of its rules are touched
here. Instead, ONE extra rule is layered ON TOP: if that strict pass
finds no match, a second, more lenient "generalized" pass
(find_matching_category_generalized() below) gets a chance to merge the
candidate into an existing category by generalizing away minor
modifiers/qualifiers when the core subject and searcher intent are
really the same -- before falling back to creating a brand new
category. This naturally keeps the category count down without any
hardcoded cap, by making matching smarter rather than by limiting how
many categories are allowed to exist.

No Cluster column handling here at all -- whatever is already in that
column is left exactly as-is; clustering is out of scope for this
script.

Run from the `backend/` directory:
    python -m scripts.category_assigner
"""

import csv
import json
import shutil

from core import db
from services import category_checker

CSV_PATH = "datasets/social media category test 8 july - Sheet1_top3.csv"
PROJECT_DISPLAY_NAME = "social media category test 8 july"
KEYWORD_COL = "Keyword"
LANDING_PAGE_COL = "Landing Page"
TOP3_COL = "Top 3 URLs (JSON)"
CATEGORY_COL = "Category"


def find_matching_category_generalized(candidate_name, candidate_titles, existing_category_names):
    """
    Second-pass, more lenient category match -- only ever called AFTER
    category_checker.find_matching_category() has already looked at the
    same candidate and existing categories and found no match. That
    strict pass requires the SAME specific topic; this pass is willing
    to generalize away a minor modifier/qualifier (a narrower audience,
    an adjective, a phrasing difference) when the core subject and the
    searcher's underlying goal are really the same, so near-duplicate
    categories don't pile up for what is fundamentally one topic.

    Returns the existing category name if a generalized match is found,
    else None (a new category should be created).
    """
    if not existing_category_names:
        return None

    client = category_checker.get_openai_client()
    category_list = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(existing_category_names))
    titles_block = "\n".join(f"- {t}" for t in candidate_titles)
    system_prompt = (
        "You are doing a SECOND, more lenient pass at grouping SEO keyword "
        "topics into categories -- a stricter first pass already checked "
        "this candidate against the same list of existing categories and "
        "found no exact match, because the specific topics didn't line up "
        "word-for-word.\n\n"
        "Your job now: look past minor differences and decide if this "
        "candidate is still, at its core, the SAME general subject and the "
        "SAME searcher intent as one of the existing categories -- just "
        "phrased with a different modifier, qualifier, audience, or "
        "format. If so, reuse that existing category instead of treating "
        "this as a new topic.\n\n"
        "Examples of differences you SHOULD now treat as the same category: "
        "a narrower audience or sub-group of the same subject (e.g. "
        "\"international schools\" and \"international private schools\"), "
        "a synonym or near-synonym qualifier (e.g. \"fees\" and \"tuition "
        "fees\", \"admissions\" and \"enrollment\"), or a different surface "
        "wording of the same underlying question or goal.\n\n"
        "Still keep them SEPARATE if the searcher's actual goal is "
        "genuinely different -- e.g. comparing/ranking options vs. "
        "researching one specific aspect like fees or curriculum vs. "
        "general informational content are different goals, even under "
        "this more lenient pass.\n\n"
        "IMPORTANT -- never merge just to swap the business/entity-type "
        "word: 'company', 'agency', 'service', 'firm', and 'provider' "
        "(singular or plural) are NOT interchangeable for this pass, even "
        "though they're the same general kind of subject. The candidate's "
        "entity-type word was chosen because it's the one that actually "
        "occurs most often (majority) across ITS OWN page titles -- an "
        "existing category built around a DIFFERENT entity-type word "
        "(e.g. 'services') is NOT a match for this candidate (e.g. "
        "'companies') just because the rest of the topic lines up. Only "
        "treat them as the same category if the existing category uses "
        "the SAME entity-type word as the candidate, or has no "
        "entity-type word at all.\n\n"
        "If this candidate is really the same general subject and intent "
        "as one of the existing categories, respond with ONLY that exact "
        "existing category name, copied exactly as written. Otherwise "
        "respond with exactly: NONE"
    )
    user_prompt = (
        f"Existing categories:\n{category_list}\n\n"
        f'New topic candidate: "{candidate_name}"\n'
        f"Based on these page titles:\n{titles_block}"
    )
    resp = client.chat.completions.create(
        model=category_checker.OPENAI_CHAT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
        max_tokens=20,
    )
    answer = resp.choices[0].message.content.strip().strip('"')

    if answer.upper() == "NONE":
        return None

    for name in existing_category_names:
        if name.strip().lower() == answer.strip().lower():
            return name
    return None


def strip_location_from_category(candidate_name, titles):
    """
    Extra rule on top of category_checker's own (already-existing) 'no
    city/state/country/region' instruction to the category-naming model.
    That instruction alone isn't catching everything -- category_checker
    only filters candidate WORDS against a hardcoded location blocklist
    (pycountry countries/subdivisions + a short manually curated list of
    major global cities), so a local neighborhood/locality/area name that
    isn't in that list -- e.g. "Rajouri Garden" -- can still slip through
    into a category name.

    Rather than hardcoding yet another list of place names (which can
    never be complete -- neighborhoods, localities, landmarks, areas
    exist everywhere), this asks the model itself to recognize ANY
    geographic reference in the candidate name, at whatever level
    (country, state, city, neighborhood, locality, area, landmark), and
    remove it -- keeping every other word exactly as-is. Only called
    AFTER category_checker's own derive_category_name + Best/Top rule
    have already run, as one more cleanup pass, not a replacement for
    either.
    """
    client = category_checker.get_openai_client()
    titles_block = "\n".join(f"- {t}" for t in titles)
    system_prompt = (
        "You clean up SEO category names by removing geographic "
        "references. A category name should describe a TOPIC, never a "
        "PLACE.\n\n"
        "Look at the category name below and decide, using your own "
        "knowledge of world geography (not a fixed list), whether ANY "
        "part of it names or refers to a specific place -- a country, "
        "state/province, city, town, neighborhood, locality, area, "
        "district, or landmark, at any level of specificity, however "
        "small or locally-known it is.\n\n"
        "If it does, rewrite the category name with that place name "
        "removed entirely, keeping every other word exactly as given, in "
        "the same order. Do not add, invent, or substitute any new word. "
        "If removing the place leaves nothing meaningful, output just the "
        "single most meaningful remaining word.\n\n"
        "If the category name does not contain any place reference at "
        "all, output it completely unchanged.\n\n"
        "Respond with ONLY the resulting category name, nothing else -- "
        "no punctuation, no quotes, no explanation."
    )
    user_prompt = (
        f'Category name: "{candidate_name}"\n\n'
        f"Titles this category was derived from (for context only):\n{titles_block}"
    )
    resp = client.chat.completions.create(
        model=category_checker.OPENAI_CHAT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
        max_tokens=40,
    )
    cleaned = resp.choices[0].message.content.strip().strip('"')
    return cleaned or candidate_name


def reset_categories_for_project(domain):
    """
    Delete every category already stored for this project before this run
    starts.

    Necessary because core/db.py's category store is a shared Postgres
    table keyed by project name, persistent across script runs -- not
    something this script resets on its own. Without this, keywords in a
    fresh run keep matching into "dirty" categories an EARLIER run of
    this script already created (e.g. ones still containing a location
    like "Rajouri Garden", from before strip_location_from_category
    existed), because a match returns the ALREADY-STORED name verbatim --
    this run's cleanup never even runs on it. This script is an
    experimental tool re-run repeatedly over a small fixed keyword set
    while the categorization rules are being tuned, not an incremental
    production pipeline, so starting every run from a clean slate for
    this project is what's wanted.

    Only deletes rows for THIS project's name -- other projects in the
    same shared table are untouched.
    """
    with db.engine.begin() as conn:
        conn.execute(
            db.text("DELETE FROM categories WHERE project_name = :project_name"),
            {"project_name": domain},
        )


def categorize_from_top3(keyword, top3, domain):
    """Same steps as category_checker.categorize_keyword(), minus the
    Bright Data fetch (top3 is passed in directly instead), plus one
    extra generalized-matching fallback before a new category is
    created (see find_matching_category_generalized above)."""
    titles, _ = category_checker.build_majority_titles(top3)
    if not titles:
        return None

    has_best_top = category_checker._titles_contain_best_or_top(titles)
    raw_candidate = category_checker.derive_category_name(titles, keyword)
    candidate_name = category_checker._apply_best_top_rule(raw_candidate, titles)
    candidate_name = strip_location_from_category(candidate_name, titles)

    existing_category_names = [
        name for name in db.list_category_names(domain)
        if name.lower().startswith("best/top") == has_best_top
    ]

    plural_variant = category_checker._find_plural_variant(candidate_name, existing_category_names)
    if plural_variant:
        db.add_category(domain, plural_variant)
        return plural_variant

    matched_category = category_checker.find_matching_category(candidate_name, titles, existing_category_names)
    if matched_category:
        return matched_category

    generalized_match = find_matching_category_generalized(candidate_name, titles, existing_category_names)
    if generalized_match:
        return generalized_match

    db.add_category(domain, candidate_name)
    return candidate_name


def main():
    # encoding="utf-8-sig" so a leading BOM (present in this CSV) doesn't
    # get glued onto the first column name and break the Keyword lookup.
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    if not rows:
        print("No rows found in CSV -- nothing to do.")
        return

    # This CSV has no Landing Page column to derive a project from, unlike
    # owis_kw_dump_filtered_top3.csv -- fall back to a fixed project name.
    landing_page = (rows[0].get(LANDING_PAGE_COL) or "").strip()
    project_display_name = landing_page or PROJECT_DISPLAY_NAME
    domain = db.get_or_create_project(project_display_name)
    reset_categories_for_project(domain)
    print(f"Using project '{project_display_name}' (slug: {domain}) -- reset to a clean category slate\n")

    if CATEGORY_COL not in fieldnames:
        fieldnames.append(CATEGORY_COL)

    for i, row in enumerate(rows, start=1):
        keyword = (row.get(KEYWORD_COL) or "").strip()
        raw_json = (row.get(TOP3_COL) or "").strip()

        try:
            top3 = json.loads(raw_json) if raw_json else []
        except json.JSONDecodeError:
            top3 = []

        if not keyword or not top3:
            print(f"[{i}/{len(rows)}] SKIP '{keyword}' -- no keyword or no top-3 data")
            row[CATEGORY_COL] = ""
            continue

        try:
            category = categorize_from_top3(keyword, top3, domain)
        except Exception as e:
            print(f"[{i}/{len(rows)}] ERROR '{keyword}': {e}")
            row[CATEGORY_COL] = ""
            continue

        row[CATEGORY_COL] = category or ""
        print(f"[{i}/{len(rows)}] '{keyword}' -> {category}", flush=True)

    backup_path = CSV_PATH + ".bak"
    shutil.copyfile(CSV_PATH, backup_path)
    print(f"\nBacked up original CSV to {backup_path}")

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nDone -- wrote Category column for {len(rows)} rows into {CSV_PATH}")
    print("(Cluster column left untouched -- clustering is a separate script.)")


if __name__ == "__main__":
    main()
