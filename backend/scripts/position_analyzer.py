"""
Position Analyzer — standalone FastAPI micro-service
=====================================================

Accepts a domain URL, queries Claude / OpenAI / Gemini in parallel,
and returns a unified Semrush-style JSON response with:
  • AI visibility score, mentions, cited pages (per engine)
  • Authority score, organic traffic/keywords estimates
  • Top keywords with position + intent
  • Competitor domains

Usage:
  cd /Users/manish/SEO-backend/backend
  python3 -m uvicorn scripts.position_analyzer:app --port 8100 --reload
"""

import os
import sys
import json
import re
import traceback
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# ── env ───────────────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY    = os.environ.get("OPENAI_API_KEY", "")
GEMINI_API_KEY    = os.environ.get("GEMINI_API_KEY", "")

# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Position Analyzer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    url: str
    country: Optional[str] = "India"


# ── shared structured prompt ─────────────────────────────────────────────────
_ANALYSIS_PROMPT = """You are an expert SEO analyst. Analyze the domain "{domain}" for the country "{country}".

Return ONLY valid JSON (no markdown fences, no extra text) with this exact structure:
{{
  "ai_visibility_score": <int 0-100>,
  "mentions": <int — how many times you'd cite/mention this domain in search-related answers>,
  "cited_pages": <int — distinct pages from this domain you'd reference>,
  "authority_score": <int 0-100 — estimated domain authority>,
  "organic_traffic_estimate": <int — estimated monthly organic visits>,
  "organic_keywords_count": <int — estimated number of keywords ranking>,
  "ref_domains_estimate": <int — estimated referring domains>,
  "backlinks_estimate": <int — estimated total backlinks>,
  "competitors": [
    {{"domain": "<competitor.com>", "authority": <int>}}
  ],
  "keywords": [
    {{
      "keyword": "<search query>",
      "position": <int 1-100>,
      "search_volume": <int>,
      "kd": <int 0-100>,
      "intent": "<Informational|Commercial|Transactional|Navigational>",
      "visibility": <float 0-100>
    }}
  ]
}}

IMPORTANT RULES:
- Return 5 competitors max.
- Return 15-20 keywords that this domain is most likely to rank for.
- Be realistic with estimates. Use your knowledge of this domain and its niche.
- For position, use 1-100 where 1 is the best.
- For visibility, higher position = higher visibility (position 1 ≈ 11%, position 2 ≈ 7%, etc.)
- Return ONLY the JSON object, nothing else.
"""


# ── engine callers ────────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    """Extract JSON from a response that may have markdown fences."""
    raw = raw.strip()
    # Strip ```json ... ``` wrappers
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if m:
        raw = m.group(1)
    # Find first { to last }
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1:
        raw = raw[start : end + 1]
    return json.loads(raw)


def _call_claude(domain: str, country: str) -> dict:
    """Query Claude (Anthropic) for domain analysis."""
    if not ANTHROPIC_API_KEY:
        return {"error": "ANTHROPIC_API_KEY not set", "engine": "claude"}
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            temperature=0,
            system="You are an expert SEO analyst. Return ONLY valid JSON. No explanations, no markdown fences.",
            messages=[
                {
                    "role": "user",
                    "content": _ANALYSIS_PROMPT.format(domain=domain, country=country),
                }
            ],
        )
        text = resp.content[0].text if resp.content else ""
        data = _parse_json(text)
        data["engine"] = "claude"
        data["raw_ok"] = True
        return data
    except Exception as e:
        traceback.print_exc()
        return {"error": str(e), "engine": "claude"}


def _call_openai(domain: str, country: str) -> dict:
    """Query OpenAI (GPT-4o-search-preview) for domain analysis."""
    if not OPENAI_API_KEY:
        return {"error": "OPENAI_API_KEY not set", "engine": "openai"}
    try:
        from openai import OpenAI

        client = OpenAI(api_key=OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model="gpt-4o-search-preview",
            messages=[
                {
                    "role": "user",
                    "content": _ANALYSIS_PROMPT.format(domain=domain, country=country),
                }
            ],
        )
        text = resp.choices[0].message.content or ""
        data = _parse_json(text)
        data["engine"] = "openai"
        data["raw_ok"] = True
        return data
    except Exception as e:
        traceback.print_exc()
        return {"error": str(e), "engine": "openai"}


def _call_gemini(domain: str, country: str) -> dict:
    """Query Gemini 3.5 Flash with Google Search grounding."""
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not set", "engine": "gemini"}
    try:
        from google import genai
        from google.genai import types as gtypes

        client = genai.Client(api_key=GEMINI_API_KEY)
        resp = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=_ANALYSIS_PROMPT.format(domain=domain, country=country),
            config=gtypes.GenerateContentConfig(
                tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
                temperature=0,
                max_output_tokens=2000,
                http_options=gtypes.HttpOptions(timeout=60000),
            ),
        )
        text = resp.text or ""
        data = _parse_json(text)
        data["engine"] = "gemini"
        data["raw_ok"] = True
        return data
    except Exception as e:
        traceback.print_exc()
        return {"error": str(e), "engine": "gemini"}


# ── merge logic ───────────────────────────────────────────────────────────────

def _safe_int(val, default=0):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _avg_scores(results: list, key: str) -> int:
    vals = [_safe_int(r.get(key, 0)) for r in results if r.get("raw_ok")]
    return int(sum(vals) / len(vals)) if vals else 0


def _merge_results(results: list) -> dict:
    """Merge 3 engine results into a unified response."""
    ok_results = [r for r in results if r.get("raw_ok")]

    # ── AI Search card (per-engine breakdown) ─────────────────────────────────
    engine_map = {"claude": "ChatGPT", "openai": "AI Overview", "gemini": "Gemini"}
    ai_search = {
        "ai_visibility": _avg_scores(ok_results, "ai_visibility_score"),
        "mentions": sum(_safe_int(r.get("mentions", 0)) for r in ok_results),
        "cited_pages": sum(_safe_int(r.get("cited_pages", 0)) for r in ok_results),
        "per_engine": [],
    }
    for r in results:
        eng = r.get("engine", "unknown")
        ai_search["per_engine"].append({
            "engine": eng,
            "label": engine_map.get(eng, eng),
            "mentions": _safe_int(r.get("mentions", 0)) if r.get("raw_ok") else 0,
            "cited_pages": _safe_int(r.get("cited_pages", 0)) if r.get("raw_ok") else 0,
            "error": r.get("error"),
        })

    # ── SEO card (averages) ───────────────────────────────────────────────────
    seo = {
        "authority_score": _avg_scores(ok_results, "authority_score"),
        "organic_traffic": _avg_scores(ok_results, "organic_traffic_estimate"),
        "organic_keywords": _avg_scores(ok_results, "organic_keywords_count"),
        "ref_domains": _avg_scores(ok_results, "ref_domains_estimate"),
        "backlinks": _avg_scores(ok_results, "backlinks_estimate"),
    }

    # ── keywords (merge + dedupe, keep best position) ─────────────────────────
    kw_map = {}  # keyword_lower → best entry
    for r in ok_results:
        for kw in (r.get("keywords") or []):
            key = (kw.get("keyword") or "").strip().lower()
            if not key:
                continue
            pos = _safe_int(kw.get("position", 100), 100)
            if key not in kw_map or pos < _safe_int(kw_map[key].get("position", 100), 100):
                kw_map[key] = {
                    "keyword": kw.get("keyword", "").strip(),
                    "position": pos,
                    "search_volume": _safe_int(kw.get("search_volume", 0)),
                    "kd": _safe_int(kw.get("kd", 0)),
                    "intent": kw.get("intent", "Informational"),
                    "visibility": round(float(kw.get("visibility", 0)), 2),
                }
    keywords = sorted(kw_map.values(), key=lambda x: x["position"])

    # ── keyword difficulty distribution ───────────────────────────────────────
    kd_dist = {"easy": 0, "medium": 0, "hard": 0, "very_hard": 0}
    for kw in keywords:
        kd = kw["kd"]
        if kd <= 20:
            kd_dist["easy"] += 1
        elif kd <= 40:
            kd_dist["medium"] += 1
        elif kd <= 60:
            kd_dist["hard"] += 1
        else:
            kd_dist["very_hard"] += 1

    # ── position tracking summary ─────────────────────────────────────────────
    position_summary = {
        "top_3": len([k for k in keywords if k["position"] <= 3]),
        "top_10": len([k for k in keywords if k["position"] <= 10]),
        "top_20": len([k for k in keywords if k["position"] <= 20]),
        "top_100": len([k for k in keywords if k["position"] <= 100]),
        "visibility_pct": round(
            sum(k["visibility"] for k in keywords) / max(len(keywords), 1), 2
        ),
    }

    # ── competitors (merge + dedupe) ──────────────────────────────────────────
    comp_map = {}
    for r in ok_results:
        for c in (r.get("competitors") or []):
            d = (c.get("domain") or "").strip().lower()
            if d and d not in comp_map:
                comp_map[d] = {
                    "domain": c.get("domain", "").strip(),
                    "authority": _safe_int(c.get("authority", 0)),
                }
    competitors = sorted(comp_map.values(), key=lambda x: -x["authority"])[:8]

    # ── errors ────────────────────────────────────────────────────────────────
    errors = [
        {"engine": r["engine"], "error": r["error"]}
        for r in results
        if r.get("error")
    ]

    return {
        "ai_search": ai_search,
        "seo": seo,
        "keywords": keywords,
        "kd_distribution": kd_dist,
        "position_summary": position_summary,
        "competitors": competitors,
        "engines_ok": len(ok_results),
        "engines_total": len(results),
        "errors": errors,
    }


# ── endpoint ──────────────────────────────────────────────────────────────────

@app.post("/api/analyze-position")
def analyze_position(req: AnalyzeRequest):
    domain = req.url.strip().lower()
    # Strip protocol if provided
    domain = re.sub(r"^https?://", "", domain)
    domain = domain.rstrip("/")
    country = req.country or "India"

    callers = [
        ("claude", _call_claude),
        ("openai", _call_openai),
        ("gemini", _call_gemini),
    ]

    results = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(fn, domain, country): name for name, fn in callers
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                result = future.result()
            except Exception as e:
                result = {"error": str(e), "engine": name}
            results.append(result)

    merged = _merge_results(results)
    merged["domain"] = domain
    merged["country"] = country
    return merged


# ── health check ──────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "keys": {
            "anthropic": bool(ANTHROPIC_API_KEY),
            "openai": bool(OPENAI_API_KEY),
            "gemini": bool(GEMINI_API_KEY),
        },
    }
