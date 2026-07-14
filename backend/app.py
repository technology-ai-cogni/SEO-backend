"""
Backend API -- category checking, scoped by PROJECT.

Category/cluster/keyword data lives in SHARED tables (categories,
clusters, category_cluster_map, keyword_categories -- see db.py), each
scoped by a project_name column, rather than dedicated tables per
project. `project` in most URLs below can be either the exact display
name you typed when creating it (e.g. "Real Estate Clients") or its
slug (e.g. "real_estate_clients") -- both resolve to the same project.

DOMAINS: a separate registry capturing the "Create Project" form (domain,
project name, target regions, platforms, domain authority, users).
Creating a domain also registers (or reuses) the matching project. One
domain maps to exactly one project.

Job/result state lives in Postgres (Supabase, db.py) -- that's the ONLY
external service this API depends on now. There is no separate RQ/Redis
job queue or worker process anymore -- two kinds of processing happen
here instead:
  1. scripts/run_pipeline.py, run directly (or via test_api.py) on a
     machine with a real browser -- for bulk SERP scraping of a whole
     new sheet. Writes straight into the SAME shared tables this API
     reads from (see core/db.py's insert_pipeline_result()).
  2. This app's own /projects/{project}/categorize and
     /jobs/{job_id}/check-rank endpoints -- for keywords the FRONTEND
     already inserted directly into Supabase (uncategorized) and now
     wants processed. These run in a background thread inside this same
     process (scripts/hosted_categorize.py, scripts/hosted_rank_check.py)
     using Bright Data + plain `requests` instead of Selenium, since a
     real browser isn't available on a hosted deployment like Render.

Auth is intentionally NOT wired in here yet -- every endpoint is open.
Lock this down before deploying publicly.

Endpoints:
    POST /domains                          register a domain <-> project
                                           (the "Create Project" form)
    GET  /domains                          list every domain that's been
                                           registered
    GET  /projects                         list every project that exists
    DELETE /projects/{project}              delete a project and everything
                                           scoped to it (domains,
                                           keyword_categories, categories,
                                           clusters, category_cluster_map,
                                           pages) -- not currently wired
                                           to any UI button, see below
    DELETE /projects/{project}/kw-data      delete just this project's KW
                                           Cluster data (keyword_categories/
                                           categories/clusters/
                                           category_cluster_map) -- what
                                           the KW Cluster tab's delete
                                           button calls
    DELETE /projects/{project}/pages        delete just this project's page
                                           rows -- what the Pages tab's
                                           delete button calls
    GET  /projects/{project}/results        ALL keyword results ever
                                           processed for a project, across
                                           every job -- the "project table"
                                           view for your UI
    GET  /projects/{project}/categories      every distinct category in
                                           this project + audit trail
    GET  /projects/{project}/clusters        every distinct cluster in
                                           this project + its categories
    POST /projects/{project}/recluster       manually re-run clustering
                                           for one project
    POST /jobs/category                   upload a .csv/.xlsx sheet ->
                                           category job for a project
                                           (creates the project on first
                                           use), background thread
    POST /projects/{project}/categorize      categorize existing
                                           un-categorized keywords in a
                                           project (background thread)
    GET  /projects/{project}/pages          every page row uploaded via
                                           Add Pages for this project
    POST /projects/{project}/pages          bulk-insert page rows parsed
                                           from an Add Pages sheet upload
    PATCH /pages/{page_id}                  update one page row
    DELETE /pages/{page_id}                 delete one page row
    POST /pages/bulk-delete                 delete many page rows at once
    GET  /jobs                             list all jobs (every project)
    GET  /jobs/{job_id}                     poll job status/progress
    POST /jobs/{job_id}/check-rank            check rank for every keyword
                                           in a completed job (background
                                           thread)
    GET  /jobs/{job_id}/results               per-keyword results for one job
    GET  /jobs/{job_id}/download              same results, as a CSV download
    GET  /health

Run locally, from the `backend/` directory:
    python -m core.db              # one-time: creates/updates shared tables
    uvicorn app:app --reload --port 8000
"""

from dotenv import load_dotenv
load_dotenv()  # must happen before importing core.db

import io
import csv
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import db
from services import category_checker
from scripts.hosted_categorize import run_categorize_job_in_background
from scripts.hosted_rank_check import run_rank_check_job_in_background

MIN_SEARCH_VOLUME = 5
NEAR_ME_PHRASE = "near me"

app = FastAPI(title="Category API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock this down to your actual frontend domain before going live
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _run_migrations():
    """CREATE TABLE/COLUMN IF NOT EXISTS only (see db.init_db()) -- safe to
    run on every boot, so a fresh table/column added here shows up in
    production on the next deploy without a manual `python -m core.db`
    step."""
    db.init_db()


class DomainUser(BaseModel):
    type: Optional[str] = None
    email: str


class CreateDomainRequest(BaseModel):
    domain: str
    project_name: Optional[str] = None  # auto-generated from `domain` if left blank
    target_regions: Optional[List[str]] = None
    platforms: Optional[List[str]] = None
    domain_authority: Optional[str] = None
    users: Optional[List[DomainUser]] = None




def _find_column(columns, candidates):
    lower_map = {c.lower().strip(): c for c in columns}
    for candidate in candidates:
        if candidate in lower_map:
            return lower_map[candidate]
    return None


def _load_dataframe(file_bytes, filename):
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    buf = io.BytesIO(file_bytes)
    if ext == "csv":
        return pd.read_csv(buf)
    elif ext in ("xlsx", "xls"):
        return pd.read_excel(buf)
    else:
        raise ValueError(f"Unsupported file type: .{ext} (use .csv or .xlsx)")


def _parse_upload(df):
    """Column resolution + SV/'near me' filtering. Returns a list of
    dicts, one per keyword row, with keys:
        keyword, skip_reason,
        sv, kw_diff, type, target_type, target_subtype, target_geo, priority, landing_page_url
    skip_reason is None for rows that should actually be processed.

    Every pass-through field (everything except keyword/skip_reason) is
    stored EXACTLY as it appears in the sheet -- None if that column
    isn't present at all, or if this particular row's cell is blank.
    Nothing here is inferred or generated -- that's the whole point."""
    df.columns = [str(c).strip() for c in df.columns]

    keyword_col = _find_column(df.columns, ["keywords", "keyword", "kw"])
    if keyword_col is None:
        raise HTTPException(400, f"No 'Keywords' column found. Columns present: {list(df.columns)}")

    sv_col = _find_column(df.columns, ["search volume", "sv", "volume", "search_volume"])
    kw_diff_col = _find_column(df.columns, ["kw diff", "keyword difficulty", "kd", "difficulty", "kw_diff", "kw difficulty"])
    type_col = _find_column(df.columns, ["type"])
    target_type_col = _find_column(df.columns, ["target type", "target_type"])
    target_subtype_col = _find_column(df.columns, ["target subtype", "subtype", "target_subtype"])
    target_geo_col = _find_column(df.columns, ["target geo", "geo", "location", "target_geo"])
    priority_col = _find_column(df.columns, ["priority"])
    landing_page_col = _find_column(df.columns, ["landing page(url)", "landing page (url)", "landing page", "landing_page", "landing page url", "url"])

    def _cell(row, col):
        """Raw pass-through value for one cell -- None if the column
        doesn't exist, or if this row's value is blank/NaN. Never
        transformed, inferred, or defaulted to anything else -- EXCEPT
        for undoing pandas' own float-coercion artifact: a numeric
        column with any blank cell gets read as float64, so a whole
        number like 500 comes back as 500.0. That's pandas' doing, not
        the sheet's -- we strip a trailing ".0" so what's stored matches
        what was actually typed in the sheet."""
        if col is None:
            return None
        value = row.get(col)
        if value is None:
            return None
        if isinstance(value, float) and value.is_integer():
            text_value = str(int(value))
        else:
            text_value = str(value).strip()
        if text_value == "" or text_value.lower() == "nan":
            return None
        return text_value

    rows = []
    for _, row in df.iterrows():
        keyword = str(row.get(keyword_col, "")).strip()
        if keyword == "" or keyword.lower() == "nan":
            continue

        skip_reason = None
        if NEAR_ME_PHRASE in keyword.lower():
            skip_reason = "Skipped - contains 'near me'"
        elif sv_col:
            raw_sv = row.get(sv_col)
            try:
                sv_value = float(raw_sv)
                if sv_value <= MIN_SEARCH_VOLUME:
                    skip_reason = f"Skipped - low search volume ({raw_sv})"
            except (TypeError, ValueError):
                pass  # SV missing/non-numeric -> don't filter on it

        rows.append({
            "keyword": keyword,
            "skip_reason": skip_reason,
            "sv": _cell(row, sv_col),
            "kw_diff": _cell(row, kw_diff_col),
            "type": _cell(row, type_col),
            "target_type": _cell(row, target_type_col),
            "target_subtype": _cell(row, target_subtype_col),
            "target_geo": _cell(row, target_geo_col),
            "priority": _cell(row, priority_col),
            "landing_page_url": _cell(row, landing_page_col),
        })

    return rows


def _resolve_project_or_404(project_param):
    """`project_param` can be either the exact display name or the slug --
    try both. 404s if neither matches anything that's ever been created."""
    proj = db.get_project_by_name(project_param) or db.get_project_by_slug(project_param)
    if proj is None:
        raise HTTPException(404, f"Project '{project_param}' not found.")
    return proj


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/domains")
def create_domain(payload: CreateDomainRequest):
    """Registers a domain <-> project pairing -- the "Create Project"
    form. One domain maps to exactly one project; this also creates (or
    reuses) that project in the `projects` registry, so a subsequent
    /jobs/category upload with the same project name lands in the right
    place. Fields not present in the creation form (traffic, keyword
    count, target/blog page counts) stay NULL -- nothing computes them
    here."""
    users_payload = [u.dict() for u in payload.users] if payload.users else None
    try:
        project_slug = db.create_domain(
            payload.domain, payload.project_name, payload.target_regions,
            payload.platforms, payload.domain_authority, users_payload,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"domain": payload.domain, "project_slug": project_slug}


@app.get("/domains")
def list_domains_endpoint():
    """Every domain that's been registered -- the project listing view."""
    return {"domains": db.list_domain_records()}


@app.get("/projects")
def get_projects():
    """Every project that has ever been created."""
    return {"projects": db.list_projects()}


@app.delete("/projects/{project}")
def delete_project_endpoint(project: str):
    """Deletes a project and everything scoped to it (domains,
    keyword_categories, categories, clusters, category_cluster_map, pages)
    in one transaction. Not currently called by any tab's delete button --
    the Domain tab deletes just its `domains` row directly via Supabase,
    and the KW Cluster/Pages tabs each only delete their own slice (see
    delete_project_kw_data_endpoint/delete_project_pages_endpoint below),
    so deleting from one tab doesn't make a project vanish from the
    others. Kept as a full-teardown capability for if/when that's
    actually wanted from the UI."""
    proj = _resolve_project_or_404(project)
    db.delete_project(proj["slug"])
    return {"deleted": proj["slug"]}


@app.delete("/projects/{project}/kw-data")
def delete_project_kw_data_endpoint(project: str):
    """Removes just this project's KW Cluster data (keyword_categories,
    categories, clusters, category_cluster_map) -- leaves the project,
    its domain registration, and its pages intact, so it still shows up
    on the Domain and Pages tabs afterward. This is what the KW Cluster
    tab's delete button calls."""
    proj = _resolve_project_or_404(project)
    db.delete_project_kw_data(proj["slug"])
    return {"project": proj["name"], "kw_data_deleted": True}


@app.delete("/projects/{project}/pages")
def delete_project_pages_endpoint(project: str):
    """Removes just this project's page rows (Add Pages uploads) -- leaves
    the project, its domain registration, and its KW Cluster data intact,
    so it still shows up on the Domain and KW Cluster tabs afterward. This
    is what the Pages tab's delete button calls."""
    proj = _resolve_project_or_404(project)
    db.delete_project_pages(proj["slug"])
    return {"project": proj["name"], "pages_deleted": True}


@app.get("/projects/{project}/results")
def get_project_results(project: str):
    """ALL keyword results ever processed for this project, across every
    job -- includes the full audit trail per keyword."""
    proj = _resolve_project_or_404(project)
    return {"project": proj["name"], "results": db.get_domain_results(proj["slug"])}


@app.get("/projects/{project}/categories")
def get_project_categories(project: str):
    """Every distinct category in this project, with keyword count and one
    example audit trail."""
    proj = _resolve_project_or_404(project)
    return {"project": proj["name"], "categories": db.get_categories_overview(proj["slug"])}


@app.get("/projects/{project}/clusters")
def get_project_clusters(project: str):
    """Every distinct cluster in this project, with the categories grouped
    inside it."""
    proj = _resolve_project_or_404(project)
    return {"project": proj["name"], "clusters": db.get_clusters_overview(proj["slug"])}


@app.post("/projects/{project}/recluster")
def recluster_project(project: str):
    """Manually re-run the deterministic clustering pass over this
    project's entire category list. Normally this happens automatically
    once a job's categorization finishes -- this endpoint is for
    re-running it on demand."""
    proj = _resolve_project_or_404(project)
    assignment = category_checker.cluster_all_categories(proj["slug"])
    db.replace_domain_clusters(proj["slug"], assignment)
    return {"project": proj["name"], "categories_clustered": len(assignment)}


@app.post("/jobs/category")
async def create_category_job(
    file: UploadFile = File(...),
    country: str = Form(...),
    project: str = Form(...),
):
    """Upload a .csv/.xlsx with a 'Keywords' column (optionally 'Search
    Volume'). `country` is a country name (e.g. "India", "United States")
    or a 2-letter code (e.g. "in", "us") -- every SERP search in this job
    runs against that country's Google region. `project` is any name you
    want -- if it's never been used before, it's created automatically
    right here.

    Pre-inserts one row per keyword that passes the SV/'near me' filters,
    then processes them on a background thread (scripts/
    hosted_categorize.py -- Bright Data SERP fetch + a plain-requests
    info/comm classifier, no Selenium, no RQ/Redis) and returns
    immediately with a job_id to poll via GET /jobs/{job_id}."""
    country_code = category_checker.resolve_country_code(country)
    if not country_code:
        raise HTTPException(
            400,
            f"Unknown country: '{country}'. Try a full country name "
            f"(e.g. 'India', 'United States') or its 2-letter code (e.g. 'in', 'us')."
        )

    project_name = (project or "").strip()
    if not project_name:
        raise HTTPException(400, "Project name is required.")
    try:
        project_slug = db.get_or_create_project(project_name)
    except ValueError as e:
        raise HTTPException(400, str(e))

    filename = file.filename or "upload.csv"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(400, "File must be .csv, .xlsx, or .xls")

    contents = await file.read()
    try:
        df = _load_dataframe(contents, filename)
    except Exception as e:
        raise HTTPException(400, f"Could not read file: {e}")

    rows = _parse_upload(df)
    to_process = [r for r in rows if r["skip_reason"] is None]
    if not to_process:
        raise HTTPException(400, "No usable keyword rows found after filtering")

    job_id = db.create_job(filename, project_slug, project_name, country, country_code, total=len(to_process))
    db.set_job_status(job_id, "running")

    # Pre-insert one row per keyword RIGHT NOW, with whatever pass-through
    # sheet data (sv/kw_diff/type/target_subtype/target_geo/priority/
    # landing_page_url) it had -- stored immediately, regardless of
    # whether/when categorization succeeds. The background job below only
    # ever fills in category/cluster/status/meta on these SAME rows.
    row_ids = db.insert_keyword_rows(job_id, project_slug, to_process)
    rows_for_job = [{"id": row_id, "keyword": r["keyword"]} for r, row_id in zip(to_process, row_ids)]

    run_categorize_job_in_background(job_id, project_slug, rows_for_job, country_code)

    return {
        "job_id": job_id, "status": "running", "project": project_name, "project_slug": project_slug,
        "country": country, "country_code": country_code,
        "total": len(to_process), "skipped": len(rows) - len(to_process),
    }


class CategorizeExistingRequest(BaseModel):
    country: str


@app.post("/projects/{project}/categorize")
def categorize_existing_keywords(project: str, payload: CategorizeExistingRequest):
    """Trigger categorization for keywords ALREADY sitting in this
    project (inserted directly into Supabase by the frontend -- see
    projectsApi.js's insertKeywordRows -- with no category yet). This is
    what the frontend's "AI cluster" button calls.

    Runs entirely in-process, on a background thread
    (scripts/hosted_categorize.py) -- no RQ/Redis, no separate worker.
    SERP fetch uses Bright Data (category_checker.get_top3_for_category)
    and info/comm uses a plain-requests fetch
    (intent_classifier.classify_single_result_via_requests) instead of
    Selenium, since this runs on Render where no real browser is
    available -- category/landing-blog assignment themselves are
    unchanged, reusing category_assigner.py/landing_blog_classifier.py
    exactly as scripts/run_pipeline.py does locally.

    Never inserts new rows -- only enqueues (as a background job) one
    keyword per EXISTING row that doesn't have a category yet
    (status='queued'), so re-running it can never duplicate keywords."""
    proj = _resolve_project_or_404(project)

    country_code = category_checker.resolve_country_code(payload.country)
    if not country_code:
        raise HTTPException(
            400,
            f"Unknown country: '{payload.country}'. Try a full country name "
            f"(e.g. 'India', 'United States') or its 2-letter code (e.g. 'in', 'us')."
        )

    rows = db.get_uncategorized_keyword_rows(proj["slug"])
    if not rows:
        raise HTTPException(400, "No un-categorized keywords found for this project.")

    job_id = db.create_job(
        "existing-keywords", proj["slug"], proj["name"], payload.country, country_code, total=len(rows),
    )
    db.set_job_status(job_id, "running")

    run_categorize_job_in_background(job_id, proj["slug"], rows, country_code)

    return {"job_id": job_id, "project": proj["name"], "keywords_enqueued": len(rows)}


class PageRow(BaseModel):
    pageName: Optional[str] = None
    url: Optional[str] = None
    cluster: Optional[str] = None
    category: Optional[str] = None


class PageUpdateRequest(BaseModel):
    pageName: Optional[str] = None
    url: Optional[str] = None
    cluster: Optional[str] = None
    category: Optional[str] = None
    targetCategory: Optional[str] = None
    targetType: Optional[str] = None


class BulkDeletePagesRequest(BaseModel):
    ids: List[int]


def _page_row_to_json(row):
    return {
        "id": row["id"],
        "pageName": row.get("page_name"),
        "url": row.get("url"),
        "cluster": row.get("cluster"),
        "category": row.get("category"),
        "targetCategory": row.get("target_category"),
        "targetType": row.get("target_type"),
    }


@app.get("/projects/{project}/pages")
def list_project_pages(project: str):
    """Every page row uploaded for this project via Add Pages, in upload
    order."""
    proj = _resolve_project_or_404(project)
    return {"project": proj["name"], "pages": [_page_row_to_json(r) for r in db.get_page_rows(proj["slug"])]}


@app.post("/projects/{project}/pages")
def create_project_pages(project: str, rows: List[PageRow]):
    """Bulk-inserts page rows parsed from an Add Pages sheet upload (Page
    Name, URL, Cluster, Category columns) -- mirrors /jobs/category's
    upload flow but for pages, which have no categorization job of their
    own. Returns the inserted rows with their new ids."""
    proj = _resolve_project_or_404(project)
    if not rows:
        raise HTTPException(400, "No page rows to import.")
    inserted = db.insert_page_rows(proj["slug"], [r.dict() for r in rows])
    return {"project": proj["name"], "pages": [_page_row_to_json(r) for r in inserted]}


@app.patch("/pages/{page_id}")
def update_project_page(page_id: int, payload: PageUpdateRequest):
    """Updates whichever fields are present on a single page row (inline
    edits and the Target Category/Target Type header dropdowns in the
    Pages detail view)."""
    updates = {
        "page_name": payload.pageName, "url": payload.url, "cluster": payload.cluster,
        "category": payload.category, "target_category": payload.targetCategory,
        "target_type": payload.targetType,
    }
    updates = {k: v for k, v in updates.items() if v is not None}
    db.update_page_row(page_id, updates)
    return {"id": page_id}


@app.delete("/pages/{page_id}")
def delete_project_page(page_id: int):
    db.delete_page_row(page_id)
    return {"deleted": page_id}


@app.post("/pages/bulk-delete")
def bulk_delete_project_pages(payload: BulkDeletePagesRequest):
    db.bulk_delete_page_rows(payload.ids)
    return {"deleted": len(payload.ids)}


@app.get("/jobs")
def list_jobs():
    """All jobs, across every project."""
    return {"jobs": db.list_jobs()}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


@app.post("/jobs/{job_id}/check-rank")
def check_rank_for_job(job_id: str):
    """Manual trigger (the "check rank" button) -- runs one rank-check
    per keyword in this job on a background thread (scripts/
    hosted_rank_check.py, a thread pool -- no ordering dependency
    between keywords, so no single-worker restriction here unlike
    categorization). Not auto-triggered by categorization/clustering;
    call this once you're happy with how a job's category/cluster
    results look.

    Requires the job to have finished categorization (status
    'completed') -- rank-checking a still-running job would race against
    rows that haven't been categorized yet, and re-running this on the
    same job re-checks every keyword's rank again (safe to do, e.g. to
    refresh stale rankings, but each call re-checks ALL of the job's
    keywords, not just ones missing a rank)."""
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job["status"] != "completed":
        raise HTTPException(
            400,
            f"Job status is '{job['status']}', not 'completed' -- wait for "
            f"categorization to finish before checking rank."
        )
    if not job.get("clustering_triggered_at"):
        raise HTTPException(
            400,
            "Clustering hasn't been triggered for this job yet -- it usually "
            "fires within moments of the job completing; try again shortly."
        )

    country_code = job.get("country_code")
    project_slug = job["domain"]

    rows = db.get_job_keyword_rows_for_rank_check(job_id)
    run_rank_check_job_in_background(project_slug, rows, country_code)

    return {"job_id": job_id, "rank_checks_enqueued": len(rows)}


@app.get("/jobs/{job_id}/results")
def get_job_results(job_id: str):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    results = db.get_job_category_results(job_id)
    return {
        "job_id": job_id, "project": job.get("project_name"), "status": job["status"],
        "results": results,
    }


@app.get("/jobs/{job_id}/download")
def download_job(job_id: str):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")

    results = db.get_job_category_results(job_id)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Keyword", "SV", "KW Diff", "Type", "Category", "Cluster", "Target Type", "Target Subtype",
        "Target Geo", "Priority", "Landing Page (URL)", "Status", "Error", "Checked At",
    ])
    for r in results:
        writer.writerow([
            r["keyword"], r.get("sv") or "", r.get("kw_diff") or "", r.get("type") or "",
            r["category"] or "", r["cluster"] or "", r.get("target_type") or "", r.get("target_subtype") or "",
            r.get("target_geo") or "", r.get("priority") or "", r.get("landing_page_url") or "",
            r["status"] or "", r["error"] or "", r["checked_at"],
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="category_results_{job_id}.csv"'},
    )
