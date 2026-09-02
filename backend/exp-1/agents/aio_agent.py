"""
AIOAgent — Google AI Overview agent using Gemini model.

Simulates Google AI Overview search results and citations up to rank 40.
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

SEARCH_MODEL  = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")   # AI Overview model
SUMMARY_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")   # SEO analysis


def generate_content_with_retry(model: str, contents, config, max_attempts=2):
    """Wrapper that tries API calls with key rotation and fast timeout, with OpenAI fallback."""
    last_err = None

    # Check if Gemini clients exist; if not, fallback to OpenAI
    if not _client_pool.clients:
        openai_key = os.environ.get("OPENAI_API_KEY")
        if openai_key:
            try:
                from openai import OpenAI
                o_client = OpenAI(api_key=openai_key)
                prompt_text = str(contents)
                sys_inst = getattr(config, 'system_instruction', '') if config else ''
                messages = []
                if sys_inst:
                    messages.append({"role": "system", "content": str(sys_inst)})
                messages.append({"role": "user", "content": prompt_text})
                completion = o_client.chat.completions.create(
                    model=os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
                    messages=messages,
                    temperature=0
                )
                class FallbackResp:
                    def __init__(self, text):
                        self.text = text
                return FallbackResp(completion.choices[0].message.content or "")
            except Exception as o_err:
                print(f"[AIOAgent] OpenAI fallback failed: {o_err}", file=sys.stderr, flush=True)

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

            # Try OpenAI fallback on error
            openai_key = os.environ.get("OPENAI_API_KEY")
            if openai_key:
                try:
                    from openai import OpenAI
                    o_client = OpenAI(api_key=openai_key)
                    prompt_text = str(contents)
                    sys_inst = getattr(config, 'system_instruction', '') if config else ''
                    messages = []
                    if sys_inst:
                        messages.append({"role": "system", "content": str(sys_inst)})
                    messages.append({"role": "user", "content": prompt_text})
                    completion = o_client.chat.completions.create(
                        model=os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
                        messages=messages,
                        temperature=0.0
                    )
                    class FallbackResp:
                        def __init__(self, text):
                            self.text = text
                    return FallbackResp(completion.choices[0].message.content or "")
                except Exception as o_err:
                    pass

            is_exhausted = any(x in err_msg for x in ("429", "RESOURCE_EXHAUSTED", "quota", "Quota", "limit", "Limit", "403", "API_KEY_INVALID", "invalid api key"))
            if is_exhausted and _client_pool.rotate_key():
                continue
            elif attempt < max_attempts and any(x in err_msg for x in ("503", "504", "499", "UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED", "timeout", "Timeout")):
                time.sleep(1)
    if last_err is not None:
        raise last_err
    raise RuntimeError("API call failed after max attempts")


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

    # ── AI Visibility Analysis for Google AI Overview (SGE) ───────────────────

    def analyze_ai_visibility(self, keywords: list, client_domain: str = None, country: str = "India") -> dict:
        """
        Analyze AI Visibility across keywords for client domain using Google AI Overviews.
        """
        import json
        if not keywords:
            keywords = []

        keywords_slice = keywords
        domain_clean = client_domain.replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0] if client_domain else ""

        try:
            kw_list_str = "\n".join([f"{i+1}. {k}" for i, k in enumerate(keywords_slice[:100])])
            user_prompt = f"""You are Google AI Overviews (SGE) performing an organic AI search visibility audit for target domain '{domain_clean}' in region '{country}'.

Target Keywords:
{kw_list_str}

CRITICAL REQUIREMENT - EVALUATE MENTIONS AND CITATIONS SEPARATELY TO PRODUCE TWO DISTINCT LISTS:

1. MENTIONS (Brand Recommendations):
Which of the passed keywords cause Google AI Overviews to mention '{domain_clean}' in its summary snippet text? Return as 'mentioned_keywords' (Array of keyword strings).

2. CITATIONS (Source Cards & Links):
Which of the passed keywords cause Google AI Overviews to display '{domain_clean}' as a source citation card or link pill? Return as 'cited_pages_list' (Array of keyword strings). (Note: Mentions and Citations are distinct SGE search features).

3. AI RANKS:
Return 'keyword_ai_ranks' object mapping each mentioned keyword to its AI recommendation rank position.

Return ONLY valid JSON with these fields (DO NOT return URLs):
- 'mentions': Total count of mentioned keywords.
- 'cited_pages': Total count of cited keywords.
- 'mentioned_keywords': Array of mentioned keyword strings.
- 'cited_pages_list': Array of cited keyword strings.
- 'keyword_ai_ranks': Object mapping mentioned keywords to rank integers.
- 'domain_rank': Integer overall rank position.
- 'others_count': Integer count of competitors ahead.
"""
            response = None
            for gmodel in ["gemini-3.6-flash", "gemini-1.5-pro", "gemini-3.6-flash"]:
                try:
                    response = generate_content_with_retry(
                        model=gmodel,
                        contents=user_prompt,
                        config=gtypes.GenerateContentConfig(temperature=0) if gtypes else None
                    )
                    if response:
                        break
                except Exception as m_err:
                    print(f"[AIOAgent] Model {gmodel} failed ({m_err}), trying next...", file=sys.stderr, flush=True)

            ai_text = ""
            if response:
                try:
                    ai_text = response.text or ""
                except Exception:
                    pass

            parsed = {}
            if ai_text:
                clean_json_text = re.sub(r"^```json\s*", "", ai_text.strip(), flags=re.IGNORECASE)
                clean_json_text = re.sub(r"```$", "", clean_json_text).strip()

                json_match = re.search(r"\{.*\}", clean_json_text, re.DOTALL)
                if json_match:
                    try:
                        parsed = json.loads(json_match.group(0))
                    except Exception:
                        pass
                if not parsed:
                    try:
                        parsed = json.loads(clean_json_text)
                    except Exception:
                        parsed = {}

            mentions_raw = parsed.get("mentioned_keywords") or []
            cited_raw = parsed.get("cited_pages_list") or []
            kw_ranks_raw = parsed.get("keyword_ai_ranks") or {}
            kw_urls_raw = parsed.get("keyword_urls") or {}

            mentions_kws = []
            seen_m = set()
            for item in mentions_raw:
                clean_item = str(item).strip()
                if clean_item and clean_item.lower() not in seen_m:
                    seen_m.add(clean_item.lower())
                    mentions_kws.append(clean_item)

            keyword_ai_ranks = {}
            if isinstance(kw_ranks_raw, dict):
                for k_str, r_val in kw_ranks_raw.items():
                    k_clean = str(k_str).strip().lower()
                    try:
                        keyword_ai_ranks[k_clean] = int(r_val)
                    except (ValueError, TypeError):
                        keyword_ai_ranks[k_clean] = 1

            for m_kw in mentions_kws:
                m_clean = m_kw.lower()
                if m_clean not in keyword_ai_ranks:
                    keyword_ai_ranks[m_clean] = 1

            cited_list = []
            seen_c = set()
            for item in cited_raw:
                clean_item = str(item).strip()
                if clean_item and clean_item.lower() not in seen_c:
                    seen_c.add(clean_item.lower())
                    cited_list.append(clean_item)

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
                "keyword_ai_ranks": keyword_ai_ranks,
                "keyword_urls": kw_urls_raw,
                "cited_pages_list": cited_list,
                "domain_rank": domain_rank_val,
                "others_count": others_count_val,
                "total_keywords": total_kws,
                "domain": domain_clean,
                "status": "ok"
            }
        except Exception as e:
            print(f"[AIOAgent] Error during AI Overview AI Visibility analysis: {e}", file=sys.stderr, flush=True)

        total_kws = len(keywords_slice)
        return {
            "ai_visibility": 0,
            "mentions": 0,
            "cited_pages": 0,
            "mentioned_keywords": [],
            "keyword_urls": {},
            "cited_pages_list": [],
            "domain_rank": 101,
            "others_count": -1,
            "total_keywords": total_kws,
            "domain": domain_clean,
            "status": "ok"
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
                config=gtypes.GenerateContentConfig(temperature=0.0)
            )
            return resp.text.strip()
        except Exception as e:
            return f"Summary error: {e}"
