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
from urllib.parse import quote, urlparse

import requests
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

_client = None


def get_openai_client():
    global _client
    if _client is None:
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set. Fill it in in .env.")
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


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


def get_top3_for_category(keyword):
    """Dedicated search: fetch top 3 organic results (url + title, title
    taken straight from the SERP's h3 text -- no per-page fetches needed)."""
    search_url = f"https://{GOOGLE_DOMAIN}/search?q={quote(keyword)}&gl={COUNTRY_CODE}&hl={LANGUAGE_CODE}"
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
    """Given up to 3 {"url","title"} results, return the majority-type
    (blog vs landing) titles to use for category derivation."""
    pages = [
        {"url": r["url"], "title": r["title"], "type": classify_page_type(r["url"])}
        for r in top3
    ]
    if not pages:
        return []

    blog_pages = [p for p in pages if p["type"] == "blog"]
    landing_pages = [p for p in pages if p["type"] == "landing"]
    if len(blog_pages) > len(landing_pages):
        majority_pages = blog_pages
    elif len(landing_pages) > len(blog_pages):
        majority_pages = landing_pages
    else:
        majority_pages = pages

    return [p["title"] for p in majority_pages]


def _extract_word_set(titles):
    allowed = set()
    for t in titles:
        for w in re.findall(r"[A-Za-z0-9]+", t):
            allowed.add(w.lower())
    return allowed


def _fallback_extract_name(titles, max_words=6):
    source_title = titles[0].strip()
    delimiters = ["|", " - ", "–", "—", ":", "•"]
    candidate = source_title
    for delim in delimiters:
        if delim in source_title:
            candidate = source_title.split(delim)[0].strip()
            break
    words = candidate.split()
    candidate = " ".join(words[:max_words])
    if not candidate:
        candidate = " ".join(source_title.split()[:max_words])
    return candidate


# --- Hardcoded Best/Top rule ------------------------------------------
# Deliberately deterministic, not LLM-judged: if ANY of the top-3 titles
# contains the word "best" or "top", the category MUST carry the literal
# "Best/Top" tag -- this is a fixed business rule, not a suggestion.

def _titles_contain_best_or_top(titles):
    for t in titles:
        words = set(re.findall(r"[a-z]+", t.lower()))
        if "best" in words or "top" in words:
            return True
    return False


def _apply_best_top_rule(candidate_name, titles):
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


def derive_category_name(titles):
    """
    Build a short, meaningful category name -- HARD constrained to only
    select/rearrange words that literally appear in the majority titles.
    No new vocabulary allowed. Also instructed to exclude any city/state/
    country/region name (categories should describe the TOPIC, not the
    location) -- enforced via prompt instruction since a hardcoded
    place-name list can't generalize to "any" location worldwide.

    The result is validated word-by-word afterward; if the model breaks
    the word-source rule, its answer is discarded and a guaranteed-safe
    extraction is used instead. The Best/Top rule is applied separately,
    deterministically, after this function returns.
    """
    client = get_openai_client()
    titles_block = "\n".join(f"- {t}" for t in titles)
    allowed_words = _extract_word_set(titles)

    system_prompt = (
        "You create short SEO category names from webpage titles. Follow these "
        "rules exactly:\n\n"
        "1. You may ONLY use words that appear verbatim in the titles given to "
        "you (case doesn't matter). Never add, invent, or substitute a word.\n\n"
        "2. Keep it MINIMAL: 2-3 words maximum, describing ONE clear concept. "
        "Do not stack multiple words that mean the same thing (e.g. don't "
        "combine both 'affordable' AND 'fees' -- pick the single clearest "
        "word for that concept, not both).\n\n"
        "3. Do NOT include any city, state, country, or region name in the "
        "category, even if one appears in the titles -- the category should "
        "describe the TOPIC, not the location.\n\n"
        "4. Do NOT include ranking words like 'best' or 'top' -- that is "
        "handled separately.\n\n"
        "5. Output ONLY plain words separated by single spaces -- no "
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
        max_tokens=20,
    )
    candidate = resp.choices[0].message.content.strip().strip('"')

    candidate_words = re.findall(r"[A-Za-z0-9]+", candidate)
    invalid_words = [w for w in candidate_words if w.lower() not in allowed_words]

    if invalid_words or not candidate_words:
        fallback = _fallback_extract_name(titles)
        print(f"  [WARNING] Model used word(s) not in the titles: {invalid_words} "
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
        "The one exception: judge by INTENT for genuine SYNONYMS of the same "
        "specific concept -- for example, a topic about \"premium\" options "
        "and one about \"luxury\" options ARE the same category (both mean "
        "high-end/upscale), and 'affordable'/'cheap'/'budget' are the same "
        "low-cost concept. That is different from merging two distinct "
        "topics just because they're thematically related.\n\n"
        "If a new topic is genuinely the SAME specific topic (or a synonym "
        "of it) as an existing category, respond with ONLY that exact "
        "existing category name, copied exactly as written. If it's a "
        "different specific topic -- even if related -- respond with "
        "exactly: NONE"
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


def categorize_keyword(keyword, domain):
    """
    Category-only pipeline for one keyword, scoped to `domain`: fetch
    top-3 titles, derive a candidate category name, apply the hardcoded
    Best/Top rule, match against existing categories in this domain
    (intent-aware), and persist a new category if none matched.

    NOTE: clustering does NOT happen here anymore -- it's a separate,
    deterministic batch step that runs once per job, after every keyword
    in the job has been categorized. See cluster_all_categories().

    Returns the assigned category name, or None if there was no usable
    page data to categorize from.
    """
    import db  # local import to avoid a hard dependency for callers that
               # only want the pure scraping/naming functions above

    top3 = get_top3_for_category(keyword)
    titles = build_majority_titles(top3)
    if not titles:
        return None

    candidate_name = derive_category_name(titles)
    candidate_name = _apply_best_top_rule(candidate_name, titles)

    # Only compare against existing categories that have the SAME Best/Top
    # status -- otherwise a "Best/Top ..." candidate could get silently
    # merged into a plain existing category (or vice versa), losing the
    # Best/Top tag that this specific keyword's titles actually signaled.
    has_best_top = candidate_name.lower().startswith("best/top")
    existing_category_names = [
        name for name in db.list_category_names(domain)
        if name.lower().startswith("best/top") == has_best_top
    ]
    matched_category = find_matching_category(candidate_name, titles, existing_category_names)

    if matched_category:
        return matched_category

    db.add_category(domain, candidate_name)
    return candidate_name


# --- Clustering (deterministic, batch, NO LLM) ---------------------------
# Runs once per job, AFTER every keyword in that job has been categorized,
# over the domain's ENTIRE category list (not just this job's categories --
# a full recompute keeps clustering consistent as new categories arrive).
#
# Algorithm: repeatedly find the single word shared by the MOST remaining
# (not-yet-clustered) categories, group every category containing that
# word under a cluster literally named after that word, remove them from
# the pool, and repeat with whatever's left. Categories that share no word
# with any other remaining category become their own single-category
# cluster (named after themselves). This never invents vocabulary --
# every cluster name is either a literal word pulled from the categories
# it contains, or a category's own name.

_CLUSTER_STOPWORDS = {
    "a", "an", "the", "in", "of", "on", "at", "to", "for", "and", "or",
    "with", "by", "is", "are", "vs", "your", "you", "best", "top",
}


def _cluster_significant_words(category_name):
    words = re.findall(r"[A-Za-z0-9]+", category_name.lower())
    return {w for w in words if w not in _CLUSTER_STOPWORDS and len(w) > 2}


def _extend_cluster_phrase(word, matched_categories):
    """
    The chosen common word alone (e.g. "international") often reads
    awkwardly as a cluster name on its own. Check whether a second word
    commonly sits directly next to it (before or after) across the
    categories being grouped -- e.g. if most of them contain "...
    International Schools ..." or "... International School ...", extend
    the cluster label to "International Schools" instead of just
    "International". Purely positional/frequency-based -- never invents
    a word that isn't already adjacent to it in the real category text.
    """
    after_counts, before_counts = {}, {}
    for cat in matched_categories:
        tokens = re.findall(r"[A-Za-z0-9]+", cat.lower())
        for i, t in enumerate(tokens):
            if t != word:
                continue
            if i + 1 < len(tokens) and tokens[i + 1] not in _CLUSTER_STOPWORDS:
                after_counts[tokens[i + 1]] = after_counts.get(tokens[i + 1], 0) + 1
            if i - 1 >= 0 and tokens[i - 1] not in _CLUSTER_STOPWORDS:
                before_counts[tokens[i - 1]] = before_counts.get(tokens[i - 1], 0) + 1

    total = len(matched_categories)
    if total < 2:
        return word.title()

    threshold = (total + 1) // 2  # majority, rounded up

    best_after = max(after_counts.items(), key=lambda kv: kv[1], default=None)
    best_before = max(before_counts.items(), key=lambda kv: kv[1], default=None)

    candidates = []
    if best_after and best_after[1] >= max(threshold, 2):
        candidates.append((best_after[1], f"{word} {best_after[0]}"))
    if best_before and best_before[1] >= max(threshold, 2):
        candidates.append((best_before[1], f"{best_before[0]} {word}"))

    if candidates:
        candidates.sort(key=lambda c: c[0], reverse=True)
        return candidates[0][1].title()

    return word.title()


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
        cluster_label = _extend_cluster_phrase(chosen_word, matched)

        for cat in matched:
            assignment[cat] = cluster_label
            del remaining[cat]

    return assignment