"""
cluster_assigner.py

Clustering as its own separate stage/agent -- deliberately NOT part of
category_assigner.py (category assignment and clustering are different
concerns; category_checker.py's own docstring says the same: "Clustering
is a SEPARATE, deterministic, non-LLM step that runs once per job --
AFTER every keyword in that job has been categorized -- over the
domain's ENTIRE category list").

Grouping logic is a SELF-CONTAINED rewrite (not a call into
category_checker.cluster_all_categories() anymore) -- everything else
about clustering stays deterministic/non-LLM, and word-significance
filtering, singularization, and surface-form picking are still reused
UNCHANGED from category_checker.py (pure helpers, not the flawed loop).

Why the original algorithm needed replacing: it repeatedly picked
whichever SINGLE word was shared by the most remaining categories, and
pulled every category containing that word into one cluster in that one
pass. That works fine when categories are topically diverse, but breaks
down on a dataset where nearly every category shares a common word (e.g.
"digital", "marketing") -- that word wins the very first round and
drags EVERY category into one giant cluster before a more specific,
actually-differentiating word (agency vs. company vs. media) ever gets a
chance to split them apart. Observed in practice: "digital marketing
agency", "digital marketing agencies", and "digital marketing companies"
were all landing in one identical "Digital Marketing Companies" cluster.

New rule: two categories only belong in the same cluster if one's
significant-word set is a SUBSET of the other's (directly, or
transitively through a chain of other categories) -- e.g. "digital
marketing companies" {digital, marketing, company} and "digital media
companies marketing" {digital, media, company, marketing} merge (the
first is a subset of the second), but "digital marketing agency"
{digital, marketing, agency} and "digital marketing companies" {digital,
marketing, company} do NOT merge just because they share "digital" and
"marketing" -- "agency" vs. "company" is a real, meaningful difference,
not noise.
"""

import re

from core import db
from services.category_checker import _cluster_significant_words, _singularize_word, _display_form


def _find(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent, a, b):
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


_BEST_TOP_PREFIX_RE = re.compile(r"^(best/top|best|top)\s+", re.IGNORECASE)


def _strip_best_top(label):
    """Cluster names must never carry a Best/Top prefix -- that's a
    per-CATEGORY tag (whether THIS specific keyword's own titles said
    best/top), not a cluster-level concept, and categories sharing one
    cluster can disagree on it. _cluster_significant_words() already
    excludes "best"/"top" from the word sets used to BUILD a multi-member
    label, but the singleton-cluster fallback below reuses a category's
    RAW name verbatim (and the multi-member path also falls back to the
    raw name if no shared words survive) -- either path can otherwise let
    "Best/Top " straight through. Applied as a final safety net to every
    label this function returns, regardless of which path produced it."""
    stripped = _BEST_TOP_PREFIX_RE.sub("", label).strip()
    return stripped or label


def cluster_categories(categories):
    """categories: list of category name strings (may contain
    duplicates -- harmless, just processed redundantly). Returns
    {category_name: cluster_label} covering every one given."""
    if not categories:
        return {}

    unique_cats = list(dict.fromkeys(categories))  # de-dupe, keep order
    word_sets = {cat: _cluster_significant_words(cat) for cat in unique_cats}
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

        # Label = every word shared by a MAJORITY of this cluster's
        # members -- same "majority, position-ordered" labeling style
        # category_checker.py used, just applied to a correctly-formed
        # group instead of a single-anchor-word group.
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


def cluster_project(domain):
    """Re-clusters this project's ENTIRE category list from scratch
    (not just this run's categories) and persists the new cluster
    assignment. Returns {category_name: cluster_name}."""
    categories = db.list_category_names(domain)
    assignment = cluster_categories(categories)
    db.replace_domain_clusters(domain, assignment)
    return assignment
