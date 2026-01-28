-- MCP Server Registry - Default Servers
-- Run after schema creation

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('filesystem', 'filesystem',
 'Access and manipulate files and directories on the local filesystem. Read, write, search, and manage project files.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('read_file', 'write_file', 'list_directory', 'create_directory',
                              'delete_file', 'move_file', 'search_files', 'get_file_info'),
   'use_cases' VALUE JSON_ARRAY('file management', 'code navigation', 'log analysis', 'config editing')
 ),
 JSON_OBJECT('allowed_directories' VALUE JSON_ARRAY('/workspace', '/projects')),
 'npx -y @modelcontextprotocol/server-filesystem',
 1.0
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('github', 'git',
 'Interact with GitHub repositories, issues, pull requests, and actions. Complete GitHub workflow automation.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('create_repository', 'create_issue', 'create_pull_request',
                              'search_repositories', 'get_file_contents', 'push_files',
                              'fork_repository', 'create_branch', 'manage_workflows'),
   'use_cases' VALUE JSON_ARRAY('version control', 'collaboration', 'CI/CD', 'issue tracking', 'code review')
 ),
 JSON_OBJECT('auth' VALUE 'github_token_required'),
 'npx -y @modelcontextprotocol/server-github',
 0.95
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('postgresql', 'database',
 'Query and manage PostgreSQL databases. Execute SQL, manage schemas, and analyze data.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('execute_query', 'list_tables', 'describe_table',
                              'create_table', 'insert_data', 'export_data', 'analyze_performance'),
   'use_cases' VALUE JSON_ARRAY('database management', 'data analysis', 'migrations', 'ETL', 'reporting')
 ),
 JSON_OBJECT('connection_string' VALUE 'postgresql://user:pass@host:5432/db'),
 'npx -y @modelcontextprotocol/server-postgres',
 0.95
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('memory', 'knowledge_base',
 'Store and retrieve persistent knowledge graphs and entities. Long-term context and relationship tracking.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('create_entity', 'create_relation', 'search_entities',
                              'open_entities', 'add_observations', 'query_graph'),
   'use_cases' VALUE JSON_ARRAY('context persistence', 'knowledge management', 'relationship tracking', 'learning history')
 ),
 JSON_OBJECT(),
 'npx -y @modelcontextprotocol/server-memory',
 0.98
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('puppeteer', 'browser_automation',
 'Control headless Chrome for web scraping and testing. Automate browser interactions.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('navigate', 'screenshot', 'click', 'fill_form',
                              'execute_script', 'extract_content', 'wait_for_element'),
   'use_cases' VALUE JSON_ARRAY('web scraping', 'automated testing', 'screenshot generation', 'form filling', 'monitoring')
 ),
 JSON_OBJECT(),
 'npx -y @modelcontextprotocol/server-puppeteer',
 0.90
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('slack', 'communication',
 'Send messages, read channels, and manage Slack workspace. Full team communication automation.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('send_message', 'list_channels', 'read_channel_history',
                              'create_channel', 'invite_user', 'upload_file', 'set_reminders'),
   'use_cases' VALUE JSON_ARRAY('team communication', 'notifications', 'workflow automation', 'alerts', 'status updates')
 ),
 JSON_OBJECT('auth' VALUE 'slack_token_required'),
 'npx -y @modelcontextprotocol/server-slack',
 0.92
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('brave-search', 'search',
 'Perform web searches using Brave Search API. Research and information gathering.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('web_search', 'local_search', 'news_search', 'image_search'),
   'use_cases' VALUE JSON_ARRAY('research', 'information gathering', 'market analysis', 'news monitoring', 'competitive intelligence')
 ),
 JSON_OBJECT('auth' VALUE 'brave_api_key_required'),
 'npx -y @modelcontextprotocol/server-brave-search',
 0.95
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('sequential-thinking', 'reasoning',
 'Enable dynamic and reflective problem-solving through thought sequences. Multi-step reasoning support.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('think_sequentially', 'reflect', 'revise_thinking', 'chain_of_thought'),
   'use_cases' VALUE JSON_ARRAY('complex problem solving', 'strategic planning', 'multi-step reasoning', 'decision analysis')
 ),
 JSON_OBJECT(),
 'npx -y @modelcontextprotocol/server-sequential-thinking',
 0.92
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('git', 'git',
 'Execute Git commands and manage local repositories. Version control operations.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('commit', 'push', 'pull', 'branch', 'merge', 'log', 'diff', 'status'),
   'use_cases' VALUE JSON_ARRAY('version control', 'code management', 'branching strategy', 'history tracking')
 ),
 JSON_OBJECT(),
 'npx -y @modelcontextprotocol/server-git',
 0.98
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('sqlite', 'database',
 'Manage SQLite databases. Lightweight database operations for local data.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('execute_query', 'create_table', 'insert_data', 'analyze_schema'),
   'use_cases' VALUE JSON_ARRAY('local data storage', 'prototyping', 'testing', 'small datasets')
 ),
 JSON_OBJECT(),
 'npx -y @modelcontextprotocol/server-sqlite',
 0.98
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('google-drive', 'cloud_storage',
 'Access and manage Google Drive files and folders. Read docs, sheets, and collaborate on files.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('search_files', 'read_file', 'create_file', 'update_file',
                              'list_folder', 'share_file', 'download_file', 'manage_permissions'),
   'use_cases' VALUE JSON_ARRAY('document management', 'collaboration', 'backup', 'data access', 'team sharing')
 ),
 JSON_OBJECT('auth' VALUE 'google_oauth_required'),
 'npx -y @modelcontextprotocol/server-gdrive',
 0.90
);

INSERT INTO mcp_server_registry (
    server_name, server_type, description, capabilities,
    connection_config, install_command, reliability_score
) VALUES
('aws-kb-retrieval', 'knowledge_base',
 'Retrieve information from AWS Knowledge Bases. Enterprise RAG and document search.',
 JSON_OBJECT(
   'actions' VALUE JSON_ARRAY('retrieve', 'retrieve_and_generate', 'semantic_search'),
   'use_cases' VALUE JSON_ARRAY('enterprise knowledge retrieval', 'RAG applications', 'documentation search', 'policy lookup')
 ),
 JSON_OBJECT('auth' VALUE 'aws_credentials_required'),
 'npx -y @modelcontextprotocol/server-aws-kb-retrieval',
 0.92
);

COMMIT;
