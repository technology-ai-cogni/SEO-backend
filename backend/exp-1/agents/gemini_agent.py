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

try:
    from google import genai
    from google.genai import types as gtypes
except ImportError:
    sys.exit("ERROR: google-genai not installed.\nRun: pip3 install google-genai --break-system-packages")


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
        if not self.keys:
            sys.exit("ERROR: GEMINI_API_KEY or GEMINI_API_KEY_1 not found in .env")
        
        self.current_index = 0
        self.clients = []
        for key in self.keys:
            try:
                self.clients.append(genai.Client(api_key=key))
            except Exception as e:
                print(f"[GeminiAgent] Warning: failed to initialize client for key {key[:6]}...: {e}", file=sys.stderr, flush=True)
        
        if not self.clients:
            sys.exit("ERROR: No valid Gemini clients could be initialized.")

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

SEARCH_MODEL  = "gemini-3.5-flash"   # grounded search
SUMMARY_MODEL = "gemini-3.5-flash"   # SEO analysis


def generate_content_with_retry(model: str, contents, config, max_attempts=5):
    """Wrapper that tries API calls with key rotation and backoff."""
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
            
            # Check for rate limit or resource exhaustion (429, RESOURCE_EXHAUSTED) or bad key (403, invalid key)
            is_exhausted = any(x in err_msg for x in ("429", "RESOURCE_EXHAUSTED", "quota", "Quota", "limit", "Limit", "403", "API_KEY_INVALID", "invalid api key"))
            
            if is_exhausted:
                if _client_pool.rotate_key():
                    # Retry immediately with the new key
                    continue
                else:
                    sleep_time = attempt * 5
                    print(f"[GeminiAgent] Quota/Limit hit. No alternative keys available. Sleeping {sleep_time}s...", file=sys.stderr, flush=True)
                    time.sleep(sleep_time)
            elif any(x in err_msg for x in ("503", "504", "499", "UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED", "timeout", "Timeout")):
                sleep_time = attempt * 2
                print(f"[GeminiAgent] Transient error. Sleeping {sleep_time}s...", file=sys.stderr, flush=True)
                time.sleep(sleep_time)
            else:
                # Fatal error, don't retry
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

    def search_keyword(self, keyword: str) -> dict:
        """Gemini grounded search with automatic retry on 503/429/504/499 and key rotation."""
        prompt = (
            f"You are an expert SEO auditor. Search the web for the query: '{keyword}'.\n\n"
            "Identify the top 10 ranking organic search results. "
            "For each result provide:\n"
            "1. **Title:** [exact page title]\n"
            "2. **URL:** [full website URL]\n"
            "Do not include sponsored ads. Be extremely precise and use only real, live search data."
        )

        try:
            response = generate_content_with_retry(
                model=SEARCH_MODEL,
                contents=prompt,
                config=gtypes.GenerateContentConfig(
                    tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
                    temperature=0,
                    http_options=gtypes.HttpOptions(timeout=120000),
                )
            )
        except Exception as e:
            return {"results": [], "ai_answer": "", "has_grounding": False,
                    "status": f"API error: {e}"}

        # ── answer text ───────────────────────────────────────────────────────
        ai_answer = ""
        try:
            ai_answer = response.text or ""
        except Exception:
            pass

        # ── parse clean URLs from ai_answer text ──────────────────────────────
        clean_urls_in_answer = []
        if ai_answer:
            for url in re.findall(r"https?://[^\s\)\]\,\"\'<>]+", ai_answer):
                url = url.rstrip(".")
                if "vertexaisearch" not in url and url not in clean_urls_in_answer:
                    clean_urls_in_answer.append(url)

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
                title = getattr(web, "title", "") or ""  # actual title or domain
                if uri:
                    raw_chunks.append({"url": uri, "title": title})
                    has_grounding = True
        except Exception:
            pass

        raw_chunks = raw_chunks[:10]

        # ── resolve redirect URLs ─────────────────────────────────────────────
        # If the URL contains "grounding-api-redirect", first try to map it to
        # clean_urls_in_answer at the same index. Otherwise, resolve it in parallel.
        redirect_urls_to_resolve = []
        redirect_indices = []

        for idx, chunk in enumerate(raw_chunks):
            uri = chunk["url"]
            if "grounding-api-redirect" in uri:
                if idx < len(clean_urls_in_answer):
                    chunk["resolved_url"] = clean_urls_in_answer[idx]
                else:
                    redirect_urls_to_resolve.append(uri)
                    redirect_indices.append(idx)
            else:
                chunk["resolved_url"] = uri

        if redirect_urls_to_resolve:
            from concurrent.futures import ThreadPoolExecutor
            import requests

            def resolve_one(url):
                try:
                    r = requests.head(url, allow_redirects=True, timeout=3.0)
                    return r.url
                except Exception:
                    try:
                        r = requests.get(url, allow_redirects=True, stream=True, timeout=3.0)
                        return r.url
                    except Exception:
                        return url

            with ThreadPoolExecutor(max_workers=len(redirect_urls_to_resolve)) as executor:
                resolved_urls = list(executor.map(resolve_one, redirect_urls_to_resolve))

            for idx, r_url in zip(redirect_indices, resolved_urls):
                raw_chunks[idx]["resolved_url"] = r_url

        # ── build results list ────────────────────────────────────────────────
        page_titles = self._extract_titles_from_answer(ai_answer, len(raw_chunks))
        results = []
        for i, chunk in enumerate(raw_chunks):
            final_url = chunk.get("resolved_url") or chunk["url"]
            # Skip if still containing vertexaisearch
            if "vertexaisearch" in final_url:
                continue

            domain = self.extract_domain(final_url)
            real_title = page_titles[i] if i < len(page_titles) else ""
            # Accuracy prioritize: parsed real title > metadata title > domain
            page_title = real_title or chunk["title"] or domain
            
            # If the page_title is a domain, try to make it slightly cleaner
            if page_title.lower() == domain.lower() and chunk["title"]:
                page_title = chunk["title"]

            results.append({
                "url":   final_url,
                "title": page_title,
            })

        # ── regex fallback if no grounding ────────────────────────────────────
        if not results and ai_answer:
            seen = set()
            for url in re.findall(r"https?://[^\s\)\]\,\"\'<>]+", ai_answer):
                url = url.rstrip(".")
                if "vertexaisearch" not in url and url not in seen:
                    seen.add(url)
                    domain = self.extract_domain(url)
                    results.append({"url": url, "title": domain})
                if len(results) >= 10:
                    break

            # enrich fallback results with real page titles
            fallback_titles = self._extract_titles_from_answer(ai_answer, len(results))
            for i, r in enumerate(results):
                real_title = fallback_titles[i] if i < len(fallback_titles) else ""
                if real_title:
                    r["title"] = real_title

        return {
            "results":       results,
            "ai_answer":     ai_answer,
            "has_grounding": has_grounding,
            "status":        "ok",
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
