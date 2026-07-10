"""
Redis connection + RQ queues, backed by Upstash (or any Redis instance).

Two queues:
    category_checks  -- category assignment + clustering. Sequential --
                         run only ONE worker on this queue at a time (see
                         start_workers.sh / category_tasks.py for why).
    rank_checks       -- rank checking against Bright Data's Web
                         Unlocker zone, manually triggered per job via
                         POST /jobs/{job_id}/check-rank (app.py). NOT
                         sequential -- checking one keyword's rank has no
                         bearing on any other keyword's rank, so this
                         queue is safe to run with MULTIPLE concurrent
                         workers (see rank_checker.py's module docstring
                         for the full reasoning).

Setup:
    1. Create a free Redis database at https://upstash.com
    2. Copy the connection URL (looks like redis://default:xxx@host:port
       or rediss://... for TLS)
    3. Put it in your .env as REDIS_URL (see .env.example)
"""

import os

from dotenv import load_dotenv
from redis import Redis
from rq import Queue

load_dotenv()

REDIS_URL = os.environ.get("REDIS_URL")
if not REDIS_URL:
    raise RuntimeError(
        "REDIS_URL is not set. Copy .env.example to .env and fill in your "
        "Upstash connection string."
    )

# Upstash (and most managed Redis) silently closes connections that sit
# idle for a while. Without `health_check_interval`, redis-py doesn't
# notice until it tries to USE the dead connection -- which surfaced as a
# BrokenPipeError crashing the whole POST /jobs/category request (after
# keyword rows were already inserted, but before any tasks got enqueued)
# on a backend process that had been sitting idle. `health_check_interval`
# PROACTIVELY pings and transparently reconnects a connection that's been
# idle too long, BEFORE the real command is sent on it.
#
# Deliberately NOT using redis-py's `retry_on_error` / `retry` here, even
# though that looks like the obvious complementary fix: this connection is
# shared with RQ's worker, which uses a BLOCKING pop (BRPOP) to dequeue
# jobs. Retrying a blocking pop after a timeout is unsafe -- if the
# command actually succeeded server-side but the response was what got
# lost (not the command), a transparent retry pops the NEXT item and the
# first one is gone with no error, no log, nothing. That silently dropped
# a keyword mid-job during testing (task enqueued, never processed, not in
# any queue/failed/started registry afterward). health_check_interval
# avoids the dead-connection scenario proactively instead, without ever
# blindly re-issuing a command that might have already taken effect.
redis_conn = Redis.from_url(
    REDIS_URL,
    health_check_interval=30,
    socket_keepalive=True,
)
category_queue = Queue("category_checks", connection=redis_conn)
rank_queue = Queue("rank_checks", connection=redis_conn)
