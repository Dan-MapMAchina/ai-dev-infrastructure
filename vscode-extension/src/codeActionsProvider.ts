import * as vscode from 'vscode';
import { ReviewIssue, getIssuesForUri, clearDiagnostics, getDiagnosticsCollection } from './diagnosticsProvider';

/**
 * Code Action Provider for AI Code Review quick fixes
 */
export class ReviewCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        const actions: vscode.CodeAction[] = [];

        // Get issues for this document
        const issues = getIssuesForUri(document.uri.toString());

        // Filter diagnostics from AI Code Review
        const reviewDiagnostics = context.diagnostics.filter(
            d => d.source === 'AI Code Review'
        );

        for (const diagnostic of reviewDiagnostics) {
            // Find the corresponding issue
            const issue = issues.find(i =>
                i.code === diagnostic.code &&
                i.line - 1 === diagnostic.range.start.line
            );

            if (issue) {
                // Create Quick Fix if there's a fix available
                if (issue.fixCode) {
                    const fixAction = this.createFixAction(document, diagnostic, issue);
                    actions.push(fixAction);
                }

                // Create "Explain Issue" action
                const explainAction = this.createExplainAction(diagnostic, issue);
                actions.push(explainAction);

                // Create "Ignore Issue" action
                const ignoreAction = this.createIgnoreAction(document, diagnostic, issue);
                actions.push(ignoreAction);
            }
        }

        // Add "Fix All" action if there are multiple fixable issues
        const fixableIssues = issues.filter(i => i.fixCode);
        if (fixableIssues.length > 1) {
            const fixAllAction = this.createFixAllAction(document, fixableIssues);
            actions.push(fixAllAction);
        }

        return actions;
    }

    /**
     * Create a Quick Fix action to apply the suggested fix
     */
    private createFixAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        issue: ReviewIssue
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `Fix: ${issue.suggestion || issue.message}`,
            vscode.CodeActionKind.QuickFix
        );

        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        // Create the edit
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, diagnostic.range, issue.fixCode!);
        action.edit = edit;

        return action;
    }

    /**
     * Create an action to explain the issue in detail
     */
    private createExplainAction(
        diagnostic: vscode.Diagnostic,
        issue: ReviewIssue
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `Explain: ${issue.code}`,
            vscode.CodeActionKind.QuickFix
        );

        action.diagnostics = [diagnostic];

        // Use a command to show explanation
        action.command = {
            command: 'claudeAiDev.explainIssue',
            title: 'Explain Issue',
            arguments: [issue]
        };

        return action;
    }

    /**
     * Create an action to ignore/suppress the issue
     */
    private createIgnoreAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        issue: ReviewIssue
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `Ignore: ${issue.code}`,
            vscode.CodeActionKind.QuickFix
        );

        action.diagnostics = [diagnostic];

        // Add a comment to suppress the issue
        const edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.start.line);
        const suppressComment = getSuppressionComment(document.languageId, issue.code);

        edit.insert(
            document.uri,
            new vscode.Position(line.lineNumber, 0),
            suppressComment + '\n'
        );
        action.edit = edit;

        return action;
    }

    /**
     * Create an action to fix all issues in the document
     */
    private createFixAllAction(
        document: vscode.TextDocument,
        issues: ReviewIssue[]
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `Fix all ${issues.length} issues`,
            vscode.CodeActionKind.QuickFix
        );

        action.command = {
            command: 'claudeAiDev.applyAllFixes',
            title: 'Apply All Fixes',
            arguments: [document.uri]
        };

        return action;
    }
}

/**
 * Get the appropriate suppression comment for a language
 */
function getSuppressionComment(languageId: string, code: string): string {
    const suppressText = `ai-review-ignore: ${code}`;

    switch (languageId) {
        case 'python':
            return `# ${suppressText}`;
        case 'javascript':
        case 'typescript':
        case 'javascriptreact':
        case 'typescriptreact':
        case 'java':
        case 'c':
        case 'cpp':
        case 'csharp':
        case 'go':
        case 'rust':
        case 'swift':
        case 'kotlin':
            return `// ${suppressText}`;
        case 'html':
        case 'xml':
            return `<!-- ${suppressText} -->`;
        case 'css':
        case 'scss':
        case 'less':
            return `/* ${suppressText} */`;
        case 'ruby':
        case 'perl':
        case 'shellscript':
        case 'yaml':
            return `# ${suppressText}`;
        case 'sql':
            return `-- ${suppressText}`;
        default:
            return `// ${suppressText}`;
    }
}

/**
 * Apply all fixes for a document
 */
export async function applyAllFixes(uri: vscode.Uri): Promise<void> {
    const issues = getIssuesForUri(uri.toString());
    const fixableIssues = issues.filter(i => i.fixCode);

    if (fixableIssues.length === 0) {
        vscode.window.showInformationMessage('No auto-fixable issues found');
        return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();

    // Sort issues by line number in reverse order to avoid offset issues
    const sortedIssues = [...fixableIssues].sort((a, b) => b.line - a.line);

    for (const issue of sortedIssues) {
        const startLine = Math.max(0, issue.line - 1);
        const endLine = Math.max(0, issue.endLine - 1);
        const startCol = issue.column;
        const endCol = issue.endColumn;

        const range = new vscode.Range(startLine, startCol, endLine, endCol);
        edit.replace(uri, range, issue.fixCode!);
    }

    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
        // Clear diagnostics for fixed issues
        clearDiagnostics(document);
        vscode.window.showInformationMessage(`Applied ${fixableIssues.length} fixes`);
    } else {
        vscode.window.showErrorMessage('Failed to apply some fixes');
    }
}

/**
 * Show explanation for an issue
 */
export async function explainIssue(issue: ReviewIssue): Promise<void> {
    const content = `# Issue: ${issue.code}

## Category
${issue.category.charAt(0).toUpperCase() + issue.category.slice(1)}

## Severity
${issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)}

## Description
${issue.message}

## Location
Line ${issue.line}, Column ${issue.column}

${issue.suggestion ? `## Suggested Fix\n${issue.suggestion}` : ''}

${issue.fixCode ? `## Fix Code\n\`\`\`\n${issue.fixCode}\n\`\`\`` : ''}

---

### Why This Matters

${getCategoryExplanation(issue.category)}
`;

    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

/**
 * Get explanation text for issue category
 */
function getCategoryExplanation(category: ReviewIssue['category']): string {
    switch (category) {
        case 'security':
            return 'Security issues can lead to vulnerabilities that attackers may exploit. ' +
                'These should be addressed with high priority to protect your application and users.';
        case 'performance':
            return 'Performance issues can cause slow response times, high resource usage, ' +
                'and poor user experience. Addressing these can improve application efficiency.';
        case 'quality':
            return 'Code quality issues affect maintainability and readability. ' +
                'Fixing these makes the codebase easier to understand and modify.';
        case 'bug':
            return 'Potential bugs can cause unexpected behavior or crashes. ' +
                'These should be investigated and fixed to ensure correct functionality.';
        case 'style':
            return 'Style issues relate to code formatting and conventions. ' +
                'Consistent style improves readability and team collaboration.';
        default:
            return 'This issue may affect code quality, performance, or security.';
    }
}

/**
 * Register the code action provider
 */
export function registerCodeActionProvider(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = vscode.languages.registerCodeActionsProvider(
        { scheme: 'file' }, // All file types
        new ReviewCodeActionProvider(),
        {
            providedCodeActionKinds: ReviewCodeActionProvider.providedCodeActionKinds
        }
    );

    context.subscriptions.push(provider);
    return provider;
}
