import * as vscode from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';

const API_TIMEOUT = 30000;

const axiosConfig: AxiosRequestConfig = {
    timeout: API_TIMEOUT
};

// Types for chat persistence
export interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: {
        route?: string;
        agent?: string;
        tokens?: number;
        time_ms?: number;
    };
}

export interface ChatSession {
    id: string;
    name: string;
    projectId: string;
    messageCount: number;
    createdAt: string;
    lastUpdated: string;
}

// In-memory cache of current session messages
let currentSessionId: string | undefined;
let currentMessages: ChatMessage[] = [];
let messagesSinceLastSave = 0;
const AUTO_SAVE_THRESHOLD = 5;

/**
 * Initialize a new chat session
 */
export async function createChatSession(
    projectId: string,
    sessionName: string,
    backendUrl: string
): Promise<ChatSession | null> {
    try {
        const response = await axios.post<ChatSession>(`${backendUrl}/conversations`, {
            project_id: projectId,
            session_name: sessionName || `Chat ${new Date().toLocaleString()}`
        }, axiosConfig);

        currentSessionId = response.data.id;
        currentMessages = [];
        messagesSinceLastSave = 0;

        return response.data;
    } catch (error: any) {
        console.error('Failed to create chat session:', error.message);
        // Fallback: create local session
        const localSession: ChatSession = {
            id: `local_${Date.now()}`,
            name: sessionName || `Chat ${new Date().toLocaleString()}`,
            projectId,
            messageCount: 0,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        currentSessionId = localSession.id;
        currentMessages = [];
        return localSession;
    }
}

/**
 * List all chat sessions for a project
 */
export async function listChatSessions(
    projectId: string,
    backendUrl: string
): Promise<ChatSession[]> {
    try {
        const response = await axios.get<{ sessions: ChatSession[] }>(
            `${backendUrl}/conversations/${projectId}`,
            axiosConfig
        );
        return response.data.sessions || [];
    } catch (error: any) {
        console.error('Failed to list chat sessions:', error.message);
        return [];
    }
}

/**
 * Load a specific chat session
 */
export async function loadChatSession(
    sessionId: string,
    backendUrl: string
): Promise<ChatMessage[]> {
    try {
        const response = await axios.get<{ messages: ChatMessage[] }>(
            `${backendUrl}/conversations/${sessionId}/messages`,
            axiosConfig
        );

        currentSessionId = sessionId;
        currentMessages = response.data.messages || [];
        messagesSinceLastSave = 0;

        return currentMessages;
    } catch (error: any) {
        console.error('Failed to load chat session:', error.message);
        return [];
    }
}

/**
 * Add a message to the current session
 */
export async function addMessage(
    message: ChatMessage,
    backendUrl: string
): Promise<void> {
    // Add to local cache immediately
    currentMessages.push(message);
    messagesSinceLastSave++;

    // Auto-save if threshold reached
    if (messagesSinceLastSave >= AUTO_SAVE_THRESHOLD) {
        await saveCurrentSession(backendUrl);
    }

    // Also persist individual message to backend
    if (currentSessionId && !currentSessionId.startsWith('local_')) {
        try {
            await axios.post(
                `${backendUrl}/conversations/${currentSessionId}/messages`,
                {
                    role: message.role,
                    content: message.content,
                    metadata: message.metadata
                },
                axiosConfig
            );
        } catch (error: any) {
            console.error('Failed to persist message:', error.message);
        }
    }
}

/**
 * Save the current session to backend
 */
export async function saveCurrentSession(backendUrl: string): Promise<boolean> {
    if (!currentSessionId || currentMessages.length === 0) {
        return false;
    }

    // Skip for local sessions
    if (currentSessionId.startsWith('local_')) {
        messagesSinceLastSave = 0;
        return true;
    }

    try {
        // Messages are persisted individually, so just reset counter
        messagesSinceLastSave = 0;
        return true;
    } catch (error: any) {
        console.error('Failed to save session:', error.message);
        return false;
    }
}

/**
 * Delete a chat session
 */
export async function deleteChatSession(
    sessionId: string,
    backendUrl: string
): Promise<boolean> {
    try {
        await axios.delete(
            `${backendUrl}/conversations/${sessionId}`,
            axiosConfig
        );

        // Clear local state if deleting current session
        if (sessionId === currentSessionId) {
            currentSessionId = undefined;
            currentMessages = [];
            messagesSinceLastSave = 0;
        }

        return true;
    } catch (error: any) {
        console.error('Failed to delete chat session:', error.message);
        return false;
    }
}

/**
 * Get current session messages
 */
export function getCurrentMessages(): ChatMessage[] {
    return [...currentMessages];
}

/**
 * Get current session ID
 */
export function getCurrentSessionId(): string | undefined {
    return currentSessionId;
}

/**
 * Clear current session (without deleting from backend)
 */
export function clearCurrentSession(): void {
    currentSessionId = undefined;
    currentMessages = [];
    messagesSinceLastSave = 0;
}

/**
 * Show session picker dialog
 */
export async function showSessionPicker(
    projectId: string,
    backendUrl: string
): Promise<ChatSession | 'new' | undefined> {
    const sessions = await listChatSessions(projectId, backendUrl);

    const items: (vscode.QuickPickItem & { session?: ChatSession })[] = [
        {
            label: '$(add) New Chat Session',
            description: 'Start a fresh conversation',
            alwaysShow: true
        },
        ...sessions.map(session => ({
            label: session.name,
            description: `${session.messageCount} messages`,
            detail: `Last updated: ${new Date(session.lastUpdated).toLocaleString()}`,
            session
        }))
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a chat session or start a new one',
        title: 'Chat Sessions'
    });

    if (!selected) {
        return undefined;
    }

    if (selected.session) {
        return selected.session;
    }

    return 'new';
}

/**
 * Export chat session to markdown
 */
export function exportSessionToMarkdown(): string {
    if (currentMessages.length === 0) {
        return '# Empty Chat Session\n\nNo messages in this session.';
    }

    let markdown = `# Chat Session Export\n\n`;
    markdown += `**Session ID:** ${currentSessionId || 'Not saved'}\n`;
    markdown += `**Exported:** ${new Date().toLocaleString()}\n`;
    markdown += `**Messages:** ${currentMessages.length}\n\n`;
    markdown += '---\n\n';

    for (const message of currentMessages) {
        const role = message.role === 'user' ? 'User' : 'Assistant';
        const timestamp = new Date(message.timestamp).toLocaleString();

        markdown += `### ${role} (${timestamp})\n\n`;
        markdown += message.content + '\n\n';

        if (message.metadata) {
            const meta: string[] = [];
            if (message.metadata.route) meta.push(`Route: ${message.metadata.route}`);
            if (message.metadata.agent) meta.push(`Agent: ${message.metadata.agent}`);
            if (message.metadata.time_ms) meta.push(`Time: ${message.metadata.time_ms}ms`);
            if (meta.length > 0) {
                markdown += `*${meta.join(' | ')}*\n\n`;
            }
        }

        markdown += '---\n\n';
    }

    return markdown;
}

/**
 * Import messages from exported markdown (basic parsing)
 */
export function parseExportedMarkdown(markdown: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const blocks = markdown.split('---').filter(b => b.trim());

    for (const block of blocks) {
        const userMatch = block.match(/### User \(([^)]+)\)\n\n([\s\S]*?)(?=\n\n\*|$)/);
        const assistantMatch = block.match(/### Assistant \(([^)]+)\)\n\n([\s\S]*?)(?=\n\n\*|$)/);

        if (userMatch) {
            messages.push({
                role: 'user',
                content: userMatch[2].trim(),
                timestamp: new Date(userMatch[1]).toISOString()
            });
        } else if (assistantMatch) {
            messages.push({
                role: 'assistant',
                content: assistantMatch[2].trim(),
                timestamp: new Date(assistantMatch[1]).toISOString()
            });
        }
    }

    return messages;
}

/**
 * Search through chat history
 */
export async function searchChatHistory(
    query: string,
    projectId: string,
    backendUrl: string
): Promise<{ sessionId: string; sessionName: string; message: ChatMessage }[]> {
    const results: { sessionId: string; sessionName: string; message: ChatMessage }[] = [];
    const queryLower = query.toLowerCase();

    // First check current session
    for (const message of currentMessages) {
        if (message.content.toLowerCase().includes(queryLower)) {
            results.push({
                sessionId: currentSessionId || 'current',
                sessionName: 'Current Session',
                message
            });
        }
    }

    // Then search other sessions
    try {
        const sessions = await listChatSessions(projectId, backendUrl);

        for (const session of sessions) {
            if (session.id === currentSessionId) continue;

            const messages = await loadSessionMessages(session.id, backendUrl);
            for (const message of messages) {
                if (message.content.toLowerCase().includes(queryLower)) {
                    results.push({
                        sessionId: session.id,
                        sessionName: session.name,
                        message
                    });
                }
            }
        }
    } catch (error) {
        console.error('Search failed:', error);
    }

    return results;
}

/**
 * Load messages for a session without changing current session
 */
async function loadSessionMessages(
    sessionId: string,
    backendUrl: string
): Promise<ChatMessage[]> {
    try {
        const response = await axios.get<{ messages: ChatMessage[] }>(
            `${backendUrl}/conversations/${sessionId}/messages`,
            axiosConfig
        );
        return response.data.messages || [];
    } catch {
        return [];
    }
}

/**
 * Get session statistics
 */
export function getSessionStats(): {
    messageCount: number;
    userMessages: number;
    assistantMessages: number;
    totalTokens: number;
    avgResponseTime: number;
} {
    let userMessages = 0;
    let assistantMessages = 0;
    let totalTokens = 0;
    let totalTime = 0;
    let timeCount = 0;

    for (const message of currentMessages) {
        if (message.role === 'user') {
            userMessages++;
        } else if (message.role === 'assistant') {
            assistantMessages++;
            if (message.metadata?.tokens) {
                totalTokens += message.metadata.tokens;
            }
            if (message.metadata?.time_ms) {
                totalTime += message.metadata.time_ms;
                timeCount++;
            }
        }
    }

    return {
        messageCount: currentMessages.length,
        userMessages,
        assistantMessages,
        totalTokens,
        avgResponseTime: timeCount > 0 ? Math.round(totalTime / timeCount) : 0
    };
}
