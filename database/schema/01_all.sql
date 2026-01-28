-- AI Development Infrastructure - Complete Database Schema
-- Oracle AI Database 26ai

-- Connect as SYSDBA first to create user
-- sqlplus sys/YourPassword123@localhost:1521/FREEPDB1 as sysdba

-- Create application user
CREATE USER aidev IDENTIFIED BY AiDev123;
GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE TO aidev;
GRANT CREATE VIEW, CREATE PROCEDURE TO aidev;

-- Connect as application user
-- CONNECT aidev/AiDev123@localhost:1521/FREEPDB1;

-- ===========================================
-- AGENT REPOSITORY TABLES
-- ===========================================

-- Central Agent Repository
CREATE TABLE agent_repository (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_name VARCHAR2(200) UNIQUE NOT NULL,
    agent_type VARCHAR2(100),
    agent_purpose CLOB,
    system_prompt CLOB,
    tools_enabled JSON,
    agent_embedding VECTOR(1024, FLOAT32),

    -- Performance metrics
    total_tasks_completed NUMBER DEFAULT 0,
    success_rate NUMBER DEFAULT 0.0,
    average_execution_time_ms NUMBER,
    last_used TIMESTAMP,

    -- Learning data
    learned_patterns JSON,
    improvement_log CLOB,

    -- Configuration
    model_config JSON,
    routing_priority NUMBER DEFAULT 5,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE VECTOR INDEX agent_repo_vector_idx ON agent_repository(agent_embedding)
ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE EUCLIDEAN;

CREATE INDEX agent_type_idx ON agent_repository(agent_type);
CREATE INDEX agent_success_idx ON agent_repository(success_rate DESC);

-- Agent Execution History
CREATE TABLE agent_execution_history (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id NUMBER NOT NULL,
    project_id VARCHAR2(200),
    task_description CLOB,
    input_context CLOB,
    output_result CLOB,

    -- Execution metrics
    execution_time_ms NUMBER,
    token_usage NUMBER,
    cost_usd NUMBER(10,6),

    -- Quality metrics
    success CHAR(1) DEFAULT 'Y',
    user_feedback_score NUMBER,
    error_message CLOB,

    -- Learning data
    context_before CLOB,
    learned_insights CLOB,

    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_agent_exec FOREIGN KEY (agent_id)
        REFERENCES agent_repository(id) ON DELETE CASCADE
);

CREATE INDEX agent_exec_agent_idx ON agent_execution_history(agent_id);
CREATE INDEX agent_exec_project_idx ON agent_execution_history(project_id);
CREATE INDEX agent_exec_time_idx ON agent_execution_history(timestamp DESC);

-- Agent Learning Checkpoints
CREATE TABLE agent_learning_checkpoints (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id NUMBER NOT NULL,
    checkpoint_version NUMBER,

    -- State snapshot
    learned_capabilities CLOB,
    performance_snapshot JSON,
    prompt_refinements CLOB,

    -- Comparison data
    tasks_since_last_checkpoint NUMBER,
    improvement_percentage NUMBER,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_agent_checkpoint FOREIGN KEY (agent_id)
        REFERENCES agent_repository(id) ON DELETE CASCADE
);

-- ===========================================
-- PROJECT MANAGEMENT TABLES
-- ===========================================

-- Project Agent Assignments
CREATE TABLE project_agent_assignments (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id VARCHAR2(200) NOT NULL,
    agent_id NUMBER NOT NULL,

    -- Assignment details
    assigned_role VARCHAR2(100),
    assignment_reason CLOB,
    is_active CHAR(1) DEFAULT 'Y',

    -- Performance in this project
    project_success_rate NUMBER DEFAULT 0.0,
    project_tasks_completed NUMBER DEFAULT 0,

    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP,

    CONSTRAINT fk_proj_agent FOREIGN KEY (agent_id)
        REFERENCES agent_repository(id) ON DELETE CASCADE,

    CONSTRAINT uk_project_agent UNIQUE (project_id, agent_id)
);

CREATE INDEX proj_assign_project_idx ON project_agent_assignments(project_id);
CREATE INDEX proj_assign_active_idx ON project_agent_assignments(is_active, project_id);

-- Project Scope History
CREATE TABLE project_scope_history (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id VARCHAR2(200) NOT NULL,
    scope_version NUMBER,

    -- Scope definition
    scope_description CLOB,
    scope_embedding VECTOR(1024, FLOAT32),
    key_requirements JSON,
    technical_stack JSON,

    -- Scope change analysis
    change_type VARCHAR2(50),
    change_magnitude VARCHAR2(50),
    previous_scope_id NUMBER,

    -- Tool review triggered
    tool_review_required CHAR(1) DEFAULT 'N',
    tool_review_completed CHAR(1) DEFAULT 'N',
    tool_review_date TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR2(100)
);

CREATE VECTOR INDEX scope_embedding_idx ON project_scope_history(scope_embedding)
ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE EUCLIDEAN;

CREATE INDEX scope_project_idx ON project_scope_history(project_id);
CREATE INDEX scope_review_idx ON project_scope_history(tool_review_required, tool_review_completed);

-- ===========================================
-- MCP SERVER MANAGEMENT TABLES
-- ===========================================

-- MCP Server Registry
CREATE TABLE mcp_server_registry (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    server_name VARCHAR2(200) UNIQUE NOT NULL,
    server_type VARCHAR2(100),
    description CLOB,
    capabilities JSON,
    connection_config JSON,
    install_command VARCHAR2(1000),

    -- Capability embedding for similarity matching
    capability_embedding VECTOR(1024, FLOAT32),

    -- Performance metrics
    reliability_score NUMBER DEFAULT 1.0,
    average_response_time_ms NUMBER,
    total_uses NUMBER DEFAULT 0,
    success_rate NUMBER DEFAULT 1.0,

    -- Compatibility
    required_permissions JSON,
    dependencies JSON,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE VECTOR INDEX mcp_capability_idx ON mcp_server_registry(capability_embedding)
ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE EUCLIDEAN;

CREATE INDEX mcp_type_idx ON mcp_server_registry(server_type);
CREATE INDEX mcp_reliability_idx ON mcp_server_registry(reliability_score DESC);

-- Project Tool Stack
CREATE TABLE project_tool_stack (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id VARCHAR2(200) NOT NULL,
    tool_type VARCHAR2(50),
    tool_identifier VARCHAR2(200),

    -- Assignment details
    reason_for_inclusion CLOB,
    assigned_by VARCHAR2(100),
    scope_coverage JSON,

    -- Performance tracking
    usage_count NUMBER DEFAULT 0,
    success_count NUMBER DEFAULT 0,
    avg_execution_time_ms NUMBER,

    -- Status
    is_active CHAR(1) DEFAULT 'Y',
    activation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP,

    CONSTRAINT uk_project_tool UNIQUE (project_id, tool_type, tool_identifier)
);

CREATE INDEX proj_tool_project_idx ON project_tool_stack(project_id);
CREATE INDEX proj_tool_active_idx ON project_tool_stack(is_active, project_id);

-- Tool Recommendation Log
CREATE TABLE tool_recommendation_log (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id VARCHAR2(200) NOT NULL,
    scope_version_id NUMBER,

    -- Recommendation details
    recommended_tool VARCHAR2(200),
    tool_type VARCHAR2(50),
    recommendation_reason CLOB,
    confidence_score NUMBER,

    -- Decision
    decision VARCHAR2(50),
    decision_reason CLOB,
    decided_by VARCHAR2(100),
    decided_at TIMESTAMP,

    -- Outcome tracking
    actual_usefulness_score NUMBER,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_tool_rec_scope FOREIGN KEY (scope_version_id)
        REFERENCES project_scope_history(id) ON DELETE CASCADE
);

CREATE INDEX tool_rec_project_idx ON tool_recommendation_log(project_id);
CREATE INDEX tool_rec_decision_idx ON tool_recommendation_log(decision);

-- ===========================================
-- ROUTING AND CONVERSATION TABLES
-- ===========================================

-- Routing Logs
CREATE TABLE routing_logs (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    query_text CLOB,
    route_decision VARCHAR2(50),
    confidence_score NUMBER,
    processing_time_ms NUMBER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX routing_route_idx ON routing_logs(route_decision);
CREATE INDEX routing_time_idx ON routing_logs(timestamp DESC);

-- Conversation History
CREATE TABLE conversation_history (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id VARCHAR2(100),
    user_message CLOB,
    assistant_response CLOB,
    message_embedding VECTOR(1024, FLOAT32),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    context_metadata JSON
);

CREATE VECTOR INDEX conv_vector_idx ON conversation_history(message_embedding)
ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE EUCLIDEAN;

CREATE INDEX conv_session_idx ON conversation_history(session_id);
CREATE INDEX conv_timestamp_idx ON conversation_history(timestamp);

-- ===========================================
-- CACHING TABLES
-- ===========================================

-- Query Cache
CREATE TABLE query_cache (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    query_hash VARCHAR2(64) UNIQUE NOT NULL,
    query_text CLOB,
    response_text CLOB,
    route VARCHAR2(50),
    agent_id NUMBER,
    hit_count NUMBER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    last_hit TIMESTAMP
);

CREATE INDEX cache_hash_idx ON query_cache(query_hash);
CREATE INDEX cache_expires_idx ON query_cache(expires_at);

-- ===========================================
-- COMPLIANCE AND AUDIT TABLES
-- ===========================================

-- Compliance Audit Log
CREATE TABLE compliance_audit_log (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id VARCHAR2(100),
    action_type VARCHAR2(50),
    query_hash VARCHAR2(64),
    route VARCHAR2(50),
    agent_id NUMBER,
    response_hash VARCHAR2(64),
    pii_detected CHAR(1) DEFAULT 'N',
    security_level VARCHAR2(20),
    client_ip VARCHAR2(45),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX audit_user_idx ON compliance_audit_log(user_id);
CREATE INDEX audit_time_idx ON compliance_audit_log(timestamp DESC);

-- Token Usage Log
CREATE TABLE token_usage_log (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id VARCHAR2(100),
    day_bucket DATE DEFAULT TRUNC(SYSDATE),
    route VARCHAR2(50),
    tokens_used NUMBER,
    cost_usd NUMBER(10,6),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX token_user_day_idx ON token_usage_log(user_id, day_bucket);

-- User Roles
CREATE TABLE user_roles (
    user_id VARCHAR2(100) PRIMARY KEY,
    role VARCHAR2(50) NOT NULL,
    daily_token_limit NUMBER,
    allowed_agents JSON,
    allowed_features JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
