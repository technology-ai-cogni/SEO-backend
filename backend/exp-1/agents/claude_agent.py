"""
ClaudeAgent — Anthropic Claude (claude-3-5-sonnet-20241022 / claude-3-haiku-20240307).

Writes to: datasets/20 july test claude sheet.csv
"""

import os
import re
import sys
import time

from .base_agent import BaseAgent, DATASETS_DIR, BACKEND_DIR

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

try:
    import anthropic
except ImportError:
    sys.exit("ERROR: anthropic not installed.\nRun: pip3 install anthropic --break-system-packages")

MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")


class ClaudeAgent(BaseAgent):
    """
    Uses Anthropic Claude API to analyze search results and generate 4-section SEO summaries.
    """

    name         = "claude"
    csv_filename = "20 july test claude sheet.csv"

    def __init__(self):
        super().__init__()
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            self._client = None
        else:
            self._client = anthropic.Anthropic(api_key=key)

    @property
    def csv_path(self):
        return DATASETS_DIR / self.csv_filename

    # ── helpers ───────────────────────────────────────────────────────────────

    def _extract_titles_from_answer(self, ai_answer: str) -> list:
        """Parse titles and URLs from Claude markdown response."""
        results = []
        lines   = ai_answer.splitlines()
        current_title = ""
        current_url   = ""

        for line in lines:
            line = line.strip()
            # **Title:** <text> or **Title** <text> or 1. **<title>**
            m_title = re.search(r"(?:\*\*Title:\*\*|\*\*Title\*\*|\d+\.\s*\*\*(.+?)\*\*)\s*(.*)", line, re.IGNORECASE)
            if m_title:
                title_val = (m_title.group(1) or m_title.group(2)).replace("**", "").strip()
                if title_val and not title_val.lower().startswith("http"):
                    current_title = title_val.lstrip(":").strip()

            m_url = re.search(r"https?://[^\s\)\]\,\"\']+", line)
            if m_url:
                current_url = m_url.group(0).rstrip(".")
                if current_url:
                    results.append({"url": current_url, "title": current_title or current_url})
                    current_title = ""
                    current_url   = ""

        return results[:10]

    # ── search ────────────────────────────────────────────────────────────────

    def search_keyword(self, keyword: str) -> dict:
        """Fetch search SERP data using Claude."""
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            return {"results": [], "ai_answer": "", "has_grounding": False,
                    "status": "ERROR: ANTHROPIC_API_KEY missing in .env"}

        if not self._client:
            self._client = anthropic.Anthropic(api_key=key)

        prompt = (
            f"You are an expert SEO auditor. Search the web for the query: '{keyword}'.\n\n"
            "Identify the top 10 ranking organic search results. "
            "For each result provide:\n"
            "1. **Title:** [exact page title]\n"
            "2. **URL:** [full website URL]\n"
            "Do not include sponsored ads. Be extremely precise and use only real, live search data."
        )

        try:
            resp = self._client.messages.create(
                model=MODEL,
                max_tokens=1000,
                temperature=0,
                system="You are an expert search engine analyst. Provide the top 10 ranking websites directly without any disclaimers or meta-commentary about browsing capabilities.",
                messages=[{"role": "user", "content": prompt}],
            )
            ai_answer = resp.content[0].text if resp.content else ""
        except Exception as e:
            err_msg = str(e)
            if "credit balance is too low" in err_msg:
                err_msg = "Anthropic API credit balance is $0. Please add credits at https://console.anthropic.com/settings/plans"
            return {"results": [], "ai_answer": "", "has_grounding": False,
                    "status": f"API error: {err_msg}"}

        results = self._extract_titles_from_answer(ai_answer)

        return {
            "results":       results,
            "ai_answer":     ai_answer,
            "has_grounding": False,
            "status":        "ok",
        }

    # ── SEO summary ───────────────────────────────────────────────────────────

    def generate_seo_summary(self, keyword: str, results: list, client_domain: str = None) -> str:
        """Claude acting as SEO specialist."""
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            return "ERROR: ANTHROPIC_API_KEY missing in .env"

        if not self._client:
            self._client = anthropic.Anthropic(api_key=key)

        if not results:
            return "Insufficient SERP data."

        system_prompt, user_prompt = self._build_seo_prompt(keyword, results, client_domain=client_domain)

        try:
            resp = self._client.messages.create(
                model=MODEL,
                max_tokens=700,
                temperature=0.3,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            return resp.content[0].text.strip()
        except Exception as e:
            return f"Summary error: {e}"
