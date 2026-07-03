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
"""

import db
import category_checker
from job_queue import category_queue


def categorize_keyword_task(job_id, domain, keyword):
    try:
        category = category_checker.categorize_keyword(keyword, domain)
        if category is None:
            db.insert_category_result(job_id, domain, keyword, None, None, "no_data")
        else:
            db.insert_category_result(job_id, domain, keyword, category, None, "processed")
    except Exception as e:
        db.insert_category_result(job_id, domain, keyword, None, None, "error", error=str(e))
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
    result back into clusters / category_cluster_map / keyword_categories."""
    try:
        assignment = category_checker.cluster_all_categories(domain)
        db.replace_domain_clusters(domain, assignment)
    except Exception as e:
        print(f"[cluster_domain_task] error clustering domain '{domain}' "
              f"(job {job_id}): {e}")
