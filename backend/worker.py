"""
worker.py

Standalone RQ worker entrypoint, meant for Render's "Background Worker"
service type (or any platform where you just need a long-running
process, no shell needed to babysit it).

Run as:
    python3 worker.py category_checks
    python3 worker.py rank_checks

Why this instead of the `rq worker <queue>` CLI directly: the CLI does
NOT read job_queue.py's dotenv-loaded config on its own -- it defaults to
redis://localhost:6379 unless you pass --url explicitly (this bit us
locally in start_workers.sh). This script sidesteps that entirely by
importing the SAME redis_conn / queue objects job_queue.py already builds
from your environment -- so as long as REDIS_URL is set in Render's
environment variables for this service (same as your web service), there
is no separate URL-plumbing to get wrong on a new platform.

DEPLOYMENT NOTE (Render): create TWO separate "Background Worker"
services from this same repo, both running this same script with a
different argument:
    Service 1 -- Start Command: python3 worker.py category_checks
                 Instance count: 1 (MUST stay 1 -- category assignment
                 is sequential, see category_checker.py's module
                 docstring for why).
    Service 2 -- Start Command: python3 worker.py rank_checks
                 Instance count: 1+ (safe to run several -- see
                 rank_checker.py's module docstring for why rank-checking
                 has no ordering dependency between keywords).
Both services need the SAME environment variables as your web service
(REDIS_URL, DATABASE_URL, BRIGHTDATA_API_KEY, OPENAI_API_KEY, etc.).
"""

import sys

from rq import Worker

from core.job_queue import redis_conn, category_queue, rank_queue

QUEUES_BY_NAME = {
    "category_checks": category_queue,
    "rank_checks": rank_queue,
}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in QUEUES_BY_NAME:
        valid = ", ".join(QUEUES_BY_NAME)
        print(f"Usage: python3 worker.py <queue_name>  (valid: {valid})")
        sys.exit(1)

    queue_name = sys.argv[1]
    queue = QUEUES_BY_NAME[queue_name]
    print(f"Starting worker on queue '{queue_name}'...")
    worker = Worker([queue], connection=redis_conn)
    worker.work()


if __name__ == "__main__":
    main()