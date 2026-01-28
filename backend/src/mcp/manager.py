"""
MCP Server Management
Handles registration, recommendation, and configuration of MCP servers
"""

import json
from typing import Dict, List, Optional
import numpy as np


class MCPServerManager:
    """Manage MCP servers and tool recommendations"""

    def __init__(self, cursor, embedding_model):
        self.cursor = cursor
        self.embedding_model = embedding_model

    def recommend_tools_for_project(
        self,
        project_type: str,
        tech_stack: List[str],
        requirements: List[str]
    ) -> Dict[str, List[Dict]]:
        """Recommend MCP servers based on project characteristics"""

        # Build search query from project info
        search_text = f"{project_type} {' '.join(tech_stack)} {' '.join(requirements)}"
        embedding = self.embedding_model.encode(search_text)

        # Find similar MCP servers
        self.cursor.execute("""
            SELECT
                server_name,
                server_type,
                description,
                capabilities,
                install_command,
                VECTOR_DISTANCE(capability_embedding, :embedding, EUCLIDEAN) as distance
            FROM mcp_server_registry
            WHERE reliability_score > 0.8
            ORDER BY distance ASC
            FETCH FIRST 10 ROWS ONLY
        """, {'embedding': np.array(embedding, dtype=np.float32)})

        candidates = []
        for row in self.cursor:
            candidates.append({
                'name': row[0],
                'type': row[1],
                'description': row[2],
                'capabilities': json.loads(row[3]) if row[3] else {},
                'install_command': row[4],
                'distance': float(row[5])
            })

        # Categorize as essential vs recommended
        essential = []
        recommended = []

        for tool in candidates:
            if self._is_essential(tool, tech_stack, requirements):
                essential.append({**tool, 'reason': 'Essential for your tech stack'})
            elif tool['distance'] < 0.5:
                recommended.append({**tool, 'reason': 'Recommended based on project type'})

        return {
            'essential': essential,
            'recommended': recommended[:5]  # Max 5 recommended
        }

    def _is_essential(
        self,
        tool: Dict,
        tech_stack: List[str],
        requirements: List[str]
    ) -> bool:
        """Determine if a tool is essential"""

        # Always essential
        if tool['name'] in ['filesystem', 'github', 'memory']:
            return True

        # Stack-specific essentials
        stack_lower = [s.lower() for s in tech_stack]
        req_lower = [r.lower() for r in requirements]

        if tool['name'] == 'postgresql' and any('postgres' in s or 'sql' in s for s in stack_lower):
            return True
        if tool['name'] == 'slack' and any('team' in r or 'collaboration' in r for r in req_lower):
            return True
        if tool['name'] == 'puppeteer' and any('testing' in r or 'e2e' in r for r in req_lower):
            return True
        if tool['name'] == 'brave-search' and any('research' in r for r in req_lower):
            return True

        return False

    def add_tool_to_project(
        self,
        project_id: str,
        tool_name: str,
        reason: str
    ):
        """Add MCP server to project's tool stack"""

        self.cursor.execute("""
            MERGE INTO project_tool_stack pts
            USING (SELECT :1 as project_id, :2 as tool_id FROM dual) src
            ON (pts.project_id = src.project_id AND pts.tool_identifier = src.tool_id)
            WHEN NOT MATCHED THEN
                INSERT (project_id, tool_identifier, tool_type, reason_for_inclusion, is_active)
                SELECT :1, server_name, server_type, :3, 'Y'
                FROM mcp_server_registry
                WHERE server_name = :2
            WHEN MATCHED THEN
                UPDATE SET is_active = 'Y', reason_for_inclusion = :3
        """, [project_id, tool_name, reason])

    def remove_tool_from_project(
        self,
        project_id: str,
        tool_name: str
    ):
        """Remove/deactivate tool from project"""

        self.cursor.execute("""
            UPDATE project_tool_stack
            SET is_active = 'N'
            WHERE project_id = :1 AND tool_identifier = :2
        """, [project_id, tool_name])

    def record_tool_usage(
        self,
        project_id: str,
        tool_name: str,
        success: bool = True
    ):
        """Record tool usage for analytics"""

        self.cursor.execute("""
            UPDATE project_tool_stack
            SET
                usage_count = usage_count + 1,
                success_count = success_count + :3,
                last_used = CURRENT_TIMESTAMP
            WHERE project_id = :1 AND tool_identifier = :2
        """, [project_id, tool_name, 1 if success else 0])

        # Update MCP server metrics
        self.cursor.execute("""
            UPDATE mcp_server_registry
            SET
                total_uses = total_uses + 1,
                success_rate = (
                    SELECT AVG(CASE WHEN success_count > 0 THEN success_count::float / usage_count ELSE 1 END)
                    FROM project_tool_stack
                    WHERE tool_identifier = :1
                )
            WHERE server_name = :1
        """, [tool_name])

    def get_project_tools(self, project_id: str) -> List[Dict]:
        """Get all tools for a project"""

        self.cursor.execute("""
            SELECT
                pts.tool_identifier,
                pts.tool_type,
                msr.description,
                pts.usage_count,
                pts.success_count,
                pts.is_active,
                msr.install_command
            FROM project_tool_stack pts
            LEFT JOIN mcp_server_registry msr ON pts.tool_identifier = msr.server_name
            WHERE pts.project_id = :1
            ORDER BY pts.usage_count DESC
        """, [project_id])

        tools = []
        for row in self.cursor:
            tools.append({
                'name': row[0],
                'type': row[1],
                'description': row[2],
                'usage_count': row[3] or 0,
                'success_count': row[4] or 0,
                'is_active': row[5] == 'Y',
                'install_command': row[6]
            })

        return tools
