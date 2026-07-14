"""
test_api.py

Standalone FastAPI app for manually testing:
  1. The full 4-stage pipeline (scripts/run_pipeline.py: SERP scrape ->
     category + landing/blog -> info/comm -> cluster) by uploading a
     sheet through the browser, instead of running the CLI script by
     hand.
  2. scripts/agentic_rank_checker.py, the Claude-driven rank checker --
     POST /test/check-rank-agentic (single keyword) or
     POST /test/check-rank-agentic-bulk (every keyword from an already-
     finished /test/upload-and-categorize run, checked against one
     shared landing_page/domain).

Deliberately a SEPARATE app from app.py (the real production API) --
this drives real Chrome browsers via Selenium (scripts/serp_scraper.py
for SERP fetching, scripts/intent_classifier.py for per-URL info/comm
fetching) and the experimental "generalized" category rules
(scripts/category_assigner.py), not the production Bright Data + RQ
worker pipeline. Keeping it in its own file/process means it can be run,
changed, or torn down without touching production endpoints, and the
two can run side by side on different ports.

State is kept in a plain in-memory dict (RUNS below) -- fine for a
single local test process, NOT meant to survive a restart or run behind
multiple workers.

Run from the `backend/` directory:
    uvicorn test_api:app --reload --port 8001

Then test by importing a sheet through the browser (see the docstring
on the upload endpoint below for the exact steps) -- no curl/command
needed for that part.
"""

import csv
import os
import threading
import uuid
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core import db
from scripts.run_pipeline import run_pipeline

UPLOAD_DIR = "datasets/uploads"

app = FastAPI(title="SERP + Category + Landing/Blog + Info/Comm Pipeline (TEST)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# run_id -> {"status": "running"|"done"|"error", "input_path": str,
#            "output_path": str|None, "project": str, "error": str|None}
RUNS = {}

# run_id -> {"status": "running"|"done"|"error", "keyword": str,
#            "landing_page": str, "result": dict|None, "error": str|None}
RANK_CHECK_RUNS = {}

# bulk_run_id -> {"status": "running"|"done"|"error", "landing_page": str,
#                 "total": int, "completed": int, "results": list|None, "error": str|None}
BULK_RANK_CHECK_RUNS = {}


def _run_in_background(run_id, input_path, project_display_name):
    try:
        output_path = run_pipeline(input_path, project_display_name)
        RUNS[run_id]["output_path"] = output_path
        RUNS[run_id]["status"] = "done"
    except Exception as e:
        RUNS[run_id]["status"] = "error"
        RUNS[run_id]["error"] = str(e)


def _run_rank_check_in_background(run_id, keyword, landing_page, country):
    try:
        # Lazy import -- scripts/agentic_rank_checker.py pulls in
        # anthropic/crawl4ai, which aren't installed by default.
        # Importing it only here (not at module
        # top) means the REST of this app keeps working even before
        # those are installed -- only this endpoint fails, with a clear
        # error, until they are.
        from scripts.agentic_rank_checker import RankCheckAgent

        agent = RankCheckAgent()
        result = agent.check_keyword_rank(keyword, landing_page, country_code=country)
        RANK_CHECK_RUNS[run_id]["result"] = result.model_dump()
        RANK_CHECK_RUNS[run_id]["status"] = "done"
    except Exception as e:
        RANK_CHECK_RUNS[run_id]["status"] = "error"
        RANK_CHECK_RUNS[run_id]["error"] = str(e)


def _run_bulk_rank_check_in_background(bulk_run_id, keywords, landing_page, country):
    try:
        from scripts.agentic_rank_checker import RankCheckAgent  # lazy import, see above

        agent = RankCheckAgent()
        results = []
        for kw in keywords:
            try:
                result = agent.check_keyword_rank(kw, landing_page, country_code=country)
                results.append(result.model_dump())
            except Exception as e:
                results.append({"keyword": kw, "error": str(e)})
            BULK_RANK_CHECK_RUNS[bulk_run_id]["completed"] += 1

        BULK_RANK_CHECK_RUNS[bulk_run_id]["results"] = results
        BULK_RANK_CHECK_RUNS[bulk_run_id]["status"] = "done"
    except Exception as e:
        BULK_RANK_CHECK_RUNS[bulk_run_id]["status"] = "error"
        BULK_RANK_CHECK_RUNS[bulk_run_id]["error"] = str(e)


def _run_project_rank_check_in_background(bulk_run_id, rows, country):
    try:
        from scripts.agentic_rank_checker import RankCheckAgent  # lazy import, see above

        agent = RankCheckAgent()
        results = []
        for row in rows:
            kw = row["keyword"]
            landing_page = row.get("landing_page_url") or ""
            try:
                result = agent.check_keyword_rank(kw, landing_page, country_code=country)
                results.append(result.model_dump())

                # Persist straight to Supabase's `rank` column -- same
                # column db.update_keyword_rank() already fills in for
                # the production (non-agentic) rank checker, just with a
                # richer rank_meta from the agentic result and a
                # "checked_via" marker to tell the two apart.
                db.update_keyword_rank(row["id"], result.rank, rank_meta={
                    "checked_via": "agentic",
                    "match_type": result.match_type,
                    "matched_url": result.matched_url,
                    "top_competitors": result.top_competitors,
                    "serp_intent_analysis": result.serp_intent_analysis,
                    "ranking_reasoning": result.ranking_reasoning,
                    "actionable_recommendation": result.actionable_recommendation,
                })
            except Exception as e:
                results.append({"keyword": kw, "landing_page": landing_page, "error": str(e)})
                try:
                    db.update_keyword_rank(row["id"], None, rank_meta={"checked_via": "agentic", "error": str(e)})
                except Exception:
                    pass
            BULK_RANK_CHECK_RUNS[bulk_run_id]["completed"] += 1

        BULK_RANK_CHECK_RUNS[bulk_run_id]["results"] = results
        BULK_RANK_CHECK_RUNS[bulk_run_id]["status"] = "done"
    except Exception as e:
        BULK_RANK_CHECK_RUNS[bulk_run_id]["status"] = "error"
        BULK_RANK_CHECK_RUNS[bulk_run_id]["error"] = str(e)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/test/upload-and-categorize")
async def upload_and_categorize(
    file: UploadFile = File(...),
    project: str = Form(None),
):
    """
    Upload a .csv/.xlsx sheet with a "Keywords" column. Kicks off the
    SAME pipeline as `python -m scripts.run_pipeline` -- a real Chrome
    window opens on this machine and starts scraping Google's top-3
    results per keyword; as each keyword's results come in, category +
    landing/blog classification run in one background thread while
    informational/commercial classification runs in a separate thread
    pool (its own headless Chrome instances) -- all concurrently with
    the scraping itself. Clustering runs once, at the very end, after
    every keyword has a category. This request returns immediately with
    a `run_id` rather than blocking until the whole sheet is done.

    HOW TO TEST THIS THROUGH THE BROWSER (no command needed):
      1. Start this app:  uvicorn test_api:app --reload --port 8001
      2. Open http://localhost:8001/docs in a browser -- this is
         FastAPI's built-in Swagger UI.
      3. Expand "POST /test/upload-and-categorize", click "Try it out".
      4. Under `file`, click "Choose File" and pick your .csv/.xlsx
         sheet from your computer.
      5. (Optional) fill in `project` with a name for this run --
         if left blank, it defaults to the uploaded file's name.
      6. Click "Execute". You'll immediately get back a `run_id` and
         `status: "running"` -- the actual scraping/categorizing keeps
         running on the server in the background.
      7. Expand "GET /test/status/{run_id}", plug in the `run_id` you
         got back, and click Execute repeatedly to check progress until
         `status` becomes "done" (or "error").
      8. Once done, use "GET /test/download/{run_id}" the same way to
         download the finished CSV (Keyword, Start Time, Stop Time,
         Top 3 URLs (JSON), Category, Cluster, Landing/Blog Page,
         Informational/Commercial Page columns) straight from the browser.
    """
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = file.filename or "upload.csv"
    input_path = os.path.join(UPLOAD_DIR, filename)

    contents = await file.read()
    with open(input_path, "wb") as f:
        f.write(contents)

    run_id = str(uuid.uuid4())
    project_display_name = (project or "").strip() or None

    RUNS[run_id] = {
        "status": "running",
        "input_path": input_path,
        "output_path": None,
        "project": project_display_name,
        "error": None,
    }

    thread = threading.Thread(
        target=_run_in_background,
        args=(run_id, input_path, project_display_name),
        daemon=True,
    )
    thread.start()

    return {"run_id": run_id, "status": "running", "input_path": input_path}


@app.get("/test/status/{run_id}")
def get_status(run_id: str):
    run = RUNS.get(run_id)
    if run is None:
        return {"error": f"Unknown run_id: {run_id}"}
    return {"run_id": run_id, **run}


@app.get("/test/download/{run_id}")
def download_result(run_id: str):
    run = RUNS.get(run_id)
    if run is None:
        return {"error": f"Unknown run_id: {run_id}"}
    if run["status"] != "done" or not run["output_path"]:
        return {"error": f"Run is not done yet (status: {run['status']})"}
    return FileResponse(
        run["output_path"],
        media_type="text/csv",
        filename=os.path.basename(run["output_path"]),
    )


class RankCheckAgenticRequest(BaseModel):
    keyword: str
    landing_page: str
    country: Optional[str] = None


@app.post("/test/check-rank-agentic")
def check_rank_agentic(payload: RankCheckAgenticRequest):
    """
    Manually test scripts/agentic_rank_checker.py -- the Claude-driven
    rank checker (SERP fetch via Crawl4AI, falling back to SerpApi/
    Bright Data, then Claude analyzes the whole SERP for rank, match
    type, competitors, intent, and a recommendation).

    A single check can take a while (multiple paginated SERP fetches
    with randomized delays, then the Claude call), so this follows the
    same run_id + background-thread + polling pattern as
    /test/upload-and-categorize instead of blocking the request.

    Requires ANTHROPIC_API_KEY (and at least one of BRIGHTDATA_API_KEY /
    SERPAPI_API_KEY) in .env, plus `pip install anthropic crawl4ai` and
    (once) `playwright install chromium` -- Crawl4AI drives its own
    Chromium under the hood via playwright even though this script
    doesn't import playwright directly.

    HOW TO TEST THIS THROUGH THE BROWSER:
      1. Start this app:  uvicorn test_api:app --reload --port 8001
      2. Open http://localhost:8001/docs
      3. Expand "POST /test/check-rank-agentic", "Try it out".
      4. Fill in `keyword` and `landing_page` (the URL you want ranked),
         optionally `country` (e.g. "in", "us"). Execute -- get a
         `run_id` back immediately.
      5. Expand "GET /test/check-rank-agentic/{run_id}", poll with that
         `run_id` until `status` is "done" (or "error") -- the `result`
         field then has rank, match_type, top_competitors,
         serp_intent_analysis, ranking_reasoning, and
         actionable_recommendation.
    """
    run_id = str(uuid.uuid4())
    RANK_CHECK_RUNS[run_id] = {
        "status": "running",
        "keyword": payload.keyword,
        "landing_page": payload.landing_page,
        "result": None,
        "error": None,
    }

    thread = threading.Thread(
        target=_run_rank_check_in_background,
        args=(run_id, payload.keyword, payload.landing_page, payload.country),
        daemon=True,
    )
    thread.start()

    return {"run_id": run_id, "status": "running"}


@app.get("/test/check-rank-agentic/{run_id}")
def get_rank_check_status(run_id: str):
    run = RANK_CHECK_RUNS.get(run_id)
    if run is None:
        return {"error": f"Unknown run_id: {run_id}"}
    return {"run_id": run_id, **run}


class BulkRankCheckAgenticRequest(BaseModel):
    run_id: str
    landing_page: str
    country: Optional[str] = None


@app.post("/test/check-rank-agentic-bulk")
def check_rank_agentic_bulk(payload: BulkRankCheckAgenticRequest):
    """
    Run scripts/agentic_rank_checker.py for EVERY keyword in an already-
    finished /test/upload-and-categorize run, instead of one keyword at a
    time.

    IMPORTANT: the sheet you upload to /test/upload-and-categorize only
    has a "Keywords" column -- no per-keyword landing page. So every
    keyword in this bulk run is checked against the SAME `landing_page`
    you pass here (e.g. your site's homepage, or whatever single page/
    domain you're tracking) -- this is a domain/site-wide rank check
    across the whole sheet, not a per-keyword target-page check. If you
    need per-keyword landing pages, that would need the upload format
    extended to carry a Landing Page column too (not built yet).

    `run_id` must reference a /test/upload-and-categorize run that has
    already finished (status "done") -- keywords are read straight from
    that run's output CSV. Runs in the background (same run_id +
    polling pattern as the other endpoints here) since it makes one
    SERP-fetch + Claude call per keyword, sequentially.

    HOW TO TEST THIS THROUGH THE BROWSER:
      1. Finish a /test/upload-and-categorize run first (poll
         GET /test/status/{run_id} until "done") -- copy its run_id.
      2. Expand "POST /test/check-rank-agentic-bulk", "Try it out".
      3. Fill in `run_id` with that value, `landing_page` with the URL/
         domain to check every keyword against, optionally `country`.
         Execute -- get a NEW `bulk_run_id` back immediately.
      4. Expand "GET /test/check-rank-agentic-bulk/{bulk_run_id}", poll
         with that `bulk_run_id` -- `completed`/`total` shows progress,
         `results` (a list, one entry per keyword) is filled in once
         `status` is "done".
    """
    run = RUNS.get(payload.run_id)
    if run is None:
        return {"error": f"Unknown run_id: {payload.run_id} (that's a /test/upload-and-categorize run_id, not a rank-check one)"}
    if run["status"] != "done" or not run["output_path"]:
        return {"error": f"That run isn't done yet (status: {run['status']}) -- wait for it to finish first."}

    keywords = []
    with open(run["output_path"], newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            kw = (row.get("Keyword") or "").strip()
            if kw:
                keywords.append(kw)

    if not keywords:
        return {"error": "No keywords found in that run's output CSV."}

    bulk_run_id = str(uuid.uuid4())
    BULK_RANK_CHECK_RUNS[bulk_run_id] = {
        "status": "running",
        "landing_page": payload.landing_page,
        "total": len(keywords),
        "completed": 0,
        "results": None,
        "error": None,
    }

    thread = threading.Thread(
        target=_run_bulk_rank_check_in_background,
        args=(bulk_run_id, keywords, payload.landing_page, payload.country),
        daemon=True,
    )
    thread.start()

    return {"bulk_run_id": bulk_run_id, "status": "running", "total_keywords": len(keywords)}


@app.get("/test/check-rank-agentic-bulk/{bulk_run_id}")
def get_bulk_rank_check_status(bulk_run_id: str):
    run = BULK_RANK_CHECK_RUNS.get(bulk_run_id)
    if run is None:
        return {"error": f"Unknown bulk_run_id: {bulk_run_id}"}
    return {"bulk_run_id": bulk_run_id, **run}


class ProjectRankCheckAgenticRequest(BaseModel):
    project: str
    country: Optional[str] = None


@app.post("/test/check-rank-agentic-project")
def check_rank_agentic_project(payload: ProjectRankCheckAgenticRequest):
    """
    Mirrors what a real "trigger initial ranking" dashboard button does
    -- production app.py's POST /jobs/{job_id}/check-rank does this same
    thing (pull every keyword + its OWN landing page already sitting in
    a project, and rank-check them), but via
    services/rank_checker.find_rank() (deterministic, Bright Data). This
    is the SAME trigger shape -- scoped to a whole PROJECT rather than
    one job -- but using scripts/agentic_rank_checker.py's Claude-based
    checker instead, so you can test that version the same way the
    dashboard button would trigger it.

    `project` is the project's display name or slug (whichever you'd
    type into the dashboard). Pulls every keyword + landing_page_url
    ALREADY sitting in Supabase for that project (from any job or
    pipeline run that put data there, e.g. scripts/run_pipeline.py or
    the frontend's direct insert) -- each keyword is checked against its
    OWN landing page, unlike /test/check-rank-agentic-bulk's one-shared-
    URL approach.

    Each keyword's rank is ALSO persisted straight to Supabase's
    keyword_categories.rank column (db.update_keyword_rank(), same
    column the production rank checker fills in) as each result comes
    in -- not just returned in the polled response below. rank_meta is
    tagged "checked_via": "agentic" so it's distinguishable from a
    production (deterministic) rank check.

    Uses the SAME run_id + polling pattern -- poll
    GET /test/check-rank-agentic-bulk/{bulk_run_id} (shared with the
    other bulk endpoint) with the bulk_run_id this returns.
    """
    proj = db.get_project_by_name(payload.project) or db.get_project_by_slug(payload.project)
    if proj is None:
        return {"error": f"Project '{payload.project}' not found."}

    rows = db.get_domain_results(proj["slug"])
    rows_to_check = [r for r in rows if (r.get("keyword") or "").strip()]
    if not rows_to_check:
        return {"error": "No keywords found for this project."}

    bulk_run_id = str(uuid.uuid4())
    BULK_RANK_CHECK_RUNS[bulk_run_id] = {
        "status": "running",
        "project": proj["name"],
        "total": len(rows_to_check),
        "completed": 0,
        "results": None,
        "error": None,
    }

    thread = threading.Thread(
        target=_run_project_rank_check_in_background,
        args=(bulk_run_id, rows_to_check, payload.country),
        daemon=True,
    )
    thread.start()

    return {"bulk_run_id": bulk_run_id, "status": "running", "total_keywords": len(rows_to_check)}
