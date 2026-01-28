"""
Flask API Service for AI Development Infrastructure
Supports both full mode (with Oracle DB) and lite mode (without DB)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import time
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
    global router, lite_mode

    try:
        from ..router.intelligent_router import IntelligentAgentRouter
        router = IntelligentAgentRouter()
        lite_mode = False
        print("✓ Full mode: Connected to Oracle database")
    except Exception as e:
        router = None
        lite_mode = True
        print(f"⚠ Lite mode: Database unavailable ({type(e).__name__})")


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
    """Find best agent for a task"""
    task_lower = task.lower()

    # Match by type if specified
    if agent_type:
        for agent in DEFAULT_AGENTS:
            if agent['type'] == agent_type:
                return agent

    # Match by keywords
    if any(kw in task_lower for kw in ['review', 'security', 'vulnerability']):
        return DEFAULT_AGENTS[0]  # Code Review
    if any(kw in task_lower for kw in ['refactor', 'clean', 'improve structure']):
        return DEFAULT_AGENTS[1]  # Refactoring
    if any(kw in task_lower for kw in ['test', 'coverage', 'unit test']):
        return DEFAULT_AGENTS[2]  # Testing
    if any(kw in task_lower for kw in ['architect', 'design', 'scale']):
        return DEFAULT_AGENTS[3]  # Architecture
    if any(kw in task_lower for kw in ['bug', 'debug', 'fix', 'error']):
        return DEFAULT_AGENTS[4]  # Debugging

    # Default to code review
    return DEFAULT_AGENTS[0]


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

    # For lite mode or Ollama routing, return simulated response
    if lite_mode or route == 'ollama':
        agent = find_agent_for_task(task, agent_type)
        execution_time = int((time.time() - start_time) * 1000)

        # In lite mode, we can't actually call the AI, so return a helpful message
        if lite_mode:
            return jsonify({
                'route': route,
                'agent': agent['name'],
                'agent_type': agent['type'],
                'result': f"[Lite Mode] Task received: '{task[:100]}...'\n\n"
                         f"Agent '{agent['name']}' would process this task.\n"
                         f"Start the Oracle database for full functionality.",
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

        if project_id and not lite_mode:
            router.assign_agent_to_project(
                agent['agent_id'],
                project_id,
                role=agent_type or 'general',
                reason='API request'
            )

        result = router.query_claude(
            task,
            agent_id=agent.get('agent_id'),
            project_id=project_id,
            use_tools=use_tools
        )

        return jsonify({
            'route': 'claude',
            'agent': agent['name'],
            'agent_type': agent['type'],
            'result': result.get('response', ''),
            'metrics': {
                'tokens': result.get('tokens_used', 0),
                'time_ms': result.get('execution_time_ms', 0)
            }
        })
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


# Initialize on startup
init_router()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050, debug=True)
