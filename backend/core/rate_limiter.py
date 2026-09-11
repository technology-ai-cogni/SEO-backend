"""
Global Rate Limiting and External Provider Token Bucket
======================================================
Provides:
1. Distributed sliding-window API rate limiting middleware (Redis-backed with in-memory fallback).
2. Global concurrency semaphores and rate limiters for external third-party APIs
   (OpenAI, Gemini, Bright Data, Firecrawl) to prevent 429 quota exhaustion under 1,000+ users.
"""

import time
import asyncio
import logging
from typing import Dict, Tuple, Optional
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Local in-memory sliding window fallback (ip -> list of timestamps)
_LOCAL_RATE_LIMIT_STORE: Dict[str, list] = {}
_LOCAL_STORE_LOCK = asyncio.Lock()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    FastAPI / Starlette middleware applying distributed sliding-window rate limiting.
    Prevents API denial of service, traffic bursts, and resource exhaustion.
    """

    def __init__(self, app):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        # 1. Skip static health check / options preflight
        if request.method == "OPTIONS" or request.url.path in ("/", "/health", "/docs", "/openapi.json"):
            return await call_next(request)

        # 2. Determine client identifier (User Email from Header/Bearer token or Client IP)
        client_ip = request.client.host if request.client else "127.0.0.1"
        auth_header = request.headers.get("authorization", "")
        client_key = client_ip
        if auth_header and len(auth_header) > 20:
            import hashlib
            client_key = f"auth_{hashlib.md5(auth_header.encode()).hexdigest()[:12]}"

        path = request.url.path.lower()

        # 3. Determine tier limits (limit, window_seconds)
        if any(p in path for p in ("/auth/login", "/auth/register", "/auth/token")):
            limit, window = 20, 60       # 20 req/min for auth
        elif any(p in path for p in ("/competitors/classify", "/category-rag", "/status-check")):
            limit, window = 45, 60       # 45 heavy AI requests/min per client
        else:
            limit, window = 200, 60      # 200 req/min for standard queries

        # 4. Check rate limit
        allowed, remaining, retry_after = await check_rate_limit(
            key=f"ratelimit:{client_key}:{path.split('/')[1] if len(path.split('/')) > 1 else 'root'}",
            limit=limit,
            window_seconds=window
        )

        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too Many Requests. Rate limit exceeded. Please retry shortly.",
                    "retry_after_seconds": retry_after
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0"
                }
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


async def check_rate_limit(key: str, limit: int, window_seconds: int = 60) -> Tuple[bool, int, int]:
    """
    Sliding window rate limit checker.
    Returns: (is_allowed: bool, remaining: int, retry_after_seconds: int)
    """
    now = time.time()
    cutoff = now - window_seconds

    # Try Redis sliding window with sorted sets (ZADD / ZREMRANGEBYSCORE / ZCARD)
    try:
        from core.cache import get_redis_client
        redis_client = get_redis_client()
        if redis_client:
            pipe = redis_client.pipeline()
            pipe.zremrangebyscore(key, 0, cutoff)
            pipe.zadd(key, {str(now): now})
            pipe.zcard(key)
            pipe.expire(key, window_seconds + 5)
            results = pipe.execute()

            current_count = results[2]
            if current_count > limit:
                return False, 0, max(1, int(window_seconds - (now - cutoff) // 2))
            return True, max(0, limit - current_count), 0
    except Exception as e:
        logger.debug(f"[RateLimiter] Redis check failed ({e}); falling back to local memory.")

    # In-memory sliding window fallback
    async with _LOCAL_STORE_LOCK:
        timestamps = _LOCAL_RATE_LIMIT_STORE.get(key, [])
        # prune old timestamps
        timestamps = [ts for ts in timestamps if ts > cutoff]
        if len(timestamps) >= limit:
            oldest = timestamps[0] if timestamps else cutoff
            retry_after = max(1, int(window_seconds - (now - oldest)))
            _LOCAL_RATE_LIMIT_STORE[key] = timestamps
            return False, 0, retry_after

        timestamps.append(now)
        _LOCAL_RATE_LIMIT_STORE[key] = timestamps
        # Periodic memory cleanup if store gets too large
        if len(_LOCAL_RATE_LIMIT_STORE) > 5000:
            for k in list(_LOCAL_RATE_LIMIT_STORE.keys())[:1000]:
                if not _LOCAL_RATE_LIMIT_STORE[k] or _LOCAL_RATE_LIMIT_STORE[k][-1] < cutoff:
                    _LOCAL_RATE_LIMIT_STORE.pop(k, None)

        return True, max(0, limit - len(timestamps)), 0


# ─── External Provider Concurrency & Rate Limiter ────────────────────────────

class ExternalApiLimiter:
    """
    Protects third-party APIs (OpenAI, Gemini, Bright Data, Firecrawl) from
    rate limits (429) and network saturation by enforcing concurrent request limits.
    """

    def __init__(self):
        self._semaphores = {
            "openai": asyncio.Semaphore(25),      # Max 25 concurrent OpenAI calls
            "gemini": asyncio.Semaphore(20),      # Max 20 concurrent Gemini calls
            "brightdata": asyncio.Semaphore(15),  # Max 15 concurrent Bright Data SERP requests
            "firecrawl": asyncio.Semaphore(12),   # Max 12 concurrent Firecrawl requests
        }

    async def acquire(self, provider: str):
        """Acquires a concurrency slot for the external provider."""
        sem = self._semaphores.get(provider.lower())
        if sem:
            await sem.acquire()

    def release(self, provider: str):
        """Releases the concurrency slot for the external provider."""
        sem = self._semaphores.get(provider.lower())
        if sem:
            sem.release()

    def limit(self, provider: str):
        """Context manager for automated acquire & release."""
        return _LimiterContext(self, provider.lower())


class _LimiterContext:
    def __init__(self, limiter: ExternalApiLimiter, provider: str):
        self.limiter = limiter
        self.provider = provider

    async def __aenter__(self):
        await self.limiter.acquire(self.provider)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        self.limiter.release(self.provider)


# Global singleton instance
external_api_limiter = ExternalApiLimiter()
