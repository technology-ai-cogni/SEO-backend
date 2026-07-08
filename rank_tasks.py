"""
RQ task for the 'rank_checks' queue.

check_rank_task runs ONCE PER KEYWORD, enqueued by category_tasks.py's
cluster_domain_task right after clustering finishes for a job (i.e. once
category AND cluster are both settled for every keyword in that job).

CONCURRENCY: unlike categorize_keyword_task (which must run on a single
worker -- category assignment is sequential, each decision depends on
categories already created by prior keywords), check_rank_task has NO
ordering dependency between keywords. You can safely run MULTIPLE
`rq worker rank_checks` processes concurrently -- see rank_checker.py's
module docstring for why this is safe (no shared mutable state beyond a
thread-local HTTP session used purely for connection pooling).
"""

import db
import rank_checker


def check_rank_task(job_id, project_slug, row_id, keyword, landing_page_url, country_code=None):
    try:
        domain_record = db.get_domain_by_project_slug(project_slug)
        default_domain = (domain_record or {}).get("domain") or rank_checker.DEFAULT_DOMAIN

        rank, matched_links = rank_checker.find_rank(
            keyword, landing_page_url, default_domain=default_domain, country_code=country_code,
        )

        rank_meta = {
            "checked_domain": default_domain,
            "used_landing_page": bool((landing_page_url or "").strip()),
            "top_links": matched_links,
        }
        db.update_keyword_rank(row_id, rank, rank_meta=rank_meta)
    except Exception as e:
        db.update_keyword_rank(row_id, None, rank_meta={"error": str(e)})
