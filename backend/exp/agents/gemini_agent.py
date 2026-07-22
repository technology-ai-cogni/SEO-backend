"""
GeminiAgent — Google Gemini 3.5 Flash with grounded Google Search.

Writes to: datasets/20 july test ai overview sheet.csv
"""

import os
import re
import sys
import time

from .base_agent import BaseAgent, DATASETS_DIR, BACKEND_DIR

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    sys.exit("ERROR: GEMINI_API_KEY not found in .env")

try:
    from google import genai
    from google.genai import types as gtypes
except ImportError:
    sys.exit("ERROR: google-genai not installed.\nRun: pip3 install google-genai --break-system-packages")

_client = genai.Client(api_key=GEMINI_API_KEY)

SEARCH_MODEL  = "gemini-3.5-flash"   # grounded search
SUMMARY_MODEL = "gemini-3.5-flash"   # SEO analysis


class GeminiAgent(BaseAgent):
    """
    Uses Gemini 3.5 Flash with the google_search grounding tool.
    Titles are extracted from the structured ai_answer text (which contains
    full page titles) rather than from the grounding chunk metadata (which
    only carries the bare domain name).
    """

    name          = "gemini"
    csv_filename  = "20 july test ai overview sheet.csv"

    @property
    def csv_path(self):
        return DATASETS_DIR / self.csv_filename

    # ── helpers ───────────────────────────────────────────────────────────────

    def _extract_titles_from_answer(self, ai_answer: str, n: int) -> list:
        """
        Parse the AI's structured markdown answer to pull out proper page titles.
        The model responds in the form:
          1. **Source Name**
             * **Title:** Actual Page Title Here
             * **URL:** [...]
        Returns a list of up to n titles (or empty strings where not found).
        """
        # Pattern: **Title:** <title text>
        titles = re.findall(r'\*\*Title:\*\*\s*(.+?)(?:\n|$)', ai_answer)
        # Return titles[i] for each position, empty string if out of range
        return [titles[i].strip() if i < len(titles) else "" for i in range(n)]

    # ── search ────────────────────────────────────────────────────────────────

    def search_keyword(self, keyword: str) -> dict:
        """Gemini grounded search with automatic retry on 503/429/504/499."""
        prompt = (
            f"Search the web for: {keyword}\n\n"
            "Using live Google Search results, list the top 10 websites currently "
            "ranking for this query. For each result provide:\n"
            "- The source name in bold\n"
            "- **Title:** [exact page title]\n"
            "- **URL:** [full URL as markdown link]\n"
        )

        response = None
        last_err = None
        for attempt in range(1, 4):
            try:
                response = _client.models.generate_content(
                    model=SEARCH_MODEL,
                    contents=prompt,
                    config=gtypes.GenerateContentConfig(
                        tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
                        temperature=0,
                        http_options=gtypes.HttpOptions(timeout=60000),
                    ),
                )
                last_err = None
                break
            except Exception as e:
                last_err = e
                if any(x in str(e) for x in ("503", "504", "429", "499", "UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED", "timeout", "Timeout")):
                    time.sleep(attempt * 2)
                else:
                    break

        if last_err or response is None:
            return {"results": [], "ai_answer": "", "has_grounding": False,
                    "status": f"API error: {last_err}"}

        # ── answer text ───────────────────────────────────────────────────────
        ai_answer = ""
        try:
            ai_answer = response.text or ""
        except Exception:
            pass

        # ── grounding chunks → URLs ───────────────────────────────────────────
        raw_chunks    = []
        has_grounding = False
        seen_domains  = set()

        try:
            gm     = response.candidates[0].grounding_metadata
            chunks = gm.grounding_chunks or []
            for chunk in chunks:
                web = getattr(chunk, "web", None)
                if not web:
                    continue
                uri   = getattr(web, "uri",   "") or ""
                title = getattr(web, "title", "") or ""  # bare domain e.g. "swiggy.com"
                if uri:
                    domain = (title.strip().lower() if title and "." in title else
                              self.extract_domain(uri))
                    if domain not in seen_domains:
                        seen_domains.add(domain)
                        raw_chunks.append({"url": uri, "domain": domain, "title": title})
                        has_grounding = True
        except Exception:
            pass

        raw_chunks = raw_chunks[:10]

        # ── enrich with real page titles from ai_answer ───────────────────────
        page_titles = self._extract_titles_from_answer(ai_answer, len(raw_chunks))
        results = []
        for i, chunk in enumerate(raw_chunks):
            real_title = page_titles[i] if i < len(page_titles) else ""
            results.append({
                "url":   chunk["url"],
                "title": real_title or chunk["domain"],   # real title > bare domain
            })

        # ── regex fallback if no grounding ────────────────────────────────────
        if not results and ai_answer:
            seen = set()
            for url in re.findall(r"https?://[^\s\)\]\,\"\'<>]+", ai_answer):
                url = url.rstrip(".")
                if url not in seen:
                    seen.add(url)
                    results.append({"url": url, "title": ""})
                if len(results) >= 10:
                    break

        return {
            "results":       results,
            "ai_answer":     ai_answer,
            "has_grounding": has_grounding,
            "status":        "ok",
        }

    # ── SEO summary fallback ──────────────────────────────────────────────────

    def generate_seo_summary(self, keyword: str, results: list) -> str:
        """Fallback SEO summary if single-call extraction was empty."""
        if not results:
            return "Insufficient SERP data."

        system_prompt, user_prompt = self._build_seo_prompt(keyword, results)

        try:
            resp = _client.models.generate_content(
                model=SUMMARY_MODEL,
                contents=user_prompt,
                config=gtypes.GenerateContentConfig(
                    system_instruction=system_prompt,
                    thinking_config=gtypes.ThinkingConfig(thinking_budget=0),
                    temperature=0.3,
                    max_output_tokens=700,
                    http_options=gtypes.HttpOptions(timeout=60000),
                ),
            )
            return resp.text.strip()
        except Exception as e:
            return f"Summary error: {e}"
