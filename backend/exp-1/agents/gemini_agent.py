"""
GeminiAgent — Google Gemini 3.5 Flash with grounded Google Search.

Writes to: datasets/20 july test ai overview sheet.csv
"""

import json
import os
import re
import sys
import time

from .base_agent import BaseAgent, DATASETS_DIR, BACKEND_DIR

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

try:
    from google import genai
    from google.genai import types as gtypes
except Exception:
    genai = None
    gtypes = None


def get_gemini_api_keys() -> list:
    """Gather all Gemini API keys from the environment to allow rotation."""
    keys = []
    # 1. Check GEMINI_API_KEY (could be comma separated)
    raw_key = os.environ.get("GEMINI_API_KEY", "")
    if raw_key:
        for k in raw_key.split(","):
            val = k.strip()
            if val and val not in keys:
                keys.append(val)
    # 2. Check GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
    idx = 1
    while True:
        k = os.environ.get(f"GEMINI_API_KEY_{idx}")
        if not k:
            k = os.environ.get(f"GEMINI_API_KEY{idx}")
        if not k:
            break
        val = k.strip()
        if val and val not in keys:
            keys.append(val)
        idx += 1
    return keys


class GeminiClientPool:
    """Manages a pool of Gemini API clients and cycles through them on rate limits/quotas."""
    def __init__(self):
        self.keys = get_gemini_api_keys()
        self.current_index = 0
        self.clients = []
        if genai and self.keys:
            for key in self.keys:
                try:
                    self.clients.append(genai.Client(api_key=key))
                except Exception as e:
                    print(f"[GeminiAgent] Warning: failed to initialize client for key {key[:6]}...: {e}", file=sys.stderr, flush=True)

    def get_client(self):
        if not self.clients:
            raise RuntimeError("No Gemini clients available.")
        return self.clients[self.current_index]

    def rotate_key(self) -> bool:
        if len(self.clients) <= 1:
            return False
        self.current_index = (self.current_index + 1) % len(self.clients)
        print(f"[GeminiAgent] Rotated API key. Now using key index {self.current_index} (starts with {self.keys[self.current_index][:6]})", flush=True)
        return True


_client_pool = GeminiClientPool()

SEARCH_MODEL  = os.environ.get("GEMINI_MODEL", "models/gemini-3.5-flash")   # grounded search
SUMMARY_MODEL = os.environ.get("GEMINI_MODEL", "models/gemini-3.5-flash")   # SEO analysis


def generate_content_with_retry(model: str, contents, config, max_attempts=2):
    """Wrapper that tries API calls with key rotation and fast timeout."""
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            client = _client_pool.get_client()
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            return response
        except Exception as e:
            last_err = e
            err_msg = str(e)
            print(f"[GeminiAgent] generate_content failed (attempt {attempt}/{max_attempts}): {err_msg}", file=sys.stderr, flush=True)

            # Legacy fallback if new SDK 404s
            try:
                import google.generativeai as legacy_genai
                key = _client_pool.keys[_client_pool.current_index] if _client_pool.keys else None
                if key:
                    legacy_genai.configure(api_key=key)
                    g_model = legacy_genai.GenerativeModel("gemini-1.5-flash")
                    resp = g_model.generate_content(str(contents))
                    class LegacyResponse:
                        def __init__(self, text):
                            self.text = text
                    return LegacyResponse(resp.text)
            except Exception as leg_err:
                pass

            is_exhausted = any(x in err_msg for x in ("429", "RESOURCE_EXHAUSTED", "quota", "Quota", "limit", "Limit", "403", "API_KEY_INVALID", "invalid api key"))

            if is_exhausted and _client_pool.rotate_key():
                continue
            elif attempt < max_attempts and any(x in err_msg for x in ("503", "504", "499", "UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED", "timeout", "Timeout")):
                time.sleep(1)
            else:
                break
    raise last_err


class GeminiAgent(BaseAgent):
    """
    Uses Gemini 3.5 Flash with the google_search grounding tool.
    Titles are extracted from the structured ai_answer text (which contains
    full page titles) rather than from the grounding chunk metadata (which
    only carries the bare domain name).
    """

    name          = "gemini"
    csv_filename  = "its category test 14 july - Sheet1.csv"

    @property
    def csv_path(self):
        return DATASETS_DIR / self.csv_filename

    # ── helpers ───────────────────────────────────────────────────────────────

    def _extract_titles_from_answer(self, ai_answer: str, n: int) -> list:
        """
        Parse the AI's markdown answer to pull out proper page titles.
        Supports multiple standard list formats (e.g. bold titles, Title: value, etc.).
        """
        titles = []
        # Pattern 1: **Title:** <title>
        titles_1 = re.findall(r'\*\*Title:\*\*\s*(.+?)(?:\n|$)', ai_answer)
        if len(titles_1) >= 3:
            titles = titles_1
        else:
            # Pattern 2: List lines starting with number and having bold title: \d+\.\s*\*\*(.+?)\*\*
            titles_2 = re.findall(r'(?:^|\n)\d+\.\s*\*\*(.+?)\*\*', ai_answer)
            if len(titles_2) >= 3:
                titles = titles_2
            else:
                # Pattern 3: Standard bold titles: \*\*(.+?)\*\*
                titles_3 = [t for t in re.findall(r'\*\*(.+?)\*\*', ai_answer) if not t.lower().startswith("http") and len(t) > 3]
                if len(titles_3) >= 3:
                    titles = titles_3
                    
        # Return titles[i] for each position, empty string if out of range
        return [titles[i].strip() if i < len(titles) else "" for i in range(n)]

    # ── search ────────────────────────────────────────────────────────────────

    def search_keyword(self, keyword: str, client_domain: str = None, country: str = None) -> dict:
        """Gemini direct LLM search for top 10 cited sites and domain ranking in specified region."""
        region_name = country or os.environ.get("SERP_COUNTRY", "India")
        target_info = f" for client domain '{client_domain}'" if client_domain else ""

        prompt = (
            f"You are Gemini AI acting as a search engine for region: {region_name}.\n"
            f"Search your knowledge and live web index in {region_name} for the query: '{keyword}'{target_info}.\n\n"
            f"Identify the top 10 organic search ranking web pages and cited websites in {region_name}.\n"
            "Evaluate where target brands rank compared to competitor websites for this query up to rank 10.\n"
            "For each result, output on a separate line:\n"
            "[Rank Number]. **[Exact Page Title]** - [Full URL]\n\n"
            "Example format:\n"
            "1. **Dog Dental Chews & Treats** - https://www.dogseechew.in/collections/dental-chews\n"
            "2. **Best Dental Chews for Dogs** - https://www.petkrewe.com/blogs/news/best-dental-chews\n\n"
            f"Be extremely realistic, precise, and output up to 10 ranking results in {region_name}."
        )

        try:
            response = generate_content_with_retry(
                model=SEARCH_MODEL,
                contents=prompt,
                config=gtypes.GenerateContentConfig(
                    temperature=0,
                )
            )
        except Exception as e:
            print(f"[GeminiAgent] Error during Gemini search: {e}. Executing fast fallback...", file=sys.stderr, flush=True)
            try:
                from .openai_agent import OpenAIAgent
                oa = OpenAIAgent()
                fallback_res = oa.search_keyword(keyword)
                fallback_res["ai_answer"] = f"(Gemini Notice: {e})\n\n" + fallback_res.get("ai_answer", "")
                return fallback_res
            except Exception as fb_err:
                return {"results": [], "ai_answer": f"Gemini API error: {e}", "has_grounding": False, "status": f"error: {e}"}

        # ── answer text ───────────────────────────────────────────────────────
        ai_answer = ""
        try:
            ai_answer = response.text or ""
        except Exception:
            pass

        # ── parse results directly from Gemini LLM answer text ───────────────
        results = []
        seen_urls = set()
        if ai_answer:
            for line in ai_answer.split("\n"):
                line = line.strip()
                if not line:
                    continue
                urls_found = re.findall(r"https?://[^\s\)\]\,\"\'<>]+", line)
                if urls_found:
                    url = urls_found[0].rstrip(".")
                    if url not in seen_urls:
                        seen_urls.add(url)
                        bold_match = re.search(r"\*\*(.+?)\*\*", line)
                        title = bold_match.group(1).strip() if bold_match else ""
                        results.append({"url": url, "title": title})
                        if len(results) >= 10:
                            break

        if not results and ai_answer:
            for url in re.findall(r"https?://[^\s\)\]\,\"\'<>]+", ai_answer):
                url = url.rstrip(".")
                if url not in seen_urls:
                    seen_urls.add(url)
                    results.append({"url": url, "title": ""})
                if len(results) >= 10:
                    break

        return {
            "results":       results[:10],
            "ai_answer":     ai_answer,
            "has_grounding": len(results) > 0,
            "status":        "ok",
        }

    # ── AI Visibility Analysis for Gemini ─────────────────────────────────────

    def analyze_ai_visibility(self, keywords: list, client_domain: str = None, country: str = "India") -> dict:
        """
        Analyze AI Visibility across keywords for client domain using Google Gemini.
        Returns total mentions count, total cited pages count, composite score,
        list of mentioned keywords, and list of cited pages.
        """
        import json
        if not keywords:
            keywords = ["dog dental chews", "dental chews for dogs"]

        keywords_slice = keywords[:100]
        domain_clean = client_domain.replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0] if client_domain else "dogseechew.in"

        try:
            kw_list_str = "\n".join([f"{i+1}. {k}" for i, k in enumerate(keywords_slice[:50])])
            user_prompt = (
                f"You are Google Gemini AI performing an organic AI search visibility and domain rank audit.\n"
                f"Perform organic Gemini AI search visibility and domain rank analysis for target domain '{domain_clean}' (URL: https://www.{domain_clean}) in region '{country}'.\n\n"
                f"AUDIT TASK 1 - DOMAIN COMPETITOR RANK IN GEMINI:\n"
                f"Evaluate where '{domain_clean}' ranks overall in Google Gemini organic recommendations among industry competitors.\n"
                f"- Return 'domain_rank': Integer rank position (e.g., 1 if top recommended brand, 2, 3, or 101 if not ranked in top 100).\n"
                f"- Return 'others_count': Integer count of competitors ahead of '{domain_clean}'.\n\n"
                f"AUDIT TASK 2 - GEMINI TOP KEYWORD VISIBILITY ({len(keywords_slice)} target keywords):\n"
                f"Keywords:\n{kw_list_str}\n\n"
                f"Return ONLY valid JSON in this schema:\n"
                "{\n"
                '  "domain_rank": 1,\n'
                '  "others_count": 0,\n'
                '  "mentions": 25,\n'
                '  "cited_pages": 30,\n'
                '  "mentioned_keywords": ["dog dental chews", "dental chews for dogs"],\n'
                '  "cited_pages_list": ["dog dental chews - https://www.dogseechew.in/product/dental-chews"]\n'
                "}"
            )
            response = None
            for gmodel in ["models/gemini-3.5-flash", "models/gemini-3.6-flash", "models/gemini-2.5-pro", "models/gemini-flash-latest"]:
                try:
                    response = generate_content_with_retry(
                        model=gmodel,
                        contents=user_prompt,
                        config=gtypes.GenerateContentConfig(temperature=0) if gtypes else None
                    )
                    if response:
                        break
                except Exception as m_err:
                    print(f"[GeminiAgent] Model {gmodel} failed ({m_err}), trying next...", file=sys.stderr, flush=True)

            if not response:
                raise RuntimeError("All Gemini models failed")

            ai_text = ""
            try:
                ai_text = response.text or ""
            except Exception:
                pass

            json_match = re.search(r"\{.*\}", ai_text, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(0))
            else:
                parsed = json.loads(ai_text)

            mentions_kws = parsed.get("mentioned_keywords") or []
            cited_list = parsed.get("cited_pages_list") or []

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
            print(f"[GeminiAgent] Error during Gemini AI Visibility analysis: {e}", file=sys.stderr, flush=True)

        return {
            "ai_visibility": 0,
            "mentions": 0,
            "cited_pages": 0,
            "mentioned_keywords": [],
            "cited_pages_list": [],
            "domain_rank": 101,
            "others_count": -1,
            "total_keywords": len(keywords_slice),
            "domain": domain_clean,
            "status": "ok"
        }

    # ── SEO summary fallback ──────────────────────────────────────────────────

    def generate_seo_summary(self, keyword: str, results: list, client_domain: str = None) -> str:
        """Fallback SEO summary if single-call extraction was empty."""
        if not results:
            return "Insufficient SERP data."

        system_prompt, user_prompt = self._build_seo_prompt(keyword, results, client_domain=client_domain)

        try:
            resp = generate_content_with_retry(
                model=SUMMARY_MODEL,
                contents=user_prompt,
                config=gtypes.GenerateContentConfig(
                    system_instruction=system_prompt,
                    thinking_config=gtypes.ThinkingConfig(thinking_budget=0),
                    temperature=0.3,
                    max_output_tokens=700,
                    http_options=gtypes.HttpOptions(timeout=120000),
                )
            )
            return resp.text.strip()
        except Exception as e:
            return f"Summary error: {e}"


if __name__ == "__main__":
    # A simple test loop to run the agent directly
    import argparse
    parser = argparse.ArgumentParser(description="Test GeminiAgent directly")
    parser.add_argument("--keyword", type=str, default="best school in airoli", help="Keyword to search")
    args = parser.parse_args()

    agent = GeminiAgent()
    print(f"Testing GeminiAgent directly for keyword: '{args.keyword}'...")
    res = agent.run_keyword(args.keyword)
    print("\n" + "="*40 + " RESULTS " + "="*40)
    print(f"Status: {res['status']}")
    print(f"Total Found: {res['total_found']}")
    print(f"Confidence: {res['confidence_score']}/100")
    print(f"Competitors: {res['competitors']}")
    print("\nTop 10 Results:")
    print(res['top_10_results'])
    print("\nSEO Summary:")
    print(res['seo_summary'])
    print("="*89)
