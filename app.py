"""
Backend API -- category checking only.

Job/result state lives in Postgres (db.py). Actual categorization happens
in a separate worker process via RQ (job_queue.py, category_tasks.py) --
this process only enqueues work and reads state.

Auth is intentionally NOT wired in here yet -- every endpoint is open.
Lock this down before deploying publicly.

Endpoints:
    POST /jobs/category     upload -> category job, one task per keyword
    GET  /jobs                list all jobs
    GET  /jobs/{job_id}        poll job status/progress
    GET  /jobs/{job_id}/results        per-keyword category results
    GET  /jobs/{job_id}/download       same results, as a CSV download
    GET  /health

Run locally (needs a worker running separately too -- see README.md):
    python db.py              # one-time: creates/updates tables
    uvicorn app:app --reload --port 8000
    rq worker category_checks     # in a separate terminal -- run ONLY ONE
"""

from dotenv import load_dotenv
load_dotenv()  # must happen before importing db / job_queue

import io
import csv

import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import db
from job_queue import category_queue
from category_tasks import categorize_keyword_task

MIN_SEARCH_VOLUME = 19
NEAR_ME_PHRASE = "near me"

app = FastAPI(title="Category API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock this down to your actual frontend domain before going live
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    {"keyword", "skip_reason"} dicts -- skip_reason is None for rows that
    should actually be processed."""
    df.columns = [str(c).strip() for c in df.columns]

    keyword_col = _find_column(df.columns, ["keywords", "keyword"])
    if keyword_col is None:
        raise HTTPException(400, f"No 'Keywords' column found. Columns present: {list(df.columns)}")

    sv_col = _find_column(df.columns, ["search volume", "sv", "volume", "search_volume"])

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

        rows.append({"keyword": keyword, "skip_reason": skip_reason})

    return rows


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/jobs/category")
async def create_category_job(file: UploadFile = File(...)):
    """Upload a .csv/.xlsx with a 'Keywords' column (optionally 'Search
    Volume'). Creates a category job and enqueues one task per keyword
    that passes the SV/'near me' filters."""
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

    job_id = db.create_job(filename, total=len(to_process))
    db.set_job_status(job_id, "running")

    for r in to_process:
        category_queue.enqueue(
            categorize_keyword_task,
            job_id, r["keyword"],
            job_timeout=180,
        )

    return {
        "job_id": job_id, "status": "running",
        "total": len(to_process), "skipped": len(rows) - len(to_process),
    }


@app.get("/jobs")
def list_jobs():
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
    return {"job_id": job_id, "status": job["status"], "results": results}


@app.get("/jobs/{job_id}/download")
def download_job(job_id: str):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")

    results = db.get_job_category_results(job_id)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Keyword", "Category", "Cluster", "Status", "Error", "Checked At"])
    for r in results:
        writer.writerow([r["keyword"], r["category"] or "", r["cluster"] or "", r["status"] or "", r["error"] or "", r["checked_at"]])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="category_results_{job_id}.csv"'},
    )
