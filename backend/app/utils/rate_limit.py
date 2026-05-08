"""
Simple in-memory sliding-window rate limiter.

One singleton is shared across all requests within a single Cloud Run
instance. Each instance maintains its own window, which is acceptable
for a small internal app.
"""

import time
import threading
from collections import defaultdict
from fastapi import HTTPException


class RateLimiter:
    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key: str, max_calls: int, window_seconds: float) -> bool:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            calls = self._windows[key]
            self._windows[key] = [t for t in calls if t > cutoff]
            if len(self._windows[key]) >= max_calls:
                return False
            self._windows[key].append(now)
            return True


_limiter = RateLimiter()


def guard(key: str, max_calls: int, window_seconds: float) -> None:
    """Raise HTTP 429 if the caller has exceeded the rate limit for `key`."""
    if not _limiter.is_allowed(key, max_calls, window_seconds):
        raise HTTPException(
            status_code=429,
            detail="Too many requests — please wait a moment before trying again.",
        )
