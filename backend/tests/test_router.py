"""
Tests for IntelligentAgentRouter.
"""

import json
import sys
import pytest
from unittest.mock import MagicMock, patch, Mock
import numpy as np


class TestQueryClassification:
    """Tests for classify_query_complexity method."""

    @pytest.fixture
    def router(self, mocker, mock_oracle_connection, mock_anthropic_client,
               mock_ollama_client, mock_embedding_model):
        """Create router with mocked dependencies."""
        connection, cursor = mock_oracle_connection

        # Patch all external dependencies
        mocker.patch('oracledb.connect', return_value=connection)
        mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
        mocker.patch('ollama.Client', return_value=mock_ollama_client)

        # Mock SentenceTransformer
        mock_st_module = MagicMock()
        mock_st_module.SentenceTransformer.return_value = mock_embedding_model
        mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

        # Now import the router
        from src.router.intelligent_router import IntelligentAgentRouter
        return IntelligentAgentRouter(
            oracle_config={
                'user': 'test',
                'password': 'test',
                'dsn': 'localhost:1521/TEST'
            },
            anthropic_api_key='test-api-key'
        )

    def test_classify_oracle_query(self, router):
        """Database queries should route to Oracle."""
        queries = [
            "Write SQL to select users from database",
            "Create a schema migration for the orders table",
            "Aggregate data and join tables to get report",
        ]
        for query in queries:
            result = router.classify_query_complexity(query)
            assert result == 'oracle', f"Expected oracle for: {query}"

    def test_classify_complex_to_claude(self, router):
        """Complex development tasks should route to Claude."""
        queries = [
            "Develop and implement a new authentication system",
            "Refactor and architect the user module for scalability",
            "Debug and optimize the payment processing code",
        ]
        for query in queries:
            result = router.classify_query_complexity(query)
            assert result == 'claude', f"Expected claude for: {query}"

    def test_classify_simple_to_ollama(self, router):
        """Simple tasks should route to Ollama."""
        queries = [
            "Summarize this brief summary text tldr",
            "Classify the category type of this",
            "What is Python? Define it simply.",
        ]
        for query in queries:
            result = router.classify_query_complexity(query)
            assert result == 'ollama', f"Expected ollama for: {query}"

    def test_classify_short_query_to_ollama(self, router):
        """Short queries default to Ollama."""
        result = router.classify_query_complexity("Hello there")
        assert result == 'ollama'

    def test_classify_code_keyword_to_claude(self, router):
        """Queries with development keywords route to Claude."""
        # The router requires 'code' AND 20+ words, or development keywords like 'develop', 'build'
        result = router.classify_query_complexity(
            "I need to develop and build a new feature with code for my application project"
        )
        assert result == 'claude'


class TestOllamaQuery:
    """Tests for query_ollama method."""

    @pytest.fixture
    def router_and_mocks(self, mocker, mock_oracle_connection, mock_anthropic_client,
                         mock_ollama_client, mock_embedding_model):
        """Create router with mocked dependencies, returning both."""
        connection, cursor = mock_oracle_connection

        mocker.patch('oracledb.connect', return_value=connection)
        mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
        mocker.patch('ollama.Client', return_value=mock_ollama_client)

        mock_st_module = MagicMock()
        mock_st_module.SentenceTransformer.return_value = mock_embedding_model
        mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

        from src.router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter(
            oracle_config={
                'user': 'test',
                'password': 'test',
                'dsn': 'localhost:1521/TEST'
            },
            anthropic_api_key='test-api-key'
        )

        return router, {
            'connection': connection,
            'cursor': cursor,
            'ollama': mock_ollama_client,
            'anthropic': mock_anthropic_client
        }

    def test_query_ollama_returns_response(self, router_and_mocks):
        """Ollama query should return response content."""
        router, mocks = router_and_mocks
        result = router.query_ollama("What is Python?")
        assert result == 'This is a mock Ollama response'

    def test_query_ollama_uses_correct_model(self, router_and_mocks):
        """Ollama should use the configured model."""
        router, mocks = router_and_mocks
        router.query_ollama("Test query")

        mocks['ollama'].chat.assert_called_once()
        call_args = mocks['ollama'].chat.call_args
        assert call_args.kwargs['model'] == 'llama3.2:3b'

    def test_query_ollama_with_task_type(self, router_and_mocks):
        """Different task types should use different system prompts."""
        router, mocks = router_and_mocks
        router.query_ollama("Summarize this text", task_type='summarize')

        call_args = mocks['ollama'].chat.call_args
        messages = call_args.kwargs['messages']
        assert 'summarization' in messages[0]['content'].lower()

    def test_query_ollama_logs_routing(self, router_and_mocks):
        """Ollama queries should log routing decisions."""
        router, mocks = router_and_mocks
        router.query_ollama("Test query")

        # Should have called execute for INSERT into routing_logs
        assert mocks['cursor'].execute.called


class TestClaudeQuery:
    """Tests for query_claude method."""

    @pytest.fixture
    def router_and_mocks(self, mocker, mock_oracle_connection, mock_anthropic_client,
                         mock_ollama_client, mock_embedding_model):
        """Create router with mocked dependencies."""
        connection, cursor = mock_oracle_connection

        mocker.patch('oracledb.connect', return_value=connection)
        mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
        mocker.patch('ollama.Client', return_value=mock_ollama_client)

        mock_st_module = MagicMock()
        mock_st_module.SentenceTransformer.return_value = mock_embedding_model
        mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

        from src.router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter(
            oracle_config={
                'user': 'test',
                'password': 'test',
                'dsn': 'localhost:1521/TEST'
            },
            anthropic_api_key='test-api-key'
        )

        return router, {
            'connection': connection,
            'cursor': cursor,
            'anthropic': mock_anthropic_client
        }

    def test_query_claude_returns_response(self, router_and_mocks):
        """Claude query should return response dict."""
        router, mocks = router_and_mocks
        result = router.query_claude("Review this code")

        assert 'response' in result
        assert result['response'] == 'This is a mock Claude response'
        assert 'execution_time_ms' in result
        assert 'tokens_used' in result

    def test_query_claude_calculates_tokens(self, router_and_mocks):
        """Claude query should calculate total tokens."""
        router, mocks = router_and_mocks
        result = router.query_claude("Review this code")

        # Mock returns input_tokens=100, output_tokens=50
        assert result['tokens_used'] == 150

    def test_query_claude_with_conversation_history(self, router_and_mocks):
        """Claude query should include conversation history."""
        router, mocks = router_and_mocks
        history = [
            {"role": "user", "content": "Previous message"},
            {"role": "assistant", "content": "Previous response"}
        ]

        result = router.query_claude("Follow up question", conversation_history=history)

        call_args = mocks['anthropic'].messages.create.call_args
        messages = call_args.kwargs['messages']

        assert len(messages) == 3  # 2 history + 1 new

    def test_query_claude_handles_error(self, router_and_mocks):
        """Claude query should handle API errors gracefully."""
        router, mocks = router_and_mocks
        mocks['anthropic'].messages.create.side_effect = Exception("API Error")

        result = router.query_claude("Test query")

        assert 'error' in result
        assert result['error'] == 'API Error'


class TestAgentManagement:
    """Tests for agent management methods."""

    @pytest.fixture
    def router_and_mocks(self, mocker, mock_oracle_connection, mock_anthropic_client,
                         mock_ollama_client, mock_embedding_model):
        """Create router with mocked dependencies."""
        connection, cursor = mock_oracle_connection

        mocker.patch('oracledb.connect', return_value=connection)
        mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
        mocker.patch('ollama.Client', return_value=mock_ollama_client)

        mock_st_module = MagicMock()
        mock_st_module.SentenceTransformer.return_value = mock_embedding_model
        mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

        from src.router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter(
            oracle_config={
                'user': 'test',
                'password': 'test',
                'dsn': 'localhost:1521/TEST'
            },
            anthropic_api_key='test-api-key'
        )

        return router, {
            'connection': connection,
            'cursor': cursor
        }

    def test_find_best_agent_by_type(self, router_and_mocks):
        """Finding agent by type should query database."""
        router, mocks = router_and_mocks

        # Mock agent data with LOB simulation
        mock_system_prompt = MagicMock()
        mock_system_prompt.read.return_value = "You are a code review agent"
        mock_tools = MagicMock()
        mock_tools.read.return_value = '["bash", "text_editor"]'

        mocks['cursor'].fetchone.return_value = (
            1, 'Code Review Specialist', 'code_review',
            mock_system_prompt, mock_tools, 0.88, 50
        )

        result = router.find_best_agent_for_task(
            "Review this code",
            agent_type='code_review'
        )

        assert result is not None
        assert result['agent_id'] == 1
        assert result['name'] == 'Code Review Specialist'
        assert result['type'] == 'code_review'

    def test_find_best_agent_returns_none_when_not_found(self, router_and_mocks):
        """Should return None when no agent found."""
        router, mocks = router_and_mocks
        mocks['cursor'].fetchone.return_value = None

        result = router.find_best_agent_for_task(
            "Unknown task type",
            agent_type='nonexistent'
        )

        assert result is None

    def test_find_best_agent_handles_database_error(self, router_and_mocks):
        """Should handle database errors gracefully."""
        router, mocks = router_and_mocks
        mocks['cursor'].execute.side_effect = Exception("Database connection lost")

        result = router.find_best_agent_for_task("Test task")

        assert result is None

    def test_assign_agent_to_project(self, router_and_mocks):
        """Assigning agent to project should execute MERGE."""
        router, mocks = router_and_mocks
        # Reset side effect for this test
        mocks['cursor'].execute.side_effect = None

        router.assign_agent_to_project(
            agent_id=1,
            project_id='test-project',
            role='code_review',
            reason='API request'
        )

        assert mocks['cursor'].execute.called
        mocks['connection'].commit.assert_called()


class TestLearningCheckpoints:
    """Tests for learning and checkpoint functionality."""

    @pytest.fixture
    def router_and_mocks(self, mocker, mock_oracle_connection, mock_anthropic_client,
                         mock_ollama_client, mock_embedding_model):
        """Create router with mocked dependencies."""
        connection, cursor = mock_oracle_connection

        mocker.patch('oracledb.connect', return_value=connection)
        mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
        mocker.patch('ollama.Client', return_value=mock_ollama_client)

        mock_st_module = MagicMock()
        mock_st_module.SentenceTransformer.return_value = mock_embedding_model
        mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

        from src.router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter(
            oracle_config={
                'user': 'test',
                'password': 'test',
                'dsn': 'localhost:1521/TEST'
            },
            anthropic_api_key='test-api-key'
        )

        return router, {
            'connection': connection,
            'cursor': cursor
        }

    def test_maybe_create_checkpoint_on_milestone(self, router_and_mocks):
        """Checkpoint should be created every 10 tasks."""
        router, mocks = router_and_mocks

        # First call returns task count of 10
        mocks['cursor'].fetchone.side_effect = [
            (10,),  # total_tasks_completed
            (0,),   # max checkpoint version
            (0.9, 150.0, 10),  # performance metrics
        ]

        router._maybe_create_checkpoint(agent_id=1)

        # Should have executed queries for checkpoint
        assert mocks['cursor'].execute.call_count >= 1

    def test_no_checkpoint_before_milestone(self, router_and_mocks):
        """No checkpoint should be created before 10 tasks."""
        router, mocks = router_and_mocks
        mocks['cursor'].fetchone.return_value = (7,)  # 7 tasks, not a multiple of 10

        # Reset execute call count
        mocks['cursor'].execute.reset_mock()

        router._maybe_create_checkpoint(agent_id=1)

        # Check that no INSERT was called for checkpoints
        calls = [str(c) for c in mocks['cursor'].execute.call_args_list]
        insert_checkpoint_calls = [c for c in calls if 'learning_checkpoint' in c.lower() and 'insert' in c.lower()]
        assert len(insert_checkpoint_calls) == 0

    def test_get_agent_learning_summary(self, router_and_mocks):
        """Should return agent learning summary."""
        router, mocks = router_and_mocks
        mocks['cursor'].fetchone.return_value = (
            'Code Review Specialist',  # agent_name
            50,   # total_tasks_completed
            0.9,  # success_rate
            150.0,  # average_execution_time_ms
            5,    # checkpoints
            0.15  # best_improvement
        )

        result = router.get_agent_learning_summary(agent_id=1)

        assert result['agent_name'] == 'Code Review Specialist'
        assert result['total_tasks'] == 50
        assert result['success_rate'] == 0.9
        assert result['checkpoints'] == 5


class TestAgentContext:
    """Tests for agent context retrieval."""

    @pytest.fixture
    def router_and_mocks(self, mocker, mock_oracle_connection, mock_anthropic_client,
                         mock_ollama_client, mock_embedding_model):
        """Create router with mocked dependencies."""
        connection, cursor = mock_oracle_connection

        mocker.patch('oracledb.connect', return_value=connection)
        mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
        mocker.patch('ollama.Client', return_value=mock_ollama_client)

        mock_st_module = MagicMock()
        mock_st_module.SentenceTransformer.return_value = mock_embedding_model
        mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

        from src.router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter(
            oracle_config={
                'user': 'test',
                'password': 'test',
                'dsn': 'localhost:1521/TEST'
            },
            anthropic_api_key='test-api-key'
        )

        return router, {'cursor': cursor}

    def test_get_agent_context(self, router_and_mocks):
        """Should retrieve agent context from database."""
        router, mocks = router_and_mocks

        # Mock LOB objects
        mock_prompt = MagicMock()
        mock_prompt.read.return_value = "You are a code review agent"
        mock_tools = MagicMock()
        mock_tools.read.return_value = '["bash"]'
        mock_patterns = MagicMock()
        mock_patterns.read.return_value = '{"pattern1": "value1"}'

        mocks['cursor'].fetchone.return_value = (
            'Code Review',
            mock_prompt,
            mock_tools,
            mock_patterns
        )

        result = router._get_agent_context(agent_id=1)

        assert result['name'] == 'Code Review'
        assert result['system_prompt'] == 'You are a code review agent'
        assert result['tools_enabled'] == ['bash']
        assert result['learned_patterns'] == {'pattern1': 'value1'}

    def test_get_agent_context_not_found(self, router_and_mocks):
        """Should return empty dict when agent not found."""
        router, mocks = router_and_mocks
        mocks['cursor'].fetchone.return_value = None

        result = router._get_agent_context(agent_id=999)

        assert result == {}


class TestRouterClose:
    """Tests for router cleanup."""

    def test_close_closes_connections(self, mocker, mock_oracle_connection,
                                       mock_anthropic_client, mock_ollama_client,
                                       mock_embedding_model):
        """Close should close cursor and connection."""
        connection, cursor = mock_oracle_connection

        mocker.patch('oracledb.connect', return_value=connection)
        mocker.patch('anthropic.Anthropic', return_value=mock_anthropic_client)
        mocker.patch('ollama.Client', return_value=mock_ollama_client)

        mock_st_module = MagicMock()
        mock_st_module.SentenceTransformer.return_value = mock_embedding_model
        mocker.patch.dict('sys.modules', {'sentence_transformers': mock_st_module})

        from src.router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter(
            oracle_config={
                'user': 'test',
                'password': 'test',
                'dsn': 'localhost:1521/TEST'
            },
            anthropic_api_key='test-api-key'
        )

        router.close()

        cursor.close.assert_called_once()
        connection.close.assert_called_once()
