import hashlib
import json
import time
from typing import Dict, Optional, Any


class QueryCache:
    def __init__(self, ttl_seconds: int = 300):
        self._cache: Dict[str, dict] = {}
        self.ttl = ttl_seconds

    def _make_key(self, query_spec_dict: dict) -> str:
        serialized = json.dumps(query_spec_dict, sort_keys=True, default=str)
        return hashlib.md5(serialized.encode()).hexdigest()

    def get(self, query_spec_dict: dict) -> Optional[Any]:
        key = self._make_key(query_spec_dict)
        if key in self._cache:
            entry = self._cache[key]
            if time.time() - entry["timestamp"] < self.ttl:
                return entry["data"]
            del self._cache[key]
        return None

    def set(self, query_spec_dict: dict, data: Any, datasource_id: str = None):
        key = self._make_key(query_spec_dict)
        self._cache[key] = {
            "data": data,
            "timestamp": time.time(),
            "datasource_id": datasource_id or query_spec_dict.get("datasource_id"),
        }

    def invalidate_datasource(self, datasource_id: str):
        keys_to_delete = [
            k for k, v in self._cache.items() if v.get("datasource_id") == datasource_id
        ]
        for k in keys_to_delete:
            del self._cache[k]

    def clear(self):
        self._cache.clear()


query_cache = QueryCache()
