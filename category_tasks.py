"""
RQ task for the category queue ('category_checks').

IMPORTANT: run only ONE category worker process at a time. Category AND
cluster assignment are both inherently sequential -- each decision depends
on categories/clusters already created by prior keywords -- so concurrent
workers could create duplicate/inconsistent groupings despite the DB-level
unique constraints softening the worst case.
"""

import db
import category_checker


def categorize_keyword_task(job_id, keyword):
    try:
        category, cluster = category_checker.categorize_keyword(keyword)
        if category is None:
            db.insert_category_result(job_id, keyword, None, None, "no_data")
        else:
            db.insert_category_result(job_id, keyword, category, cluster, "processed")
    except Exception as e:
        db.insert_category_result(job_id, keyword, None, None, "error", error=str(e))
    finally:
        db.increment_job_progress(job_id)
