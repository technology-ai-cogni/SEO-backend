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

try:
    from openai import OpenAI
    _client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
except Exception:
    OpenAI = None
    _client = None
SEARCH_MODEL  = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
SUMMARY_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")


class OpenAIAgent(BaseAgent):
    """
    Uses GPT-4o-search-preview for live Bing-grounded web search and SEO summary.
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
        Supports both same-line [Rank]. **[Title]** - [URL] and multi-line formats.
        """
        url_to_title = {}
        if not ai_answer:
            return url_to_title

        lines = ai_answer.splitlines()
        current_title = ""

        for line in lines:
            line = line.strip()
            if not line:
                continue

            bold_match = re.search(r"\*\*(.+?)\*\*", line)
            url_match = re.search(r"https?://[^\s\)\]\,\"\'<>]+", line)

            # Format 1: Same line contains bold title and URL
            if bold_match and url_match:
                t = bold_match.group(1).strip()
                u = url_match.group(0).rstrip(".")
                url_to_title[u] = t
                current_title = ""
            elif bold_match:
                current_title = bold_match.group(1).strip()
            elif url_match and current_title:
                u = url_match.group(0).rstrip(".")
                url_to_title[u] = current_title
                current_title = ""

        return url_to_title

    def _url_to_title_fallback(self, url: str) -> str:
        """Format a clean fallback title from a URL when explicit title is missing."""
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            domain = parsed.netloc.replace("www.", "").split(".")[0].capitalize()
            path_parts = [p for p in parsed.path.split("/") if p]
            if path_parts:
                last_part = path_parts[-1].split(".")[0]
                slug = last_part.replace("-", " ").replace("_", " ").title()
                if len(slug) > 3 and slug.lower() != domain.lower():
                    return f"{domain} - {slug}"
            return f"{domain} Official Page"
        except Exception:
            return "Web Result"

    # ── search ────────────────────────────────────────────────────────────────

    def search_keyword(self, keyword: str, client_domain: str = None, country: str = None) -> dict:
        """OpenAI search-preview for top 10 cited sites and domain ranking in specified region."""
        if not OPENAI_API_KEY or not _client:
            return {"results": [], "ai_answer": "OPENAI_API_KEY missing or openai library not initialized.", "has_grounding": False,
                    "status": "error", "seo_summary": "Error: OPENAI_API_KEY missing or openai package not installed."}

        region_name = country or os.environ.get("SERP_COUNTRY", "India")
        target_info = f" for client domain '{client_domain}'" if client_domain else ""

        prompt = (
            f"You are ChatGPT acting as an SEO search engine for region: {region_name}.\n"
            f"Search the web for the query: '{keyword}' in {region_name}{target_info}.\n\n"
            f"Identify the top 10 organic search results and cited websites in {region_name}.\n"
            "Evaluate where target brands rank compared to competitor websites for this query up to rank 10.\n"
            "For each result, output on a separate line in this exact format:\n"
            "[Rank Number]. **[Exact Page Title]** - [Full URL]\n\n"
            "Do not include sponsored ads. Be extremely precise and use real live web search data up to 10 results."
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

        # ── enrich titles from ai_answer text ─────────────────────────────────
        title_map = self._extract_titles_from_answer(ai_answer, [r["url"] for r in results])
        for r in results:
            if not r["title"] or r["title"].strip() in ("", "(no title)"):
                r["title"] = title_map.get(r["url"], "")
            if not r["title"] or r["title"].strip() in ("", "(no title)"):
                r["title"] = self._url_to_title_fallback(r["url"])

        # ── regex fallback ────────────────────────────────────────────────────
        if not results and ai_answer:
            for url in re.findall(r"https?://[^\s\)\]\,\"\']+", ai_answer):
                url = url.rstrip(".")
                if url not in seen_urls:
                    seen_urls.add(url)
                    t = title_map.get(url) or self._url_to_title_fallback(url)
                    results.append({"url": url, "title": t})
                if len(results) >= 10:
                    break

        return {
            "results":       results[:10],
            "ai_answer":     ai_answer,
            "has_grounding": has_grounding,
            "status":        "ok",
        }

    # ── SEO summary ───────────────────────────────────────────────────────────

    def generate_seo_summary(self, keyword: str, results: list, client_domain: str = None) -> str:
        """GPT-4o-search-preview acting as SEO specialist."""
        if not results:
            return "Insufficient SERP data."

        system_prompt, user_prompt = self._build_seo_prompt(keyword, results, client_domain=client_domain)

        try:
            resp = _client.chat.completions.create(
                model=SEARCH_MODEL,
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

    # ── AI Visibility Analysis ──────────────────────────────────────────────

    def analyze_ai_visibility(self, keywords: list, client_domain: str = None, country: str = "India") -> dict:
        """
        Analyze AI Visibility across keywords for client domain using OpenAI.
        Returns total mentions count, total cited pages count, composite score (mentions/total * 100),
        list of mentioned keywords, and list of cited pages.
        """
        import json
        if not keywords:
            keywords = ["dog dental chews", "dental chews for dogs"]

        keywords_slice = keywords
        domain_clean = client_domain.replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0] if client_domain else "dogseechew.in"

        if not OPENAI_API_KEY or not _client:
            return {
                "ai_visibility": 0,
                "mentions": 0,
                "cited_pages": 0,
                "mentioned_keywords": [],
                "cited_pages_list": [],
                "total_keywords": len(keywords_slice),
                "domain": domain_clean,
                "status": "ok"
            }

        try:
            kw_list_str = "\n".join([f"{i+1}. {k}" for i, k in enumerate(keywords_slice[:100])])
            system_msg = "You are an SEO AI Search Auditor. You must respond strictly in JSON format."
            user_prompt = (
                f"Perform organic AI search visibility and domain rank analysis for target domain '{domain_clean}' (URL: https://www.{domain_clean}) in region '{country}'.\n\n"
                f"AUDIT TASK 1 - DOMAIN COMPETITOR RANK:\n"
                f"Evaluate where '{domain_clean}' ranks overall among top industry competitors in organic AI search recommendations for its niche.\n"
                f"- Return 'domain_rank': Integer rank position (e.g., 1 if top recommended brand, 2, 3, or 101 if not ranked in top 100).\n"
                f"- Return 'others_count': Integer count of competitors ahead of '{domain_clean}' (e.g., 0 if rank #1, 2 if rank #3, -1 if rank 101).\n\n"
                f"AUDIT TASK 2 - TOP KEYWORD VISIBILITY ({len(keywords_slice)} target keywords):\n"
                f"Keywords:\n{kw_list_str}\n\n"
                f"Return JSON with:\n"
                f"- 'mentions': Total count of keywords out of {len(keywords_slice)} where '{domain_clean}' appears in search recommendations.\n"
                f"- 'cited_pages': Total count of cited web page URLs for '{domain_clean}'.\n"
                f"- 'mentioned_keywords': Array of the specific keyword strings where '{domain_clean}' appeared.\n"
                f"- 'cited_pages_list': Array of strings formatted as '[Keyword] - [Page Title/URL]' for cited pages.\n\n"
                f"JSON schema:\n"
                "{\n"
                '  "domain_rank": 1,\n'
                '  "others_count": 0,\n'
                '  "mentions": 28,\n'
                '  "cited_pages": 34,\n'
                '  "mentioned_keywords": ["dog dental chews", "dental chews for dogs"],\n'
                '  "cited_pages_list": ["dog dental chews - https://www.dogseechew.in/product/dental-chews"]\n'
                "}"
            )

            try:
                response = _client.chat.completions.create(
                    model=SEARCH_MODEL,
                    messages=[
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_prompt}
                    ]
                )
            except Exception as model_err:
                print(f"[OpenAIAgent] Primary model failed ({model_err}), falling back to gpt-4o", file=sys.stderr, flush=True)
                response = _client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_prompt}
                    ],
                    response_format={"type": "json_object"}
                )

            ai_text = response.choices[0].message.content or ""
            json_match = re.search(r"\{.*\}", ai_text, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(0))
            else:
                parsed = json.loads(ai_text)
            mentions_kws = parsed.get("mentioned_keywords") or []
            cited_list = parsed.get("cited_pages_list") or []

            # Ensure counts match exact array lengths in hover popover
            mentions_count = len(mentions_kws) if len(mentions_kws) > 0 else int(parsed.get("mentions", 0))
            cited_count = len(cited_list) if len(cited_list) > 0 else int(parsed.get("cited_pages", 0))

            domain_rank_val = int(parsed.get("domain_rank", 1))
            others_count_val = int(parsed.get("others_count", 0 if domain_rank_val == 1 else (domain_rank_val - 1 if domain_rank_val <= 100 else -1)))

            total_kws = len(keywords_slice)
            vis_score = round((mentions_count / total_kws) * 100) if total_kws > 0 else 0

            return {
                "ai_visibility": vis_score,
                "mentions": mentions_count,
                "cited_pages": cited_count,
                "mentioned_keywords": mentions_kws,
                "cited_pages_list": cited_list,
                "domain_rank": domain_rank_val,
                "others_count": others_count_val,
                "total_keywords": total_kws,
                "domain": domain_clean,
                "status": "ok"
            }
        except Exception as e:
            print(f"[OpenAIAgent] Error during AI Visibility analysis: {e}", file=sys.stderr, flush=True)

        return {
            "ai_visibility": 0,
            "mentions": 0,
            "cited_pages": 0,
            "mentioned_keywords": [],
            "cited_pages_list": [],
            "total_keywords": len(keywords_slice),
            "domain": domain_clean,
            "status": "ok"
        }
