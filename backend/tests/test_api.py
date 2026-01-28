"""
Tests for Flask API endpoints.
"""

import json
import pytest
from unittest.mock import MagicMock, patch


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    def test_health_check_returns_healthy(self, client):
        """Health check should return healthy status."""
        response = client.get('/health')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['status'] == 'healthy'
        assert data['service'] == 'ai-dev-backend'
        assert 'mode' in data

    def test_health_check_lite_mode(self, client_lite_mode):
        """Health check in lite mode should indicate mode."""
        response = client_lite_mode.get('/health')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['status'] == 'healthy'
        assert data['mode'] == 'lite'


class TestRouteQueryEndpoint:
    """Tests for /route-query endpoint."""

    def test_route_simple_query_to_ollama(self, client_lite_mode):
        """Simple queries should route to Ollama."""
        response = client_lite_mode.post('/route-query',
            data=json.dumps({'query': 'What is a Python list? Explain simply.'}),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['route'] == 'ollama'

    def test_route_complex_query_to_claude(self, client_lite_mode):
        """Complex development queries should route to Claude."""
        response = client_lite_mode.post('/route-query',
            data=json.dumps({'query': 'Review code and refactor the authentication module'}),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['route'] == 'claude'

    def test_route_empty_query(self, client_lite_mode):
        """Empty query should still return a route."""
        response = client_lite_mode.post('/route-query',
            data=json.dumps({'query': ''}),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert 'route' in data

    def test_route_missing_query(self, client_lite_mode):
        """Missing query should use empty string."""
        response = client_lite_mode.post('/route-query',
            data=json.dumps({}),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['query'] == ''


class TestExecuteTaskEndpoint:
    """Tests for /execute-task endpoint."""

    def test_execute_task_lite_mode_with_claude(self, mocker, app_lite_mode):
        """Execute task in lite mode should use Claude API if available."""
        # Mock Claude client
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="Mock code review response")]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=200)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response

        # Set the claude_client in the app module
        original_client = app_lite_mode.claude_client
        app_lite_mode.claude_client = mock_client

        client = app_lite_mode.app.test_client()

        try:
            response = client.post('/execute-task',
                data=json.dumps({
                    'task': 'Review this code for security issues',
                    'agent_type': 'code_review'
                }),
                content_type='application/json'
            )
            assert response.status_code == 200

            data = json.loads(response.data)
            assert data['route'] == 'claude'
            assert data['result'] == 'Mock code review response'
            assert data['lite_mode'] is True
            assert 'metrics' in data
        finally:
            app_lite_mode.claude_client = original_client

    def test_execute_task_lite_mode_no_api_key(self, app_lite_mode):
        """Execute task without API key should return placeholder."""
        original_client = app_lite_mode.claude_client
        app_lite_mode.claude_client = None

        client = app_lite_mode.app.test_client()

        try:
            response = client.post('/execute-task',
                data=json.dumps({
                    'task': 'Review this code',
                    'agent_type': 'code_review'
                }),
                content_type='application/json'
            )
            assert response.status_code == 200

            data = json.loads(response.data)
            assert data['lite_mode'] is True
            assert 'Set ANTHROPIC_API_KEY' in data['result']
        finally:
            app_lite_mode.claude_client = original_client

    def test_execute_task_selects_correct_agent(self, app_lite_mode):
        """Task should select appropriate agent based on keywords."""
        app_lite_mode.claude_client = None
        client = app_lite_mode.app.test_client()

        response = client.post('/execute-task',
            data=json.dumps({
                'task': 'Fix the bug in the login function',
            }),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['agent_type'] == 'debugging'

    def test_execute_task_with_agent_type_override(self, app_lite_mode):
        """Agent type parameter should override keyword detection."""
        app_lite_mode.claude_client = None
        client = app_lite_mode.app.test_client()

        response = client.post('/execute-task',
            data=json.dumps({
                'task': 'Fix the bug',
                'agent_type': 'refactoring'
            }),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['agent_type'] == 'refactoring'


class TestAgentsEndpoint:
    """Tests for /agents endpoints."""

    def test_list_agents_lite_mode(self, client_lite_mode):
        """List agents in lite mode returns default agents."""
        response = client_lite_mode.get('/agents')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert 'agents' in data
        assert data.get('lite_mode') is True
        assert len(data['agents']) >= 5  # Should have default agents

        # Verify agent structure
        agent = data['agents'][0]
        assert 'id' in agent
        assert 'name' in agent
        assert 'type' in agent
        assert 'success_rate' in agent

    def test_get_agent_by_id_lite_mode(self, client_lite_mode):
        """Get specific agent by ID in lite mode."""
        response = client_lite_mode.get('/agents/1')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['id'] == 1
        assert data['name'] == 'Code Review Specialist'
        assert data.get('lite_mode') is True

    def test_get_agent_not_found(self, client_lite_mode):
        """Get non-existent agent returns 404."""
        response = client_lite_mode.get('/agents/999')
        assert response.status_code == 404

        data = json.loads(response.data)
        assert 'error' in data


class TestProjectToolsEndpoint:
    """Tests for /projects/<id>/tools endpoint."""

    def test_get_project_tools_lite_mode(self, client_lite_mode):
        """Get project tools in lite mode returns defaults."""
        response = client_lite_mode.get('/projects/test-project/tools')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['project_id'] == 'test-project'
        assert 'tools' in data
        assert data.get('lite_mode') is True

        # Should have filesystem and github by default
        tool_names = [t['name'] for t in data['tools']]
        assert 'filesystem' in tool_names
        assert 'github' in tool_names


class TestProjectScopeEndpoint:
    """Tests for /projects/<id>/scope endpoint."""

    def test_set_project_scope(self, client_lite_mode):
        """Set project scope returns recommendations."""
        response = client_lite_mode.post('/projects/test-project/scope',
            data=json.dumps({
                'description': 'A Python Flask web application',
                'requirements': ['testing', 'code review'],
                'technical_stack': {
                    'technologies': ['python', 'flask', 'postgresql']
                }
            }),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert 'recommended_tools' in data
        assert 'assigned_agents' in data

        # Should recommend postgresql for postgres stack
        tool_names = [t['name'] for t in data['recommended_tools']]
        assert 'postgresql' in tool_names

    def test_check_scope_change(self, client_lite_mode):
        """Check scope change indicates review needed."""
        response = client_lite_mode.post('/projects/test-project/scope/check',
            data=json.dumps({}),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['changed'] is True
        assert data['requires_tool_review'] is True


class TestMCPRecommendEndpoint:
    """Tests for /mcp/recommend endpoint."""

    def test_recommend_mcp_tools(self, client_lite_mode):
        """MCP recommendation returns essential and recommended tools."""
        response = client_lite_mode.post('/mcp/recommend',
            data=json.dumps({
                'project_scope': 'Web application with database',
                'requirements': ['database access', 'testing']
            }),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        assert 'essential' in data
        assert 'recommended' in data
        assert data['confidence'] > 0

        # Should have filesystem and github as essential
        essential_names = [t['name'] for t in data['essential']]
        assert 'filesystem' in essential_names
        assert 'github' in essential_names

    def test_recommend_database_tools(self, client_lite_mode):
        """Database projects should get postgresql recommended."""
        response = client_lite_mode.post('/mcp/recommend',
            data=json.dumps({
                'project_scope': 'PostgreSQL database application',
                'requirements': ['sql queries']
            }),
            content_type='application/json'
        )
        assert response.status_code == 200

        data = json.loads(response.data)
        essential_names = [t['name'] for t in data['essential']]
        assert 'postgresql' in essential_names


class TestMetricsEndpoints:
    """Tests for /metrics/* endpoints."""

    def test_routing_metrics_lite_mode(self, client_lite_mode):
        """Routing metrics in lite mode returns empty data."""
        response = client_lite_mode.get('/metrics/routing')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert 'metrics' in data
        assert data.get('lite_mode') is True

    def test_agent_metrics_lite_mode(self, client_lite_mode):
        """Agent metrics in lite mode returns default agent stats."""
        response = client_lite_mode.get('/metrics/agents')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert 'agents' in data


class TestErrorHandling:
    """Tests for error handling in API endpoints."""

    def test_invalid_json(self, client_lite_mode):
        """Invalid JSON should be handled gracefully."""
        response = client_lite_mode.post('/route-query',
            data='not valid json',
            content_type='application/json'
        )
        # Flask returns 400 for invalid JSON
        assert response.status_code in [400, 200]

    def test_missing_content_type(self, client_lite_mode):
        """Missing content type should still work with defaults."""
        response = client_lite_mode.post('/route-query',
            data=json.dumps({'query': 'test'}),
        )
        # Should work or return appropriate error
        assert response.status_code in [200, 400, 415]

    def test_execute_task_api_error(self, mocker, app_lite_mode):
        """API errors should return 500 with error message."""
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("API rate limit")

        original_client = app_lite_mode.claude_client
        app_lite_mode.claude_client = mock_client

        client = app_lite_mode.app.test_client()

        try:
            response = client.post('/execute-task',
                data=json.dumps({'task': 'Test task'}),
                content_type='application/json'
            )
            assert response.status_code == 500

            data = json.loads(response.data)
            assert 'error' in data
        finally:
            app_lite_mode.claude_client = original_client
