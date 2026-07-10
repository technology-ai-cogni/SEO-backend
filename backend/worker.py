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

WHY SimpleWorker, NOT the default (forking) Worker: RQ's default Worker
forks a new "work-horse" process for every single job. On macOS, forking a
process that's already multi-threaded (which it is here -- RQ itself
subscribes to a Redis pubsub channel on a background thread, and importing
`openai` pulls in httpx/anyio, which can also spin up threads at import
time) is a well-known native-crash hazard: Apple's frameworks (Security /
Secure Transport in particular, used for every outbound HTTPS call) are not
safe to touch in a child process forked from a multi-threaded parent. In
practice this showed up as `categorize_keyword_task` and
`check_rank_task` work-horses segfaulting (EXC_BAD_ACCESS / signal 11) on
nearly every job, every time they made a Bright Data or OpenAI HTTPS call.
Caching-related fixes (e.g. not reusing a persistent OpenAI client/
requests.Session across calls) reduced the frequency but never eliminated
it, because the hazard is baked in by forking a multi-threaded parent at
all -- not by which object happens to open the TLS connection afterward.
SimpleWorker runs each job in the SAME process, no fork() involved, which
sidesteps this class of bug entirely. The tradeoff: a job that hangs
forever or crashes the process takes the whole worker down with it, rather
than just that one work-horse. That's an acceptable trade here because
concurrency in this project already comes from running MULTIPLE SEPARATE
worker processes (see the deployment note above), not from one worker
forking many simultaneous children -- so SimpleWorker doesn't cost us any
of the concurrency we actually rely on.
"""

import sys

from rq import SimpleWorker

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
    print(f"Starting worker on queue '{queue_name}' (SimpleWorker, no fork -- see module docstring)...")
    worker = SimpleWorker([queue], connection=redis_conn)
    worker.work()


if __name__ == "__main__":
    main()