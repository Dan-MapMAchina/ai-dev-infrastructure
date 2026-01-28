# Claude Code Project Guide - AI Dev Infrastructure

## Project Overview

AI Development Infrastructure is a comprehensive AI-enhanced development environment featuring:
- Intelligent query routing (Ollama → Claude → Oracle)
- Central agent repository with learning capabilities
- MCP server management with automatic tool recommendations
- VS Code extension for seamless IDE integration

## Architecture

### Routing Decision Tree

1. **Ollama (Local)** → Summarization, classification, simple queries
2. **Claude API** → Development tasks, complex reasoning, code generation
3. **Oracle AI** → Database queries, data analysis, SQL generation

### Key Components

| Component | Location | Technology |
|-----------|----------|------------|
| Intelligent Router | `backend/src/router/` | Python |
| Agent Manager | `backend/src/agents/` | Python |
| MCP Manager | `backend/src/mcp/` | Python |
| Cache Layer | `backend/src/cache/` | Python + Redis |
| Flask API | `backend/src/api/` | Python Flask |
| Database | `database/schema/` | Oracle 26ai SQL |
| VS Code Extension | `vscode-extension/` | TypeScript |

## Development Workflow

### Running Locally

```bash
# Start infrastructure
docker compose -f docker/docker-compose.yml up -d

# Start backend
cd backend && python -m src.api.app

# Compile extension
cd vscode-extension && npm run watch
```

### Testing

```bash
# Backend tests
cd backend && pytest

# Extension tests
cd vscode-extension && npm test
```

## Key Files

| Purpose | Location |
|---------|----------|
| Router Logic | `backend/src/router/intelligent_router.py` |
| Agent Definitions | `database/seeds/default_agents.sql` |
| MCP Registry | `database/seeds/mcp_servers.sql` |
| API Endpoints | `backend/src/api/app.py` |
| Extension Entry | `vscode-extension/src/extension.ts` |
| Docker Compose | `docker/docker-compose.yml` |

## Database Schema

### Core Tables

- `agent_repository` - Agent definitions with embeddings
- `agent_execution_history` - Task execution records
- `agent_learning_checkpoints` - Learning snapshots
- `mcp_server_registry` - Available MCP servers
- `project_tool_stack` - Tools configured per project
- `project_scope_history` - Scope tracking for tool reviews
- `routing_logs` - Query routing decisions

### Vector Indexes

All embedding columns use Oracle AI vector indexes with EUCLIDEAN distance for similarity search.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/route-query` | Classify query and determine route |
| POST | `/execute-task` | Execute task with agent selection |
| GET | `/agents` | List all agents |
| GET | `/agents/:id` | Get agent details |
| GET | `/projects/:id/tools` | Get project tool stack |
| GET | `/metrics/routing` | Routing distribution metrics |

## Implementation Phases

1. **Phase 1** (Weeks 1-4): Core infrastructure, database, router
2. **Phase 2** (Weeks 5-7): VS Code extension
3. **Phase 3** (Weeks 8-9): MCP management, scope detection
4. **Phase 4** (Weeks 10-11): Performance optimizations
5. **Phase 5** (Weeks 12-14): ML routing, multi-agent collaboration
6. **Phase 6** (Weeks 15-16): Enterprise features (RBAC, compliance)

## Common Tasks

### Add New Agent Type

1. Add agent definition to `database/seeds/default_agents.sql`
2. Generate embedding for agent purpose
3. Configure tools and model settings
4. Test with sample queries

### Add New MCP Server

1. Add server to `database/seeds/mcp_servers.sql`
2. Generate capability embedding
3. Define use cases for scope matching
4. Test recommendation algorithm

### Modify Routing Logic

1. Edit `backend/src/router/intelligent_router.py`
2. Update keyword lists or ML model
3. Run routing tests
4. Monitor routing_logs for accuracy

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...      # Required
ORACLE_USER=aidev                  # Database user
ORACLE_PASSWORD=AiDev123           # Database password
ORACLE_DSN=localhost:1521/FREEPDB1 # Database DSN
OLLAMA_HOST=http://localhost:11434 # Ollama endpoint
DAILY_TOKEN_BUDGET=1000000         # Optional budget
ENABLE_STREAMING=true              # Optional streaming
```
