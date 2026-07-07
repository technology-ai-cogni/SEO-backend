"""
RQ tasks for the category queue ('category_checks').

Two task types on the same queue:
    categorize_keyword_task  -- runs per keyword (category only, no
                                 clustering inline anymore)
    cluster_domain_task      -- runs ONCE per job, auto-triggered by the
                                 last categorize_keyword_task in that job
                                 once every keyword is done. Re-clusters
                                 the domain's ENTIRE category list.

IMPORTANT: run only ONE category worker process at a time. Category
assignment is inherently sequential within a domain, and clustering must
run strictly after all of a job's categorization is complete.

ROW LIFECYCLE: as of the pass-through-columns change, the row for each
keyword is now PRE-INSERTED at upload time (see app.py / db.insert_
keyword_rows), already containing whatever sheet data (SV, KW Diff, Type,
Target Subtype, Target Geo, Priority, Landing Page URL) came with that
keyword. categorize_keyword_task's job is ONLY to fill in that SAME row's
category/cluster/status/meta/error via db.update_keyword_result() -- it
never touches, generates, or overwrites the pass-through columns.

`row_id` is passed in by the enqueueing code (app.py) so the task knows
exactly which pre-inserted row to update. If a task somehow gets enqueued
without a row_id (e.g. one already sitting in the queue from before this
change, mid-deploy), it falls back to inserting a brand-new row via the
legacy db.insert_category_result() path instead of crashing.
"""

import db
import category_checker
from job_queue import category_queue


def categorize_keyword_task(job_id, domain, keyword, country_code=None, row_id=None):
    try:
        category, meta = category_checker.categorize_keyword(keyword, domain, country_code)
        status = "no_data" if category is None else "processed"
    except Exception as e:
        category, meta, status = None, None, "error"
        error_message = str(e)
    else:
        error_message = None

    try:
        if row_id is not None:
            db.update_keyword_result(domain, row_id, category, None, status, meta=meta, error=error_message)
        else:
            # Legacy fallback -- see module docstring.
            db.insert_category_result(job_id, domain, keyword, category, None, status, meta=meta, error=error_message)
    finally:
        db.increment_job_progress(job_id)

        job = db.get_job(job_id)
        if job and job["status"] == "completed":
            if db.try_mark_clustering_triggered(job_id):
                category_queue.enqueue(
                    cluster_domain_task, job_id, domain, job_timeout=300
                )


def cluster_domain_task(job_id, domain):
    """Runs once, after a job's categorization fully completes. Re-clusters
    the WHOLE domain's category list (not just this job's) and writes the
    result back into clusters / category_cluster_map / keyword_categories
    (cluster column only -- never touches the pass-through columns)."""
    try:
        assignment = category_checker.cluster_all_categories(domain)
        db.replace_domain_clusters(domain, assignment)
    except Exception as e:
        print(f"[cluster_domain_task] error clustering domain '{domain}' "
              f"(job {job_id}): {e}")
