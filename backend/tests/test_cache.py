"""
Tests for IntelligentCache.
"""

import json
import pytest
from unittest.mock import MagicMock, patch


class TestResponseCache:
    """Tests for response caching functionality."""

    @pytest.fixture
    def cache(self):
        """Create cache without Redis."""
        from src.cache.intelligent_cache import IntelligentCache
        return IntelligentCache(redis_url=None)

    def test_cache_response_and_retrieve(self, cache):
        """Cached response should be retrievable."""
        query = "What is Python?"
        response = {'answer': 'A programming language', 'tokens': 50}

        cache.cache_response(query, response)
        result = cache.get_cached_response(query)

        assert result == response

    def test_cache_miss_returns_none(self, cache):
        """Cache miss should return None."""
        result = cache.get_cached_response("Never seen this query")
        assert result is None

    def test_cache_with_context(self, cache):
        """Responses with different contexts should be cached separately."""
        query = "Explain this"
        context1 = {'project_id': 'project1'}
        context2 = {'project_id': 'project2'}
        response1 = {'answer': 'Response 1'}
        response2 = {'answer': 'Response 2'}

        cache.cache_response(query, response1, context=context1)
        cache.cache_response(query, response2, context=context2)

        result1 = cache.get_cached_response(query, context=context1)
        result2 = cache.get_cached_response(query, context=context2)

        assert result1 == response1
        assert result2 == response2

    def test_cache_key_generation(self, cache):
        """Cache keys should be deterministic."""
        query = "Test query"
        context = {'key': 'value'}

        key1 = cache._make_key(query, context)
        key2 = cache._make_key(query, context)

        assert key1 == key2

    def test_different_queries_different_keys(self, cache):
        """Different queries should have different keys."""
        key1 = cache._make_key("Query 1", None)
        key2 = cache._make_key("Query 2", None)

        assert key1 != key2


class TestEmbeddingCache:
    """Tests for embedding caching functionality."""

    @pytest.fixture
    def cache(self):
        """Create cache without Redis."""
        from src.cache.intelligent_cache import IntelligentCache
        return IntelligentCache(redis_url=None)

    def test_cache_embedding_and_retrieve(self, cache):
        """Cached embedding should be retrievable."""
        text = "Sample text for embedding"
        embedding = [0.1, 0.2, 0.3, 0.4]

        cache.cache_embedding(text, embedding)
        result = cache.get_cached_embedding(text)

        assert result == embedding

    def test_embedding_cache_miss(self, cache):
        """Embedding cache miss should return None."""
        result = cache.get_cached_embedding("Never embedded this")
        assert result is None

    def test_embedding_cache_is_lru(self, cache):
        """Embedding cache should use LRU eviction."""
        # Cache should have a max size
        assert cache.embedding_cache.maxsize > 0


class TestAgentSelectionCache:
    """Tests for agent selection caching functionality."""

    @pytest.fixture
    def cache(self):
        """Create cache without Redis."""
        from src.cache.intelligent_cache import IntelligentCache
        return IntelligentCache(redis_url=None)

    def test_cache_agent_selection_and_retrieve(self, cache):
        """Cached agent selection should be retrievable."""
        task = "Review this code"
        agent = {'id': 1, 'name': 'Code Review Specialist'}
        project_id = 'test-project'

        cache.cache_agent_selection(task, agent, project_id=project_id)
        result = cache.get_cached_agent_selection(task, project_id=project_id)

        assert result == agent

    def test_agent_selection_cache_miss(self, cache):
        """Agent selection cache miss should return None."""
        result = cache.get_cached_agent_selection("Unknown task")
        assert result is None

    def test_agent_selection_by_project(self, cache):
        """Different projects should have separate agent selections."""
        task = "Review code"
        agent1 = {'id': 1, 'name': 'Agent 1'}
        agent2 = {'id': 2, 'name': 'Agent 2'}

        cache.cache_agent_selection(task, agent1, project_id='project1')
        cache.cache_agent_selection(task, agent2, project_id='project2')

        result1 = cache.get_cached_agent_selection(task, project_id='project1')
        result2 = cache.get_cached_agent_selection(task, project_id='project2')

        assert result1 == agent1
        assert result2 == agent2


class TestRedisIntegration:
    """Tests for Redis integration."""

    def test_cache_with_redis(self, mocker, mock_redis_client):
        """Cache should use Redis when available."""
        # Patch redis module
        mock_redis_module = MagicMock()
        mock_redis_module.from_url.return_value = mock_redis_client
        mocker.patch.dict('sys.modules', {'redis': mock_redis_module})

        # Need to reimport after patching
        import importlib
        from src.cache import intelligent_cache
        importlib.reload(intelligent_cache)

        cache = intelligent_cache.IntelligentCache(redis_url='redis://localhost:6379')

        assert cache.redis_client is not None

    def test_cache_falls_back_without_redis(self):
        """Cache should work without Redis."""
        from src.cache.intelligent_cache import IntelligentCache
        cache = IntelligentCache(redis_url=None)

        assert cache.redis_client is None

        # Should still work with in-memory cache
        cache.cache_response("test", {'data': 'value'})
        result = cache.get_cached_response("test")
        assert result == {'data': 'value'}

    def test_redis_connection_failure_fallback(self, mocker):
        """Should handle Redis connection failure gracefully."""
        # Create a mock that fails on ping
        mock_client = MagicMock()
        mock_client.ping.side_effect = Exception("Connection refused")

        mock_redis_module = MagicMock()
        mock_redis_module.from_url.return_value = mock_client
        mocker.patch.dict('sys.modules', {'redis': mock_redis_module})

        import importlib
        from src.cache import intelligent_cache
        importlib.reload(intelligent_cache)

        cache = intelligent_cache.IntelligentCache(redis_url='redis://localhost:6379')

        # Redis client should be None after connection failure
        assert cache.redis_client is None

    def test_response_cached_in_redis(self, mocker, mock_redis_client):
        """Response should be cached in Redis."""
        mock_redis_module = MagicMock()
        mock_redis_module.from_url.return_value = mock_redis_client
        mocker.patch.dict('sys.modules', {'redis': mock_redis_module})

        import importlib
        from src.cache import intelligent_cache
        importlib.reload(intelligent_cache)

        cache = intelligent_cache.IntelligentCache(redis_url='redis://localhost:6379')
        cache.cache_response("test query", {'data': 'value'}, ttl=3600)

        mock_redis_client.setex.assert_called()

    def test_response_retrieved_from_redis(self, mocker):
        """Response should be retrieved from Redis on cache miss."""
        # Create mock with pre-populated data
        mock_client = MagicMock()
        mock_client.ping.return_value = True
        cached_data = json.dumps({'data': 'from redis'})
        mock_client.get.return_value = cached_data

        mock_redis_module = MagicMock()
        mock_redis_module.from_url.return_value = mock_client
        mocker.patch.dict('sys.modules', {'redis': mock_redis_module})

        import importlib
        from src.cache import intelligent_cache
        importlib.reload(intelligent_cache)

        cache = intelligent_cache.IntelligentCache(redis_url='redis://localhost:6379')
        result = cache.get_cached_response("test query")

        assert result == {'data': 'from redis'}


class TestCacheStats:
    """Tests for cache statistics."""

    @pytest.fixture
    def cache(self):
        """Create cache without Redis."""
        from src.cache.intelligent_cache import IntelligentCache
        return IntelligentCache(redis_url=None)

    def test_get_stats_returns_all_caches(self, cache):
        """Stats should include all cache metrics."""
        stats = cache.get_stats()

        assert 'response_cache' in stats
        assert 'embedding_cache' in stats
        assert 'agent_cache' in stats
        assert 'redis_connected' in stats

    def test_stats_include_sizes(self, cache):
        """Stats should include current size and max size."""
        # Add some items
        cache.cache_response("q1", {'r': 1})
        cache.cache_response("q2", {'r': 2})
        cache.cache_embedding("text1", [0.1])

        stats = cache.get_stats()

        assert stats['response_cache']['size'] == 2
        assert stats['embedding_cache']['size'] == 1
        assert stats['response_cache']['maxsize'] > 0

    def test_stats_redis_connected_false_when_no_redis(self, cache):
        """Redis connected should be False without Redis."""
        stats = cache.get_stats()
        assert stats['redis_connected'] is False

    def test_stats_redis_connected_true_with_redis(self, mocker, mock_redis_client):
        """Redis connected should be True with Redis."""
        mock_redis_module = MagicMock()
        mock_redis_module.from_url.return_value = mock_redis_client
        mocker.patch.dict('sys.modules', {'redis': mock_redis_module})

        import importlib
        from src.cache import intelligent_cache
        importlib.reload(intelligent_cache)

        cache = intelligent_cache.IntelligentCache(redis_url='redis://localhost:6379')

        stats = cache.get_stats()
        assert stats['redis_connected'] is True


class TestCacheTTL:
    """Tests for cache TTL behavior."""

    @pytest.fixture
    def cache(self):
        """Create cache without Redis."""
        from src.cache.intelligent_cache import IntelligentCache
        return IntelligentCache(redis_url=None)

    def test_response_cache_has_ttl(self, cache):
        """Response cache should have TTL."""
        assert hasattr(cache.response_cache, 'ttl')
        assert cache.response_cache.ttl > 0

    def test_agent_cache_has_ttl(self, cache):
        """Agent selection cache should have TTL."""
        assert hasattr(cache.agent_selection_cache, 'ttl')
        assert cache.agent_selection_cache.ttl > 0

    def test_clear_expired_runs_without_error(self, cache):
        """Clear expired should run without error."""
        # Add some items
        cache.cache_response("q1", {'r': 1})
        cache.cache_embedding("text1", [0.1])

        # Should not raise
        cache.clear_expired()
