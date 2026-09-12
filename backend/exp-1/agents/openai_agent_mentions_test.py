"""
OpenAIAgentMentionsTest — COPY of openai_agent.py made to test one thing:
given ONE keyword + a client domain, do a REAL live web search (not the
batched, non-grounded "audit" prompt analyze_ai_visibility() uses), collect
the genuine pages OpenAI's search found, and verify -- by actually fetching
each page -- whether the client's domain/name is genuinely present on it,
before calling it a "mention". See find_real_mention_urls() at the bottom.

NOTE ON MODEL: analyze_ai_visibility() in the original file runs on whatever
OPENAI_CHAT_MODEL is set to in .env (currently "gpt-4o-mini") -- a model with
NO live web search. Its "has_grounding"/annotations path is effectively dead
with that config; any URLs that surface are the model recalling training
data, not a real search. find_real_mention_urls() below hardcodes OpenAI's
actual search-grounded model ("gpt-4o-search-preview") so it's a genuine test
of live search, independent of that .env setting.

Writes to: datasets/20 july test - Sheet1.csv
"""

import os
import re
import sys
import time

import requests

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
SEARCH_MODEL  = os.environ.get("OPENAI_CHAT_MODEL", "o3-mini")
SUMMARY_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "o3-mini")

# OpenAI's older dedicated search-grounded CHAT model (gpt-4o-search-preview)
# is deprecated. Live web search now goes through the RESPONSES API with a
# web_search_preview TOOL attached to a normal model instead -- see
# find_real_mention_urls() below. Hardcoded (not read from .env) so this test
# doesn't silently degrade to a non-searching model like the rest of the file
# currently does.
REAL_SEARCH_MODEL = "gpt-4o-mini"


class OpenAIAgentMentionsTest(BaseAgent):
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
                temperature=0.0,
                seed=42,
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
            keywords = []

        keywords_slice = keywords
        domain_clean = client_domain.replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0] if client_domain else ""

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
            user_prompt = f"""You are OpenAI ChatGPT performing an organic AI search visibility and domain rank audit for target domain '{domain_clean}' in region '{country}'.

Target Keywords ({len(keywords_slice)} keywords):
{kw_list_str}

Evaluate the target keywords above and return ONLY valid JSON with these fields (DO NOT return URLs):
- 'mentions': Total count of mentioned keywords where '{domain_clean}' appears in ChatGPT recommendations.
- 'cited_pages': Total count of cited keywords for '{domain_clean}'.
- 'mentioned_keywords': Array of specific keyword strings from the list where '{domain_clean}' is mentioned.
- 'cited_pages_list': Array of specific keyword strings from the list where '{domain_clean}' is cited as a source.
- 'keyword_ai_ranks': Object mapping each mentioned keyword string to its AI recommendation rank position for '{domain_clean}' (e.g. 1 if top recommended, 2, 3...).
- 'domain_rank': Integer overall rank position for '{domain_clean}'.
- 'others_count': Integer count of competitors ahead of '{domain_clean}'.
"""

            response = None
            heavy_models = ["o3-mini", "gpt-4o", "gpt-4-turbo"]
            for hmodel in heavy_models:
                try:
                    kwargs = {
                        "model": hmodel,
                        "messages": [
                            {"role": "system", "content": system_msg},
                            {"role": "user", "content": user_prompt}
                        ]
                    }
                    if hmodel.startswith("o3") or hmodel.startswith("o1"):
                        kwargs["response_format"] = {"type": "json_object"}
                    else:
                        kwargs["temperature"] = 0.0
                        kwargs["response_format"] = {"type": "json_object"}

                    response = _client.chat.completions.create(**kwargs)
                    if response:
                        print(f"[OpenAIAgent] Success with heavy model: {hmodel}", flush=True)
                        break
                except Exception as model_err:
                    print(f"[OpenAIAgent] Model {hmodel} failed: {model_err}, trying next heavy model...", file=sys.stderr, flush=True)
            
            if not response:
                raise RuntimeError("All heavy OpenAI models failed.")

            ai_text = response.choices[0].message.content or ""
            json_match = re.search(r"\{.*\}", ai_text, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(0))
            else:
                parsed = json.loads(ai_text)
            mentions_raw = parsed.get("mentioned_keywords") or []
            cited_raw = parsed.get("cited_pages_list") or []
            kw_ranks_raw = parsed.get("keyword_ai_ranks") or {}
            kw_urls_raw = parsed.get("keyword_urls") or {}

            # Deduplicate mentioned keywords preserving order
            mentions_kws = []
            seen_m = set()
            for item in mentions_raw:
                clean_item = str(item).strip()
                if clean_item and clean_item.lower() not in seen_m:
                    seen_m.add(clean_item.lower())
                    mentions_kws.append(clean_item)

            # Build cleaned keyword_ai_ranks mapping
            keyword_ai_ranks = {}
            if isinstance(kw_ranks_raw, dict):
                for k_str, r_val in kw_ranks_raw.items():
                    k_clean = str(k_str).strip().lower()
                    try:
                        keyword_ai_ranks[k_clean] = int(r_val)
                    except (ValueError, TypeError):
                        keyword_ai_ranks[k_clean] = 1

            # Ensure all mentioned keywords have an AI rank entry (default to 1 if not specified)
            for m_kw in mentions_kws:
                m_clean = m_kw.lower()
                if m_clean not in keyword_ai_ranks:
                    keyword_ai_ranks[m_clean] = 1

            # Deduplicate cited pages list preserving order
            cited_list = []
            seen_c = set()
            for item in cited_raw:
                clean_item = str(item).strip()
                if clean_item and clean_item.lower() not in seen_c:
                    seen_c.add(clean_item.lower())
                    cited_list.append(clean_item)

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

    # ── TEST: real search + verified mention URLs for ONE keyword ─────────────

    def _search_and_verify(self, query: str, domain_clean: str, name_hint: str, top_n: int, verify_content: bool,
                            exclude_own_domain: bool = True) -> dict:
        """Shared core: run ONE real web_search_preview query, collect the
        genuine url_citation results, and verify each by fetching the page.

        exclude_own_domain=True (default): drop the client's OWN pages from
        the results entirely -- what you want is THIRD-PARTY pages that
        mention the client, not the client's own site showing up because it
        ranks for the query.

        Returns {ai_answer, did_search, used_regex_fallback, checked, mentions}."""
        prompt = (
            f"Search the web RIGHT NOW for: {query}\n\n"
            f"List up to {top_n} real, distinct web pages your search actually returned "
            "(not a written summary -- the literal pages/sources you found).\n"
            "For each, output on its own line in this exact format:\n"
            "[Rank]. **[Exact Page Title]** - [Full URL]\n\n"
            "Only include pages you genuinely found via live search. Do not invent or guess URLs."
        )

        try:
            # NOTE: gpt-4o-search-preview (the old dedicated search-grounded
            # CHAT model) is deprecated by OpenAI. Live web search is now done
            # via the RESPONSES API with the web_search_preview TOOL attached
            # to a normal model -- this is what actually performs a real,
            # live search (confirmed via the `web_search_call` item in
            # response.output) and returns genuine url_citation annotations.
            response = _client.responses.create(
                model=REAL_SEARCH_MODEL,
                tools=[{"type": "web_search_preview"}],
                input=prompt,
            )
        except Exception as e:
            return {"query": query, "client_domain": domain_clean, "checked": [], "mentions": [],
                    "error": f"API error calling {REAL_SEARCH_MODEL} (web_search_preview): {e}"}

        ai_answer = getattr(response, "output_text", "") or ""
        did_search = any(getattr(item, "type", "") == "web_search_call" for item in (response.output or []))

        results, seen = [], set()
        for item in (response.output or []):
            if getattr(item, "type", "") != "message":
                continue
            for content_block in (getattr(item, "content", None) or []):
                for ann in (getattr(content_block, "annotations", None) or []):
                    if getattr(ann, "type", "") == "url_citation":
                        url = (getattr(ann, "url", "") or "").split("?utm_source=openai")[0]
                        title = getattr(ann, "title", "") or ""
                        if url and url not in seen:
                            seen.add(url)
                            results.append({"url": url, "title": title})

        used_regex_fallback = False
        if not results and ai_answer:
            used_regex_fallback = True
            for url in re.findall(r"https?://[^\s\)\]\,\"\']+", ai_answer):
                url = url.rstrip(".")
                if url not in seen:
                    seen.add(url)
                    results.append({"url": url, "title": ""})
                if len(results) >= top_n:
                    break

        results = results[:top_n]

        if exclude_own_domain and domain_clean:
            results = [r for r in results if domain_clean not in r["url"].lower()]

        checked, mentions = [], []
        for r in results:
            entry = {"url": r["url"], "title": r["title"], "mentions_client": False, "reason": ""}
            if not exclude_own_domain and domain_clean and domain_clean in r["url"].lower():
                entry["mentions_client"] = True
                entry["reason"] = "this IS the client's own URL"
            elif verify_content:
                try:
                    resp = requests.get(r["url"], timeout=10, headers={"User-Agent": "Mozilla/5.0"})
                    low = (resp.text or "").lower()
                    if domain_clean and domain_clean in low:
                        entry["mentions_client"] = True
                        entry["reason"] = f"page text contains '{domain_clean}'"
                    elif name_hint and name_hint in low:
                        entry["mentions_client"] = True
                        entry["reason"] = f"page text contains '{name_hint}'"
                    else:
                        entry["reason"] = "fetched OK, client not found on page"
                except Exception as e:
                    entry["reason"] = f"could not fetch page to verify: {e}"
            checked.append(entry)
            if entry["mentions_client"]:
                mentions.append(entry)

        return {
            "query": query,
            "client_domain": domain_clean,
            "model": REAL_SEARCH_MODEL,
            "did_search": did_search,                     # True = a real web_search_call happened
            "used_regex_fallback": used_regex_fallback,    # True = no url_citation annotations came back
            "ai_answer": ai_answer,
            "checked": checked,
            "mentions": mentions,
        }

    def find_real_mention_urls(self, keyword: str, client_domain: str, client_name: str = None,
                                country: str = None, top_n: int = 10, verify_content: bool = True) -> dict:
        """
        Searches the web for `keyword` ALONE (exactly what a person typing
        that query would see), then FETCHES every real result page returned
        and checks whether `client_domain`/`client_name` literally appears in
        it. This mirrors real-world visibility: if the client isn't mentioned
        on any of the top organic results for the bare keyword, it genuinely
        isn't showing up for that search today -- a 0-result answer here is a
        real finding, not a failure of the method.
        """
        if not OPENAI_API_KEY or not _client:
            return {"keyword": keyword, "client_domain": client_domain, "checked": [], "mentions": [],
                    "error": "OPENAI_API_KEY missing or openai library not initialized."}

        domain_clean = (client_domain or "").replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0].strip().lower()
        name_hint = (client_name or domain_clean.split(".")[0] or "").strip().lower()

        result = self._search_and_verify(f"'{keyword}'", domain_clean, name_hint, top_n, verify_content)
        result["keyword"] = keyword
        return result

    def find_real_mention_urls_targeted(self, keyword: str, client_domain: str, client_name: str = None,
                                         top_n: int = 10, verify_content: bool = True) -> dict:
        """
        THE "HARD WAY": instead of hoping the client happens to already be in
        the bare keyword's top 10 (which is what find_real_mention_urls()
        does, and why it can legitimately come back empty), bias the live
        search itself toward pages that combine the keyword's TOPIC with the
        client's brand -- i.e. searches for pages that plausibly mention both
        -- then still verifies each one by fetching the real page and
        checking the client is actually on it. This is the same technique an
        SEO would use manually: `site:` / brand + topic search combos to hunt
        down every page where a brand is actually cited for a topic, rather
        than relying on the raw keyword ranking alone.

        Runs 3 combined queries (name+keyword, "keyword" AND name, and a
        review/citation-flavored query) and merges/dedupes their real,
        verified results -- more real search calls than find_real_mention_urls,
        by design, to actually hunt for the mention instead of just checking
        whether it happens to already be top-ranked.
        """
        if not OPENAI_API_KEY or not _client:
            return {"keyword": keyword, "client_domain": client_domain, "checked": [], "mentions": [],
                    "error": "OPENAI_API_KEY missing or openai library not initialized."}

        domain_clean = (client_domain or "").replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0].strip().lower()
        name_hint = (client_name or domain_clean.split(".")[0] or "").strip().lower()

        queries = [
            f"{name_hint} {keyword}",
            f'"{keyword}" {name_hint} review OR fees OR admission',
            f"site:{domain_clean} {keyword}",
        ]

        all_checked, all_mentions, seen_urls = [], [], set()
        per_query = []
        for q in queries:
            r = self._search_and_verify(q, domain_clean, name_hint, top_n, verify_content)
            per_query.append(r)
            for entry in r.get("checked", []):
                if entry["url"] not in seen_urls:
                    seen_urls.add(entry["url"])
                    all_checked.append(entry)
                    if entry["mentions_client"]:
                        all_mentions.append(entry)

        return {
            "keyword": keyword,
            "client_domain": domain_clean,
            "queries_run": queries,
            "per_query": per_query,
            "checked": all_checked,
            "mentions": all_mentions,
        }
