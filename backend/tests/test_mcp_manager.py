"""
Tests for MCPServerManager.
"""

import json
import pytest
from unittest.mock import MagicMock, patch
import numpy as np


class TestToolRecommendation:
    """Tests for recommend_tools_for_project method."""

    @pytest.fixture
    def manager(self, mock_oracle_connection, mock_embedding_model):
        """Create MCP manager with mocked dependencies."""
        connection, cursor = mock_oracle_connection
        from src.mcp.manager import MCPServerManager
        return MCPServerManager(cursor, mock_embedding_model)

    @pytest.fixture
    def mock_mcp_registry_data(self):
        """Sample MCP server registry data."""
        return [
            ('filesystem', 'filesystem', 'File system operations',
             '{"read": true, "write": true}', 'npx @mcp/filesystem', 0.1),
            ('github', 'git', 'GitHub operations',
             '{"repo": true, "pr": true}', 'npx @mcp/github', 0.2),
            ('postgresql', 'database', 'PostgreSQL database access',
             '{"query": true}', 'npx @mcp/postgresql', 0.3),
            ('memory', 'knowledge_base', 'Knowledge persistence',
             '{"store": true}', 'npx @mcp/memory', 0.4),
            ('puppeteer', 'browser', 'Browser automation',
             '{"navigate": true}', 'npx @mcp/puppeteer', 0.5),
        ]

    def test_recommend_returns_essential_and_recommended(
        self, manager, mock_oracle_connection, mock_mcp_registry_data
    ):
        """Should return both essential and recommended tools."""
        connection, cursor = mock_oracle_connection
        cursor.__iter__ = lambda self: iter(mock_mcp_registry_data)

        result = manager.recommend_tools_for_project(
            project_type='web_application',
            tech_stack=['python', 'flask'],
            requirements=['api development']
        )

        assert 'essential' in result
        assert 'recommended' in result

    def test_filesystem_github_memory_are_essential(
        self, manager, mock_oracle_connection, mock_mcp_registry_data
    ):
        """Filesystem, GitHub, and memory should always be essential."""
        connection, cursor = mock_oracle_connection
        cursor.__iter__ = lambda self: iter(mock_mcp_registry_data)

        result = manager.recommend_tools_for_project(
            project_type='any',
            tech_stack=[],
            requirements=[]
        )

        essential_names = [t['name'] for t in result['essential']]
        assert 'filesystem' in essential_names
        assert 'github' in essential_names
        assert 'memory' in essential_names

    def test_postgresql_essential_for_postgres_stack(
        self, manager, mock_oracle_connection, mock_mcp_registry_data
    ):
        """PostgreSQL should be essential for Postgres projects."""
        connection, cursor = mock_oracle_connection
        cursor.__iter__ = lambda self: iter(mock_mcp_registry_data)

        result = manager.recommend_tools_for_project(
            project_type='web_application',
            tech_stack=['postgresql', 'python'],
            requirements=[]
        )

        essential_names = [t['name'] for t in result['essential']]
        assert 'postgresql' in essential_names

    def test_puppeteer_essential_for_testing_requirements(
        self, manager, mock_oracle_connection, mock_mcp_registry_data
    ):
        """Puppeteer should be essential when testing is required."""
        connection, cursor = mock_oracle_connection
        cursor.__iter__ = lambda self: iter(mock_mcp_registry_data)

        result = manager.recommend_tools_for_project(
            project_type='web_application',
            tech_stack=['react'],
            requirements=['e2e testing']
        )

        essential_names = [t['name'] for t in result['essential']]
        assert 'puppeteer' in essential_names

    def test_recommended_limited_to_five(
        self, manager, mock_oracle_connection
    ):
        """Recommended tools should be limited to 5."""
        connection, cursor = mock_oracle_connection

        # Create more than 5 non-essential tools with low distance
        many_tools = [
            (f'tool{i}', 'other', f'Tool {i}', '{}', f'cmd{i}', 0.3)
            for i in range(10)
        ]
        cursor.__iter__ = lambda self: iter(many_tools)

        result = manager.recommend_tools_for_project(
            project_type='any',
            tech_stack=[],
            requirements=[]
        )

        assert len(result['recommended']) <= 5


class TestIsEssential:
    """Tests for _is_essential method."""

    @pytest.fixture
    def manager(self, mock_oracle_connection, mock_embedding_model):
        """Create MCP manager with mocked dependencies."""
        connection, cursor = mock_oracle_connection
        from src.mcp.manager import MCPServerManager
        return MCPServerManager(cursor, mock_embedding_model)

    def test_filesystem_always_essential(self, manager):
        """Filesystem should always be essential."""
        tool = {'name': 'filesystem', 'type': 'filesystem'}
        assert manager._is_essential(tool, [], []) is True

    def test_github_always_essential(self, manager):
        """GitHub should always be essential."""
        tool = {'name': 'github', 'type': 'git'}
        assert manager._is_essential(tool, [], []) is True

    def test_memory_always_essential(self, manager):
        """Memory should always be essential."""
        tool = {'name': 'memory', 'type': 'knowledge_base'}
        assert manager._is_essential(tool, [], []) is True

    def test_postgresql_essential_with_sql_stack(self, manager):
        """PostgreSQL essential with SQL in tech stack."""
        tool = {'name': 'postgresql', 'type': 'database'}
        assert manager._is_essential(tool, ['sql'], []) is True

    def test_slack_essential_for_collaboration(self, manager):
        """Slack essential when collaboration is required."""
        tool = {'name': 'slack', 'type': 'communication'}
        assert manager._is_essential(tool, [], ['team collaboration']) is True

    def test_random_tool_not_essential(self, manager):
        """Random tools should not be essential by default."""
        tool = {'name': 'random-tool', 'type': 'other'}
        assert manager._is_essential(tool, [], []) is False


class TestToolProjectManagement:
    """Tests for adding/removing tools from projects."""

    @pytest.fixture
    def manager(self, mock_oracle_connection, mock_embedding_model):
        """Create MCP manager with mocked dependencies."""
        connection, cursor = mock_oracle_connection
        from src.mcp.manager import MCPServerManager
        return MCPServerManager(cursor, mock_embedding_model)

    def test_add_tool_to_project(self, manager, mock_oracle_connection):
        """Adding tool should execute MERGE statement."""
        connection, cursor = mock_oracle_connection

        manager.add_tool_to_project(
            project_id='test-project',
            tool_name='postgresql',
            reason='Database access needed'
        )

        cursor.execute.assert_called()
        call_args = str(cursor.execute.call_args)
        assert 'MERGE' in call_args.upper()

    def test_remove_tool_from_project(self, manager, mock_oracle_connection):
        """Removing tool should deactivate it."""
        connection, cursor = mock_oracle_connection

        manager.remove_tool_from_project(
            project_id='test-project',
            tool_name='postgresql'
        )

        cursor.execute.assert_called()
        call_args = str(cursor.execute.call_args)
        assert 'UPDATE' in call_args.upper()
        assert "is_active = 'N'" in call_args or 'is_active' in call_args


class TestToolUsageAnalytics:
    """Tests for tool usage recording."""

    @pytest.fixture
    def manager(self, mock_oracle_connection, mock_embedding_model):
        """Create MCP manager with mocked dependencies."""
        connection, cursor = mock_oracle_connection
        from src.mcp.manager import MCPServerManager
        return MCPServerManager(cursor, mock_embedding_model)

    def test_record_tool_usage_success(self, manager, mock_oracle_connection):
        """Recording successful usage should increment counts."""
        connection, cursor = mock_oracle_connection

        manager.record_tool_usage(
            project_id='test-project',
            tool_name='filesystem',
            success=True
        )

        # Should update both project_tool_stack and mcp_server_registry
        assert cursor.execute.call_count >= 2

    def test_record_tool_usage_failure(self, manager, mock_oracle_connection):
        """Recording failed usage should still increment usage count."""
        connection, cursor = mock_oracle_connection

        manager.record_tool_usage(
            project_id='test-project',
            tool_name='postgresql',
            success=False
        )

        cursor.execute.assert_called()


class TestGetProjectTools:
    """Tests for retrieving project tools."""

    @pytest.fixture
    def manager(self, mock_oracle_connection, mock_embedding_model):
        """Create MCP manager with mocked dependencies."""
        connection, cursor = mock_oracle_connection
        from src.mcp.manager import MCPServerManager
        return MCPServerManager(cursor, mock_embedding_model)

    def test_get_project_tools_returns_list(self, manager, mock_oracle_connection):
        """Should return list of tools for project."""
        connection, cursor = mock_oracle_connection

        # Mock tool data
        tool_data = [
            ('filesystem', 'filesystem', 'File operations', 100, 98, 'Y', 'npx fs'),
            ('github', 'git', 'Git operations', 50, 49, 'Y', 'npx github'),
        ]
        cursor.__iter__ = lambda self: iter(tool_data)

        result = manager.get_project_tools('test-project')

        assert len(result) == 2
        assert result[0]['name'] == 'filesystem'
        assert result[0]['is_active'] is True
        assert result[0]['usage_count'] == 100

    def test_get_project_tools_empty_project(self, manager, mock_oracle_connection):
        """Should return empty list for project with no tools."""
        connection, cursor = mock_oracle_connection
        cursor.__iter__ = lambda self: iter([])

        result = manager.get_project_tools('empty-project')

        assert result == []

    def test_get_project_tools_handles_null_counts(self, manager, mock_oracle_connection):
        """Should handle NULL usage counts."""
        connection, cursor = mock_oracle_connection

        tool_data = [
            ('new-tool', 'other', 'New tool', None, None, 'Y', 'npx new'),
        ]
        cursor.__iter__ = lambda self: iter(tool_data)

        result = manager.get_project_tools('test-project')

        assert result[0]['usage_count'] == 0
        assert result[0]['success_count'] == 0


class TestEmbeddingSearch:
    """Tests for embedding-based tool search."""

    @pytest.fixture
    def manager(self, mock_oracle_connection, mock_embedding_model):
        """Create MCP manager with mocked dependencies."""
        connection, cursor = mock_oracle_connection
        from src.mcp.manager import MCPServerManager
        return MCPServerManager(cursor, mock_embedding_model)

    def test_recommend_uses_embeddings(self, manager, mock_oracle_connection, mock_embedding_model):
        """Tool recommendation should use embeddings for search."""
        connection, cursor = mock_oracle_connection
        cursor.__iter__ = lambda self: iter([])

        manager.recommend_tools_for_project(
            project_type='web_app',
            tech_stack=['python'],
            requirements=['api']
        )

        # Embedding model should have been called
        mock_embedding_model.encode.assert_called()

    def test_search_text_combines_inputs(self, manager, mock_oracle_connection, mock_embedding_model):
        """Search text should combine project type, stack, and requirements."""
        connection, cursor = mock_oracle_connection
        cursor.__iter__ = lambda self: iter([])

        manager.recommend_tools_for_project(
            project_type='web_app',
            tech_stack=['python', 'flask'],
            requirements=['api', 'testing']
        )

        # Check that encode was called with combined text
        call_args = mock_embedding_model.encode.call_args
        search_text = call_args[0][0]
        assert 'web_app' in search_text
        assert 'python' in search_text
        assert 'flask' in search_text
        assert 'api' in search_text
        assert 'testing' in search_text
