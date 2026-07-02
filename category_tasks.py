"""
RQ task for the category queue ('category_checks').

IMPORTANT: run only ONE category worker process at a time. Category
assignment is inherently sequential -- each decision depends on categories
already created by prior keywords -- so concurrent workers could create
duplicate/inconsistent categories despite the DB-level unique constraint
softening the worst case.
"""

import db
import category_checker


def categorize_keyword_task(job_id, keyword):
    try:
        category = category_checker.categorize_keyword(keyword)
        if category is None:
            db.insert_category_result(job_id, keyword, None, "no_data")
        else:
            db.insert_category_result(job_id, keyword, category, "processed")
    except Exception as e:
        db.insert_category_result(job_id, keyword, None, "error", error=str(e))
    finally:
        db.increment_job_progress(job_id)
