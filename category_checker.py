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

_client = None


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
        "word for that concept, not both). Prefer the noun that names the "
        "core concept (e.g. 'benefits', 'admission', 'fees') over an "
        "incidental verb form describing the action around it (e.g. "
        "'studying', 'attending', 'choosing') -- if both are available in "
        "the titles, the concept noun is the stronger, more useful word.\n\n"
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


def categorize_keyword(keyword, domain, country_code=None):
    """
    Category-only pipeline for one keyword, scoped to `domain`: fetch
    top-3 titles (from the given `country_code`'s Google region, or the
    .env default if not given), derive a candidate category name, apply
    the hardcoded Best/Top rule, match against existing categories in
    this domain (intent-aware), and persist a new category if none matched.

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

    meta = {
        "top3": [{"url": r["url"], "title": r["title"]} for r in top3],
        "search_region": country_code or COUNTRY_CODE,
        "majority_type": majority_type,
        "majority_titles_used": titles,
    }

    if not titles:
        return None, meta

    raw_candidate = derive_category_name(titles)
    candidate_name = _apply_best_top_rule(raw_candidate, titles)
    meta["raw_candidate_before_best_top_rule"] = raw_candidate
    meta["best_top_applied"] = candidate_name != raw_candidate

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


def _clean_cluster_label(text):
    """Strip a leading 'Best/Top' tag before a category name is used AS
    its own cluster label (the singleton-fallback case below) -- clusters
    should never contain 'best'/'top' even in this edge case."""
    cleaned = re.sub(r"(?i)^best/top\s*", "", text).strip()
    return cleaned if cleaned else text


def _normalize_word(word):
    """Lightweight, generic singular/plural normalization (e.g. "school"
    and "schools" -> the same key) so clustering treats them as the same
    word instead of splitting frequency/adjacency votes between the two
    forms. Not specific to any topic -- plain English suffix-stripping."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("es") and word[-3] in "sxz":
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _cluster_words_with_originals(category_name):
    """{normalized_word: original_word} for this category's significant
    words (stopwords and very short words excluded). Plural/singular
    forms collapse to the same normalized key."""
    tokens = re.findall(r"[A-Za-z0-9]+", category_name.lower())
    result = {}
    for t in tokens:
        if t in _CLUSTER_STOPWORDS or len(t) <= 2:
            continue
        result.setdefault(_normalize_word(t), t)
    return result


def _most_common_surface_form(norm_word, matched_categories):
    """Which actual spelling (singular vs plural) shows up most often
    among the matched categories, for display purposes."""
    forms = {}
    for cat in matched_categories:
        words = _cluster_words_with_originals(cat)
        if norm_word in words:
            form = words[norm_word]
            forms[form] = forms.get(form, 0) + 1
    if not forms:
        return norm_word
    return max(forms.items(), key=lambda kv: kv[1])[0]


def _extend_cluster_phrase(norm_word, matched_categories):
    """
    The chosen common word alone (e.g. "international") often reads
    awkwardly as a cluster name on its own. Check whether a second word
    commonly sits directly next to it (before or after) across the
    categories being grouped, using NORMALIZED forms so "school" and
    "schools" count together instead of splitting the vote -- e.g. if
    most of them contain "... International School(s) ...", extend the
    cluster label to "International Schools" instead of just
    "International". Purely positional/frequency-based -- never invents
    a word that isn't already adjacent to it in the real category text.
    """
    after_counts, before_counts = {}, {}
    after_originals, before_originals = {}, {}

    for cat in matched_categories:
        tokens = re.findall(r"[A-Za-z0-9]+", cat.lower())
        norm_tokens = [_normalize_word(t) for t in tokens]
        for i, nt in enumerate(norm_tokens):
            if nt != norm_word:
                continue
            if i + 1 < len(tokens) and norm_tokens[i + 1] not in _CLUSTER_STOPWORDS and len(norm_tokens[i + 1]) > 2:
                after_counts[norm_tokens[i + 1]] = after_counts.get(norm_tokens[i + 1], 0) + 1
                after_originals.setdefault(norm_tokens[i + 1], tokens[i + 1])
            if i - 1 >= 0 and norm_tokens[i - 1] not in _CLUSTER_STOPWORDS and len(norm_tokens[i - 1]) > 2:
                before_counts[norm_tokens[i - 1]] = before_counts.get(norm_tokens[i - 1], 0) + 1
                before_originals.setdefault(norm_tokens[i - 1], tokens[i - 1])

    total = len(matched_categories)
    base_display = _most_common_surface_form(norm_word, matched_categories)

    if total < 2:
        return base_display.title()

    threshold = max((total + 1) // 2, 2)  # majority, rounded up, minimum 2

    candidates = []
    if after_counts:
        best_after_norm = max(after_counts.items(), key=lambda kv: kv[1])
        if best_after_norm[1] >= threshold:
            candidates.append((best_after_norm[1], f"{base_display} {after_originals[best_after_norm[0]]}"))
    if before_counts:
        best_before_norm = max(before_counts.items(), key=lambda kv: kv[1])
        if best_before_norm[1] >= threshold:
            candidates.append((best_before_norm[1], f"{before_originals[best_before_norm[0]]} {base_display}"))

    if candidates:
        candidates.sort(key=lambda c: c[0], reverse=True)
        return candidates[0][1].title()

    return base_display.title()


def cluster_all_categories(domain):
    """
    Deterministic greedy clustering over every category currently in this
    domain. Returns {category_name: cluster_name} covering ALL of them.
    """
    import db

    categories = db.list_category_names(domain)
    remaining = {cat: _cluster_words_with_originals(cat) for cat in categories}
    assignment = {}

    while remaining:
        freq = {}
        for words in remaining.values():
            for norm_word in words:
                freq[norm_word] = freq.get(norm_word, 0) + 1

        max_freq = max(freq.values()) if freq else 0

        if max_freq <= 1:
            # Nothing left shares a word with anything else -- each
            # remaining category becomes its own cluster.
            for cat in list(remaining.keys()):
                assignment[cat] = _clean_cluster_label(cat)
                del remaining[cat]
            break

        # Tie-break deterministically: alphabetically first among the
        # most-common normalized words.
        chosen_word = sorted(w for w, c in freq.items() if c == max_freq)[0]
        matched = [cat for cat, words in remaining.items() if chosen_word in words]
        cluster_label = _extend_cluster_phrase(chosen_word, matched)

        for cat in matched:
            assignment[cat] = cluster_label
            del remaining[cat]

    return assignment