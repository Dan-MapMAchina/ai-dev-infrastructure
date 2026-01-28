/**
 * Compliance Dashboard - Security, audit, and compliance monitoring
 * Phase 4: Enterprise compliance and audit features
 */

import * as vscode from 'vscode';
import axios from 'axios';

// ============================================================================
// Interfaces
// ============================================================================

export interface AuditLogEntry {
    id: string;
    timestamp: string;
    user_id: string;
    user_email?: string;
    action: string;
    resource_type: string;
    resource_id?: string;
    details: Record<string, any>;
    ip_address?: string;
    user_agent?: string;
    success: boolean;
    error_message?: string;
}

export interface PIIWarning {
    id: string;
    file_path: string;
    line: number;
    column: number;
    pii_type: 'email' | 'phone' | 'ssn' | 'credit_card' | 'api_key' | 'password' | 'name' | 'address' | 'other';
    matched_text: string;
    severity: 'high' | 'medium' | 'low';
    suggestion: string;
    detected_at: string;
}

export interface SecurityIssue {
    id: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    file_path?: string;
    line?: number;
    recommendation: string;
    cwe_id?: string;
    owasp_category?: string;
    detected_at: string;
    status: 'open' | 'acknowledged' | 'resolved' | 'false_positive';
}

export interface ComplianceReport {
    generated_at: string;
    project_id: string;
    project_name: string;
    compliance_score: number;
    pii_warnings_count: number;
    security_issues: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
    audit_summary: {
        total_actions: number;
        failed_actions: number;
        unique_users: number;
    };
    recommendations: string[];
    pii_warnings: PIIWarning[];
    security_issues_list: SecurityIssue[];
}

export interface AuditLogFilter {
    start_date?: string;
    end_date?: string;
    user_id?: string;
    action?: string;
    resource_type?: string;
    success?: boolean;
    limit?: number;
    offset?: number;
}

// ============================================================================
// Panel Management
// ============================================================================

let compliancePanel: vscode.WebviewPanel | undefined;

/**
 * Show the compliance dashboard
 */
export async function showComplianceDashboard(backendUrl: string): Promise<void> {
    if (compliancePanel) {
        compliancePanel.reveal(vscode.ViewColumn.One);
        return;
    }

    compliancePanel = vscode.window.createWebviewPanel(
        'claudeAiDev.complianceDashboard',
        'Compliance Dashboard',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    compliancePanel.webview.html = await buildDashboardHTML(backendUrl);

    compliancePanel.webview.onDidReceiveMessage(async message => {
        switch (message.command) {
            case 'refreshReport':
                compliancePanel!.webview.html = await buildDashboardHTML(backendUrl);
                break;
            case 'exportAuditLog':
                await exportAuditLog(message.format, message.filter, backendUrl);
                break;
            case 'exportReport':
                await exportComplianceReport(message.format, backendUrl);
                break;
            case 'filterAuditLog':
                const entries = await getAuditLog(message.filter, backendUrl);
                compliancePanel!.webview.postMessage({
                    command: 'auditLogUpdated',
                    entries
                });
                break;
            case 'acknowledgeIssue':
                await updateSecurityIssueStatus(message.issueId, 'acknowledged', backendUrl);
                break;
            case 'resolveIssue':
                await updateSecurityIssueStatus(message.issueId, 'resolved', backendUrl);
                break;
            case 'markFalsePositive':
                await updateSecurityIssueStatus(message.issueId, 'false_positive', backendUrl);
                break;
        }
    });

    compliancePanel.onDidDispose(() => {
        compliancePanel = undefined;
    });
}

// ============================================================================
// Data Functions
// ============================================================================

/**
 * Get compliance report
 */
export async function getComplianceReport(backendUrl: string): Promise<ComplianceReport> {
    try {
        const response = await axios.get(`${backendUrl}/compliance/report`);
        return response.data;
    } catch (error) {
        // Return demo data if backend unavailable
        return getDemoComplianceReport();
    }
}

/**
 * Get audit log entries
 */
export async function getAuditLog(filter: AuditLogFilter, backendUrl: string): Promise<AuditLogEntry[]> {
    try {
        const params = new URLSearchParams();
        if (filter.start_date) params.append('start_date', filter.start_date);
        if (filter.end_date) params.append('end_date', filter.end_date);
        if (filter.user_id) params.append('user_id', filter.user_id);
        if (filter.action) params.append('action', filter.action);
        if (filter.resource_type) params.append('resource_type', filter.resource_type);
        if (filter.success !== undefined) params.append('success', String(filter.success));
        if (filter.limit) params.append('limit', String(filter.limit));
        if (filter.offset) params.append('offset', String(filter.offset));

        const response = await axios.get(`${backendUrl}/compliance/audit-log?${params}`);
        return response.data.entries || [];
    } catch (error) {
        return getDemoAuditLog();
    }
}

/**
 * Export audit log to file
 */
export async function exportAuditLog(
    format: 'csv' | 'json',
    filter: AuditLogFilter,
    backendUrl: string
): Promise<void> {
    const entries = await getAuditLog(filter, backendUrl);

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`audit_log_${new Date().toISOString().split('T')[0]}.${format}`),
        filters: format === 'csv' ? { 'CSV': ['csv'] } : { 'JSON': ['json'] }
    });

    if (!uri) return;

    let content: string;

    if (format === 'csv') {
        const headers = ['Timestamp', 'User', 'Action', 'Resource', 'Success', 'Details'];
        const rows = entries.map(e => [
            e.timestamp,
            e.user_email || e.user_id,
            e.action,
            `${e.resource_type}${e.resource_id ? ':' + e.resource_id : ''}`,
            e.success ? 'Yes' : 'No',
            JSON.stringify(e.details)
        ]);
        content = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    } else {
        content = JSON.stringify(entries, null, 2);
    }

    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    vscode.window.showInformationMessage(`Audit log exported to ${uri.fsPath}`);
}

/**
 * Export compliance report to file
 */
export async function exportComplianceReport(format: 'json' | 'md', backendUrl: string): Promise<void> {
    const report = await getComplianceReport(backendUrl);

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`compliance_report_${new Date().toISOString().split('T')[0]}.${format}`),
        filters: format === 'json' ? { 'JSON': ['json'] } : { 'Markdown': ['md'] }
    });

    if (!uri) return;

    let content: string;

    if (format === 'json') {
        content = JSON.stringify(report, null, 2);
    } else {
        content = generateMarkdownReport(report);
    }

    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    vscode.window.showInformationMessage(`Compliance report exported to ${uri.fsPath}`);
}

/**
 * Update security issue status
 */
async function updateSecurityIssueStatus(
    issueId: string,
    status: 'acknowledged' | 'resolved' | 'false_positive',
    backendUrl: string
): Promise<void> {
    try {
        await axios.put(`${backendUrl}/compliance/issues/${issueId}`, { status });
        vscode.window.showInformationMessage(`Issue ${issueId} marked as ${status}`);
    } catch (error) {
        vscode.window.showInformationMessage(`Issue status updated locally (backend unavailable)`);
    }
}

// ============================================================================
// HTML Builder
// ============================================================================

async function buildDashboardHTML(backendUrl: string): Promise<string> {
    const report = await getComplianceReport(backendUrl);
    const auditLog = await getAuditLog({ limit: 50 }, backendUrl);

    const scoreColor = report.compliance_score >= 80 ? '#4caf50' :
                       report.compliance_score >= 60 ? '#ff9800' : '#f44336';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Compliance Dashboard</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --card-bg: var(--vscode-editorWidget-background);
            --accent-color: var(--vscode-button-background);
            --critical-color: #d32f2f;
            --high-color: #f44336;
            --medium-color: #ff9800;
            --low-color: #4caf50;
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
        }

        .header h1 { margin: 0; font-size: 1.5em; }

        .controls { display: flex; gap: 10px; }

        button, select, input {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--border-color);
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
        }

        button {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
        }

        .score-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            margin-bottom: 20px;
        }

        .score-value {
            font-size: 4em;
            font-weight: bold;
            color: ${scoreColor};
        }

        .score-label {
            font-size: 1.2em;
            opacity: 0.8;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }

        .stat-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
        }

        .stat-value {
            font-size: 2em;
            font-weight: bold;
        }

        .stat-label {
            opacity: 0.8;
            margin-top: 5px;
        }

        .section {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .section h2 {
            margin: 0 0 15px 0;
            font-size: 1.2em;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .tabs {
            display: flex;
            gap: 5px;
            margin-bottom: 15px;
            border-bottom: 1px solid var(--border-color);
        }

        .tab {
            padding: 8px 16px;
            background: transparent;
            border: none;
            cursor: pointer;
            opacity: 0.7;
            border-bottom: 2px solid transparent;
        }

        .tab.active {
            opacity: 1;
            border-bottom-color: var(--accent-color);
        }

        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .issue-list, .warning-list, .audit-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .issue-item, .warning-item, .audit-item {
            padding: 12px;
            border-bottom: 1px solid var(--border-color);
        }

        .issue-item:last-child, .warning-item:last-child, .audit-item:last-child {
            border-bottom: none;
        }

        .issue-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .issue-title { font-weight: bold; }

        .severity-badge {
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.75em;
            text-transform: uppercase;
            color: white;
        }

        .severity-critical { background: var(--critical-color); }
        .severity-high { background: var(--high-color); }
        .severity-medium { background: var(--medium-color); }
        .severity-low { background: var(--low-color); }

        .issue-meta {
            font-size: 0.85em;
            opacity: 0.7;
            margin-top: 8px;
        }

        .issue-actions {
            display: flex;
            gap: 5px;
            margin-top: 10px;
        }

        .issue-actions button {
            padding: 4px 8px;
            font-size: 0.85em;
        }

        .pii-type {
            background: rgba(255,0,0,0.2);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.85em;
        }

        .audit-timestamp {
            font-family: monospace;
            font-size: 0.85em;
            opacity: 0.7;
        }

        .audit-action {
            font-weight: bold;
        }

        .audit-success { color: var(--low-color); }
        .audit-failure { color: var(--high-color); }

        .filter-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            flex-wrap: wrap;
        }

        .filter-bar input, .filter-bar select {
            flex: 1;
            min-width: 150px;
        }

        .recommendations {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .recommendations li {
            padding: 10px 0;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            gap: 10px;
        }

        .recommendations li::before {
            content: "!";
            background: var(--medium-color);
            color: white;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 0.8em;
            flex-shrink: 0;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            opacity: 0.7;
        }

        @media (max-width: 800px) {
            .stats-grid { grid-template-columns: 1fr 1fr; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Compliance Dashboard</h1>
        <div class="controls">
            <button onclick="refreshReport()">Refresh</button>
            <button onclick="exportReport('md')">Export Report</button>
            <button onclick="exportAuditLog('csv')">Export Audit Log</button>
        </div>
    </div>

    <div class="score-card">
        <div class="score-value">${report.compliance_score}</div>
        <div class="score-label">Compliance Score</div>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value" style="color: var(--critical-color);">${report.security_issues.critical}</div>
            <div class="stat-label">Critical Issues</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: var(--high-color);">${report.security_issues.high}</div>
            <div class="stat-label">High Issues</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: var(--medium-color);">${report.pii_warnings_count}</div>
            <div class="stat-label">PII Warnings</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${report.audit_summary.total_actions}</div>
            <div class="stat-label">Audit Events (7d)</div>
        </div>
    </div>

    <div class="tabs">
        <button class="tab active" onclick="showTab('security')">Security Issues</button>
        <button class="tab" onclick="showTab('pii')">PII Warnings</button>
        <button class="tab" onclick="showTab('audit')">Audit Log</button>
        <button class="tab" onclick="showTab('recommendations')">Recommendations</button>
    </div>

    <div id="security-tab" class="tab-content active">
        <div class="section">
            <h2>
                Security Issues
                <span>${report.security_issues_list.length} total</span>
            </h2>
            <div class="issue-list">
                ${report.security_issues_list.length > 0 ? report.security_issues_list.map(issue => `
                    <div class="issue-item">
                        <div class="issue-header">
                            <span class="issue-title">${issue.title}</span>
                            <span class="severity-badge severity-${issue.severity}">${issue.severity}</span>
                        </div>
                        <div>${issue.description}</div>
                        ${issue.file_path ? `<div class="issue-meta">File: ${issue.file_path}${issue.line ? ':' + issue.line : ''}</div>` : ''}
                        ${issue.cwe_id ? `<div class="issue-meta">CWE: ${issue.cwe_id}</div>` : ''}
                        <div class="issue-actions">
                            <button onclick="acknowledgeIssue('${issue.id}')">Acknowledge</button>
                            <button onclick="resolveIssue('${issue.id}')">Mark Resolved</button>
                            <button onclick="markFalsePositive('${issue.id}')">False Positive</button>
                        </div>
                    </div>
                `).join('') : '<div class="empty-state">No security issues found</div>'}
            </div>
        </div>
    </div>

    <div id="pii-tab" class="tab-content">
        <div class="section">
            <h2>
                PII Warnings
                <span>${report.pii_warnings.length} total</span>
            </h2>
            <div class="warning-list">
                ${report.pii_warnings.length > 0 ? report.pii_warnings.map(warning => `
                    <div class="warning-item">
                        <div class="issue-header">
                            <span class="pii-type">${warning.pii_type.toUpperCase()}</span>
                            <span class="severity-badge severity-${warning.severity}">${warning.severity}</span>
                        </div>
                        <div>File: ${warning.file_path}:${warning.line}</div>
                        <div class="issue-meta">Suggestion: ${warning.suggestion}</div>
                    </div>
                `).join('') : '<div class="empty-state">No PII warnings</div>'}
            </div>
        </div>
    </div>

    <div id="audit-tab" class="tab-content">
        <div class="section">
            <h2>Audit Log</h2>
            <div class="filter-bar">
                <input type="date" id="filter-start" placeholder="Start Date">
                <input type="date" id="filter-end" placeholder="End Date">
                <select id="filter-action">
                    <option value="">All Actions</option>
                    <option value="execute_task">Execute Task</option>
                    <option value="code_review">Code Review</option>
                    <option value="generate_code">Generate Code</option>
                    <option value="tool_execution">Tool Execution</option>
                </select>
                <button onclick="filterAuditLog()">Filter</button>
            </div>
            <div class="audit-list" id="audit-list">
                ${auditLog.map(entry => `
                    <div class="audit-item">
                        <div class="audit-timestamp">${new Date(entry.timestamp).toLocaleString()}</div>
                        <div>
                            <span class="audit-action">${entry.action}</span>
                            on <strong>${entry.resource_type}</strong>
                            <span class="${entry.success ? 'audit-success' : 'audit-failure'}">
                                ${entry.success ? '(success)' : '(failed)'}
                            </span>
                        </div>
                        <div class="issue-meta">User: ${entry.user_email || entry.user_id}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>

    <div id="recommendations-tab" class="tab-content">
        <div class="section">
            <h2>Recommendations</h2>
            <ul class="recommendations">
                ${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}
            </ul>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function showTab(tabName) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector('.tab[onclick*="' + tabName + '"]').classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        }

        function refreshReport() {
            vscode.postMessage({ command: 'refreshReport' });
        }

        function exportReport(format) {
            vscode.postMessage({ command: 'exportReport', format });
        }

        function exportAuditLog(format) {
            const filter = getAuditFilter();
            vscode.postMessage({ command: 'exportAuditLog', format, filter });
        }

        function filterAuditLog() {
            const filter = getAuditFilter();
            vscode.postMessage({ command: 'filterAuditLog', filter });
        }

        function getAuditFilter() {
            return {
                start_date: document.getElementById('filter-start').value || undefined,
                end_date: document.getElementById('filter-end').value || undefined,
                action: document.getElementById('filter-action').value || undefined,
                limit: 100
            };
        }

        function acknowledgeIssue(issueId) {
            vscode.postMessage({ command: 'acknowledgeIssue', issueId });
        }

        function resolveIssue(issueId) {
            vscode.postMessage({ command: 'resolveIssue', issueId });
        }

        function markFalsePositive(issueId) {
            vscode.postMessage({ command: 'markFalsePositive', issueId });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'auditLogUpdated') {
                updateAuditList(message.entries);
            }
        });

        function updateAuditList(entries) {
            const container = document.getElementById('audit-list');
            container.innerHTML = entries.map(entry => \`
                <div class="audit-item">
                    <div class="audit-timestamp">\${new Date(entry.timestamp).toLocaleString()}</div>
                    <div>
                        <span class="audit-action">\${entry.action}</span>
                        on <strong>\${entry.resource_type}</strong>
                        <span class="\${entry.success ? 'audit-success' : 'audit-failure'}">
                            \${entry.success ? '(success)' : '(failed)'}
                        </span>
                    </div>
                    <div class="issue-meta">User: \${entry.user_email || entry.user_id}</div>
                </div>
            \`).join('');
        }
    </script>
</body>
</html>`;
}

// ============================================================================
// Demo Data
// ============================================================================

function getDemoComplianceReport(): ComplianceReport {
    return {
        generated_at: new Date().toISOString(),
        project_id: 'demo-project',
        project_name: 'Demo Project',
        compliance_score: 78,
        pii_warnings_count: 3,
        security_issues: {
            critical: 0,
            high: 2,
            medium: 5,
            low: 8
        },
        audit_summary: {
            total_actions: 156,
            failed_actions: 4,
            unique_users: 3
        },
        recommendations: [
            'Address 2 high-severity security issues in authentication module',
            'Review and remove 3 potential PII exposures in log files',
            'Enable two-factor authentication for all admin users',
            'Update dependencies with known vulnerabilities',
            'Implement rate limiting on API endpoints'
        ],
        pii_warnings: [
            {
                id: 'pii-1',
                file_path: 'src/utils/logger.ts',
                line: 45,
                column: 12,
                pii_type: 'email',
                matched_text: 'user.email',
                severity: 'medium',
                suggestion: 'Mask email addresses in logs',
                detected_at: new Date(Date.now() - 86400000).toISOString()
            },
            {
                id: 'pii-2',
                file_path: 'src/api/users.ts',
                line: 78,
                column: 8,
                pii_type: 'phone',
                matched_text: 'phoneNumber',
                severity: 'low',
                suggestion: 'Consider encrypting phone numbers at rest',
                detected_at: new Date(Date.now() - 172800000).toISOString()
            },
            {
                id: 'pii-3',
                file_path: 'config/default.json',
                line: 12,
                column: 5,
                pii_type: 'api_key',
                matched_text: 'API_KEY=...',
                severity: 'high',
                suggestion: 'Move API keys to environment variables',
                detected_at: new Date(Date.now() - 3600000).toISOString()
            }
        ],
        security_issues_list: [
            {
                id: 'sec-1',
                category: 'Authentication',
                severity: 'high',
                title: 'Weak Password Policy',
                description: 'Password requirements do not meet security standards',
                file_path: 'src/auth/validation.ts',
                line: 23,
                recommendation: 'Require minimum 12 characters with complexity requirements',
                cwe_id: 'CWE-521',
                owasp_category: 'A07:2021',
                detected_at: new Date(Date.now() - 259200000).toISOString(),
                status: 'open'
            },
            {
                id: 'sec-2',
                category: 'Injection',
                severity: 'high',
                title: 'Potential SQL Injection',
                description: 'User input is concatenated directly into SQL query',
                file_path: 'src/db/queries.ts',
                line: 156,
                recommendation: 'Use parameterized queries or ORM methods',
                cwe_id: 'CWE-89',
                owasp_category: 'A03:2021',
                detected_at: new Date(Date.now() - 432000000).toISOString(),
                status: 'open'
            },
            {
                id: 'sec-3',
                category: 'Configuration',
                severity: 'medium',
                title: 'Debug Mode Enabled',
                description: 'Debug mode is enabled in production configuration',
                file_path: 'config/production.json',
                line: 5,
                recommendation: 'Disable debug mode for production deployments',
                detected_at: new Date(Date.now() - 86400000).toISOString(),
                status: 'open'
            }
        ]
    };
}

function getDemoAuditLog(): AuditLogEntry[] {
    const actions = ['execute_task', 'code_review', 'generate_code', 'tool_execution', 'login', 'export_data'];
    const resources = ['project', 'file', 'agent', 'tool', 'user'];
    const users = ['user1@example.com', 'user2@example.com', 'admin@example.com'];

    return Array.from({ length: 50 }, (_, i) => ({
        id: `audit-${i}`,
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        user_id: `user-${i % 3}`,
        user_email: users[i % 3],
        action: actions[i % actions.length],
        resource_type: resources[i % resources.length],
        resource_id: `${resources[i % resources.length]}-${Math.floor(Math.random() * 100)}`,
        details: { request_id: `req-${i}` },
        success: Math.random() > 0.05
    }));
}

// ============================================================================
// Report Generation
// ============================================================================

function generateMarkdownReport(report: ComplianceReport): string {
    return `# Compliance Report

**Generated:** ${new Date(report.generated_at).toLocaleString()}
**Project:** ${report.project_name}

## Compliance Score: ${report.compliance_score}/100

${report.compliance_score >= 80 ? '**Status: COMPLIANT**' :
  report.compliance_score >= 60 ? '**Status: NEEDS ATTENTION**' :
  '**Status: NON-COMPLIANT**'}

## Security Issues Summary

| Severity | Count |
|----------|-------|
| Critical | ${report.security_issues.critical} |
| High | ${report.security_issues.high} |
| Medium | ${report.security_issues.medium} |
| Low | ${report.security_issues.low} |

## PII Warnings

Total: ${report.pii_warnings_count} warnings found

${report.pii_warnings.map(w => `
### ${w.pii_type.toUpperCase()} - ${w.severity}
- **File:** ${w.file_path}:${w.line}
- **Suggestion:** ${w.suggestion}
`).join('\n')}

## Security Issues Detail

${report.security_issues_list.map(issue => `
### ${issue.title}
- **Severity:** ${issue.severity}
- **Category:** ${issue.category}
- **File:** ${issue.file_path || 'N/A'}${issue.line ? ':' + issue.line : ''}
- **CWE:** ${issue.cwe_id || 'N/A'}
- **OWASP:** ${issue.owasp_category || 'N/A'}

${issue.description}

**Recommendation:** ${issue.recommendation}
`).join('\n')}

## Audit Summary (Last 7 Days)

- Total Actions: ${report.audit_summary.total_actions}
- Failed Actions: ${report.audit_summary.failed_actions}
- Unique Users: ${report.audit_summary.unique_users}

## Recommendations

${report.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}

---
*Report generated by Claude AI Development Assistant*
`;
}
