"""
sequential_recategorize.py -- experimental, standalone

SECOND pass over a sheet already processed by run_experiment.py -- single
worker, strictly sequential (unlike pass 1's pooled/independent
categorization), because this pass's whole point is that each row's
decision depends on categories already created by EARLIER rows in the
same run.

For each row, in order:

  1. Re-fetch full page metadata for the keyword's already-known top-3
     URLs (read from the "Top 3 URLs (JSON)" column pass 1 wrote --
     metadata itself was never persisted, only url+title, so this
     re-fetches it fresh, exactly as requested).
  2. Derive this keyword's OWN candidate category name using
     category_namer.categorize_from_metadata() UNCHANGED -- every rule
     (>=2-occurrence, Best/Top, single entity-type, location blocklist +
     LLM cleanup) is identical to pass 1, nothing is re-implemented here.
  3. NEW in this pass: check that candidate against every category
     already created SO FAR (in-memory list, growing one row at a time)
     via a strict, intent-based LLM match. If it's genuinely the same
     specific topic (or a synonym) as one already created, REUSE that
     name instead of creating a near-duplicate.

After every row is (re)decided, categories are re-clustered once
(cluster_grouper.py, unchanged) and the sheet's Category + Cluster
columns are overwritten. Top 3 URLs (JSON), Landing/Blog Page, and
Informational/Commercial Page are left exactly as pass 1 wrote them.

Run from the `backend/` directory (after run_experiment.py has already
populated the sheet):
    python -m scripts.exp_category_pipeline.sequential_recategorize \\
        --input "datasets/its category test 14 july - Sheet1.csv" --in-place
"""

import argparse
import csv
import json
import os
import shutil
import sys
import time

from openai import OpenAI, APIConnectionError, APITimeoutError, RateLimitError
from dotenv import load_dotenv

from scripts.exp_category_pipeline import metadata_fetch
from scripts.exp_category_pipeline import category_namer
from scripts.exp_category_pipeline import cluster_grouper

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
MAX_LLM_RETRIES = 3
LLM_RETRY_BACKOFF_SECONDS = 3

DEFAULT_INPUT = "/Users/manish/Backend/backend/datasets/its category test 14 july - Sheet1.csv"

_MATCH_SYSTEM_PROMPT = (
    "You are grouping webpage topics into categories for an SEO keyword taxonomy. "
    "Two topics being in the same BROAD subject area is NOT enough to merge them -- "
    "they must be the SAME SPECIFIC topic. For example, 'private schools' and "
    "'international schools' are different specific types within the same broad "
    "'schools' theme -- keep them SEPARATE even though related, unless the pages show "
    "they're really about the exact same specific topic.\n\n"
    "This also applies to CONTENT TYPE, not just subject: a general listing/directory "
    "topic (e.g. 'international schools') is DIFFERENT from an informational content "
    "topic about the same subject (e.g. 'benefits of international schools', 'how to "
    "choose') -- these serve a different search intent and must stay separate even "
    "though the underlying subject overlaps.\n\n"
    "The one exception: judge by INTENT for genuine SYNONYMS of the same specific "
    "concept -- 'premium' and 'luxury' options ARE the same category (both mean "
    "high-end), and 'affordable'/'cheap'/'budget' are the same low-cost concept. That "
    "is different from merging two distinct topics or content types just because "
    "they're thematically related.\n\n"
    "If a new topic is genuinely the SAME specific topic AND content type (or a "
    "synonym of it) as an existing category, respond with ONLY that exact existing "
    "category name, copied exactly as written. If it's a different specific topic or "
    "content type -- even if related -- respond with exactly: NONE"
)


def get_openai_client():
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set. Fill it in in .env.")
    return OpenAI(api_key=OPENAI_API_KEY)


_GENERALIZED_MATCH_SYSTEM_PROMPT = (
    "You are doing a SECOND, more lenient pass at grouping SEO keyword "
    "topics into categories -- a stricter first pass already checked "
    "this candidate against the same list of existing categories and "
    "found no exact match, because the specific topics didn't line up "
    "word-for-word.\n\n"
    "Your job now: look past minor differences and decide if this "
    "candidate is still, at its core, the SAME general subject and the "
    "SAME searcher intent as one of the existing categories -- just "
    "phrased with a different modifier, qualifier, audience, or "
    "format, or carrying a few extra/missing incidental words that "
    "don't change the actual topic. If so, reuse that existing category "
    "instead of treating this as a new topic.\n\n"
    "Examples of differences you SHOULD now treat as the same category: "
    "a narrower audience or sub-group of the same subject (e.g. "
    "\"international schools\" and \"international private schools\"), "
    "a synonym or near-synonym qualifier (e.g. \"fees\" and \"tuition "
    "fees\", \"admissions\" and \"enrollment\"), incidental extra words "
    "that don't add a new specific qualifier (e.g. \"schools\" and "
    "\"schools facilities admission\" are the SAME plain-schools topic if "
    "neither names a specific board/type), or a different surface "
    "wording of the same underlying question or goal.\n\n"
    "Still keep them SEPARATE if the searcher's actual goal, or a "
    "specific named qualifier (a school board like CBSE/ICSE/IB, a school "
    "stage like preschool, a distinct content type like a comparison list "
    "vs. a single-page profile), is genuinely different -- even under "
    "this more lenient pass.\n\n"
    "IMPORTANT -- never merge just to swap the business/entity-type word: "
    "'company', 'agency', 'service', 'firm', and 'provider' (singular or "
    "plural) are NOT interchangeable for this pass, even though they're "
    "the same general kind of subject. Only treat them as the same "
    "category if the existing category uses the SAME entity-type word as "
    "the candidate, or has no entity-type word at all.\n\n"
    "If this candidate is really the same general subject and intent as "
    "one of the existing categories, respond with ONLY that exact "
    "existing category name, copied exactly as written. Otherwise "
    "respond with exactly: NONE"
)


def _match_against_existing(system_prompt, candidate_name, documents, existing_category_names):
    """Shared retry/parse plumbing for both the strict and generalized
    match passes below -- only the system prompt (how lenient the
    judgment is) differs between them."""
    if not existing_category_names:
        return None

    client = get_openai_client()
    category_list = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(existing_category_names))
    docs_block = "\n".join(f"- {d}" for d in documents if d)
    user_prompt = (
        f"Existing categories:\n{category_list}\n\n"
        f'New topic candidate: "{candidate_name}"\n'
        f"Based on these pages:\n{docs_block}"
    )

    last_error = None
    for attempt in range(1, MAX_LLM_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model=OPENAI_CHAT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0,
                max_tokens=20,
            )
            answer = resp.choices[0].message.content.strip().strip('"')
            break
        except (RateLimitError, APIConnectionError, APITimeoutError) as e:
            last_error = e
            if attempt < MAX_LLM_RETRIES:
                time.sleep(LLM_RETRY_BACKOFF_SECONDS * attempt)
    else:
        print(f"  [MATCH ERROR] LLM call failed after retries: {last_error}")
        return None

    if answer.upper() == "NONE":
        return None
    for name in existing_category_names:
        if name.strip().lower() == answer.strip().lower():
            return name
    return None


def find_matching_category(candidate_name, documents, existing_category_names):
    """Strict, intent-based match against categories already created
    EARLIER in this same sequential run. Returns the existing category
    name to reuse, or None if this candidate is genuinely a new topic.
    This is the ONE step in this whole experimental pipeline where one
    keyword's result depends on another's -- why this pass runs single-
    worker, sequentially, unlike pass 1."""
    return _match_against_existing(_MATCH_SYSTEM_PROMPT, candidate_name, documents, existing_category_names)


def find_matching_category_generalized(candidate_name, documents, existing_category_names):
    """Second-pass, more lenient match -- only ever called AFTER
    find_matching_category() above has already found no match. Willing
    to generalize away a minor modifier/qualifier or a few incidental
    extra/missing words when the core subject and searcher intent are
    really the same, so near-duplicate categories (e.g. "schools
    facilities" vs "schools fee admission facilities" for the same plain
    schools topic) don't pile up just because each keyword's own top-3
    pages happened to surface a slightly different word set."""
    return _match_against_existing(_GENERALIZED_MATCH_SYSTEM_PROMPT, candidate_name, documents, existing_category_names)


def _extract_keyword(row):
    normalized = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k is not None}
    return (
        normalized.get("keywords") or normalized.get("keyword")
        or normalized.get("search keyword") or normalized.get("query") or ""
    )


def run_sequential_pass(input_path, output_path=None, limit=None, in_place=False):
    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    if "Top 3 URLs (JSON)" not in fieldnames:
        print("Error: input sheet has no 'Top 3 URLs (JSON)' column -- run run_experiment.py first.")
        sys.exit(1)

    process_rows = rows[:limit] if limit else rows
    total = len(process_rows)

    print(f"\n{'='*70}")
    print("SEQUENTIAL re-categorization pass (single worker -- refers to categories made so far)")
    print(f"Input   : {input_path}")
    print(f"Rows    : {total}")
    print(f"{'='*70}\n")

    existing_category_names = []  # grows one row at a time, in order
    t0 = time.time()

    for i, row in enumerate(process_rows, start=1):
        keyword = _extract_keyword(row)
        if not keyword:
            continue

        raw_top3 = (row.get("Top 3 URLs (JSON)") or "").strip()
        try:
            top3 = json.loads(raw_top3) if raw_top3 else []
        except json.JSONDecodeError:
            top3 = []

        if not top3:
            print(f"[{i}/{total}] SKIP '{keyword}' -- no stored top-3 results")
            row["Category"] = ""
            continue

        print(f"[{i}/{total}] '{keyword}' -- re-fetching metadata...")
        top3_metadata = metadata_fetch.fetch_top3_metadata(top3)

        documents = []
        for m in top3_metadata:
            if not m:
                continue
            text = " ".join(filter(None, [m.get("title"), m.get("meta_description")]))
            if text.strip():
                documents.append(text)

        candidate_name = category_namer.categorize_from_metadata(keyword, top3_metadata)
        if not candidate_name:
            print(f"[{i}/{total}] '{keyword}' -> no usable metadata, leaving Category blank")
            row["Category"] = ""
            continue

        count_documents = documents + [keyword]
        matched = find_matching_category(candidate_name, count_documents, existing_category_names)
        match_kind = "strict"

        if not matched:
            matched = find_matching_category_generalized(candidate_name, count_documents, existing_category_names)
            match_kind = "generalized"

        if matched:
            print(f"[{i}/{total}] '{keyword}' -> matched existing category ({match_kind}): {matched!r} "
                  f"(candidate was {candidate_name!r})")
            row["Category"] = matched
        else:
            print(f"[{i}/{total}] '{keyword}' -> NEW category: {candidate_name!r}")
            existing_category_names.append(candidate_name)
            row["Category"] = candidate_name

    print(f"\nSequential pass complete in {time.time() - t0:.1f}s -- "
          f"{len(existing_category_names)} distinct categories created.")

    # --- Cluster once, over the final category set, same as pass 1 ---
    all_categories = [r.get("Category", "") for r in process_rows if r.get("Category")]
    assignment = cluster_grouper.cluster_categories(
        all_categories,
        location_words=category_namer._LOCATION_WORDS,
        extra_stopwords=category_namer._FILLER_WORDS,
    )
    print(f"Clustered {len(assignment)} categories into {len(set(assignment.values()))} clusters.\n")

    for row in process_rows:
        category = row.get("Category", "")
        row["Cluster"] = assignment.get(category, "") if category else ""

    print(f"{'='*70}")
    print("RESULTS")
    print(f"{'='*70}")
    for row in process_rows:
        keyword = _extract_keyword(row)
        print(f"- {keyword!r}")
        print(f"    Category : {row.get('Category') or '(none)'}")
        print(f"    Cluster  : {row.get('Cluster') or '(none)'}")
    print(f"{'='*70}\n")

    if in_place:
        output_path = input_path
        backup_path = input_path + ".bak2"
        shutil.copyfile(input_path, backup_path)
        print(f"Backed up sheet to {backup_path}")
    elif not output_path:
        base_name = os.path.splitext(input_path)[0]
        output_path = f"{base_name}_seq_recategorized.csv"

    with open(output_path, "w", newline="", encoding="utf-8-sig") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done -- wrote {len(rows)} row(s) to {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Sequential, cross-referencing second pass over an already-processed sheet")
    parser.add_argument("--input", type=str, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--in-place", action="store_true",
                         help="Overwrite --input itself (backs up to <input>.bak2 first)")
    parser.add_argument("--limit", type=int, default=None, help="Only re-process the first N rows")
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    if not os.path.exists(input_path):
        print(f"Error: input file not found at {input_path}")
        sys.exit(1)

    run_sequential_pass(input_path, output_path=args.output, limit=args.limit, in_place=args.in_place)


if __name__ == "__main__":
    main()
