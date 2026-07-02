"""
Core category-clustering logic: fetch top-3 organic titles for a keyword
from Bright Data's SERP zone, then derive/match a category name via OpenAI.

Categories are read from and written to Postgres (db.py) rather than a
local JSON file, so they stay consistent when driven by an RQ worker.
IMPORTANT: run only ONE category worker process at a time -- see README.
Category assignment is inherently sequential (each decision depends on
categories already created by prior keywords).
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


def derive_category_name(titles):
    """Build a short category name -- HARD constrained to only use words
    that literally appear in the titles. Validated word-by-word; falls
    back to a guaranteed-safe extraction if the model breaks the rule."""
    client = get_openai_client()
    titles_block = "\n".join(f"- {t}" for t in titles)
    allowed_words = _extract_word_set(titles)

    prompt = (
        "Below are webpage titles that share a common topic.\n\n"
        "Create a short, meaningful category name (aim for 2-5 words) that "
        "summarizes what they have in common.\n\n"
        "STRICT RULE: You may ONLY use words that appear verbatim in the "
        "titles below (case doesn't matter). Do not add, invent, substitute, "
        "or pluralize/modify any word that isn't already present. Select and "
        "reorder existing words from the titles to form a coherent, natural "
        "phrase -- do not just truncate one title mid-sentence.\n\n"
        f"Titles:\n{titles_block}\n\n"
        "Respond with ONLY the category name, nothing else."
    )

    resp = client.chat.completions.create(
        model=OPENAI_CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=20,
    )
    candidate = resp.choices[0].message.content.strip().strip('"')
    candidate_words = re.findall(r"[A-Za-z0-9]+", candidate)
    invalid_words = [w for w in candidate_words if w.lower() not in allowed_words]

    if invalid_words or not candidate_words:
        return _fallback_extract_name(titles)
    return candidate


def find_matching_category(candidate_name, candidate_titles, existing_category_names):
    """Ask OpenAI whether candidate_name fits an already-created category.
    Returns the existing category name if matched, else None."""
    if not existing_category_names:
        return None

    client = get_openai_client()
    category_list = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(existing_category_names))
    titles_block = "\n".join(f"- {t}" for t in candidate_titles)
    prompt = (
        "You are grouping webpage topics into categories for an SEO keyword taxonomy.\n\n"
        f"Existing categories:\n{category_list}\n\n"
        f'New topic candidate: "{candidate_name}"\n'
        f"Based on these page titles:\n{titles_block}\n\n"
        "Does this new topic clearly fit into one of the existing categories above "
        "(same general subject)? If yes, respond with ONLY the exact existing category "
        "name, copied exactly as written above. If none are a good fit, respond with "
        "exactly: NONE"
    )
    resp = client.chat.completions.create(
        model=OPENAI_CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
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


# --- Clusters (broader grouping OVER categories) --------------------------
# Cluster names are word-constrained to the category's OWN text -- same
# hard rule as category naming: never invent vocabulary. Matching a
# category into an ALREADY-EXISTING cluster (below) stays semantic, so
# generalization across different wording still happens once a cluster
# already exists from an earlier keyword -- just not at creation time.

def _extract_word_set_single(text):
    return set(w.lower() for w in re.findall(r"[A-Za-z0-9]+", text))


def _fallback_cluster_name(category_name, max_words=3):
    """Guaranteed-safe fallback: literal leading words of the category
    name, used only if the LLM invents vocabulary."""
    words = category_name.split()
    candidate = " ".join(words[:max_words])
    return candidate or category_name


def derive_cluster_name(category_name):
    """Produce a short cluster label for a category -- HARD constrained to
    only use words that literally appear in the category name. No new
    vocabulary allowed, same rule as derive_category_name. Preserves
    distinguishing compound phrases (e.g. "International Schools",
    "Private Schools") rather than over-collapsing to a single generic
    word -- different topics that happen to share one word (e.g. "Schools")
    should stay as separate clusters, not merge into one."""
    client = get_openai_client()
    allowed_words = _extract_word_set_single(category_name)

    prompt = (
        "Below is a specific SEO category name.\n\n"
        f'Category: "{category_name}"\n\n'
        "Create a cluster label (2-3 words when possible, 1 word only if the "
        "category itself is a single-topic word) representing this category's "
        "specific subject.\n\n"
        "STRICT RULE 1: You may ONLY use words that appear verbatim in the "
        "category name above (case doesn't matter). Never add, invent, or "
        "substitute a word that isn't already present.\n\n"
        "STRICT RULE 2: Preserve the most SPECIFIC distinguishing phrase, not "
        "the most generic one. If the category is \"International Schools in "
        "Singapore\", the label should be \"International Schools\" -- NOT just "
        "\"Schools\". If it's \"Private Schools in Singapore List\", the label "
        "should be \"Private Schools\" -- NOT just \"Schools\". Only drop pure "
        "filler/qualifier words: rankings (best, top), meta-words (list of, "
        "understanding, guide to), and specific city/country names. NEVER drop "
        "a topic-defining adjective (international, private, secondary, high, "
        "public) that distinguishes this category from other similar ones.\n\n"
        "Respond with ONLY the cluster label, nothing else."
    )
    resp = client.chat.completions.create(
        model=OPENAI_CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=12,
    )
    candidate = resp.choices[0].message.content.strip().strip('"')
    candidate_words = re.findall(r"[A-Za-z0-9]+", candidate)
    invalid_words = [w for w in candidate_words if w.lower() not in allowed_words]

    if invalid_words or not candidate_words:
        fallback = _fallback_cluster_name(category_name)
        print(f"  [WARNING] Cluster model used word(s) not in category: {invalid_words} "
              f"-> using fallback \"{fallback}\"")
        return fallback
    return candidate


def find_matching_cluster(candidate_cluster_name, category_name, existing_cluster_names):
    """Ask OpenAI whether this category belongs in an already-created
    cluster. Returns the existing cluster name if matched, else None.
    Deliberately strict: sharing one generic word (e.g. both mentioning
    "Schools") is NOT enough -- the specific topic must match (e.g.
    "International Schools" and "Private Schools" stay separate clusters
    even though both are about schools)."""
    if not existing_cluster_names:
        return None

    client = get_openai_client()
    cluster_list = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(existing_cluster_names))
    prompt = (
        "You are grouping SEO categories into topic clusters. Be STRICT: only "
        "merge into an existing cluster if the SPECIFIC topic matches, not just "
        "a shared generic word. For example, \"International Schools\" and "
        "\"Private Schools\" are DIFFERENT clusters even though both mention "
        "\"Schools\" -- do not merge them just because of the shared word.\n\n"
        f"Existing clusters:\n{cluster_list}\n\n"
        f'Category to place: "{category_name}"\n'
        f'Candidate new cluster name for it: "{candidate_cluster_name}"\n\n'
        "Does this category's SPECIFIC topic clearly match one of the existing "
        "clusters above (not just a shared generic word)? If yes, respond with "
        "ONLY the exact existing cluster name, copied exactly as written above. "
        "If none are a specific match, respond with exactly: NONE"
    )
    resp = client.chat.completions.create(
        model=OPENAI_CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=12,
    )
    answer = resp.choices[0].message.content.strip().strip('"')
    if answer.upper() == "NONE":
        return None

    for name in existing_cluster_names:
        if name.strip().lower() == answer.strip().lower():
            return name
    return None


def categorize_keyword(keyword):
    """
    Full pipeline for one keyword: fetch top-3 titles, derive a candidate
    category name, match against existing categories (from Postgres), and
    persist a new category if none matched. Then does the same one level
    up: derive/match a broader CLUSTER for that category.

    Returns (category, cluster) -- both None if there was no usable page
    data to categorize from.
    """
    import db  # local import to avoid a hard dependency for callers that
               # only want the pure scraping/naming functions above

    top3 = get_top3_for_category(keyword)
    titles = build_majority_titles(top3)
    if not titles:
        return None, None

    candidate_name = derive_category_name(titles)
    existing_category_names = db.list_category_names()
    matched_category = find_matching_category(candidate_name, titles, existing_category_names)

    if matched_category:
        category = matched_category
    else:
        db.add_category(candidate_name)
        category = candidate_name

    cluster_candidate = derive_cluster_name(category)
    existing_cluster_names = db.list_cluster_names()
    matched_cluster = find_matching_cluster(cluster_candidate, category, existing_cluster_names)

    if matched_cluster:
        cluster = matched_cluster
    else:
        db.add_cluster(cluster_candidate)
        cluster = cluster_candidate

    return category, cluster