"""
AIOAgent — Google AI Overview agent using Gemini model.

Simulates Google AI Overview search results and citations up to rank 40.
"""

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
    raw_key = os.environ.get("GEMINI_API_KEY", "")
    if raw_key:
        for k in raw_key.split(","):
            val = k.strip()
            if val and val not in keys:
                keys.append(val)
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
    """Manages a pool of Gemini API clients."""
    def __init__(self):
        self.keys = get_gemini_api_keys()
        self.current_index = 0
        self.clients = []
        if genai and self.keys:
            for key in self.keys:
                try:
                    self.clients.append(genai.Client(api_key=key))
                except Exception as e:
                    print(f"[AIOAgent] Warning: failed to initialize client for key {key[:6]}...: {e}", file=sys.stderr, flush=True)

    def get_client(self):
        if not self.clients:
            raise RuntimeError("No Gemini clients available for AI Overview agent.")
        return self.clients[self.current_index]

    def rotate_key(self) -> bool:
        if len(self.clients) <= 1:
            return False
        self.current_index = (self.current_index + 1) % len(self.clients)
        return True


_client_pool = GeminiClientPool()

SEARCH_MODEL  = "gemini-3.5-flash"   # AI Overview model
SUMMARY_MODEL = "gemini-3.5-flash"   # SEO analysis


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
            print(f"[AIOAgent] generate_content failed (attempt {attempt}/{max_attempts}): {err_msg}", file=sys.stderr, flush=True)
            
            is_exhausted = any(x in err_msg for x in ("429", "RESOURCE_EXHAUSTED", "quota", "Quota", "limit", "Limit", "403", "API_KEY_INVALID", "invalid api key"))
            if is_exhausted and _client_pool.rotate_key():
                continue
            elif attempt < max_attempts and any(x in err_msg for x in ("503", "504", "499", "UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED", "timeout", "Timeout")):
                time.sleep(1)
            else:
                break
    raise last_err


class AIOAgent(BaseAgent):
    """
    Google AI Overview Agent using Gemini model.
    Prompts Gemini to search Google AI Overview for the target keyword and output citations up to rank 40.
    """

    name          = "ai overview"
    csv_filename  = "20 july test ai overview sheet.csv"

    @property
    def csv_path(self):
        return DATASETS_DIR / self.csv_filename

    # ── helpers ───────────────────────────────────────────────────────────────

    def _extract_titles_from_answer(self, ai_answer: str, n: int) -> list:
        titles = []
        titles_1 = re.findall(r'\*\*Title:\*\*\s*(.+?)(?:\n|$)', ai_answer)
        if len(titles_1) >= 3:
            titles = titles_1
        else:
            titles_2 = re.findall(r'(?:^|\n)\d+\.\s*\*\*(.+?)\*\*', ai_answer)
            if len(titles_2) >= 3:
                titles = titles_2
            else:
                titles_3 = [t for t in re.findall(r'\*\*(.+?)\*\*', ai_answer) if not t.lower().startswith("http") and len(t) > 3]
                if len(titles_3) >= 3:
                    titles = titles_3
        return [titles[i].strip() if i < len(titles) else "" for i in range(n)]

    # ── search ────────────────────────────────────────────────────────────────

    def search_keyword(self, keyword: str, client_domain: str = None, country: str = None) -> dict:
        """Search Google AI Overview for top 10 cited sites and domain ranking in specified region."""
        region = country or os.environ.get("AIO_REGION") or os.environ.get("SERP_COUNTRY", "India")
        if region.lower() in ("in", "india"):
            region_name = "India"
        elif region.lower() in ("us", "usa", "united states"):
            region_name = "United States"
        elif region.lower() in ("uk", "united kingdom", "gb"):
            region_name = "United Kingdom"
        else:
            region_name = region

        target_info = f" for client domain '{client_domain}'" if client_domain else ""

        prompt = (
            f"You are Google AI Overview acting as a search engine for region: {region_name}.\n"
            f"Search Google AI Overview in {region_name} for the query: '{keyword}'{target_info}.\n\n"
            f"Identify all top organic search results and cited web pages up to rank 10 for this query in Google AI Overview ({region_name}).\n"
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
            print(f"[AIOAgent] Error during AI Overview search: {e}. Executing fast fallback...", file=sys.stderr, flush=True)
            try:
                from .openai_agent import OpenAIAgent
                oa = OpenAIAgent()
                fallback_res = oa.search_keyword(keyword)
                fallback_res["ai_answer"] = f"(AI Overview Notice: {e})\n\n" + fallback_res.get("ai_answer", "")
                return fallback_res
            except Exception as fb_err:
                return {"results": [], "ai_answer": f"AI Overview error: {e}", "has_grounding": False, "status": f"error: {e}"}

        # ── answer text ───────────────────────────────────────────────────────
        ai_answer = ""
        try:
            ai_answer = response.text or ""
        except Exception:
            pass

        # ── parse results directly from AI Overview LLM answer text ─────────
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

        return {
            "results":       results[:10],
            "ai_answer":     ai_answer,
            "has_grounding": len(results) > 0,
            "status":        "ok",
        }

    # ── SEO summary ───────────────────────────────────────────────────────────

    def generate_seo_summary(self, keyword: str, results: list, client_domain: str = None) -> str:
        if not results:
            return "Insufficient SERP data."
        system_prompt, user_prompt = self._build_seo_prompt(keyword, results, client_domain=client_domain)
        try:
            resp = generate_content_with_retry(
                model=SUMMARY_MODEL,
                contents=f"{system_prompt}\n\n{user_prompt}",
                config=gtypes.GenerateContentConfig(temperature=0.3)
            )
            return resp.text.strip()
        except Exception as e:
            return f"Summary error: {e}"
