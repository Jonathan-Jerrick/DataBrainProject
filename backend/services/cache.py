"""Tiny in-memory query cache.

Keyed by an MD5 hash of the canonicalized query spec. Each entry remembers
which datasource it came from so we can invalidate everything tied to a
dataset that just got deleted.
"""
import hashlib
import json
import time
from typing import Any, Dict, Optional


class QueryCache:
    def __init__(self, ttl_seconds: int = 300):
        self._cache: Dict[str, dict] = {}
        self.ttl = ttl_seconds

    def _key(self, spec: dict) -> str:
        return hashlib.md5(json.dumps(spec, sort_keys=True, default=str).encode()).hexdigest()

    def get(self, spec: dict) -> Optional[Any]:
        entry = self._cache.get(self._key(spec))
        if not entry:
            return None
        if time.time() - entry["timestamp"] >= self.ttl:
            del self._cache[self._key(spec)]
            return None
        return entry["data"]

    def set(self, spec: dict, data: Any, datasource_id: Optional[str] = None) -> None:
        self._cache[self._key(spec)] = {
            "data": data,
            "timestamp": time.time(),
            "datasource_id": datasource_id or spec.get("datasource_id"),
        }

    def invalidate_datasource(self, datasource_id: str) -> None:
        for k in [k for k, v in self._cache.items() if v.get("datasource_id") == datasource_id]:
            del self._cache[k]


query_cache = QueryCache()
