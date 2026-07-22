"""
Keyword Rank Checker — FastAPI micro-service
==============================================

Upload a CSV with a "Keywords" column + provide a target domain.
For each keyword, queries Gemini or OpenAI to find where the target
domain ranks in search results (top 35). Returns 101 if not found.

Endpoints:
  POST /api/rank-check/gemini   — check ranks via Gemini (Google Search grounding)
  POST /api/rank-check/openai   — check ranks via OpenAI (GPT-4o-search-preview)
  POST /api/rank-check/both     — check ranks via both engines in parallel
  GET  /health                  — health check

Usage:
  cd /Users/manish/SEO-backend/backend
  python3 -m uvicorn scripts.rank_checker_ai:app --port 8200 --reload

  Then open http://localhost:8200/docs to use Swagger UI.
"""

import os
import re
import csv
import json
import io
import time
import traceback
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

# ── env ───────────────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

MAX_RANK = 35       # Search up to top 35
NOT_FOUND_RANK = 101  # Return this if domain not found in top MAX_RANK

# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AI Keyword Rank Checker",
    description=(
        "Upload a CSV with a **Keywords** column and a target domain. "
        "Returns the rank of your domain for each keyword (top 35, else 101)."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _extract_domain(url: str) -> str:
    """Extract bare domain from a URL."""
    url = re.sub(r"^https?://", "", url)
    url = url.split("/")[0].split("?")[0]
    # strip www.
    if url.startswith("www."):
        url = url[4:]
    return url.lower().strip()


def _extract_urls_from_text(text: str) -> list:
    """Pull all URLs from AI response text."""
    return re.findall(r"https?://[^\s\)\]\,\"\'<>]+", text)


def _find_rank(urls: list, target_domain: str) -> int:
    """Find the rank (1-based) of target_domain in a list of URLs.
    Returns NOT_FOUND_RANK if not in top MAX_RANK."""
    target = _extract_domain(target_domain)
    seen = set()
    rank = 0
    for url in urls:
        domain = _extract_domain(url)
        if domain in seen:
            continue
        seen.add(domain)
        rank += 1
        if target in domain or domain in target:
            return rank
        if rank >= MAX_RANK:
            break
    return NOT_FOUND_RANK


# ── Gemini rank checker ──────────────────────────────────────────────────────

def _check_rank_gemini(keyword: str, target_domain: str, country: str) -> dict:
    """Query Gemini with Google Search grounding and find target domain rank."""
    if not GEMINI_API_KEY:
        return {"keyword": keyword, "rank": NOT_FOUND_RANK, "engine": "gemini",
                "error": "GEMINI_API_KEY not set"}
    try:
        from google import genai
        from google.genai import types as gtypes

        client = genai.Client(api_key=GEMINI_API_KEY)

        prompt = (
            f'Search Google in {country} for: "{keyword}"\n\n'
            f"List the top {MAX_RANK} organic search results. "
            "For each result, provide ONLY the URL on a new line. "
            "No titles, no descriptions, no numbering — just one URL per line."
        )

        response = None
        last_err = None
        for attempt in range(1, 4):
            try:
                response = client.models.generate_content(
                    model="gemini-3.5-flash",
                    contents=prompt,
                    config=gtypes.GenerateContentConfig(
                        tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
                        temperature=0,
                        max_output_tokens=1500,
                        http_options=gtypes.HttpOptions(timeout=60000),
                    ),
                )
                last_err = None
                break
            except Exception as e:
                last_err = e
                err_str = str(e)
                if any(x in err_str for x in ("503", "504", "429", "499", "UNAVAILABLE", "DEADLINE", "timeout")):
                    time.sleep(attempt * 2)
                else:
                    break

        if last_err or response is None:
            return {"keyword": keyword, "rank": NOT_FOUND_RANK, "engine": "gemini",
                    "error": str(last_err)}

        # ── Extract URLs from grounding chunks first ──────────────────────────
        urls = []
        try:
            gm = response.candidates[0].grounding_metadata
            chunks = gm.grounding_chunks or []
            for chunk in chunks:
                web = getattr(chunk, "web", None)
                if web:
                    uri = getattr(web, "uri", "") or ""
                    if uri:
                        urls.append(uri)
        except Exception:
            pass

        # ── Fallback: extract from text ───────────────────────────────────────
        ai_text = ""
        try:
            ai_text = response.text or ""
        except Exception:
            pass

        if not urls and ai_text:
            urls = _extract_urls_from_text(ai_text)

        rank = _find_rank(urls, target_domain)
        return {
            "keyword": keyword,
            "rank": rank,
            "engine": "gemini",
            "urls_found": len(urls),
        }

    except Exception as e:
        traceback.print_exc()
        return {"keyword": keyword, "rank": NOT_FOUND_RANK, "engine": "gemini",
                "error": str(e)}


# ── OpenAI rank checker ──────────────────────────────────────────────────────

def _check_rank_openai(keyword: str, target_domain: str, country: str) -> dict:
    """Query OpenAI search-preview and find target domain rank."""
    if not OPENAI_API_KEY:
        return {"keyword": keyword, "rank": NOT_FOUND_RANK, "engine": "openai",
                "error": "OPENAI_API_KEY not set"}
    try:
        from openai import OpenAI

        client = OpenAI(api_key=OPENAI_API_KEY)

        prompt = (
            f'Search the web for: "{keyword}" in {country}\n\n'
            f"List the top {MAX_RANK} websites that appear in search results. "
            "For each result, provide ONLY the URL on a new line. "
            "No titles, no descriptions, no numbering — just one URL per line. "
            "Use real, live search results."
        )

        try:
            response = client.chat.completions.create(
                model="gpt-4o-search-preview",
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as e:
            return {"keyword": keyword, "rank": NOT_FOUND_RANK, "engine": "openai",
                    "error": str(e)}

        message = response.choices[0].message
        ai_text = message.content or ""

        # ── Extract URLs from annotations first ──────────────────────────────
        urls = []
        annotations = getattr(message, "annotations", None) or []
        for ann in annotations:
            if getattr(ann, "type", "") == "url_citation":
                citation = getattr(ann, "url_citation", ann)
                url = getattr(citation, "url", "") or getattr(ann, "url", "")
                if url:
                    urls.append(url)

        # ── Fallback: extract from text ───────────────────────────────────────
        if not urls and ai_text:
            urls = _extract_urls_from_text(ai_text)

        rank = _find_rank(urls, target_domain)
        return {
            "keyword": keyword,
            "rank": rank,
            "engine": "openai",
            "urls_found": len(urls),
        }

    except Exception as e:
        traceback.print_exc()
        return {"keyword": keyword, "rank": NOT_FOUND_RANK, "engine": "openai",
                "error": str(e)}


# ── CSV parsing ──────────────────────────────────────────────────────────────

def _parse_keywords_csv(file_bytes: bytes) -> list:
    """Parse uploaded CSV and return list of keyword strings."""
    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    # Find the keywords column (case-insensitive)
    keywords = []
    for row in reader:
        for key in row:
            if key.strip().lower() in ("keywords", "keyword", "query", "search term"):
                val = (row[key] or "").strip()
                if val:
                    keywords.append(val)
                break
    return keywords


def _build_result_csv(results: list, engine_name: str) -> str:
    """Build a CSV string from rank results."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Keywords", f"{engine_name}_rank", "urls_found", "error"])
    for r in results:
        writer.writerow([
            r["keyword"],
            r["rank"],
            r.get("urls_found", 0),
            r.get("error", ""),
        ])
    return output.getvalue()


# ── endpoints ─────────────────────────────────────────────────────────────────

@app.post("/api/rank-check/gemini", summary="Check keyword ranks via Gemini")
async def rank_check_gemini(
    file: UploadFile = File(..., description="CSV with a 'Keywords' column"),
    domain: str = Form(..., description="Target domain to find rank for (e.g. socialoffline.in)"),
    country: str = Form("India", description="Country for search results"),
    workers: int = Form(3, description="Parallel workers (1-5)"),
):
    """Upload a CSV → get ranks for each keyword via Gemini Google Search grounding."""
    file_bytes = await file.read()
    keywords = _parse_keywords_csv(file_bytes)
    if not keywords:
        return {"error": "No keywords found. Make sure CSV has a 'Keywords' column."}

    workers = max(1, min(workers, 5))
    results = []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_check_rank_gemini, kw, domain, country): kw
            for kw in keywords
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            kw = futures[future]
            try:
                result = future.result()
            except Exception as e:
                result = {"keyword": kw, "rank": NOT_FOUND_RANK, "engine": "gemini",
                          "error": str(e)}
            results.append(result)
            print(f"  [gemini] [{done}/{len(keywords)}] '{kw}' → rank {result['rank']}")

    # Sort by original keyword order
    kw_order = {kw: i for i, kw in enumerate(keywords)}
    results.sort(key=lambda r: kw_order.get(r["keyword"], 999))

    # Return as downloadable CSV
    csv_content = _build_result_csv(results, "gemini")
    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=gemini_ranks.csv"},
    )


@app.post("/api/rank-check/openai", summary="Check keyword ranks via OpenAI")
async def rank_check_openai(
    file: UploadFile = File(..., description="CSV with a 'Keywords' column"),
    domain: str = Form(..., description="Target domain to find rank for (e.g. socialoffline.in)"),
    country: str = Form("India", description="Country for search results"),
    workers: int = Form(3, description="Parallel workers (1-5)"),
):
    """Upload a CSV → get ranks for each keyword via OpenAI search-preview."""
    file_bytes = await file.read()
    keywords = _parse_keywords_csv(file_bytes)
    if not keywords:
        return {"error": "No keywords found. Make sure CSV has a 'Keywords' column."}

    workers = max(1, min(workers, 5))
    results = []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_check_rank_openai, kw, domain, country): kw
            for kw in keywords
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            kw = futures[future]
            try:
                result = future.result()
            except Exception as e:
                result = {"keyword": kw, "rank": NOT_FOUND_RANK, "engine": "openai",
                          "error": str(e)}
            results.append(result)
            print(f"  [openai] [{done}/{len(keywords)}] '{kw}' → rank {result['rank']}")

    kw_order = {kw: i for i, kw in enumerate(keywords)}
    results.sort(key=lambda r: kw_order.get(r["keyword"], 999))

    csv_content = _build_result_csv(results, "openai")
    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=openai_ranks.csv"},
    )


@app.post("/api/rank-check/both", summary="Check keyword ranks via BOTH Gemini + OpenAI")
async def rank_check_both(
    file: UploadFile = File(..., description="CSV with a 'Keywords' column"),
    domain: str = Form(..., description="Target domain to find rank for (e.g. socialoffline.in)"),
    country: str = Form("India", description="Country for search results"),
    workers: int = Form(3, description="Parallel workers per engine (1-5)"),
):
    """Upload a CSV → get ranks for each keyword via BOTH engines.
    Returns a CSV with columns: Keywords, gemini_rank, openai_rank."""
    file_bytes = await file.read()
    keywords = _parse_keywords_csv(file_bytes)
    if not keywords:
        return {"error": "No keywords found. Make sure CSV has a 'Keywords' column."}

    workers = max(1, min(workers, 5))

    gemini_results = {}
    openai_results = {}

    def _run_gemini():
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_check_rank_gemini, kw, domain, country): kw
                for kw in keywords
            }
            done = 0
            for future in as_completed(futures):
                done += 1
                kw = futures[future]
                try:
                    result = future.result()
                except Exception as e:
                    result = {"keyword": kw, "rank": NOT_FOUND_RANK, "engine": "gemini", "error": str(e)}
                gemini_results[kw] = result
                print(f"  [gemini] [{done}/{len(keywords)}] '{kw}' → rank {result['rank']}")

    def _run_openai():
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_check_rank_openai, kw, domain, country): kw
                for kw in keywords
            }
            done = 0
            for future in as_completed(futures):
                done += 1
                kw = futures[future]
                try:
                    result = future.result()
                except Exception as e:
                    result = {"keyword": kw, "rank": NOT_FOUND_RANK, "engine": "openai", "error": str(e)}
                openai_results[kw] = result
                print(f"  [openai] [{done}/{len(keywords)}] '{kw}' → rank {result['rank']}")

    # Run both engines in parallel
    with ThreadPoolExecutor(max_workers=2) as engine_pool:
        engine_pool.submit(_run_gemini)
        engine_pool.submit(_run_openai)
        engine_pool.shutdown(wait=True)

    # Build combined CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Keywords", "gemini_rank", "openai_rank", "gemini_error", "openai_error"])
    for kw in keywords:
        g = gemini_results.get(kw, {"rank": NOT_FOUND_RANK})
        o = openai_results.get(kw, {"rank": NOT_FOUND_RANK})
        writer.writerow([
            kw,
            g.get("rank", NOT_FOUND_RANK),
            o.get("rank", NOT_FOUND_RANK),
            g.get("error", ""),
            o.get("error", ""),
        ])

    csv_content = output.getvalue()
    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=both_ranks.csv"},
    )


# ── health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "max_rank": MAX_RANK,
        "not_found_value": NOT_FOUND_RANK,
        "keys": {
            "openai": bool(OPENAI_API_KEY),
            "gemini": bool(GEMINI_API_KEY),
        },
    }
