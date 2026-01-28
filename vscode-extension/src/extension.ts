import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios, { AxiosRequestConfig } from 'axios';

const API_TIMEOUT = 60000; // 60 seconds

// Type definitions
interface ProjectConfig {
    name: string;
    description: string;
    type: 'web' | 'api' | 'mobile' | 'fullstack' | 'data' | 'other';
    techStack: string[];
    requirements: string[];
}

interface ToolRecommendation {
    name: string;
    type: string;
    reason: string;
    install_command?: string;
}

interface AgentAssignment {
    name: string;
    type: string;
    purpose?: string;
}

interface ProjectAnalysis {
    languages: string[];
    frameworks: string[];
    databases: string[];
    hasTests: boolean;
    hasDocker: boolean;
    hasCICD: boolean;
    complexity: 'simple' | 'moderate' | 'complex';
    fileCount: number;
}

const axiosConfig: AxiosRequestConfig = {
    timeout: API_TIMEOUT
};

let chatPanel: vscode.WebviewPanel | undefined;
let dashboardPanel: vscode.WebviewPanel | undefined;

function getBackendUrl(): string {
    return vscode.workspace.getConfiguration('claudeAiDev').get('backendUrl') || 'http://localhost:5050';
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Claude AI Development Assistant is now active');

    // Register commands - get backendUrl dynamically for each call
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeAiDev.chat', () => showChat(getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.codeReview', () => executeAgentTask('code_review', getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.refactor', () => executeAgentTask('refactoring', getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.generateTests', () => executeAgentTask('testing', getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.explainCode', () => explainCode(getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.viewDashboard', () => showDashboard(getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.initializeProject', () => initializeProject(getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.importExistingProject', () => importProject(getBackendUrl())),
        vscode.commands.registerCommand('claudeAiDev.updateScope', () => updateProjectScope(getBackendUrl()))
    );
}

async function showChat(backendUrl: string) {
    if (chatPanel) {
        chatPanel.reveal();
        return;
    }

    chatPanel = vscode.window.createWebviewPanel(
        'aiChat',
        'AI Chat',
        vscode.ViewColumn.Two,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    chatPanel.webview.html = getChatHtml();

    chatPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'sendMessage') {
            await handleChatMessage(message.text, backendUrl);
        }
    });

    chatPanel.onDidDispose(() => {
        chatPanel = undefined;
    });
}

async function handleChatMessage(text: string, backendUrl: string) {
    if (!chatPanel) return;

    // Show user message
    chatPanel.webview.postMessage({ type: 'userMessage', content: text });
    chatPanel.webview.postMessage({ type: 'loading', show: true });

    try {
        const projectId = getProjectId();
        const response = await axios.post(`${backendUrl}/execute-task`, {
            task: text,
            project_id: projectId,
            use_tools: true
        }, axiosConfig);

        chatPanel.webview.postMessage({
            type: 'assistantMessage',
            content: response.data.result,
            route: response.data.route,
            agent: response.data.agent,
            metrics: response.data.metrics
        });
    } catch (error: any) {
        chatPanel.webview.postMessage({
            type: 'error',
            content: error.message || 'Failed to get response'
        });
    } finally {
        chatPanel.webview.postMessage({ type: 'loading', show: false });
    }
}

async function executeAgentTask(agentType: string, backendUrl: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const selection = editor.document.getText(editor.selection);
    if (!selection) {
        vscode.window.showErrorMessage('Please select code to analyze');
        return;
    }

    const languageId = editor.document.languageId;
    const fileName = editor.document.fileName;

    let taskDescription = '';
    switch (agentType) {
        case 'code_review':
            taskDescription = `Review this ${languageId} code from ${fileName}:\n\n${selection}`;
            break;
        case 'refactoring':
            taskDescription = `Refactor this ${languageId} code to improve quality:\n\n${selection}`;
            break;
        case 'testing':
            taskDescription = `Generate comprehensive tests for this ${languageId} code:\n\n${selection}`;
            break;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Running ${agentType}...`,
        cancellable: false
    }, async () => {
        try {
            const response = await axios.post(`${backendUrl}/execute-task`, {
                task: taskDescription,
                project_id: getProjectId(),
                agent_type: agentType,
                use_tools: true
            }, axiosConfig);

            // Show result in new editor
            const doc = await vscode.workspace.openTextDocument({
                content: formatResult(response.data),
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    });
}

async function explainCode(backendUrl: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.document.getText(editor.selection);
    if (!selection) {
        vscode.window.showErrorMessage('Please select code to explain');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Explaining code...',
        cancellable: false
    }, async () => {
        try {
            const response = await axios.post(`${backendUrl}/execute-task`, {
                task: `Explain this code in detail:\n\n${selection}`,
                project_id: getProjectId(),
                use_tools: false
            }, axiosConfig);

            // Show explanation as hover or in panel
            const doc = await vscode.workspace.openTextDocument({
                content: `# Code Explanation\n\n${response.data.result}`,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    });
}

async function showDashboard(backendUrl: string) {
    if (dashboardPanel) {
        dashboardPanel.reveal();
        return;
    }

    dashboardPanel = vscode.window.createWebviewPanel(
        'aiDashboard',
        'AI Dashboard',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    try {
        const [routingMetrics, agentMetrics] = await Promise.all([
            axios.get(`${backendUrl}/metrics/routing`, axiosConfig),
            axios.get(`${backendUrl}/metrics/agents`, axiosConfig)
        ]);

        dashboardPanel.webview.html = getDashboardHtml(
            routingMetrics.data,
            agentMetrics.data
        );
    } catch (error) {
        dashboardPanel.webview.html = '<h1>Error loading dashboard</h1>';
    }

    dashboardPanel.onDidDispose(() => {
        dashboardPanel = undefined;
    });
}

async function initializeProject(backendUrl: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;

    // Check if already initialized
    const claudeMdPath = path.join(workspacePath, '.claude.md');
    if (fs.existsSync(claudeMdPath)) {
        const overwrite = await vscode.window.showWarningMessage(
            'Project already initialized. Overwrite configuration?',
            'Yes', 'No'
        );
        if (overwrite !== 'Yes') return;
    }

    // Collect project information
    const name = await vscode.window.showInputBox({
        prompt: 'Project Name',
        placeHolder: 'my-awesome-project',
        value: workspaceFolder.name
    });
    if (!name) return;

    const description = await vscode.window.showInputBox({
        prompt: 'Brief Project Description',
        placeHolder: 'A web application for managing...'
    });
    if (!description) return;

    const typeMap: Record<string, ProjectConfig['type']> = {
        'Web Application': 'web',
        'API/Backend': 'api',
        'Mobile App': 'mobile',
        'Full Stack': 'fullstack',
        'Data/ML': 'data',
        'Other': 'other'
    };

    const typeChoice = await vscode.window.showQuickPick(
        Object.keys(typeMap),
        { placeHolder: 'Select Project Type' }
    );
    if (!typeChoice) return;

    const techStackInput = await vscode.window.showInputBox({
        prompt: 'Technology Stack (comma-separated)',
        placeHolder: 'TypeScript, React, Node.js, PostgreSQL'
    });
    if (!techStackInput) return;

    const requirementsInput = await vscode.window.showInputBox({
        prompt: 'Key Requirements (comma-separated)',
        placeHolder: 'user authentication, database storage, API endpoints'
    });

    const config: ProjectConfig = {
        name,
        description,
        type: typeMap[typeChoice],
        techStack: techStackInput.split(',').map(s => s.trim()).filter(s => s),
        requirements: requirementsInput?.split(',').map(s => s.trim()).filter(s => s) || []
    };

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Initializing AI-enhanced project...',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ message: 'Getting tool recommendations...' });

            // Get recommendations from backend
            let recommendations: { essential: ToolRecommendation[]; recommended: ToolRecommendation[] } = {
                essential: [],
                recommended: []
            };
            let assignedAgents: AgentAssignment[] = [];

            try {
                const response = await axios.post(`${backendUrl}/projects/${name}/scope`, {
                    description: config.description,
                    requirements: config.requirements,
                    technical_stack: {
                        type: config.type,
                        technologies: config.techStack
                    }
                }, axiosConfig);

                recommendations = {
                    essential: response.data.recommended_tools?.filter((t: any) => t.essential) || [],
                    recommended: response.data.recommended_tools?.filter((t: any) => !t.essential) || []
                };
                assignedAgents = response.data.assigned_agents || [];
            } catch (error) {
                // Backend unavailable, use defaults
                recommendations = getDefaultRecommendations(config);
                assignedAgents = getDefaultAgents(config);
            }

            progress.report({ message: 'Creating configuration files...' });

            // Create .claude.md
            const claudeMdContent = generateClaudeMd(config, recommendations, assignedAgents);
            fs.writeFileSync(claudeMdPath, claudeMdContent);

            // Create .agents.json
            const agentsJsonPath = path.join(workspacePath, '.agents.json');
            const agentsConfig = generateAgentsJson(config, recommendations, assignedAgents);
            fs.writeFileSync(agentsJsonPath, JSON.stringify(agentsConfig, null, 2));

            // Create MCP config if tools recommended
            if (recommendations.essential.length > 0 || recommendations.recommended.length > 0) {
                progress.report({ message: 'Creating MCP configuration...' });
                const mcpConfigPath = path.join(workspacePath, '.mcp.json');
                const mcpConfig = generateMcpConfig(recommendations);
                fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
            }

            // Show success with summary
            const toolCount = recommendations.essential.length + recommendations.recommended.length;
            vscode.window.showInformationMessage(
                `Project "${name}" initialized with ${assignedAgents.length} agents and ${toolCount} tools configured.`,
                'View Configuration'
            ).then(selection => {
                if (selection === 'View Configuration') {
                    vscode.workspace.openTextDocument(claudeMdPath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });

        } catch (error: any) {
            vscode.window.showErrorMessage(`Initialization failed: ${error.message}`);
        }
    });
}

async function importProject(backendUrl: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing existing project...',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ message: 'Scanning project structure...' });

            // Analyze project
            const analysis = await analyzeProject(workspacePath);

            progress.report({ message: 'Detecting technologies...' });

            // Build project config from analysis
            const config: ProjectConfig = {
                name: workspaceFolder.name,
                description: `${analysis.complexity} project with ${analysis.languages.join(', ')}`,
                type: inferProjectType(analysis),
                techStack: [...analysis.languages, ...analysis.frameworks, ...analysis.databases],
                requirements: inferRequirements(analysis)
            };

            // Show analysis results and ask for confirmation
            const confirmMessage = `Detected: ${analysis.languages.join(', ')} | ` +
                `Frameworks: ${analysis.frameworks.length > 0 ? analysis.frameworks.join(', ') : 'None'} | ` +
                `${analysis.fileCount} files`;

            const proceed = await vscode.window.showInformationMessage(
                confirmMessage,
                'Configure Project', 'Edit Details', 'Cancel'
            );

            if (proceed === 'Cancel' || !proceed) return;

            if (proceed === 'Edit Details') {
                // Allow user to modify detected settings
                const description = await vscode.window.showInputBox({
                    prompt: 'Project Description',
                    value: config.description
                });
                if (description) config.description = description;

                const additionalTech = await vscode.window.showInputBox({
                    prompt: 'Additional technologies (comma-separated, or leave empty)',
                    placeHolder: 'Redis, GraphQL, etc.'
                });
                if (additionalTech) {
                    config.techStack.push(...additionalTech.split(',').map(s => s.trim()).filter(s => s));
                }
            }

            progress.report({ message: 'Getting recommendations...' });

            // Get recommendations
            let recommendations: { essential: ToolRecommendation[]; recommended: ToolRecommendation[] };
            let assignedAgents: AgentAssignment[];

            try {
                const response = await axios.post(`${backendUrl}/projects/${config.name}/scope`, {
                    description: config.description,
                    requirements: config.requirements,
                    technical_stack: {
                        type: config.type,
                        technologies: config.techStack
                    }
                }, axiosConfig);

                recommendations = {
                    essential: response.data.recommended_tools?.filter((t: any) => t.essential) || [],
                    recommended: response.data.recommended_tools?.filter((t: any) => !t.essential) || []
                };
                assignedAgents = response.data.assigned_agents || [];
            } catch {
                recommendations = getDefaultRecommendations(config);
                assignedAgents = getDefaultAgents(config);
            }

            progress.report({ message: 'Creating configuration files...' });

            // Create configuration files
            const claudeMdPath = path.join(workspacePath, '.claude.md');
            fs.writeFileSync(claudeMdPath, generateClaudeMd(config, recommendations, assignedAgents));

            const agentsJsonPath = path.join(workspacePath, '.agents.json');
            fs.writeFileSync(agentsJsonPath, JSON.stringify(generateAgentsJson(config, recommendations, assignedAgents), null, 2));

            if (recommendations.essential.length > 0 || recommendations.recommended.length > 0) {
                const mcpConfigPath = path.join(workspacePath, '.mcp.json');
                fs.writeFileSync(mcpConfigPath, JSON.stringify(generateMcpConfig(recommendations), null, 2));
            }

            vscode.window.showInformationMessage(
                `Project imported: ${assignedAgents.length} agents, ${recommendations.essential.length + recommendations.recommended.length} tools`,
                'View Configuration'
            ).then(selection => {
                if (selection === 'View Configuration') {
                    vscode.workspace.openTextDocument(claudeMdPath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });

        } catch (error: any) {
            vscode.window.showErrorMessage(`Import failed: ${error.message}`);
        }
    });
}

async function updateProjectScope(backendUrl: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const claudeMdPath = path.join(workspacePath, '.claude.md');
    const agentsJsonPath = path.join(workspacePath, '.agents.json');

    // Check if project is initialized
    if (!fs.existsSync(claudeMdPath)) {
        const init = await vscode.window.showWarningMessage(
            'Project not initialized. Initialize now?',
            'Yes', 'No'
        );
        if (init === 'Yes') {
            return initializeProject(backendUrl);
        }
        return;
    }

    // Read current configuration
    let currentConfig: any = {};
    if (fs.existsSync(agentsJsonPath)) {
        try {
            currentConfig = JSON.parse(fs.readFileSync(agentsJsonPath, 'utf-8'));
        } catch {
            // Invalid JSON, will recreate
        }
    }

    // Get new scope information
    const newDescription = await vscode.window.showInputBox({
        prompt: 'Updated Project Description',
        value: currentConfig.description || '',
        placeHolder: 'Describe the current state of your project...'
    });
    if (!newDescription) return;

    const newRequirementsInput = await vscode.window.showInputBox({
        prompt: 'Updated Requirements (comma-separated)',
        value: currentConfig.requirements?.join(', ') || '',
        placeHolder: 'authentication, payments, real-time updates'
    });
    if (!newRequirementsInput) return;

    const newRequirements = newRequirementsInput.split(',').map(s => s.trim()).filter(s => s);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Checking scope changes...',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ message: 'Analyzing changes...' });

            // Check for scope changes via backend
            let scopeChangeResult: any = { changed: true, magnitude: 'unknown', requires_tool_review: true };

            try {
                const response = await axios.post(
                    `${backendUrl}/projects/${workspaceFolder.name}/scope/check`,
                    {
                        new_description: newDescription,
                        new_requirements: newRequirements
                    },
                    axiosConfig
                );
                scopeChangeResult = response.data;
            } catch {
                // Backend unavailable, assume changes
            }

            if (!scopeChangeResult.changed) {
                vscode.window.showInformationMessage('No significant scope changes detected.');
                return;
            }

            // Show scope change analysis
            const proceedWithUpdate = await vscode.window.showWarningMessage(
                `Scope change detected (${scopeChangeResult.magnitude || 'moderate'}). ` +
                (scopeChangeResult.requires_tool_review ? 'Tool review recommended.' : ''),
                'Update Configuration', 'Review Tools', 'Cancel'
            );

            if (proceedWithUpdate === 'Cancel' || !proceedWithUpdate) return;

            progress.report({ message: 'Updating configuration...' });

            // Update agents.json
            currentConfig.description = newDescription;
            currentConfig.requirements = newRequirements;
            currentConfig.lastUpdated = new Date().toISOString();

            if (proceedWithUpdate === 'Review Tools' || scopeChangeResult.requires_tool_review) {
                // Get new tool recommendations
                try {
                    const toolResponse = await axios.post(`${backendUrl}/mcp/recommend`, {
                        project_scope: newDescription,
                        requirements: newRequirements
                    }, axiosConfig);

                    const newTools = [
                        ...(toolResponse.data.essential || []),
                        ...(toolResponse.data.recommended || [])
                    ];

                    if (newTools.length > 0) {
                        const toolNames = newTools.map((t: any) => t.name).join(', ');
                        const addTools = await vscode.window.showInformationMessage(
                            `Recommended tools: ${toolNames}`,
                            'Add All', 'Select Tools', 'Skip'
                        );

                        let toolsToAdd: ToolRecommendation[] = [];

                        if (addTools === 'Add All') {
                            toolsToAdd = newTools;
                            currentConfig.tools = [
                                ...(currentConfig.tools || []),
                                ...newTools.map((t: any) => ({
                                    name: t.name,
                                    type: t.type,
                                    reason: t.reason
                                }))
                            ];
                            // Remove duplicates
                            const seen = new Set();
                            currentConfig.tools = currentConfig.tools.filter((t: any) => {
                                if (seen.has(t.name)) return false;
                                seen.add(t.name);
                                return true;
                            });
                        } else if (addTools === 'Select Tools') {
                            const selected = await vscode.window.showQuickPick(
                                newTools.map((t: any) => ({
                                    label: t.name,
                                    description: t.reason,
                                    tool: t
                                })),
                                { canPickMany: true, placeHolder: 'Select tools to add' }
                            );
                            if (selected && selected.length > 0) {
                                toolsToAdd = selected.map((s: any) => s.tool);
                                currentConfig.tools = [
                                    ...(currentConfig.tools || []),
                                    ...selected.map((s: any) => ({
                                        name: s.tool.name,
                                        type: s.tool.type,
                                        reason: s.tool.reason
                                    }))
                                ];
                            }
                        }

                        // Write accepted tools to .mcp.json
                        if (toolsToAdd.length > 0) {
                            const mcpUpdated = updateMcpConfigFile(workspacePath, toolsToAdd);
                            if (mcpUpdated) {
                                vscode.window.showInformationMessage(
                                    'MCP configuration updated. Restart Claude Code to enable new tools.',
                                    'View .mcp.json'
                                ).then(selection => {
                                    if (selection === 'View .mcp.json') {
                                        const mcpPath = path.join(workspacePath, '.mcp.json');
                                        vscode.workspace.openTextDocument(mcpPath).then(doc => {
                                            vscode.window.showTextDocument(doc);
                                        });
                                    }
                                });
                            }
                        }
                    }
                } catch {
                    // Tool recommendation failed, continue without
                }
            }

            // Save updated configuration
            fs.writeFileSync(agentsJsonPath, JSON.stringify(currentConfig, null, 2));

            // Update .claude.md header
            let claudeMdContent = fs.readFileSync(claudeMdPath, 'utf-8');
            const descriptionRegex = /## Project Description\n\n[^\n#]+/;
            if (descriptionRegex.test(claudeMdContent)) {
                claudeMdContent = claudeMdContent.replace(
                    descriptionRegex,
                    `## Project Description\n\n${newDescription}`
                );
                fs.writeFileSync(claudeMdPath, claudeMdContent);
            }

            vscode.window.showInformationMessage('Project scope updated successfully.');

        } catch (error: any) {
            vscode.window.showErrorMessage(`Update failed: ${error.message}`);
        }
    });
}

// Helper functions for project initialization

async function analyzeProject(workspacePath: string): Promise<ProjectAnalysis> {
    const analysis: ProjectAnalysis = {
        languages: [],
        frameworks: [],
        databases: [],
        hasTests: false,
        hasDocker: false,
        hasCICD: false,
        complexity: 'simple',
        fileCount: 0
    };

    const languageExtensions: Record<string, string> = {
        '.ts': 'TypeScript', '.tsx': 'TypeScript',
        '.js': 'JavaScript', '.jsx': 'JavaScript',
        '.py': 'Python',
        '.go': 'Go',
        '.rs': 'Rust',
        '.java': 'Java',
        '.cs': 'C#',
        '.rb': 'Ruby',
        '.php': 'PHP',
        '.swift': 'Swift',
        '.kt': 'Kotlin'
    };

    const frameworkFiles: Record<string, string> = {
        'package.json': 'Node.js',
        'requirements.txt': 'Python',
        'Pipfile': 'Python',
        'go.mod': 'Go',
        'Cargo.toml': 'Rust',
        'pom.xml': 'Java/Maven',
        'build.gradle': 'Java/Gradle',
        'Gemfile': 'Ruby',
        'composer.json': 'PHP'
    };

    const frameworkIndicators: Record<string, string[]> = {
        'React': ['react', 'react-dom'],
        'Vue': ['vue'],
        'Angular': ['@angular/core'],
        'Next.js': ['next'],
        'Express': ['express'],
        'Django': ['django'],
        'Flask': ['flask'],
        'FastAPI': ['fastapi'],
        'Spring': ['spring-boot'],
        'Rails': ['rails']
    };

    const databaseIndicators: string[] = [
        'postgresql', 'postgres', 'mysql', 'mongodb', 'redis',
        'sqlite', 'dynamodb', 'cassandra', 'elasticsearch'
    ];

    try {
        // Scan files
        const files = await scanDirectory(workspacePath, 3); // Max depth 3
        analysis.fileCount = files.length;

        const languagesFound = new Set<string>();
        const frameworksFound = new Set<string>();
        const databasesFound = new Set<string>();

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            const basename = path.basename(file).toLowerCase();

            // Detect language
            if (languageExtensions[ext]) {
                languagesFound.add(languageExtensions[ext]);
            }

            // Detect framework files
            if (frameworkFiles[basename]) {
                frameworksFound.add(frameworkFiles[basename]);
            }

            // Check for tests
            if (basename.includes('test') || basename.includes('spec') ||
                file.includes('__tests__') || file.includes('/test/')) {
                analysis.hasTests = true;
            }

            // Check for Docker
            if (basename === 'dockerfile' || basename === 'docker-compose.yml' ||
                basename === 'docker-compose.yaml') {
                analysis.hasDocker = true;
            }

            // Check for CI/CD
            if (file.includes('.github/workflows') || file.includes('.gitlab-ci') ||
                basename === 'jenkinsfile' || file.includes('.circleci')) {
                analysis.hasCICD = true;
            }

            // Check package files for frameworks and databases
            if (basename === 'package.json' || basename === 'requirements.txt' ||
                basename === 'pipfile' || basename === 'go.mod') {
                try {
                    const content = fs.readFileSync(file, 'utf-8').toLowerCase();

                    // Check frameworks
                    for (const [framework, indicators] of Object.entries(frameworkIndicators)) {
                        if (indicators.some(ind => content.includes(ind))) {
                            frameworksFound.add(framework);
                        }
                    }

                    // Check databases
                    for (const db of databaseIndicators) {
                        if (content.includes(db)) {
                            databasesFound.add(db.charAt(0).toUpperCase() + db.slice(1));
                        }
                    }
                } catch {
                    // Ignore read errors
                }
            }
        }

        analysis.languages = Array.from(languagesFound);
        analysis.frameworks = Array.from(frameworksFound);
        analysis.databases = Array.from(databasesFound);

        // Determine complexity
        if (files.length > 500 || analysis.frameworks.length > 3) {
            analysis.complexity = 'complex';
        } else if (files.length > 100 || analysis.frameworks.length > 1) {
            analysis.complexity = 'moderate';
        }

    } catch (error) {
        // Return minimal analysis on error
    }

    return analysis;
}

async function scanDirectory(dir: string, maxDepth: number, currentDepth: number = 0): Promise<string[]> {
    if (currentDepth >= maxDepth) return [];

    const files: string[] = [];
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'venv', '.venv', 'vendor'];

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                    files.push(...await scanDirectory(fullPath, maxDepth, currentDepth + 1));
                }
            } else {
                files.push(fullPath);
            }
        }
    } catch {
        // Ignore permission errors
    }

    return files;
}

function inferProjectType(analysis: ProjectAnalysis): ProjectConfig['type'] {
    const hasBackend = analysis.frameworks.some(f =>
        ['Express', 'Django', 'Flask', 'FastAPI', 'Spring', 'Rails'].includes(f)
    );
    const hasFrontend = analysis.frameworks.some(f =>
        ['React', 'Vue', 'Angular', 'Next.js'].includes(f)
    );

    if (hasBackend && hasFrontend) return 'fullstack';
    if (hasFrontend) return 'web';
    if (hasBackend) return 'api';
    if (analysis.languages.includes('Python') && analysis.frameworks.length === 0) return 'data';
    return 'other';
}

function inferRequirements(analysis: ProjectAnalysis): string[] {
    const requirements: string[] = [];

    if (analysis.databases.length > 0) {
        requirements.push('database storage');
    }
    if (analysis.hasTests) {
        requirements.push('testing');
    }
    if (analysis.hasDocker) {
        requirements.push('containerization');
    }
    if (analysis.hasCICD) {
        requirements.push('CI/CD');
    }
    if (analysis.frameworks.some(f => ['Express', 'FastAPI', 'Flask', 'Django'].includes(f))) {
        requirements.push('API endpoints');
    }
    if (analysis.frameworks.some(f => ['React', 'Vue', 'Angular'].includes(f))) {
        requirements.push('frontend UI');
    }

    return requirements;
}

function getDefaultRecommendations(config: ProjectConfig): { essential: ToolRecommendation[]; recommended: ToolRecommendation[] } {
    const essential: ToolRecommendation[] = [
        { name: 'filesystem', type: 'filesystem', reason: 'File operations' },
        { name: 'github', type: 'git', reason: 'Version control' }
    ];

    const recommended: ToolRecommendation[] = [];

    if (config.techStack.some(t => t.toLowerCase().includes('postgres'))) {
        essential.push({ name: 'postgresql', type: 'database', reason: 'PostgreSQL access' });
    }

    if (config.type === 'web' || config.type === 'fullstack') {
        recommended.push({ name: 'puppeteer', type: 'browser', reason: 'Browser testing' });
    }

    recommended.push({ name: 'memory', type: 'knowledge_base', reason: 'Context persistence' });

    return { essential, recommended };
}

function getDefaultAgents(config: ProjectConfig): AgentAssignment[] {
    const agents: AgentAssignment[] = [
        { name: 'Code Review Specialist', type: 'code_review' }
    ];

    if (config.requirements.some(r => r.includes('test'))) {
        agents.push({ name: 'Test Engineer', type: 'testing' });
    }

    if (config.type === 'api' || config.type === 'fullstack') {
        agents.push({ name: 'Software Architect', type: 'architecture' });
    }

    agents.push({ name: 'Refactoring Specialist', type: 'refactoring' });

    return agents;
}

function generateClaudeMd(
    config: ProjectConfig,
    recommendations: { essential: ToolRecommendation[]; recommended: ToolRecommendation[] },
    agents: AgentAssignment[]
): string {
    const toolsList = [...recommendations.essential, ...recommendations.recommended]
        .map(t => `- **${t.name}**: ${t.reason}`)
        .join('\n');

    const agentsList = agents
        .map(a => `- **${a.name}** (${a.type})`)
        .join('\n');

    return `# ${config.name}

## Project Description

${config.description}

## Project Type

${config.type}

## Technology Stack

${config.techStack.map(t => `- ${t}`).join('\n')}

## Key Requirements

${config.requirements.map(r => `- ${r}`).join('\n') || '- No specific requirements defined'}

## AI Development Tools

${toolsList || '- No tools configured'}

## Assigned Agents

${agentsList || '- No agents assigned'}

---

*Generated by Claude AI Development Assistant*
*Last Updated: ${new Date().toISOString()}*
`;
}

function generateAgentsJson(
    config: ProjectConfig,
    recommendations: { essential: ToolRecommendation[]; recommended: ToolRecommendation[] },
    agents: AgentAssignment[]
): any {
    return {
        version: '1.0',
        project: {
            name: config.name,
            type: config.type,
            description: config.description
        },
        techStack: config.techStack,
        requirements: config.requirements,
        tools: [...recommendations.essential, ...recommendations.recommended].map(t => ({
            name: t.name,
            type: t.type,
            reason: t.reason,
            enabled: true
        })),
        agents: agents.map(a => ({
            name: a.name,
            type: a.type,
            enabled: true
        })),
        settings: {
            autoRoute: true,
            showMetrics: true,
            cacheResponses: true
        },
        lastUpdated: new Date().toISOString()
    };
}

// MCP Server configurations - maps tool names to their MCP config
const MCP_SERVER_CONFIGS: Record<string, any> = {
    'filesystem': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    },
    'github': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }
    },
    'postgresql': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: { DATABASE_URL: '' }
    },
    'memory': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory']
    },
    'puppeteer': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer']
    },
    'fetch': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-fetch']
    },
    'brave-search': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: { BRAVE_API_KEY: '' }
    },
    'sequential-thinking': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
    },
    'sqlite': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite'],
        env: { SQLITE_DB_PATH: '' }
    },
    'slack': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: { SLACK_BOT_TOKEN: '' }
    },
    'git': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-git']
    },
    'time': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-time']
    }
};

function generateMcpConfig(
    recommendations: { essential: ToolRecommendation[]; recommended: ToolRecommendation[] }
): any {
    const servers: Record<string, any> = {};
    const allTools = [...recommendations.essential, ...recommendations.recommended];

    for (const tool of allTools) {
        const config = MCP_SERVER_CONFIGS[tool.name];
        if (config) {
            servers[tool.name] = { ...config };
        }
    }

    return { mcpServers: servers };
}

function updateMcpConfigFile(workspacePath: string, newTools: ToolRecommendation[]): boolean {
    const mcpConfigPath = path.join(workspacePath, '.mcp.json');
    let existingConfig: any = { mcpServers: {} };

    // Read existing config if present
    if (fs.existsSync(mcpConfigPath)) {
        try {
            existingConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
            if (!existingConfig.mcpServers) {
                existingConfig.mcpServers = {};
            }
        } catch {
            existingConfig = { mcpServers: {} };
        }
    }

    // Add new tools
    let added = 0;
    for (const tool of newTools) {
        const config = MCP_SERVER_CONFIGS[tool.name];
        if (config && !existingConfig.mcpServers[tool.name]) {
            existingConfig.mcpServers[tool.name] = { ...config };
            added++;
        }
    }

    if (added > 0) {
        fs.writeFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2));
        return true;
    }
    return false;
}

function getProjectId(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.name || 'default';
}

function formatResult(data: any): string {
    let output = `# ${data.agent || 'AI'} Result\n\n`;
    output += `**Route**: ${data.route}\n`;
    if (data.metrics) {
        output += `**Tokens**: ${data.metrics.tokens} | **Time**: ${data.metrics.time_ms}ms\n`;
    }
    output += `\n---\n\n${data.result}`;
    return output;
}

function getChatHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 10px; }
        .chat-container { display: flex; flex-direction: column; height: 100vh; }
        .messages { flex: 1; overflow-y: auto; padding: 10px; }
        .message { margin: 10px 0; padding: 10px; border-radius: 8px; }
        .user-message { background: var(--vscode-input-background); margin-left: 20%; }
        .assistant-message { background: var(--vscode-editor-background); margin-right: 20%; border: 1px solid var(--vscode-input-border); }
        .message-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 5px; }
        .input-container { display: flex; padding: 10px; border-top: 1px solid var(--vscode-input-border); }
        input { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
        button { padding: 8px 16px; margin-left: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
        .loading { text-align: center; padding: 20px; }
        .error { color: var(--vscode-errorForeground); }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="messages" id="messages"></div>
        <div class="input-container">
            <input type="text" id="input" placeholder="Ask anything... (routed automatically)" />
            <button onclick="send()">Send</button>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const messagesDiv = document.getElementById('messages');
        const input = document.getElementById('input');

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') send();
        });

        function send() {
            const text = input.value.trim();
            if (!text) return;
            vscode.postMessage({ command: 'sendMessage', text });
            input.value = '';
        }

        window.addEventListener('message', (event) => {
            const msg = event.data;

            if (msg.type === 'userMessage') {
                messagesDiv.innerHTML += '<div class="message user-message">' + escapeHtml(msg.content) + '</div>';
            } else if (msg.type === 'assistantMessage') {
                let meta = '';
                if (msg.route) meta += 'Route: ' + msg.route;
                if (msg.agent) meta += ' | Agent: ' + msg.agent;
                if (msg.metrics) meta += ' | ' + msg.metrics.time_ms + 'ms';

                messagesDiv.innerHTML +=
                    '<div class="message assistant-message">' +
                        escapeHtml(msg.content) +
                        '<div class="message-meta">' + meta + '</div>' +
                    '</div>';
            } else if (msg.type === 'loading') {
                const loader = document.getElementById('loader');
                if (msg.show && !loader) {
                    messagesDiv.innerHTML += '<div class="loading" id="loader">Thinking...</div>';
                } else if (!msg.show && loader) {
                    loader.remove();
                }
            } else if (msg.type === 'error') {
                messagesDiv.innerHTML += '<div class="message error">' + escapeHtml(msg.content) + '</div>';
            }

            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
}

function escapeHtmlForDashboard(text: string | number | null | undefined): string {
    if (text === null || text === undefined) return '';
    const str = String(text);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getDashboardHtml(routingData: any, agentData: any): string {
    const metrics = routingData?.metrics || [];
    const agents = agentData?.agents || [];

    const totalQueries = metrics.reduce((sum: number, m: any) => sum + (m.count || 0), 0);
    const avgTime = metrics.length > 0
        ? Math.round(metrics.reduce((sum: number, m: any) => sum + (m.avg_time_ms || 0), 0) / metrics.length)
        : 0;

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
        h1 { border-bottom: 1px solid var(--vscode-input-border); padding-bottom: 10px; }
        .metric-card { background: var(--vscode-input-background); padding: 20px; margin: 10px 0; border-radius: 8px; border-left: 4px solid var(--vscode-button-background); }
        .metric-value { font-size: 36px; font-weight: bold; color: var(--vscode-textLink-foreground); }
        .metric-label { color: var(--vscode-descriptionForeground); }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--vscode-input-border); }
        th { background: var(--vscode-input-background); }
    </style>
</head>
<body>
    <h1>AI Development Dashboard</h1>

    <div class="grid">
        <div class="metric-card">
            <div class="metric-label">Total Queries (7 days)</div>
            <div class="metric-value">${totalQueries}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Avg Response Time</div>
            <div class="metric-value">${avgTime}ms</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Active Agents</div>
            <div class="metric-value">${agents.length}</div>
        </div>
    </div>

    <h2>Routing Distribution</h2>
    <table>
        <tr><th>Route</th><th>Count</th><th>Avg Time</th></tr>
        ${metrics.length > 0 ? metrics.map((m: any) => `
            <tr><td>${escapeHtmlForDashboard(m.route)}</td><td>${m.count || 0}</td><td>${Math.round(m.avg_time_ms || 0)}ms</td></tr>
        `).join('') : '<tr><td colspan="3">No data available</td></tr>'}
    </table>

    <h2>Agent Performance</h2>
    <table>
        <tr><th>Agent</th><th>Success Rate</th><th>Tasks</th><th>Avg Time</th></tr>
        ${agents.length > 0 ? agents.map((a: any) => `
            <tr>
                <td>${escapeHtmlForDashboard(a.name)}</td>
                <td>${Math.round((a.success_rate || 0) * 100)}%</td>
                <td>${a.total_tasks || 0}</td>
                <td>${Math.round(a.avg_time_ms || 0)}ms</td>
            </tr>
        `).join('') : '<tr><td colspan="4">No agents configured</td></tr>'}
    </table>
</body>
</html>`;
}

export function deactivate() {
    chatPanel?.dispose();
    dashboardPanel?.dispose();
}
