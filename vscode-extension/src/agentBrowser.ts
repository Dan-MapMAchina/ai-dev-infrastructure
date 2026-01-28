import * as vscode from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';

const API_TIMEOUT = 30000;

const axiosConfig: AxiosRequestConfig = {
    timeout: API_TIMEOUT
};

// Types for agent management
export interface Agent {
    id: number;
    name: string;
    type: string;
    purpose: string;
    success_rate: number;
    tasks_completed: number;
    avg_time_ms?: number;
    last_used?: string;
}

export interface AgentExecution {
    id: number;
    task_summary: string;
    success: boolean;
    execution_time_ms: number;
    user_feedback_score?: number;
    timestamp: string;
}

export interface AgentFeedback {
    execution_id?: number;
    rating: number;  // 1-5
    feedback_text: string;
    was_helpful: boolean;
}

// State
let agentBrowserPanel: vscode.WebviewPanel | undefined;
let selectedAgentId: number | undefined;

/**
 * Get the currently selected agent ID (for manual agent override)
 */
export function getSelectedAgentId(): number | undefined {
    return selectedAgentId;
}

/**
 * Set the selected agent ID
 */
export function setSelectedAgentId(agentId: number | undefined): void {
    selectedAgentId = agentId;
}

/**
 * Clear agent selection (use auto-selection)
 */
export function clearAgentSelection(): void {
    selectedAgentId = undefined;
    vscode.window.showInformationMessage('Agent selection cleared. Auto-selection will be used.');
}

/**
 * Fetch all agents from backend
 */
export async function fetchAgents(backendUrl: string): Promise<Agent[]> {
    try {
        const response = await axios.get<{ agents: Agent[] }>(
            `${backendUrl}/agents`,
            axiosConfig
        );
        return response.data.agents || [];
    } catch (error: any) {
        console.error('Failed to fetch agents:', error.message);
        return [];
    }
}

/**
 * Fetch agent execution history
 */
export async function fetchAgentHistory(
    agentId: number,
    backendUrl: string,
    limit: number = 10
): Promise<AgentExecution[]> {
    try {
        const response = await axios.get<{ executions: AgentExecution[] }>(
            `${backendUrl}/agents/${agentId}/history?limit=${limit}`,
            axiosConfig
        );
        return response.data.executions || [];
    } catch (error: any) {
        console.error('Failed to fetch agent history:', error.message);
        return [];
    }
}

/**
 * Submit feedback for an agent
 */
export async function submitAgentFeedback(
    agentId: number,
    feedback: AgentFeedback,
    backendUrl: string
): Promise<boolean> {
    try {
        await axios.post(
            `${backendUrl}/agents/${agentId}/feedback`,
            feedback,
            axiosConfig
        );
        return true;
    } catch (error: any) {
        console.error('Failed to submit feedback:', error.message);
        return false;
    }
}

/**
 * Show agent browser panel
 */
export async function showAgentBrowser(backendUrl: string): Promise<void> {
    if (agentBrowserPanel) {
        agentBrowserPanel.reveal();
        return;
    }

    agentBrowserPanel = vscode.window.createWebviewPanel(
        'agentBrowser',
        'AI Agent Browser',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Load agents
    const agents = await fetchAgents(backendUrl);

    agentBrowserPanel.webview.html = getAgentBrowserHtml(agents, selectedAgentId);

    // Handle messages from webview
    agentBrowserPanel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'selectAgent':
                selectedAgentId = message.agentId;
                vscode.window.showInformationMessage(
                    `Agent selected: ${message.agentName}. This agent will be used for the next task.`
                );
                agentBrowserPanel?.webview.postMessage({
                    type: 'agentSelected',
                    agentId: message.agentId
                });
                break;

            case 'clearSelection':
                clearAgentSelection();
                agentBrowserPanel?.webview.postMessage({
                    type: 'selectionCleared'
                });
                break;

            case 'viewHistory':
                const history = await fetchAgentHistory(message.agentId, backendUrl);
                agentBrowserPanel?.webview.postMessage({
                    type: 'historyLoaded',
                    agentId: message.agentId,
                    history
                });
                break;

            case 'submitFeedback':
                const success = await submitAgentFeedback(
                    message.agentId,
                    message.feedback,
                    backendUrl
                );
                if (success) {
                    vscode.window.showInformationMessage('Feedback submitted. Thank you!');
                } else {
                    vscode.window.showErrorMessage('Failed to submit feedback');
                }
                break;

            case 'refresh':
                const refreshedAgents = await fetchAgents(backendUrl);
                agentBrowserPanel?.webview.postMessage({
                    type: 'agentsRefreshed',
                    agents: refreshedAgents
                });
                break;
        }
    });

    agentBrowserPanel.onDidDispose(() => {
        agentBrowserPanel = undefined;
    });
}

/**
 * Show agent selection quick pick
 */
export async function showAgentPicker(backendUrl: string): Promise<Agent | undefined> {
    const agents = await fetchAgents(backendUrl);

    if (agents.length === 0) {
        vscode.window.showWarningMessage('No agents available');
        return undefined;
    }

    const items = [
        {
            label: '$(sync) Auto-select',
            description: 'Let the system choose the best agent',
            agent: undefined as Agent | undefined
        },
        ...agents.map(agent => ({
            label: agent.name,
            description: `${agent.type} | ${Math.round(agent.success_rate * 100)}% success | ${agent.tasks_completed} tasks`,
            detail: agent.purpose,
            agent
        }))
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an agent for the next task',
        title: 'Agent Selection'
    });

    if (!selected) {
        return undefined;
    }

    if (selected.agent) {
        selectedAgentId = selected.agent.id;
        vscode.window.showInformationMessage(`Selected: ${selected.agent.name}`);
        return selected.agent;
    } else {
        clearAgentSelection();
        return undefined;
    }
}

/**
 * Show feedback dialog
 */
export async function showFeedbackDialog(
    agentId: number,
    agentName: string,
    backendUrl: string
): Promise<void> {
    // Rating
    const ratingOptions = ['5 - Excellent', '4 - Good', '3 - Average', '2 - Poor', '1 - Very Poor'];
    const ratingChoice = await vscode.window.showQuickPick(ratingOptions, {
        placeHolder: `Rate ${agentName}'s performance`,
        title: 'Agent Feedback'
    });

    if (!ratingChoice) {
        return;
    }

    const rating = parseInt(ratingChoice[0]);

    // Was it helpful?
    const helpfulChoice = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Was the response helpful?'
    });

    if (!helpfulChoice) {
        return;
    }

    // Optional comment
    const comment = await vscode.window.showInputBox({
        prompt: 'Any additional feedback? (optional)',
        placeHolder: 'Enter feedback or press Enter to skip'
    });

    const feedback: AgentFeedback = {
        rating,
        was_helpful: helpfulChoice === 'Yes',
        feedback_text: comment || ''
    };

    const success = await submitAgentFeedback(agentId, feedback, backendUrl);

    if (success) {
        vscode.window.showInformationMessage('Thank you for your feedback!');
    } else {
        vscode.window.showErrorMessage('Failed to submit feedback. Please try again.');
    }
}

/**
 * Generate HTML for agent browser
 */
function getAgentBrowserHtml(agents: Agent[], selectedId?: number): string {
    const agentCards = agents.map(agent => `
        <div class="agent-card ${agent.id === selectedId ? 'selected' : ''}" data-id="${agent.id}">
            <div class="agent-header">
                <span class="agent-name">${escapeHtml(agent.name)}</span>
                <span class="agent-type">${escapeHtml(agent.type)}</span>
            </div>
            <div class="agent-purpose">${escapeHtml(agent.purpose)}</div>
            <div class="agent-stats">
                <div class="stat">
                    <span class="stat-value">${Math.round(agent.success_rate * 100)}%</span>
                    <span class="stat-label">Success</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${agent.tasks_completed}</span>
                    <span class="stat-label">Tasks</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${agent.avg_time_ms ? Math.round(agent.avg_time_ms) + 'ms' : 'N/A'}</span>
                    <span class="stat-label">Avg Time</span>
                </div>
            </div>
            <div class="agent-actions">
                <button class="btn btn-primary" onclick="selectAgent(${agent.id}, '${escapeHtml(agent.name)}')">
                    ${agent.id === selectedId ? 'Selected' : 'Use This Agent'}
                </button>
                <button class="btn btn-secondary" onclick="viewHistory(${agent.id})">History</button>
                <button class="btn btn-secondary" onclick="showFeedbackForm(${agent.id}, '${escapeHtml(agent.name)}')">Feedback</button>
            </div>
            <div class="history-panel" id="history-${agent.id}" style="display: none;"></div>
            <div class="feedback-panel" id="feedback-${agent.id}" style="display: none;">
                <div class="feedback-form">
                    <label>Rating:</label>
                    <select id="rating-${agent.id}">
                        <option value="5">5 - Excellent</option>
                        <option value="4">4 - Good</option>
                        <option value="3">3 - Average</option>
                        <option value="2">2 - Poor</option>
                        <option value="1">1 - Very Poor</option>
                    </select>
                    <label>Helpful?</label>
                    <select id="helpful-${agent.id}">
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>
                    <label>Comment:</label>
                    <textarea id="comment-${agent.id}" placeholder="Optional feedback..."></textarea>
                    <button class="btn btn-primary" onclick="submitFeedback(${agent.id})">Submit</button>
                </div>
            </div>
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
        }
        h1 {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--vscode-input-border);
            padding-bottom: 10px;
        }
        .toolbar {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        .toolbar select, .toolbar input {
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        .agents-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        .agent-card {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 15px;
            transition: border-color 0.2s;
        }
        .agent-card:hover {
            border-color: var(--vscode-focusBorder);
        }
        .agent-card.selected {
            border-color: var(--vscode-button-background);
            border-width: 2px;
        }
        .agent-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .agent-name {
            font-size: 16px;
            font-weight: bold;
        }
        .agent-type {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
        }
        .agent-purpose {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .agent-stats {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            padding: 10px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
        }
        .stat {
            text-align: center;
        }
        .stat-value {
            display: block;
            font-size: 18px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .stat-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .agent-actions {
            display: flex;
            gap: 8px;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .history-panel, .feedback-panel {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-input-border);
        }
        .history-item {
            padding: 8px;
            margin: 5px 0;
            background: var(--vscode-editor-background);
            border-radius: 4px;
            font-size: 12px;
        }
        .history-item.success {
            border-left: 3px solid #4caf50;
        }
        .history-item.failure {
            border-left: 3px solid #f44336;
        }
        .feedback-form {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .feedback-form label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .feedback-form select, .feedback-form textarea {
            padding: 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        .feedback-form textarea {
            min-height: 60px;
            resize: vertical;
        }
        .selected-banner {
            display: ${selectedId ? 'flex' : 'none'};
            align-items: center;
            justify-content: space-between;
            padding: 10px 15px;
            margin-bottom: 20px;
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <h1>
        AI Agent Browser
        <button class="btn btn-secondary" onclick="refresh()">Refresh</button>
    </h1>

    <div class="selected-banner" id="selected-banner">
        <span>Currently selected: <strong id="selected-name"></strong></span>
        <button class="btn btn-secondary" onclick="clearSelection()">Clear Selection</button>
    </div>

    <div class="toolbar">
        <select id="filter-type" onchange="filterAgents()">
            <option value="">All Types</option>
            <option value="code_review">Code Review</option>
            <option value="refactoring">Refactoring</option>
            <option value="testing">Testing</option>
            <option value="architecture">Architecture</option>
            <option value="debugging">Debugging</option>
            <option value="code_generation">Code Generation</option>
        </select>
        <select id="sort-by" onchange="sortAgents()">
            <option value="success_rate">Sort by Success Rate</option>
            <option value="tasks_completed">Sort by Tasks Completed</option>
            <option value="name">Sort by Name</option>
        </select>
    </div>

    <div class="agents-grid" id="agents-grid">
        ${agentCards}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let agents = ${JSON.stringify(agents)};
        let selectedAgentId = ${selectedId || 'null'};

        function selectAgent(id, name) {
            vscode.postMessage({ command: 'selectAgent', agentId: id, agentName: name });
        }

        function clearSelection() {
            vscode.postMessage({ command: 'clearSelection' });
        }

        function viewHistory(agentId) {
            const panel = document.getElementById('history-' + agentId);
            if (panel.style.display === 'none') {
                panel.style.display = 'block';
                panel.innerHTML = 'Loading...';
                vscode.postMessage({ command: 'viewHistory', agentId });
            } else {
                panel.style.display = 'none';
            }
        }

        function showFeedbackForm(agentId, name) {
            const panel = document.getElementById('feedback-' + agentId);
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }

        function submitFeedback(agentId) {
            const rating = parseInt(document.getElementById('rating-' + agentId).value);
            const helpful = document.getElementById('helpful-' + agentId).value === 'true';
            const comment = document.getElementById('comment-' + agentId).value;

            vscode.postMessage({
                command: 'submitFeedback',
                agentId,
                feedback: { rating, was_helpful: helpful, feedback_text: comment }
            });

            document.getElementById('feedback-' + agentId).style.display = 'none';
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function filterAgents() {
            const type = document.getElementById('filter-type').value;
            document.querySelectorAll('.agent-card').forEach(card => {
                if (!type || card.querySelector('.agent-type').textContent === type) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        }

        function sortAgents() {
            // Sorting would require re-rendering the grid
            vscode.postMessage({ command: 'refresh' });
        }

        function updateSelectedBanner(id, name) {
            const banner = document.getElementById('selected-banner');
            const nameSpan = document.getElementById('selected-name');
            if (id) {
                banner.style.display = 'flex';
                nameSpan.textContent = name || 'Agent #' + id;
            } else {
                banner.style.display = 'none';
            }
        }

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'agentSelected':
                    selectedAgentId = msg.agentId;
                    document.querySelectorAll('.agent-card').forEach(card => {
                        if (parseInt(card.dataset.id) === msg.agentId) {
                            card.classList.add('selected');
                            card.querySelector('.btn-primary').textContent = 'Selected';
                            updateSelectedBanner(msg.agentId, card.querySelector('.agent-name').textContent);
                        } else {
                            card.classList.remove('selected');
                            card.querySelector('.btn-primary').textContent = 'Use This Agent';
                        }
                    });
                    break;

                case 'selectionCleared':
                    selectedAgentId = null;
                    document.querySelectorAll('.agent-card').forEach(card => {
                        card.classList.remove('selected');
                        card.querySelector('.btn-primary').textContent = 'Use This Agent';
                    });
                    updateSelectedBanner(null);
                    break;

                case 'historyLoaded':
                    const panel = document.getElementById('history-' + msg.agentId);
                    if (msg.history.length === 0) {
                        panel.innerHTML = '<p>No execution history</p>';
                    } else {
                        panel.innerHTML = msg.history.map(h =>
                            '<div class="history-item ' + (h.success ? 'success' : 'failure') + '">' +
                            '<strong>' + (h.success ? 'Success' : 'Failed') + '</strong> - ' +
                            h.task_summary.substring(0, 50) + '...<br>' +
                            '<small>' + h.execution_time_ms + 'ms | ' + new Date(h.timestamp).toLocaleString() + '</small>' +
                            '</div>'
                        ).join('');
                    }
                    break;

                case 'agentsRefreshed':
                    agents = msg.agents;
                    location.reload();
                    break;
            }
        });
    </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
