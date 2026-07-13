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
external service this API depends on now. There is no separate job
queue/worker process anymore: category/cluster/landing-blog/info-comm
work is done by scripts/run_pipeline.py (run directly, or via
test_api.py), which writes straight into the SAME shared tables this API
reads from (see scripts/run_pipeline.py and core/db.py's
insert_pipeline_result()). This app is a read/query layer over that data
plus the domain/project registry -- it no longer accepts uploads or
enqueues any processing itself.

Auth is intentionally NOT wired in here yet -- every endpoint is open.
Lock this down before deploying publicly.

Endpoints:
    POST /domains                          register a domain <-> project
                                           (the "Create Project" form)
    GET  /domains                          list every domain that's been
                                           registered
    GET  /projects                         list every project that exists
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
    GET  /jobs                             list all jobs (every project)
    GET  /jobs/{job_id}                     poll job status/progress
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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import db
from services import category_checker

app = FastAPI(title="Category API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock this down to your actual frontend domain before going live
    allow_methods=["*"],
    allow_headers=["*"],
)


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
