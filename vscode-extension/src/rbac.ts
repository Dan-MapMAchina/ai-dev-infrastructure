/**
 * RBAC - Role-Based Access Control for enterprise features
 * Phase 4: Permission management and feature gating
 */

import * as vscode from 'vscode';
import axios from 'axios';

// ============================================================================
// Interfaces
// ============================================================================

export interface UserPermissions {
    user_id: string;
    user_email?: string;
    role: 'admin' | 'developer' | 'viewer' | 'custom';
    allowed_agents: string[];
    allowed_features: Feature[];
    daily_token_limit: number;
    tokens_used_today: number;
    can_create_rules: boolean;
    can_execute_tools: boolean;
    can_view_audit_log: boolean;
    can_manage_users: boolean;
    is_admin: boolean;
    custom_permissions?: Record<string, boolean>;
}

export type Feature =
    | 'chat'
    | 'code_review'
    | 'code_generation'
    | 'refactoring'
    | 'testing'
    | 'devops'
    | 'multi_file_generation'
    | 'tool_execution'
    | 'custom_rules'
    | 'compliance_dashboard'
    | 'audit_log'
    | 'user_management';

export interface PermissionCheck {
    allowed: boolean;
    reason?: string;
    suggestion?: string;
}

export interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    created_at: string;
    last_active?: string;
    permissions: UserPermissions;
}

export interface TokenUsage {
    used: number;
    limit: number;
    remaining: number;
    reset_at: string;
}

// ============================================================================
// Role Definitions
// ============================================================================

const ROLE_PERMISSIONS: Record<string, Partial<UserPermissions>> = {
    admin: {
        role: 'admin',
        allowed_agents: ['*'],
        allowed_features: [
            'chat', 'code_review', 'code_generation', 'refactoring', 'testing',
            'devops', 'multi_file_generation', 'tool_execution', 'custom_rules',
            'compliance_dashboard', 'audit_log', 'user_management'
        ],
        daily_token_limit: -1, // unlimited
        can_create_rules: true,
        can_execute_tools: true,
        can_view_audit_log: true,
        can_manage_users: true,
        is_admin: true
    },
    developer: {
        role: 'developer',
        allowed_agents: ['*'],
        allowed_features: [
            'chat', 'code_review', 'code_generation', 'refactoring', 'testing',
            'devops', 'multi_file_generation', 'tool_execution'
        ],
        daily_token_limit: 1000000,
        can_create_rules: false,
        can_execute_tools: true,
        can_view_audit_log: false,
        can_manage_users: false,
        is_admin: false
    },
    viewer: {
        role: 'viewer',
        allowed_agents: [],
        allowed_features: ['chat', 'code_review'],
        daily_token_limit: 100000,
        can_create_rules: false,
        can_execute_tools: false,
        can_view_audit_log: false,
        can_manage_users: false,
        is_admin: false
    }
};

// ============================================================================
// Permission Cache
// ============================================================================

let cachedPermissions: UserPermissions | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Permission Functions
// ============================================================================

/**
 * Get current user's permissions
 */
export async function getCurrentUserPermissions(backendUrl: string, forceRefresh: boolean = false): Promise<UserPermissions> {
    // Check cache
    if (!forceRefresh && cachedPermissions && Date.now() < cacheExpiry) {
        return cachedPermissions;
    }

    try {
        const response = await axios.get(`${backendUrl}/users/me/permissions`);
        cachedPermissions = response.data;
        cacheExpiry = Date.now() + CACHE_TTL;
        return cachedPermissions!;
    } catch (error) {
        // Return default developer permissions if backend unavailable
        return getDefaultPermissions();
    }
}

/**
 * Get default permissions (used when backend is unavailable)
 */
function getDefaultPermissions(): UserPermissions {
    return {
        user_id: 'local-user',
        role: 'developer',
        allowed_agents: ['*'],
        allowed_features: [
            'chat', 'code_review', 'code_generation', 'refactoring', 'testing',
            'devops', 'multi_file_generation', 'tool_execution'
        ],
        daily_token_limit: 1000000,
        tokens_used_today: 0,
        can_create_rules: true, // Allow in lite mode
        can_execute_tools: true,
        can_view_audit_log: true, // Allow in lite mode
        can_manage_users: false,
        is_admin: false
    };
}

/**
 * Check if user has permission for a specific feature
 */
export async function checkPermission(feature: Feature, backendUrl: string): Promise<PermissionCheck> {
    const permissions = await getCurrentUserPermissions(backendUrl);

    // Admin has all permissions
    if (permissions.is_admin) {
        return { allowed: true };
    }

    // Check feature allowlist
    if (!permissions.allowed_features.includes(feature)) {
        return {
            allowed: false,
            reason: `You don't have permission to use "${feature}"`,
            suggestion: 'Contact your administrator to request access'
        };
    }

    return { allowed: true };
}

/**
 * Check if user can use a specific agent
 */
export async function checkAgentPermission(agentType: string, backendUrl: string): Promise<PermissionCheck> {
    const permissions = await getCurrentUserPermissions(backendUrl);

    // Wildcard allows all agents
    if (permissions.allowed_agents.includes('*')) {
        return { allowed: true };
    }

    if (!permissions.allowed_agents.includes(agentType)) {
        return {
            allowed: false,
            reason: `You don't have permission to use agent type "${agentType}"`,
            suggestion: 'Contact your administrator to request access'
        };
    }

    return { allowed: true };
}

/**
 * Check if user has remaining token budget
 */
export async function checkTokenBudget(estimatedTokens: number, backendUrl: string): Promise<PermissionCheck> {
    const permissions = await getCurrentUserPermissions(backendUrl);

    // Unlimited budget
    if (permissions.daily_token_limit === -1) {
        return { allowed: true };
    }

    const remaining = permissions.daily_token_limit - permissions.tokens_used_today;

    if (estimatedTokens > remaining) {
        return {
            allowed: false,
            reason: `Token budget exceeded. Used: ${permissions.tokens_used_today}/${permissions.daily_token_limit}`,
            suggestion: `Wait until tomorrow or contact administrator to increase your limit`
        };
    }

    return { allowed: true };
}

/**
 * Update token usage after a request
 */
export async function updateTokenUsage(tokensUsed: number, backendUrl: string): Promise<void> {
    if (cachedPermissions) {
        cachedPermissions.tokens_used_today += tokensUsed;
    }

    try {
        await axios.post(`${backendUrl}/users/me/token-usage`, {
            tokens_used: tokensUsed
        });
    } catch {
        // Silently fail - local cache is updated anyway
    }
}

/**
 * Get token usage summary
 */
export async function getTokenUsage(backendUrl: string): Promise<TokenUsage> {
    const permissions = await getCurrentUserPermissions(backendUrl);

    const limit = permissions.daily_token_limit === -1 ? Infinity : permissions.daily_token_limit;
    const used = permissions.tokens_used_today;
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);

    // Calculate reset time (midnight UTC)
    const now = new Date();
    const resetAt = new Date(now);
    resetAt.setUTCHours(24, 0, 0, 0);

    return {
        used,
        limit,
        remaining,
        reset_at: resetAt.toISOString()
    };
}

// ============================================================================
// Permission Enforcement Decorator
// ============================================================================

/**
 * Higher-order function to wrap commands with permission checks
 */
export function withPermission(feature: Feature, backendUrl: string) {
    return function <T extends (...args: any[]) => Promise<any>>(fn: T): T {
        return (async (...args: any[]) => {
            const check = await checkPermission(feature, backendUrl);

            if (!check.allowed) {
                vscode.window.showErrorMessage(
                    check.reason || 'Permission denied',
                    'Learn More'
                ).then(action => {
                    if (action === 'Learn More' && check.suggestion) {
                        vscode.window.showInformationMessage(check.suggestion);
                    }
                });
                return;
            }

            return fn(...args);
        }) as T;
    };
}

/**
 * Check permission and show error if denied
 */
export async function requirePermission(feature: Feature, backendUrl: string): Promise<boolean> {
    const check = await checkPermission(feature, backendUrl);

    if (!check.allowed) {
        vscode.window.showErrorMessage(
            check.reason || 'Permission denied',
            'Contact Admin'
        );
        return false;
    }

    return true;
}

// ============================================================================
// Admin Functions
// ============================================================================

/**
 * List all users (admin only)
 */
export async function listUsers(backendUrl: string): Promise<User[]> {
    const permissions = await getCurrentUserPermissions(backendUrl);

    if (!permissions.can_manage_users) {
        throw new Error('Permission denied: cannot manage users');
    }

    try {
        const response = await axios.get(`${backendUrl}/users`);
        return response.data.users || [];
    } catch (error: any) {
        throw new Error(error.response?.data?.error || 'Failed to list users');
    }
}

/**
 * Update user permissions (admin only)
 */
export async function updateUserPermissions(
    userId: string,
    updates: Partial<UserPermissions>,
    backendUrl: string
): Promise<UserPermissions> {
    const permissions = await getCurrentUserPermissions(backendUrl);

    if (!permissions.can_manage_users) {
        throw new Error('Permission denied: cannot manage users');
    }

    try {
        const response = await axios.put(`${backendUrl}/users/${userId}/permissions`, updates);
        return response.data;
    } catch (error: any) {
        throw new Error(error.response?.data?.error || 'Failed to update permissions');
    }
}

/**
 * Apply a predefined role to a user
 */
export async function applyRole(
    userId: string,
    role: 'admin' | 'developer' | 'viewer',
    backendUrl: string
): Promise<UserPermissions> {
    const rolePermissions = ROLE_PERMISSIONS[role];
    return updateUserPermissions(userId, rolePermissions, backendUrl);
}

// ============================================================================
// UI Functions
// ============================================================================

/**
 * Show permission status in status bar
 */
let statusBarItem: vscode.StatusBarItem | undefined;

export function initializeStatusBar(context: vscode.ExtensionContext, backendUrl: string): void {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'claudeAiDev.showPermissionStatus';
    context.subscriptions.push(statusBarItem);

    updateStatusBar(backendUrl);

    // Update every minute
    const interval = setInterval(() => updateStatusBar(backendUrl), 60000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

async function updateStatusBar(backendUrl: string): Promise<void> {
    if (!statusBarItem) return;

    try {
        const usage = await getTokenUsage(backendUrl);
        const percentage = usage.limit === Infinity
            ? 0
            : Math.round((usage.used / usage.limit) * 100);

        if (usage.limit === Infinity) {
            statusBarItem.text = `$(key) Unlimited`;
            statusBarItem.tooltip = 'Unlimited token budget';
        } else {
            statusBarItem.text = `$(key) ${percentage}%`;
            statusBarItem.tooltip = `Token usage: ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()}`;

            if (percentage >= 90) {
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (percentage >= 75) {
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                statusBarItem.backgroundColor = undefined;
            }
        }

        statusBarItem.show();
    } catch {
        statusBarItem.hide();
    }
}

/**
 * Show permission status dialog
 */
export async function showPermissionStatus(backendUrl: string): Promise<void> {
    const permissions = await getCurrentUserPermissions(backendUrl);
    const usage = await getTokenUsage(backendUrl);

    const items: vscode.QuickPickItem[] = [
        {
            label: '$(person) Role',
            description: permissions.role.toUpperCase(),
            detail: permissions.is_admin ? 'Administrator access' : 'Standard user'
        },
        {
            label: '$(dashboard) Token Usage',
            description: usage.limit === Infinity
                ? `${usage.used.toLocaleString()} used (unlimited)`
                : `${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()}`,
            detail: `Resets at ${new Date(usage.reset_at).toLocaleTimeString()}`
        },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        {
            label: '$(list-unordered) Allowed Features',
            description: `${permissions.allowed_features.length} features`,
            detail: permissions.allowed_features.join(', ')
        },
        {
            label: '$(robot) Allowed Agents',
            description: permissions.allowed_agents.includes('*')
                ? 'All agents'
                : `${permissions.allowed_agents.length} agents`,
            detail: permissions.allowed_agents.join(', ')
        },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        {
            label: permissions.can_create_rules ? '$(check) Can Create Rules' : '$(x) Cannot Create Rules',
            description: permissions.can_create_rules ? 'Enabled' : 'Disabled'
        },
        {
            label: permissions.can_execute_tools ? '$(check) Can Execute Tools' : '$(x) Cannot Execute Tools',
            description: permissions.can_execute_tools ? 'Enabled' : 'Disabled'
        },
        {
            label: permissions.can_view_audit_log ? '$(check) Can View Audit Log' : '$(x) Cannot View Audit Log',
            description: permissions.can_view_audit_log ? 'Enabled' : 'Disabled'
        }
    ];

    await vscode.window.showQuickPick(items, {
        title: 'Your Permissions',
        placeHolder: 'View your current permissions and usage'
    });
}

/**
 * Show user management panel (admin only)
 */
export async function showUserManagement(backendUrl: string): Promise<void> {
    const permissions = await getCurrentUserPermissions(backendUrl);

    if (!permissions.can_manage_users) {
        vscode.window.showErrorMessage('You do not have permission to manage users');
        return;
    }

    try {
        const users = await listUsers(backendUrl);

        const items = users.map(user => ({
            label: user.name || user.email,
            description: user.role,
            detail: `Last active: ${user.last_active ? new Date(user.last_active).toLocaleDateString() : 'Never'}`,
            user
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a user to manage',
            matchOnDescription: true
        });

        if (!selected) return;

        const actions = [
            { label: 'Set as Admin', role: 'admin' },
            { label: 'Set as Developer', role: 'developer' },
            { label: 'Set as Viewer', role: 'viewer' },
            { label: 'Custom Permissions...', role: 'custom' }
        ];

        const action = await vscode.window.showQuickPick(actions, {
            placeHolder: `Select new role for ${selected.label}`
        });

        if (!action) return;

        if (action.role === 'custom') {
            // Show custom permission editor
            vscode.window.showInformationMessage('Custom permissions editor coming soon');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Updating ${selected.label}'s permissions...`
        }, async () => {
            await applyRole(selected.user.id, action.role as 'admin' | 'developer' | 'viewer', backendUrl);
        });

        vscode.window.showInformationMessage(`${selected.label} is now a ${action.role}`);

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to manage users: ${error.message}`);
    }
}

// ============================================================================
// Clear Cache
// ============================================================================

export function clearPermissionCache(): void {
    cachedPermissions = null;
    cacheExpiry = 0;
}
