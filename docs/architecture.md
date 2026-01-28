# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI DEVELOPMENT INFRASTRUCTURE                     │
└─────────────────────────────────────────────────────────────────────┘

USER INTERFACE                      │  BACKEND SERVICES
                                   │
┌──────────────────┐               │  ┌──────────────────┐
│   VS Code        │               │  │   Flask API      │
│   Extension      │──────────────▶│  │  (Port 5000)     │
└──────────────────┘               │  └────────┬─────────┘
                                   │           │
                                   │           ▼
                                   │  ┌──────────────────┐
                                   │  │ Intelligent      │
                                   │  │ Router           │
                                   │  └────────┬─────────┘
                                   │    ┌──────┼──────┐
                                   │    ▼      ▼      ▼
                                   │  ┌────┐ ┌────┐ ┌────┐
                                   │  │Olla│ │Clau│ │Orac│
                                   │  │ma  │ │de  │ │le  │
                                   │  └────┘ └────┘ └────┘
                                   │           │
                                   │           ▼
                                   │  ┌──────────────────┐
                                   │  │ Agent Repository │
                                   │  │ (Oracle 26ai)    │
                                   │  └──────────────────┘
```

## Component Details

### 1. Intelligent Router

The router classifies queries and routes them to the optimal AI system.

**Routing Logic:**

| Query Type | Route | Examples |
|------------|-------|----------|
| Simple | Ollama | Summarize, classify, define, translate |
| Complex | Claude | Refactor, architect, implement, debug |
| Database | Oracle AI | SQL queries, data analysis, schema design |

**Classification Algorithm:**

```python
def classify_query_complexity(self, query: str) -> str:
    query_lower = query.lower()

    # Check for Oracle AI tasks
    if any(kw in query_lower for kw in ['sql', 'database', 'query']):
        return 'oracle'

    # Check for complex tasks (Claude)
    if any(kw in query_lower for kw in ['refactor', 'architect', 'debug']):
        return 'claude'

    # Simple tasks go to Ollama
    if any(kw in query_lower for kw in ['summarize', 'classify', 'what is']):
        return 'ollama'

    return 'claude'  # Default
```

### 2. Agent Repository

Central storage for AI agent definitions with learning capabilities.

**Database Schema:**

```sql
agent_repository
├── id (PK)
├── agent_name (UNIQUE)
├── agent_type (code_review, refactoring, testing, etc.)
├── agent_purpose (CLOB)
├── system_prompt (CLOB)
├── tools_enabled (JSON)
├── agent_embedding (VECTOR 1024)
├── total_tasks_completed
├── success_rate
├── average_execution_time_ms
├── learned_patterns (JSON)
└── model_config (JSON)
```

**Pre-built Agents:**

| Agent | Type | Purpose |
|-------|------|---------|
| Code Review Specialist | code_review | Security, performance, best practices |
| Refactoring Specialist | refactoring | SOLID principles, reduce complexity |
| Test Engineer | testing | Unit tests, integration tests, coverage |
| Software Architect | architecture | System design, technology decisions |
| Bug Detection Specialist | debugging | Root cause analysis, targeted fixes |

### 3. MCP Server Registry

Manages Model Context Protocol servers for extended capabilities.

**Available Servers:**

| Server | Type | Capabilities |
|--------|------|--------------|
| filesystem | filesystem | Read, write, search files |
| github | git | Repos, issues, PRs, actions |
| postgresql | database | SQL queries, schema management |
| memory | knowledge_base | Persistent context, knowledge graphs |
| puppeteer | browser | Web scraping, testing |
| slack | communication | Team messaging, notifications |

**Tool Recommendation:**

The system analyzes project scope and recommends optimal tools using vector similarity:

```python
def recommend_tools_for_project(self, project_scope, requirements):
    # Generate embedding from scope
    scope_embedding = self.encode(scope_text)

    # Find similar MCP servers by capability
    self.cursor.execute("""
        SELECT server_name, capabilities
        FROM mcp_server_registry
        ORDER BY VECTOR_DISTANCE(capability_embedding, :1, EUCLIDEAN)
        FETCH FIRST 10 ROWS ONLY
    """, [scope_embedding])
```

### 4. Learning System

Agents improve over time through execution tracking and checkpoints.

**Learning Flow:**

```
Task Execution
     │
     ▼
Record Metrics ──────▶ agent_execution_history
     │
     ▼
Update Agent Stats ──▶ agent_repository.success_rate
     │
     ▼
Check Checkpoint? ───▶ Every 10 tasks
     │
     ▼
Create Snapshot ────▶ agent_learning_checkpoints
```

### 5. Caching Layer

Three-tier intelligent caching for performance:

| Cache | Purpose | TTL |
|-------|---------|-----|
| Response Cache | Identical queries | 1 hour |
| Embedding Cache | Vector embeddings | LRU eviction |
| Agent Selection Cache | Agent choices | 2 hours |

**Expected Impact:**
- 60-80% reduction in API calls
- 90% faster cached responses
- $500-1000/month savings

### 6. VS Code Extension

IDE integration for seamless AI assistance.

**Commands:**

| Command | Shortcut | Action |
|---------|----------|--------|
| AI Chat | Ctrl+Shift+A | Open intelligent chat |
| Code Review | Ctrl+Shift+R | Review selection |
| Generate Tests | Ctrl+Shift+T | Create test suite |
| Refactor | Ctrl+Shift+F | Improve structure |

**Project Initialization:**

1. User runs "Initialize AI-Enhanced Project"
2. Extension gathers project info (name, type, stack)
3. Backend recommends tools and agents
4. Extension creates `.claude.md` and `.agents.json`
5. MCP servers configured automatically

## Data Flow

### Query Execution

```
1. User sends query via VS Code
2. Extension calls /execute-task API
3. Router classifies query complexity
4. Router finds best agent for task
5. Query executed via Ollama/Claude/Oracle
6. Response cached for future use
7. Execution recorded for learning
8. Response returned to VS Code
```

### Agent Selection

```
1. Generate embedding for task description
2. Query agent_repository with vector similarity
3. Filter by agent_type if specified
4. Sort by success_rate DESC, distance ASC
5. Return best matching agent
6. Record assignment to project
```

### Scope Change Detection

```
1. User updates project requirements
2. System compares old vs new scope embeddings
3. Calculate cosine similarity
4. If similarity < 0.85, trigger tool review
5. Recommend new tools, flag obsolete ones
6. Record scope version and changes
```

## Security Considerations

- **API Keys**: Stored in environment variables, never in code
- **Database**: Encrypted connections, parameterized queries
- **Audit Trail**: All queries logged with hashes for compliance
- **PII Detection**: Automatic scanning before processing
- **RBAC**: Role-based limits on agents and budgets

## Performance Targets

| Metric | Target |
|--------|--------|
| API Response (cached) | <100ms |
| API Response (new) | <3s |
| Cache Hit Rate | >60% |
| Routing Accuracy | >85% |
| Agent Success Rate | >80% |
