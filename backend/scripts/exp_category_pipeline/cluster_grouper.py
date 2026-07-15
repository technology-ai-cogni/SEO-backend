"""
cluster_grouper.py -- experimental, standalone

Deterministic, non-LLM clustering over an IN-MEMORY list of category name
strings -- no Postgres, no per-project state. Runs exactly once, after
every keyword in the batch has already been independently categorized by
category_namer.py.

Rule (same subset logic as scripts/cluster_assigner.py, rewritten here
rather than imported): two categories only belong in the same cluster if
one's significant-word set is a SUBSET of the other's (directly, or
transitively through a chain of other categories). This avoids one common
word (e.g. "marketing") dragging every category into a single giant
cluster just because it's frequent, while still merging genuine near-
duplicates like "digital marketing companies" and "digital media
companies marketing".
"""

import re

_STOPWORDS = {
    "a", "an", "the", "in", "of", "on", "at", "to", "for", "and", "or",
    "with", "by", "is", "are", "vs", "your", "you", "list",
}
_RANKING_WORDS = {"best", "top"}

_BEST_TOP_PREFIX_RE = re.compile(r"^(best/top|best|top)\s+", re.IGNORECASE)


def _singularize_word(word):
    w = word.lower()
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("ches", "shes", "xes", "ses", "zes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def _significant_words(category_name, location_words=frozenset(), extra_stopwords=frozenset()):
    """`extra_stopwords` is meant for category_namer.py's _FILLER_WORDS --
    generic marketing/CTA words (explore, find, process, details, ...)
    that must be excluded here too, not just from category naming: left
    in, the SAME generic word recurring across many otherwise-unrelated
    categories acts as a hub that the subset-based clustering below
    transitively merges everything through, collapsing a whole batch into
    one giant cluster (observed in practice on this exact dataset)."""
    words = re.findall(r"[A-Za-z0-9]+", category_name.lower())
    return {
        _singularize_word(w) for w in words
        if w not in _STOPWORDS and w not in _RANKING_WORDS
        and w not in location_words and w not in extra_stopwords
        and not w.isdigit() and len(w) > 2
    }


def _display_form(norm_word, matched_categories):
    forms = {}
    for cat in matched_categories:
        for raw in re.findall(r"[A-Za-z0-9]+", cat.lower()):
            if _singularize_word(raw) == norm_word:
                forms[raw] = forms.get(raw, 0) + 1
    return max(forms.items(), key=lambda kv: kv[1])[0] if forms else norm_word


def _strip_best_top(label):
    stripped = _BEST_TOP_PREFIX_RE.sub("", label).strip()
    return stripped or label


def _find(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent, a, b):
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


def cluster_categories(categories, location_words=frozenset(), extra_stopwords=frozenset()):
    """categories: list of category name strings for the WHOLE batch
    (duplicates harmless). Returns {category_name: cluster_label} covering
    every one given, computed purely from the list itself -- no database,
    no per-project lookup. `extra_stopwords` should be
    category_namer._FILLER_WORDS -- see _significant_words() above for
    why that matters here, not just at naming time."""
    categories = [c for c in categories if c]
    if not categories:
        return {}

    unique_cats = list(dict.fromkeys(categories))
    word_sets = {cat: _significant_words(cat, location_words, extra_stopwords) for cat in unique_cats}
    parent = {cat: cat for cat in unique_cats}

    for i in range(len(unique_cats)):
        for j in range(i + 1, len(unique_cats)):
            a, b = unique_cats[i], unique_cats[j]
            wa, wb = word_sets[a], word_sets[b]
            if not wa or not wb:
                continue
            if wa <= wb or wb <= wa:
                _union(parent, a, b)

    groups = {}
    for cat in unique_cats:
        root = _find(parent, cat)
        groups.setdefault(root, []).append(cat)

    assignment = {}
    for members in groups.values():
        if len(members) == 1 or not any(word_sets[m] for m in members):
            label = _strip_best_top(members[0])
            for cat in members:
                assignment[cat] = label
            continue

        threshold = (len(members) + 1) // 2
        shared_counts = {}
        for cat in members:
            for w in word_sets[cat]:
                shared_counts[w] = shared_counts.get(w, 0) + 1
        shared_words = {w for w, c in shared_counts.items() if c >= threshold}
        if not shared_words:
            shared_words = min((word_sets[c] for c in members if word_sets[c]), key=len)

        position_totals, position_counts = {}, {}
        for cat in members:
            tokens = [_singularize_word(t) for t in re.findall(r"[A-Za-z0-9]+", cat.lower())]
            for idx, t in enumerate(tokens):
                if t in shared_words:
                    position_totals[t] = position_totals.get(t, 0) + idx
                    position_counts[t] = position_counts.get(t, 0) + 1

        ordered_words = sorted(
            shared_words,
            key=lambda w: position_totals.get(w, 0) / position_counts.get(w, 1),
        )
        cluster_label = " ".join(_display_form(w, members).title() for w in ordered_words) or members[0]
        cluster_label = _strip_best_top(cluster_label)

        for cat in members:
            assignment[cat] = cluster_label

    return assignment
