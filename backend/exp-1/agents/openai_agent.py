"""
OpenAIAgent — GPT-4o-search-preview with live web search citations.

Writes to: datasets/20 july test - Sheet1.csv
"""

import os
import re
import sys
import time

from .base_agent import BaseAgent, DATASETS_DIR, BACKEND_DIR

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    sys.exit("ERROR: OPENAI_API_KEY not found in .env")

try:
    from openai import OpenAI
except ImportError:
    sys.exit("ERROR: openai not installed.\nRun: pip3 install openai --break-system-packages")

_client      = OpenAI(api_key=OPENAI_API_KEY)
SEARCH_MODEL  = "gpt-4o-search-preview"
SUMMARY_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")


class OpenAIAgent(BaseAgent):
    """
    Uses GPT-4o-search-preview for live Bing-grounded web search.
    URL citations come from message.annotations[].url_citation.
    Falls back to regex on message.content if annotations are empty.
    """

    name         = "openai"
    csv_filename = "20 july test - Sheet1.csv"

    @property
    def csv_path(self):
        return DATASETS_DIR / self.csv_filename

    # ── helpers ───────────────────────────────────────────────────────────────

    def _extract_titles_from_answer(self, ai_answer: str, urls: list) -> dict:
        """
        Parse the AI's markdown answer to find the title for each URL.
        Pattern: **Bold Title** followed by a URL on the next line.
        Returns {url: title} mapping.
        """
        url_to_title = {}
        lines        = ai_answer.splitlines()
        current_title = ""
        for line in lines:
            line = line.strip()
            m = re.match(r"^\*\*(.+?)\*\*$", line)
            if m:
                current_title = m.group(1).strip()
                continue
            url_match = re.search(r"https?://[^\s\)\]\,\"\']+", line)
            if url_match and current_title:
                found_url = url_match.group(0).rstrip(".")
                url_to_title[found_url] = current_title
                current_title = ""
        return url_to_title

    # ── search ────────────────────────────────────────────────────────────────

    def search_keyword(self, keyword: str) -> dict:
        """OpenAI search-preview with annotation-based citation extraction."""
        prompt = (
            f"You are an expert SEO auditor. Search the web for the query: '{keyword}'.\n\n"
            "Identify the top 10 ranking organic search results. "
            "For each result, output the exact page title (in bold) and its URL on a new line. "
            "Do not include sponsored ads. Be extremely precise and use only real, live search data."
        )

        try:
            response = _client.chat.completions.create(
                model=SEARCH_MODEL,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as e:
            return {"results": [], "ai_answer": "", "has_grounding": False,
                    "status": f"API error: {e}"}

        message    = response.choices[0].message
        ai_answer  = message.content or ""
        annotations = getattr(message, "annotations", None) or []

        results       = []
        seen_urls     = set()
        has_grounding = False

        # ── structured annotation citations ───────────────────────────────────
        for ann in annotations:
            if getattr(ann, "type", "") == "url_citation":
                citation = getattr(ann, "url_citation", ann)
                url   = getattr(citation, "url",   "") or getattr(ann, "url",   "")
                title = getattr(citation, "title", "") or getattr(ann, "title", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    results.append({"url": url, "title": title})
                    has_grounding = True

        results = results[:10]

        # ── enrich (no title) entries from ai_answer text ─────────────────────
        if results:
            title_map = self._extract_titles_from_answer(ai_answer, [r["url"] for r in results])
            for r in results:
                if not r["title"] or r["title"] == "(no title)":
                    r["title"] = title_map.get(r["url"], "")

        # ── regex fallback ────────────────────────────────────────────────────
        if not results and ai_answer:
            for url in re.findall(r"https?://[^\s\)\]\,\"\']+", ai_answer):
                url = url.rstrip(".")
                if url not in seen_urls:
                    seen_urls.add(url)
                    results.append({"url": url, "title": ""})
                if len(results) >= 10:
                    break
            if results:
                title_map = self._extract_titles_from_answer(ai_answer, [r["url"] for r in results])
                for r in results:
                    r["title"] = title_map.get(r["url"], "")

        return {
            "results":       results,
            "ai_answer":     ai_answer,
            "has_grounding": has_grounding,
            "status":        "ok",
        }

    # ── SEO summary ───────────────────────────────────────────────────────────

    def generate_seo_summary(self, keyword: str, results: list, client_domain: str = None) -> str:
        """GPT-4o-mini acting as SEO specialist."""
        if not results:
            return "Insufficient SERP data."

        system_prompt, user_prompt = self._build_seo_prompt(keyword, results, client_domain=client_domain)

        try:
            resp = _client.chat.completions.create(
                model=SUMMARY_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=500,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            return f"Summary error: {e}"
