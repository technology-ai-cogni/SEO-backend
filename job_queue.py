"""
Redis connection + RQ queue, backed by Upstash (or any Redis instance).

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
