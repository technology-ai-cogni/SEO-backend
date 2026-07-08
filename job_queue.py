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

redis_conn = Redis.from_url(REDIS_URL)
category_queue = Queue("category_checks", connection=redis_conn)
rank_queue = Queue("rank_checks", connection=redis_conn)
