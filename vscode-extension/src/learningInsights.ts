/**
 * Learning Insights - WebView panel for viewing agent learning progress
 * Phase 3: Visualization of agent improvement and learned patterns
 */

import * as vscode from 'vscode';
import axios from 'axios';

// ============================================================================
// Interfaces
// ============================================================================

export interface LearningCheckpoint {
    id: number;
    agent_id: number;
    agent_name: string;
    checkpoint_date: string;
    total_tasks: number;
    success_rate: number;
    average_feedback_score: number;
    learned_patterns: LearnedPattern[];
    performance_delta: number;
}

export interface LearnedPattern {
    pattern_type: string;
    description: string;
    frequency: number;
    success_rate: number;
    first_seen: string;
    examples?: string[];
}

export interface ImprovementTrend {
    date: string;
    success_rate: number;
    feedback_score: number;
    tasks_completed: number;
}

export interface AgentLearningData {
    agent_id: number;
    agent_name: string;
    agent_type: string;
    total_tasks: number;
    overall_success_rate: number;
    average_feedback: number;
    checkpoints: LearningCheckpoint[];
    learned_patterns: LearnedPattern[];
    improvement_trend: ImprovementTrend[];
    recent_insights: string[];
}

// ============================================================================
// Panel Management
// ============================================================================

let learningPanel: vscode.WebviewPanel | undefined;

/**
 * Show the learning insights panel
 */
export async function showLearningInsights(agentId?: number): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeAiDev');
    const backendUrl = config.get<string>('backendUrl', 'http://localhost:5050');

    // Create or reveal panel
    if (learningPanel) {
        learningPanel.reveal(vscode.ViewColumn.One);
    } else {
        learningPanel = vscode.window.createWebviewPanel(
            'claudeAiDev.learningInsights',
            'Agent Learning Insights',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        learningPanel.onDidDispose(() => {
            learningPanel = undefined;
        });

        // Handle messages from webview
        learningPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'selectAgent':
                    await loadAgentLearning(message.agentId, backendUrl);
                    break;
                case 'compareCheckpoints':
                    await showCheckpointComparison(message.checkpoint1, message.checkpoint2);
                    break;
                case 'exportData':
                    await exportLearningData(message.agentId);
                    break;
                case 'refresh':
                    await loadAgentLearning(message.agentId, backendUrl);
                    break;
            }
        });
    }

    // Load initial content
    learningPanel.webview.html = await buildLearningPanelHTML(backendUrl, agentId);
}

/**
 * Load learning data for a specific agent
 */
async function loadAgentLearning(agentId: number, backendUrl: string): Promise<void> {
    if (!learningPanel) return;

    try {
        const response = await axios.get(`${backendUrl}/agents/${agentId}/learning`);
        const data: AgentLearningData = response.data;

        learningPanel.webview.postMessage({
            command: 'updateLearningData',
            data
        });
    } catch (error: any) {
        learningPanel.webview.postMessage({
            command: 'error',
            message: error.response?.data?.error || 'Failed to load learning data'
        });
    }
}

/**
 * Show comparison between two checkpoints
 */
async function showCheckpointComparison(checkpoint1Id: number, checkpoint2Id: number): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeAiDev');
    const backendUrl = config.get<string>('backendUrl', 'http://localhost:5050');

    try {
        const [cp1Response, cp2Response] = await Promise.all([
            axios.get(`${backendUrl}/agents/checkpoints/${checkpoint1Id}`),
            axios.get(`${backendUrl}/agents/checkpoints/${checkpoint2Id}`)
        ]);

        const cp1: LearningCheckpoint = cp1Response.data;
        const cp2: LearningCheckpoint = cp2Response.data;

        // Show comparison in new document
        const content = buildComparisonMarkdown(cp1, cp2);
        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        });
    } catch (error: any) {
        vscode.window.showErrorMessage('Failed to load checkpoints for comparison');
    }
}

/**
 * Export learning data to file
 */
async function exportLearningData(agentId: number): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeAiDev');
    const backendUrl = config.get<string>('backendUrl', 'http://localhost:5050');

    try {
        const response = await axios.get(`${backendUrl}/agents/${agentId}/learning`);
        const data: AgentLearningData = response.data;

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`agent_${agentId}_learning.json`),
            filters: {
                'JSON': ['json'],
                'CSV': ['csv']
            }
        });

        if (uri) {
            const isCSV = uri.fsPath.endsWith('.csv');
            const content = isCSV ? convertToCSV(data) : JSON.stringify(data, null, 2);

            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
            vscode.window.showInformationMessage(`Learning data exported to ${uri.fsPath}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage('Failed to export learning data');
    }
}

// ============================================================================
// HTML Builder
// ============================================================================

async function buildLearningPanelHTML(backendUrl: string, selectedAgentId?: number): Promise<string> {
    let agents: any[] = [];
    let learningData: AgentLearningData | null = null;

    try {
        const agentsResponse = await axios.get(`${backendUrl}/agents`);
        agents = agentsResponse.data.agents || [];

        if (selectedAgentId) {
            const learningResponse = await axios.get(`${backendUrl}/agents/${selectedAgentId}/learning`);
            learningData = learningResponse.data;
        } else if (agents.length > 0) {
            try {
                const learningResponse = await axios.get(`${backendUrl}/agents/${agents[0].id}/learning`);
                learningData = learningResponse.data;
            } catch {
                // Learning data not available
            }
        }
    } catch {
        // Backend unavailable - show demo data
        agents = getDemoAgents();
        learningData = getDemoLearningData();
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent Learning Insights</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --card-bg: var(--vscode-editorWidget-background);
            --accent-color: var(--vscode-button-background);
            --success-color: #4caf50;
            --warning-color: #ff9800;
            --error-color: #f44336;
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

        .header h1 {
            margin: 0;
            font-size: 1.5em;
        }

        .controls {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        select, button {
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

        button:hover {
            opacity: 0.9;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }

        .stat-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 15px;
            text-align: center;
        }

        .stat-value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .stat-label {
            font-size: 0.85em;
            opacity: 0.8;
        }

        .stat-delta {
            font-size: 0.8em;
            margin-top: 5px;
        }

        .positive { color: var(--success-color); }
        .negative { color: var(--error-color); }

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
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 10px;
        }

        .chart-container {
            height: 200px;
            position: relative;
        }

        .chart {
            display: flex;
            align-items: flex-end;
            height: 100%;
            gap: 4px;
            padding: 10px 0;
        }

        .chart-bar {
            flex: 1;
            background: var(--accent-color);
            border-radius: 4px 4px 0 0;
            min-width: 20px;
            max-width: 40px;
            transition: height 0.3s ease;
            position: relative;
        }

        .chart-bar:hover::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            padding: 5px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            white-space: nowrap;
        }

        .pattern-list {
            max-height: 300px;
            overflow-y: auto;
        }

        .pattern-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            border-bottom: 1px solid var(--border-color);
        }

        .pattern-item:last-child {
            border-bottom: none;
        }

        .pattern-info {
            flex: 1;
        }

        .pattern-type {
            font-weight: bold;
            font-size: 0.9em;
        }

        .pattern-desc {
            font-size: 0.85em;
            opacity: 0.8;
            margin-top: 3px;
        }

        .pattern-stats {
            text-align: right;
            font-size: 0.85em;
        }

        .checkpoint-list {
            max-height: 250px;
            overflow-y: auto;
        }

        .checkpoint-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            margin-bottom: 8px;
            cursor: pointer;
        }

        .checkpoint-item:hover {
            background: rgba(255,255,255,0.05);
        }

        .checkpoint-date {
            font-weight: bold;
        }

        .checkpoint-stats {
            display: flex;
            gap: 15px;
            font-size: 0.85em;
        }

        .insights-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .insights-list li {
            padding: 8px 0;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }

        .insights-list li::before {
            content: "💡";
        }

        .insights-list li:last-child {
            border-bottom: none;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            opacity: 0.7;
        }

        .loading {
            text-align: center;
            padding: 40px;
        }

        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--border-color);
            border-top-color: var(--accent-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .two-column {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        @media (max-width: 800px) {
            .two-column {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Agent Learning Insights</h1>
        <div class="controls">
            <select id="agentSelect" onchange="selectAgent(this.value)">
                ${agents.map(a => `
                    <option value="${a.id}" ${learningData && learningData.agent_id === a.id ? 'selected' : ''}>
                        ${a.agent_name || a.name}
                    </option>
                `).join('')}
            </select>
            <button onclick="refreshData()">Refresh</button>
            <button onclick="exportData()">Export</button>
        </div>
    </div>

    <div id="content">
        ${learningData ? buildLearningContent(learningData) : '<div class="empty-state">Select an agent to view learning insights</div>'}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentAgentId = ${learningData?.agent_id || 'null'};

        function selectAgent(agentId) {
            currentAgentId = parseInt(agentId);
            showLoading();
            vscode.postMessage({ command: 'selectAgent', agentId: currentAgentId });
        }

        function refreshData() {
            if (currentAgentId) {
                showLoading();
                vscode.postMessage({ command: 'refresh', agentId: currentAgentId });
            }
        }

        function exportData() {
            if (currentAgentId) {
                vscode.postMessage({ command: 'exportData', agentId: currentAgentId });
            }
        }

        function compareCheckpoints(cp1, cp2) {
            vscode.postMessage({ command: 'compareCheckpoints', checkpoint1: cp1, checkpoint2: cp2 });
        }

        function showLoading() {
            document.getElementById('content').innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateLearningData':
                    document.getElementById('content').innerHTML = buildContent(message.data);
                    currentAgentId = message.data.agent_id;
                    break;
                case 'error':
                    document.getElementById('content').innerHTML = '<div class="empty-state">Error: ' + message.message + '</div>';
                    break;
            }
        });

        function buildContent(data) {
            // Build content dynamically - simplified version
            return \`
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">\${data.total_tasks || 0}</div>
                        <div class="stat-label">Total Tasks</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">\${((data.overall_success_rate || 0) * 100).toFixed(1)}%</div>
                        <div class="stat-label">Success Rate</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">\${(data.average_feedback || 0).toFixed(1)}</div>
                        <div class="stat-label">Avg Feedback</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">\${(data.learned_patterns || []).length}</div>
                        <div class="stat-label">Patterns Learned</div>
                    </div>
                </div>
                <div class="section">
                    <h2>Improvement Trend</h2>
                    <div class="chart-container">
                        <div class="chart">
                            \${(data.improvement_trend || []).map(t => \`
                                <div class="chart-bar"
                                     style="height: \${t.success_rate * 100}%"
                                     data-tooltip="\${t.date}: \${(t.success_rate * 100).toFixed(0)}%">
                                </div>
                            \`).join('')}
                        </div>
                    </div>
                </div>
            \`;
        }
    </script>
</body>
</html>`;
}

function buildLearningContent(data: AgentLearningData): string {
    const successDelta = data.checkpoints.length >= 2
        ? (data.checkpoints[data.checkpoints.length - 1].success_rate -
           data.checkpoints[data.checkpoints.length - 2].success_rate) * 100
        : 0;

    return `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${data.total_tasks || 0}</div>
                <div class="stat-label">Total Tasks</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${((data.overall_success_rate || 0) * 100).toFixed(1)}%</div>
                <div class="stat-label">Success Rate</div>
                ${successDelta !== 0 ? `
                    <div class="stat-delta ${successDelta > 0 ? 'positive' : 'negative'}">
                        ${successDelta > 0 ? '+' : ''}${successDelta.toFixed(1)}%
                    </div>
                ` : ''}
            </div>
            <div class="stat-card">
                <div class="stat-value">${(data.average_feedback || 0).toFixed(1)}</div>
                <div class="stat-label">Avg Feedback (1-5)</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.learned_patterns.length}</div>
                <div class="stat-label">Patterns Learned</div>
            </div>
        </div>

        <div class="section">
            <h2>Improvement Trend</h2>
            <div class="chart-container">
                <div class="chart">
                    ${data.improvement_trend.map(t => `
                        <div class="chart-bar"
                             style="height: ${t.success_rate * 100}%"
                             data-tooltip="${t.date}: ${(t.success_rate * 100).toFixed(0)}%">
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <div class="two-column">
            <div class="section">
                <h2>Learned Patterns</h2>
                <div class="pattern-list">
                    ${data.learned_patterns.length > 0 ? data.learned_patterns.map(p => `
                        <div class="pattern-item">
                            <div class="pattern-info">
                                <div class="pattern-type">${p.pattern_type}</div>
                                <div class="pattern-desc">${p.description}</div>
                            </div>
                            <div class="pattern-stats">
                                <div>${(p.success_rate * 100).toFixed(0)}% success</div>
                                <div>${p.frequency} occurrences</div>
                            </div>
                        </div>
                    `).join('') : '<div class="empty-state">No patterns learned yet</div>'}
                </div>
            </div>

            <div class="section">
                <h2>Learning Checkpoints</h2>
                <div class="checkpoint-list">
                    ${data.checkpoints.length > 0 ? data.checkpoints.slice().reverse().map(cp => `
                        <div class="checkpoint-item" onclick="compareCheckpoints(${cp.id}, ${data.checkpoints[0]?.id || cp.id})">
                            <div class="checkpoint-date">${new Date(cp.checkpoint_date).toLocaleDateString()}</div>
                            <div class="checkpoint-stats">
                                <span>${cp.total_tasks} tasks</span>
                                <span>${(cp.success_rate * 100).toFixed(0)}%</span>
                                <span class="${cp.performance_delta >= 0 ? 'positive' : 'negative'}">
                                    ${cp.performance_delta >= 0 ? '+' : ''}${(cp.performance_delta * 100).toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    `).join('') : '<div class="empty-state">No checkpoints yet</div>'}
                </div>
            </div>
        </div>

        ${data.recent_insights.length > 0 ? `
            <div class="section">
                <h2>Recent Insights</h2>
                <ul class="insights-list">
                    ${data.recent_insights.map(insight => `
                        <li>${insight}</li>
                    `).join('')}
                </ul>
            </div>
        ` : ''}
    `;
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildComparisonMarkdown(cp1: LearningCheckpoint, cp2: LearningCheckpoint): string {
    const successDelta = (cp2.success_rate - cp1.success_rate) * 100;
    const feedbackDelta = cp2.average_feedback_score - cp1.average_feedback_score;
    const tasksDelta = cp2.total_tasks - cp1.total_tasks;

    return `# Checkpoint Comparison

## ${cp1.agent_name}

| Metric | ${new Date(cp1.checkpoint_date).toLocaleDateString()} | ${new Date(cp2.checkpoint_date).toLocaleDateString()} | Change |
|--------|------|------|--------|
| Tasks | ${cp1.total_tasks} | ${cp2.total_tasks} | ${tasksDelta >= 0 ? '+' : ''}${tasksDelta} |
| Success Rate | ${(cp1.success_rate * 100).toFixed(1)}% | ${(cp2.success_rate * 100).toFixed(1)}% | ${successDelta >= 0 ? '+' : ''}${successDelta.toFixed(1)}% |
| Feedback | ${cp1.average_feedback_score.toFixed(2)} | ${cp2.average_feedback_score.toFixed(2)} | ${feedbackDelta >= 0 ? '+' : ''}${feedbackDelta.toFixed(2)} |

## New Patterns Learned

${cp2.learned_patterns.filter(p =>
    !cp1.learned_patterns.some(p1 => p1.pattern_type === p.pattern_type)
).map(p => `- **${p.pattern_type}**: ${p.description}`).join('\n') || '_No new patterns_'}

## Insights

${successDelta > 0
    ? `- Performance improved by ${successDelta.toFixed(1)}% between checkpoints`
    : successDelta < 0
        ? `- Performance decreased by ${Math.abs(successDelta).toFixed(1)}% - review recent tasks`
        : `- Performance remained stable`}
${feedbackDelta > 0
    ? `- User feedback improved`
    : feedbackDelta < 0
        ? `- User feedback decreased - consider reviewing agent responses`
        : ''}
`;
}

function convertToCSV(data: AgentLearningData): string {
    const rows: string[] = [];

    // Header
    rows.push('Agent Learning Report');
    rows.push(`Agent: ${data.agent_name} (${data.agent_type})`);
    rows.push(`Generated: ${new Date().toISOString()}`);
    rows.push('');

    // Summary stats
    rows.push('Summary Statistics');
    rows.push('Metric,Value');
    rows.push(`Total Tasks,${data.total_tasks}`);
    rows.push(`Success Rate,${(data.overall_success_rate * 100).toFixed(1)}%`);
    rows.push(`Average Feedback,${data.average_feedback.toFixed(2)}`);
    rows.push(`Patterns Learned,${data.learned_patterns.length}`);
    rows.push('');

    // Improvement trend
    rows.push('Improvement Trend');
    rows.push('Date,Success Rate,Feedback Score,Tasks Completed');
    for (const t of data.improvement_trend) {
        rows.push(`${t.date},${(t.success_rate * 100).toFixed(1)}%,${t.feedback_score.toFixed(2)},${t.tasks_completed}`);
    }
    rows.push('');

    // Learned patterns
    rows.push('Learned Patterns');
    rows.push('Type,Description,Frequency,Success Rate,First Seen');
    for (const p of data.learned_patterns) {
        rows.push(`"${p.pattern_type}","${p.description}",${p.frequency},${(p.success_rate * 100).toFixed(1)}%,${p.first_seen}`);
    }

    return rows.join('\n');
}

function getDemoAgents(): any[] {
    return [
        { id: 1, agent_name: 'Code Review Specialist' },
        { id: 2, agent_name: 'Refactoring Specialist' },
        { id: 3, agent_name: 'Test Engineer' }
    ];
}

function getDemoLearningData(): AgentLearningData {
    return {
        agent_id: 1,
        agent_name: 'Code Review Specialist',
        agent_type: 'code_review',
        total_tasks: 127,
        overall_success_rate: 0.89,
        average_feedback: 4.2,
        checkpoints: [
            {
                id: 1,
                agent_id: 1,
                agent_name: 'Code Review Specialist',
                checkpoint_date: '2024-01-01',
                total_tasks: 50,
                success_rate: 0.82,
                average_feedback_score: 3.9,
                learned_patterns: [],
                performance_delta: 0
            },
            {
                id: 2,
                agent_id: 1,
                agent_name: 'Code Review Specialist',
                checkpoint_date: '2024-01-15',
                total_tasks: 85,
                success_rate: 0.86,
                average_feedback_score: 4.1,
                learned_patterns: [],
                performance_delta: 0.04
            },
            {
                id: 3,
                agent_id: 1,
                agent_name: 'Code Review Specialist',
                checkpoint_date: '2024-02-01',
                total_tasks: 127,
                success_rate: 0.89,
                average_feedback_score: 4.2,
                learned_patterns: [],
                performance_delta: 0.03
            }
        ],
        learned_patterns: [
            {
                pattern_type: 'Security Review',
                description: 'Identifies SQL injection vulnerabilities in database queries',
                frequency: 23,
                success_rate: 0.95,
                first_seen: '2024-01-05'
            },
            {
                pattern_type: 'Performance',
                description: 'Detects N+1 query patterns in ORM code',
                frequency: 18,
                success_rate: 0.88,
                first_seen: '2024-01-12'
            },
            {
                pattern_type: 'Error Handling',
                description: 'Identifies missing error handlers in async code',
                frequency: 31,
                success_rate: 0.91,
                first_seen: '2024-01-08'
            }
        ],
        improvement_trend: [
            { date: '2024-01-01', success_rate: 0.82, feedback_score: 3.9, tasks_completed: 10 },
            { date: '2024-01-08', success_rate: 0.84, feedback_score: 4.0, tasks_completed: 15 },
            { date: '2024-01-15', success_rate: 0.86, feedback_score: 4.1, tasks_completed: 20 },
            { date: '2024-01-22', success_rate: 0.87, feedback_score: 4.1, tasks_completed: 22 },
            { date: '2024-02-01', success_rate: 0.89, feedback_score: 4.2, tasks_completed: 18 }
        ],
        recent_insights: [
            'Success rate improved 7% over the past month',
            'Security review patterns now have 95% accuracy',
            'Consider expanding error handling pattern coverage'
        ]
    };
}
