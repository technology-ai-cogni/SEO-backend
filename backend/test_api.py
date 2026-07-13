"""
test_api.py

Standalone FastAPI app for manually testing the full 4-stage pipeline
(scripts/run_pipeline.py: SERP scrape -> category + landing/blog ->
info/comm -> cluster) by uploading a sheet through the browser, instead
of running the CLI script by hand.

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

import os
import threading
import uuid

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

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


def _run_in_background(run_id, input_path, project_display_name):
    try:
        output_path = run_pipeline(input_path, project_display_name)
        RUNS[run_id]["output_path"] = output_path
        RUNS[run_id]["status"] = "done"
    except Exception as e:
        RUNS[run_id]["status"] = "error"
        RUNS[run_id]["error"] = str(e)


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
