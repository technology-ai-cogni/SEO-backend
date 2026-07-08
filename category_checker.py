"""
Core category-clustering logic: fetch top-3 organic titles for a keyword
from Bright Data's SERP zone, then derive/match a category name via OpenAI.

Categories are read from and written to Postgres (db.py) rather than a
local JSON file, so they stay consistent when driven by an RQ worker.
IMPORTANT: run only ONE category worker process at a time. Category
assignment is inherently sequential (each decision depends on categories
already created by prior keywords in the same domain).

Clustering is a SEPARATE, deterministic, non-LLM step that runs once per
job -- AFTER every keyword in that job has been categorized -- over the
domain's ENTIRE category list. See cluster_all_categories() at the bottom.
"""

import os
import re
import time
from collections import Counter
from urllib.parse import quote, urlparse

import requests
import pycountry
from bs4 import BeautifulSoup
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

BRIGHTDATA_API_KEY = os.environ.get("BRIGHTDATA_API_KEY")
BRIGHTDATA_SERP_ZONE = os.environ.get("BRIGHTDATA_SERP_ZONE", "serp_api1")
BRIGHTDATA_REQUEST_URL = "https://api.brightdata.com/request"

GOOGLE_DOMAIN = "www.google.com"
COUNTRY_CODE = os.environ.get("SERP_COUNTRY", "in")
LANGUAGE_CODE = os.environ.get("SERP_LANGUAGE", "en")

REQUEST_TIMEOUT = 60
MAX_REQUEST_RETRIES = 3
RETRY_BACKOFF_SECONDS = 4

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")

BLOG_PATH_HINTS = [
    "blog", "blogs", "article", "articles", "news", "post", "posts",
    "insights", "resources", "guide", "guides",
]


def _build_location_word_blocklist():
    """Every word that's part of a real country or state/province/region
    name (via pycountry's actual ISO databases, not a hardcoded list),
    plus a generic demonym guess for each country (India -> Indian, Korea
    -> Korean -- countries ending in a vowel commonly adjective-ize by
    adding 'n'/'an'; irregular demonyms like France -> French aren't
    covered, this is a best-effort suffix rule, not a lookup table).
    Used to keep category/cluster names describing the TOPIC, not a
    country/region/state -- deliberately does NOT include cities (no
    reliable non-hardcoded source for those)."""
    words = set()
    for country in pycountry.countries:
        for attr in ("name", "official_name", "common_name"):
            name = getattr(country, attr, None)
            if not name:
                continue
            for w in re.findall(r"[A-Za-z]+", name.lower()):
                if len(w) <= 2:
                    continue
                words.add(w)
                if w[-1] in "aeiou":
                    words.add(w + "n")
                words.add(w + "an")
    for subdivision in pycountry.subdivisions:
        for w in re.findall(r"[A-Za-z]+", subdivision.name.lower()):
            if len(w) > 2:
                words.add(w)
    return words


_LOCATION_WORDS = _build_location_word_blocklist()


def resolve_country_code(country_input):
    """
    Resolve a user-typed country name (or an already-2-letter code) into
    Google's region code (ISO 3166-1 alpha-2, lowercase) for the SERP
    `gl` parameter. Returns None if it can't be resolved.
    """
    if not country_input:
        return None
    country_input = country_input.strip()
    if not country_input:
        return None

    if len(country_input) == 2 and country_input.isalpha():
        return country_input.lower()

    try:
        result = pycountry.countries.lookup(country_input)
        return result.alpha_2.lower()
    except LookupError:
        pass

    try:
        results = pycountry.countries.search_fuzzy(country_input)
        if results:
            return results[0].alpha_2.lower()
    except LookupError:
        pass

    return None


def get_openai_client():
    """Deliberately NOT cached at module level -- a persistent OpenAI
    client wraps an httpx connection pool, which is the same class of
    object (open sockets, SSL state, pool locks) that turned out to be
    unsafe to reuse across RQ's forked work-horse processes for
    rank_checker.py's requests.Session (see that module's docstring).
    Always build a fresh, short-lived client right where it's used."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set. Fill it in in .env.")
    return OpenAI(api_key=OPENAI_API_KEY)


def _brightdata_fetch(target_url):
    if not BRIGHTDATA_API_KEY:
        raise RuntimeError("BRIGHTDATA_API_KEY is not set. Fill it in in .env.")

    payload = {"zone": BRIGHTDATA_SERP_ZONE, "url": target_url, "format": "raw"}
    headers = {
        "Authorization": f"Bearer {BRIGHTDATA_API_KEY}",
        "Content-Type": "application/json",
    }

    resp = None
    last_error = None
    for attempt in range(1, MAX_REQUEST_RETRIES + 1):
        try:
            resp = requests.post(
                BRIGHTDATA_REQUEST_URL, headers=headers, json=payload, timeout=REQUEST_TIMEOUT
            )
            resp.raise_for_status()
            last_error = None
            break
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_error = e
            if attempt < MAX_REQUEST_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)))
        except requests.exceptions.HTTPError as e:
            last_error = e
            status = e.response.status_code if e.response is not None else None
            if status in (429, 500, 502, 503, 504) and attempt < MAX_REQUEST_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)))
            else:
                break
        except Exception as e:
            last_error = e
            break

    if last_error is not None or resp is None:
        return None

    content_type = resp.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            html = resp.json().get("body", "")
        except Exception:
            return None
    else:
        html = resp.text

    return html or None


def get_top3_for_category(keyword, country_code=None):
    """Dedicated search: fetch top 3 organic results (url + title, title
    taken straight from the SERP's h3 text -- no per-page fetches needed).
    `country_code` overrides the .env default SERP_COUNTRY for this search
    (e.g. "in", "us", "sg") -- resolved from a user-typed country name via
    resolve_country_code()."""
    gl = country_code or COUNTRY_CODE
    search_url = f"https://{GOOGLE_DOMAIN}/search?q={quote(keyword)}&gl={gl}&hl={LANGUAGE_CODE}"
    html = _brightdata_fetch(search_url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    container = soup.find("div", id="rso") or soup.find("div", id="search")
    if container is None:
        return []

    results, seen = [], set()
    for a in container.find_all("a", href=True):
        h3 = a.find("h3")
        if h3 is None:
            continue
        href = a["href"]
        if not href.startswith("http"):
            continue
        if "google." in href or "gstatic." in href or "googleapis." in href:
            continue
        if href in seen:
            continue
        title = h3.get_text(strip=True)
        if not title:
            continue
        seen.add(href)
        results.append({"url": href, "title": title})
        if len(results) >= 3:
            break

    return results


def classify_page_type(url):
    path = urlparse(url).path.lower()
    segments = [s for s in path.split("/") if s]
    for seg in segments:
        for hint in BLOG_PATH_HINTS:
            if hint in seg:
                return "blog"
    return "landing"


def build_majority_titles(top3):
    """
    Return all titles from the top-3 results, unmodified.

    NOTE: this previously filtered down to whichever of "blog" vs
    "landing" page type won a 2-of-3 majority vote by URL path -- that
    filtering was discarding the single most on-topic result in real
    cases (e.g. a highly relevant blog post losing 2-1 to two generic
    landing pages just because of URL structure, not actual relevance).
    Removed: all 3 titles are always used now.
    """
    return [r["title"] for r in top3], "all"


def _title_word_set(title):
    """Lowercased word tokens from one title -- pure numbers (e.g. "10",
    "100" from something like "Top 10 Agencies") are never included; a
    category/cluster name should be made of real words, not digits."""
    return {w.lower() for w in re.findall(r"[A-Za-z0-9]+", title) if not w.isdigit()}


def _common_words_across_titles(titles, min_titles=2):
    """Words appearing in at least `min_titles` of the given titles
    (case-insensitive -- 'Companies' and 'companies' count as the same
    word). A word that only shows up in a single title never qualifies,
    no matter how salient it looks in isolation. Country/region/state
    words are never eligible, even if common to every title -- a
    category/cluster should describe the TOPIC, not a location. Returned
    in the order each word first appears when reading through the titles
    in order, so joining them reads naturally rather than as a random
    word list."""
    required = min(min_titles, len(titles)) if titles else min_titles
    counts = Counter()
    for title in titles:
        for w in _title_word_set(title):
            counts[w] += 1

    qualifying = {
        w for w, c in counts.items()
        if c >= required and w not in _LOCATION_WORDS
        and w not in _STOPWORDS and w not in _RANKING_WORDS
    }

    order, seen = [], set()
    for title in titles:
        for w in re.findall(r"[A-Za-z0-9]+", title.lower()):
            if w in qualifying and w not in seen:
                seen.add(w)
                order.append(w)
    return order


# --- Hardcoded Best/Top rule ------------------------------------------
# Deliberately deterministic, not LLM-judged. Rule: the FIRST title
# deciding it alone if it contains "best"/"top"; if the first title
# doesn't, then EVERY one of the other titles must contain "best"/"top"
# for the tag to apply (a single stray mention in one of the other two
# isn't enough).

def _title_has_best_or_top(title):
    words = set(re.findall(r"[a-z]+", title.lower()))
    return "best" in words or "top" in words


def _titles_contain_best_or_top(titles):
    if not titles:
        return False
    if _title_has_best_or_top(titles[0]):
        return True
    rest = titles[1:]
    return bool(rest) and all(_title_has_best_or_top(t) for t in rest)


def _apply_best_top_rule(candidate_name, titles):
    """When Best/Top applies, just prefix the category with 'Best/Top ' --
    singular vs. plural is NEVER forced here. Whatever plurality the
    common words naturally had in the source titles (e.g. titles actually
    saying "Companies" vs "Company") is what derive_category_name already
    picked up, and that form is preserved exactly as found -- no blind
    grammar-rule pluralization that could mangle a mass noun like
    "marketing" into "marketings"."""
    if not _titles_contain_best_or_top(titles):
        return candidate_name
    words = candidate_name.split()
    if words and words[0].strip().lower() in ("best", "top", "best/top"):
        words = words[1:]
    rest = " ".join(words).strip()
    return f"Best/Top {rest}".strip() if rest else "Best/Top"


def _clean_category_text(text):
    """Strip any leftover punctuation/delimiters (e.g. a stray '|' from a
    title like 'Page Title | Site Name') and collapse whitespace. Applied
    to every category string right before it's used, regardless of
    whether it came from the model or the fallback extractor."""
    text = re.sub(r"[^A-Za-z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def derive_category_name(titles, keyword=None):
    """
    Build a category name from words COMMON to at least 2 of the 3
    fetched titles (case-insensitive -- 'Companies' and 'companies' are
    the same word for this purpose). Deliberately includes AS MANY of
    those qualifying words as can still read as one coherent, natural
    phrase -- this is not a minimal 2-3 word summary, it's the maximum
    shared vocabulary. A word appearing in only one title never
    qualifies, however salient it looks in isolation. Also instructed to
    exclude any city/state/country/region name (categories should
    describe the TOPIC, not the location) -- enforced via prompt
    instruction since a hardcoded place-name list can't generalize to
    "any" location worldwide.

    `keyword`, if given, is folded in as a 4th "title" for this same
    common-word count -- NOT a real 4th SERP fetch, just the original
    search keyword text counted alongside the 3 real titles. So a word
    that appears once in the keyword AND once in any single one of the 3
    titles now qualifies (2 total occurrences across the 4), even though
    it wouldn't have qualified from the 3 real titles alone.

    The result is validated word-by-word afterward against that same
    qualifying set; if the model breaks the word-source rule, its answer
    is discarded and a guaranteed-safe deterministic join (qualifying
    words in first-appearance order) is used instead. The Best/Top rule
    is applied separately, deterministically, after this function
    returns.
    """
    client = get_openai_client()

    count_documents = titles + [keyword] if keyword else titles
    qualifying_words = _common_words_across_titles(count_documents, min_titles=2)
    if not qualifying_words:
        # Nothing is shared by 2+ titles -- fall back to the single most
        # representative title's own words rather than refusing outright.
        qualifying_words = [
            w for w in dict.fromkeys(re.findall(r"[A-Za-z0-9]+", titles[0].lower()))
            if w not in _LOCATION_WORDS and w not in _STOPWORDS
            and w not in _RANKING_WORDS and not w.isdigit()
        ]

    titles_block = "\n".join(f"- {t}" for t in titles)
    allowed_block = ", ".join(qualifying_words)

    system_prompt = (
        "You create SEO category names from webpage titles. Follow these "
        "rules exactly:\n\n"
        f"1. You may ONLY use words from this allowed list (case doesn't "
        f"matter): {allowed_block}\n"
        "Never add, invent, or substitute a word that isn't in that list -- "
        "not even a small connector word like 'is', 'an', 'the', 'of', or "
        "'and'. Only use real, meaningful topic words from the list.\n\n"
        "2. Use AS MANY of the allowed words as you sensibly can while "
        "still reading as one natural, coherent phrase describing the "
        "shared topic across the titles -- this should be the fullest "
        "phrase the allowed words support, not an artificially shortened "
        "one. Only drop a word if including it would make the phrase read "
        "like a random word list rather than a real category name.\n\n"
        "3. Do NOT include any city, state, country, or region name, even "
        "if one is in the allowed list -- the category should describe "
        "the TOPIC, not the location.\n\n"
        "4. Do NOT include any number or digit (e.g. '10', '100'), even if "
        "one is in the allowed list.\n\n"
        "5. Do NOT include ranking words like 'best' or 'top' -- that is "
        "handled separately.\n\n"
        "6. Output ONLY plain words separated by single spaces -- no "
        "punctuation, no pipes, no colons, no quotation marks.\n\n"
        "Respond with ONLY the category name, nothing else."
    )
    user_prompt = f"Titles:\n{titles_block}"

    resp = client.chat.completions.create(
        model=OPENAI_CHAT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
        max_tokens=40,
    )
    candidate = resp.choices[0].message.content.strip().strip('"')

    candidate_words = re.findall(r"[A-Za-z0-9]+", candidate)
    allowed_lower = {w.lower() for w in qualifying_words}
    invalid_words = [w for w in candidate_words if w.lower() not in allowed_lower]

    if invalid_words or not candidate_words:
        fallback = " ".join(w.capitalize() for w in qualifying_words)
        print(f"  [WARNING] Model used word(s) not in the allowed list: {invalid_words} "
              f"-- discarding \"{candidate}\", using safe fallback: \"{fallback}\"")
        return _clean_category_text(fallback)

    return _clean_category_text(candidate)


def find_matching_category(candidate_name, candidate_titles, existing_category_names):
    """
    Ask OpenAI whether candidate_name fits an already-created category.
    Judged by INTENT/topic, not literal word overlap -- e.g. a category
    built around "premium" and one built around "luxury" (or "affordable"
    vs "cheap" vs "budget") should be recognized as the SAME category if
    the titles convey the same underlying intent, even though the exact
    wording differs. Returns the existing category name if matched, else None.
    """
    if not existing_category_names:
        return None

    client = get_openai_client()
    category_list = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(existing_category_names))
    titles_block = "\n".join(f"- {t}" for t in candidate_titles)
    system_prompt = (
        "You are grouping webpage topics into categories for an SEO keyword "
        "taxonomy. Two topics being in the same BROAD subject area is NOT "
        "enough to merge them -- they must be the SAME SPECIFIC topic. For "
        "example, 'private schools' and 'international schools' are "
        "different specific types within the same broad 'schools' theme -- "
        "keep them as SEPARATE categories even though related, unless the "
        "titles show they're really about the exact same specific topic.\n\n"
        "This also applies to CONTENT TYPE, not just subject: a general "
        "listing/directory topic (e.g. \"international schools\") is "
        "DIFFERENT from an informational content topic about the same "
        "subject (e.g. \"benefits of international schools\", \"pros and "
        "cons\", \"how to choose\") -- these serve a different search intent "
        "and must stay separate categories even though the underlying "
        "subject overlaps.\n\n"
        "The one exception: judge by INTENT for genuine SYNONYMS of the same "
        "specific concept -- for example, a topic about \"premium\" options "
        "and one about \"luxury\" options ARE the same category (both mean "
        "high-end/upscale), and 'affordable'/'cheap'/'budget' are the same "
        "low-cost concept. That is different from merging two distinct "
        "topics or content types just because they're thematically related.\n\n"
        "If a new topic is genuinely the SAME specific topic AND content "
        "type (or a synonym of it) as an existing category, respond with "
        "ONLY that exact existing category name, copied exactly as written. "
        "If it's a different specific topic or content type -- even if "
        "related -- respond with exactly: NONE"
    )
    user_prompt = (
        f"Existing categories:\n{category_list}\n\n"
        f'New topic candidate: "{candidate_name}"\n'
        f"Based on these page titles:\n{titles_block}"
    )
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

    if answer.upper() == "NONE":
        return None

    for name in existing_category_names:
        if name.strip().lower() == answer.strip().lower():
            return name
    return None


# --- Target Type (deterministic, NO LLM) ---------------------------------
# Classifies each of the top-3 SERP results as one of:
#   "Landing Page"       -- no blog-ish path segment in the URL at all
#   "Blog Page"           -- blog-ish path segment present, but reads like
#                            a generic index/category page
#   "Topical Blog Page"    -- blog-ish path segment present AND the slug is
#                            long/specific, or the title reads like a
#                            listicle/how-to (an actual article on a
#                            specific topic, not just a blog index)
# then takes a majority vote across the 3, with a deterministic tie-break
# if it's a 1-1-1 split. A Best/Top query is ALWAYS "Blog Page" outright,
# since "best X" / "top X" search intent is listicle-style by definition.

_TARGET_TYPE_TOPICAL_TITLE_PATTERN = re.compile(
    r"^\s*\d+\s+|\bhow to\b|\bguide to\b|\btips\b|\bvs\.?\b|\bwhy\b|\bwhat is\b|\bbenefits of\b|\bpros and cons\b",
    re.IGNORECASE,
)
_TARGET_TYPE_SPECIFIC_SLUG_MIN_WORDS = 4

TARGET_TYPE_LANDING = "Landing Page"
TARGET_TYPE_BLOG = "Blog Page"
TARGET_TYPE_TOPICAL = "Topical Blog Page"
_TARGET_TYPE_TIE_BREAK_PRIORITY = [TARGET_TYPE_TOPICAL, TARGET_TYPE_BLOG, TARGET_TYPE_LANDING]


def _classify_single_target_type(url, title):
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
        return TARGET_TYPE_LANDING

    slug_words = []
    for seg in segments[hint_index:]:
        slug_words.extend(w for w in re.split(r"[-_]+", seg) if w)

    has_specific_slug = len(slug_words) >= _TARGET_TYPE_SPECIFIC_SLUG_MIN_WORDS
    title_reads_topical = bool(_TARGET_TYPE_TOPICAL_TITLE_PATTERN.search(title or ""))

    if has_specific_slug or title_reads_topical:
        return TARGET_TYPE_TOPICAL
    return TARGET_TYPE_BLOG


def _majority_target_type(top3):
    types = [_classify_single_target_type(r.get("url"), r.get("title")) for r in top3]
    types = [t for t in types if t is not None]

    if not types:
        return None

    counts = Counter(types)
    max_count = max(counts.values())
    winners = [t for t, c in counts.items() if c == max_count]

    if len(winners) == 1:
        return winners[0]

    for candidate in _TARGET_TYPE_TIE_BREAK_PRIORITY:
        if candidate in winners:
            return candidate
    return types[0]


def compute_target_type(top3, has_best_top=None):
    """Pure majority vote across the 3 fetched results' page types
    (Landing/Blog/Topical) -- no special-casing for Best/Top; what type
    of page actually ranks is independent of whether the SERP intent
    happens to be a "best/top X" listicle. `has_best_top` is accepted
    only for call-site backward compatibility and ignored."""
    return _majority_target_type(top3)


def region_display_name(search_region_code):
    """2-letter SERP region code (e.g. 'in') -> human-readable country
    name (e.g. 'India'). Falls back to the raw uppercased code if
    pycountry doesn't recognize it."""
    if not search_region_code:
        return None
    code = search_region_code.strip()
    if not code:
        return None
    try:
        country = pycountry.countries.get(alpha_2=code.upper())
        if country:
            return country.name
    except Exception:
        pass
    return code.upper()


def categorize_keyword(keyword, domain, country_code=None):
    """
    Category-only pipeline for one keyword, scoped to `domain`: fetch
    top-3 titles (from the given `country_code`'s Google region, or the
    .env default if not given), derive a candidate category name, apply
    the hardcoded Best/Top rule, match against existing categories in
    this domain (intent-aware), and persist a new category if none matched.

    Also computes target_type and region_name (both deterministic, no
    LLM) from the SAME top-3 SERP results already fetched here, and
    attaches them to `meta` as `computed_target_type` /
    `computed_region_name` for the caller to read off and store.

    NOTE: clustering does NOT happen here anymore -- it's a separate,
    deterministic batch step that runs once per job, after every keyword
    in the job has been categorized. See cluster_all_categories().

    Returns (category, meta) -- category is None if there was no usable
    page data to categorize from. `meta` is always populated (even on
    failure) with the full audit trail: the actual top-3 titles/urls
    fetched, which region was searched, the raw candidate name before the
    Best/Top rule, whether Best/Top fired, and whether this keyword
    matched an already-existing category or created a new one.
    """
    import db  # local import to avoid a hard dependency for callers that
               # only want the pure scraping/naming functions above

    top3 = get_top3_for_category(keyword, country_code)
    titles, majority_type = build_majority_titles(top3)

    search_region = country_code or COUNTRY_CODE

    meta = {
        "top3": [{"url": r["url"], "title": r["title"]} for r in top3],
        "search_region": search_region,
        "majority_type": majority_type,
        "majority_titles_used": titles,
    }

    if not titles:
        meta["computed_target_type"] = None
        meta["computed_region_name"] = region_display_name(search_region)
        return None, meta

    has_best_top = _titles_contain_best_or_top(titles)

    meta["computed_target_type"] = compute_target_type(top3, has_best_top)
    meta["computed_region_name"] = region_display_name(search_region)

    raw_candidate = derive_category_name(titles, keyword)
    candidate_name = _apply_best_top_rule(raw_candidate, titles)
    meta["raw_candidate_before_best_top_rule"] = raw_candidate
    meta["best_top_applied"] = candidate_name != raw_candidate

    # Only compare against existing categories that have the SAME Best/Top
    # status -- otherwise a "Best/Top ..." candidate could get silently
    # merged into a plain existing category (or vice versa), losing the
    # Best/Top tag that this specific keyword's titles actually signaled.
    existing_category_names = [
        name for name in db.list_category_names(domain)
        if name.lower().startswith("best/top") == has_best_top
    ]
    matched_category = find_matching_category(candidate_name, titles, existing_category_names)

    if matched_category:
        meta["matched_existing_category"] = True
        meta["candidate_before_match"] = candidate_name
        return matched_category, meta

    meta["matched_existing_category"] = False
    db.add_category(domain, candidate_name)
    return candidate_name, meta


# --- Clustering (deterministic, batch, NO LLM) ---------------------------
# Runs once per job, AFTER every keyword in that job has been categorized,
# over the domain's ENTIRE category list (not just this job's categories --
# a full recompute keeps clustering consistent as new categories arrive).
#
# Algorithm: repeatedly find the single (normalized) word shared by the
# MOST remaining (not-yet-clustered) categories -- that anchor word's
# whole group of categories is then labeled using EVERY word shared by at
# least 2 of them (not just the one anchor word), so the cluster name
# uses the maximum common vocabulary those categories actually have, not
# a single-word stub. "Best"/"Top" are never eligible (already tagged at
# the category level, not the cluster level), and singular/plural forms
# of the same word (Agency/Agencies, Company/Companies, ...) are treated
# as identical, case-insensitively. Categories that share no word with
# anything else become their own single-category cluster. This never
# invents vocabulary -- every cluster name is built only from words that
# literally appear in the categories it contains.

_STOPWORDS = {
    "a", "an", "the", "in", "of", "on", "at", "to", "for", "and", "or",
    "with", "by", "is", "are", "vs", "your", "you",
}
# "best"/"top" are excluded separately, only where the caller wants them
# excluded (cluster words always; category qualifying-words too, since
# the Best/Top tag is applied by its own deterministic rule, not as
# regular category vocabulary).
_RANKING_WORDS = {"best", "top"}


def _singularize_word(word):
    """Naive, generic plural -> singular normalization (suffix rules
    only, no hardcoded word list) so 'Agency'/'Agencies' or
    'Company'/'Companies' are treated as the SAME word when clustering."""
    w = word.lower()
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("ches", "shes", "xes", "ses", "zes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def _cluster_significant_words(category_name):
    words = re.findall(r"[A-Za-z0-9]+", category_name.lower())
    return {
        _singularize_word(w) for w in words
        if w not in _STOPWORDS and w not in _RANKING_WORDS
        and w not in _LOCATION_WORDS and not w.isdigit() and len(w) > 2
    }


def _display_form(norm_word, matched_categories):
    """Pick the most common literal surface form (actual casing +
    plurality) of `norm_word` as it appears across `matched_categories`,
    so the label reads naturally instead of showing the normalized stem."""
    forms = Counter()
    for cat in matched_categories:
        for raw in re.findall(r"[A-Za-z0-9]+", cat.lower()):
            if _singularize_word(raw) == norm_word:
                forms[raw] += 1
    return forms.most_common(1)[0][0] if forms else norm_word


def cluster_all_categories(domain):
    """
    Deterministic greedy clustering over every category currently in this
    domain. Returns {category_name: cluster_name} covering ALL of them.
    """
    import db

    categories = db.list_category_names(domain)
    remaining = {cat: _cluster_significant_words(cat) for cat in categories}
    assignment = {}

    while remaining:
        freq = {}
        for words in remaining.values():
            for w in words:
                freq[w] = freq.get(w, 0) + 1

        max_freq = max(freq.values()) if freq else 0

        if max_freq <= 1:
            # Nothing left shares a word with anything else -- each
            # remaining category becomes its own cluster.
            for cat in list(remaining.keys()):
                assignment[cat] = cat
                del remaining[cat]
            break

        # Tie-break deterministically: alphabetically first among the
        # most-common words.
        chosen_word = sorted(w for w, c in freq.items() if c == max_freq)[0]
        matched = [cat for cat, words in remaining.items() if chosen_word in words]

        # Maximum common words label: every normalized word shared by a
        # MAJORITY of the matched categories (chosen_word always qualifies
        # by construction, since its count == len(matched)) -- a flat
        # ">=2" bar was letting the label balloon into a union of many
        # only-weakly-shared words on larger groups (e.g. one pair
        # sharing "media", a different pair sharing "services", a
        # different pair sharing "ncr" -- none of which is actually
        # common across the group as a whole). Requiring majority keeps
        # every word in the label genuinely representative of most (not
        # just some) of the categories it's applied to. Ordered by where
        # each word typically sits in the original category text so the
        # phrase reads naturally.
        threshold = (len(matched) + 1) // 2  # majority, rounded up
        shared_counts = {}
        for cat in matched:
            for w in remaining[cat]:
                shared_counts[w] = shared_counts.get(w, 0) + 1
        shared_words = {w for w, c in shared_counts.items() if c >= threshold} or {chosen_word}

        position_totals, position_counts = {}, {}
        for cat in matched:
            tokens = [_singularize_word(t) for t in re.findall(r"[A-Za-z0-9]+", cat.lower())]
            for idx, t in enumerate(tokens):
                if t in shared_words:
                    position_totals[t] = position_totals.get(t, 0) + idx
                    position_counts[t] = position_counts.get(t, 0) + 1

        ordered_words = sorted(
            shared_words,
            key=lambda w: position_totals.get(w, 0) / position_counts.get(w, 1),
        )
        cluster_label = " ".join(_display_form(w, matched).title() for w in ordered_words)

        for cat in matched:
            assignment[cat] = cluster_label
            del remaining[cat]

    return assignment
