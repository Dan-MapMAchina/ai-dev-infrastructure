/**
 * Tool Selector - QuickPick-based tool selection with context awareness
 * Phase 3: Smart tool selection based on task context
 */

import * as vscode from 'vscode';
import { getMCPToolExecutor, Tool, ToolAction } from './mcpToolExecutor';
import axios from 'axios';

// ============================================================================
// Interfaces
// ============================================================================

export interface TaskContext {
    task_type: 'code_review' | 'code_generation' | 'testing' | 'debugging' | 'devops' | 'documentation' | 'general';
    file_types?: string[];
    project_type?: string;
    has_selection?: boolean;
    current_file?: string;
}

export interface ToolRecommendation {
    tool: Tool;
    relevance_score: number;
    reason: string;
    suggested_actions: string[];
}

export interface ToolCategory {
    name: string;
    description: string;
    tools: string[];
}

// ============================================================================
// Tool Categories
// ============================================================================

const TOOL_CATEGORIES: ToolCategory[] = [
    {
        name: 'File Operations',
        description: 'Read, write, and search files',
        tools: ['filesystem']
    },
    {
        name: 'Version Control',
        description: 'Git and GitHub operations',
        tools: ['github', 'git']
    },
    {
        name: 'Database',
        description: 'Database queries and operations',
        tools: ['postgresql', 'sqlite', 'oracle']
    },
    {
        name: 'Memory & Context',
        description: 'Store and retrieve context',
        tools: ['memory']
    },
    {
        name: 'Web & API',
        description: 'Web scraping and API calls',
        tools: ['puppeteer', 'brave-search', 'fetch']
    },
    {
        name: 'Communication',
        description: 'Team communication tools',
        tools: ['slack']
    }
];

// ============================================================================
// Tool Selector Functions
// ============================================================================

/**
 * Show tool picker with optional context-aware recommendations
 */
export async function showToolPicker(context?: TaskContext): Promise<Tool | undefined> {
    const executor = getMCPToolExecutor();

    const tools = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading tools...',
        cancellable: false
    }, async () => {
        return await executor.getAvailableTools();
    });

    if (tools.length === 0) {
        vscode.window.showWarningMessage('No tools available');
        return undefined;
    }

    // Get recommendations if context provided
    let recommendations: ToolRecommendation[] = [];
    if (context) {
        recommendations = await getToolRecommendations(tools, context);
    }

    // Build quick pick items
    const items: vscode.QuickPickItem[] = [];

    // Add recommended tools at top if available
    if (recommendations.length > 0) {
        items.push({
            label: '$(star) Recommended',
            kind: vscode.QuickPickItemKind.Separator
        });

        for (const rec of recommendations.slice(0, 3)) {
            items.push({
                label: `$(star-full) ${rec.tool.name}`,
                description: `${rec.tool.type} - ${Math.round(rec.relevance_score * 100)}% match`,
                detail: rec.reason
            });
        }

        items.push({
            label: 'All Tools',
            kind: vscode.QuickPickItemKind.Separator
        });
    }

    // Group tools by category
    const categorizedTools = new Map<string, Tool[]>();
    const uncategorizedTools: Tool[] = [];

    for (const tool of tools) {
        let categorized = false;
        for (const category of TOOL_CATEGORIES) {
            if (category.tools.includes(tool.name)) {
                if (!categorizedTools.has(category.name)) {
                    categorizedTools.set(category.name, []);
                }
                categorizedTools.get(category.name)!.push(tool);
                categorized = true;
                break;
            }
        }
        if (!categorized) {
            uncategorizedTools.push(tool);
        }
    }

    // Add categorized tools
    for (const [categoryName, categoryTools] of categorizedTools) {
        items.push({
            label: categoryName,
            kind: vscode.QuickPickItemKind.Separator
        });

        for (const tool of categoryTools) {
            const icon = tool.is_configured ? '$(check)' : '$(warning)';
            items.push({
                label: `${icon} ${tool.name}`,
                description: tool.type,
                detail: tool.description
            });
        }
    }

    // Add uncategorized tools
    if (uncategorizedTools.length > 0) {
        items.push({
            label: 'Other Tools',
            kind: vscode.QuickPickItemKind.Separator
        });

        for (const tool of uncategorizedTools) {
            const icon = tool.is_configured ? '$(check)' : '$(warning)';
            items.push({
                label: `${icon} ${tool.name}`,
                description: tool.type,
                detail: tool.description
            });
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: context
            ? `Select a tool for ${context.task_type} task`
            : 'Select a tool',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
        return undefined;
    }

    // Extract tool name from label (remove icon prefix)
    const toolName = selected.label.replace(/^\$\([^)]+\)\s*/, '');
    return tools.find(t => t.name === toolName);
}

/**
 * Show tool action picker for a specific tool
 */
export async function showActionPicker(tool: Tool): Promise<ToolAction | undefined> {
    if (tool.actions.length === 0) {
        vscode.window.showWarningMessage(`Tool '${tool.name}' has no available actions`);
        return undefined;
    }

    const items = tool.actions.map(action => ({
        label: action.name,
        description: action.returns ? `→ ${action.returns}` : '',
        detail: action.description,
        action
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select an action for ${tool.name}`,
        matchOnDescription: true,
        matchOnDetail: true
    });

    return selected?.action;
}

/**
 * Show tool capabilities in a hover-like panel
 */
export async function showToolCapabilities(tool: Tool): Promise<void> {
    const content = buildToolCapabilitiesMarkdown(tool);

    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
    });
}

/**
 * Show multi-select tool picker for selecting multiple tools
 */
export async function showMultiToolPicker(context?: TaskContext): Promise<Tool[]> {
    const executor = getMCPToolExecutor();
    const tools = await executor.getAvailableTools();

    if (tools.length === 0) {
        vscode.window.showWarningMessage('No tools available');
        return [];
    }

    const items = tools.map(tool => ({
        label: tool.name,
        description: tool.type,
        detail: tool.description,
        picked: false,
        tool
    }));

    // Pre-select recommended tools if context provided
    if (context) {
        const recommendations = await getToolRecommendations(tools, context);
        for (const rec of recommendations.slice(0, 3)) {
            const item = items.find(i => i.tool.name === rec.tool.name);
            if (item) {
                item.picked = true;
            }
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select tools (use Space to select multiple)',
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true
    });

    return selected?.map(s => s.tool) || [];
}

/**
 * Show tool configuration status
 */
export async function showToolConfigurationStatus(): Promise<void> {
    const executor = getMCPToolExecutor();
    const tools = await executor.getAvailableTools();

    const configured = tools.filter(t => t.is_configured);
    const unconfigured = tools.filter(t => !t.is_configured);

    const items: vscode.QuickPickItem[] = [];

    if (configured.length > 0) {
        items.push({
            label: '$(check) Configured',
            kind: vscode.QuickPickItemKind.Separator
        });

        for (const tool of configured) {
            items.push({
                label: `$(check) ${tool.name}`,
                description: tool.type,
                detail: tool.description
            });
        }
    }

    if (unconfigured.length > 0) {
        items.push({
            label: '$(warning) Not Configured',
            kind: vscode.QuickPickItemKind.Separator
        });

        for (const tool of unconfigured) {
            items.push({
                label: `$(warning) ${tool.name}`,
                description: `${tool.type} - Click to configure`,
                detail: tool.description
            });
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${configured.length} configured, ${unconfigured.length} need configuration`,
        matchOnDescription: true
    });

    if (selected && selected.label.includes('$(warning)')) {
        const toolName = selected.label.replace(/^\$\([^)]+\)\s*/, '');
        vscode.window.showInformationMessage(
            `To configure ${toolName}, please set up the required credentials in your environment.`,
            'Open Settings'
        ).then(action => {
            if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'claudeAiDev');
            }
        });
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get tool recommendations based on task context
 */
async function getToolRecommendations(tools: Tool[], context: TaskContext): Promise<ToolRecommendation[]> {
    // Try to get recommendations from backend
    try {
        const config = vscode.workspace.getConfiguration('claudeAiDev');
        const backendUrl = config.get<string>('backendUrl', 'http://localhost:5050');

        const response = await axios.post(`${backendUrl}/recommend-tools`, {
            task_type: context.task_type,
            file_types: context.file_types,
            project_type: context.project_type
        }, { timeout: 5000 });

        if (response.data.recommendations) {
            return response.data.recommendations.map((rec: any) => ({
                tool: tools.find(t => t.name === rec.tool_name) || {
                    name: rec.tool_name,
                    type: 'unknown',
                    description: '',
                    actions: [],
                    is_configured: false
                },
                relevance_score: rec.relevance_score || 0.5,
                reason: rec.reason || 'Recommended for this task',
                suggested_actions: rec.suggested_actions || []
            }));
        }
    } catch {
        // Fall back to local recommendations
    }

    // Local recommendation logic
    return getLocalRecommendations(tools, context);
}

/**
 * Get local tool recommendations based on heuristics
 */
function getLocalRecommendations(tools: Tool[], context: TaskContext): ToolRecommendation[] {
    const recommendations: ToolRecommendation[] = [];

    // Task type based recommendations
    const taskToolMap: Record<string, { tools: string[], reason: string }> = {
        code_review: {
            tools: ['filesystem', 'github'],
            reason: 'Essential for reading and reviewing code'
        },
        code_generation: {
            tools: ['filesystem', 'memory'],
            reason: 'Needed for file creation and context'
        },
        testing: {
            tools: ['filesystem', 'puppeteer'],
            reason: 'Required for test file management and browser testing'
        },
        debugging: {
            tools: ['filesystem', 'memory'],
            reason: 'Helps track errors and maintain context'
        },
        devops: {
            tools: ['filesystem', 'github'],
            reason: 'Infrastructure files and version control'
        },
        documentation: {
            tools: ['filesystem', 'brave-search'],
            reason: 'File management and reference lookup'
        },
        general: {
            tools: ['filesystem', 'memory'],
            reason: 'Core tools for general tasks'
        }
    };

    const taskConfig = taskToolMap[context.task_type] || taskToolMap.general;

    for (const toolName of taskConfig.tools) {
        const tool = tools.find(t => t.name === toolName);
        if (tool) {
            recommendations.push({
                tool,
                relevance_score: 0.9,
                reason: taskConfig.reason,
                suggested_actions: tool.actions.slice(0, 2).map(a => a.name)
            });
        }
    }

    // File type based recommendations
    if (context.file_types) {
        const fileTypes = context.file_types;

        // Database files
        if (fileTypes.some(ft => ['sql', 'db'].includes(ft))) {
            const dbTools = tools.filter(t => ['postgresql', 'sqlite', 'oracle'].includes(t.name));
            for (const tool of dbTools) {
                if (!recommendations.find(r => r.tool.name === tool.name)) {
                    recommendations.push({
                        tool,
                        relevance_score: 0.85,
                        reason: 'Database operations detected',
                        suggested_actions: tool.actions.slice(0, 2).map(a => a.name)
                    });
                }
            }
        }

        // Web files
        if (fileTypes.some(ft => ['html', 'css', 'jsx', 'tsx'].includes(ft))) {
            const puppeteer = tools.find(t => t.name === 'puppeteer');
            if (puppeteer && !recommendations.find(r => r.tool.name === 'puppeteer')) {
                recommendations.push({
                    tool: puppeteer,
                    relevance_score: 0.8,
                    reason: 'Web development files detected',
                    suggested_actions: ['screenshot', 'navigate']
                });
            }
        }
    }

    // Sort by relevance score
    return recommendations.sort((a, b) => b.relevance_score - a.relevance_score);
}

/**
 * Build markdown content for tool capabilities
 */
function buildToolCapabilitiesMarkdown(tool: Tool): string {
    let content = `# ${tool.name}\n\n`;
    content += `**Type:** ${tool.type}\n\n`;
    content += `**Status:** ${tool.is_configured ? '✅ Configured' : '⚠️ Not Configured'}\n\n`;
    content += `${tool.description}\n\n`;

    if (tool.capabilities && tool.capabilities.length > 0) {
        content += `## Capabilities\n\n`;
        for (const cap of tool.capabilities) {
            content += `- ${cap}\n`;
        }
        content += '\n';
    }

    if (tool.actions.length > 0) {
        content += `## Actions\n\n`;

        for (const action of tool.actions) {
            content += `### ${action.name}\n\n`;
            content += `${action.description}\n\n`;

            if (action.parameters.length > 0) {
                content += `**Parameters:**\n\n`;
                content += `| Name | Type | Required | Description |\n`;
                content += `|------|------|----------|-------------|\n`;

                for (const param of action.parameters) {
                    const required = param.required ? '✓' : '';
                    content += `| ${param.name} | ${param.type} | ${required} | ${param.description} |\n`;
                }
                content += '\n';
            }

            if (action.returns) {
                content += `**Returns:** ${action.returns}\n\n`;
            }
        }
    }

    return content;
}

/**
 * Detect task context from the current editor state
 */
export function detectTaskContext(): TaskContext {
    const editor = vscode.window.activeTextEditor;
    const context: TaskContext = {
        task_type: 'general',
        has_selection: false
    };

    if (editor) {
        context.current_file = editor.document.fileName;
        context.has_selection = !editor.selection.isEmpty;

        // Detect file type
        const ext = editor.document.fileName.split('.').pop()?.toLowerCase();
        if (ext) {
            context.file_types = [ext];
        }

        // Detect task type based on file
        if (ext === 'test' || editor.document.fileName.includes('.test.') ||
            editor.document.fileName.includes('.spec.') ||
            editor.document.fileName.includes('/tests/') ||
            editor.document.fileName.includes('/__tests__/')) {
            context.task_type = 'testing';
        } else if (['dockerfile', 'docker-compose.yml', '.yaml', '.yml'].some(f =>
            editor.document.fileName.toLowerCase().includes(f))) {
            context.task_type = 'devops';
        } else if (['md', 'rst', 'txt'].includes(ext || '')) {
            context.task_type = 'documentation';
        }
    }

    // Detect project type from workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        vscode.workspace.findFiles('package.json', null, 1).then(files => {
            if (files.length > 0) {
                context.project_type = 'nodejs';
            }
        });
        vscode.workspace.findFiles('requirements.txt', null, 1).then(files => {
            if (files.length > 0) {
                context.project_type = 'python';
            }
        });
    }

    return context;
}

/**
 * Quick tool execution with context detection
 */
export async function quickToolExecution(): Promise<void> {
    const context = detectTaskContext();
    const tool = await showToolPicker(context);

    if (!tool) {
        return;
    }

    const action = await showActionPicker(tool);

    if (!action) {
        return;
    }

    // Collect parameters
    const executor = getMCPToolExecutor();
    const parameters: Record<string, any> = {};

    for (const param of action.parameters) {
        if (param.required) {
            const value = await vscode.window.showInputBox({
                prompt: `${param.name}: ${param.description}`,
                placeHolder: param.default?.toString() || `Enter ${param.type}`
            });

            if (value === undefined) {
                return; // Cancelled
            }

            parameters[param.name] = value;
        }
    }

    // Execute
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Executing ${tool.name}.${action.name}...`,
        cancellable: false
    }, async () => {
        return await executor.executeToolAction({
            tool_name: tool.name,
            action: action.name,
            parameters
        });
    });

    if (result.success) {
        vscode.window.showInformationMessage(
            `Tool executed successfully (${result.execution_time_ms}ms)`
        );
    } else {
        vscode.window.showErrorMessage(`Tool execution failed: ${result.error}`);
    }
}
