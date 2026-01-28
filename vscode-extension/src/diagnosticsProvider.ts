import * as vscode from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';

const API_TIMEOUT = 120000; // 2 minutes for code review

const axiosConfig: AxiosRequestConfig = {
    timeout: API_TIMEOUT
};

// Types for structured code review
export interface ReviewIssue {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    code: string;           // Issue code e.g., 'SEC001', 'PERF002'
    category: 'security' | 'performance' | 'quality' | 'bug' | 'style';
    suggestion?: string;    // Auto-fix suggestion
    fixCode?: string;       // Code to replace with
}

export interface StructuredReviewResult {
    issues: ReviewIssue[];
    summary: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
    agent: string;
    metrics: {
        tokens: number;
        time_ms: number;
    };
}

// Diagnostic collection for code review
let reviewDiagnostics: vscode.DiagnosticCollection;

// Store issues for code actions
const issuesByUri: Map<string, ReviewIssue[]> = new Map();

/**
 * Initialize the diagnostics collection
 */
export function initializeDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
    reviewDiagnostics = vscode.languages.createDiagnosticCollection('ai-code-review');
    context.subscriptions.push(reviewDiagnostics);
    return reviewDiagnostics;
}

/**
 * Get the diagnostics collection
 */
export function getDiagnosticsCollection(): vscode.DiagnosticCollection {
    return reviewDiagnostics;
}

/**
 * Get stored issues for a document URI
 */
export function getIssuesForUri(uri: string): ReviewIssue[] {
    return issuesByUri.get(uri) || [];
}

/**
 * Map severity string to VS Code DiagnosticSeverity
 */
function mapSeverity(severity: ReviewIssue['severity']): vscode.DiagnosticSeverity {
    switch (severity) {
        case 'error':
            return vscode.DiagnosticSeverity.Error;
        case 'warning':
            return vscode.DiagnosticSeverity.Warning;
        case 'info':
            return vscode.DiagnosticSeverity.Information;
        case 'hint':
            return vscode.DiagnosticSeverity.Hint;
        default:
            return vscode.DiagnosticSeverity.Warning;
    }
}

/**
 * Create a VS Code Diagnostic from a ReviewIssue
 */
function createDiagnostic(issue: ReviewIssue, document: vscode.TextDocument): vscode.Diagnostic {
    // Ensure line numbers are within bounds
    const startLine = Math.max(0, Math.min(issue.line - 1, document.lineCount - 1));
    const endLine = Math.max(0, Math.min(issue.endLine - 1, document.lineCount - 1));

    // Get line lengths to ensure columns are within bounds
    const startLineLength = document.lineAt(startLine).text.length;
    const endLineLength = document.lineAt(endLine).text.length;

    const startColumn = Math.max(0, Math.min(issue.column, startLineLength));
    const endColumn = Math.max(0, Math.min(issue.endColumn, endLineLength));

    const range = new vscode.Range(
        startLine, startColumn,
        endLine, endColumn
    );

    const diagnostic = new vscode.Diagnostic(
        range,
        issue.message,
        mapSeverity(issue.severity)
    );

    diagnostic.code = issue.code;
    diagnostic.source = 'AI Code Review';

    // Add related information if there's a suggestion
    if (issue.suggestion) {
        diagnostic.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                `Suggestion: ${issue.suggestion}`
            )
        ];
    }

    return diagnostic;
}

/**
 * Set diagnostics for a document from review issues
 */
export function setDiagnosticsFromIssues(
    document: vscode.TextDocument,
    issues: ReviewIssue[]
): void {
    if (!reviewDiagnostics) {
        console.error('Diagnostics collection not initialized');
        return;
    }

    // Store issues for code actions
    issuesByUri.set(document.uri.toString(), issues);

    // Create diagnostics
    const diagnostics: vscode.Diagnostic[] = issues.map(issue =>
        createDiagnostic(issue, document)
    );

    reviewDiagnostics.set(document.uri, diagnostics);
}

/**
 * Clear diagnostics for a document
 */
export function clearDiagnostics(document?: vscode.TextDocument): void {
    if (!reviewDiagnostics) {
        return;
    }

    if (document) {
        reviewDiagnostics.delete(document.uri);
        issuesByUri.delete(document.uri.toString());
    } else {
        reviewDiagnostics.clear();
        issuesByUri.clear();
    }
}

/**
 * Clear all diagnostics
 */
export function clearAllDiagnostics(): void {
    if (reviewDiagnostics) {
        reviewDiagnostics.clear();
        issuesByUri.clear();
    }
}

/**
 * Perform structured code review and display diagnostics
 */
export async function reviewWithDiagnostics(
    backendUrl: string,
    reviewType: 'security' | 'performance' | 'quality' | 'all' = 'all'
): Promise<StructuredReviewResult | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return null;
    }

    const document = editor.document;
    const selection = editor.selection;

    // Get code to review - selection or entire file
    const code = selection.isEmpty
        ? document.getText()
        : document.getText(selection);

    if (!code.trim()) {
        vscode.window.showErrorMessage('No code to review');
        return null;
    }

    const languageId = document.languageId;
    const filePath = document.fileName;

    return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running AI Code Review...',
        cancellable: true
    }, async (progress, token) => {
        try {
            progress.report({ message: 'Analyzing code...' });

            const response = await axios.post<StructuredReviewResult>(
                `${backendUrl}/review-code-structured`,
                {
                    code,
                    language: languageId,
                    file_path: filePath,
                    review_type: reviewType,
                    line_offset: selection.isEmpty ? 0 : selection.start.line
                },
                axiosConfig
            );

            if (token.isCancellationRequested) {
                return null;
            }

            const result = response.data;

            // Adjust line numbers if reviewing a selection
            if (!selection.isEmpty) {
                result.issues = result.issues.map(issue => ({
                    ...issue,
                    line: issue.line + selection.start.line,
                    endLine: issue.endLine + selection.start.line
                }));
            }

            progress.report({ message: 'Displaying results...' });

            // Set diagnostics
            setDiagnosticsFromIssues(document, result.issues);

            // Show summary
            const totalIssues = result.issues.length;
            const { critical, high, medium, low } = result.summary;

            vscode.window.showInformationMessage(
                `Code review complete: ${totalIssues} issues found ` +
                `(${critical} critical, ${high} high, ${medium} medium, ${low} low)`,
                'View Problems'
            ).then(selection => {
                if (selection === 'View Problems') {
                    vscode.commands.executeCommand('workbench.actions.view.problems');
                }
            });

            return result;

        } catch (error: any) {
            if (!token.isCancellationRequested) {
                vscode.window.showErrorMessage(`Code review failed: ${error.message}`);
            }
            return null;
        }
    });
}

/**
 * Review entire project with diagnostics
 */
export async function reviewProjectWithDiagnostics(
    backendUrl: string
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    // Clear existing diagnostics
    clearAllDiagnostics();

    vscode.window.showInformationMessage(
        'Project-wide diagnostic review is not yet implemented. ' +
        'Use "Review Entire Project" for a summary report, or ' +
        'open individual files and use "Review with Annotations".'
    );
}

/**
 * Get issue statistics for the current workspace
 */
export function getIssueStatistics(): {
    totalFiles: number;
    totalIssues: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
} {
    const stats = {
        totalFiles: issuesByUri.size,
        totalIssues: 0,
        bySeverity: { error: 0, warning: 0, info: 0, hint: 0 },
        byCategory: { security: 0, performance: 0, quality: 0, bug: 0, style: 0 }
    };

    for (const issues of issuesByUri.values()) {
        stats.totalIssues += issues.length;
        for (const issue of issues) {
            stats.bySeverity[issue.severity] = (stats.bySeverity[issue.severity] || 0) + 1;
            stats.byCategory[issue.category] = (stats.byCategory[issue.category] || 0) + 1;
        }
    }

    return stats;
}
