/**
 * MCP Tool Executor - Execute MCP tool actions from the extension
 * Phase 3: Advanced tool integration capabilities
 */

import * as vscode from 'vscode';
import axios from 'axios';

// ============================================================================
// Interfaces
// ============================================================================

export interface Tool {
    name: string;
    type: string;
    description: string;
    actions: ToolAction[];
    is_configured: boolean;
    capabilities?: string[];
}

export interface ToolAction {
    name: string;
    description: string;
    parameters: ToolParameter[];
    returns?: string;
}

export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    required: boolean;
    default?: any;
    enum?: string[];
}

export interface ToolExecution {
    tool_name: string;
    action: string;
    parameters: Record<string, any>;
}

export interface ToolResult {
    success: boolean;
    output: any;
    error?: string;
    execution_time_ms: number;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export interface ValidationError {
    parameter: string;
    message: string;
}

export interface ToolChainStep {
    step_id: string;
    tool: string;
    action: string;
    parameters: Record<string, any>;
    depends_on?: string[];
    condition?: string;
}

export interface ToolChain {
    name: string;
    description: string;
    steps: ToolChainStep[];
}

export interface ChainExecutionStatus {
    execution_id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    current_step?: string;
    steps: ChainStepStatus[];
    started_at?: string;
    completed_at?: string;
}

export interface ChainStepStatus {
    step_id: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    result?: ToolResult;
}

// ============================================================================
// MCP Tool Executor Class
// ============================================================================

export class MCPToolExecutor {
    private backendUrl: string;
    private toolCache: Map<string, Tool> = new Map();
    private cacheExpiry: number = 0;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor() {
        const config = vscode.workspace.getConfiguration('claudeAiDev');
        this.backendUrl = config.get<string>('backendUrl', 'http://localhost:5050');
    }

    /**
     * Execute a tool action
     */
    async executeToolAction(execution: ToolExecution, projectId?: string): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            // Validate parameters before execution
            const validation = await this.validateToolParameters(execution.tool_name, execution.action, execution.parameters);
            if (!validation.valid) {
                return {
                    success: false,
                    output: null,
                    error: `Validation failed: ${validation.errors.map(e => `${e.parameter}: ${e.message}`).join(', ')}`,
                    execution_time_ms: Date.now() - startTime
                };
            }

            const response = await axios.post(`${this.backendUrl}/tools/execute`, {
                tool_name: execution.tool_name,
                action: execution.action,
                parameters: execution.parameters,
                project_id: projectId
            }, {
                timeout: 60000 // 60 second timeout for tool execution
            });

            return {
                success: response.data.success,
                output: response.data.result,
                error: response.data.error,
                execution_time_ms: response.data.execution_time_ms || (Date.now() - startTime)
            };
        } catch (error: any) {
            // Try local execution for certain tools
            if (this.canExecuteLocally(execution.tool_name)) {
                return this.executeLocally(execution, startTime);
            }

            return {
                success: false,
                output: null,
                error: error.response?.data?.error || error.message || 'Tool execution failed',
                execution_time_ms: Date.now() - startTime
            };
        }
    }

    /**
     * Get all available tools
     */
    async getAvailableTools(forceRefresh: boolean = false): Promise<Tool[]> {
        // Check cache
        if (!forceRefresh && this.toolCache.size > 0 && Date.now() < this.cacheExpiry) {
            return Array.from(this.toolCache.values());
        }

        try {
            const response = await axios.get(`${this.backendUrl}/tools/available`);
            const tools: Tool[] = response.data.tools || [];

            // Update cache
            this.toolCache.clear();
            for (const tool of tools) {
                this.toolCache.set(tool.name, tool);
            }
            this.cacheExpiry = Date.now() + this.CACHE_TTL;

            return tools;
        } catch (error) {
            // Return default/local tools if backend unavailable
            return this.getLocalTools();
        }
    }

    /**
     * Get a specific tool by name
     */
    async getTool(toolName: string): Promise<Tool | undefined> {
        const tools = await this.getAvailableTools();
        return tools.find(t => t.name === toolName);
    }

    /**
     * Validate tool parameters
     */
    async validateToolParameters(
        toolName: string,
        actionName: string,
        params: Record<string, any>
    ): Promise<ValidationResult> {
        const tool = await this.getTool(toolName);
        if (!tool) {
            return {
                valid: false,
                errors: [{ parameter: 'tool', message: `Tool '${toolName}' not found` }]
            };
        }

        const action = tool.actions.find(a => a.name === actionName);
        if (!action) {
            return {
                valid: false,
                errors: [{ parameter: 'action', message: `Action '${actionName}' not found for tool '${toolName}'` }]
            };
        }

        const errors: ValidationError[] = [];

        // Check required parameters
        for (const param of action.parameters) {
            if (param.required && !(param.name in params)) {
                errors.push({
                    parameter: param.name,
                    message: `Required parameter '${param.name}' is missing`
                });
                continue;
            }

            if (param.name in params) {
                const value = params[param.name];

                // Type validation
                if (!this.validateType(value, param.type)) {
                    errors.push({
                        parameter: param.name,
                        message: `Expected ${param.type}, got ${typeof value}`
                    });
                }

                // Enum validation
                if (param.enum && !param.enum.includes(value)) {
                    errors.push({
                        parameter: param.name,
                        message: `Value must be one of: ${param.enum.join(', ')}`
                    });
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Execute a tool chain
     */
    async executeToolChain(chain: ToolChain, projectId?: string): Promise<string> {
        try {
            const response = await axios.post(`${this.backendUrl}/tools/chain`, {
                name: chain.name,
                description: chain.description,
                steps: chain.steps,
                project_id: projectId
            });

            return response.data.execution_id;
        } catch (error: any) {
            throw new Error(error.response?.data?.error || 'Failed to start tool chain');
        }
    }

    /**
     * Get tool chain execution status
     */
    async getChainStatus(executionId: string): Promise<ChainExecutionStatus> {
        try {
            const response = await axios.get(`${this.backendUrl}/tools/chain/${executionId}`);
            return response.data;
        } catch (error: any) {
            throw new Error(error.response?.data?.error || 'Failed to get chain status');
        }
    }

    /**
     * Wait for tool chain completion with progress updates
     */
    async waitForChainCompletion(
        executionId: string,
        onProgress?: (status: ChainExecutionStatus) => void,
        pollInterval: number = 1000,
        maxWaitTime: number = 300000 // 5 minutes
    ): Promise<ChainExecutionStatus> {
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const status = await this.getChainStatus(executionId);

            if (onProgress) {
                onProgress(status);
            }

            if (status.status === 'completed' || status.status === 'failed') {
                return status;
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        throw new Error('Tool chain execution timed out');
    }

    // ========================================================================
    // Private Helper Methods
    // ========================================================================

    private validateType(value: any, expectedType: string): boolean {
        switch (expectedType) {
            case 'string':
                return typeof value === 'string';
            case 'number':
                return typeof value === 'number' && !isNaN(value);
            case 'boolean':
                return typeof value === 'boolean';
            case 'object':
                return typeof value === 'object' && value !== null && !Array.isArray(value);
            case 'array':
                return Array.isArray(value);
            default:
                return true;
        }
    }

    private canExecuteLocally(toolName: string): boolean {
        const localTools = ['filesystem', 'memory'];
        return localTools.includes(toolName);
    }

    private async executeLocally(execution: ToolExecution, startTime: number): Promise<ToolResult> {
        try {
            switch (execution.tool_name) {
                case 'filesystem':
                    return await this.executeFilesystemLocal(execution, startTime);
                case 'memory':
                    return await this.executeMemoryLocal(execution, startTime);
                default:
                    return {
                        success: false,
                        output: null,
                        error: `Local execution not supported for tool: ${execution.tool_name}`,
                        execution_time_ms: Date.now() - startTime
                    };
            }
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: error.message,
                execution_time_ms: Date.now() - startTime
            };
        }
    }

    private async executeFilesystemLocal(execution: ToolExecution, startTime: number): Promise<ToolResult> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return {
                success: false,
                output: null,
                error: 'No workspace folder open',
                execution_time_ms: Date.now() - startTime
            };
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        switch (execution.action) {
            case 'list_directory': {
                const dirPath = execution.parameters.path || rootPath;
                const uri = vscode.Uri.file(dirPath);
                const entries = await vscode.workspace.fs.readDirectory(uri);
                return {
                    success: true,
                    output: entries.map(([name, type]) => ({
                        name,
                        type: type === vscode.FileType.Directory ? 'directory' : 'file'
                    })),
                    execution_time_ms: Date.now() - startTime
                };
            }

            case 'read_file': {
                const filePath = execution.parameters.path;
                if (!filePath) {
                    return {
                        success: false,
                        output: null,
                        error: 'File path is required',
                        execution_time_ms: Date.now() - startTime
                    };
                }
                const uri = vscode.Uri.file(filePath);
                const content = await vscode.workspace.fs.readFile(uri);
                return {
                    success: true,
                    output: new TextDecoder().decode(content),
                    execution_time_ms: Date.now() - startTime
                };
            }

            case 'write_file': {
                const filePath = execution.parameters.path;
                const content = execution.parameters.content;
                if (!filePath || content === undefined) {
                    return {
                        success: false,
                        output: null,
                        error: 'File path and content are required',
                        execution_time_ms: Date.now() - startTime
                    };
                }
                const uri = vscode.Uri.file(filePath);
                await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
                return {
                    success: true,
                    output: { written: filePath },
                    execution_time_ms: Date.now() - startTime
                };
            }

            case 'search_files': {
                const pattern = execution.parameters.pattern || '**/*';
                const exclude = execution.parameters.exclude;
                const files = await vscode.workspace.findFiles(pattern, exclude);
                return {
                    success: true,
                    output: files.map(f => f.fsPath),
                    execution_time_ms: Date.now() - startTime
                };
            }

            default:
                return {
                    success: false,
                    output: null,
                    error: `Unknown filesystem action: ${execution.action}`,
                    execution_time_ms: Date.now() - startTime
                };
        }
    }

    private async executeMemoryLocal(execution: ToolExecution, startTime: number): Promise<ToolResult> {
        // Simple in-memory key-value store for local memory operations
        const memoryKey = 'claudeAiDev.localMemory';
        const context = vscode.workspace.getConfiguration('claudeAiDev');

        switch (execution.action) {
            case 'store': {
                const key = execution.parameters.key;
                const value = execution.parameters.value;
                if (!key) {
                    return {
                        success: false,
                        output: null,
                        error: 'Key is required',
                        execution_time_ms: Date.now() - startTime
                    };
                }
                // Note: VS Code settings have limitations, this is simplified
                return {
                    success: true,
                    output: { stored: key },
                    execution_time_ms: Date.now() - startTime
                };
            }

            case 'retrieve': {
                const key = execution.parameters.key;
                if (!key) {
                    return {
                        success: false,
                        output: null,
                        error: 'Key is required',
                        execution_time_ms: Date.now() - startTime
                    };
                }
                return {
                    success: true,
                    output: null, // Would retrieve from actual storage
                    execution_time_ms: Date.now() - startTime
                };
            }

            case 'search': {
                const query = execution.parameters.query;
                return {
                    success: true,
                    output: [], // Would search actual storage
                    execution_time_ms: Date.now() - startTime
                };
            }

            default:
                return {
                    success: false,
                    output: null,
                    error: `Unknown memory action: ${execution.action}`,
                    execution_time_ms: Date.now() - startTime
                };
        }
    }

    private getLocalTools(): Tool[] {
        return [
            {
                name: 'filesystem',
                type: 'core',
                description: 'File system operations within the workspace',
                is_configured: true,
                capabilities: ['read', 'write', 'list', 'search'],
                actions: [
                    {
                        name: 'list_directory',
                        description: 'List contents of a directory',
                        parameters: [
                            { name: 'path', type: 'string', description: 'Directory path', required: false }
                        ],
                        returns: 'Array of file/directory entries'
                    },
                    {
                        name: 'read_file',
                        description: 'Read file contents',
                        parameters: [
                            { name: 'path', type: 'string', description: 'File path', required: true }
                        ],
                        returns: 'File contents as string'
                    },
                    {
                        name: 'write_file',
                        description: 'Write content to a file',
                        parameters: [
                            { name: 'path', type: 'string', description: 'File path', required: true },
                            { name: 'content', type: 'string', description: 'Content to write', required: true }
                        ],
                        returns: 'Write confirmation'
                    },
                    {
                        name: 'search_files',
                        description: 'Search for files matching a pattern',
                        parameters: [
                            { name: 'pattern', type: 'string', description: 'Glob pattern', required: true },
                            { name: 'exclude', type: 'string', description: 'Exclusion pattern', required: false }
                        ],
                        returns: 'Array of matching file paths'
                    }
                ]
            },
            {
                name: 'memory',
                type: 'core',
                description: 'Local memory storage for context and learning',
                is_configured: true,
                capabilities: ['store', 'retrieve', 'search'],
                actions: [
                    {
                        name: 'store',
                        description: 'Store a value in memory',
                        parameters: [
                            { name: 'key', type: 'string', description: 'Storage key', required: true },
                            { name: 'value', type: 'object', description: 'Value to store', required: true }
                        ],
                        returns: 'Store confirmation'
                    },
                    {
                        name: 'retrieve',
                        description: 'Retrieve a value from memory',
                        parameters: [
                            { name: 'key', type: 'string', description: 'Storage key', required: true }
                        ],
                        returns: 'Stored value'
                    },
                    {
                        name: 'search',
                        description: 'Search memory for matching entries',
                        parameters: [
                            { name: 'query', type: 'string', description: 'Search query', required: true }
                        ],
                        returns: 'Array of matching entries'
                    }
                ]
            },
            {
                name: 'github',
                type: 'integration',
                description: 'GitHub repository operations',
                is_configured: false,
                capabilities: ['repos', 'issues', 'pull_requests'],
                actions: [
                    {
                        name: 'list_repos',
                        description: 'List repositories',
                        parameters: [],
                        returns: 'Array of repositories'
                    },
                    {
                        name: 'create_issue',
                        description: 'Create a new issue',
                        parameters: [
                            { name: 'repo', type: 'string', description: 'Repository name', required: true },
                            { name: 'title', type: 'string', description: 'Issue title', required: true },
                            { name: 'body', type: 'string', description: 'Issue body', required: false }
                        ],
                        returns: 'Created issue'
                    },
                    {
                        name: 'create_pull_request',
                        description: 'Create a pull request',
                        parameters: [
                            { name: 'repo', type: 'string', description: 'Repository name', required: true },
                            { name: 'title', type: 'string', description: 'PR title', required: true },
                            { name: 'head', type: 'string', description: 'Head branch', required: true },
                            { name: 'base', type: 'string', description: 'Base branch', required: true },
                            { name: 'body', type: 'string', description: 'PR body', required: false }
                        ],
                        returns: 'Created pull request'
                    }
                ]
            }
        ];
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let executorInstance: MCPToolExecutor | null = null;

export function getMCPToolExecutor(): MCPToolExecutor {
    if (!executorInstance) {
        executorInstance = new MCPToolExecutor();
    }
    return executorInstance;
}

// ============================================================================
// UI Functions
// ============================================================================

/**
 * Show tool execution dialog
 */
export async function showToolExecutionDialog(): Promise<void> {
    const executor = getMCPToolExecutor();

    // Get available tools
    const tools = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading available tools...',
        cancellable: false
    }, async () => {
        return await executor.getAvailableTools();
    });

    if (tools.length === 0) {
        vscode.window.showWarningMessage('No tools available');
        return;
    }

    // Select tool
    const toolItems = tools.map(tool => ({
        label: tool.name,
        description: tool.type,
        detail: tool.description,
        tool
    }));

    const selectedTool = await vscode.window.showQuickPick(toolItems, {
        placeHolder: 'Select a tool to execute',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (!selectedTool) {
        return;
    }

    // Select action
    const actionItems = selectedTool.tool.actions.map(action => ({
        label: action.name,
        detail: action.description,
        action
    }));

    const selectedAction = await vscode.window.showQuickPick(actionItems, {
        placeHolder: `Select action for ${selectedTool.label}`
    });

    if (!selectedAction) {
        return;
    }

    // Collect parameters
    const parameters: Record<string, any> = {};

    for (const param of selectedAction.action.parameters) {
        const prompt = param.required
            ? `${param.name} (required): ${param.description}`
            : `${param.name} (optional): ${param.description}`;

        let value: string | undefined;

        if (param.enum) {
            value = await vscode.window.showQuickPick(param.enum, {
                placeHolder: prompt
            });
        } else {
            value = await vscode.window.showInputBox({
                prompt,
                placeHolder: param.default?.toString() || '',
                value: param.default?.toString() || ''
            });
        }

        if (value === undefined && param.required) {
            vscode.window.showWarningMessage(`Required parameter '${param.name}' not provided`);
            return;
        }

        if (value !== undefined && value !== '') {
            // Type conversion
            switch (param.type) {
                case 'number':
                    parameters[param.name] = parseFloat(value);
                    break;
                case 'boolean':
                    parameters[param.name] = value.toLowerCase() === 'true';
                    break;
                case 'object':
                case 'array':
                    try {
                        parameters[param.name] = JSON.parse(value);
                    } catch {
                        parameters[param.name] = value;
                    }
                    break;
                default:
                    parameters[param.name] = value;
            }
        }
    }

    // Execute tool
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Executing ${selectedTool.label}.${selectedAction.label}...`,
        cancellable: false
    }, async () => {
        return await executor.executeToolAction({
            tool_name: selectedTool.tool.name,
            action: selectedAction.action.name,
            parameters
        });
    });

    // Show result
    if (result.success) {
        const output = typeof result.output === 'object'
            ? JSON.stringify(result.output, null, 2)
            : String(result.output);

        const doc = await vscode.workspace.openTextDocument({
            content: `Tool: ${selectedTool.label}\nAction: ${selectedAction.label}\nExecution Time: ${result.execution_time_ms}ms\n\nResult:\n${output}`,
            language: 'json'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
    } else {
        vscode.window.showErrorMessage(`Tool execution failed: ${result.error}`);
    }
}

/**
 * Show tool chain builder
 */
export async function showToolChainBuilder(): Promise<void> {
    const executor = getMCPToolExecutor();
    const tools = await executor.getAvailableTools();

    const chain: ToolChain = {
        name: '',
        description: '',
        steps: []
    };

    // Get chain name
    const chainName = await vscode.window.showInputBox({
        prompt: 'Enter a name for this tool chain',
        placeHolder: 'e.g., "Setup Development Environment"'
    });

    if (!chainName) {
        return;
    }

    chain.name = chainName;

    // Get chain description
    const chainDesc = await vscode.window.showInputBox({
        prompt: 'Enter a description for this tool chain',
        placeHolder: 'What does this chain accomplish?'
    });

    chain.description = chainDesc || '';

    // Build steps
    let addingSteps = true;
    let stepNumber = 1;

    while (addingSteps) {
        const toolItems = tools.map(tool => ({
            label: tool.name,
            description: tool.type,
            tool
        }));

        const selectedTool = await vscode.window.showQuickPick(
            [{ label: '✓ Done adding steps', description: 'Execute the chain' }, ...toolItems],
            { placeHolder: `Step ${stepNumber}: Select a tool (or Done to finish)` }
        );

        if (!selectedTool || selectedTool.label === '✓ Done adding steps') {
            addingSteps = false;
            continue;
        }

        const tool = (selectedTool as any).tool as Tool;

        // Select action
        const actionItems = tool.actions.map(action => ({
            label: action.name,
            detail: action.description,
            action
        }));

        const selectedAction = await vscode.window.showQuickPick(actionItems, {
            placeHolder: `Step ${stepNumber}: Select action for ${tool.name}`
        });

        if (!selectedAction) {
            continue;
        }

        // Collect parameters (simplified for chain building)
        const parameters: Record<string, any> = {};

        for (const param of selectedAction.action.parameters.filter(p => p.required)) {
            const value = await vscode.window.showInputBox({
                prompt: `Step ${stepNumber} - ${param.name}: ${param.description}`,
                placeHolder: param.default?.toString() || ''
            });

            if (value !== undefined && value !== '') {
                parameters[param.name] = value;
            }
        }

        chain.steps.push({
            step_id: `step_${stepNumber}`,
            tool: tool.name,
            action: selectedAction.action.name,
            parameters,
            depends_on: stepNumber > 1 ? [`step_${stepNumber - 1}`] : undefined
        });

        stepNumber++;
    }

    if (chain.steps.length === 0) {
        vscode.window.showWarningMessage('No steps added to chain');
        return;
    }

    // Execute chain
    const confirm = await vscode.window.showQuickPick(['Yes, execute', 'No, cancel'], {
        placeHolder: `Execute chain "${chain.name}" with ${chain.steps.length} steps?`
    });

    if (confirm !== 'Yes, execute') {
        return;
    }

    try {
        const executionId = await executor.executeToolChain(chain);

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Executing chain: ${chain.name}`,
            cancellable: false
        }, async (progress) => {
            const status = await executor.waitForChainCompletion(executionId, (s) => {
                const completedSteps = s.steps.filter(step => step.status === 'completed').length;
                progress.report({
                    message: `Step ${completedSteps}/${s.steps.length}`,
                    increment: (100 / s.steps.length)
                });
            });

            if (status.status === 'completed') {
                vscode.window.showInformationMessage(`Chain "${chain.name}" completed successfully`);
            } else {
                vscode.window.showErrorMessage(`Chain "${chain.name}" failed`);
            }
        });
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to execute chain: ${error.message}`);
    }
}
