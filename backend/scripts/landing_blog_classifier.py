"""
landing_blog_classifier.py

LLM-based Landing vs. Blog Page classifier, judged by INTENT rather than
URL path patterns (that deterministic approach -- category_checker.py's
compute_target_type() -- is no longer used here). Classifies each of a
keyword's up-to-3 top SERP results in ONE OpenAI call (given all their
titles/urls at once), then takes a majority vote across them, in code,
to decide the ONE Landing/Blog label for that keyword. Imported and
called by scripts/run_pipeline.py, in the same thread as category
assignment.

Only two labels -- no separate "Topical Blog Page" tier:

  BLOG PAGE     -- the page's job is to LIST, RANK, or COMPARE multiple
                   businesses/options -- a listicle, directory, roundup,
                   or comparison. This includes any "best X" / "top X"
                   page about companies, services, agencies, providers,
                   firms, businesses, vendors, or similar collective/
                   plural business-type words (e.g. "Best Digital
                   Marketing Companies in Delhi", "Top 10 SEO Agencies",
                   "List of Social Media Marketing Providers").

  LANDING PAGE  -- everything else -- a page representing ONE specific
                   business, product, or service directly (a company's
                   own homepage, service page, product page, etc).
"""

import json
import os

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")

LANDING_PAGE = "Landing Page"
BLOG_PAGE = "Blog Page"

SYSTEM_PROMPT = """You classify search result pages by INTENT into exactly one of two types: BLOG PAGE or LANDING PAGE.

BLOG PAGE -- the page's purpose is to LIST, RANK, or COMPARE multiple businesses/options, not represent one business itself. This includes:
- Listing/directory pages of multiple businesses or options
- Any "best X" or "top X" page about companies, services, agencies, providers, firms, businesses, vendors, or similar collective/plural business-type words
- Roundup, comparison, or buying-guide style content covering multiple options

LANDING PAGE -- everything else. A page representing ONE specific business, product, or service directly -- e.g. a company's own homepage, service page, product page, or "about us" page.

Judge by INTENT, using the Title, URL, Meta Description, and H1 tags provided.
- If the Meta Description or H1 implies a list of top/best providers, it's a BLOG PAGE.
- If the Meta Description or H1 describes a single company's own services, it's a LANDING PAGE.

Decide BLOG PAGE or LANDING PAGE for EACH result given, in the same order they're given.

Respond with ONLY valid JSON, in this exact shape:
{"classifications": ["BLOG", "LANDING", ...]}
One entry per result given, in the same order, using only the words BLOG or LANDING (nothing else)."""


def get_openai_client():
    """Deliberately NOT cached at module level -- see category_checker.py's
    get_openai_client() docstring for why (unsafe to reuse a client's
    connection pool across worker threads/processes long-term)."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set. Fill it in in .env.")
    return OpenAI(api_key=OPENAI_API_KEY)


def _classify_titles(items):
    """items: list of rich signals (url, title, meta_description, h1, etc.). 
    Returns a list of LANDING_PAGE/BLOG_PAGE labels, same order/length as items. Falls
    back to LANDING_PAGE for any entry the model doesn't return a clean
    BLOG/LANDING answer for, rather than dropping it."""
    client = get_openai_client()
    
    listing_parts = []
    for i, it in enumerate(items):
        part = f'{i + 1}. Title: "{it.get("title", "")}" | URL: {it.get("url", "")}'
        if it.get("meta_description"):
            part += f'\n   Meta: "{it.get("meta_description", "")}"'
        if it.get("h1"):
            # h1 is typically a list in the extracted signals
            h1_val = it["h1"][0] if isinstance(it["h1"], list) and len(it["h1"]) > 0 else it["h1"]
            part += f'\n   H1: "{h1_val}"'
        listing_parts.append(part)
        
    listing = "\n\n".join(listing_parts)

    resp = client.chat.completions.create(
        model=OPENAI_CHAT_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Classify each of these {len(items)} search results:\n\n{listing}"},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content.strip()
    try:
        parsed = json.loads(raw)
        labels_raw = parsed.get("classifications", [])
    except (json.JSONDecodeError, AttributeError):
        labels_raw = []

    labels = []
    for i in range(len(items)):
        label = str(labels_raw[i]).strip().upper() if i < len(labels_raw) else ""
        if label == "BLOG":
            labels.append(BLOG_PAGE)
        else:
            labels.append(LANDING_PAGE)
    return labels


def classify_landing_or_blog(top3_results):
    """top3_results: list of {"url":..., "title":...} (up to 3, same
    shape serp_scraper.extract_results() returns). Returns LANDING_PAGE
    or BLOG_PAGE -- whichever wins the majority vote across the up-to-3
    results -- or None if there are no usable (titled) results. A tie
    (only possible with exactly 2 usable results) breaks toward
    BLOG_PAGE."""
    items = [r for r in (top3_results or []) if r and r.get("title")]
    if not items:
        return None

    labels = _classify_titles(items)

    blog_count = labels.count(BLOG_PAGE)
    landing_count = labels.count(LANDING_PAGE)

    if blog_count >= landing_count:
        return BLOG_PAGE
    return LANDING_PAGE


def force_blog_if_best_top(category, target_type):
    """HARD override, called AFTER category and target_type have both
    already been independently computed: if `category` starts with
    "Best/Top" (case-insensitive), `target_type` is unconditionally
    forced to BLOG_PAGE, regardless of whatever the LLM-based
    classification above (or the Selenium engine's own
    exp_category_pipeline/classifiers.py) actually decided. Any other
    category leaves `target_type` untouched."""
    if category and category.strip().lower().startswith("best/top"):
        return BLOG_PAGE
    return target_type
