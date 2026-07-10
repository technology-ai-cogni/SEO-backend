"""
add_target_type_and_region.py

Standalone, deterministic (NO LLM) enrichment script for keyword_categories.csv.

Adds two columns, computed purely from data already sitting in each row's
`meta` JSON column (the top-3 SERP url/title pairs + search_region) -- it
does NOT re-fetch anything from the web:

    Target Type -- majority vote across the 3 top-3 results of:
                     "Landing Page" | "Blog Page" | "Topical Blog Page"
    Region      -- human-readable country name derived from
                     meta.search_region (e.g. "in" -> "India")

Classification rule per single (url, title) result:
    - No blog-ish path segment in the URL at all              -> Landing Page
    - Blog-ish path segment present, but looks like a generic
      index/category page (short slug, no specific topic)     -> Blog Page
    - Blog-ish path segment present AND the slug is long/
      specific, OR the title reads like a listicle/how-to
      (e.g. "10 Tips...", "How to...", "Guide to...")          -> Topical Blog Page

The 3 per-result classifications are then combined via majority vote
(2-of-3 wins). If all three disagree (1-1-1), a deterministic tie-break
is used: Topical Blog Page > Blog Page > Landing Page (the more specific
signal wins over "not sure").

OVERRIDE: any keyword whose Best/Top rule fired (meta.best_top_applied is
true, or its category name starts with "Best/Top") is ALWAYS forced to
"Blog Page" -- a "best X" / "top X" search intent is a listicle-style
query, so its result is treated as a blog page regardless of what the
per-result URL/title classification would otherwise say.

Usage:
    python add_target_type_and_region.py keyword_categories.csv
    python add_target_type_and_region.py keyword_categories.csv -o output.csv
"""

import argparse
import csv
import json
import re
from collections import Counter
from urllib.parse import urlparse

# Same blog-path vocabulary as category_checker.py, kept in sync manually --
# these are the URL path segments that signal "this is content, not a
# static landing/service page".
BLOG_PATH_HINTS = [
    "blog", "blogs", "article", "articles", "news", "post", "posts",
    "insights", "resources", "guide", "guides",
]

# A blog-ish result whose TITLE matches one of these patterns reads like a
# specific piece of content (a listicle, a how-to, a comparison) rather
# than a generic blog index/category page -- even if the URL slug itself
# is short.
TOPICAL_TITLE_PATTERN = re.compile(
    r"^\s*\d+\s+|\bhow to\b|\bguide to\b|\btips\b|\bvs\.?\b|\bwhy\b|\bwhat is\b|\bbenefits of\b|\bpros and cons\b",
    re.IGNORECASE,
)

# Minimum number of "words" in the blog-hint segment (and anything after
# it) for the URL slug ALONE to count as "specific" (a real article) --
# below this, it's treated as an index/category page unless the title
# rescues it via TOPICAL_TITLE_PATTERN above.
SPECIFIC_SLUG_MIN_WORDS = 4

LANDING = "Landing Page"
BLOG = "Blog Page"
TOPICAL = "Topical Blog Page"

TIE_BREAK_PRIORITY = [TOPICAL, BLOG, LANDING]


def classify_single_result(url, title):
    """Classify ONE (url, title) SERP result into Landing / Blog / Topical."""
    if not url:
        return None

    path = urlparse(url).path.lower()
    segments = [s for s in path.split("/") if s]

    hint_index = None
    for i, seg in enumerate(segments):
        if any(hint in seg for hint in BLOG_PATH_HINTS):
            hint_index = i
            break

    if hint_index is None:
        return LANDING

    # Gather every "word" from the blog-hint segment onward (hyphen/
    # underscore-split) to judge whether the slug is a specific article
    # or just a shallow index/category page.
    slug_words = []
    for seg in segments[hint_index:]:
        slug_words.extend(w for w in re.split(r"[-_]+", seg) if w)

    has_specific_slug = len(slug_words) >= SPECIFIC_SLUG_MIN_WORDS
    title_reads_topical = bool(TOPICAL_TITLE_PATTERN.search(title or ""))

    if has_specific_slug or title_reads_topical:
        return TOPICAL
    return BLOG


def majority_target_type(top3):
    """Majority vote across up to 3 results. Deterministic tie-break if
    there's no clear majority (e.g. 1-1-1)."""
    types = [classify_single_result(r.get("url"), r.get("title")) for r in top3]
    types = [t for t in types if t is not None]

    if not types:
        return None

    counts = Counter(types)
    max_count = max(counts.values())
    winners = [t for t, c in counts.items() if c == max_count]

    if len(winners) == 1:
        return winners[0]

    for candidate in TIE_BREAK_PRIORITY:
        if candidate in winners:
            return candidate
    return types[0]


def is_best_top_row(meta, category):
    """True if this keyword's Best/Top business rule fired -- checked via
    BOTH the meta flag (authoritative when present) and the category
    name's "Best/Top" prefix (fallback, in case meta is missing/older)."""
    if meta and meta.get("best_top_applied"):
        return True
    if category and category.strip().lower().startswith("best/top"):
        return True
    return False


# --- Region -------------------------------------------------------------

_PYCOUNTRY_AVAILABLE = True
try:
    import pycountry
except ImportError:
    _PYCOUNTRY_AVAILABLE = False


def region_display_name(search_region_code):
    """Turn a 2-letter SERP region code (e.g. 'in') into a human-readable
    country name (e.g. 'India'). Falls back to the raw uppercased code if
    pycountry isn't installed or the code isn't recognized."""
    if not search_region_code:
        return ""

    code = search_region_code.strip()
    if not code:
        return ""

    if _PYCOUNTRY_AVAILABLE:
        try:
            country = pycountry.countries.get(alpha_2=code.upper())
            if country:
                return country.name
        except Exception:
            pass

    return code.upper()


# --- Main enrichment pass ------------------------------------------------

def enrich(input_path, output_path):
    with open(input_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    # Insert the two new columns right after "cluster" if present,
    # otherwise just append them at the end.
    new_fieldnames = list(fieldnames)
    for col in ("Target Type", "Region"):
        if col in new_fieldnames:
            continue
        if "cluster" in new_fieldnames:
            insert_at = new_fieldnames.index("cluster") + 1
            new_fieldnames.insert(insert_at, col)
        else:
            new_fieldnames.append(col)

    target_type_counts = Counter()
    region_counts = Counter()
    parse_errors = 0

    for row in rows:
        meta_raw = row.get("meta")
        meta = None
        if meta_raw:
            try:
                meta = json.loads(meta_raw)
            except (json.JSONDecodeError, TypeError):
                parse_errors += 1
                meta = None

        if meta:
            if is_best_top_row(meta, row.get("category")):
                # "Best X" / "Top X" queries are listicle-style by
                # definition -- always a blog page, regardless of what
                # the per-result URL/title classification would say.
                target_type = BLOG
            else:
                top3 = meta.get("top3") or []
                target_type = majority_target_type(top3) or ""
            region = region_display_name(meta.get("search_region"))
        else:
            target_type = ""
            region = ""

        row["Target Type"] = target_type
        row["Region"] = region

        if target_type:
            target_type_counts[target_type] += 1
        if region:
            region_counts[region] += 1

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=new_fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {output_path}")
    print(f"Target Type breakdown: {dict(target_type_counts)}")
    print(f"Region breakdown: {dict(region_counts)}")
    if parse_errors:
        print(f"WARNING: {parse_errors} row(s) had unparseable meta JSON -- left blank")


def main():
    parser = argparse.ArgumentParser(description="Add Target Type and Region columns to a keyword_categories.csv export.")
    parser.add_argument("input_csv", help="Path to the input keyword_categories.csv")
    parser.add_argument("-o", "--output", default=None, help="Output path (default: <input>_enriched.csv)")
    args = parser.parse_args()

    output_path = args.output
    if not output_path:
        if args.input_csv.lower().endswith(".csv"):
            output_path = args.input_csv[:-4] + "_enriched.csv"
        else:
            output_path = args.input_csv + "_enriched.csv"

    enrich(args.input_csv, output_path)


if __name__ == "__main__":
    main()