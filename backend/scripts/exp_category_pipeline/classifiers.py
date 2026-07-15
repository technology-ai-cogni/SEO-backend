"""
classifiers.py -- experimental, standalone

Landing/Blog classification only. Informational/Commercial classification
used to live here too, but that's now sourced directly from the
PRODUCTION scripts/intent_classifier.py (see run_experiment.py) -- a
deliberate, explicit exception to this pipeline's usual
zero-import-from-production-files rule, per an explicit request to reuse
intent_classifier.py's real headless-Chrome fetch + its own OpenAI
classification rather than duplicate it here.

Landing/Blog stays its own fresh, self-contained implementation (own
prompt, own OpenAI plumbing) -- does not import
scripts/landing_blog_classifier.py.
"""

import json
import os
import time

from openai import OpenAI, APIConnectionError, APITimeoutError, RateLimitError
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")

MAX_LLM_RETRIES = 3
LLM_RETRY_BACKOFF_SECONDS = 3

LANDING_PAGE = "Landing Page"
BLOG_PAGE = "Blog Page"

_LANDING_BLOG_SYSTEM_PROMPT = """You classify search result pages by INTENT into exactly one of two types, for EACH page given:

BLOG -- the page's purpose is to LIST, RANK, or COMPARE multiple businesses/options rather than represent one business itself. This includes directory/listing pages, and any "best X"/"top X" roundup about companies, services, agencies, providers, firms, or similar collective/plural business terms.

LANDING -- everything else: a page representing ONE specific business, product, or service directly (its own homepage, service page, product page, about page).

Judge by intent using title, headings, and main content -- not just keyword matching. Decide for EACH page given, same order.

Respond with ONLY valid JSON: {"classifications": ["BLOG"|"LANDING", ...]} -- one entry per page, same order."""


def get_openai_client():
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set. Fill it in in .env.")
    return OpenAI(api_key=OPENAI_API_KEY)


def _chat_json(system_prompt, user_payload, max_tokens=300):
    client = get_openai_client()
    last_error = None
    for attempt in range(1, MAX_LLM_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model=OPENAI_CHAT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_payload},
                ],
                temperature=0,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content.strip()
            return json.loads(raw)
        except (RateLimitError, APIConnectionError, APITimeoutError) as e:
            last_error = e
            if attempt < MAX_LLM_RETRIES:
                time.sleep(LLM_RETRY_BACKOFF_SECONDS * attempt)
        except json.JSONDecodeError as e:
            last_error = e
            break
    print(f"  [CLASSIFIER ERROR] LLM call failed: {last_error}")
    return None


def classify_landing_or_blog(top3_metadata):
    """top3_metadata: list of page-signal dicts (title/h1/main_content
    keys -- same shape scripts/intent_classifier.py's
    extract_page_signals() returns). Returns LANDING_PAGE or BLOG_PAGE --
    majority vote across the pages -- or None if there's nothing usable.
    Ties break toward BLOG_PAGE."""
    items = [m for m in (top3_metadata or []) if m and (m.get("title") or m.get("main_content"))]
    if not items:
        return None

    listing = [
        {
            "title": it.get("title"),
            "h1": it.get("h1"),
            "main_content": (it.get("main_content") or "")[:2000],
        }
        for it in items
    ]
    parsed = _chat_json(_LANDING_BLOG_SYSTEM_PROMPT, json.dumps(listing, ensure_ascii=False), max_tokens=200)
    labels_raw = (parsed or {}).get("classifications", [])

    labels = []
    for i in range(len(items)):
        label = str(labels_raw[i]).strip().upper() if i < len(labels_raw) else ""
        labels.append(BLOG_PAGE if label == "BLOG" else LANDING_PAGE)

    blog_count = labels.count(BLOG_PAGE)
    landing_count = labels.count(LANDING_PAGE)
    return BLOG_PAGE if blog_count >= landing_count else LANDING_PAGE
