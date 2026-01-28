"""
Flask API Service for AI Development Infrastructure
Supports both full mode (with Oracle DB) and lite mode (without DB)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import time
import uuid
from pathlib import Path
from dotenv import load_dotenv

# Load .env from config directory
config_dir = Path(__file__).resolve().parent.parent.parent.parent / 'config'
env_file = config_dir / '.env'
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv()

app = Flask(__name__)
CORS(app)

# Global state
router = None
lite_mode = False
claude_client = None  # For lite mode with API key

# Default agents for lite mode
DEFAULT_AGENTS = [
    {
        'id': 1,
        'name': 'Code Review Specialist',
        'type': 'code_review',
        'purpose': 'Deep code review focusing on security, performance, and best practices',
        'system_prompt': 'You are an expert code reviewer. Analyze code for security vulnerabilities, performance issues, and best practice violations.',
        'success_rate': 0.88,
        'tasks_completed': 0
    },
    {
        'id': 2,
        'name': 'Refactoring Specialist',
        'type': 'refactoring',
        'purpose': 'Transform messy code into clean, maintainable architecture',
        'system_prompt': 'You are a refactoring expert. Apply SOLID principles, reduce complexity, and improve code structure.',
        'success_rate': 0.91,
        'tasks_completed': 0
    },
    {
        'id': 3,
        'name': 'Test Engineer',
        'type': 'testing',
        'purpose': 'Generate comprehensive test suites for maximum coverage',
        'system_prompt': 'You are a test automation expert. Write unit tests, integration tests, and identify edge cases.',
        'success_rate': 0.86,
        'tasks_completed': 0
    },
    {
        'id': 4,
        'name': 'Software Architect',
        'type': 'architecture',
        'purpose': 'Design scalable system architectures and make strategic decisions',
        'system_prompt': 'You are a software architect. Provide system design recommendations and technology advice.',
        'success_rate': 0.92,
        'tasks_completed': 0
    },
    {
        'id': 5,
        'name': 'Bug Detection Specialist',
        'type': 'debugging',
        'purpose': 'Find and fix bugs with root cause analysis',
        'system_prompt': 'You are a debugging expert. Identify root causes and suggest targeted fixes.',
        'success_rate': 0.85,
        'tasks_completed': 0
    },
    {
        'id': 6,
        'name': 'Code Generation Specialist',
        'type': 'code_generation',
        'purpose': 'Generate clean, well-documented code from requirements and descriptions',
        'system_prompt': '''You are an expert code generator. When given a task:
1. Generate clean, idiomatic code for the target language
2. Include appropriate comments and documentation
3. Add error handling where appropriate
4. Use type hints/annotations when applicable
5. Match the coding style of surrounding context if provided

Return ONLY the code without markdown code blocks unless specifically requested.
Consider the surrounding context to match existing coding patterns and style.''',
        'success_rate': 0.90,
        'tasks_completed': 0
    },
    {
        'id': 7,
        'name': 'DevOps Specialist',
        'type': 'devops',
        'purpose': 'Generate Docker, CI/CD, and deployment configurations for projects',
        'system_prompt': '''You are a DevOps expert. When generating configurations:
1. Follow best practices for security (non-root users, minimal images)
2. Optimize for build speed and caching
3. Include proper error handling and health checks
4. Use specific version tags, not 'latest'
5. Consider multi-stage builds for smaller images
6. Include proper environment variable handling

Generate production-ready configurations that are secure and efficient.''',
        'success_rate': 0.88,
        'tasks_completed': 0
    }
]

# Routing keywords
SIMPLE_KEYWORDS = [
    'summarize', 'summary', 'tldr', 'brief', 'short',
    'classify', 'category', 'what is', 'define', 'explain simply',
    'translate', 'extract', 'convert', 'format', 'list'
]

COMPLEX_KEYWORDS = [
    'develop', 'build', 'create', 'implement', 'refactor',
    'architect', 'design', 'analyze', 'debug', 'optimize',
    'review code', 'write code', 'fix bug', 'improve'
]


def init_router():
    """Try to initialize the full router, fall back to lite mode"""
    global router, lite_mode, claude_client

    try:
        from ..router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter()
        lite_mode = False
        print("✓ Full mode: Connected to Oracle database")
    except Exception as e:
        router = None
        lite_mode = True
        print(f"⚠ Lite mode: Database unavailable ({type(e).__name__})")

        # Try to initialize Claude client for lite mode
        api_key = os.getenv('ANTHROPIC_API_KEY')
        if api_key:
            try:
                import anthropic
                claude_client = anthropic.Anthropic(api_key=api_key)
                print("✓ Lite mode: Claude API available")
            except Exception as api_err:
                print(f"⚠ Lite mode: Claude API unavailable ({type(api_err).__name__})")


def classify_query(query: str) -> str:
    """Classify query complexity for routing"""
    query_lower = query.lower()

    # Check for complex tasks
    complex_score = sum(1 for kw in COMPLEX_KEYWORDS if kw in query_lower)
    if complex_score >= 1:
        return 'claude'

    # Check for simple tasks
    simple_score = sum(1 for kw in SIMPLE_KEYWORDS if kw in query_lower)
    if simple_score >= 1:
        return 'ollama'

    # Default based on length
    if len(query.split()) < 15:
        return 'ollama'

    return 'claude'


def find_agent_for_task(task: str, agent_type: str = None) -> dict:
    """Find best agent for a task.

    Returns agent dict with 'agent_id' key for compatibility with router output.
    """
    task_lower = task.lower()
    agent = None

    # Match by type if specified
    if agent_type:
        for a in DEFAULT_AGENTS:
            if a['type'] == agent_type:
                agent = a
                break

    # Match by keywords if not found by type
    if not agent:
        if any(kw in task_lower for kw in ['review', 'security', 'vulnerability']):
            agent = DEFAULT_AGENTS[0]  # Code Review
        elif any(kw in task_lower for kw in ['refactor', 'clean', 'improve structure']):
            agent = DEFAULT_AGENTS[1]  # Refactoring
        elif any(kw in task_lower for kw in ['test', 'coverage', 'unit test']):
            agent = DEFAULT_AGENTS[2]  # Testing
        elif any(kw in task_lower for kw in ['architect', 'design', 'scale']):
            agent = DEFAULT_AGENTS[3]  # Architecture
        elif any(kw in task_lower for kw in ['bug', 'debug', 'fix', 'error']):
            agent = DEFAULT_AGENTS[4]  # Debugging
        else:
            # Default to code review
            agent = DEFAULT_AGENTS[0]

    # Return agent with 'agent_id' key for compatibility with router output
    return {
        'agent_id': agent['id'],
        'name': agent['name'],
        'type': agent['type'],
        'system_prompt': agent['system_prompt'],
        'success_rate': agent['success_rate'],
        'tasks_completed': agent['tasks_completed']
    }


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'ai-dev-backend',
        'mode': 'lite' if lite_mode else 'full'
    })


@app.route('/route-query', methods=['POST'])
def route_query():
    """Classify and route a query"""
    data = request.json or {}
    query = data.get('query', '')

    if not lite_mode and router:
        route = router.classify_query_complexity(query)
    else:
        route = classify_query(query)

    return jsonify({
        'route': route,
        'query': query
    })


@app.route('/execute-task', methods=['POST'])
def execute_task():
    """Execute task with automatic agent selection"""
    data = request.json or {}
    task = data.get('task', '')
    project_id = data.get('project_id')
    agent_type = data.get('agent_type')
    use_tools = data.get('use_tools', True)

    start_time = time.time()

    # Classify query
    if not lite_mode and router:
        route = router.classify_query_complexity(task)
    else:
        route = classify_query(task)

    # For lite mode or Ollama routing
    if lite_mode or route == 'ollama':
        agent = find_agent_for_task(task, agent_type)
        execution_time = int((time.time() - start_time) * 1000)

        # In lite mode, try to use Claude API if available
        if lite_mode:
            if claude_client:
                try:
                    # Use Claude API directly in lite mode
                    system_prompt = agent.get('system_prompt', 'You are an expert software development assistant.')
                    response = claude_client.messages.create(
                        model="claude-sonnet-4-20250514",
                        max_tokens=8000,
                        system=system_prompt,
                        messages=[{"role": "user", "content": task}]
                    )

                    response_text = ""
                    for block in response.content:
                        if hasattr(block, 'text'):
                            response_text += block.text

                    return jsonify({
                        'route': 'claude',
                        'agent': agent['name'],
                        'agent_type': agent['type'],
                        'result': response_text,
                        'metrics': {
                            'tokens': response.usage.input_tokens + response.usage.output_tokens,
                            'time_ms': int((time.time() - start_time) * 1000)
                        },
                        'lite_mode': True
                    })
                except Exception as e:
                    return jsonify({
                        'route': 'claude',
                        'agent': agent['name'],
                        'agent_type': agent['type'],
                        'result': f"Claude API error: {str(e)}",
                        'error': str(e),
                        'metrics': {
                            'tokens': 0,
                            'time_ms': int((time.time() - start_time) * 1000)
                        },
                        'lite_mode': True
                    }), 500

            # No Claude client available
            return jsonify({
                'route': route,
                'agent': agent['name'],
                'agent_type': agent['type'],
                'result': f"[Lite Mode] Task received: '{task[:100]}...'\n\n"
                         f"Agent '{agent['name']}' would process this task.\n"
                         f"Set ANTHROPIC_API_KEY for AI-powered responses.",
                'metrics': {
                    'tokens': 0,
                    'time_ms': execution_time
                },
                'lite_mode': True
            })

        # Try Ollama
        try:
            result = router.query_ollama(task)
            return jsonify({
                'route': 'ollama',
                'result': result,
                'agent': None,
                'metrics': {
                    'tokens': 0,
                    'time_ms': int((time.time() - start_time) * 1000)
                }
            })
        except Exception as e:
            return jsonify({
                'route': 'ollama',
                'result': f"Ollama unavailable: {str(e)}",
                'agent': None,
                'error': str(e)
            }), 503

    # Full mode with Claude
    try:
        agent = router.find_best_agent_for_task(task, project_id, agent_type)

        if not agent:
            agent = find_agent_for_task(task, agent_type)

        agent_id = agent.get('agent_id')

        if project_id and agent_id:
            try:
                router.assign_agent_to_project(
                    agent_id,
                    project_id,
                    role=agent_type or 'general',
                    reason='API request'
                )
            except Exception as assign_err:
                # Log but don't fail if assignment fails
                print(f"Warning: Agent assignment failed: {assign_err}")

        result = router.query_claude(
            task,
            agent_id=agent_id,
            project_id=project_id,
            use_tools=use_tools
        )

        # Check for error in result
        if result.get('error'):
            return jsonify({
                'error': result['error'],
                'route': 'claude',
                'agent': agent.get('name'),
                'metrics': {
                    'tokens': 0,
                    'time_ms': result.get('execution_time_ms', 0)
                }
            }), 500

        return jsonify({
            'route': 'claude',
            'agent': agent.get('name'),
            'agent_type': agent.get('type'),
            'result': result.get('response', ''),
            'metrics': {
                'tokens': result.get('tokens_used', 0),
                'time_ms': result.get('execution_time_ms', 0)
            }
        })
    except KeyError as e:
        return jsonify({
            'error': f'Missing required field: {e}',
            'route': 'claude'
        }), 500
    except Exception as e:
        return jsonify({
            'error': str(e),
            'route': 'claude'
        }), 500


@app.route('/agents', methods=['GET'])
def list_agents():
    """List all available agents"""
    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT id, agent_name, agent_type,
                       DBMS_LOB.SUBSTR(agent_purpose, 200, 1) as purpose,
                       success_rate, total_tasks_completed, last_used
                FROM agent_repository
                ORDER BY success_rate DESC NULLS LAST
            """)

            agents = []
            for row in router.cursor:
                agents.append({
                    'id': row[0],
                    'name': row[1],
                    'type': row[2],
                    'purpose': str(row[3]) if row[3] else None,
                    'success_rate': float(row[4]) if row[4] else 0.0,
                    'tasks_completed': row[5] or 0,
                    'last_used': row[6].isoformat() if row[6] else None
                })
            return jsonify({'agents': agents})
        except Exception as e:
            print(f"Error fetching agents: {e}")
            pass

    # Lite mode fallback
    return jsonify({
        'agents': [{
            'id': a['id'],
            'name': a['name'],
            'type': a['type'],
            'purpose': a['purpose'][:200],
            'success_rate': a['success_rate'],
            'tasks_completed': a['tasks_completed'],
            'last_used': None
        } for a in DEFAULT_AGENTS],
        'lite_mode': True
    })


@app.route('/agents/<int:agent_id>', methods=['GET'])
def get_agent(agent_id):
    """Get agent details"""
    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT id, agent_name, agent_type, agent_purpose, system_prompt,
                       success_rate, total_tasks_completed, average_execution_time_ms,
                       learned_patterns, last_used
                FROM agent_repository
                WHERE id = :1
            """, [agent_id])

            row = router.cursor.fetchone()
            if row:
                return jsonify({
                    'id': row[0],
                    'name': row[1],
                    'type': row[2],
                    'purpose': row[3],
                    'system_prompt': row[4],
                    'success_rate': float(row[5]) if row[5] else 0.0,
                    'tasks_completed': row[6] or 0,
                    'avg_execution_time_ms': float(row[7]) if row[7] else None,
                    'learned_patterns': row[8],
                    'last_used': row[9].isoformat() if row[9] else None,
                    'checkpoints': []
                })
        except Exception:
            pass

    # Lite mode fallback
    for agent in DEFAULT_AGENTS:
        if agent['id'] == agent_id:
            return jsonify({
                **agent,
                'avg_execution_time_ms': None,
                'learned_patterns': None,
                'last_used': None,
                'checkpoints': [],
                'lite_mode': True
            })

    return jsonify({'error': 'Agent not found'}), 404


@app.route('/projects/<project_id>/tools', methods=['GET'])
def get_project_tools(project_id):
    """Get tools configured for a project"""
    # Default tools for lite mode
    default_tools = [
        {'name': 'filesystem', 'type': 'mcp_server', 'description': 'File operations', 'usage_count': 0, 'is_active': True},
        {'name': 'github', 'type': 'mcp_server', 'description': 'Git operations', 'usage_count': 0, 'is_active': True}
    ]

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT pts.tool_identifier, pts.tool_type, msr.description,
                       pts.usage_count, pts.is_active
                FROM project_tool_stack pts
                LEFT JOIN mcp_server_registry msr ON pts.tool_identifier = msr.server_name
                WHERE pts.project_id = :1
                ORDER BY pts.usage_count DESC
            """, [project_id])

            tools = []
            for row in router.cursor:
                tools.append({
                    'name': row[0],
                    'type': row[1],
                    'description': row[2],
                    'usage_count': row[3] or 0,
                    'is_active': row[4] == 'Y'
                })

            if tools:
                return jsonify({'project_id': project_id, 'tools': tools})
        except Exception:
            pass

    return jsonify({
        'project_id': project_id,
        'tools': default_tools,
        'lite_mode': True
    })


@app.route('/projects/<project_id>/scope', methods=['POST'])
def set_project_scope(project_id):
    """Set or update project scope"""
    data = request.json or {}

    # In lite mode, just return recommendations based on input
    description = data.get('description', '')
    requirements = data.get('requirements', [])
    tech_stack = data.get('technical_stack', {})

    # Generate recommendations based on tech stack
    recommended_tools = [
        {'name': 'filesystem', 'type': 'filesystem', 'reason': 'File operations', 'essential': True},
        {'name': 'github', 'type': 'git', 'reason': 'Version control', 'essential': True}
    ]

    technologies = tech_stack.get('technologies', [])
    if any('postgres' in t.lower() for t in technologies):
        recommended_tools.append({'name': 'postgresql', 'type': 'database', 'reason': 'Database access', 'essential': True})
    if any('react' in t.lower() or 'vue' in t.lower() for t in technologies):
        recommended_tools.append({'name': 'puppeteer', 'type': 'browser', 'reason': 'Browser testing', 'essential': False})

    recommended_tools.append({'name': 'memory', 'type': 'knowledge_base', 'reason': 'Context persistence', 'essential': False})

    # Assign default agents
    assigned_agents = [
        {'name': 'Code Review Specialist', 'type': 'code_review'},
        {'name': 'Refactoring Specialist', 'type': 'refactoring'}
    ]

    if any('test' in r.lower() for r in requirements):
        assigned_agents.append({'name': 'Test Engineer', 'type': 'testing'})

    return jsonify({
        'scope_id': 1,
        'version': 1,
        'recommended_tools': recommended_tools,
        'assigned_agents': assigned_agents,
        'lite_mode': lite_mode
    })


@app.route('/projects/<project_id>/scope/check', methods=['POST'])
def check_scope_change(project_id):
    """Check for scope changes"""
    data = request.json or {}

    # In lite mode, always indicate changes to trigger tool review
    return jsonify({
        'changed': True,
        'magnitude': 'moderate',
        'requires_tool_review': True,
        'similarity_score': 0.75,
        'analysis': 'Scope analysis requires database connection for full comparison.',
        'lite_mode': lite_mode
    })


@app.route('/mcp/recommend', methods=['POST'])
def recommend_mcp_tools():
    """Get MCP server recommendations"""
    data = request.json or {}
    project_scope = data.get('project_scope', '')
    requirements = data.get('requirements', [])

    essential = [
        {'name': 'filesystem', 'type': 'filesystem', 'reason': 'File operations required'},
        {'name': 'github', 'type': 'git', 'reason': 'Version control required'}
    ]

    recommended = [
        {'name': 'memory', 'type': 'knowledge_base', 'reason': 'Context persistence helpful'}
    ]

    scope_lower = project_scope.lower()
    req_text = ' '.join(requirements).lower()

    if 'database' in scope_lower or 'postgres' in scope_lower or 'sql' in req_text:
        essential.append({'name': 'postgresql', 'type': 'database', 'reason': 'Database access needed'})

    if 'web' in scope_lower or 'frontend' in scope_lower or 'testing' in req_text:
        recommended.append({'name': 'puppeteer', 'type': 'browser', 'reason': 'Browser automation helpful'})

    return jsonify({
        'essential': essential,
        'recommended': recommended,
        'confidence': 0.85,
        'lite_mode': lite_mode
    })


@app.route('/metrics/routing', methods=['GET'])
def routing_metrics():
    """Get routing distribution metrics"""
    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT route_decision, COUNT(*) as count,
                       AVG(processing_time_ms) as avg_time,
                       MIN(timestamp) as first_query, MAX(timestamp) as last_query
                FROM routing_logs
                WHERE timestamp > SYSDATE - 7
                GROUP BY route_decision
            """)

            metrics = []
            for row in router.cursor:
                metrics.append({
                    'route': row[0],
                    'count': row[1],
                    'avg_time_ms': float(row[2]) if row[2] else 0,
                    'first_query': row[3].isoformat() if row[3] else None,
                    'last_query': row[4].isoformat() if row[4] else None
                })
            return jsonify({'metrics': metrics, 'period': '7 days'})
        except Exception:
            pass

    # Lite mode fallback
    return jsonify({
        'metrics': [
            {'route': 'ollama', 'count': 0, 'avg_time_ms': 0},
            {'route': 'claude', 'count': 0, 'avg_time_ms': 0}
        ],
        'period': '7 days',
        'lite_mode': True
    })


@app.route('/metrics/agents', methods=['GET'])
def agent_metrics():
    """Get agent performance metrics"""
    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT a.id, a.agent_name, a.success_rate, a.total_tasks_completed,
                       a.average_execution_time_ms,
                       (SELECT SUM(cost_usd) FROM agent_execution_history WHERE agent_id = a.id) as total_cost
                FROM agent_repository a
                WHERE a.total_tasks_completed > 0
                ORDER BY a.success_rate DESC
            """)

            agents = []
            for row in router.cursor:
                agents.append({
                    'id': row[0],
                    'name': row[1],
                    'success_rate': float(row[2]) if row[2] else 0.0,
                    'total_tasks': row[3] or 0,
                    'avg_time_ms': float(row[4]) if row[4] else 0,
                    'cost_total_usd': float(row[5]) if row[5] else 0.0
                })
            return jsonify({'agents': agents})
        except Exception:
            pass

    # Lite mode fallback
    return jsonify({
        'agents': [{
            'id': a['id'],
            'name': a['name'],
            'success_rate': a['success_rate'],
            'total_tasks': a['tasks_completed'],
            'avg_time_ms': 0,
            'cost_total_usd': 0.0
        } for a in DEFAULT_AGENTS],
        'lite_mode': True
    })


# ============================================================================
# CONVERSATION ENDPOINTS (Phase 1)
# ============================================================================

# In-memory storage for lite mode conversations
_conversations: dict = {}  # session_id -> {'name': str, 'project_id': str, 'messages': list}


@app.route('/conversations', methods=['POST'])
def create_conversation():
    """Create a new chat session"""
    data = request.json or {}
    project_id = data.get('project_id', 'default')
    session_name = data.get('session_name', f'Chat {time.strftime("%Y-%m-%d %H:%M")}')

    session_id = str(uuid.uuid4())

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                INSERT INTO conversation_history (session_id, project_id, session_name, created_at)
                VALUES (:1, :2, :3, CURRENT_TIMESTAMP)
            """, [session_id, project_id, session_name])
            router.connection.commit()
        except Exception as e:
            print(f"Failed to create conversation in DB: {e}")

    # Also store in memory for lite mode or as fallback
    _conversations[session_id] = {
        'name': session_name,
        'project_id': project_id,
        'messages': [],
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ')
    }

    return jsonify({
        'id': session_id,
        'name': session_name,
        'project_id': project_id,
        'message_count': 0,
        'created_at': _conversations[session_id]['created_at'],
        'last_updated': _conversations[session_id]['created_at']
    })


@app.route('/conversations/<project_id>', methods=['GET'])
def list_conversations(project_id):
    """List all chat sessions for a project"""
    sessions = []

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT session_id, session_name,
                       COUNT(*) OVER (PARTITION BY session_id) as message_count,
                       MIN(created_at) as created_at,
                       MAX(created_at) as last_updated
                FROM conversation_history
                WHERE project_id = :1
                GROUP BY session_id, session_name
                ORDER BY MAX(created_at) DESC
            """, [project_id])

            for row in router.cursor:
                sessions.append({
                    'id': row[0],
                    'name': row[1] or f'Session {row[0][:8]}',
                    'message_count': row[2] or 0,
                    'created_at': row[3].isoformat() if row[3] else None,
                    'last_updated': row[4].isoformat() if row[4] else None
                })

            if sessions:
                return jsonify({'sessions': sessions})
        except Exception as e:
            print(f"Failed to list conversations: {e}")

    # Lite mode or fallback: return from memory
    for session_id, data in _conversations.items():
        if data['project_id'] == project_id:
            sessions.append({
                'id': session_id,
                'name': data['name'],
                'message_count': len(data['messages']),
                'created_at': data['created_at'],
                'last_updated': data.get('last_updated', data['created_at'])
            })

    return jsonify({'sessions': sessions, 'lite_mode': lite_mode})


@app.route('/conversations/<session_id>/messages', methods=['GET'])
def get_conversation_messages(session_id):
    """Get messages for a chat session"""
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)

    messages = []

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT user_message, assistant_response, context_metadata, created_at
                FROM conversation_history
                WHERE session_id = :1
                ORDER BY created_at ASC
                OFFSET :2 ROWS FETCH NEXT :3 ROWS ONLY
            """, [session_id, offset, limit])

            for row in router.cursor:
                if row[0]:  # user message
                    messages.append({
                        'role': 'user',
                        'content': row[0],
                        'timestamp': row[3].isoformat() if row[3] else None,
                        'metadata': row[2] if row[2] else {}
                    })
                if row[1]:  # assistant response
                    messages.append({
                        'role': 'assistant',
                        'content': row[1],
                        'timestamp': row[3].isoformat() if row[3] else None,
                        'metadata': row[2] if row[2] else {}
                    })

            if messages:
                return jsonify({'messages': messages})
        except Exception as e:
            print(f"Failed to get messages: {e}")

    # Lite mode or fallback
    if session_id in _conversations:
        all_messages = _conversations[session_id]['messages']
        return jsonify({
            'messages': all_messages[offset:offset + limit],
            'lite_mode': lite_mode
        })

    return jsonify({'messages': [], 'lite_mode': lite_mode})


@app.route('/conversations/<session_id>/messages', methods=['POST'])
def add_conversation_message(session_id):
    """Add a message to a chat session"""
    data = request.json or {}
    role = data.get('role', 'user')
    content = data.get('content', '')
    metadata = data.get('metadata', {})

    timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ')

    if not lite_mode and router:
        try:
            if role == 'user':
                router.cursor.execute("""
                    INSERT INTO conversation_history
                    (session_id, user_message, context_metadata, created_at)
                    VALUES (:1, :2, :3, CURRENT_TIMESTAMP)
                """, [session_id, content, str(metadata)])
            else:
                router.cursor.execute("""
                    INSERT INTO conversation_history
                    (session_id, assistant_response, context_metadata, created_at)
                    VALUES (:1, :2, :3, CURRENT_TIMESTAMP)
                """, [session_id, content, str(metadata)])
            router.connection.commit()
        except Exception as e:
            print(f"Failed to add message to DB: {e}")

    # Also store in memory
    if session_id in _conversations:
        _conversations[session_id]['messages'].append({
            'role': role,
            'content': content,
            'timestamp': timestamp,
            'metadata': metadata
        })
        _conversations[session_id]['last_updated'] = timestamp

    return jsonify({
        'message_id': str(uuid.uuid4()),
        'timestamp': timestamp
    })


@app.route('/conversations/<session_id>', methods=['DELETE'])
def delete_conversation(session_id):
    """Delete a chat session"""
    if not lite_mode and router:
        try:
            router.cursor.execute("""
                DELETE FROM conversation_history WHERE session_id = :1
            """, [session_id])
            router.connection.commit()
        except Exception as e:
            print(f"Failed to delete conversation: {e}")

    # Also remove from memory
    if session_id in _conversations:
        del _conversations[session_id]

    return jsonify({'deleted': True})


# ============================================================================
# CODE GENERATION ENDPOINT (Phase 1)
# ============================================================================

@app.route('/generate-code', methods=['POST'])
def generate_code():
    """Generate code based on prompt and context"""
    data = request.json or {}
    prompt = data.get('prompt', '')
    language = data.get('language', 'python')
    context = data.get('context', {})
    project_id = data.get('project_id')
    agent_type = data.get('agent_type', 'code_generation')

    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    start_time = time.time()

    # Find the code generation agent
    agent = find_agent_for_task(prompt, agent_type)

    # Build the full prompt with context
    full_prompt = f"""Generate {language} code for the following request:

{prompt}

"""

    if context.get('surrounding_code'):
        full_prompt += f"""
Context - Surrounding code in the file:
```{language}
{context['surrounding_code']}
```

Match the coding style and patterns from the surrounding code.
"""

    if context.get('file_path'):
        full_prompt += f"\nFile: {context['file_path']}\n"

    full_prompt += """
Requirements:
1. Generate clean, production-ready code
2. Include brief inline comments for complex logic
3. Use appropriate error handling
4. Follow language idioms and best practices

Return ONLY the code, no explanations or markdown code blocks."""

    # Execute with Claude API
    if lite_mode:
        if claude_client:
            try:
                system_prompt = agent.get('system_prompt', 'You are an expert code generator.')
                response = claude_client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=8000,
                    system=system_prompt,
                    messages=[{"role": "user", "content": full_prompt}]
                )

                code = ""
                for block in response.content:
                    if hasattr(block, 'text'):
                        code += block.text

                # Clean up any markdown code blocks if present
                code = code.strip()
                if code.startswith('```'):
                    lines = code.split('\n')
                    # Remove first line (```language) and last line (```)
                    if lines[-1].strip() == '```':
                        lines = lines[1:-1]
                    else:
                        lines = lines[1:]
                    code = '\n'.join(lines)

                return jsonify({
                    'code': code,
                    'explanation': '',
                    'language': language,
                    'agent': agent['name'],
                    'metrics': {
                        'tokens': response.usage.input_tokens + response.usage.output_tokens,
                        'time_ms': int((time.time() - start_time) * 1000)
                    }
                })
            except Exception as e:
                return jsonify({
                    'error': f'Code generation failed: {str(e)}',
                    'code': '',
                    'language': language
                }), 500
        else:
            return jsonify({
                'error': 'Claude API not available. Set ANTHROPIC_API_KEY.',
                'code': f'# Code generation unavailable\n# Request: {prompt}',
                'language': language,
                'lite_mode': True
            }), 503

    # Full mode with router
    try:
        result = router.query_claude(
            full_prompt,
            agent_id=agent.get('agent_id'),
            project_id=project_id,
            use_tools=False
        )

        code = result.get('response', '')

        # Clean up any markdown code blocks
        code = code.strip()
        if code.startswith('```'):
            lines = code.split('\n')
            if lines[-1].strip() == '```':
                lines = lines[1:-1]
            else:
                lines = lines[1:]
            code = '\n'.join(lines)

        return jsonify({
            'code': code,
            'explanation': '',
            'language': language,
            'agent': agent.get('name'),
            'metrics': {
                'tokens': result.get('tokens_used', 0),
                'time_ms': result.get('execution_time_ms', 0)
            }
        })
    except Exception as e:
        return jsonify({
            'error': f'Code generation failed: {str(e)}',
            'code': '',
            'language': language
        }), 500


# ============================================================================
# PHASE 2 ENDPOINTS: Structured Review, Agent Feedback, DevOps
# ============================================================================

# In-memory storage for agent feedback (lite mode)
_agent_feedback: dict = {}  # agent_id -> list of feedback
_agent_history: dict = {}   # agent_id -> list of executions


@app.route('/review-code-structured', methods=['POST'])
def review_code_structured():
    """Review code and return structured issues with line numbers"""
    data = request.json or {}
    code = data.get('code', '')
    language = data.get('language', 'python')
    file_path = data.get('file_path', '')
    review_type = data.get('review_type', 'all')
    line_offset = data.get('line_offset', 0)

    if not code:
        return jsonify({'error': 'Code is required'}), 400

    start_time = time.time()
    agent = find_agent_for_task('code review security performance', 'code_review')

    review_prompt = f"""Analyze this {language} code and return a JSON array of issues found.

Code to review:
```{language}
{code}
```

Review focus: {review_type}

Return ONLY a JSON object with this exact structure (no other text):
{{
  "issues": [
    {{
      "line": <line number>,
      "column": <column number>,
      "endLine": <end line number>,
      "endColumn": <end column number>,
      "message": "<description of the issue>",
      "severity": "<error|warning|info|hint>",
      "code": "<issue code like SEC001, PERF001, QUAL001, BUG001>",
      "category": "<security|performance|quality|bug|style>",
      "suggestion": "<how to fix it>",
      "fixCode": "<corrected code snippet if applicable>"
    }}
  ],
  "summary": {{
    "critical": <count>,
    "high": <count>,
    "medium": <count>,
    "low": <count>
  }}
}}

Issue code prefixes:
- SEC: Security issues
- PERF: Performance issues
- QUAL: Code quality issues
- BUG: Potential bugs
- STYLE: Style/formatting issues

Severity mapping:
- error = critical/high issues (security vulnerabilities, definite bugs)
- warning = medium issues (performance, potential bugs)
- info = low issues (code quality, suggestions)
- hint = minor suggestions (style, naming)"""

    if lite_mode:
        if claude_client:
            try:
                response = claude_client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=8000,
                    system="You are an expert code reviewer. Return ONLY valid JSON, no other text.",
                    messages=[{"role": "user", "content": review_prompt}]
                )

                response_text = ""
                for block in response.content:
                    if hasattr(block, 'text'):
                        response_text += block.text

                # Parse JSON response
                import json
                try:
                    # Find JSON in response
                    json_start = response_text.find('{')
                    json_end = response_text.rfind('}') + 1
                    if json_start >= 0 and json_end > json_start:
                        result = json.loads(response_text[json_start:json_end])
                    else:
                        result = {"issues": [], "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0}}
                except json.JSONDecodeError:
                    result = {"issues": [], "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0}}

                return jsonify({
                    'issues': result.get('issues', []),
                    'summary': result.get('summary', {"critical": 0, "high": 0, "medium": 0, "low": 0}),
                    'agent': agent['name'],
                    'metrics': {
                        'tokens': response.usage.input_tokens + response.usage.output_tokens,
                        'time_ms': int((time.time() - start_time) * 1000)
                    }
                })
            except Exception as e:
                return jsonify({
                    'error': f'Review failed: {str(e)}',
                    'issues': [],
                    'summary': {"critical": 0, "high": 0, "medium": 0, "low": 0}
                }), 500
        else:
            return jsonify({
                'error': 'Claude API not available',
                'issues': [],
                'summary': {"critical": 0, "high": 0, "medium": 0, "low": 0}
            }), 503

    # Full mode
    try:
        result = router.query_claude(
            review_prompt,
            agent_id=agent.get('agent_id'),
            use_tools=False
        )

        import json
        response_text = result.get('response', '')
        try:
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                parsed = json.loads(response_text[json_start:json_end])
            else:
                parsed = {"issues": [], "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0}}
        except json.JSONDecodeError:
            parsed = {"issues": [], "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0}}

        return jsonify({
            'issues': parsed.get('issues', []),
            'summary': parsed.get('summary', {"critical": 0, "high": 0, "medium": 0, "low": 0}),
            'agent': agent.get('name'),
            'metrics': {
                'tokens': result.get('tokens_used', 0),
                'time_ms': result.get('execution_time_ms', 0)
            }
        })
    except Exception as e:
        return jsonify({
            'error': f'Review failed: {str(e)}',
            'issues': [],
            'summary': {"critical": 0, "high": 0, "medium": 0, "low": 0}
        }), 500


@app.route('/agents/<int:agent_id>/feedback', methods=['POST'])
def submit_agent_feedback(agent_id):
    """Submit feedback for an agent's performance"""
    data = request.json or {}
    execution_id = data.get('execution_id')
    rating = data.get('rating', 3)
    feedback_text = data.get('feedback_text', '')
    was_helpful = data.get('was_helpful', True)

    if not lite_mode and router:
        try:
            # Update the execution record with feedback
            if execution_id:
                router.cursor.execute("""
                    UPDATE agent_execution_history
                    SET user_feedback_score = :1
                    WHERE id = :2
                """, [rating, execution_id])

            # Update agent success rate based on feedback
            router.cursor.execute("""
                UPDATE agent_repository
                SET success_rate = (
                    SELECT AVG(CASE WHEN user_feedback_score >= 3 THEN 1.0 ELSE 0.0 END)
                    FROM agent_execution_history
                    WHERE agent_id = :1 AND user_feedback_score IS NOT NULL
                )
                WHERE id = :1
            """, [agent_id])

            router.connection.commit()
        except Exception as e:
            print(f"Failed to record feedback in DB: {e}")

    # Store in memory
    if agent_id not in _agent_feedback:
        _agent_feedback[agent_id] = []

    _agent_feedback[agent_id].append({
        'execution_id': execution_id,
        'rating': rating,
        'feedback_text': feedback_text,
        'was_helpful': was_helpful,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ')
    })

    return jsonify({'recorded': True})


@app.route('/agents/<int:agent_id>/history', methods=['GET'])
def get_agent_history(agent_id):
    """Get execution history for an agent"""
    limit = request.args.get('limit', 10, type=int)

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT id,
                       DBMS_LOB.SUBSTR(task_description, 100, 1) as task_summary,
                       success,
                       execution_time_ms,
                       user_feedback_score,
                       created_at
                FROM agent_execution_history
                WHERE agent_id = :1
                ORDER BY created_at DESC
                FETCH FIRST :2 ROWS ONLY
            """, [agent_id, limit])

            executions = []
            for row in router.cursor:
                executions.append({
                    'id': row[0],
                    'task_summary': str(row[1]) if row[1] else '',
                    'success': row[2] == 'Y',
                    'execution_time_ms': row[3] or 0,
                    'user_feedback_score': row[4],
                    'timestamp': row[5].isoformat() if row[5] else None
                })

            return jsonify({'executions': executions})
        except Exception as e:
            print(f"Failed to get agent history: {e}")

    # Lite mode - return from memory or empty
    if agent_id in _agent_history:
        return jsonify({'executions': _agent_history[agent_id][-limit:], 'lite_mode': True})

    return jsonify({'executions': [], 'lite_mode': True})


@app.route('/generate-devops', methods=['POST'])
def generate_devops():
    """Generate DevOps configuration templates"""
    data = request.json or {}
    project_id = data.get('project_id', 'project')
    template_type = data.get('template_type', 'dockerfile')
    project_analysis = data.get('project_analysis', {})

    start_time = time.time()

    # Find or create DevOps agent
    agent = None
    for a in DEFAULT_AGENTS:
        if a['type'] == 'devops':
            agent = a
            break

    if not agent:
        agent = {
            'id': 7,
            'name': 'DevOps Specialist',
            'type': 'devops',
            'system_prompt': 'You are a DevOps expert. Generate production-ready configurations.',
            'success_rate': 0.90
        }

    languages = project_analysis.get('languages', [])
    frameworks = project_analysis.get('frameworks', [])
    databases = project_analysis.get('databases', [])

    # Build prompt based on template type
    if template_type == 'dockerfile':
        prompt = f"""Generate a production-ready Dockerfile for a project with:
Languages: {', '.join(languages) or 'Unknown'}
Frameworks: {', '.join(frameworks) or 'None'}
Databases: {', '.join(databases) or 'None'}

Requirements:
1. Use multi-stage build for smaller images
2. Run as non-root user
3. Include health check if applicable
4. Optimize layer caching
5. Use specific version tags, not 'latest'

Return ONLY the Dockerfile content, no explanations."""

    elif template_type in ['github-actions', 'gitlab-ci']:
        platform = 'GitHub Actions' if template_type == 'github-actions' else 'GitLab CI'
        prompt = f"""Generate a {platform} CI/CD configuration for a project with:
Languages: {', '.join(languages) or 'Unknown'}
Frameworks: {', '.join(frameworks) or 'None'}
Databases: {', '.join(databases) or 'None'}
Has Tests: {project_analysis.get('hasTests', False)}

Include:
1. Linting
2. Testing with coverage
3. Building
4. Docker image build and push (if applicable)

Return ONLY the YAML configuration, no explanations."""

    elif template_type == 'docker-compose':
        prompt = f"""Generate a docker-compose.yml for a project with:
Languages: {', '.join(languages) or 'Unknown'}
Frameworks: {', '.join(frameworks) or 'None'}
Databases: {', '.join(databases) or 'None'}

Include:
1. Application service
2. Database services as needed
3. Proper networking
4. Volume mounts for persistence
5. Environment variables

Return ONLY the docker-compose.yml content, no explanations."""

    else:
        return jsonify({'error': f'Unknown template type: {template_type}'}), 400

    # Generate using Claude
    if lite_mode:
        if claude_client:
            try:
                response = claude_client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=4000,
                    system=agent['system_prompt'],
                    messages=[{"role": "user", "content": prompt}]
                )

                content = ""
                for block in response.content:
                    if hasattr(block, 'text'):
                        content += block.text

                # Clean up response
                content = content.strip()
                if content.startswith('```'):
                    lines = content.split('\n')
                    if lines[-1].strip() == '```':
                        lines = lines[1:-1]
                    else:
                        lines = lines[1:]
                    content = '\n'.join(lines)

                # Determine filename
                filenames = {
                    'dockerfile': 'Dockerfile',
                    'github-actions': '.github/workflows/ci.yml',
                    'gitlab-ci': '.gitlab-ci.yml',
                    'docker-compose': 'docker-compose.yml'
                }

                return jsonify({
                    'templates': [{
                        'type': template_type,
                        'content': content,
                        'filename': filenames.get(template_type, 'config.yml'),
                        'description': f'Generated {template_type} configuration'
                    }],
                    'agent': agent['name'],
                    'metrics': {
                        'tokens': response.usage.input_tokens + response.usage.output_tokens,
                        'time_ms': int((time.time() - start_time) * 1000)
                    }
                })
            except Exception as e:
                return jsonify({
                    'error': f'Generation failed: {str(e)}',
                    'templates': []
                }), 500
        else:
            return jsonify({
                'error': 'Claude API not available',
                'templates': []
            }), 503

    # Full mode
    try:
        result = router.query_claude(
            prompt,
            agent_id=agent.get('id') or agent.get('agent_id'),
            use_tools=False
        )

        content = result.get('response', '')
        content = content.strip()
        if content.startswith('```'):
            lines = content.split('\n')
            if lines[-1].strip() == '```':
                lines = lines[1:-1]
            else:
                lines = lines[1:]
            content = '\n'.join(lines)

        filenames = {
            'dockerfile': 'Dockerfile',
            'github-actions': '.github/workflows/ci.yml',
            'gitlab-ci': '.gitlab-ci.yml',
            'docker-compose': 'docker-compose.yml'
        }

        return jsonify({
            'templates': [{
                'type': template_type,
                'content': content,
                'filename': filenames.get(template_type, 'config.yml'),
                'description': f'Generated {template_type} configuration'
            }],
            'agent': agent.get('name'),
            'metrics': {
                'tokens': result.get('tokens_used', 0),
                'time_ms': result.get('execution_time_ms', 0)
            }
        })
    except Exception as e:
        return jsonify({
            'error': f'Generation failed: {str(e)}',
            'templates': []
        }), 500


# ============================================================================
# PHASE 3 ENDPOINTS: Tools, Learning, Feature Generation
# ============================================================================

# In-memory storage for tool chains and learning data (lite mode)
_tool_chains: dict = {}  # execution_id -> chain status
_learning_data: dict = {}  # agent_id -> learning data

# Default available tools
DEFAULT_TOOLS = [
    {
        'name': 'filesystem',
        'type': 'core',
        'description': 'File system operations within the workspace',
        'is_configured': True,
        'capabilities': ['read', 'write', 'list', 'search'],
        'actions': [
            {'name': 'list_directory', 'description': 'List directory contents', 'parameters': [
                {'name': 'path', 'type': 'string', 'description': 'Directory path', 'required': False}
            ]},
            {'name': 'read_file', 'description': 'Read file contents', 'parameters': [
                {'name': 'path', 'type': 'string', 'description': 'File path', 'required': True}
            ]},
            {'name': 'write_file', 'description': 'Write to a file', 'parameters': [
                {'name': 'path', 'type': 'string', 'description': 'File path', 'required': True},
                {'name': 'content', 'type': 'string', 'description': 'Content to write', 'required': True}
            ]},
            {'name': 'search_files', 'description': 'Search for files', 'parameters': [
                {'name': 'pattern', 'type': 'string', 'description': 'Glob pattern', 'required': True}
            ]}
        ]
    },
    {
        'name': 'github',
        'type': 'integration',
        'description': 'GitHub repository operations',
        'is_configured': False,
        'capabilities': ['repos', 'issues', 'pull_requests'],
        'actions': [
            {'name': 'list_repos', 'description': 'List repositories', 'parameters': []},
            {'name': 'create_issue', 'description': 'Create an issue', 'parameters': [
                {'name': 'repo', 'type': 'string', 'description': 'Repository', 'required': True},
                {'name': 'title', 'type': 'string', 'description': 'Issue title', 'required': True},
                {'name': 'body', 'type': 'string', 'description': 'Issue body', 'required': False}
            ]},
            {'name': 'create_pull_request', 'description': 'Create a PR', 'parameters': [
                {'name': 'repo', 'type': 'string', 'description': 'Repository', 'required': True},
                {'name': 'title', 'type': 'string', 'description': 'PR title', 'required': True},
                {'name': 'head', 'type': 'string', 'description': 'Head branch', 'required': True},
                {'name': 'base', 'type': 'string', 'description': 'Base branch', 'required': True}
            ]}
        ]
    },
    {
        'name': 'memory',
        'type': 'core',
        'description': 'Local memory storage for context and learning',
        'is_configured': True,
        'capabilities': ['store', 'retrieve', 'search'],
        'actions': [
            {'name': 'store', 'description': 'Store a value', 'parameters': [
                {'name': 'key', 'type': 'string', 'description': 'Storage key', 'required': True},
                {'name': 'value', 'type': 'object', 'description': 'Value to store', 'required': True}
            ]},
            {'name': 'retrieve', 'description': 'Retrieve a value', 'parameters': [
                {'name': 'key', 'type': 'string', 'description': 'Storage key', 'required': True}
            ]},
            {'name': 'search', 'description': 'Search memory', 'parameters': [
                {'name': 'query', 'type': 'string', 'description': 'Search query', 'required': True}
            ]}
        ]
    },
    {
        'name': 'postgresql',
        'type': 'database',
        'description': 'PostgreSQL database operations',
        'is_configured': False,
        'capabilities': ['query', 'schema'],
        'actions': [
            {'name': 'query', 'description': 'Execute SQL query', 'parameters': [
                {'name': 'sql', 'type': 'string', 'description': 'SQL query', 'required': True}
            ]},
            {'name': 'schema', 'description': 'Get database schema', 'parameters': []}
        ]
    }
]


@app.route('/tools/available', methods=['GET'])
def get_available_tools():
    """Get list of available MCP tools"""
    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT server_name, server_type, description, is_active
                FROM mcp_server_registry
                ORDER BY server_name
            """)

            tools = []
            for row in router.cursor:
                tools.append({
                    'name': row[0],
                    'type': row[1],
                    'description': row[2],
                    'is_configured': row[3] == 'Y',
                    'capabilities': [],
                    'actions': []
                })

            if tools:
                return jsonify({'tools': tools})
        except Exception as e:
            print(f"Failed to get tools from DB: {e}")

    return jsonify({'tools': DEFAULT_TOOLS, 'lite_mode': lite_mode})


@app.route('/tools/execute', methods=['POST'])
def execute_tool():
    """Execute an MCP tool action"""
    data = request.json or {}
    tool_name = data.get('tool_name', '')
    action = data.get('action', '')
    parameters = data.get('parameters', {})
    project_id = data.get('project_id')

    start_time = time.time()

    if not tool_name or not action:
        return jsonify({'error': 'Tool name and action are required'}), 400

    # Find the tool
    tool = None
    for t in DEFAULT_TOOLS:
        if t['name'] == tool_name:
            tool = t
            break

    if not tool:
        return jsonify({
            'success': False,
            'error': f'Tool "{tool_name}" not found',
            'output': None,
            'execution_time_ms': int((time.time() - start_time) * 1000)
        }), 404

    # Find the action
    tool_action = None
    for a in tool.get('actions', []):
        if a['name'] == action:
            tool_action = a
            break

    if not tool_action:
        return jsonify({
            'success': False,
            'error': f'Action "{action}" not found for tool "{tool_name}"',
            'output': None,
            'execution_time_ms': int((time.time() - start_time) * 1000)
        }), 404

    # Validate required parameters
    for param in tool_action.get('parameters', []):
        if param.get('required') and param['name'] not in parameters:
            return jsonify({
                'success': False,
                'error': f'Missing required parameter: {param["name"]}',
                'output': None,
                'execution_time_ms': int((time.time() - start_time) * 1000)
            }), 400

    # Simulate tool execution (in a real implementation, this would call the actual MCP server)
    try:
        if tool_name == 'filesystem':
            if action == 'list_directory':
                # Simulated response
                result = {'entries': [{'name': 'src', 'type': 'directory'}, {'name': 'README.md', 'type': 'file'}]}
            elif action == 'read_file':
                result = {'content': f'[File content for {parameters.get("path", "unknown")}]'}
            elif action == 'write_file':
                result = {'written': parameters.get('path')}
            elif action == 'search_files':
                result = {'files': ['/src/main.py', '/src/utils.py']}
            else:
                result = {'message': f'Action {action} executed'}
        elif tool_name == 'memory':
            if action == 'store':
                result = {'stored': parameters.get('key')}
            elif action == 'retrieve':
                result = {'value': None, 'key': parameters.get('key')}
            elif action == 'search':
                result = {'results': []}
            else:
                result = {'message': f'Action {action} executed'}
        else:
            result = {'message': f'Tool {tool_name}.{action} executed (simulated)', 'parameters': parameters}

        return jsonify({
            'success': True,
            'result': result,
            'output': result,
            'execution_time_ms': int((time.time() - start_time) * 1000)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'output': None,
            'execution_time_ms': int((time.time() - start_time) * 1000)
        }), 500


@app.route('/tools/chain', methods=['POST'])
def execute_tool_chain():
    """Execute a chain of tool actions"""
    data = request.json or {}
    chain_name = data.get('name', 'Unnamed Chain')
    chain_description = data.get('description', '')
    steps = data.get('steps', [])
    project_id = data.get('project_id')

    if not steps:
        return jsonify({'error': 'At least one step is required'}), 400

    execution_id = str(uuid.uuid4())

    # Initialize chain status
    _tool_chains[execution_id] = {
        'execution_id': execution_id,
        'name': chain_name,
        'description': chain_description,
        'status': 'running',
        'current_step': steps[0].get('step_id') if steps else None,
        'steps': [
            {
                'step_id': step.get('step_id', f'step_{i}'),
                'tool': step.get('tool'),
                'action': step.get('action'),
                'status': 'pending',
                'result': None
            }
            for i, step in enumerate(steps)
        ],
        'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'completed_at': None
    }

    # In a real implementation, this would run asynchronously
    # For now, execute steps synchronously and update status
    chain_status = _tool_chains[execution_id]
    all_success = True

    for i, step in enumerate(steps):
        step_id = step.get('step_id', f'step_{i}')
        chain_status['current_step'] = step_id
        chain_status['steps'][i]['status'] = 'running'

        try:
            # Execute step (simplified)
            result = {
                'message': f'Step {step_id} executed: {step.get("tool")}.{step.get("action")}',
                'parameters': step.get('parameters', {})
            }
            chain_status['steps'][i]['status'] = 'completed'
            chain_status['steps'][i]['result'] = {
                'success': True,
                'output': result,
                'execution_time_ms': 100
            }
        except Exception as e:
            chain_status['steps'][i]['status'] = 'failed'
            chain_status['steps'][i]['result'] = {
                'success': False,
                'error': str(e),
                'execution_time_ms': 0
            }
            all_success = False
            # Stop on failure
            for j in range(i + 1, len(steps)):
                chain_status['steps'][j]['status'] = 'skipped'
            break

    chain_status['status'] = 'completed' if all_success else 'failed'
    chain_status['completed_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ')
    chain_status['current_step'] = None

    return jsonify({'execution_id': execution_id, 'status': chain_status['status']})


@app.route('/tools/chain/<execution_id>', methods=['GET'])
def get_chain_status(execution_id):
    """Get the status of a tool chain execution"""
    if execution_id not in _tool_chains:
        return jsonify({'error': 'Chain execution not found'}), 404

    return jsonify(_tool_chains[execution_id])


@app.route('/agents/<int:agent_id>/learning', methods=['GET'])
def get_agent_learning(agent_id):
    """Get learning insights for an agent"""
    if not lite_mode and router:
        try:
            # Get agent details
            router.cursor.execute("""
                SELECT agent_name, agent_type, total_tasks_completed, success_rate
                FROM agent_repository
                WHERE id = :1
            """, [agent_id])
            agent_row = router.cursor.fetchone()

            if not agent_row:
                return jsonify({'error': 'Agent not found'}), 404

            # Get learning checkpoints
            router.cursor.execute("""
                SELECT id, checkpoint_date, total_tasks_at_checkpoint,
                       success_rate_at_checkpoint, average_feedback_score,
                       learned_patterns_summary
                FROM agent_learning_checkpoints
                WHERE agent_id = :1
                ORDER BY checkpoint_date DESC
                FETCH FIRST 10 ROWS ONLY
            """, [agent_id])

            checkpoints = []
            for row in router.cursor:
                checkpoints.append({
                    'id': row[0],
                    'agent_id': agent_id,
                    'agent_name': agent_row[0],
                    'checkpoint_date': row[1].isoformat() if row[1] else None,
                    'total_tasks': row[2] or 0,
                    'success_rate': float(row[3]) if row[3] else 0.0,
                    'average_feedback_score': float(row[4]) if row[4] else 0.0,
                    'learned_patterns': [],
                    'performance_delta': 0
                })

            # Get execution trend
            router.cursor.execute("""
                SELECT TRUNC(created_at) as exec_date,
                       AVG(CASE WHEN success = 'Y' THEN 1.0 ELSE 0.0 END) as success_rate,
                       AVG(user_feedback_score) as feedback,
                       COUNT(*) as task_count
                FROM agent_execution_history
                WHERE agent_id = :1
                  AND created_at > SYSDATE - 30
                GROUP BY TRUNC(created_at)
                ORDER BY exec_date
            """, [agent_id])

            trend = []
            for row in router.cursor:
                trend.append({
                    'date': row[0].isoformat() if row[0] else None,
                    'success_rate': float(row[1]) if row[1] else 0.0,
                    'feedback_score': float(row[2]) if row[2] else 0.0,
                    'tasks_completed': row[3] or 0
                })

            return jsonify({
                'agent_id': agent_id,
                'agent_name': agent_row[0],
                'agent_type': agent_row[1],
                'total_tasks': agent_row[2] or 0,
                'overall_success_rate': float(agent_row[3]) if agent_row[3] else 0.0,
                'average_feedback': 0.0,
                'checkpoints': checkpoints,
                'learned_patterns': [],
                'improvement_trend': trend,
                'recent_insights': []
            })
        except Exception as e:
            print(f"Failed to get agent learning: {e}")

    # Lite mode - return demo data
    agent = None
    for a in DEFAULT_AGENTS:
        if a['id'] == agent_id:
            agent = a
            break

    if not agent:
        return jsonify({'error': 'Agent not found'}), 404

    # Generate demo learning data
    import random
    base_success = agent.get('success_rate', 0.85)

    checkpoints = []
    trend = []
    for i in range(5):
        day_offset = 30 - (i * 7)
        date_str = time.strftime('%Y-%m-%d', time.localtime(time.time() - day_offset * 86400))
        success_rate = base_success - 0.05 + (i * 0.02) + random.uniform(-0.02, 0.02)
        feedback = 3.5 + (i * 0.15) + random.uniform(-0.2, 0.2)

        checkpoints.append({
            'id': i + 1,
            'agent_id': agent_id,
            'agent_name': agent['name'],
            'checkpoint_date': date_str,
            'total_tasks': 20 + (i * 10),
            'success_rate': min(success_rate, 0.98),
            'average_feedback_score': min(feedback, 5.0),
            'learned_patterns': [],
            'performance_delta': 0.02 if i > 0 else 0
        })

        trend.append({
            'date': date_str,
            'success_rate': min(success_rate, 0.98),
            'feedback_score': min(feedback, 5.0),
            'tasks_completed': 5 + random.randint(0, 5)
        })

    learned_patterns = [
        {
            'pattern_type': 'Code Structure',
            'description': 'Recognizes common design patterns in code',
            'frequency': random.randint(10, 30),
            'success_rate': base_success + random.uniform(0, 0.1),
            'first_seen': time.strftime('%Y-%m-%d', time.localtime(time.time() - 25 * 86400))
        },
        {
            'pattern_type': 'Error Handling',
            'description': 'Identifies missing error handling patterns',
            'frequency': random.randint(15, 40),
            'success_rate': base_success + random.uniform(0, 0.08),
            'first_seen': time.strftime('%Y-%m-%d', time.localtime(time.time() - 20 * 86400))
        }
    ]

    return jsonify({
        'agent_id': agent_id,
        'agent_name': agent['name'],
        'agent_type': agent['type'],
        'total_tasks': agent['tasks_completed'] + random.randint(50, 150),
        'overall_success_rate': agent['success_rate'],
        'average_feedback': 4.0 + random.uniform(0, 0.5),
        'checkpoints': checkpoints,
        'learned_patterns': learned_patterns,
        'improvement_trend': trend,
        'recent_insights': [
            f'Success rate improved {random.randint(3, 8)}% over the past month',
            'Strong performance on security-related reviews',
            'Consider expanding test coverage pattern recognition'
        ],
        'lite_mode': True
    })


@app.route('/generate-feature', methods=['POST'])
def generate_feature():
    """Generate multiple files for a feature"""
    data = request.json or {}
    project_id = data.get('project_id')
    feature_description = data.get('feature_description', '')
    project_context = data.get('project_context', {})

    if not feature_description:
        return jsonify({'error': 'Feature description is required'}), 400

    start_time = time.time()
    agent = find_agent_for_task(feature_description, 'code_generation')

    # Build prompt for multi-file generation
    languages = project_context.get('languages', ['python'])
    frameworks = project_context.get('frameworks', [])
    structure = project_context.get('structure', 'standard')

    prompt = f"""Generate the files needed to implement this feature:

Feature Description:
{feature_description}

Project Context:
- Primary Language: {languages[0] if languages else 'python'}
- Frameworks: {', '.join(frameworks) if frameworks else 'None specified'}
- Project Structure: {structure}

Return a JSON object with this exact structure:
{{
  "files": [
    {{
      "path": "relative/path/to/file.ext",
      "content": "file content here",
      "action": "create",
      "description": "Brief description of what this file does"
    }}
  ],
  "dependencies": ["list", "of", "new", "dependencies"],
  "instructions": "Any additional setup instructions"
}}

Guidelines:
1. Use appropriate file paths based on project structure
2. Generate complete, working code
3. Include necessary imports and error handling
4. Add appropriate comments
5. Follow language best practices

Return ONLY the JSON object, no other text."""

    if lite_mode:
        if claude_client:
            try:
                response = claude_client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=8000,
                    system=agent.get('system_prompt', 'You are an expert code generator.'),
                    messages=[{"role": "user", "content": prompt}]
                )

                response_text = ""
                for block in response.content:
                    if hasattr(block, 'text'):
                        response_text += block.text

                # Parse JSON response
                import json
                try:
                    json_start = response_text.find('{')
                    json_end = response_text.rfind('}') + 1
                    if json_start >= 0 and json_end > json_start:
                        result = json.loads(response_text[json_start:json_end])
                    else:
                        result = {'files': [], 'dependencies': [], 'instructions': ''}
                except json.JSONDecodeError:
                    result = {'files': [], 'dependencies': [], 'instructions': ''}

                return jsonify({
                    'files': result.get('files', []),
                    'dependencies': result.get('dependencies', []),
                    'instructions': result.get('instructions', ''),
                    'agent': agent['name'],
                    'metrics': {
                        'tokens': response.usage.input_tokens + response.usage.output_tokens,
                        'time_ms': int((time.time() - start_time) * 1000)
                    }
                })
            except Exception as e:
                return jsonify({
                    'error': f'Feature generation failed: {str(e)}',
                    'files': []
                }), 500
        else:
            return jsonify({
                'error': 'Claude API not available',
                'files': []
            }), 503

    # Full mode
    try:
        result = router.query_claude(
            prompt,
            agent_id=agent.get('agent_id'),
            project_id=project_id,
            use_tools=False
        )

        import json
        response_text = result.get('response', '')
        try:
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                parsed = json.loads(response_text[json_start:json_end])
            else:
                parsed = {'files': [], 'dependencies': [], 'instructions': ''}
        except json.JSONDecodeError:
            parsed = {'files': [], 'dependencies': [], 'instructions': ''}

        return jsonify({
            'files': parsed.get('files', []),
            'dependencies': parsed.get('dependencies', []),
            'instructions': parsed.get('instructions', ''),
            'agent': agent.get('name'),
            'metrics': {
                'tokens': result.get('tokens_used', 0),
                'time_ms': result.get('execution_time_ms', 0)
            }
        })
    except Exception as e:
        return jsonify({
            'error': f'Feature generation failed: {str(e)}',
            'files': []
        }), 500


@app.route('/recommend-tools', methods=['POST'])
def recommend_tools():
    """Get tool recommendations based on task context"""
    data = request.json or {}
    task_type = data.get('task_type', 'general')
    file_types = data.get('file_types', [])
    project_type = data.get('project_type', '')

    # Task-based recommendations
    recommendations = []

    # Always recommend core tools
    recommendations.append({
        'tool_name': 'filesystem',
        'relevance_score': 0.95,
        'reason': 'Essential for file operations',
        'suggested_actions': ['read_file', 'write_file', 'list_directory']
    })

    recommendations.append({
        'tool_name': 'memory',
        'relevance_score': 0.85,
        'reason': 'Useful for maintaining context',
        'suggested_actions': ['store', 'retrieve']
    })

    # Task-specific recommendations
    if task_type in ['code_review', 'debugging']:
        recommendations.append({
            'tool_name': 'github',
            'relevance_score': 0.8,
            'reason': 'Helpful for version control context',
            'suggested_actions': ['create_issue', 'create_pull_request']
        })

    if task_type in ['testing']:
        recommendations.append({
            'tool_name': 'puppeteer',
            'relevance_score': 0.7,
            'reason': 'Browser automation for E2E testing',
            'suggested_actions': ['navigate', 'screenshot']
        })

    # File type based recommendations
    if any(ft in ['sql', 'db'] for ft in file_types):
        recommendations.append({
            'tool_name': 'postgresql',
            'relevance_score': 0.9,
            'reason': 'Database operations detected',
            'suggested_actions': ['query', 'schema']
        })

    # Sort by relevance
    recommendations.sort(key=lambda x: x['relevance_score'], reverse=True)

    return jsonify({
        'recommendations': recommendations,
        'task_type': task_type,
        'lite_mode': lite_mode
    })


# ============================================================================
# PHASE 4 ENDPOINTS: Custom Rules, RBAC, Compliance
# ============================================================================

# In-memory storage for Phase 4 (lite mode)
_custom_rules: dict = {}  # rule_code -> rule
_user_permissions: dict = {}  # user_id -> permissions
_audit_log: list = []  # list of audit entries

# Default custom rules
DEFAULT_CUSTOM_RULES = [
    {
        'code': 'SEC001',
        'name': 'Hardcoded Secrets',
        'description': 'Detects potential hardcoded secrets or API keys',
        'severity': 'error',
        'category': 'security',
        'pattern': r'(api[_-]?key|secret|password|token)\s*[=:]\s*["\'][^"\']{8,}["\']',
        'pattern_type': 'regex',
        'languages': ['javascript', 'typescript', 'python', 'java'],
        'suggestion': 'Use environment variables or a secure secrets manager',
        'is_active': True
    },
    {
        'code': 'SEC002',
        'name': 'SQL Injection Risk',
        'description': 'Detects potential SQL injection vulnerabilities',
        'severity': 'error',
        'category': 'security',
        'pattern': r'(execute|query|raw)\s*\([^)]*\+|f["\'].*\{.*\}.*SELECT',
        'pattern_type': 'regex',
        'languages': ['python', 'javascript', 'typescript'],
        'suggestion': 'Use parameterized queries instead of string concatenation',
        'is_active': True
    },
    {
        'code': 'PERF001',
        'name': 'Console Log in Production',
        'description': 'Detects console.log statements that should be removed',
        'severity': 'warning',
        'category': 'performance',
        'pattern': r'console\.(log|debug|info)\s*\(',
        'pattern_type': 'regex',
        'languages': ['javascript', 'typescript'],
        'suggestion': 'Remove console statements or use a proper logging framework',
        'is_active': True
    }
]

# Initialize default rules
for rule in DEFAULT_CUSTOM_RULES:
    _custom_rules[rule['code']] = rule


@app.route('/rules', methods=['GET'])
def list_rules():
    """List all custom rules"""
    project_id = request.args.get('project_id')

    if not lite_mode and router:
        try:
            query = """
                SELECT rule_code, rule_name, description, severity, category,
                       pattern, pattern_type, languages, suggestion, is_active,
                       created_at, updated_at
                FROM custom_review_rules
            """
            if project_id:
                query += " WHERE project_id = :1 OR project_id IS NULL"
                router.cursor.execute(query, [project_id])
            else:
                router.cursor.execute(query)

            rules = []
            for row in router.cursor:
                rules.append({
                    'code': row[0],
                    'name': row[1],
                    'description': row[2],
                    'severity': row[3],
                    'category': row[4],
                    'pattern': row[5],
                    'pattern_type': row[6],
                    'languages': row[7].split(',') if row[7] else [],
                    'suggestion': row[8],
                    'is_active': row[9] == 'Y',
                    'created_at': row[10].isoformat() if row[10] else None,
                    'updated_at': row[11].isoformat() if row[11] else None
                })

            if rules:
                return jsonify({'rules': rules})
        except Exception as e:
            print(f"Failed to list rules: {e}")

    return jsonify({'rules': list(_custom_rules.values()), 'lite_mode': lite_mode})


@app.route('/rules', methods=['POST'])
def create_rule():
    """Create a new custom rule"""
    data = request.json or {}

    required_fields = ['code', 'name', 'pattern', 'severity']
    for field in required_fields:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400

    rule = {
        'code': data['code'],
        'name': data['name'],
        'description': data.get('description', ''),
        'severity': data['severity'],
        'category': data.get('category', 'custom'),
        'pattern': data['pattern'],
        'pattern_type': data.get('pattern_type', 'regex'),
        'languages': data.get('languages', ['*']),
        'suggestion': data.get('suggestion', ''),
        'is_active': data.get('is_active', True),
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ')
    }

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                INSERT INTO custom_review_rules
                (rule_code, rule_name, description, severity, category,
                 pattern, pattern_type, languages, suggestion, is_active)
                VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10)
            """, [
                rule['code'], rule['name'], rule['description'],
                rule['severity'], rule['category'], rule['pattern'],
                rule['pattern_type'], ','.join(rule['languages']),
                rule['suggestion'], 'Y' if rule['is_active'] else 'N'
            ])
            router.connection.commit()
        except Exception as e:
            print(f"Failed to create rule in DB: {e}")

    _custom_rules[rule['code']] = rule
    _log_audit('create_rule', 'rule', rule['code'], {'rule_name': rule['name']})

    return jsonify({'rule': rule, 'created': True})


@app.route('/rules/<rule_code>', methods=['PUT'])
def update_rule(rule_code):
    """Update an existing rule"""
    data = request.json or {}

    if rule_code not in _custom_rules:
        return jsonify({'error': 'Rule not found'}), 404

    rule = _custom_rules[rule_code]

    # Update fields
    for field in ['name', 'description', 'severity', 'category', 'pattern',
                  'pattern_type', 'languages', 'suggestion', 'is_active']:
        if field in data:
            rule[field] = data[field]

    rule['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ')

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                UPDATE custom_review_rules
                SET rule_name = :1, description = :2, severity = :3,
                    category = :4, pattern = :5, pattern_type = :6,
                    languages = :7, suggestion = :8, is_active = :9
                WHERE rule_code = :10
            """, [
                rule['name'], rule['description'], rule['severity'],
                rule['category'], rule['pattern'], rule['pattern_type'],
                ','.join(rule['languages']) if isinstance(rule['languages'], list) else rule['languages'],
                rule['suggestion'], 'Y' if rule['is_active'] else 'N',
                rule_code
            ])
            router.connection.commit()
        except Exception as e:
            print(f"Failed to update rule in DB: {e}")

    _log_audit('update_rule', 'rule', rule_code, data)

    return jsonify({'rule': rule, 'updated': True})


@app.route('/rules/<rule_code>', methods=['DELETE'])
def delete_rule(rule_code):
    """Delete a rule"""
    if rule_code not in _custom_rules:
        return jsonify({'error': 'Rule not found'}), 404

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                DELETE FROM custom_review_rules WHERE rule_code = :1
            """, [rule_code])
            router.connection.commit()
        except Exception as e:
            print(f"Failed to delete rule from DB: {e}")

    del _custom_rules[rule_code]
    _log_audit('delete_rule', 'rule', rule_code, {})

    return jsonify({'deleted': True})


@app.route('/rules/test', methods=['POST'])
def test_rule():
    """Test a rule against code"""
    data = request.json or {}
    rule = data.get('rule', {})
    code = data.get('code', '')
    language = data.get('language', 'python')

    if not rule or not code:
        return jsonify({'error': 'Rule and code are required'}), 400

    start_time = time.time()
    matches = []

    try:
        import re
        pattern = rule.get('pattern', '')
        regex = re.compile(pattern, re.MULTILINE)

        lines = code.split('\n')
        for line_num, line in enumerate(lines, 1):
            for match in regex.finditer(line):
                matches.append({
                    'line': line_num,
                    'column': match.start() + 1,
                    'endLine': line_num,
                    'endColumn': match.end() + 1,
                    'matchedText': match.group(0),
                    'message': rule.get('description', 'Rule violation'),
                    'suggestion': rule.get('suggestion', '')
                })

        return jsonify({
            'matches': matches,
            'execution_time_ms': int((time.time() - start_time) * 1000),
            'success': True
        })
    except Exception as e:
        return jsonify({
            'matches': [],
            'execution_time_ms': int((time.time() - start_time) * 1000),
            'success': False,
            'error': str(e)
        })


# ============================================================================
# USER PERMISSIONS ENDPOINTS
# ============================================================================

DEFAULT_PERMISSIONS = {
    'user_id': 'local-user',
    'role': 'developer',
    'allowed_agents': ['*'],
    'allowed_features': [
        'chat', 'code_review', 'code_generation', 'refactoring', 'testing',
        'devops', 'multi_file_generation', 'tool_execution'
    ],
    'daily_token_limit': 1000000,
    'tokens_used_today': 0,
    'can_create_rules': True,
    'can_execute_tools': True,
    'can_view_audit_log': True,
    'can_manage_users': False,
    'is_admin': False
}


@app.route('/users/me/permissions', methods=['GET'])
def get_my_permissions():
    """Get current user's permissions"""
    # In a real implementation, this would use authentication
    user_id = request.headers.get('X-User-ID', 'local-user')

    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT user_id, role, allowed_agents, allowed_features,
                       daily_token_limit, tokens_used_today,
                       can_create_rules, can_execute_tools,
                       can_view_audit_log, can_manage_users, is_admin
                FROM user_permissions
                WHERE user_id = :1
            """, [user_id])

            row = router.cursor.fetchone()
            if row:
                return jsonify({
                    'user_id': row[0],
                    'role': row[1],
                    'allowed_agents': row[2].split(',') if row[2] else [],
                    'allowed_features': row[3].split(',') if row[3] else [],
                    'daily_token_limit': row[4] or 1000000,
                    'tokens_used_today': row[5] or 0,
                    'can_create_rules': row[6] == 'Y',
                    'can_execute_tools': row[7] == 'Y',
                    'can_view_audit_log': row[8] == 'Y',
                    'can_manage_users': row[9] == 'Y',
                    'is_admin': row[10] == 'Y'
                })
        except Exception as e:
            print(f"Failed to get permissions: {e}")

    # Return default or cached permissions
    if user_id in _user_permissions:
        return jsonify(_user_permissions[user_id])

    return jsonify({**DEFAULT_PERMISSIONS, 'user_id': user_id, 'lite_mode': lite_mode})


@app.route('/users/me/token-usage', methods=['POST'])
def update_token_usage():
    """Update token usage for current user"""
    data = request.json or {}
    tokens_used = data.get('tokens_used', 0)
    user_id = request.headers.get('X-User-ID', 'local-user')

    if user_id not in _user_permissions:
        _user_permissions[user_id] = {**DEFAULT_PERMISSIONS, 'user_id': user_id}

    _user_permissions[user_id]['tokens_used_today'] += tokens_used

    return jsonify({'updated': True, 'tokens_used_today': _user_permissions[user_id]['tokens_used_today']})


@app.route('/users', methods=['GET'])
def list_users():
    """List all users (admin only)"""
    # In a real implementation, this would check admin permissions
    if not lite_mode and router:
        try:
            router.cursor.execute("""
                SELECT user_id, email, name, role, created_at, last_active
                FROM users
                ORDER BY created_at DESC
            """)

            users = []
            for row in router.cursor:
                users.append({
                    'id': row[0],
                    'email': row[1],
                    'name': row[2],
                    'role': row[3],
                    'created_at': row[4].isoformat() if row[4] else None,
                    'last_active': row[5].isoformat() if row[5] else None
                })

            return jsonify({'users': users})
        except Exception as e:
            print(f"Failed to list users: {e}")

    # Demo users for lite mode
    return jsonify({
        'users': [
            {'id': 'user-1', 'email': 'admin@example.com', 'name': 'Admin User', 'role': 'admin'},
            {'id': 'user-2', 'email': 'dev@example.com', 'name': 'Developer', 'role': 'developer'},
            {'id': 'user-3', 'email': 'viewer@example.com', 'name': 'Viewer', 'role': 'viewer'}
        ],
        'lite_mode': lite_mode
    })


@app.route('/users/<user_id>/permissions', methods=['PUT'])
def update_user_permissions(user_id):
    """Update user permissions (admin only)"""
    data = request.json or {}

    if not lite_mode and router:
        try:
            # Build update query dynamically
            updates = []
            values = []
            if 'role' in data:
                updates.append('role = :' + str(len(values) + 1))
                values.append(data['role'])
            if 'allowed_agents' in data:
                updates.append('allowed_agents = :' + str(len(values) + 1))
                values.append(','.join(data['allowed_agents']))
            if 'allowed_features' in data:
                updates.append('allowed_features = :' + str(len(values) + 1))
                values.append(','.join(data['allowed_features']))
            if 'daily_token_limit' in data:
                updates.append('daily_token_limit = :' + str(len(values) + 1))
                values.append(data['daily_token_limit'])

            if updates:
                values.append(user_id)
                router.cursor.execute(f"""
                    UPDATE user_permissions
                    SET {', '.join(updates)}
                    WHERE user_id = :{len(values)}
                """, values)
                router.connection.commit()
        except Exception as e:
            print(f"Failed to update user permissions: {e}")

    # Update local cache
    if user_id not in _user_permissions:
        _user_permissions[user_id] = {**DEFAULT_PERMISSIONS, 'user_id': user_id}

    for key, value in data.items():
        if key in _user_permissions[user_id]:
            _user_permissions[user_id][key] = value

    _log_audit('update_permissions', 'user', user_id, data)

    return jsonify({'updated': True, 'permissions': _user_permissions.get(user_id)})


# ============================================================================
# COMPLIANCE AND AUDIT ENDPOINTS
# ============================================================================

def _log_audit(action: str, resource_type: str, resource_id: str = None, details: dict = None):
    """Log an audit entry"""
    entry = {
        'id': str(uuid.uuid4()),
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'user_id': 'local-user',  # Would come from auth in real implementation
        'action': action,
        'resource_type': resource_type,
        'resource_id': resource_id,
        'details': details or {},
        'success': True
    }
    _audit_log.append(entry)

    # Keep only last 1000 entries in memory
    if len(_audit_log) > 1000:
        _audit_log.pop(0)


@app.route('/compliance/audit-log', methods=['GET'])
def get_audit_log():
    """Get audit log entries"""
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    user_id = request.args.get('user_id')
    action = request.args.get('action')
    resource_type = request.args.get('resource_type')
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)

    if not lite_mode and router:
        try:
            query = """
                SELECT id, timestamp, user_id, action, resource_type,
                       resource_id, details, success
                FROM audit_log
                WHERE 1=1
            """
            params = []

            if start_date:
                params.append(start_date)
                query += f" AND timestamp >= TO_TIMESTAMP(:{len(params)}, 'YYYY-MM-DD')"
            if end_date:
                params.append(end_date)
                query += f" AND timestamp <= TO_TIMESTAMP(:{len(params)}, 'YYYY-MM-DD')"
            if user_id:
                params.append(user_id)
                query += f" AND user_id = :{len(params)}"
            if action:
                params.append(action)
                query += f" AND action = :{len(params)}"
            if resource_type:
                params.append(resource_type)
                query += f" AND resource_type = :{len(params)}"

            query += f" ORDER BY timestamp DESC OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"

            router.cursor.execute(query, params)

            entries = []
            for row in router.cursor:
                entries.append({
                    'id': row[0],
                    'timestamp': row[1].isoformat() if row[1] else None,
                    'user_id': row[2],
                    'action': row[3],
                    'resource_type': row[4],
                    'resource_id': row[5],
                    'details': row[6] if row[6] else {},
                    'success': row[7] == 'Y'
                })

            return jsonify({'entries': entries})
        except Exception as e:
            print(f"Failed to get audit log: {e}")

    # Filter in-memory audit log
    entries = _audit_log.copy()

    if start_date:
        entries = [e for e in entries if e['timestamp'] >= start_date]
    if end_date:
        entries = [e for e in entries if e['timestamp'] <= end_date]
    if user_id:
        entries = [e for e in entries if e['user_id'] == user_id]
    if action:
        entries = [e for e in entries if e['action'] == action]
    if resource_type:
        entries = [e for e in entries if e['resource_type'] == resource_type]

    # Sort by timestamp descending
    entries.sort(key=lambda x: x['timestamp'], reverse=True)

    return jsonify({
        'entries': entries[offset:offset + limit],
        'total': len(entries),
        'lite_mode': lite_mode
    })


@app.route('/compliance/report', methods=['GET'])
def get_compliance_report():
    """Get compliance report"""
    project_id = request.args.get('project_id', 'default')

    # Generate report
    import random

    # Count security issues from rules violations (simulated)
    security_issues = {
        'critical': 0,
        'high': random.randint(1, 3),
        'medium': random.randint(2, 6),
        'low': random.randint(5, 10)
    }

    # Audit summary
    recent_entries = [e for e in _audit_log if e['timestamp'] >= time.strftime('%Y-%m-%dT00:00:00Z',
                     time.localtime(time.time() - 7 * 86400))]
    failed_entries = [e for e in recent_entries if not e['success']]
    unique_users = len(set(e['user_id'] for e in recent_entries))

    # Calculate compliance score
    base_score = 100
    base_score -= security_issues['critical'] * 20
    base_score -= security_issues['high'] * 10
    base_score -= security_issues['medium'] * 3
    base_score -= security_issues['low'] * 1
    base_score -= len(failed_entries) * 2
    compliance_score = max(0, min(100, base_score))

    report = {
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'project_id': project_id,
        'project_name': project_id,
        'compliance_score': compliance_score,
        'pii_warnings_count': random.randint(0, 5),
        'security_issues': security_issues,
        'audit_summary': {
            'total_actions': len(recent_entries),
            'failed_actions': len(failed_entries),
            'unique_users': unique_users
        },
        'recommendations': [
            'Review and address high-severity security issues',
            'Implement regular security scanning in CI/CD pipeline',
            'Enable audit logging for all sensitive operations',
            'Review user permissions quarterly'
        ],
        'pii_warnings': [],
        'security_issues_list': [
            {
                'id': 'sec-1',
                'category': 'Security',
                'severity': 'high',
                'title': 'Potential vulnerability detected',
                'description': 'Review code for security best practices',
                'recommendation': 'Run security scanner and address findings',
                'detected_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'status': 'open'
            }
        ],
        'lite_mode': lite_mode
    }

    return jsonify(report)


@app.route('/compliance/export', methods=['POST'])
def export_compliance_data():
    """Export compliance data"""
    data = request.json or {}
    export_type = data.get('type', 'audit_log')
    format_type = data.get('format', 'json')

    if export_type == 'audit_log':
        entries = _audit_log.copy()
        if format_type == 'csv':
            import io
            output = io.StringIO()
            output.write('Timestamp,User,Action,Resource,Success\n')
            for e in entries:
                output.write(f"{e['timestamp']},{e['user_id']},{e['action']},{e['resource_type']},{e['success']}\n")
            return jsonify({'content': output.getvalue(), 'filename': 'audit_log.csv'})
        else:
            return jsonify({'content': entries, 'filename': 'audit_log.json'})

    return jsonify({'error': 'Unknown export type'}), 400


@app.route('/compliance/issues/<issue_id>', methods=['PUT'])
def update_compliance_issue(issue_id):
    """Update compliance issue status"""
    data = request.json or {}
    status = data.get('status')

    if status not in ['open', 'acknowledged', 'resolved', 'false_positive']:
        return jsonify({'error': 'Invalid status'}), 400

    _log_audit('update_issue', 'compliance_issue', issue_id, {'status': status})

    return jsonify({'updated': True, 'issue_id': issue_id, 'status': status})


# Initialize on startup
init_router()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050, debug=True)
