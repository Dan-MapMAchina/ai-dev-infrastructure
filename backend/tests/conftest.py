"""
Shared fixtures for backend tests.
Provides mocks for external services (Claude API, Ollama, Oracle, Redis).
"""

import json
import sys
import pytest
from unittest.mock import MagicMock, Mock, patch
import numpy as np


# ============================================================================
# Flask Test Client
# ============================================================================

@pytest.fixture
def app():
    """Create Flask test application."""
    # Patch external dependencies before importing app
    with patch.dict('os.environ', {
        'ANTHROPIC_API_KEY': 'test-api-key',
        'ORACLE_USER': 'test_user',
        'ORACLE_PASSWORD': 'test_pass',
        'ORACLE_DSN': 'localhost:1521/TEST',
        'OLLAMA_HOST': 'http://localhost:11434'
    }):
        from src.api.app import app as flask_app
        flask_app.config['TESTING'] = True
        yield flask_app


@pytest.fixture
def client(app):
    """Create Flask test client."""
    return app.test_client()


@pytest.fixture
def app_lite_mode(mocker):
    """Create Flask app in lite mode (no database connection)."""
    with patch.dict('os.environ', {
        'ANTHROPIC_API_KEY': 'test-api-key'
    }):
        # Import the module using importlib to get the actual module object
        import importlib
        app_module = importlib.import_module('src.api.app')

        # Set lite mode state
        app_module.lite_mode = True
        app_module.router = None
        app_module.claude_client = None
        app_module.app.config['TESTING'] = True

        yield app_module


@pytest.fixture
def client_lite_mode(app_lite_mode):
    """Create Flask test client in lite mode."""
    return app_lite_mode.app.test_client()


# ============================================================================
# Anthropic (Claude) Client Mock
# ============================================================================

@pytest.fixture
def mock_anthropic_client():
    """Mock Anthropic client for Claude API calls."""
    mock_client = MagicMock()

    # Mock message response
    mock_response = MagicMock()
    mock_response.content = [
        MagicMock(type="text", text="This is a mock Claude response")
    ]
    mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)
    mock_response.stop_reason = "end_turn"

    mock_client.messages.create.return_value = mock_response

    return mock_client


@pytest.fixture
def mock_anthropic_error_response():
    """Mock Anthropic client that raises an error."""
    mock_client = MagicMock()
    mock_client.messages.create.side_effect = Exception("API rate limit exceeded")
    return mock_client


# ============================================================================
# Ollama Client Mock
# ============================================================================

@pytest.fixture
def mock_ollama_client():
    """Mock Ollama client for local LLM calls."""
    mock_client = MagicMock()

    mock_response = {
        'message': {
            'content': 'This is a mock Ollama response'
        }
    }
    mock_client.chat.return_value = mock_response

    return mock_client


@pytest.fixture
def mock_ollama_unavailable():
    """Mock Ollama client that simulates unavailable service."""
    mock_client = MagicMock()
    mock_client.chat.side_effect = Exception("Connection refused")
    return mock_client


# ============================================================================
# Oracle Database Mock
# ============================================================================

@pytest.fixture
def mock_oracle_connection():
    """Mock Oracle database connection and cursor."""
    mock_connection = MagicMock()
    mock_cursor = MagicMock()

    mock_connection.cursor.return_value = mock_cursor

    # Default empty result
    mock_cursor.fetchone.return_value = None
    mock_cursor.fetchall.return_value = []

    # Mock var for RETURNING INTO
    mock_var = MagicMock()
    mock_var.getvalue.return_value = 1
    mock_cursor.var.return_value = mock_var

    return mock_connection, mock_cursor


@pytest.fixture
def mock_oracle_with_agents(mock_oracle_connection):
    """Mock Oracle with pre-populated agent data."""
    connection, cursor = mock_oracle_connection

    # Sample agent data
    sample_agents = [
        (1, 'Code Review Specialist', 'code_review',
         'Deep code review focusing on security', 0.88, 50, None),
        (2, 'Refactoring Specialist', 'refactoring',
         'Transform messy code into clean architecture', 0.91, 30, None),
    ]

    def mock_execute(query, params=None):
        query_lower = query.lower()
        if 'select' in query_lower and 'agent_repository' in query_lower:
            if 'where id' in query_lower or 'where agent_type' in query_lower:
                cursor.fetchone.return_value = sample_agents[0]
            else:
                cursor.__iter__ = lambda self: iter(sample_agents)

    cursor.execute.side_effect = mock_execute

    return connection, cursor


# ============================================================================
# Redis Mock
# ============================================================================

@pytest.fixture
def mock_redis_client():
    """Mock Redis client for caching."""
    mock_client = MagicMock()

    # In-memory storage for testing
    cache_storage = {}

    def mock_get(key):
        return cache_storage.get(key)

    def mock_setex(key, ttl, value):
        cache_storage[key] = value
        return True

    def mock_ping():
        return True

    mock_client.get.side_effect = mock_get
    mock_client.setex.side_effect = mock_setex
    mock_client.ping.return_value = True  # Use return_value, not side_effect

    return mock_client


@pytest.fixture
def mock_redis_unavailable():
    """Mock Redis client that simulates unavailable service."""
    mock_client = MagicMock()
    mock_client.ping.side_effect = Exception("Connection refused")
    mock_client.get.side_effect = Exception("Connection refused")
    mock_client.setex.side_effect = Exception("Connection refused")
    return mock_client


# ============================================================================
# SentenceTransformer (Embeddings) Mock
# ============================================================================

@pytest.fixture
def mock_embedding_model():
    """Mock SentenceTransformer for embeddings."""
    mock_model = MagicMock()

    # Return consistent 384-dimensional embeddings (MiniLM size)
    def mock_encode(text):
        # Generate deterministic embedding based on text hash
        np.random.seed(hash(text) % (2**32 - 1))
        return np.random.randn(384).astype(np.float32)

    mock_model.encode.side_effect = mock_encode

    return mock_model


# ============================================================================
# Composite Fixtures
# ============================================================================

@pytest.fixture
def mock_router_dependencies(
    mocker,
    mock_oracle_connection,
    mock_anthropic_client,
    mock_ollama_client,
    mock_embedding_model
):
    """
    Patch all external dependencies for IntelligentAgentRouter.
    Returns dict with all mocked components.
    """
    connection, cursor = mock_oracle_connection

    # Need to patch at module level before import
    mocker.patch('oracledb.connect', return_value=connection)
    mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
    mocker.patch('ollama.Client', return_value=mock_ollama_client)

    # Mock SentenceTransformer by patching the module
    mock_st_module = MagicMock()
    mock_st_module.SentenceTransformer.return_value = mock_embedding_model
    mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

    return {
        'connection': connection,
        'cursor': cursor,
        'anthropic': mock_anthropic_client,
        'ollama': mock_ollama_client,
        'embedding_model': mock_embedding_model
    }


@pytest.fixture
def mock_cache_dependencies(mocker, mock_redis_client):
    """
    Patch Redis for IntelligentCache.
    """
    mock_redis_module = MagicMock()
    mock_redis_module.from_url.return_value = mock_redis_client
    mocker.patch.dict('sys.modules', {'redis': mock_redis_module})

    return mock_redis_client


# ============================================================================
# Sample Data Fixtures
# ============================================================================

@pytest.fixture
def sample_task():
    """Sample development task for testing."""
    return "Review the following Python code for security vulnerabilities and performance issues"


@pytest.fixture
def sample_simple_query():
    """Sample simple query for Ollama routing."""
    return "What is a Python dictionary?"


@pytest.fixture
def sample_complex_query():
    """Sample complex query for Claude routing."""
    return "Develop and implement a comprehensive refactoring strategy for the authentication module"


@pytest.fixture
def sample_oracle_query():
    """Sample database query for Oracle routing."""
    return "Write SQL to aggregate user sessions and join with purchases table"


@pytest.fixture
def sample_agent_data():
    """Sample agent data for testing."""
    return {
        'id': 1,
        'name': 'Test Agent',
        'type': 'code_review',
        'purpose': 'Test agent for code review',
        'system_prompt': 'You are a test code review agent.',
        'tools_enabled': ['bash', 'text_editor'],
        'success_rate': 0.9,
        'tasks_completed': 100
    }


@pytest.fixture
def sample_project_data():
    """Sample project data for testing."""
    return {
        'project_id': 'test-project-123',
        'name': 'Test Project',
        'tech_stack': ['python', 'flask', 'postgresql'],
        'requirements': ['testing', 'code review', 'documentation']
    }
