"""
Three-tier Intelligent Caching System
"""

import hashlib
import json
import time
from typing import Optional, Dict, Any
from cachetools import TTLCache, LRUCache

try:
    import redis
except ImportError:
    redis = None


class IntelligentCache:
    """
    Three-tier caching:
    1. Response cache - Cache identical queries
    2. Embedding cache - Cache vector embeddings
    3. Agent selection cache - Cache agent choices for similar tasks
    """

    def __init__(self, redis_url: Optional[str] = None):
        # In-memory caches
        self.response_cache = TTLCache(maxsize=1000, ttl=3600)  # 1 hour
        self.embedding_cache = LRUCache(maxsize=10000)
        self.agent_selection_cache = TTLCache(maxsize=500, ttl=7200)  # 2 hours

        # Redis for distributed caching (optional)
        self.redis_client = None
        if redis_url and redis:
            try:
                self.redis_client = redis.from_url(redis_url)
                self.redis_client.ping()
            except Exception as e:
                print(f"Redis connection failed: {e}")
                self.redis_client = None

    def get_cached_response(
        self,
        query: str,
        context: Optional[Dict] = None
    ) -> Optional[Dict]:
        """Check for cached response"""
        cache_key = self._make_key(query, context)

        # Check memory cache first
        if cache_key in self.response_cache:
            return self.response_cache[cache_key]

        # Check Redis if available
        if self.redis_client:
            try:
                cached = self.redis_client.get(f"response:{cache_key}")
                if cached:
                    data = json.loads(cached)
                    # Populate memory cache
                    self.response_cache[cache_key] = data
                    return data
            except Exception:
                pass

        return None

    def cache_response(
        self,
        query: str,
        response: Dict,
        context: Optional[Dict] = None,
        ttl: int = 3600
    ):
        """Cache a response"""
        cache_key = self._make_key(query, context)

        # Memory cache
        self.response_cache[cache_key] = response

        # Redis cache
        if self.redis_client:
            try:
                self.redis_client.setex(
                    f"response:{cache_key}",
                    ttl,
                    json.dumps(response)
                )
            except Exception:
                pass

    def get_cached_embedding(self, text: str) -> Optional[list]:
        """Get cached embedding"""
        cache_key = hashlib.md5(text.encode()).hexdigest()
        return self.embedding_cache.get(cache_key)

    def cache_embedding(self, text: str, embedding: list):
        """Cache an embedding"""
        cache_key = hashlib.md5(text.encode()).hexdigest()
        self.embedding_cache[cache_key] = embedding

    def get_cached_agent_selection(
        self,
        task: str,
        project_id: Optional[str] = None
    ) -> Optional[Dict]:
        """Get cached agent selection"""
        cache_key = self._make_key(task, {'project_id': project_id})
        return self.agent_selection_cache.get(cache_key)

    def cache_agent_selection(
        self,
        task: str,
        agent: Dict,
        project_id: Optional[str] = None
    ):
        """Cache agent selection"""
        cache_key = self._make_key(task, {'project_id': project_id})
        self.agent_selection_cache[cache_key] = agent

    def _make_key(self, query: str, context: Optional[Dict]) -> str:
        """Generate cache key"""
        key_data = query
        if context:
            key_data += json.dumps(context, sort_keys=True)
        return hashlib.md5(key_data.encode()).hexdigest()

    def clear_expired(self):
        """Clear expired entries"""
        # TTLCache handles this automatically
        # This is for manual cleanup if needed
        pass

    def get_stats(self) -> Dict:
        """Get cache statistics"""
        return {
            'response_cache': {
                'size': len(self.response_cache),
                'maxsize': self.response_cache.maxsize
            },
            'embedding_cache': {
                'size': len(self.embedding_cache),
                'maxsize': self.embedding_cache.maxsize
            },
            'agent_cache': {
                'size': len(self.agent_selection_cache),
                'maxsize': self.agent_selection_cache.maxsize
            },
            'redis_connected': self.redis_client is not None
        }
