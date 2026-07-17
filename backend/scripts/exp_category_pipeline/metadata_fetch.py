"""
metadata_fetch.py -- experimental, standalone

Fetches the full page metadata (title, meta description, headings, CTA
buttons, price signals, structured data) for a single URL via plain
`requests` + BeautifulSoup -- no Selenium/browser. A fresh, self-contained
implementation; does not import scripts/intent_classifier.py or anything
else from the currently-running pipeline.

Trade-off vs. a real headless-browser fetch: a handful of JS-heavy sites
won't fully render via a plain GET, and will come back with thin/empty
signals. That's an accepted simplification for this experimental pipeline
(same trade-off intent_classifier.py's own requests-only fallback makes
for environments with no browser available) -- not something to silently
paper over, so `fetch_error` is always set when this happens.
"""

import json
import os
import re
import time

import requests
from bs4 import BeautifulSoup

FETCH_TIMEOUT = 15
MAX_FETCH_RETRIES = 2
RETRY_BACKOFF_SECONDS = 2

MAIN_CONTENT_MAX_CHARS = 8000

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

CTA_PATTERN = re.compile(
    r"\b(buy now|add to cart|start free trial|free trial|book a? ?demo|"
    r"schedule a? ?demo|request a? ?demo|contact sales|talk to sales|"
    r"request a? ?quote|get a? ?quote|checkout|subscribe|sign ?up|"
    r"get started|book now|shop now|order now|download now|try for free)\b",
    re.IGNORECASE,
)

PRICE_PATTERN = re.compile(
    r"[$€£₹]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|INR|EUR|GBP)\b"
)


def _fetch_html(url):
    """Returns (html, error) -- error is None on success."""
    last_error = None
    for attempt in range(1, MAX_FETCH_RETRIES + 1):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=FETCH_TIMEOUT)
            resp.raise_for_status()
            if not resp.text or len(resp.text) < 200:
                last_error = "empty or too-short response body"
                if attempt < MAX_FETCH_RETRIES:
                    time.sleep(RETRY_BACKOFF_SECONDS)
                continue
            return resp.text, None
        except requests.exceptions.RequestException as e:
            last_error = str(e)
            if attempt < MAX_FETCH_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS)

    return None, last_error


def _extract_signals(url, html):
    soup = BeautifulSoup(html, "html.parser")

    title = soup.title.get_text(strip=True) if soup.title else ""

    meta_description = ""
    meta_tag = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    if meta_tag and meta_tag.get("content"):
        meta_description = meta_tag["content"].strip()

    headings = {level: [] for level in ("h1", "h2", "h3")}
    for level in headings:
        for tag in soup.find_all(level):
            text = tag.get_text(strip=True)
            if text:
                headings[level].append(text)

    structured_data_types = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        entries = data if isinstance(data, list) else [data]
        for entry in entries:
            if isinstance(entry, dict) and entry.get("@type"):
                structured_data_types.append(str(entry["@type"]))

    cta_buttons = sorted({
        tag.get_text(strip=True)
        for tag in soup.find_all(["button", "a", "input"])
        if tag.get_text(strip=True) and CTA_PATTERN.search(tag.get_text(strip=True))
    })[:20]

    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()
    main_text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))[:MAIN_CONTENT_MAX_CHARS]

    price_signals = sorted(set(PRICE_PATTERN.findall(main_text)))[:10]

    return {
        "url": url,
        "title": title,
        "meta_description": meta_description,
        "h1": headings["h1"][:10],
        "h2": headings["h2"][:15],
        "h3": headings["h3"][:15],
        "main_content": main_text,
        "cta_buttons": cta_buttons,
        "price_signals": price_signals,
        "structured_data_types": sorted(set(structured_data_types)),
    }


def fetch_url_metadata(url, fallback_title=None):
    """Full metadata dict for one URL. On fetch failure, returns a thin
    dict (url/title/fetch_error) rather than raising, so a single bad URL
    never takes down the rest of a keyword's top-3."""
    if not url:
        return None

    html, fetch_error = _fetch_html(url)
    if html:
        return _extract_signals(url, html)

    return {
        "url": url,
        "title": fallback_title or "",
        "meta_description": "",
        "h1": [], "h2": [], "h3": [],
        "main_content": "",
        "cta_buttons": [], "price_signals": [], "structured_data_types": [],
        "fetch_error": fetch_error,
    }


def fetch_top3_metadata(top3_results):
    """top3_results: list of {"url":..., "title":...} (up to 3). Returns
    the same-length list of full metadata dicts, in order."""
    out = []
    for r in (top3_results or [])[:5]:
        url = (r or {}).get("url")
        title = (r or {}).get("title")
        if not url:
            continue
        out.append(fetch_url_metadata(url, fallback_title=title))
    return out
