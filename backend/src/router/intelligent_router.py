"""
Intelligent Agent Router
Routes queries to optimal AI system (Ollama, Claude, Oracle) and manages agents.
"""

import os
import json
import time
import hashlib
from typing import Dict, Optional, List, Any, Literal
from datetime import datetime

import oracledb
import ollama
import anthropic
from sentence_transformers import SentenceTransformer
import numpy as np
from dotenv import load_dotenv

load_dotenv()


class IntelligentAgentRouter:
    """
    Intelligent routing system with:
    - Ollama for simple tasks
    - Claude API for complex development tasks
    - Oracle AI for database operations
    - Central agent repository with learning
    """

    def __init__(
        self,
        oracle_config: Optional[Dict[str, str]] = None,
        anthropic_api_key: Optional[str] = None
    ):
        # Initialize Oracle connection
        if not oracle_config:
            oracle_config = {
                'user': os.getenv('ORACLE_USER', 'aidev'),
                'password': os.getenv('ORACLE_PASSWORD', 'AiDev123'),
                'dsn': os.getenv('ORACLE_DSN', 'localhost:1521/FREEPDB1')
            }

        self.connection = oracledb.connect(**oracle_config)
        self.cursor = self.connection.cursor()

        # Initialize Claude API
        api_key = anthropic_api_key or os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise ValueError("Anthropic API key required")
        self.claude_client = anthropic.Anthropic(api_key=api_key)

        # Initialize Ollama client
        ollama_host = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
        self.ollama_client = ollama.Client(host=ollama_host)

        # Initialize embedding model
        self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')

        # Classification keywords
        self.simple_keywords = [
            'summarize', 'summary', 'tldr', 'brief', 'short',
            'classify', 'category', 'type', 'intent',
            'simple', 'quick', 'basic', 'what is', 'define',
            'translate', 'extract', 'convert', 'format', 'list'
        ]

        self.complex_keywords = [
            'develop', 'build', 'create code', 'implement', 'refactor',
            'architect', 'design', 'analyze deeply', 'reason about',
            'strategic', 'complex', 'debug', 'optimize', 'review code'
        ]

        self.oracle_keywords = [
            'sql', 'database', 'query data', 'analyze database',
            'schema', 'migration', 'graph', 'aggregate', 'join'
        ]

    def classify_query_complexity(
        self,
        query: str
    ) -> Literal['ollama', 'claude', 'oracle']:
        """Route query to appropriate AI system"""
        query_lower = query.lower()

        # Check for Oracle AI tasks
        if any(kw in query_lower for kw in self.oracle_keywords):
            return 'oracle'

        # Check for complex tasks (Claude)
        complex_score = sum(1 for kw in self.complex_keywords if kw in query_lower)
        if complex_score >= 2:
            return 'claude'

        # Check for simple tasks (Ollama)
        simple_score = sum(1 for kw in self.simple_keywords if kw in query_lower)
        if simple_score >= 2:
            return 'ollama'

        # Length-based heuristic
        if len(query.split()) < 20:
            return 'ollama'

        # Default to Claude for unknown/complex
        return 'claude' if any(
            word in query_lower for word in ['code', 'develop', 'build']
        ) else 'ollama'

    # === AGENT MANAGEMENT ===

    def create_agent(
        self,
        name: str,
        agent_type: str,
        purpose: str,
        system_prompt: str,
        tools_enabled: Optional[List[str]] = None,
        model_config: Optional[Dict] = None
    ) -> int:
        """Create a new development agent"""
        embedding = self.embedding_model.encode(
            purpose + " " + system_prompt
        ).tolist()

        default_config = {
            'model': 'claude-sonnet-4-20250514',
            'max_tokens': 4096,
            'temperature': 1.0
        }
        config = {**default_config, **(model_config or {})}

        self.cursor.execute("""
            INSERT INTO agent_repository
            (agent_name, agent_type, agent_purpose, system_prompt,
             tools_enabled, agent_embedding, model_config)
            VALUES (:1, :2, :3, :4, :5, :6, :7)
            RETURNING id INTO :8
        """, [
            name, agent_type, purpose, system_prompt,
            json.dumps(tools_enabled or ['bash', 'text_editor']),
            np.array(embedding, dtype=np.float32),
            json.dumps(config),
            self.cursor.var(int)
        ])

        agent_id = self.cursor.getvalue(7)
        self.connection.commit()
        return agent_id

    def find_best_agent_for_task(
        self,
        task_description: str,
        project_id: Optional[str] = None,
        agent_type: Optional[str] = None
    ) -> Optional[Dict]:
        """Find most suitable agent using vector similarity and performance"""
        task_embedding = self.embedding_model.encode(task_description).tolist()

        # Build query
        query = """
            SELECT
                id, agent_name, agent_type, system_prompt, tools_enabled,
                success_rate, total_tasks_completed,
                VECTOR_DISTANCE(agent_embedding, :embedding, EUCLIDEAN) as distance
            FROM agent_repository
            WHERE 1=1
        """
        params = {'embedding': np.array(task_embedding, dtype=np.float32)}

        if agent_type:
            query += " AND agent_type = :agent_type"
            params['agent_type'] = agent_type

        query += """
            ORDER BY
                distance ASC,
                success_rate DESC NULLS LAST,
                routing_priority DESC
            FETCH FIRST 1 ROWS ONLY
        """

        self.cursor.execute(query, params)
        row = self.cursor.fetchone()

        if not row:
            return None

        return {
            'agent_id': row[0],
            'name': row[1],
            'type': row[2],
            'system_prompt': row[3],
            'tools_enabled': json.loads(row[4]) if row[4] else [],
            'success_rate': float(row[5] or 0.0),
            'tasks_completed': row[6] or 0,
            'similarity_distance': float(row[7])
        }

    def assign_agent_to_project(
        self,
        agent_id: int,
        project_id: str,
        role: str,
        reason: str
    ):
        """Assign agent to project"""
        self.cursor.execute("""
            MERGE INTO project_agent_assignments t
            USING (SELECT :1 as project_id, :2 as agent_id FROM dual) s
            ON (t.project_id = s.project_id AND t.agent_id = s.agent_id)
            WHEN MATCHED THEN
                UPDATE SET is_active = 'Y', last_active = CURRENT_TIMESTAMP
            WHEN NOT MATCHED THEN
                INSERT (project_id, agent_id, assigned_role, assignment_reason)
                VALUES (:1, :2, :3, :4)
        """, [project_id, agent_id, role, reason])
        self.connection.commit()

    # === QUERY EXECUTION ===

    def query_ollama(
        self,
        query: str,
        task_type: str = 'general'
    ) -> str:
        """Execute simple task using local Ollama"""
        start_time = time.time()

        system_prompts = {
            'summarize': 'You are a concise summarization assistant.',
            'classify': 'You are a classification assistant.',
            'preprocess': 'You are a text preprocessing assistant.',
            'general': 'You are a helpful assistant. Be concise and accurate.'
        }

        response = self.ollama_client.chat(
            model='llama3.2:3b',
            messages=[
                {
                    'role': 'system',
                    'content': system_prompts.get(task_type, system_prompts['general'])
                },
                {'role': 'user', 'content': query}
            ]
        )

        processing_time = int((time.time() - start_time) * 1000)
        self._log_routing('ollama', query, processing_time)

        return response['message']['content']

    def query_claude(
        self,
        prompt: str,
        agent_id: Optional[int] = None,
        project_id: Optional[str] = None,
        use_tools: bool = True,
        conversation_history: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """Execute task using Claude API with agent context"""
        start_time = time.time()

        # Get agent configuration
        agent_context = self._get_agent_context(agent_id) if agent_id else {}
        system_prompt = agent_context.get(
            'system_prompt',
            "You are an expert software development assistant."
        )

        # Build messages
        messages = conversation_history or []
        messages.append({"role": "user", "content": prompt})

        # Configure tools
        tools = None
        if use_tools:
            tools = [
                {"type": "bash_20250124", "name": "bash"},
                {"type": "text_editor_20250124", "name": "text_editor"}
            ]

        try:
            response = self.claude_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=16000,
                system=system_prompt,
                messages=messages,
                tools=tools if tools else anthropic.NOT_GIVEN
            )

            processing_time = int((time.time() - start_time) * 1000)

            # Extract response components
            response_text = ""
            thinking_text = ""
            tool_uses = []

            for block in response.content:
                if block.type == "text":
                    response_text += block.text
                elif hasattr(block, 'thinking'):
                    thinking_text = block.thinking
                elif block.type == "tool_use":
                    tool_uses.append({'tool': block.name, 'input': block.input})

            result = {
                'response': response_text,
                'thinking': thinking_text,
                'tool_uses': tool_uses,
                'execution_time_ms': processing_time,
                'tokens_used': response.usage.input_tokens + response.usage.output_tokens,
                'stop_reason': response.stop_reason
            }

            # Record execution for learning
            if agent_id and project_id:
                self._record_agent_execution(
                    agent_id, project_id, prompt, result,
                    processing_time, result['tokens_used']
                )

            self._log_routing('claude', prompt, processing_time, agent_id)

            return result

        except Exception as e:
            return {
                'response': '',
                'error': str(e),
                'execution_time_ms': int((time.time() - start_time) * 1000)
            }

    # === LEARNING & IMPROVEMENT ===

    def _record_agent_execution(
        self,
        agent_id: int,
        project_id: str,
        task: str,
        result: Dict,
        execution_time: float,
        tokens: int,
        success: bool = True,
        feedback_score: Optional[int] = None
    ):
        """Record execution and update agent metrics"""
        # Calculate cost (approximate Claude Sonnet pricing)
        cost = (tokens / 1_000_000) * 3.00

        # Record execution
        self.cursor.execute("""
            INSERT INTO agent_execution_history
            (agent_id, project_id, task_description, output_result,
             execution_time_ms, token_usage, cost_usd, success,
             user_feedback_score, learned_insights)
            VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10)
        """, [
            agent_id, project_id, task[:4000], result.get('response', '')[:4000],
            execution_time, tokens, cost, 'Y' if success else 'N',
            feedback_score, result.get('thinking', '')[:4000]
        ])

        # Update agent metrics
        self.cursor.execute("""
            UPDATE agent_repository
            SET
                total_tasks_completed = total_tasks_completed + 1,
                success_rate = (
                    SELECT AVG(CASE WHEN success = 'Y' THEN 1 ELSE 0 END)
                    FROM agent_execution_history WHERE agent_id = :1
                ),
                average_execution_time_ms = (
                    SELECT AVG(execution_time_ms)
                    FROM agent_execution_history WHERE agent_id = :1
                ),
                last_used = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :1
        """, [agent_id])

        # Update project assignment
        self.cursor.execute("""
            UPDATE project_agent_assignments
            SET
                project_tasks_completed = project_tasks_completed + 1,
                project_success_rate = (
                    SELECT AVG(CASE WHEN success = 'Y' THEN 1 ELSE 0 END)
                    FROM agent_execution_history
                    WHERE agent_id = :1 AND project_id = :2
                ),
                last_active = CURRENT_TIMESTAMP
            WHERE agent_id = :1 AND project_id = :2
        """, [agent_id, project_id])

        self.connection.commit()

        # Create learning checkpoint if needed
        self._maybe_create_checkpoint(agent_id)

    def _maybe_create_checkpoint(self, agent_id: int):
        """Create checkpoint every 10 tasks"""
        self.cursor.execute("""
            SELECT total_tasks_completed FROM agent_repository WHERE id = :1
        """, [agent_id])

        row = self.cursor.fetchone()
        if row:
            total_tasks = row[0] or 0
            if total_tasks > 0 and total_tasks % 10 == 0:
                self._create_learning_checkpoint(agent_id)

    def _create_learning_checkpoint(self, agent_id: int):
        """Snapshot agent's learning state"""
        # Get next version
        self.cursor.execute("""
            SELECT COALESCE(MAX(checkpoint_version), 0) + 1
            FROM agent_learning_checkpoints WHERE agent_id = :1
        """, [agent_id])
        next_version = self.cursor.fetchone()[0]

        # Get current performance
        self.cursor.execute("""
            SELECT success_rate, average_execution_time_ms, total_tasks_completed
            FROM agent_repository WHERE id = :1
        """, [agent_id])

        row = self.cursor.fetchone()
        if not row:
            return

        performance_snapshot = {
            'success_rate': float(row[0] or 0.0),
            'avg_time_ms': float(row[1] or 0.0),
            'total_tasks': row[2] or 0,
            'timestamp': datetime.now().isoformat()
        }

        self.cursor.execute("""
            INSERT INTO agent_learning_checkpoints
            (agent_id, checkpoint_version, performance_snapshot,
             tasks_since_last_checkpoint)
            VALUES (:1, :2, :3, 10)
        """, [agent_id, next_version, json.dumps(performance_snapshot)])

        self.connection.commit()
        print(f"✓ Checkpoint v{next_version} created for agent {agent_id}")

    def get_agent_learning_summary(self, agent_id: int) -> Dict:
        """Get agent's learning progress"""
        self.cursor.execute("""
            SELECT
                a.agent_name, a.total_tasks_completed, a.success_rate,
                a.average_execution_time_ms,
                COUNT(DISTINCT c.id) as checkpoints,
                MAX(c.improvement_percentage) as best_improvement
            FROM agent_repository a
            LEFT JOIN agent_learning_checkpoints c ON a.id = c.agent_id
            WHERE a.id = :1
            GROUP BY a.agent_name, a.total_tasks_completed,
                     a.success_rate, a.average_execution_time_ms
        """, [agent_id])

        row = self.cursor.fetchone()
        if not row:
            return {}

        return {
            'agent_name': row[0],
            'total_tasks': row[1] or 0,
            'success_rate': float(row[2] or 0.0),
            'avg_time_ms': float(row[3] or 0.0),
            'checkpoints': row[4] or 0,
            'best_improvement': float(row[5] or 0.0)
        }

    # === UTILITIES ===

    def _get_agent_context(self, agent_id: int) -> Dict:
        """Retrieve agent configuration"""
        self.cursor.execute("""
            SELECT agent_name, system_prompt, tools_enabled, learned_patterns
            FROM agent_repository WHERE id = :1
        """, [agent_id])

        row = self.cursor.fetchone()
        if not row:
            return {}

        return {
            'name': row[0],
            'system_prompt': row[1],
            'tools_enabled': json.loads(row[2] or '[]'),
            'learned_patterns': json.loads(row[3] or '{}')
        }

    def _log_routing(
        self,
        route: str,
        query: str,
        time_ms: float,
        agent_id: Optional[int] = None
    ):
        """Log routing decision"""
        self.cursor.execute("""
            INSERT INTO routing_logs
            (query_text, route_decision, processing_time_ms)
            VALUES (:1, :2, :3)
        """, [query[:1000], route, time_ms])
        self.connection.commit()

    def close(self):
        """Close connections"""
        self.cursor.close()
        self.connection.close()
