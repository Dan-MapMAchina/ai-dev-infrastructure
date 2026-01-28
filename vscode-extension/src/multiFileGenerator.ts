import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios, { AxiosRequestConfig } from 'axios';

const API_TIMEOUT = 120000; // 2 minutes for complex generation

const axiosConfig: AxiosRequestConfig = {
    timeout: API_TIMEOUT
};

// Types for multi-file generation
export interface FileGeneration {
    path: string;           // Relative path from workspace root
    content: string;        // File content
    action: 'create' | 'modify' | 'delete';
    preview?: string;       // Diff preview for modifications
    language?: string;      // Language for syntax highlighting
}

export interface GenerationPlan {
    files: FileGeneration[];
    description: string;
    warnings: string[];
    dependencies?: string[];  // External dependencies to install
    postActions?: string[];   // Commands to run after generation
}

export interface FeatureRequest {
    description: string;
    projectContext?: ProjectContext;
}

export interface ProjectContext {
    languages: string[];
    frameworks: string[];
    existingFiles?: string[];
    architecture?: string;
}

// State for pending generation plan
let pendingPlan: GenerationPlan | undefined;
let planPreviewPanel: vscode.WebviewPanel | undefined;

/**
 * Generate a multi-file feature based on description
 */
export async function generateFeature(backendUrl: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    // Get feature description
    const description = await vscode.window.showInputBox({
        prompt: 'Describe the feature you want to generate',
        placeHolder: 'e.g., Add user authentication with JWT tokens and login/register endpoints',
        ignoreFocusOut: true
    });

    if (!description) {
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating feature...',
        cancellable: true
    }, async (progress, token) => {
        try {
            progress.report({ message: 'Analyzing project...' });

            // Gather project context
            const context = await gatherProjectContext(workspacePath);

            progress.report({ message: 'Planning feature implementation...' });

            const response = await axios.post<{ files: FileGeneration[]; description: string; dependencies?: string[] }>(
                `${backendUrl}/generate-feature`,
                {
                    project_id: workspaceFolder.name,
                    feature_description: description,
                    project_context: context
                },
                axiosConfig
            );

            if (token.isCancellationRequested) return;

            const plan: GenerationPlan = {
                files: response.data.files || [],
                description: response.data.description || description,
                warnings: [],
                dependencies: response.data.dependencies
            };

            // Check for file conflicts
            for (const file of plan.files) {
                const fullPath = path.join(workspacePath, file.path);
                if (file.action === 'create' && fs.existsSync(fullPath)) {
                    plan.warnings.push(`File "${file.path}" already exists and will be overwritten`);
                }
            }

            progress.report({ message: 'Preparing preview...' });

            // Show preview
            await previewGenerationPlan(plan, workspacePath);

        } catch (error: any) {
            if (!token.isCancellationRequested) {
                vscode.window.showErrorMessage(`Feature generation failed: ${error.message}`);
            }
        }
    });
}

/**
 * Scaffold a new project structure
 */
export async function scaffoldProject(backendUrl: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    // Check if folder is empty or has only git files
    const files = fs.readdirSync(workspaceFolder.uri.fsPath);
    const nonGitFiles = files.filter(f => f !== '.git' && f !== '.gitignore');

    if (nonGitFiles.length > 0) {
        const proceed = await vscode.window.showWarningMessage(
            'This folder is not empty. Scaffolding may overwrite existing files.',
            'Continue', 'Cancel'
        );
        if (proceed !== 'Continue') return;
    }

    // Select project type
    const projectType = await vscode.window.showQuickPick([
        { label: 'Node.js Express API', value: 'express-api' },
        { label: 'Node.js + React Full Stack', value: 'fullstack-react' },
        { label: 'Python FastAPI', value: 'fastapi' },
        { label: 'Python Django', value: 'django' },
        { label: 'Go HTTP Service', value: 'go-http' },
        { label: 'TypeScript Library', value: 'ts-library' }
    ], { placeHolder: 'Select project template' });

    if (!projectType) return;

    // Get project name
    const projectName = await vscode.window.showInputBox({
        prompt: 'Project name',
        value: workspaceFolder.name,
        placeHolder: 'my-awesome-project'
    });

    if (!projectName) return;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Scaffolding project...',
        cancellable: true
    }, async (progress, token) => {
        try {
            progress.report({ message: 'Generating project structure...' });

            const plan = await generateScaffoldPlan(projectType.value, projectName, backendUrl);

            if (token.isCancellationRequested) return;

            await previewGenerationPlan(plan, workspaceFolder.uri.fsPath);

        } catch (error: any) {
            if (!token.isCancellationRequested) {
                vscode.window.showErrorMessage(`Scaffolding failed: ${error.message}`);
            }
        }
    });
}

/**
 * Preview the generation plan in a WebView
 */
export async function previewGenerationPlan(plan: GenerationPlan, workspacePath: string): Promise<void> {
    pendingPlan = plan;

    if (planPreviewPanel) {
        planPreviewPanel.reveal();
    } else {
        planPreviewPanel = vscode.window.createWebviewPanel(
            'generationPlanPreview',
            'Generation Plan Preview',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        planPreviewPanel.onDidDispose(() => {
            planPreviewPanel = undefined;
            pendingPlan = undefined;
        });
    }

    planPreviewPanel.webview.html = getPlanPreviewHtml(plan);

    planPreviewPanel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'execute':
                if (pendingPlan) {
                    await executeGenerationPlan(pendingPlan, workspacePath);
                    planPreviewPanel?.dispose();
                }
                break;
            case 'cancel':
                planPreviewPanel?.dispose();
                break;
            case 'viewFile':
                if (pendingPlan) {
                    const file = pendingPlan.files.find(f => f.path === message.path);
                    if (file) {
                        const doc = await vscode.workspace.openTextDocument({
                            content: file.content,
                            language: file.language || getLanguageFromPath(file.path)
                        });
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    }
                }
                break;
            case 'removeFile':
                if (pendingPlan) {
                    pendingPlan.files = pendingPlan.files.filter(f => f.path !== message.path);
                    planPreviewPanel!.webview.html = getPlanPreviewHtml(pendingPlan);
                }
                break;
        }
    });
}

/**
 * Execute the generation plan - create/modify/delete files
 */
export async function executeGenerationPlan(plan: GenerationPlan, workspacePath: string): Promise<boolean> {
    const results = {
        created: 0,
        modified: 0,
        deleted: 0,
        failed: 0
    };

    for (const file of plan.files) {
        const fullPath = path.join(workspacePath, file.path);
        const dir = path.dirname(fullPath);

        try {
            switch (file.action) {
                case 'create':
                case 'modify':
                    // Ensure directory exists
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(fullPath, file.content);
                    if (file.action === 'create') {
                        results.created++;
                    } else {
                        results.modified++;
                    }
                    break;

                case 'delete':
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                        results.deleted++;
                    }
                    break;
            }
        } catch (error: any) {
            results.failed++;
            console.error(`Failed to ${file.action} ${file.path}: ${error.message}`);
        }
    }

    // Show results
    const message = `Generation complete: ${results.created} created, ${results.modified} modified, ${results.deleted} deleted` +
        (results.failed > 0 ? `, ${results.failed} failed` : '');

    if (results.failed > 0) {
        vscode.window.showWarningMessage(message);
    } else {
        vscode.window.showInformationMessage(message);
    }

    // Show dependencies to install
    if (plan.dependencies && plan.dependencies.length > 0) {
        const install = await vscode.window.showInformationMessage(
            `Dependencies to install: ${plan.dependencies.join(', ')}`,
            'Copy Install Command'
        );

        if (install) {
            const cmd = plan.dependencies.join(' ');
            await vscode.env.clipboard.writeText(`npm install ${cmd}`);
            vscode.window.showInformationMessage('Install command copied to clipboard');
        }
    }

    // Open first created file
    const firstCreated = plan.files.find(f => f.action === 'create');
    if (firstCreated) {
        const fullPath = path.join(workspacePath, firstCreated.path);
        if (fs.existsSync(fullPath)) {
            const doc = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(doc);
        }
    }

    return results.failed === 0;
}

/**
 * Gather project context for generation
 */
async function gatherProjectContext(workspacePath: string): Promise<ProjectContext> {
    const context: ProjectContext = {
        languages: [],
        frameworks: [],
        existingFiles: []
    };

    // Detect languages and frameworks
    if (fs.existsSync(path.join(workspacePath, 'package.json'))) {
        context.languages.push('TypeScript', 'JavaScript');
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps['react']) context.frameworks.push('React');
            if (deps['vue']) context.frameworks.push('Vue');
            if (deps['express']) context.frameworks.push('Express');
            if (deps['@nestjs/core']) context.frameworks.push('NestJS');
            if (deps['next']) context.frameworks.push('Next.js');
        } catch { }
    }

    if (fs.existsSync(path.join(workspacePath, 'requirements.txt')) ||
        fs.existsSync(path.join(workspacePath, 'pyproject.toml'))) {
        context.languages.push('Python');
        if (fs.existsSync(path.join(workspacePath, 'requirements.txt'))) {
            try {
                const req = fs.readFileSync(path.join(workspacePath, 'requirements.txt'), 'utf-8').toLowerCase();
                if (req.includes('django')) context.frameworks.push('Django');
                if (req.includes('flask')) context.frameworks.push('Flask');
                if (req.includes('fastapi')) context.frameworks.push('FastAPI');
            } catch { }
        }
    }

    if (fs.existsSync(path.join(workspacePath, 'go.mod'))) {
        context.languages.push('Go');
    }

    // Get existing file structure (limited)
    try {
        const files = fs.readdirSync(workspacePath, { withFileTypes: true });
        for (const file of files.slice(0, 50)) {
            if (!file.name.startsWith('.') && file.name !== 'node_modules') {
                context.existingFiles?.push(file.isDirectory() ? `${file.name}/` : file.name);
            }
        }
    } catch { }

    return context;
}

/**
 * Generate scaffold plan for a project type
 */
async function generateScaffoldPlan(
    projectType: string,
    projectName: string,
    backendUrl: string
): Promise<GenerationPlan> {
    // Try to get from backend
    try {
        const response = await axios.post<{ files: FileGeneration[]; dependencies?: string[] }>(
            `${backendUrl}/generate-feature`,
            {
                feature_description: `Scaffold a new ${projectType} project named "${projectName}" with best practices, including:
                    - Project structure
                    - Configuration files
                    - Basic routes/endpoints
                    - Testing setup
                    - Docker support
                    - README`,
                project_context: { languages: [], frameworks: [] }
            },
            axiosConfig
        );

        return {
            files: response.data.files || [],
            description: `${projectType} project scaffold`,
            warnings: [],
            dependencies: response.data.dependencies
        };
    } catch {
        // Fallback to local templates
        return generateLocalScaffold(projectType, projectName);
    }
}

/**
 * Generate scaffold locally (fallback)
 */
function generateLocalScaffold(projectType: string, projectName: string): GenerationPlan {
    const files: FileGeneration[] = [];

    switch (projectType) {
        case 'express-api':
            files.push(
                {
                    path: 'package.json',
                    action: 'create',
                    content: JSON.stringify({
                        name: projectName,
                        version: '1.0.0',
                        main: 'dist/index.js',
                        scripts: {
                            build: 'tsc',
                            start: 'node dist/index.js',
                            dev: 'ts-node-dev src/index.ts',
                            test: 'jest'
                        },
                        dependencies: {
                            express: '^4.18.2',
                            cors: '^2.8.5'
                        },
                        devDependencies: {
                            typescript: '^5.0.0',
                            '@types/node': '^20.0.0',
                            '@types/express': '^4.17.0',
                            'ts-node-dev': '^2.0.0'
                        }
                    }, null, 2),
                    language: 'json'
                },
                {
                    path: 'src/index.ts',
                    action: 'create',
                    content: `import express from 'express';
import cors from 'cors';
import { router } from './routes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api', router);

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
});
`,
                    language: 'typescript'
                },
                {
                    path: 'src/routes/index.ts',
                    action: 'create',
                    content: `import { Router } from 'express';

export const router = Router();

router.get('/', (req, res) => {
    res.json({ message: 'Welcome to ${projectName} API' });
});
`,
                    language: 'typescript'
                },
                {
                    path: 'tsconfig.json',
                    action: 'create',
                    content: JSON.stringify({
                        compilerOptions: {
                            target: 'ES2020',
                            module: 'commonjs',
                            lib: ['ES2020'],
                            outDir: './dist',
                            rootDir: './src',
                            strict: true,
                            esModuleInterop: true,
                            skipLibCheck: true
                        },
                        include: ['src/**/*'],
                        exclude: ['node_modules']
                    }, null, 2),
                    language: 'json'
                },
                {
                    path: 'Dockerfile',
                    action: 'create',
                    content: `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
`,
                    language: 'dockerfile'
                },
                {
                    path: 'README.md',
                    action: 'create',
                    content: `# ${projectName}

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Build

\`\`\`bash
npm run build
npm start
\`\`\`

## Docker

\`\`\`bash
docker build -t ${projectName} .
docker run -p 3000:3000 ${projectName}
\`\`\`
`,
                    language: 'markdown'
                }
            );
            return {
                files,
                description: 'Express API with TypeScript',
                warnings: [],
                dependencies: ['express', 'cors'],
                postActions: ['npm install']
            };

        case 'fastapi':
            files.push(
                {
                    path: 'requirements.txt',
                    action: 'create',
                    content: `fastapi>=0.100.0
uvicorn[standard]>=0.22.0
pydantic>=2.0.0
python-dotenv>=1.0.0
pytest>=7.0.0
httpx>=0.24.0
`,
                    language: 'plaintext'
                },
                {
                    path: 'app/main.py',
                    action: 'create',
                    content: `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import router

app = FastAPI(title="${projectName}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
`,
                    language: 'python'
                },
                {
                    path: 'app/routes.py',
                    action: 'create',
                    content: `from fastapi import APIRouter

router = APIRouter()

@router.get("/")
async def root():
    return {"message": "Welcome to ${projectName} API"}
`,
                    language: 'python'
                },
                {
                    path: 'app/__init__.py',
                    action: 'create',
                    content: '',
                    language: 'python'
                },
                {
                    path: 'Dockerfile',
                    action: 'create',
                    content: `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

USER nobody
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
                    language: 'dockerfile'
                },
                {
                    path: 'README.md',
                    action: 'create',
                    content: `# ${projectName}

## Getting Started

\`\`\`bash
pip install -r requirements.txt
uvicorn app.main:app --reload
\`\`\`

## Docker

\`\`\`bash
docker build -t ${projectName} .
docker run -p 8000:8000 ${projectName}
\`\`\`

## API Docs

Visit http://localhost:8000/docs for interactive API documentation.
`,
                    language: 'markdown'
                }
            );
            return {
                files,
                description: 'FastAPI project with Python',
                warnings: [],
                postActions: ['pip install -r requirements.txt']
            };

        default:
            return {
                files: [{
                    path: 'README.md',
                    action: 'create',
                    content: `# ${projectName}\n\nProject scaffolding for ${projectType}`,
                    language: 'markdown'
                }],
                description: 'Basic project structure',
                warnings: ['Template not fully implemented. Using minimal scaffold.']
            };
    }
}

/**
 * Get language ID from file path
 */
function getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
        '.ts': 'typescript',
        '.tsx': 'typescriptreact',
        '.js': 'javascript',
        '.jsx': 'javascriptreact',
        '.py': 'python',
        '.go': 'go',
        '.rs': 'rust',
        '.java': 'java',
        '.json': 'json',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.md': 'markdown',
        '.html': 'html',
        '.css': 'css',
        '.sql': 'sql'
    };
    return languageMap[ext] || 'plaintext';
}

/**
 * Generate HTML for plan preview
 */
function getPlanPreviewHtml(plan: GenerationPlan): string {
    const fileRows = plan.files.map(file => {
        const actionClass = file.action === 'create' ? 'create' :
                           file.action === 'modify' ? 'modify' : 'delete';
        const actionIcon = file.action === 'create' ? '+' :
                          file.action === 'modify' ? '~' : '-';
        const lines = file.content.split('\n').length;

        return `
            <tr class="${actionClass}">
                <td><span class="action-icon">${actionIcon}</span></td>
                <td class="file-path">${escapeHtml(file.path)}</td>
                <td>${file.action}</td>
                <td>${lines} lines</td>
                <td>
                    <button onclick="viewFile('${escapeHtml(file.path)}')">View</button>
                    <button onclick="removeFile('${escapeHtml(file.path)}')">Remove</button>
                </td>
            </tr>
        `;
    }).join('');

    const warningsHtml = plan.warnings.length > 0 ?
        `<div class="warnings">
            <h3>Warnings</h3>
            <ul>${plan.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
        </div>` : '';

    const depsHtml = plan.dependencies && plan.dependencies.length > 0 ?
        `<div class="dependencies">
            <h3>Dependencies to Install</h3>
            <code>${plan.dependencies.join(' ')}</code>
        </div>` : '';

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
        h1, h2, h3 { margin-top: 0; }
        .description {
            background: var(--vscode-input-background);
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-input-border);
        }
        th { background: var(--vscode-input-background); }
        .create { background: rgba(0, 255, 0, 0.1); }
        .modify { background: rgba(255, 255, 0, 0.1); }
        .delete { background: rgba(255, 0, 0, 0.1); }
        .action-icon {
            font-weight: bold;
            font-size: 16px;
        }
        .create .action-icon { color: #4caf50; }
        .modify .action-icon { color: #ff9800; }
        .delete .action-icon { color: #f44336; }
        .file-path { font-family: monospace; }
        .warnings {
            background: rgba(255, 152, 0, 0.2);
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
        }
        .dependencies {
            background: var(--vscode-input-background);
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
        }
        .dependencies code {
            display: block;
            padding: 10px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
            margin-top: 10px;
        }
        .actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .summary {
            display: flex;
            gap: 20px;
            margin: 20px 0;
        }
        .summary-item {
            padding: 10px 20px;
            background: var(--vscode-input-background);
            border-radius: 4px;
        }
        .summary-value {
            font-size: 24px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>Generation Plan Preview</h1>

    <div class="description">
        <strong>Description:</strong> ${escapeHtml(plan.description)}
    </div>

    <div class="summary">
        <div class="summary-item">
            <div class="summary-value">${plan.files.filter(f => f.action === 'create').length}</div>
            <div>Files to Create</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${plan.files.filter(f => f.action === 'modify').length}</div>
            <div>Files to Modify</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${plan.files.filter(f => f.action === 'delete').length}</div>
            <div>Files to Delete</div>
        </div>
    </div>

    ${warningsHtml}
    ${depsHtml}

    <h2>Files</h2>
    <table>
        <tr>
            <th></th>
            <th>Path</th>
            <th>Action</th>
            <th>Size</th>
            <th>Actions</th>
        </tr>
        ${fileRows}
    </table>

    <div class="actions">
        <button class="btn-primary" onclick="execute()">Execute Plan</button>
        <button class="btn-secondary" onclick="cancel()">Cancel</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function execute() {
            vscode.postMessage({ command: 'execute' });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        function viewFile(path) {
            vscode.postMessage({ command: 'viewFile', path });
        }

        function removeFile(path) {
            vscode.postMessage({ command: 'removeFile', path });
        }
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
