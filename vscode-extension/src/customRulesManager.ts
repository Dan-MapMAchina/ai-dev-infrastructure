/**
 * Custom Rules Manager - Create and manage custom code review rules
 * Phase 4: Enterprise features for custom review rules
 */

import * as vscode from 'vscode';
import axios from 'axios';

// ============================================================================
// Interfaces
// ============================================================================

export interface CustomRule {
    id?: number;
    code: string;
    name: string;
    description: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    category: 'security' | 'performance' | 'quality' | 'style' | 'custom';
    pattern: string;
    pattern_type: 'regex' | 'ast' | 'keyword';
    languages: string[];
    suggestion: string;
    fix_template?: string;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface RuleMatch {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    matchedText: string;
    message: string;
    suggestion: string;
}

export interface RuleTestResult {
    rule: CustomRule;
    matches: RuleMatch[];
    executionTimeMs: number;
    success: boolean;
    error?: string;
}

// ============================================================================
// Custom Rules Manager Class
// ============================================================================

export class CustomRulesManager {
    private backendUrl: string;
    private rulesCache: Map<string, CustomRule> = new Map();
    private cacheExpiry: number = 0;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor(backendUrl: string) {
        this.backendUrl = backendUrl;
    }

    /**
     * Load all rules for a project
     */
    async loadProjectRules(projectId?: string): Promise<CustomRule[]> {
        // Check cache
        if (this.rulesCache.size > 0 && Date.now() < this.cacheExpiry) {
            return Array.from(this.rulesCache.values());
        }

        try {
            const url = projectId
                ? `${this.backendUrl}/rules?project_id=${projectId}`
                : `${this.backendUrl}/rules`;

            const response = await axios.get(url);
            const rules: CustomRule[] = response.data.rules || [];

            // Update cache
            this.rulesCache.clear();
            for (const rule of rules) {
                this.rulesCache.set(rule.code, rule);
            }
            this.cacheExpiry = Date.now() + this.CACHE_TTL;

            return rules;
        } catch (error) {
            // Return default rules if backend unavailable
            return this.getDefaultRules();
        }
    }

    /**
     * Get a specific rule by code
     */
    async getRule(ruleCode: string): Promise<CustomRule | undefined> {
        const rules = await this.loadProjectRules();
        return rules.find(r => r.code === ruleCode);
    }

    /**
     * Create a new custom rule
     */
    async createRule(rule: CustomRule): Promise<CustomRule> {
        try {
            const response = await axios.post(`${this.backendUrl}/rules`, rule);
            const createdRule = response.data.rule || rule;

            // Update cache
            this.rulesCache.set(createdRule.code, createdRule);

            return createdRule;
        } catch (error: any) {
            throw new Error(error.response?.data?.error || 'Failed to create rule');
        }
    }

    /**
     * Update an existing rule
     */
    async updateRule(ruleCode: string, updates: Partial<CustomRule>): Promise<CustomRule> {
        try {
            const response = await axios.put(`${this.backendUrl}/rules/${ruleCode}`, updates);
            const updatedRule = response.data.rule;

            // Update cache
            if (updatedRule) {
                this.rulesCache.set(updatedRule.code, updatedRule);
            }

            return updatedRule;
        } catch (error: any) {
            throw new Error(error.response?.data?.error || 'Failed to update rule');
        }
    }

    /**
     * Delete a rule
     */
    async deleteRule(ruleCode: string): Promise<void> {
        try {
            await axios.delete(`${this.backendUrl}/rules/${ruleCode}`);

            // Remove from cache
            this.rulesCache.delete(ruleCode);
        } catch (error: any) {
            throw new Error(error.response?.data?.error || 'Failed to delete rule');
        }
    }

    /**
     * Test a rule against code
     */
    async testRule(rule: CustomRule, code: string, language: string): Promise<RuleTestResult> {
        const startTime = Date.now();

        try {
            const response = await axios.post(`${this.backendUrl}/rules/test`, {
                rule,
                code,
                language
            });

            return {
                rule,
                matches: response.data.matches || [],
                executionTimeMs: response.data.execution_time_ms || (Date.now() - startTime),
                success: true
            };
        } catch (error: any) {
            // Fallback to local regex testing
            if (rule.pattern_type === 'regex') {
                return this.testRuleLocally(rule, code, startTime);
            }

            return {
                rule,
                matches: [],
                executionTimeMs: Date.now() - startTime,
                success: false,
                error: error.response?.data?.error || 'Failed to test rule'
            };
        }
    }

    /**
     * Test rule locally using regex
     */
    private testRuleLocally(rule: CustomRule, code: string, startTime: number): RuleTestResult {
        const matches: RuleMatch[] = [];

        try {
            const regex = new RegExp(rule.pattern, 'gm');
            const lines = code.split('\n');

            let lineNumber = 0;
            for (const line of lines) {
                lineNumber++;
                let match;

                // Reset regex for each line
                regex.lastIndex = 0;

                while ((match = regex.exec(line)) !== null) {
                    matches.push({
                        line: lineNumber,
                        column: match.index + 1,
                        endLine: lineNumber,
                        endColumn: match.index + match[0].length + 1,
                        matchedText: match[0],
                        message: rule.description,
                        suggestion: rule.suggestion
                    });

                    // Prevent infinite loop on zero-width matches
                    if (match[0].length === 0) {
                        regex.lastIndex++;
                    }
                }
            }

            return {
                rule,
                matches,
                executionTimeMs: Date.now() - startTime,
                success: true
            };
        } catch (error: any) {
            return {
                rule,
                matches: [],
                executionTimeMs: Date.now() - startTime,
                success: false,
                error: `Invalid regex pattern: ${error.message}`
            };
        }
    }

    /**
     * Get default rules
     */
    private getDefaultRules(): CustomRule[] {
        return [
            {
                code: 'SEC001',
                name: 'Hardcoded Secrets',
                description: 'Detects potential hardcoded secrets or API keys',
                severity: 'error',
                category: 'security',
                pattern: '(api[_-]?key|secret|password|token)\\s*[=:]\\s*["\'][^"\']{8,}["\']',
                pattern_type: 'regex',
                languages: ['javascript', 'typescript', 'python', 'java'],
                suggestion: 'Use environment variables or a secure secrets manager',
                is_active: true
            },
            {
                code: 'SEC002',
                name: 'SQL Injection Risk',
                description: 'Detects potential SQL injection vulnerabilities',
                severity: 'error',
                category: 'security',
                pattern: '(execute|query|raw)\\s*\\([^)]*\\+|f["\'].*\\{.*\\}.*SELECT|f["\'].*\\{.*\\}.*INSERT',
                pattern_type: 'regex',
                languages: ['python', 'javascript', 'typescript'],
                suggestion: 'Use parameterized queries instead of string concatenation',
                is_active: true
            },
            {
                code: 'PERF001',
                name: 'Console Log in Production',
                description: 'Detects console.log statements that should be removed',
                severity: 'warning',
                category: 'performance',
                pattern: 'console\\.(log|debug|info)\\s*\\(',
                pattern_type: 'regex',
                languages: ['javascript', 'typescript'],
                suggestion: 'Remove console statements or use a proper logging framework',
                is_active: true
            },
            {
                code: 'QUAL001',
                name: 'TODO Comment',
                description: 'Tracks TODO comments that need attention',
                severity: 'info',
                category: 'quality',
                pattern: '//\\s*TODO|#\\s*TODO|/\\*\\s*TODO',
                pattern_type: 'regex',
                languages: ['*'],
                suggestion: 'Address or create a ticket for this TODO item',
                is_active: true
            },
            {
                code: 'STYLE001',
                name: 'Magic Numbers',
                description: 'Detects magic numbers that should be constants',
                severity: 'hint',
                category: 'style',
                pattern: '[^\\d.]\\b(\\d{3,}|[2-9]\\d)\\b(?!px|em|rem|%)',
                pattern_type: 'regex',
                languages: ['javascript', 'typescript', 'python', 'java'],
                suggestion: 'Extract magic numbers into named constants',
                is_active: true
            }
        ];
    }

    /**
     * Clear the rules cache
     */
    clearCache(): void {
        this.rulesCache.clear();
        this.cacheExpiry = 0;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let managerInstance: CustomRulesManager | null = null;

export function getCustomRulesManager(backendUrl: string): CustomRulesManager {
    if (!managerInstance) {
        managerInstance = new CustomRulesManager(backendUrl);
    }
    return managerInstance;
}

// ============================================================================
// Panel Management
// ============================================================================

let rulesPanel: vscode.WebviewPanel | undefined;

/**
 * Show the custom rules manager panel
 */
export async function showCustomRulesManager(backendUrl: string): Promise<void> {
    if (rulesPanel) {
        rulesPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    rulesPanel = vscode.window.createWebviewPanel(
        'claudeAiDev.customRules',
        'Custom Review Rules',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    const manager = getCustomRulesManager(backendUrl);

    rulesPanel.webview.html = await buildRulesPanelHTML(manager);

    rulesPanel.webview.onDidReceiveMessage(async message => {
        switch (message.command) {
            case 'createRule':
                await handleCreateRule(message.rule, manager);
                break;
            case 'updateRule':
                await handleUpdateRule(message.ruleCode, message.updates, manager);
                break;
            case 'deleteRule':
                await handleDeleteRule(message.ruleCode, manager);
                break;
            case 'testRule':
                await handleTestRule(message.rule, message.code, message.language, manager);
                break;
            case 'toggleRule':
                await handleToggleRule(message.ruleCode, message.isActive, manager);
                break;
            case 'refresh':
                manager.clearCache();
                rulesPanel!.webview.html = await buildRulesPanelHTML(manager);
                break;
        }
    });

    rulesPanel.onDidDispose(() => {
        rulesPanel = undefined;
    });
}

async function handleCreateRule(rule: CustomRule, manager: CustomRulesManager): Promise<void> {
    try {
        const created = await manager.createRule(rule);
        rulesPanel?.webview.postMessage({
            command: 'ruleCreated',
            rule: created
        });
        vscode.window.showInformationMessage(`Rule "${rule.name}" created successfully`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to create rule: ${error.message}`);
    }
}

async function handleUpdateRule(ruleCode: string, updates: Partial<CustomRule>, manager: CustomRulesManager): Promise<void> {
    try {
        const updated = await manager.updateRule(ruleCode, updates);
        rulesPanel?.webview.postMessage({
            command: 'ruleUpdated',
            rule: updated
        });
        vscode.window.showInformationMessage(`Rule "${ruleCode}" updated`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to update rule: ${error.message}`);
    }
}

async function handleDeleteRule(ruleCode: string, manager: CustomRulesManager): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Delete rule "${ruleCode}"? This cannot be undone.`,
        'Delete',
        'Cancel'
    );

    if (confirm !== 'Delete') return;

    try {
        await manager.deleteRule(ruleCode);
        rulesPanel?.webview.postMessage({
            command: 'ruleDeleted',
            ruleCode
        });
        vscode.window.showInformationMessage(`Rule "${ruleCode}" deleted`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to delete rule: ${error.message}`);
    }
}

async function handleTestRule(rule: CustomRule, code: string, language: string, manager: CustomRulesManager): Promise<void> {
    const result = await manager.testRule(rule, code, language);
    rulesPanel?.webview.postMessage({
        command: 'testResult',
        result
    });
}

async function handleToggleRule(ruleCode: string, isActive: boolean, manager: CustomRulesManager): Promise<void> {
    try {
        await manager.updateRule(ruleCode, { is_active: isActive });
        vscode.window.showInformationMessage(`Rule "${ruleCode}" ${isActive ? 'enabled' : 'disabled'}`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to toggle rule: ${error.message}`);
    }
}

// ============================================================================
// HTML Builder
// ============================================================================

async function buildRulesPanelHTML(manager: CustomRulesManager): Promise<string> {
    const rules = await manager.loadProjectRules();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Custom Review Rules</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --card-bg: var(--vscode-editorWidget-background);
            --accent-color: var(--vscode-button-background);
            --error-color: #f44336;
            --warning-color: #ff9800;
            --info-color: #2196f3;
            --hint-color: #9e9e9e;
        }

        * { box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family);
            background: var(--bg-color);
            color: var(--text-color);
            padding: 20px;
            margin: 0;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 10px;
        }

        .header h1 { margin: 0; font-size: 1.5em; }

        .controls { display: flex; gap: 10px; }

        button, select, input, textarea {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--border-color);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
        }

        button {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
            cursor: pointer;
        }

        button:hover { opacity: 0.9; }
        button.secondary { background: transparent; border: 1px solid var(--border-color); }
        button.danger { background: var(--error-color); }

        .tabs {
            display: flex;
            gap: 5px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 10px;
        }

        .tab {
            padding: 8px 16px;
            background: transparent;
            border: none;
            cursor: pointer;
            opacity: 0.7;
        }

        .tab.active { opacity: 1; border-bottom: 2px solid var(--accent-color); }

        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .rule-list { display: flex; flex-direction: column; gap: 10px; }

        .rule-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 15px;
        }

        .rule-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10px;
        }

        .rule-title {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .rule-code {
            font-family: monospace;
            background: rgba(255,255,255,0.1);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.85em;
        }

        .rule-name { font-weight: bold; }

        .severity-badge {
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.75em;
            text-transform: uppercase;
        }

        .severity-error { background: var(--error-color); color: white; }
        .severity-warning { background: var(--warning-color); color: black; }
        .severity-info { background: var(--info-color); color: white; }
        .severity-hint { background: var(--hint-color); color: white; }

        .rule-description {
            font-size: 0.9em;
            opacity: 0.8;
            margin-bottom: 10px;
        }

        .rule-meta {
            display: flex;
            gap: 15px;
            font-size: 0.85em;
            opacity: 0.7;
        }

        .rule-actions {
            display: flex;
            gap: 5px;
        }

        .rule-actions button {
            padding: 4px 8px;
            font-size: 0.85em;
        }

        .toggle-switch {
            position: relative;
            width: 40px;
            height: 20px;
        }

        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--border-color);
            border-radius: 20px;
            transition: 0.3s;
        }

        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 14px;
            width: 14px;
            left: 3px;
            bottom: 3px;
            background: white;
            border-radius: 50%;
            transition: 0.3s;
        }

        input:checked + .toggle-slider { background: var(--accent-color); }
        input:checked + .toggle-slider:before { transform: translateX(20px); }

        .form-section {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .form-section h3 { margin: 0 0 15px 0; }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }

        .form-group input,
        .form-group textarea,
        .form-group select {
            width: 100%;
        }

        .form-group textarea {
            min-height: 100px;
            resize: vertical;
        }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }

        .test-area {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        .test-code textarea {
            min-height: 200px;
            font-family: monospace;
        }

        .test-results {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 15px;
            max-height: 300px;
            overflow-y: auto;
        }

        .match-item {
            padding: 10px;
            border-bottom: 1px solid var(--border-color);
        }

        .match-item:last-child { border-bottom: none; }

        .match-location {
            font-family: monospace;
            font-size: 0.85em;
            color: var(--accent-color);
        }

        .match-text {
            font-family: monospace;
            background: rgba(255,0,0,0.1);
            padding: 2px 4px;
            border-radius: 2px;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            opacity: 0.7;
        }

        @media (max-width: 800px) {
            .form-row, .test-area { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Custom Review Rules</h1>
        <div class="controls">
            <button onclick="showTab('list')">View Rules</button>
            <button onclick="showTab('create')">Create Rule</button>
            <button onclick="showTab('test')">Test Rules</button>
            <button class="secondary" onclick="refresh()">Refresh</button>
        </div>
    </div>

    <div id="list-tab" class="tab-content active">
        <div class="rule-list">
            ${rules.length > 0 ? rules.map(rule => `
                <div class="rule-card" data-code="${rule.code}">
                    <div class="rule-header">
                        <div class="rule-title">
                            <span class="rule-code">${rule.code}</span>
                            <span class="rule-name">${rule.name}</span>
                            <span class="severity-badge severity-${rule.severity}">${rule.severity}</span>
                        </div>
                        <div class="rule-actions">
                            <label class="toggle-switch">
                                <input type="checkbox" ${rule.is_active ? 'checked' : ''}
                                       onchange="toggleRule('${rule.code}', this.checked)">
                                <span class="toggle-slider"></span>
                            </label>
                            <button class="secondary" onclick="editRule('${rule.code}')">Edit</button>
                            <button class="danger" onclick="deleteRule('${rule.code}')">Delete</button>
                        </div>
                    </div>
                    <div class="rule-description">${rule.description}</div>
                    <div class="rule-meta">
                        <span>Category: ${rule.category}</span>
                        <span>Languages: ${rule.languages.join(', ')}</span>
                        <span>Pattern: ${rule.pattern_type}</span>
                    </div>
                </div>
            `).join('') : '<div class="empty-state">No custom rules defined. Create one to get started.</div>'}
        </div>
    </div>

    <div id="create-tab" class="tab-content">
        <div class="form-section">
            <h3>Create New Rule</h3>
            <form id="create-form" onsubmit="createRule(event)">
                <div class="form-row">
                    <div class="form-group">
                        <label for="rule-code">Rule Code</label>
                        <input type="text" id="rule-code" placeholder="e.g., SEC003" required pattern="[A-Z]{2,5}[0-9]{3}">
                    </div>
                    <div class="form-group">
                        <label for="rule-name">Rule Name</label>
                        <input type="text" id="rule-name" placeholder="e.g., Unsafe Eval Usage" required>
                    </div>
                </div>
                <div class="form-group">
                    <label for="rule-description">Description</label>
                    <textarea id="rule-description" placeholder="Describe what this rule detects..." required></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="rule-severity">Severity</label>
                        <select id="rule-severity" required>
                            <option value="error">Error (Critical)</option>
                            <option value="warning">Warning</option>
                            <option value="info">Info</option>
                            <option value="hint">Hint</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="rule-category">Category</label>
                        <select id="rule-category" required>
                            <option value="security">Security</option>
                            <option value="performance">Performance</option>
                            <option value="quality">Code Quality</option>
                            <option value="style">Style</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="rule-pattern-type">Pattern Type</label>
                        <select id="rule-pattern-type" required>
                            <option value="regex">Regular Expression</option>
                            <option value="keyword">Keyword Match</option>
                            <option value="ast">AST Pattern (Advanced)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="rule-languages">Languages (comma-separated)</label>
                        <input type="text" id="rule-languages" placeholder="javascript, typescript, python" value="*">
                    </div>
                </div>
                <div class="form-group">
                    <label for="rule-pattern">Pattern</label>
                    <textarea id="rule-pattern" placeholder="Enter regex pattern..." required></textarea>
                </div>
                <div class="form-group">
                    <label for="rule-suggestion">Fix Suggestion</label>
                    <textarea id="rule-suggestion" placeholder="How should the developer fix this issue?"></textarea>
                </div>
                <button type="submit">Create Rule</button>
            </form>
        </div>
    </div>

    <div id="test-tab" class="tab-content">
        <div class="form-section">
            <h3>Test Rules</h3>
            <div class="form-row">
                <div class="form-group">
                    <label for="test-rule-select">Select Rule to Test</label>
                    <select id="test-rule-select">
                        ${rules.map(r => `<option value="${r.code}">${r.code} - ${r.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label for="test-language">Language</label>
                    <select id="test-language">
                        <option value="javascript">JavaScript</option>
                        <option value="typescript">TypeScript</option>
                        <option value="python">Python</option>
                        <option value="java">Java</option>
                        <option value="go">Go</option>
                    </select>
                </div>
            </div>
            <div class="test-area">
                <div class="test-code">
                    <label>Test Code</label>
                    <textarea id="test-code" placeholder="Paste code to test against the rule..."></textarea>
                    <button onclick="testRule()" style="margin-top: 10px;">Run Test</button>
                </div>
                <div>
                    <label>Results</label>
                    <div class="test-results" id="test-results">
                        <div class="empty-state">Run a test to see results</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const rules = ${JSON.stringify(rules)};

        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.getElementById(tabName + '-tab').classList.add('active');
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function createRule(event) {
            event.preventDefault();
            const rule = {
                code: document.getElementById('rule-code').value,
                name: document.getElementById('rule-name').value,
                description: document.getElementById('rule-description').value,
                severity: document.getElementById('rule-severity').value,
                category: document.getElementById('rule-category').value,
                pattern_type: document.getElementById('rule-pattern-type').value,
                languages: document.getElementById('rule-languages').value.split(',').map(l => l.trim()),
                pattern: document.getElementById('rule-pattern').value,
                suggestion: document.getElementById('rule-suggestion').value,
                is_active: true
            };
            vscode.postMessage({ command: 'createRule', rule });
        }

        function editRule(ruleCode) {
            const rule = rules.find(r => r.code === ruleCode);
            if (rule) {
                document.getElementById('rule-code').value = rule.code;
                document.getElementById('rule-name').value = rule.name;
                document.getElementById('rule-description').value = rule.description;
                document.getElementById('rule-severity').value = rule.severity;
                document.getElementById('rule-category').value = rule.category;
                document.getElementById('rule-pattern-type').value = rule.pattern_type;
                document.getElementById('rule-languages').value = rule.languages.join(', ');
                document.getElementById('rule-pattern').value = rule.pattern;
                document.getElementById('rule-suggestion').value = rule.suggestion || '';
                showTab('create');
            }
        }

        function deleteRule(ruleCode) {
            vscode.postMessage({ command: 'deleteRule', ruleCode });
        }

        function toggleRule(ruleCode, isActive) {
            vscode.postMessage({ command: 'toggleRule', ruleCode, isActive });
        }

        function testRule() {
            const ruleCode = document.getElementById('test-rule-select').value;
            const rule = rules.find(r => r.code === ruleCode);
            const code = document.getElementById('test-code').value;
            const language = document.getElementById('test-language').value;

            if (rule && code) {
                vscode.postMessage({ command: 'testRule', rule, code, language });
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'testResult':
                    displayTestResults(message.result);
                    break;
                case 'ruleCreated':
                case 'ruleUpdated':
                case 'ruleDeleted':
                    refresh();
                    break;
            }
        });

        function displayTestResults(result) {
            const container = document.getElementById('test-results');
            if (!result.success) {
                container.innerHTML = '<div class="empty-state">Error: ' + (result.error || 'Test failed') + '</div>';
                return;
            }

            if (result.matches.length === 0) {
                container.innerHTML = '<div class="empty-state">No matches found (Rule passed)</div>';
                return;
            }

            container.innerHTML = '<strong>' + result.matches.length + ' match(es) found</strong>' +
                result.matches.map(m => \`
                    <div class="match-item">
                        <div class="match-location">Line \${m.line}, Column \${m.column}</div>
                        <div>Matched: <span class="match-text">\${escapeHtml(m.matchedText)}</span></div>
                        <div>\${m.suggestion}</div>
                    </div>
                \`).join('');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
}

// ============================================================================
// Quick Rule Creation
// ============================================================================

/**
 * Show quick rule creation dialog
 */
export async function showQuickRuleCreation(backendUrl: string): Promise<void> {
    const code = await vscode.window.showInputBox({
        prompt: 'Rule Code (e.g., SEC003)',
        placeHolder: 'CUSTOM001',
        validateInput: (value) => {
            if (!/^[A-Z]{2,5}\d{3}$/.test(value)) {
                return 'Code must be 2-5 uppercase letters followed by 3 digits (e.g., SEC001)';
            }
            return null;
        }
    });

    if (!code) return;

    const name = await vscode.window.showInputBox({
        prompt: 'Rule Name',
        placeHolder: 'e.g., Unsafe Eval Usage'
    });

    if (!name) return;

    const severity = await vscode.window.showQuickPick(
        ['error', 'warning', 'info', 'hint'],
        { placeHolder: 'Select severity level' }
    );

    if (!severity) return;

    const pattern = await vscode.window.showInputBox({
        prompt: 'Regex Pattern',
        placeHolder: 'e.g., eval\\s*\\('
    });

    if (!pattern) return;

    const suggestion = await vscode.window.showInputBox({
        prompt: 'Fix Suggestion',
        placeHolder: 'How should developers fix this issue?'
    });

    const rule: CustomRule = {
        code,
        name,
        description: name,
        severity: severity as 'error' | 'warning' | 'info' | 'hint',
        category: 'custom',
        pattern,
        pattern_type: 'regex',
        languages: ['*'],
        suggestion: suggestion || '',
        is_active: true
    };

    const manager = getCustomRulesManager(backendUrl);

    try {
        await manager.createRule(rule);
        vscode.window.showInformationMessage(`Rule "${code}" created successfully`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to create rule: ${error.message}`);
    }
}

/**
 * Test a rule on selected code
 */
export async function testRuleOnSelection(backendUrl: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const selection = editor.document.getText(editor.selection);
    if (!selection) {
        vscode.window.showErrorMessage('Please select code to test');
        return;
    }

    const manager = getCustomRulesManager(backendUrl);
    const rules = await manager.loadProjectRules();

    if (rules.length === 0) {
        vscode.window.showWarningMessage('No custom rules defined');
        return;
    }

    const ruleItems = rules.map(r => ({
        label: r.code,
        description: r.name,
        detail: r.description,
        rule: r
    }));

    const selected = await vscode.window.showQuickPick(ruleItems, {
        placeHolder: 'Select a rule to test'
    });

    if (!selected) return;

    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Testing rule ${selected.rule.code}...`,
        cancellable: false
    }, async () => {
        return await manager.testRule(selected.rule, selection, editor.document.languageId);
    });

    if (result.matches.length === 0) {
        vscode.window.showInformationMessage(`Rule ${selected.rule.code}: No matches found (code passes)`);
    } else {
        vscode.window.showWarningMessage(
            `Rule ${selected.rule.code}: ${result.matches.length} match(es) found`,
            'View Details'
        ).then(action => {
            if (action === 'View Details') {
                showTestResultsDocument(result);
            }
        });
    }
}

async function showTestResultsDocument(result: RuleTestResult): Promise<void> {
    const content = `# Rule Test Results: ${result.rule.code}

**Rule:** ${result.rule.name}
**Severity:** ${result.rule.severity}
**Execution Time:** ${result.executionTimeMs}ms

## Matches Found: ${result.matches.length}

${result.matches.map((m, i) => `
### Match ${i + 1}
- **Location:** Line ${m.line}, Column ${m.column}
- **Text:** \`${m.matchedText}\`
- **Suggestion:** ${m.suggestion}
`).join('\n')}
`;

    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}
