import * as vscode from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';

const API_TIMEOUT = 60000;

const axiosConfig: AxiosRequestConfig = {
    timeout: API_TIMEOUT
};

// Types for code generation
export interface GeneratedCode {
    code: string;
    explanation: string;
    language: string;
    insertionPoint?: {
        line: number;
        column: number;
    };
}

export interface CodeGenerationRequest {
    prompt: string;
    language: string;
    context?: {
        filePath: string;
        surroundingCode: string;
        cursorPosition: vscode.Position;
    };
    projectId: string;
}

export interface CodeGenerationResponse {
    code: string;
    explanation: string;
    language: string;
    agent: string;
    metrics: {
        tokens: number;
        time_ms: number;
    };
}

// State for pending code suggestions
let pendingSuggestion: {
    code: string;
    editor: vscode.TextEditor;
    position: vscode.Position;
    decorationType: vscode.TextEditorDecorationType;
} | undefined;

/**
 * Generate code based on a prompt and insert at cursor position
 */
export async function generateCodeAtCursor(backendUrl: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const prompt = await vscode.window.showInputBox({
        prompt: 'Describe the code you want to generate',
        placeHolder: 'e.g., "Create a function that validates email addresses"'
    });

    if (!prompt) {
        return;
    }

    const position = editor.selection.active;
    const languageId = editor.document.languageId;
    const filePath = editor.document.fileName;

    // Get surrounding context (20 lines before and after cursor)
    const startLine = Math.max(0, position.line - 20);
    const endLine = Math.min(editor.document.lineCount - 1, position.line + 20);
    const surroundingCode = editor.document.getText(
        new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length)
    );

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating code...',
        cancellable: true
    }, async (progress, token) => {
        try {
            progress.report({ message: 'Sending request to AI...' });

            const response = await axios.post<CodeGenerationResponse>(`${backendUrl}/generate-code`, {
                prompt,
                language: languageId,
                context: {
                    file_path: filePath,
                    surrounding_code: surroundingCode,
                    cursor_line: position.line,
                    cursor_column: position.character
                },
                project_id: getProjectId()
            }, axiosConfig);

            if (token.isCancellationRequested) {
                return;
            }

            progress.report({ message: 'Preparing code preview...' });

            // Show the generated code as a preview
            await showCodePreview(response.data.code, editor, position, response.data);

        } catch (error: any) {
            if (!token.isCancellationRequested) {
                vscode.window.showErrorMessage(`Code generation failed: ${error.message}`);
            }
        }
    });
}

/**
 * Show generated code as a preview with accept/reject options
 */
export async function showCodePreview(
    code: string,
    editor: vscode.TextEditor,
    position: vscode.Position,
    metadata?: Partial<CodeGenerationResponse>
): Promise<void> {
    // Clear any existing preview
    clearPendingSuggestion();

    // Create decoration for preview
    const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: '',
            margin: '0 0 0 0'
        },
        backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
        isWholeLine: false
    });

    // Store the pending suggestion
    pendingSuggestion = {
        code,
        editor,
        position,
        decorationType
    };

    // Show the code in a diff-like preview
    const previewContent = buildPreviewContent(code, metadata);

    // Open preview in a new document beside the editor
    const doc = await vscode.workspace.openTextDocument({
        content: previewContent,
        language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        preserveFocus: true
    });

    // Show accept/reject buttons
    const action = await vscode.window.showInformationMessage(
        'Code generated. Insert at cursor?',
        'Insert',
        'Insert & Replace Selection',
        'Copy to Clipboard',
        'Discard'
    );

    if (action === 'Insert') {
        await insertCodeAtPosition(code, editor, position);
        vscode.window.showInformationMessage('Code inserted successfully');
    } else if (action === 'Insert & Replace Selection') {
        await replaceSelection(code, editor);
        vscode.window.showInformationMessage('Selection replaced successfully');
    } else if (action === 'Copy to Clipboard') {
        await vscode.env.clipboard.writeText(code);
        vscode.window.showInformationMessage('Code copied to clipboard');
    }

    clearPendingSuggestion();
}

/**
 * Build preview content with metadata
 */
function buildPreviewContent(code: string, metadata?: Partial<CodeGenerationResponse>): string {
    let content = '# Generated Code Preview\n\n';

    if (metadata) {
        if (metadata.agent) {
            content += `**Agent:** ${metadata.agent}\n`;
        }
        if (metadata.language) {
            content += `**Language:** ${metadata.language}\n`;
        }
        if (metadata.metrics) {
            content += `**Time:** ${metadata.metrics.time_ms}ms | **Tokens:** ${metadata.metrics.tokens}\n`;
        }
        content += '\n---\n\n';
    }

    content += '## Code\n\n```' + (metadata?.language || '') + '\n' + code + '\n```\n\n';

    if (metadata?.explanation) {
        content += '## Explanation\n\n' + metadata.explanation + '\n';
    }

    return content;
}

/**
 * Insert code at a specific position in the editor
 */
export async function insertCodeAtPosition(
    code: string,
    editor: vscode.TextEditor,
    position: vscode.Position
): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();

    // Ensure proper indentation based on current line
    const currentLine = editor.document.lineAt(position.line);
    const currentIndent = currentLine.text.match(/^(\s*)/)?.[1] || '';

    // Apply indentation to the code
    const indentedCode = code.split('\n').map((line, index) => {
        // Don't indent the first line if inserting at cursor position
        if (index === 0 && position.character > 0) {
            return line;
        }
        // Preserve existing indentation in the code, add base indentation
        return line.trim() ? currentIndent + line : line;
    }).join('\n');

    edit.insert(editor.document.uri, position, indentedCode);

    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
        // Move cursor to end of inserted code
        const insertedLines = indentedCode.split('\n');
        const lastLineIndex = position.line + insertedLines.length - 1;
        const lastLineLength = insertedLines[insertedLines.length - 1].length;
        const newPosition = new vscode.Position(lastLineIndex, lastLineLength);
        editor.selection = new vscode.Selection(newPosition, newPosition);
    }

    return success;
}

/**
 * Replace the current selection with generated code
 */
export async function replaceSelection(
    code: string,
    editor: vscode.TextEditor
): Promise<boolean> {
    const selection = editor.selection;

    if (selection.isEmpty) {
        // If no selection, insert at cursor
        return insertCodeAtPosition(code, editor, selection.active);
    }

    const edit = new vscode.WorkspaceEdit();

    // Get the indentation of the first line of selection
    const firstLine = editor.document.lineAt(selection.start.line);
    const baseIndent = firstLine.text.match(/^(\s*)/)?.[1] || '';

    // Apply indentation
    const indentedCode = code.split('\n').map((line, index) => {
        if (index === 0) {
            return line; // First line takes selection's position
        }
        return line.trim() ? baseIndent + line : line;
    }).join('\n');

    edit.replace(editor.document.uri, selection, indentedCode);

    return vscode.workspace.applyEdit(edit);
}

/**
 * Accept the pending code suggestion
 */
export async function acceptSuggestion(): Promise<void> {
    if (!pendingSuggestion) {
        vscode.window.showWarningMessage('No pending code suggestion');
        return;
    }

    const { code, editor, position } = pendingSuggestion;
    const success = await insertCodeAtPosition(code, editor, position);

    if (success) {
        vscode.window.showInformationMessage('Code inserted successfully');
    } else {
        vscode.window.showErrorMessage('Failed to insert code');
    }

    clearPendingSuggestion();
}

/**
 * Reject the pending code suggestion and optionally regenerate
 */
export async function rejectSuggestion(backendUrl: string): Promise<void> {
    if (!pendingSuggestion) {
        vscode.window.showWarningMessage('No pending code suggestion');
        return;
    }

    clearPendingSuggestion();

    const regenerate = await vscode.window.showInformationMessage(
        'Code suggestion discarded',
        'Regenerate with Different Prompt'
    );

    if (regenerate) {
        await generateCodeAtCursor(backendUrl);
    }
}

/**
 * Generate code for a specific task type
 */
export async function generateCodeForTask(
    taskType: 'function' | 'class' | 'test' | 'documentation' | 'refactor',
    backendUrl: string
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const selection = editor.document.getText(editor.selection);
    const languageId = editor.document.languageId;

    let prompt = '';
    let agentType = 'code_generation';

    switch (taskType) {
        case 'function':
            const funcName = await vscode.window.showInputBox({
                prompt: 'Function name and description',
                placeHolder: 'e.g., "validateEmail - validates email format and domain"'
            });
            if (!funcName) return;
            prompt = `Generate a ${languageId} function: ${funcName}`;
            break;

        case 'class':
            const className = await vscode.window.showInputBox({
                prompt: 'Class name and description',
                placeHolder: 'e.g., "UserService - handles user CRUD operations"'
            });
            if (!className) return;
            prompt = `Generate a ${languageId} class: ${className}`;
            break;

        case 'test':
            if (!selection) {
                vscode.window.showErrorMessage('Please select code to generate tests for');
                return;
            }
            prompt = `Generate comprehensive tests for this ${languageId} code:\n\n${selection}`;
            agentType = 'testing';
            break;

        case 'documentation':
            if (!selection) {
                vscode.window.showErrorMessage('Please select code to document');
                return;
            }
            prompt = `Generate documentation/comments for this ${languageId} code:\n\n${selection}`;
            break;

        case 'refactor':
            if (!selection) {
                vscode.window.showErrorMessage('Please select code to refactor');
                return;
            }
            prompt = `Refactor this ${languageId} code for better quality:\n\n${selection}`;
            agentType = 'refactoring';
            break;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Generating ${taskType}...`,
        cancellable: true
    }, async (progress, token) => {
        try {
            const response = await axios.post(`${backendUrl}/generate-code`, {
                prompt,
                language: languageId,
                context: {
                    file_path: editor.document.fileName,
                    surrounding_code: selection || '',
                    cursor_line: editor.selection.active.line
                },
                project_id: getProjectId(),
                agent_type: agentType
            }, axiosConfig);

            if (token.isCancellationRequested) return;

            await showCodePreview(
                response.data.code,
                editor,
                editor.selection.active,
                response.data
            );

        } catch (error: any) {
            if (!token.isCancellationRequested) {
                vscode.window.showErrorMessage(`Generation failed: ${error.message}`);
            }
        }
    });
}

/**
 * Clear the pending suggestion and its decorations
 */
function clearPendingSuggestion(): void {
    if (pendingSuggestion) {
        pendingSuggestion.decorationType.dispose();
        pendingSuggestion = undefined;
    }
}

/**
 * Get the current project ID from workspace
 */
function getProjectId(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.name || 'default';
}

/**
 * Check if there's a pending suggestion
 */
export function hasPendingSuggestion(): boolean {
    return pendingSuggestion !== undefined;
}
