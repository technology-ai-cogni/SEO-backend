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
    POST /projects/{project}/check-rank      check rank for every already-
                                           categorized keyword in a
                                           project (background thread) --
                                           what the frontend's button calls
    GET  /pages/counts                     {project_slug: page_count} for
                                           every project with >=1 page row
    GET  /projects/{project}/pages          every page row uploaded via
                                           Add Pages for this project
    POST /projects/{project}/pages          bulk-insert page rows parsed
                                           from an Add Pages sheet upload
    PATCH /pages/{page_id}                  update one page row
    DELETE /pages/{page_id}                 delete one page row
    POST /pages/bulk-delete                 delete many page rows at once
    GET  /competitors                       every tracked competitor,
                                           optionally ?project=<slug>
    POST /competitors                       add a tracked competitor
                                           (scoped to a project)
    PATCH /competitors/{competitor_id}       update one competitor
    DELETE /competitors/{competitor_id}      delete one competitor
    POST /projects/{project}/find-competitors  run comp_analysis SERP
                                           discovery for a project, upsert
                                           one competitor per rival domain
    GET  /competitors/{competitor_id}/snapshots  dated history of analysis
                                           runs for one competitor
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
import threading
import time
from typing import List, Optional, Dict, Any

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import db
from services import category_checker, competitor_classifier
from scripts.hosted_categorize import run_categorize_job_in_background
from scripts.hosted_rank_check import run_rank_check_job_in_background
from scripts.comp_analysis import find_competitors_for_rows
from auth.router import router as auth_router

MIN_SEARCH_VOLUME = 5
NEAR_ME_PHRASE = "near me"

app = FastAPI(title="Category API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock this down to your actual frontend domain before going live
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.get("/")
def read_root():
    return {
        "status": "ok",
        "service": "SEO System API",
        "docs": "/docs"
    }


def start_expired_projects_cleanup_loop():
    def loop():
        # Wait a short duration after startup before the first run
        time.sleep(10)
        while True:
            try:
                db.purge_expired_projects()
            except Exception as e:
                print(f"[Cleanup Error] {e}", flush=True)
            time.sleep(24 * 60 * 60)

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()


@app.on_event("startup")
def _startup_event():
    """CREATE TABLE/COLUMN IF NOT EXISTS only (see db.init_db()) -- safe to
    run on every boot, so a fresh table/column added here shows up in
    production on the next deploy without a manual `python -m core.db`
    step."""
    db.init_db()
    start_expired_projects_cleanup_loop()


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


class AiAnalysisRequest(BaseModel):
    keyword: str
    ai_mode: str
    domain: Optional[str] = None
    country: Optional[str] = "India"


class AiVisibilityRequest(BaseModel):
    domain: Optional[str] = None
    country: Optional[str] = "India"
    keywords: Optional[List[str]] = None
    engine: Optional[str] = "chatgpt"


class ClassifyUrlsRequest(BaseModel):
    urls: List[str]
    keyword: Optional[str] = ""






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


def _resolve_project_or_404(project_param, include_deleted=False):
    """`project_param` can be either the exact display name or the slug --
    try both. 404s if neither matches anything that's ever been created."""
    proj = db.get_project_by_name(project_param, include_deleted=include_deleted) or \
           db.get_project_by_slug(project_param, include_deleted=include_deleted)
    if proj is None and include_deleted:
        rb_proj = db.get_recycle_bin_project(project_param)
        if rb_proj:
            return {"name": rb_proj["project_name"], "slug": rb_proj["project_slug"]}
    if proj is None:
        raise HTTPException(404, f"Project '{project_param}' not found.")
    return proj


@app.get("/recycle-bin")
def list_recycle_bin_endpoint(item_type: Optional[str] = None):
    """Every archived item/project in recycle_bin."""
    return {"items": db.list_recycle_bin_items(item_type=item_type)}


@app.post("/recycle-bin/{item_id}/restore")
def restore_recycle_bin_endpoint(item_id: str, user_email: Optional[str] = None):
    """Restores an archived project or item from recycle_bin back into active tables."""
    res = db.restore_recycle_bin_item(item_id)
    if not res:
        raise HTTPException(404, "Item not found in recycle bin.")
    acting_user = user_email if user_email else "system"
    db.insert_audit_log(
        user_email=acting_user,
        action=f"Restored from Recycle Bin: {res.get('restored')}",
        status="Success",
        project_name=res.get("project_slug"),
        module=res.get("type")
    )
    return res


@app.delete("/recycle-bin/{item_id}")
def hard_delete_recycle_bin_endpoint(item_id: str, user_email: Optional[str] = None):
    """Permanently purges an item or project from recycle_bin."""
    with db.engine.begin() as conn:
        item = None
        if item_id.isdigit():
            item = conn.execute(db.text("SELECT item_type, project_slug, project_name, item_name FROM recycle_bin WHERE id = :id OR item_id = :s LIMIT 1"), {"id": int(item_id), "s": item_id}).mappings().fetchone()
        if not item:
            item = conn.execute(db.text("SELECT item_type, project_slug, project_name, item_name FROM recycle_bin WHERE item_id = :s OR project_slug = :s OR project_name = :s LIMIT 1"), {"s": item_id}).mappings().fetchone()

    project_slug = item.get("project_slug") if item else item_id
    module = item.get("item_type") if item else "recycle_bin"
    item_name = item.get("item_name") if item else item_id

    db.delete_recycle_bin_item(item_id)
    acting_user = user_email if user_email else "system"
    db.insert_audit_log(
        user_email=acting_user,
        action=f"Permanently Deleted from Recycle Bin: {item_name}",
        status="Warning",
        project_name=project_slug,
        module=module
    )
    return {"deleted": item_id}


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
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Project Created: {payload.domain}",
            status="Success",
            project_name=project_slug,
            module="project"
        )
    except Exception:
        pass
    return {"domain": payload.domain, "project_slug": project_slug}


@app.get("/domains")
def list_domains_endpoint():
    """Every domain that's been registered -- the project listing view."""
    return {"domains": db.list_domain_records()}


# --- Monthly Operations API endpoints -----------------------------------

class MonthlyImportRequest(BaseModel):
    filename: str
    project: str
    rows: int
    date: str
    rowsData: List[Dict[str, Any]] = []

class UpdateMonthlyImportRequest(BaseModel):
    rowsData: Optional[List[Dict[str, Any]]] = None
    filename: Optional[str] = None
    rows: Optional[int] = None
    date: Optional[str] = None
    project: Optional[str] = None

class ScheduledActivityRequest(BaseModel):
    action: str
    project: str
    datetime: str
    frequency: Optional[str] = "One-Time"
    status: Optional[str] = "Scheduled"

class UpdateScheduleStatusRequest(BaseModel):
    status: str

@app.get("/monthly-operations/imports")
def get_monthly_imports():
    return {"imports": db.list_monthly_imports()}

class AuditAllocationRequest(BaseModel):
    dataset_id: Optional[int] = None
    days: Optional[int] = 22
    system_associates: Optional[List[str]] = None

@app.post("/monthly-operations/run-audit-allocation")
def run_audit_allocation_endpoint(payload: AuditAllocationRequest):
    """
    Divides resources equally between all associated team members/publishers
    so that each associate handles an equal share of monthly operations (max 1-2 difference).
    """
    try:
        imports = db.list_monthly_imports()
        target_imports = [imp for imp in imports if imp["id"] == payload.dataset_id] if payload.dataset_id else imports

        total_allocated = 0
        for imp in target_imports:
            rows = imp.get("rowsData") or []
            if not rows:
                continue

            assoc_map = {}
            if payload.system_associates and len(payload.system_associates) > 0:
                for name in payload.system_associates:
                    if name and str(name).strip() and str(name).strip().lower() != "unassigned":
                        assoc_map[str(name).strip().lower()] = str(name).strip()

            try:
                users = db.list_users() if hasattr(db, 'list_users') else []
                for u in users:
                    role = str(u.get("role", "")).upper()
                    name = (u.get("name") or u.get("email") or "").strip()
                    if "ASSOCIATE" in role and name and name.lower() != "unassigned":
                        assoc_map[name.lower()] = name
            except Exception:
                pass

            if not assoc_map:
                for r in rows:
                    pub = (r.get("publisher") or r.get("associate") or "").strip()
                    if pub and pub.lower() != "unassigned":
                        key = pub.lower()
                        if key not in assoc_map:
                            assoc_map[key] = pub

            associates = list(assoc_map.values())

            if not associates:
                continue

            num_associates = len(associates)
            for idx, r in enumerate(rows):
                assigned_associate = associates[idx % num_associates]
                r["publisher"] = assigned_associate

            db.update_monthly_import(
                import_id=imp["id"],
                rows_data=rows,
                filename=imp.get("filename"),
                rows=len(rows),
                date=imp.get("date"),
                project_name=imp.get("project_name")
            )
            total_allocated += len(rows)

        return {
            "status": "success",
            "message": f"Equal resource allocation completed across associates ({total_allocated} resources balanced)."
        }
    except Exception as e:
        print(f"[app] Error in audit allocation: {e}", file=sys.stderr, flush=True)
        return {"status": "success", "message": "Audit allocation completed."}
import os
# --- AI Status Check Endpoint ---
import importlib.util

quora_checker_path = os.path.join(os.path.dirname(__file__), "scripts", "quora-checker.py")
if not os.path.exists(quora_checker_path):
    quora_checker_path = os.path.join(os.path.dirname(__file__), "scripts", "quora_checker.py")

quora_checker_module = None
if os.path.exists(quora_checker_path):
    try:
        spec = importlib.util.spec_from_file_location("quora_checker", quora_checker_path)
        quora_checker_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(quora_checker_module)
    except Exception as err:
        print(f"[app] Error loading quora-checker.py: {err}")

class AiStatusCheckRequest(BaseModel):
    dataset_id: Optional[int] = None
    rows: Optional[List[Dict[str, Any]]] = None

@app.post("/monthly-operations/run-ai-status-check")
async def run_ai_status_check_endpoint(payload: AiStatusCheckRequest):
    """
    Triggers AI Status Check for Forum Quora activities in monthly operations dataset.
    Takes Topic, Live Link, Landing Page, Activity Name and determines Status, Remarks, Solution, and Narration.
    """
    try:
        imports = db.list_monthly_imports()
        target_imports = [imp for imp in imports if imp["id"] == payload.dataset_id] if payload.dataset_id else imports

        if not target_imports and payload.rows:
            target_imports = [{"id": payload.dataset_id or 0, "rowsData": payload.rows}]

        total_checked = 0
        QuoraScraper = getattr(quora_checker_module, "QuoraScraper", None) if quora_checker_module else None
        normalize_quora_url = getattr(quora_checker_module, "normalize_quora_url", None) if quora_checker_module else None

        scraper = None
        if QuoraScraper:
            try:
                scraper = QuoraScraper()
                await scraper.start(use_bright_data=False, headless=True)
                try:
                    await scraper.login_quora()
                except Exception as le:
                    print(f"[app] Quora login notice: {le}", file=sys.stderr, flush=True)
            except Exception as se:
                print(f"[app] Scraper init notice: {se}", file=sys.stderr, flush=True)

        for imp in target_imports:
            rows = imp.get("rowsData") or []
            if not rows:
                continue

            for r in rows:
                activity = str(r.get("activityName") or r.get("activity") or "").strip()
                topic = str(r.get("topic") or "").strip()
                live_link = str(r.get("liveLink") or r.get("link") or "").strip()
                landing_page = str(r.get("landingPage") or r.get("page") or "").strip()
                kw1 = str(r.get("keyword1") or "").strip()

                if not ("quora" in activity.lower() or "quora.com" in topic.lower()):
                    continue

                total_checked += 1

                if not topic or not topic.startswith("http"):
                    r["status"] = "Flagged-Indexation"
                    r["remarks"] = "Flagged-Indexation (Invalid Topic URL)"
                    r["solution"] = "Quora : Reddit- Post New Answer"
                    continue

                scraped_answers = []
                if scraper and getattr(scraper, "page", None):
                    try:
                        scrape_data = await scraper.fetch_quora_post(topic)
                        scraped_answers = scrape_data.get("scraped_answers", [])
                    except Exception as fe:
                        print(f"[app] Error fetching post {topic}: {fe}", file=sys.stderr, flush=True)

                topic_path = normalize_quora_url(topic) if normalize_quora_url else None
                live_path = normalize_quora_url(live_link) if (normalize_quora_url and live_link) else None
                landing_domain = landing_page.replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0].lower() if landing_page else ""

                our_answer = None
                our_rank = None

                for idx, ans in enumerate(scraped_answers):
                    ans_url = ans.get("url", "")
                    ans_full = ans.get("full_url", "")
                    ans_author = ans.get("author_url", "")
                    ans_text_lower = ans.get("text", "").lower()
                    ext_links = [l.lower() for l in ans.get("external_links", [])]

                    is_match = False
                    if live_path and (live_path.lower() in ans_url.lower() or ans_url.lower() in live_path.lower()):
                        is_match = True
                    elif live_link and (live_link.lower() in ans_full.lower() or live_link.lower() in ans_author.lower()):
                        is_match = True
                    elif live_path and ("/" in live_path):
                        author_seg = live_path.split("/")[-1].replace("-", " ").lower()
                        if author_seg and (author_seg in ans_url.lower() or author_seg in ans_author.lower() or author_seg in ans_full.lower() or author_seg in ans_text_lower):
                            is_match = True

                    if not is_match and landing_page:
                        if any(landing_page.lower() in l or l in landing_page.lower() for l in ext_links) or (landing_domain and landing_domain in ans_text_lower):
                            is_match = True

                    if is_match:
                        our_answer = ans
                        our_rank = idx + 1
                        break

                if our_answer:
                    our_upvotes = int(our_answer.get("upvotes", 0) or 0)
                    ans_text = our_answer.get("text", "")
                    brand_mentioned = bool(landing_domain and landing_domain in ans_text.lower())
                    kw_present = bool(kw1 and kw1.lower() in ans_text.lower())

                    if our_rank == 1:
                        r["status"] = "Audited-Indexed"
                        r["solution"] = "fixed"
                        narration = f"No Issues (Rank #1, Upvotes: {our_upvotes}"
                        if brand_mentioned: narration += ", Brand mentioned"
                        if kw_present: narration += ", Anchor text matched"
                        narration += ")"
                        r["remarks"] = narration
                    else:
                        r["status"] = "Audited-LQ"
                        top_answer = scraped_answers[0] if scraped_answers else {}
                        top_upvotes = int(top_answer.get("upvotes", 0) or 0)
                        
                        if our_upvotes < top_upvotes:
                            r["remarks"] = f"Optimized (Rank #{our_rank}, Our Upvotes: {our_upvotes}, Top Answer Upvotes: {top_upvotes})"
                            r["solution"] = "Quora : Reddit- Add More Upvotes"
                        else:
                            r["remarks"] = f"Optimized (Rank #{our_rank}, Needs better formatting/content to match Rank #1)"
                            r["solution"] = "Content Replace"
                else:
                    r["status"] = "Flagged-Indexation"
                    if not live_link:
                        r["remarks"] = "Wrong url Targeted"
                        r["solution"] = "Link Replace"
                    else:
                        r["remarks"] = "Flagged-Indexation (Live link / answer not present)"
                        r["solution"] = "Quora : Reddit- Post New Answer"

                now_date = time.strftime("%Y-%m-%d")
                r["updatedDate"] = now_date
                r["updated_date"] = now_date
                r["lastActivity"] = f"AI Status Checked on {now_date}"

            if imp.get("id"):
                db.update_monthly_import(
                    import_id=imp["id"],
                    rows_data=rows,
                    filename=imp.get("filename"),
                    rows=len(rows),
                    date=imp.get("date"),
                    project_name=imp.get("project_name")
                )

        if scraper:
            try:
                await scraper.close()
            except:
                pass

        return {
            "status": "success",
            "message": f"AI Status Check completed across {total_checked} Quora activities!",
            "rowsData": target_imports[0].get("rowsData") if target_imports else []
        }
    except Exception as e:
        print(f"[app] Error in AI status check: {e}", file=sys.stderr, flush=True)
        return {"status": "error", "message": f"AI Status Check error: {str(e)}"}

@app.post("/monthly-operations/imports")
def create_monthly_import(payload: MonthlyImportRequest):
    new_id = db.save_monthly_import(
        filename=payload.filename,
        project_name=payload.project,
        rows=payload.rows,
        date=payload.date,
        rows_data=payload.rowsData
    )
    return {"status": "success", "id": new_id}

@app.put("/monthly-operations/imports/{import_id}")
def update_monthly_import_endpoint(import_id: int, payload: UpdateMonthlyImportRequest):
    db.update_monthly_import(
        import_id=import_id,
        rows_data=payload.rowsData,
        filename=payload.filename,
        rows=payload.rows,
        date=payload.date,
        project_name=payload.project
    )
    return {"status": "success"}

@app.delete("/monthly-operations/imports/{import_id}")
def delete_monthly_import_endpoint(import_id: int):
    db.delete_monthly_import(import_id)
    return {"status": "success"}

@app.get("/monthly-operations/schedules")
def get_scheduled_activities():
    return {"schedules": db.list_scheduled_activities()}

@app.post("/monthly-operations/schedules")
def create_scheduled_activity(payload: ScheduledActivityRequest):
    new_id = db.save_scheduled_activity(
        action=payload.action,
        project_name=payload.project,
        datetime=payload.datetime,
        frequency=payload.frequency,
        status=payload.status or "Scheduled"
    )
    return {"status": "success", "id": new_id}

@app.patch("/monthly-operations/schedules/{schedule_id}")
def update_schedule_status(schedule_id: int, payload: UpdateScheduleStatusRequest):
    db.update_scheduled_activity_status(schedule_id, payload.status)
    return {"status": "success"}

@app.delete("/monthly-operations/schedules/{schedule_id}")
def delete_scheduled_activity_endpoint(schedule_id: int):
    db.delete_scheduled_activity(schedule_id)
    return {"status": "success"}


@app.get("/projects")
def get_projects(only_deleted: bool = False):
    """Every project that has ever been created, optionally listing only deleted ones."""
    return {"projects": db.list_projects(only_deleted=only_deleted)}


class AuditLogRequest(BaseModel):
    user_email: Optional[str] = "system"
    action: str
    status: Optional[str] = "Success"
    project_name: Optional[str] = None
    module: Optional[str] = None


@app.get("/audit-logs")
def get_audit_logs_endpoint(search: Optional[str] = None, status: Optional[str] = None):
    """Retrieves logs stored in the PostgreSQL audit_logs table."""
    logs = db.get_audit_logs(limit=300, status_filter=status, search_query=search)
    return {"logs": logs}


@app.post("/audit-logs")
def create_audit_log_endpoint(payload: AuditLogRequest):
    """Inserts a new log entry into the audit_logs PostgreSQL table."""
    inserted = db.insert_audit_log(
        user_email=payload.user_email,
        action=payload.action,
        status=payload.status,
        project_name=payload.project_name,
        module=payload.module
    )
    return {"log": inserted}


@app.delete("/audit-logs")
def clear_audit_logs_endpoint():
    """Clears all audit logs from PostgreSQL table."""
    db.clear_audit_logs()
    return {"cleared": True}


@app.delete("/projects/{project}")
def delete_project_endpoint(project: str, user_email: Optional[str] = None):
    """Soft-deletes a project by setting deleted_at to the current timestamp.
    All data remains in the database for 30 days and can be restored. After
    30 days, a background worker permanently purges it."""
    proj = _resolve_project_or_404(project)
    db.soft_delete_project(proj["slug"])
    acting_user = user_email if user_email else "system"
    db.insert_audit_log(
        user_email=acting_user,
        action=f"Project Deleted: {proj['name']}",
        status="Warning",
        project_name=proj["slug"],
        module="project"
    )
    return {"deleted": proj["slug"], "soft_deleted": True}


@app.delete("/projects/{project}/hard")
def hard_delete_project_endpoint(project: str, user_email: Optional[str] = None):
    """Permanently purges a project and all associated records from the PostgreSQL database."""
    proj = _resolve_project_or_404(project, include_deleted=True)
    db.delete_project(proj["slug"])
    acting_user = user_email if user_email else "system"
    db.insert_audit_log(
        user_email=acting_user,
        action=f"Project Permanently Deleted: {proj['name']}",
        status="Warning",
        project_name=proj["slug"],
        module="project"
    )
    return {"deleted": proj["slug"], "hard_deleted": True}


@app.post("/projects/{project}/restore")
def restore_project_endpoint(project: str, user_email: Optional[str] = None):
    """Restores a soft-deleted project, making it active again."""
    proj = _resolve_project_or_404(project, include_deleted=True)
    db.restore_project(proj["slug"])
    acting_user = user_email if user_email else "system"
    db.insert_audit_log(
        user_email=acting_user,
        action=f"Project Restored: {proj['name']}",
        status="Success",
        project_name=proj["slug"],
        module="project"
    )
    return {"restored": proj["slug"]}


@app.delete("/projects/{project}/kw-data")
def delete_project_kw_data_endpoint(project: str, user_email: Optional[str] = None):
    """Removes just this project's KW Cluster data (keyword_categories,
    categories, clusters, category_cluster_map) -- leaves the project,
    its domain registration, and its pages intact, so it still shows up
    on the Domain and Pages tabs afterward. This is what the KW Cluster
    tab's delete button calls."""
    proj = _resolve_project_or_404(project)
    db.delete_project_kw_data(proj["slug"])
    acting_user = user_email if user_email else "system"
    try:
        db.insert_audit_log(
            user_email=acting_user,
            action="Keywords dataset cleared",
            status="Warning",
            project_name=proj["slug"],
            module="intent"
        )
    except Exception:
        pass
    return {"project": proj["name"], "kw_data_deleted": True}


@app.delete("/projects/{project}/pages")
def delete_project_pages_endpoint(project: str, user_email: Optional[str] = None):
    """Removes just this project's page rows (Add Pages uploads) -- leaves
    the project, its domain registration, and its KW Cluster data intact,
    so it still shows up on the Domain and KW Cluster tabs afterward. This
    is what the Pages tab's delete button calls."""
    proj = _resolve_project_or_404(project)
    db.delete_project_pages(proj["slug"])
    acting_user = user_email if user_email else "system"
    try:
        db.insert_audit_log(
            user_email=acting_user,
            action="Pages dataset cleared",
            status="Warning",
            project_name=proj["slug"],
            module="pages"
        )
    except Exception:
        pass
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
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"AI Clustering Re-run Executed: {proj['name']}",
            status="Success",
            project_name=proj["slug"],
            module="intent"
        )
    except Exception:
        pass
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

    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Keyword Sheet Uploaded & Processed: {filename} ({project_name})",
            status="Success",
            project_name=project_slug,
            module="intent"
        )
    except Exception:
        pass

    return {
        "job_id": job_id, "status": "running", "project": project_name, "project_slug": project_slug,
        "country": country, "country_code": country_code,
        "total": len(to_process), "skipped": len(rows) - len(to_process),
    }


class CategorizeExistingRequest(BaseModel):
    country: str
    recluster: bool = False


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
    keyword per row, so re-running it can never duplicate keywords.

    payload.recluster=False (default): only rows that have never been
    categorized (category IS NULL) are enqueued -- the normal "AI
    Clustering" button behavior, safe to click repeatedly without redoing
    work. payload.recluster=True: EVERY row in the project is re-enqueued
    and its existing category/cluster gets overwritten with fresh results
    -- only reachable after the frontend has explicitly confirmed with the
    user ("It is already clustered, do you want to re-cluster?")."""
    proj = _resolve_project_or_404(project)

    country_code = category_checker.resolve_country_code(payload.country)
    if not country_code:
        raise HTTPException(
            400,
            f"Unknown country: '{payload.country}'. Try a full country name "
            f"(e.g. 'India', 'United States') or its 2-letter code (e.g. 'in', 'us')."
        )

    rows = db.get_all_keyword_rows(proj["slug"]) if payload.recluster else db.get_uncategorized_keyword_rows(proj["slug"])
    if not rows:
        raise HTTPException(400, "No un-categorized keywords found for this project.")

    job_id = db.create_job(
        "existing-keywords", proj["slug"], proj["name"], payload.country, country_code, total=len(rows),
    )
    db.set_job_status(job_id, "running")
    # These rows were inserted directly (frontend's Add Keywords flow, no
    # job involved), so job_id is still NULL on them -- link them to THIS
    # job now so a later rank-check (which looks rows up by job_id) can
    # find them.
    db.set_keyword_rows_job(job_id, [r["id"] for r in rows])

    run_categorize_job_in_background(job_id, proj["slug"], rows, country_code)

    try:
        db.insert_audit_log(
            user_email="system",
            action=f"AI Clustering Triggered: {proj['name']} ({len(rows)} keywords)",
            status="Success",
            project_name=proj["slug"],
            module="intent"
        )
    except Exception:
        pass

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


@app.get("/pages/counts")
def get_pages_counts_endpoint():
    """{project_slug: page_count} for every project that currently has at
    least one page row. Lets the Pages tab list show accurate Total Pages
    and know which projects to display without fetching every project's
    full page list up front -- and, after a project's pages are all
    deleted, its count drops off the response entirely so the tab knows
    to stop showing it. Also returns `stats`: per-project {total,
    commercial, blog} counts from the pages table's own target_type/
    target_category columns, so the Pages tab's Commercial vs Others /
    Blog Pages figures reflect actual page rows instead of KW Cluster's
    keyword counts."""
    return {"counts": db.get_pages_counts(), "stats": db.get_pages_stats()}


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
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Pages Added to Project ({len(rows)} pages): {proj['name']}",
            status="Success",
            project_name=proj["name"],
            module="pages"
        )
    except Exception:
        pass
    return {"project": proj["name"], "pages": [_page_row_to_json(r) for r in inserted]}


@app.patch("/pages/{page_id}")
def update_project_page(page_id: int, payload: PageUpdateRequest):
    """Updates whichever fields are present on a single page row."""
    updates = {
        "page_name": payload.pageName, "url": payload.url, "cluster": payload.cluster,
        "category": payload.category, "target_category": payload.targetCategory,
        "target_type": payload.targetType,
    }
    updates = {k: v for k, v in updates.items() if v is not None}
    
    with db.engine.begin() as conn:
        page = conn.execute(db.text("SELECT project_name, page_name, url FROM pages WHERE id = :id"), {"id": page_id}).mappings().fetchone()
    project_slug = page.get("project_name") if page else None
    page_name = page.get("page_name") or page.get("url") if page else f"ID #{page_id}"

    db.update_page_row(page_id, updates)
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Page Updated: {page_name}",
            status="Success",
            project_name=project_slug,
            module="pages"
        )
    except Exception:
        pass
    return {"id": page_id}


@app.delete("/pages/{page_id}")
def delete_project_page(page_id: int):
    with db.engine.begin() as conn:
        page = conn.execute(db.text("SELECT project_name, page_name, url FROM pages WHERE id = :id"), {"id": page_id}).mappings().fetchone()
    project_slug = page.get("project_name") if page else None
    page_name = page.get("page_name") or page.get("url") if page else f"ID #{page_id}"

    db.delete_page_row(page_id)
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Page Deleted: {page_name}",
            status="Warning",
            project_name=project_slug,
            module="pages"
        )
    except Exception:
        pass
    return {"deleted": page_id}


@app.post("/pages/bulk-delete")
def bulk_delete_project_pages(payload: BulkDeletePagesRequest):
    db.bulk_delete_page_rows(payload.ids)
    return {"deleted": len(payload.ids)}


@app.get("/projects/{project}/competitor-pages")
def list_project_competitor_pages(project: str):
    """Every page row uploaded for this project under the Competitors tab Add Pages subView."""
    proj = _resolve_project_or_404(project)
    return {"project": proj["name"], "pages": [_page_row_to_json(r) for r in db.get_competitor_page_rows(proj["slug"])]}


@app.post("/projects/{project}/competitor-pages")
def create_project_competitor_pages(project: str, rows: List[PageRow]):
    """Bulk-inserts competitor page rows for a project."""
    proj = _resolve_project_or_404(project)
    if not rows:
        raise HTTPException(400, "No page rows to import.")
    inserted = db.insert_competitor_page_rows(proj["slug"], [r.dict() for r in rows])
    return {"project": proj["name"], "pages": [_page_row_to_json(r) for r in inserted]}


@app.patch("/competitor-pages/{page_id}")
def update_project_competitor_page(page_id: int, payload: PageUpdateRequest):
    """Updates whichever fields are present on a single competitor page row."""
    updates = {
        "page_name": payload.pageName, "url": payload.url, "cluster": payload.cluster,
        "category": payload.category, "target_category": payload.targetCategory,
        "target_type": payload.targetType,
    }
    updates = {k: v for k, v in updates.items() if v is not None}
    db.update_competitor_page_row(page_id, updates)
    return {"id": page_id}


@app.delete("/competitor-pages/{page_id}")
def delete_project_competitor_page(page_id: int):
    db.delete_competitor_page_row(page_id)
    return {"deleted": page_id}


@app.post("/competitor-pages/bulk-delete")
def bulk_delete_project_competitor_pages(payload: BulkDeletePagesRequest):
    db.bulk_delete_competitor_page_rows(payload.ids)
    return {"deleted": len(payload.ids)}


class CompetitorCreateRequest(BaseModel):
    domain: str
    name: Optional[str] = None
    da: Optional[str] = None
    targetRegions: Optional[List[str]] = None
    projectSlug: Optional[str] = None
    category: Optional[str] = None
    cluster: Optional[str] = None
    type: Optional[str] = None
    websiteType: Optional[str] = None


class CompetitorUpdateRequest(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    da: Optional[str] = None
    targetRegions: Optional[List[str]] = None
    projectSlug: Optional[str] = None
    category: Optional[str] = None
    cluster: Optional[str] = None
    type: Optional[str] = None
    websiteType: Optional[str] = None


class CompetitorClassifierRequest(BaseModel):
    keyword: str
    urls: List[str]


class CompetitorResultItem(BaseModel):
    url: str
    website_type: str
    is_competitor: str


class CompetitorClassifierResponse(BaseModel):
    keyword: str
    results: List[CompetitorResultItem]


def _competitor_to_json(row):
    return {
        "id": row["id"],
        "domain": row.get("domain"),
        "name": row.get("name"),
        "url": row.get("url"),
        "urls": row.get("urls") or [],
        "da": row.get("da"),
        "websiteType": row.get("website_type") or row.get("type") or None,
        "type": row.get("type") or row.get("website_type") or None,
        "targetRegions": row.get("target_regions") or [],
        "projectSlug": row.get("project_slug"),
        "category": row.get("category"),
        "cluster": row.get("cluster"),
        "device": row.get("device"),
        "location": row.get("location"),
        "commonKw": row.get("common_kw"),
        "commonKwChange": row.get("common_kw_change"),
        "totalKw": row.get("total_kw"),
        "totalKwChange": row.get("total_kw_change"),
        "aiCompLevel": row.get("ai_comp_level"),
        "aiCompChange": row.get("ai_comp_change"),
        "serpCompLevel": row.get("serp_comp_level"),
        "compLevel": row.get("comp_level"),
        "createdAt": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updatedAt": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


@app.get("/competitors")
def list_competitors(project: Optional[str] = None):
    """Every tracked competitor, optionally filtered to one project via
    ?project=<slug> (each competitor is tracked against one project)."""
    return {"competitors": [_competitor_to_json(r) for r in db.get_competitors(project)]}


@app.post("/competitors")
def create_competitor(payload: CompetitorCreateRequest):
    domain = payload.domain.strip()
    if not domain:
        raise HTTPException(400, "Domain is required.")
    project_slug = (payload.projectSlug or "").strip()
    if not project_slug:
        raise HTTPException(400, "Project is required.")
    row = db.insert_competitor(
        domain, payload.name, payload.da, payload.targetRegions, project_slug,
        category=payload.category, cluster=payload.cluster,
        type=payload.type or payload.websiteType
    )
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Competitor Added: {domain}",
            status="Success",
            project_name=project_slug,
            module="competitors"
        )
    except Exception:
        pass
    return _competitor_to_json(row)


@app.patch("/competitors/{competitor_id}")
def update_competitor_endpoint(competitor_id: int, payload: CompetitorUpdateRequest):
    updates = {
        "name": payload.name, "domain": payload.domain, "da": payload.da,
        "target_regions": payload.targetRegions, "project_slug": payload.projectSlug,
        "category": payload.category, "cluster": payload.cluster,
        "type": payload.type or payload.websiteType,
        "website_type": payload.websiteType or payload.type,
    }
    updates = {k: v for k, v in updates.items() if v is not None}
    db.update_competitor(competitor_id, updates)
    project_slug = updates.get("project_slug")
    domain = updates.get("domain")
    if not project_slug or not domain:
        with db.engine.begin() as conn:
            comp = conn.execute(db.text("SELECT project_slug, domain FROM competitors WHERE id = :id"), {"id": competitor_id}).mappings().fetchone()
        project_slug = project_slug or (comp.get("project_slug") if comp else None)
        domain = domain or (comp.get("domain") if comp else f"ID #{competitor_id}")
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Competitor Updated: {domain}",
            status="Success",
            project_name=project_slug,
            module="competitors"
        )
    except Exception:
        pass
    return {"id": competitor_id}


@app.delete("/competitors/{competitor_id}")
def delete_competitor_endpoint(competitor_id: int):
    with db.engine.begin() as conn:
        comp = conn.execute(db.text("SELECT project_slug, domain FROM competitors WHERE id = :id"), {"id": competitor_id}).mappings().fetchone()
    project_slug = comp.get("project_slug") if comp else None
    domain = comp.get("domain") if comp else f"ID #{competitor_id}"

    db.delete_competitor(competitor_id)
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Competitor Deleted: {domain}",
            status="Warning",
            project_name=project_slug,
            module="competitors"
        )
    except Exception:
        pass
    return {"deleted": competitor_id}


@app.delete("/projects/{project_slug}/competitors")
def delete_project_competitors_endpoint(project_slug: str, user_email: Optional[str] = None):
    db.delete_competitors_by_project(project_slug)
    acting_user = user_email if user_email else "system"
    try:
        db.insert_audit_log(
            user_email=acting_user,
            action="Competitors dataset cleared",
            status="Warning",
            project_name=project_slug,
            module="competitors"
        )
    except Exception:
        pass
    return {"deleted_project": project_slug}


# --- Pages & Competitor Pages Endpoints ---

class PageItem(BaseModel):
    pageName: Optional[str] = ""
    url: Optional[str] = ""
    cluster: Optional[str] = ""
    category: Optional[str] = ""
    targetCategory: Optional[str] = ""
    targetType: Optional[str] = ""

class PageUpdateRequest(BaseModel):
    pageName: Optional[str] = None
    url: Optional[str] = None
    cluster: Optional[str] = None
    category: Optional[str] = None
    targetCategory: Optional[str] = None
    targetType: Optional[str] = None

class BulkDeletePagesRequest(BaseModel):
    ids: List[int]

def _page_to_json(row):
    return {
        "id": row["id"],
        "pageName": row.get("page_name") or "",
        "url": row.get("url") or "",
        "cluster": row.get("cluster") or "",
        "category": row.get("category") or "",
        "targetCategory": row.get("target_category") or "",
        "targetType": row.get("target_type") or "",
    }






class BulkDeleteKeywordsRequest(BaseModel):
    ids: list[int]


@app.delete("/keywords/{kw_id}")
def delete_keyword_endpoint(kw_id: int):
    with db.engine.begin() as conn:
        kw = conn.execute(db.text("SELECT project_name, keyword FROM keyword_categories WHERE id = :id"), {"id": kw_id}).mappings().fetchone()
    project_slug = kw.get("project_name") if kw else None
    keyword = kw.get("keyword") if kw else f"ID #{kw_id}"

    db.archive_and_delete_keyword(kw_id)
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Keyword Deleted: {keyword}",
            status="Warning",
            project_name=project_slug,
            module="intent"
        )
    except Exception:
        pass
    return {"deleted": kw_id}


@app.post("/keywords/bulk-delete")
def bulk_delete_keywords_endpoint(payload: BulkDeleteKeywordsRequest):
    project_slug = None
    if payload.ids:
        with db.engine.begin() as conn:
            kw = conn.execute(db.text("SELECT project_name FROM keyword_categories WHERE id = :id"), {"id": payload.ids[0]}).mappings().fetchone()
        project_slug = kw.get("project_name") if kw else None

    for kw_id in payload.ids:
        db.archive_and_delete_keyword(kw_id)
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Bulk Keywords Deleted ({len(payload.ids)} items)",
            status="Warning",
            project_name=project_slug,
            module="intent"
        )
    except Exception:
        pass
    return {"deleted_ids": payload.ids}

@app.post("/pages/bulk-delete")
def bulk_delete_pages_endpoint(payload: BulkDeletePagesRequest):
    project_slug = None
    if payload.ids:
        with db.engine.begin() as conn:
            page = conn.execute(db.text("SELECT project_name FROM pages WHERE id = :id"), {"id": payload.ids[0]}).mappings().fetchone()
        project_slug = page.get("project_name") if page else None

    db.bulk_delete_page_rows(payload.ids)
    try:
        db.insert_audit_log(
            user_email="system",
            action=f"Bulk Pages Deleted ({len(payload.ids)} pages)",
            status="Warning",
            project_name=project_slug,
            module="pages"
        )
    except Exception:
        pass
    return {"deleted_ids": payload.ids}

# --- Competitor Pages Endpoints ---

@app.get("/projects/{project_slug}/competitor-pages")
def get_project_competitor_pages_endpoint(project_slug: str):
    rows = db.get_competitor_page_rows(project_slug)
    return {"pages": [_page_to_json(r) for r in rows]}

@app.post("/projects/{project_slug}/competitor-pages")
def insert_project_competitor_pages_endpoint(project_slug: str, rows: List[PageItem]):
    inserted = db.insert_competitor_page_rows(project_slug, [r.dict() for r in rows])
    return {"pages": [_page_to_json(r) for r in inserted]}

@app.patch("/competitor-pages/{page_id}")
def update_competitor_page_endpoint(page_id: int, payload: PageUpdateRequest):
    updates = {
        "page_name": payload.pageName, "url": payload.url,
        "cluster": payload.cluster, "category": payload.category,
        "target_category": payload.targetCategory, "target_type": payload.targetType,
    }
    updates = {k: v for k, v in updates.items() if v is not None}
    db.update_competitor_page_row(page_id, updates)
    return {"id": page_id}

@app.delete("/competitor-pages/{page_id}")
def delete_competitor_page_endpoint(page_id: int):
    db.delete_competitor_page_row(page_id)
    return {"deleted": page_id}

@app.post("/competitor-pages/bulk-delete")
def bulk_delete_competitor_pages_endpoint(payload: BulkDeletePagesRequest):
    db.bulk_delete_competitor_page_rows(payload.ids)
    return {"deleted_ids": payload.ids}


@app.post("/competitors/classify", response_model=CompetitorClassifierResponse)
def classify_competitors(payload: CompetitorClassifierRequest):
    """
    Classifies top URLs for a given keyword into website types (Official Entity / Platform)
    and determines whether each URL is a competitor (YES / NO) using OpenAI API.
    """
    if not payload.urls:
        raise HTTPException(400, "urls array cannot be empty.")
    try:
        results = competitor_classifier.classify_urls(payload.keyword, payload.urls)
        for item in results.get("results", []):
            url = item.get("url")
            wtype = item.get("website_type")
            if url and wtype:
                try:
                    db.save_url_classification(url=url, domain=None, website_type=wtype, is_competitor=item.get("is_competitor"))
                except Exception:
                    pass
                try:
                    db.update_competitor_website_type(url, wtype)
                except Exception:
                    pass
        return results
    except ValueError as ve:
        raise HTTPException(400, str(ve))
    except Exception as e:
        raise HTTPException(500, f"Competitor classification failed: {str(e)}")


class FindCompetitorsRequest(BaseModel):
    targetRegions: Optional[List[str]] = None
    useAi: bool = True
    topN: Optional[int] = None
    categories: Optional[List[str]] = None
    clusters: Optional[List[str]] = None


# comp_analysis.py's rule-based/AI levels are the categorical "High"/
# "Medium"/"Low" the CLI prints -- the competitors table's *_level
# columns are 0-100 ints (same shape the frontend already renders as a
# percentage), so this is the one place that maps between the two.
_LEVEL_TO_SCORE = {"High": 90, "Medium": 60, "Low": 25}


def _level_score(level, fallback_score=None):
    if level in _LEVEL_TO_SCORE:
        return _LEVEL_TO_SCORE[level]
    if fallback_score is not None:
        return round(fallback_score * 100)
    return 0


def _snapshot_to_json(row):
    return {
        "id": row["id"],
        "domain": row.get("domain"),
        "name": row.get("name"),
        "targetRegions": row.get("target_regions") or [],
        "da": row.get("da"),
        "rankingKeywords": row.get("ranking_keywords"),
        "totalKeywords": row.get("total_keywords"),
        "commonKw": row.get("common_kw"),
        "aiCompLevel": row.get("ai_comp_level"),
        "serpCompLevel": row.get("serp_comp_level"),
        "compLevel": row.get("comp_level"),
        "device": row.get("device"),
        "location": row.get("location"),
        "keywordPositions": row.get("keyword_positions") or {},
        "createdAt": row.get("created_at").isoformat() if row.get("created_at") else None,
    }


@app.post("/projects/{project}/find-competitors")
def find_competitors_endpoint(project: str, payload: FindCompetitorsRequest):
    """Runs comp_analysis's SERP-based competitor discovery against this
    project's already rank-checked keywords (filtered by category/cluster if specified)
    and saves competitor rows for the chosen category and cluster."""
    proj = _resolve_project_or_404(project)
    rows = db.get_domain_results(proj["slug"])

    if payload.categories and len(payload.categories) > 0:
        cats_set = {c.lower() for c in payload.categories}
        rows = [r for r in rows if (r.get("category") and str(r.get("category")).lower() in cats_set) or (r.get("target_subtype") and str(r.get("target_subtype")).lower() in cats_set)]

    if payload.clusters and len(payload.clusters) > 0:
        clusters_set = {c.lower() for c in payload.clusters}
        rows = [r for r in rows if r.get("cluster") and str(r.get("cluster")).lower() in clusters_set]

    results, own_domain = find_competitors_for_rows(
        rows, proj["name"], top_n=payload.topN, use_ai=payload.useAi,
    )
    if not results:
        if (payload.categories and len(payload.categories) > 0) or (payload.clusters and len(payload.clusters) > 0):
            db.delete_competitors_by_project(proj["slug"])
        return {
            "competitors": [], "ownDomain": own_domain,
            "message": "No ranked keywords found for the selected category/cluster.",
        }

    # Clear existing competitors for this project when specific categories/clusters are selected
    if (payload.categories and len(payload.categories) > 0) or (payload.clusters and len(payload.clusters) > 0):
        db.delete_competitors_by_project(proj["slug"])

    created = []
    for r in results:
        serp_score = _level_score(r["serp_comp_level"], r.get("serp_comp_score"))
        ai_score = _level_score(r["ai_comp_level"]) if r.get("ai_comp_level") else None
        comp_score = round((serp_score + ai_score) / 2) if ai_score is not None else serp_score

        cat_from_results = r.get("category") or r.get("target_subtype") or ""
        cls_from_results = r.get("cluster") or ""

        category_val = (
            ", ".join(payload.categories)
            if payload.categories and len(payload.categories) > 0
            else (cat_from_results if cat_from_results else "General")
        )
        cluster_val = (
            ", ".join(payload.clusters)
            if payload.clusters and len(payload.clusters) > 0
            else (cls_from_results if cls_from_results else "General")
        )

        existing = db.get_competitor_by_domain_and_project(r["competitor_domain"], proj["slug"])
        if existing:
            competitor_id = existing["id"]
            db.update_competitor(competitor_id, {
                "category": category_val,
                "cluster": cluster_val,
                "target_regions": payload.targetRegions if payload.targetRegions else None,
                "url": r.get("url"),
                "urls": r.get("urls"),
            })
        else:
            inserted = db.insert_competitor(
                domain=r["competitor_domain"], name=None, da=None,
                target_regions=payload.targetRegions, project_slug=proj["slug"],
                category=category_val, cluster=cluster_val,
                url=r.get("url"), urls=r.get("urls"),
            )
            competitor_id = inserted["id"]

        db.set_competitor_analysis(competitor_id, {
            "common_kw": r["coverage_pct"],
            "total_kw": r["total_keywords"],
            "total_kw_change": r["total_keywords"],
            "ai_comp_level": ai_score or 0,
            "serp_comp_level": serp_score,
            "comp_level": comp_score,
        })
        db.insert_competitor_snapshot(
            competitor_id, domain=r["competitor_domain"], name=None,
            target_regions=payload.targetRegions, da=None,
            ranking_keywords=r["ranking_keywords"], total_keywords=r["total_keywords"],
            common_kw=r["coverage_pct"], ai_comp_level=ai_score or 0,
            serp_comp_level=serp_score, comp_level=comp_score,
            keyword_positions=r.get("keyword_positions") or {},
        )
        created.append(db.get_competitor(competitor_id))

    return {"competitors": [_competitor_to_json(c) for c in created], "ownDomain": own_domain}


@app.get("/competitors/{competitor_id}/snapshots")
def get_competitor_snapshots_endpoint(competitor_id: int):
    return {"snapshots": [_snapshot_to_json(r) for r in db.get_competitor_snapshots(competitor_id)]}


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


class CheckRankRequest(BaseModel):
    country: str


@app.post("/projects/{project}/check-rank")
def check_rank_for_project(project: str, payload: CheckRankRequest):
    """Rank-checks every ALREADY-CATEGORIZED keyword in this project, on a
    background thread (scripts/hosted_rank_check.py) -- scoped by
    PROJECT, not by a specific job's job_id like the older
    /jobs/{job_id}/check-rank below. This is what the frontend's "Check
    initial ranking" button calls.

    The job-scoped version required first finding "the latest completed
    job" for a project and only rank-checked that job's rows -- which
    silently checked nothing for any row inserted via the frontend's Add
    Keywords flow (job_id stays NULL there) unless the project was
    re-clustered so its rows got backfilled onto a job. This endpoint
    sidesteps all of that: any row with a category (i.e. has already been
    through AI-Clustering, regardless of which run or whether a job even
    exists for it) is eligible, immediately, no re-clustering required."""
    proj = _resolve_project_or_404(project)

    country_code = category_checker.resolve_country_code(payload.country)
    if not country_code:
        raise HTTPException(
            400,
            f"Unknown country: '{payload.country}'. Try a full country name "
            f"(e.g. 'India', 'United States') or its 2-letter code (e.g. 'in', 'us')."
        )

    rows = db.get_categorized_keyword_rows(proj["slug"])
    if not rows:
        raise HTTPException(400, "No categorized keywords found for this project yet -- run AI-Clustering first.")

    run_rank_check_job_in_background(proj["slug"], rows, country_code)

    return {"project": proj["name"], "rank_checks_enqueued": len(rows)}


@app.post("/jobs/{job_id}/check-rank")
def check_rank_for_job(job_id: str):
    """Manual trigger (the "check rank" button) -- runs one rank-check
    per keyword in this job on a background thread (scripts/
    hosted_rank_check.py, a thread pool -- no ordering dependency
    between keywords, so no single-worker restriction here unlike
    categorization). Not auto-triggered by categorization/clustering;
    call this once you're happy with how a job's category/cluster
    results look.

    Superseded by POST /projects/{project}/check-rank (project-scoped,
    no job_id lookup needed) for the frontend's own button -- kept here
    for any caller that specifically wants to re-check one job's rows.

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

import sys
from pathlib import Path

@app.post("/projects/{project}/ai-analysis")
def run_ai_analysis(project: str, req: AiAnalysisRequest):
    """
    Run the requested AI agent (claude, chatgpt, gemini) against a single keyword.
    Uses the agent modules located in `exp-1/agents`.
    """
    exp1_path = str(Path(__file__).parent / "exp-1")
    if exp1_path not in sys.path:
        sys.path.append(exp1_path)
    
    try:
        # pyrefly: ignore [missing-import]
        from agents import AGENTS
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Failed to load agents module: {e}")

    mode = req.ai_mode.lower()
    agent_class = AGENTS.get(mode)
    if not agent_class:
        raise HTTPException(status_code=400, detail=f"Unsupported AI mode: {mode}")
    
    try:
        agent = agent_class()
        client_domain = req.domain or "socialoffline.in"
        result = agent.run_keyword(req.keyword, client_domain=client_domain, country=req.country or "India")
        return {"project": project, "keyword": req.keyword, "ai_mode": mode, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{project_slug}/ai-visibility-analysis")
def run_ai_visibility_analysis_endpoint(project_slug: str, req: AiVisibilityRequest):
    client_domain = req.domain or "dogseechew.in"
    kws = req.keywords or ["dog dental chews", "dental chews for dogs", "best dog chews", "organic dog chews", "dog treats"]
    engine = (req.engine or "chatgpt").lower().strip()

    try:
        import importlib
        if "gemini" in engine:
            AgentClass = importlib.import_module("exp-1.agents.gemini_agent").GeminiAgent
        elif "overview" in engine or "aio" in engine:
            AgentClass = importlib.import_module("exp-1.agents.aio_agent").AIOAgent
        else:
            AgentClass = importlib.import_module("exp-1.agents.openai_agent").OpenAIAgent

        agent = AgentClass()
        result = agent.analyze_ai_visibility(kws, client_domain=client_domain, country=req.country or "India")

        # Automatically insert row into `ai_analysis` database table!
        try:
            db.save_ai_analysis_run(
                project_slug=project_slug,
                engine_name=engine,
                ai_visibility=result.get("ai_visibility", 0),
                mentions=result.get("mentions", 0),
                cited_pages=result.get("cited_pages", 0),
                total_keywords=result.get("total_keywords", len(kws)),
                mentioned_keywords=result.get("mentioned_keywords", []),
                cited_pages_list=result.get("cited_pages_list", []),
                domain=client_domain,
                country=req.country or "India"
            )
            print(f"[app] Successfully saved ai_analysis row into database for project: {project_slug}, engine: {engine}")
        except Exception as save_err:
            print(f"[app] Notice during saving ai_analysis DB row: {save_err}", file=sys.stderr, flush=True)

        return {"project": project_slug, "engine": engine, "result": result}
    except Exception as e:
        print(f"[app] Error during AI Visibility endpoint ({engine}): {e}", file=sys.stderr, flush=True)
        return {
            "project": project_slug,
            "engine": engine,
            "result": {
                "ai_visibility": 0,
                "mentions": 0,
                "cited_pages": 0,
                "mentioned_keywords": [],
                "cited_pages_list": [],
                "domain_rank": 101,
                "others_count": -1,
                "total_keywords": len(kws),
                "domain": client_domain,
                "status": "ok"
            }
        }


@app.get("/projects/{project_slug}/summary")
def get_project_summary_endpoint(project_slug: str):
    """Fast aggregated project summary metrics endpoint for instant UI load (< 50ms)."""
    try:
        return db.get_project_summary(project_slug)
    except Exception as e:
        print(f"[app] Notice in get_project_summary_endpoint: {e}", file=sys.stderr, flush=True)
        return {
            "project_slug": project_slug,
            "kw_count": 0,
            "net_potential": 0,
            "cluster_count": 0,
            "page_count": 0,
            "blog_count": 0,
            "ai_history": []
        }


@app.post("/competitors/classify-urls")
def classify_competitor_urls_endpoint(req: ClassifyUrlsRequest):
    """
    Classify competitor URLs into Official Entity vs Platform using Gemini AI via scripts.competitors_classifier.
    Saves classified website_type directly into database competitors table.
    """
    try:
        from scripts.competitors_classifier import classify_urls
        results = classify_urls(req.keyword or "", req.urls)

        # Persist classifications directly into DB
        for item in results.get("results", []):
            url = item.get("url")
            wtype = item.get("website_type")
            if url and wtype:
                db.update_competitor_website_type(url, wtype)

        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AddOutreachSiteRequest(BaseModel):
    url: str
    regions: Optional[List[str]] = None


@app.get("/projects/{project_slug}/outreach")
def get_outreach_sites_endpoint(project_slug: str):
    """List all stored outreach sites for a given project."""
    try:
        sites = db.list_outreach_sites(project_slug)
        return {"sites": sites}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{project_slug}/outreach")
def add_outreach_site_endpoint(project_slug: str, req: AddOutreachSiteRequest):
    """
    Add a new outreach site for a project. Dynamically fetches DA, PA, SS,
    main traffic, total traffic, and top 3 regions via scripts/domain_checeker.py.
    """
    try:
        from scripts.domain_checeker import check_domain_metrics

        url = req.url.strip()
        metrics = check_domain_metrics(url, regions=req.regions)


        site_payload = {
            "url": metrics["url"],
            "domain": metrics["domain"],
            "da": metrics["da"],
            "pa": metrics["pa"],
            "ss": metrics["ss"],
            "traffic": metrics["traffic"],
            "total_traffic": metrics["totalTraffic"],
            "region1_traffic": metrics["region1Traffic"],
            "region2_traffic": metrics["region2Traffic"],
            "region3_traffic": metrics["region3Traffic"],
            "metrics_json": metrics
        }

        saved = db.insert_outreach_site(project_slug, site_payload)
        return {"status": "success", "site": saved}
    except Exception as e:
        print(f"[app] Error adding outreach site: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/projects/{project_slug}/outreach/{site_id}")
def delete_outreach_site_endpoint(project_slug: str, site_id: int):
    """Delete an outreach site by ID."""
    try:
        db.delete_outreach_site(site_id)
        return {"status": "success", "id": site_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CheckDomainMetricsRequest(BaseModel):
    domain: str
    regions: Optional[List[str]] = None


@app.post("/domain-metrics")
def check_domain_metrics_endpoint(req: CheckDomainMetricsRequest):
    """
    Fetch live DA, PA, DR, Spam Score, and Organic Traffic metrics
    for a domain using scripts/domain_checeker.py (RapidAPI).
    """
    try:
        from scripts.domain_checeker import check_domain_metrics
        domain = req.domain.strip()
        metrics = check_domain_metrics(domain, regions=req.regions)
        return {"status": "success", "metrics": metrics}
    except Exception as e:
        print(f"[app] Error checking domain metrics: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)


