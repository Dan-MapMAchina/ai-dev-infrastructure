# API Reference

Base URL: `http://localhost:5000`

## Health Check

### GET /health

Check service health.

**Response:**
```json
{
  "status": "healthy",
  "service": "ai-dev-backend"
}
```

---

## Query Routing

### POST /route-query

Classify a query and determine optimal route.

**Request:**
```json
{
  "query": "Refactor this function to use async/await"
}
```

**Response:**
```json
{
  "route": "claude",
  "query": "Refactor this function to use async/await"
}
```

**Route Values:**
- `ollama` - Simple tasks (summarize, classify, define)
- `claude` - Complex tasks (refactor, architect, debug)
- `oracle` - Database tasks (SQL, data analysis)

---

## Task Execution

### POST /execute-task

Execute a task with automatic agent selection.

**Request:**
```json
{
  "task": "Review this code for security vulnerabilities",
  "project_id": "my-project",
  "agent_type": "code_review",
  "use_tools": true
}
```

**Response:**
```json
{
  "route": "claude",
  "agent": "Code Review Specialist",
  "agent_type": "code_review",
  "result": "I've reviewed the code and found the following issues...",
  "metrics": {
    "tokens": 1523,
    "time_ms": 2341
  }
}
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| task | string | Yes | Task description |
| project_id | string | No | Project identifier |
| agent_type | string | No | Filter to specific agent type |
| use_tools | boolean | No | Enable Claude tools (default: true) |

---

## Agent Management

### GET /agents

List all available agents.

**Response:**
```json
{
  "agents": [
    {
      "id": 1,
      "name": "Code Review Specialist",
      "type": "code_review",
      "purpose": "Deep code review focusing on security...",
      "success_rate": 0.88,
      "tasks_completed": 127,
      "last_used": "2026-01-27T10:30:00Z"
    }
  ]
}
```

### GET /agents/:id

Get detailed agent information including learning history.

**Response:**
```json
{
  "id": 1,
  "name": "Code Review Specialist",
  "type": "code_review",
  "purpose": "Deep code review focusing on security, performance, and best practices",
  "system_prompt": "You are an expert code reviewer...",
  "success_rate": 0.88,
  "tasks_completed": 127,
  "avg_execution_time_ms": 2100,
  "learned_patterns": {
    "common_issues": ["missing error handling", "sql injection"]
  },
  "last_used": "2026-01-27T10:30:00Z",
  "checkpoints": [
    {
      "version": 12,
      "performance": {"success_rate": 0.88, "avg_time": 2100},
      "improvement": 5.2,
      "created_at": "2026-01-25T00:00:00Z"
    }
  ]
}
```

### POST /agents

Create a new agent.

**Request:**
```json
{
  "name": "API Security Specialist",
  "type": "security",
  "purpose": "Review API endpoints for security vulnerabilities",
  "system_prompt": "You are an API security expert...",
  "tools_enabled": ["bash", "text_editor"],
  "model_config": {
    "model": "claude-sonnet-4-20250514",
    "temperature": 0.3
  }
}
```

**Response:**
```json
{
  "id": 6,
  "name": "API Security Specialist",
  "message": "Agent created successfully"
}
```

---

## Project Management

### GET /projects/:id/tools

Get tools configured for a project.

**Response:**
```json
{
  "project_id": "my-project",
  "tools": [
    {
      "name": "filesystem",
      "type": "mcp_server",
      "description": "Access and manipulate files...",
      "usage_count": 45,
      "is_active": true
    },
    {
      "name": "github",
      "type": "mcp_server",
      "description": "GitHub repository management...",
      "usage_count": 23,
      "is_active": true
    }
  ]
}
```

### POST /projects/:id/scope

Initialize or update project scope.

**Request:**
```json
{
  "description": "E-commerce platform with React and Node.js",
  "requirements": ["user auth", "payment processing", "admin dashboard"],
  "technical_stack": {
    "frontend": "React 18, TypeScript",
    "backend": "Node.js, Express",
    "database": "PostgreSQL"
  }
}
```

**Response:**
```json
{
  "scope_id": 1,
  "version": 1,
  "recommended_tools": [
    {"name": "filesystem", "reason": "Essential for code management"},
    {"name": "github", "reason": "Essential for version control"},
    {"name": "postgresql", "reason": "Direct database access"}
  ],
  "assigned_agents": [
    {"name": "Code Review Specialist", "role": "security_reviewer"}
  ]
}
```

### POST /projects/:id/scope/check

Check for scope changes and get tool review status.

**Request:**
```json
{
  "new_description": "E-commerce platform with mobile app support",
  "new_requirements": ["user auth", "payment processing", "mobile app"]
}
```

**Response:**
```json
{
  "changed": true,
  "magnitude": "major",
  "requires_tool_review": true,
  "similarity_score": 0.72,
  "analysis": "Significant expansion to include mobile development..."
}
```

---

## MCP Server Management

### GET /mcp/servers

List all registered MCP servers.

**Response:**
```json
{
  "servers": [
    {
      "id": 1,
      "name": "filesystem",
      "type": "filesystem",
      "description": "Access and manipulate files...",
      "capabilities": {
        "actions": ["read_file", "write_file", "list_directory"],
        "use_cases": ["file management", "code navigation"]
      },
      "install_command": "npx -y @modelcontextprotocol/server-filesystem",
      "reliability_score": 1.0,
      "success_rate": 0.98
    }
  ]
}
```

### POST /mcp/recommend

Get MCP server recommendations for a project.

**Request:**
```json
{
  "project_scope": "Full-stack web application with PostgreSQL",
  "requirements": ["database queries", "file editing", "git operations"]
}
```

**Response:**
```json
{
  "essential": [
    {"name": "filesystem", "reason": "File operations required"},
    {"name": "postgresql", "reason": "Database access needed"},
    {"name": "github", "reason": "Version control required"}
  ],
  "recommended": [
    {"name": "memory", "reason": "Context persistence helpful"}
  ],
  "confidence": 0.87
}
```

---

## Metrics

### GET /metrics/routing

Get routing distribution metrics.

**Response:**
```json
{
  "metrics": [
    {
      "route": "ollama",
      "count": 57,
      "avg_time_ms": 450,
      "first_query": "2026-01-20T08:00:00Z",
      "last_query": "2026-01-27T10:30:00Z"
    },
    {
      "route": "claude",
      "count": 66,
      "avg_time_ms": 2100,
      "first_query": "2026-01-20T08:15:00Z",
      "last_query": "2026-01-27T10:28:00Z"
    }
  ],
  "period": "7 days"
}
```

### GET /metrics/agents

Get agent performance metrics.

**Response:**
```json
{
  "agents": [
    {
      "id": 1,
      "name": "Code Review Specialist",
      "success_rate": 0.88,
      "total_tasks": 127,
      "avg_time_ms": 2100,
      "cost_total_usd": 12.34
    }
  ]
}
```

### GET /metrics/costs

Get cost breakdown for a period.

**Query Parameters:**
- `start_date` - Start date (ISO 8601)
- `end_date` - End date (ISO 8601)

**Response:**
```json
{
  "period": {
    "start": "2026-01-01",
    "end": "2026-01-27"
  },
  "total_cost_usd": 45.67,
  "breakdown": {
    "claude": 42.30,
    "ollama": 0.00,
    "oracle": 3.37
  },
  "daily_average": 1.69
}
```

---

## Streaming

### POST /stream-query

Stream a Claude response in real-time.

**Request:**
```json
{
  "query": "Write a REST API for user management",
  "agent_id": 1,
  "project_id": "my-api"
}
```

**Response:** Server-Sent Events stream

```
data: {"type": "chunk", "content": "I'll "}
data: {"type": "chunk", "content": "create "}
data: {"type": "chunk", "content": "a REST API..."}
data: {"type": "complete", "total_tokens": 1523, "cost": 0.0046}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

**Common Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| NOT_FOUND | 404 | Resource not found |
| INVALID_REQUEST | 400 | Invalid request parameters |
| AGENT_NOT_FOUND | 404 | No suitable agent found |
| BUDGET_EXCEEDED | 429 | Token budget exceeded |
| INTERNAL_ERROR | 500 | Internal server error |
