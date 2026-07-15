"""
category_namer.py -- experimental, standalone

Derives a category name for ONE keyword from its OWN top-3 page metadata
only -- no cross-referencing against any other keyword's category, no
"does this match an existing category" LLM call, no shared/global state
at all. That is the deliberate behavior change from the current
production pipeline (services/category_checker.py + scripts/
category_assigner.py), where a candidate name is checked against every
category already created earlier in the same run before deciding to
reuse or create one.

The naming RULE itself is unchanged and reused in spirit (rewritten here,
not imported, per the zero-import constraint on this experiment):
  - A word only qualifies for the category name if it appears in at
    least 2 of the "documents" for this keyword (the up-to-3 pages'
    title + meta description, PLUS the keyword itself folded in as one
    more document) -- singular/plural forms merged (school/schools count
    as the same word).
  - Stopwords, ranking words ("best"/"top"), and any
    country/state/city/region word are never eligible.
  - The LLM composes the fullest natural phrase it can from ONLY that
    allowed word set; if it strays outside the allowed words, a
    deterministic fallback (allowed words, first-appearance order) is
    used instead.
  - Best/Top prefix rule: applied deterministically after naming, based
    on whether the first document contains best/top, or ALL of the rest
    do.
  - Single entity-type rule: "company"/"agency"/"service"/"firm"/
    "provider" are the same KIND of label -- only the one most common
    across the documents survives if the derived name ends up with more
    than one.

Since there is no cross-keyword matching anymore, there is also no need
to query/maintain a live "existing categories" list while naming -- the
only place multiple keywords' categories interact at all is the separate,
purely deterministic cluster_grouper.py step, run once at the very end
over the whole batch's already-derived names.
"""

import json
import os
import re
import time

import pycountry
from openai import OpenAI, APIConnectionError, APITimeoutError, RateLimitError
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")

MAX_LLM_RETRIES = 3
LLM_RETRY_BACKOFF_SECONDS = 3

_STOPWORDS = {
    "a", "an", "the", "in", "of", "on", "at", "to", "for", "and", "or",
    "with", "by", "is", "are", "vs", "your", "you", "list",
}
_RANKING_WORDS = {"best", "top"}
_ENTITY_TYPE_WORDS = {"company", "agency", "service", "firm", "provider"}

# Generic marketing/CTA/boilerplate words that show up constantly across
# UNRELATED page titles ("Explore top schools...", "Find the best...",
# "Check out our...") -- they can genuinely occur in >=2 of a keyword's
# own documents, so the plain >=2-occurrence rule alone doesn't catch
# them, but they describe a generic CALL TO ACTION, never the actual
# TOPIC. Left in, they do real damage beyond just cluttering one category
# name: cluster_grouper.py's subset-based clustering treats these as
# ordinary "significant words", and because the SAME generic word chains
# through many otherwise-unrelated categories, it acts as a hub that
# transitively merges everything into one giant cluster (observed in
# practice: "explore", "find", "process", "details" alone collapsed 61 of
# 62 categories into a single cluster). Excluded from qualifying words
# entirely -- not just cosmetically stripped from the final name -- so
# they never influence naming OR clustering. Manually curated (there's no
# dependency-free "is this a generic CTA word" source), not exhaustive.
_FILLER_WORDS = {
    "use", "uses", "used", "using",
    "guide", "guides",
    "name", "names",
    "idea", "ideas",
    "report", "reports",
    "size", "sizes",
    "explore", "exploring", "explored",
    "find", "finding", "found",
    "discover", "discovering", "discovered",
    "detail", "details",
    "process", "processes",
    "check", "checking", "checklist",
    "get", "getting",
    "learn", "learning",
    "know", "knowing", "knowledge",
    "choose", "choosing", "choice", "choices",
    "need", "needs", "needing",
    "want", "wants", "wanting",
    "near", "nearby",
    "offer", "offers", "offering", "offered",
    "view", "viewing",
    "see", "seeing",
    "visit", "visiting",
    "browse", "browsing",
    "complete", "ultimate", "updated", "update", "latest", "new",
    "online", "one", "every", "everything", "all",
}


def _build_location_word_blocklist():
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


_MAJOR_CITY_WORDS = {
    "delhi", "mumbai", "bangalore", "bengaluru", "hyderabad", "chennai",
    "kolkata", "pune", "ahmedabad", "jaipur", "lucknow", "surat", "noida",
    "gurgaon", "gurugram", "chandigarh", "kochi", "coimbatore", "indore",
    "bhopal", "nagpur", "patna", "ncr",
    "london", "dubai", "singapore", "toronto", "sydney", "chicago",
    "boston", "seattle",
}

_LOCATION_WORDS = _build_location_word_blocklist() | _MAJOR_CITY_WORDS


def get_openai_client():
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set. Fill it in in .env.")
    return OpenAI(api_key=OPENAI_API_KEY)


def _singularize_word(word):
    w = word.lower()
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("ches", "shes", "xes", "ses", "zes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def _doc_word_set(doc_text):
    return {w.lower() for w in re.findall(r"[A-Za-z0-9]+", doc_text or "") if not w.isdigit()}


def _common_words_across_docs(documents, min_docs=2):
    """Words appearing in at least `min_docs` of the given document
    strings (case-insensitive, singular/plural merged). Location words,
    stopwords, and ranking words never qualify. Returned in
    first-appearance order across the documents."""
    required = min(min_docs, len(documents)) if documents else min_docs

    doc_presence = {}
    surface_counts = {}
    for doc in documents:
        normalized_in_doc = set()
        for w in _doc_word_set(doc):
            norm = _singularize_word(w)
            normalized_in_doc.add(norm)
            surface_counts.setdefault(norm, {}).setdefault(w, 0)
            surface_counts[norm][w] += 1
        for norm in normalized_in_doc:
            doc_presence[norm] = doc_presence.get(norm, 0) + 1

    qualifying_norms = {
        norm for norm, c in doc_presence.items()
        if c >= required and norm not in _LOCATION_WORDS
        and norm not in _STOPWORDS and norm not in _RANKING_WORDS
        and norm not in _FILLER_WORDS
    }
    canonical_form = {
        norm: max(surface_counts[norm].items(), key=lambda kv: kv[1])[0]
        for norm in qualifying_norms
    }

    order, seen = [], set()
    for doc in documents:
        for w in re.findall(r"[A-Za-z0-9]+", (doc or "").lower()):
            norm = _singularize_word(w)
            if norm in qualifying_norms and norm not in seen:
                seen.add(norm)
                order.append(canonical_form[norm])
    return order


def _title_has_best_or_top(text):
    words = set(re.findall(r"[a-z]+", (text or "").lower()))
    return "best" in words or "top" in words


def _docs_contain_best_or_top(documents):
    if not documents:
        return False
    if _title_has_best_or_top(documents[0]):
        return True
    rest = documents[1:]
    return bool(rest) and all(_title_has_best_or_top(d) for d in rest)


def _apply_best_top_rule(candidate_name, documents):
    if not _docs_contain_best_or_top(documents):
        return candidate_name
    words = candidate_name.split()
    if words and words[0].strip().lower() in ("best", "top", "best/top"):
        words = words[1:]
    rest = " ".join(words).strip()
    return f"Best/Top {rest}".strip() if rest else "Best/Top"


def _clean_category_text(text):
    text = re.sub(r"[^A-Za-z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _enforce_single_entity_type(category_name, documents):
    words = category_name.split()
    entity_positions = [
        i for i, w in enumerate(words) if _singularize_word(w) in _ENTITY_TYPE_WORDS
    ]
    if len(entity_positions) <= 1:
        return category_name

    doc_word_sets = [_doc_word_set(doc) for doc in documents]
    doc_word_sets = [{_singularize_word(w) for w in ws} for ws in doc_word_sets]
    counts = {}
    for i in entity_positions:
        stem = _singularize_word(words[i])
        counts[i] = sum(1 for ws in doc_word_sets if stem in ws)

    winner = max(entity_positions, key=lambda i: (counts[i], -i))
    drop = set(entity_positions) - {winner}
    return " ".join(w for i, w in enumerate(words) if i not in drop)


def _dedupe_redundant_words(category_name):
    """Deterministic, word-level cleanup applied left-to-right so a
    derived name never repeats a word (including its singular/plural
    twin) or carries both a short word and a longer word that's just a
    restatement of it:
      - An exact duplicate word (same word, or same after singularizing)
        that already appears earlier in the name is dropped -- this is
        the "singular AND plural should never both occur" rule: only
        ONE surface form of a given word ever survives in the final name.
      - A word that's a plain PREFIX of another kept word (e.g. "web" vs
        "website") is redundant; only the LONGER, more specific word
        stays. Only applies when the longer word is >=6 characters, so
        two short unrelated words sharing a prefix (e.g. "app" vs
        "apple") aren't falsely merged.
    """
    words = category_name.split()
    normed = [_singularize_word(w) for w in words]
    keep = [True] * len(words)

    for i in range(len(words)):
        if not keep[i]:
            continue
        for j in range(i + 1, len(words)):
            if not keep[j]:
                continue
            wi, wj = normed[i], normed[j]
            if wi == wj:
                keep[j] = False
                continue
            if max(len(wi), len(wj)) >= 6 and (wi.startswith(wj) or wj.startswith(wi)):
                if len(wi) >= len(wj):
                    keep[j] = False
                else:
                    keep[i] = False
                    break

    kept_words = [w for w, k in zip(words, keep) if k]
    return " ".join(kept_words) if kept_words else category_name


_LOCATION_LEAK_SYSTEM_PROMPT = (
    "You clean up SEO category names by removing geographic references. A "
    "category name should describe a TOPIC, never a PLACE.\n\n"
    "Look at the category name below and decide, using your own knowledge "
    "of world geography (not a fixed list), whether ANY part of it names "
    "or refers to a specific place -- a country, state/province, city, "
    "town, neighborhood, locality, area, district, or landmark, at any "
    "level of specificity, however small or locally-known it is (e.g. "
    "'Navi' in 'Navi Mumbai' still refers to a place even though 'Navi' "
    "alone looks like an ordinary word).\n\n"
    "If it does, rewrite the category name with that place name removed "
    "entirely, keeping every other word exactly as given, in the same "
    "order. Do not add, invent, or substitute any new word. If removing "
    "the place leaves nothing meaningful, output just the single most "
    "meaningful remaining word.\n\n"
    "If the category name does not contain any place reference at all, "
    "output it completely unchanged.\n\n"
    "Respond with ONLY the resulting category name, nothing else -- no "
    "punctuation, no quotes, no explanation."
)


def _strip_location_leak(candidate_name, documents):
    """Extra safety net on top of the deterministic _LOCATION_WORDS
    blocklist (pycountry countries/subdivisions + a short manually
    curated major-cities list) -- that blocklist only catches WHOLE place
    names it already knows about, so a locality/neighborhood/multi-word
    place (e.g. "Navi" from "Navi Mumbai") can still slip through into a
    derived category name. Asks the model to recognize ANY geographic
    reference, at whatever level, using its own world-geography
    knowledge, and remove it -- keeping every other word exactly as-is.
    Falls back to the untouched candidate on any LLM failure, never
    raises."""
    if not candidate_name:
        return candidate_name

    docs_block = "\n".join(f"- {d}" for d in documents if d)
    user_prompt = (
        f'Category name: "{candidate_name}"\n\n'
        f"Pages this category was derived from (for context only):\n{docs_block}"
    )

    client = get_openai_client()
    last_error = None
    for attempt in range(1, MAX_LLM_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model=OPENAI_CHAT_MODEL,
                messages=[
                    {"role": "system", "content": _LOCATION_LEAK_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0,
                max_tokens=40,
            )
            cleaned = resp.choices[0].message.content.strip().strip('"')
            return cleaned or candidate_name
        except (RateLimitError, APIConnectionError, APITimeoutError) as e:
            last_error = e
            if attempt < MAX_LLM_RETRIES:
                time.sleep(LLM_RETRY_BACKOFF_SECONDS * attempt)

    print(f"  [NAMER WARNING] Location-leak cleanup failed after retries ({last_error}) "
          f"-- keeping \"{candidate_name}\" as-is")
    return candidate_name


_NAMING_SYSTEM_PROMPT_TEMPLATE = (
    "You create SEO category names from webpage metadata. Follow these rules exactly:\n\n"

    "1. You will receive exactly THREE webpage metadata titles. "
    "Consider ONLY these three titles while creating the category.\n\n"

    "2. From EACH metadata title, extract ONLY the TOP THREE most meaningful topic words. "
    "Ignore stop words, filler words, connectors, promotional words, location names, numbers, years, "
    "and words that merely describe page sections or attributes.\n\n"

    "3. This gives you a maximum pool of NINE candidate words (3 from each title). "
    "A word is eligible to appear in the final category ONLY IF it appears in AT LEAST TWO of the three metadata titles. "
    "If a word appears only once, it MUST NOT be used unless omitting it would make the category impossible to understand.\n\n"

    "4. Do NOT simply count repeated words. First understand the shared search intent of the three titles. "
    "Use only the repeated words that describe the PRIMARY topic. "
    "Ignore repeated descriptive words such as reviews, fees, admission, compare, facilities, guide, information, "
    "details, curriculum, contact, ranking, process, eligibility, requirements, benefits, pricing, photos, "
    "locations, timings, address, and similar supporting words.\n\n"

    "5. You may ONLY use words from this allowed list (case doesn't matter): {allowed}. "
    "Never invent, substitute, or add any word that is not present in the allowed list.\n\n"

    "6. Do NOT include any city, state, country, locality, or region name even if it appears in the metadata or allowed list.\n\n"

    "7. Do NOT include any numbers, digits, years, or numeric expressions.\n\n"

    "8. Do NOT include ranking words such as 'best' or 'top'. These are handled separately.\n\n"

    "9. Understand semantic equivalence. "
    "'company', 'companies', 'agency', 'agencies', 'firm', 'provider', and 'service' represent business types. "
    "Choose ONLY the ONE business-type word that best represents the shared intent. "
    "Never include multiple synonymous business-type words together.\n\n"

    "10. The category should be the shortest natural noun phrase that accurately represents the shared search intent. "
    "Do NOT create a sentence or a list of repeated words.\n\n"

    "11. Before creating a new category, compare it with previously created categories. "
    "If an existing category represents the same search intent, return that category exactly instead of creating a new variation.\n\n"

    "12. Output ONLY plain words separated by single spaces. "
    "No punctuation, quotes, commas, pipes, explanations, or additional text.\n\n"

    "Respond with ONLY the category name."

)


def _derive_candidate_name(qualifying_words, documents):
    """One LLM call to compose a natural phrase from `qualifying_words`
    only, with a guaranteed-safe deterministic fallback if the model
    breaks the word-source rule."""
    if not qualifying_words:
        return ""

    allowed_block = ", ".join(qualifying_words)
    system_prompt = _NAMING_SYSTEM_PROMPT_TEMPLATE.format(allowed=allowed_block)
    docs_block = "\n".join(f"- {d}" for d in documents if d)

    client = get_openai_client()
    last_error = None
    candidate = None
    for attempt in range(1, MAX_LLM_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model=OPENAI_CHAT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Pages:\n{docs_block}"},
                ],
                temperature=0,
                max_tokens=40,
            )
            candidate = resp.choices[0].message.content.strip().strip('"')
            break
        except (RateLimitError, APIConnectionError, APITimeoutError) as e:
            last_error = e
            if attempt < MAX_LLM_RETRIES:
                time.sleep(LLM_RETRY_BACKOFF_SECONDS * attempt)

    if candidate is None:
        print(f"  [NAMER ERROR] LLM call failed after retries: {last_error}")
        return " ".join(w.capitalize() for w in qualifying_words)

    candidate_words = re.findall(r"[A-Za-z0-9]+", candidate)
    allowed_lower = {w.lower() for w in qualifying_words}
    invalid_words = [w for w in candidate_words if w.lower() not in allowed_lower]

    if invalid_words or not candidate_words:
        fallback = " ".join(w.capitalize() for w in qualifying_words)
        print(f"  [NAMER WARNING] Model used disallowed word(s) {invalid_words} in \"{candidate}\" "
              f"-- using safe fallback: \"{fallback}\"")
        return fallback

    return candidate


def _first_n_words_text(text, n):
    return " ".join(re.findall(r"[A-Za-z0-9]+", text or "")[:n])


def _categorize_from_documents(keyword, documents):
    """The full rule chain, shared by every entry point below -- ONLY the
    `documents` a caller builds differs between entry points; every rule
    downstream of that (>=2-occurrence, LLM naming from the allowed word
    list only, location-leak strip, single entity-type, dedupe-redundant-
    words, Best/Top) is identical, unchanged, regardless of which entry
    point was used. Never looks at any other keyword's result. Never
    touches a database or in-memory "existing categories" list -- that
    only happens later, in cluster_grouper.py, over the whole batch's
    names at once."""
    if not documents:
        return ""

    count_documents = documents + [keyword] if keyword else documents
    qualifying_words = _common_words_across_docs(count_documents, min_docs=2)

    if not qualifying_words:
        # Nothing shared by 2+ documents -- fall back to the single most
        # representative document's own words (still deduped/filtered).
        seen_norms = set()
        qualifying_words = []
        for w in re.findall(r"[A-Za-z0-9]+", documents[0].lower()):
            norm = _singularize_word(w)
            if (w in _LOCATION_WORDS or norm in _LOCATION_WORDS
                    or w in _STOPWORDS or norm in _STOPWORDS
                    or w in _RANKING_WORDS or norm in _RANKING_WORDS
                    or w in _FILLER_WORDS or norm in _FILLER_WORDS or w.isdigit()):
                continue
            if norm in seen_norms:
                continue
            seen_norms.add(norm)
            qualifying_words.append(w)

    raw_candidate = _derive_candidate_name(qualifying_words, documents)
    candidate_name = _clean_category_text(raw_candidate)
    candidate_name = _strip_location_leak(candidate_name, documents)
    candidate_name = _clean_category_text(candidate_name)
    candidate_name = _enforce_single_entity_type(candidate_name, count_documents)
    candidate_name = _dedupe_redundant_words(candidate_name)
    candidate_name = _apply_best_top_rule(candidate_name, count_documents)

    return candidate_name


def categorize_from_metadata(keyword, top3_metadata):
    """Entry point 1: `documents` = each page's FULL title + meta_description
    text (from metadata_fetch.fetch_top3_metadata), plus the keyword itself.
    Runs the full rule chain in _categorize_from_documents() above. Returns
    "" if there's no usable metadata at all."""
    documents = []
    for m in (top3_metadata or []):
        if not m:
            continue
        text = " ".join(filter(None, [m.get("title"), m.get("meta_description")]))
        if text.strip():
            documents.append(text)

    return _categorize_from_documents(keyword, documents)


def categorize_from_title_words(keyword, titles, words_per_title=3):
    """Entry point 2: `documents` = only the first `words_per_title` words
    of each of up to 3 plain title strings (so up to 3*words_per_title
    words total feed the >=2-occurrence rule), instead of the full title +
    meta_description text categorize_from_metadata() uses -- a smaller,
    more tightly-scoped vocabulary pool. Every rule downstream of that is
    the exact same, unchanged chain in _categorize_from_documents()."""
    documents = []
    for title in (titles or [])[:3]:
        text = _first_n_words_text(title, words_per_title)
        if text.strip():
            documents.append(text)

    return _categorize_from_documents(keyword, documents)
