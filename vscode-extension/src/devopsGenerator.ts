import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios, { AxiosRequestConfig } from 'axios';

const API_TIMEOUT = 60000;

const axiosConfig: AxiosRequestConfig = {
    timeout: API_TIMEOUT
};

// Types for DevOps generation
export interface DevOpsTemplate {
    type: 'dockerfile' | 'docker-compose' | 'github-actions' | 'gitlab-ci' | 'jenkinsfile';
    content: string;
    filename: string;
    description: string;
}

export interface ProjectAnalysis {
    languages: string[];
    frameworks: string[];
    databases: string[];
    hasTests: boolean;
    hasDocker: boolean;
    hasCICD: boolean;
    complexity: 'simple' | 'moderate' | 'complex';
    fileCount: number;
    packageManager?: string;
    nodeVersion?: string;
    pythonVersion?: string;
}

export interface DevOpsGenerationResult {
    templates: DevOpsTemplate[];
    agent: string;
    metrics: {
        tokens: number;
        time_ms: number;
    };
}

/**
 * Analyze project for DevOps generation
 */
async function analyzeProjectForDevOps(workspacePath: string): Promise<ProjectAnalysis> {
    const analysis: ProjectAnalysis = {
        languages: [],
        frameworks: [],
        databases: [],
        hasTests: false,
        hasDocker: false,
        hasCICD: false,
        complexity: 'simple',
        fileCount: 0
    };

    // Check for package.json (Node.js)
    const packageJsonPath = path.join(workspacePath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            analysis.languages.push('Node.js');
            analysis.packageManager = fs.existsSync(path.join(workspacePath, 'yarn.lock')) ? 'yarn' :
                                      fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';

            // Detect frameworks
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
            if (deps['react']) analysis.frameworks.push('React');
            if (deps['vue']) analysis.frameworks.push('Vue');
            if (deps['angular']) analysis.frameworks.push('Angular');
            if (deps['next']) analysis.frameworks.push('Next.js');
            if (deps['express']) analysis.frameworks.push('Express');
            if (deps['nestjs'] || deps['@nestjs/core']) analysis.frameworks.push('NestJS');
            if (deps['fastify']) analysis.frameworks.push('Fastify');

            // Detect databases
            if (deps['pg'] || deps['postgres'] || deps['postgresql']) analysis.databases.push('PostgreSQL');
            if (deps['mysql'] || deps['mysql2']) analysis.databases.push('MySQL');
            if (deps['mongodb'] || deps['mongoose']) analysis.databases.push('MongoDB');
            if (deps['redis'] || deps['ioredis']) analysis.databases.push('Redis');

            // Check for tests
            if (deps['jest'] || deps['mocha'] || deps['vitest'] || packageJson.scripts?.test) {
                analysis.hasTests = true;
            }

            // Detect Node version
            if (packageJson.engines?.node) {
                analysis.nodeVersion = packageJson.engines.node;
            }
        } catch {
            // Ignore parse errors
        }
    }

    // Check for requirements.txt or pyproject.toml (Python)
    if (fs.existsSync(path.join(workspacePath, 'requirements.txt')) ||
        fs.existsSync(path.join(workspacePath, 'pyproject.toml')) ||
        fs.existsSync(path.join(workspacePath, 'setup.py'))) {
        analysis.languages.push('Python');

        // Try to detect Python frameworks
        const reqPath = path.join(workspacePath, 'requirements.txt');
        if (fs.existsSync(reqPath)) {
            const requirements = fs.readFileSync(reqPath, 'utf-8').toLowerCase();
            if (requirements.includes('django')) analysis.frameworks.push('Django');
            if (requirements.includes('flask')) analysis.frameworks.push('Flask');
            if (requirements.includes('fastapi')) analysis.frameworks.push('FastAPI');
            if (requirements.includes('pytest')) analysis.hasTests = true;
            if (requirements.includes('psycopg') || requirements.includes('postgresql')) analysis.databases.push('PostgreSQL');
            if (requirements.includes('pymysql') || requirements.includes('mysql')) analysis.databases.push('MySQL');
            if (requirements.includes('pymongo')) analysis.databases.push('MongoDB');
        }
    }

    // Check for go.mod (Go)
    if (fs.existsSync(path.join(workspacePath, 'go.mod'))) {
        analysis.languages.push('Go');
    }

    // Check for Cargo.toml (Rust)
    if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) {
        analysis.languages.push('Rust');
    }

    // Check for existing Docker/CI files
    analysis.hasDocker = fs.existsSync(path.join(workspacePath, 'Dockerfile')) ||
                         fs.existsSync(path.join(workspacePath, 'docker-compose.yml'));

    analysis.hasCICD = fs.existsSync(path.join(workspacePath, '.github', 'workflows')) ||
                       fs.existsSync(path.join(workspacePath, '.gitlab-ci.yml'));

    return analysis;
}

/**
 * Generate Dockerfile for the project
 */
export async function generateDockerfile(backendUrl: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating Dockerfile...',
        cancellable: true
    }, async (progress, token) => {
        try {
            progress.report({ message: 'Analyzing project...' });

            const analysis = await analyzeProjectForDevOps(workspacePath);

            if (analysis.languages.length === 0) {
                vscode.window.showWarningMessage('Could not detect project language. Please specify manually.');
                return;
            }

            progress.report({ message: 'Generating Dockerfile...' });

            const response = await axios.post<DevOpsGenerationResult>(
                `${backendUrl}/generate-devops`,
                {
                    project_id: workspaceFolder.name,
                    template_type: 'dockerfile',
                    project_analysis: analysis
                },
                axiosConfig
            );

            if (token.isCancellationRequested) return;

            const dockerfile = response.data.templates.find(t => t.type === 'dockerfile');

            if (!dockerfile) {
                // Generate a default Dockerfile based on analysis
                const content = generateDefaultDockerfile(analysis);
                await showAndSaveTemplate({
                    type: 'dockerfile',
                    content,
                    filename: 'Dockerfile',
                    description: 'Auto-generated Dockerfile'
                }, workspacePath);
            } else {
                await showAndSaveTemplate(dockerfile, workspacePath);
            }

        } catch (error: any) {
            if (!token.isCancellationRequested) {
                // Fallback to local generation
                const analysis = await analyzeProjectForDevOps(workspacePath);
                const content = generateDefaultDockerfile(analysis);
                await showAndSaveTemplate({
                    type: 'dockerfile',
                    content,
                    filename: 'Dockerfile',
                    description: 'Auto-generated Dockerfile'
                }, workspacePath);
            }
        }
    });
}

/**
 * Generate CI/CD pipeline configuration
 */
export async function generateCIPipeline(
    backendUrl: string,
    platform: 'github' | 'gitlab' = 'github'
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;

    // Ask which platform if not specified
    const platformChoice = await vscode.window.showQuickPick(
        [
            { label: 'GitHub Actions', value: 'github' as const },
            { label: 'GitLab CI', value: 'gitlab' as const }
        ],
        { placeHolder: 'Select CI/CD platform' }
    );

    if (!platformChoice) return;

    const selectedPlatform = platformChoice.value;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Generating ${platformChoice.label} configuration...`,
        cancellable: true
    }, async (progress, token) => {
        try {
            progress.report({ message: 'Analyzing project...' });

            const analysis = await analyzeProjectForDevOps(workspacePath);

            progress.report({ message: 'Generating CI/CD config...' });

            const response = await axios.post<DevOpsGenerationResult>(
                `${backendUrl}/generate-devops`,
                {
                    project_id: workspaceFolder.name,
                    template_type: selectedPlatform === 'github' ? 'github-actions' : 'gitlab-ci',
                    project_analysis: analysis
                },
                axiosConfig
            );

            if (token.isCancellationRequested) return;

            const ciConfig = response.data.templates.find(
                t => t.type === (selectedPlatform === 'github' ? 'github-actions' : 'gitlab-ci')
            );

            if (!ciConfig) {
                // Generate default
                const content = selectedPlatform === 'github'
                    ? generateDefaultGitHubActions(analysis)
                    : generateDefaultGitLabCI(analysis);

                const filename = selectedPlatform === 'github'
                    ? '.github/workflows/ci.yml'
                    : '.gitlab-ci.yml';

                await showAndSaveTemplate({
                    type: selectedPlatform === 'github' ? 'github-actions' : 'gitlab-ci',
                    content,
                    filename,
                    description: `Auto-generated ${platformChoice.label} configuration`
                }, workspacePath);
            } else {
                await showAndSaveTemplate(ciConfig, workspacePath);
            }

        } catch (error: any) {
            if (!token.isCancellationRequested) {
                // Fallback to local generation
                const analysis = await analyzeProjectForDevOps(workspacePath);
                const content = selectedPlatform === 'github'
                    ? generateDefaultGitHubActions(analysis)
                    : generateDefaultGitLabCI(analysis);

                const filename = selectedPlatform === 'github'
                    ? '.github/workflows/ci.yml'
                    : '.gitlab-ci.yml';

                await showAndSaveTemplate({
                    type: selectedPlatform === 'github' ? 'github-actions' : 'gitlab-ci',
                    content,
                    filename,
                    description: `Auto-generated ${platformChoice.label} configuration`
                }, workspacePath);
            }
        }
    });
}

/**
 * Generate docker-compose configuration
 */
export async function generateDockerCompose(backendUrl: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const analysis = await analyzeProjectForDevOps(workspacePath);
    const content = generateDefaultDockerCompose(analysis, workspaceFolder.name);

    await showAndSaveTemplate({
        type: 'docker-compose',
        content,
        filename: 'docker-compose.yml',
        description: 'Docker Compose configuration'
    }, workspacePath);
}

/**
 * Show template preview and optionally save
 */
async function showAndSaveTemplate(
    template: DevOpsTemplate,
    workspacePath: string
): Promise<void> {
    // Show preview
    const doc = await vscode.workspace.openTextDocument({
        content: template.content,
        language: 'yaml'
    });

    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    // Ask to save
    const save = await vscode.window.showInformationMessage(
        `${template.description}. Save to ${template.filename}?`,
        'Save',
        'Save As...',
        'Cancel'
    );

    if (save === 'Save') {
        const filePath = path.join(workspacePath, template.filename);

        // Create directories if needed
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Check if file exists
        if (fs.existsSync(filePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `${template.filename} already exists. Overwrite?`,
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') return;
        }

        fs.writeFileSync(filePath, template.content);
        vscode.window.showInformationMessage(`Saved ${template.filename}`);

        // Open the saved file
        const savedDoc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(savedDoc);

    } else if (save === 'Save As...') {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(workspacePath, template.filename)),
            filters: { 'All Files': ['*'] }
        });

        if (uri) {
            fs.writeFileSync(uri.fsPath, template.content);
            vscode.window.showInformationMessage(`Saved ${path.basename(uri.fsPath)}`);
        }
    }
}

/**
 * Generate default Dockerfile based on project analysis
 */
function generateDefaultDockerfile(analysis: ProjectAnalysis): string {
    // Node.js
    if (analysis.languages.includes('Node.js')) {
        const nodeVersion = analysis.nodeVersion?.replace(/[^\d.]/g, '') || '20';
        const pm = analysis.packageManager || 'npm';
        const installCmd = pm === 'yarn' ? 'yarn install --frozen-lockfile' :
                          pm === 'pnpm' ? 'pnpm install --frozen-lockfile' :
                          'npm ci';
        const buildCmd = pm === 'yarn' ? 'yarn build' :
                        pm === 'pnpm' ? 'pnpm build' :
                        'npm run build';

        return `# Build stage
FROM node:${nodeVersion}-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
${pm === 'yarn' ? 'COPY yarn.lock ./\n' : ''}${pm === 'pnpm' ? 'COPY pnpm-lock.yaml ./\n' : ''}

# Install dependencies
RUN ${installCmd}

# Copy source code
COPY . .

# Build application
RUN ${buildCmd}

# Production stage
FROM node:${nodeVersion}-alpine AS production

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]
`;
    }

    // Python
    if (analysis.languages.includes('Python')) {
        const framework = analysis.frameworks.find(f => ['Django', 'Flask', 'FastAPI'].includes(f));
        const port = framework === 'Django' ? 8000 : 5000;
        const cmd = framework === 'Django' ? 'gunicorn myproject.wsgi:application' :
                    framework === 'FastAPI' ? 'uvicorn main:app --host 0.0.0.0' :
                    framework === 'Flask' ? 'gunicorn app:app' :
                    'python main.py';

        return `FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    gcc \\
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1001 appuser
USER appuser

EXPOSE ${port}

CMD ["${cmd.split(' ')[0]}", "${cmd.split(' ').slice(1).join('", "')}"]
`;
    }

    // Go
    if (analysis.languages.includes('Go')) {
        return `# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/main .

# Production stage
FROM alpine:3.18

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/main .

# Create non-root user
RUN adduser -D -u 1001 appuser
USER appuser

EXPOSE 8080

CMD ["./main"]
`;
    }

    // Default generic Dockerfile
    return `FROM alpine:3.18

WORKDIR /app

COPY . .

# Add your build and run commands here

EXPOSE 8080

CMD ["echo", "Please customize this Dockerfile for your application"]
`;
}

/**
 * Generate default GitHub Actions workflow
 */
function generateDefaultGitHubActions(analysis: ProjectAnalysis): string {
    const isNode = analysis.languages.includes('Node.js');
    const isPython = analysis.languages.includes('Python');
    const hasDocker = analysis.hasDocker || analysis.databases.length > 0;

    let workflow = `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
`;

    if (isNode) {
        const pm = analysis.packageManager || 'npm';
        workflow += `  build:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [18.x, 20.x]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: '${pm}'

      - name: Install dependencies
        run: ${pm === 'yarn' ? 'yarn install --frozen-lockfile' : pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci'}

      - name: Run linter
        run: ${pm} run lint
        continue-on-error: true

      - name: Run tests
        run: ${pm} ${pm === 'npm' ? 'run ' : ''}test

      - name: Build
        run: ${pm} run build
`;
    }

    if (isPython) {
        workflow += `  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        python-version: ['3.10', '3.11', '3.12']

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python \${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
          cache: 'pip'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install pytest pytest-cov flake8

      - name: Lint with flake8
        run: flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
        continue-on-error: true

      - name: Test with pytest
        run: pytest --cov=./ --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml
`;
    }

    if (hasDocker) {
        workflow += `
  docker:
    runs-on: ubuntu-latest
    needs: [${isNode ? 'build' : isPython ? 'test' : 'build'}]
    if: github.event_name == 'push'

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ghcr.io/\${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;
    }

    return workflow;
}

/**
 * Generate default GitLab CI configuration
 */
function generateDefaultGitLabCI(analysis: ProjectAnalysis): string {
    const isNode = analysis.languages.includes('Node.js');
    const isPython = analysis.languages.includes('Python');

    let config = `stages:
  - test
  - build
  - deploy

variables:
  DOCKER_TLS_CERTDIR: "/certs"

`;

    if (isNode) {
        const pm = analysis.packageManager || 'npm';
        config += `test:
  stage: test
  image: node:20-alpine
  cache:
    paths:
      - node_modules/
  script:
    - ${pm === 'yarn' ? 'yarn install --frozen-lockfile' : pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci'}
    - ${pm} run lint || true
    - ${pm} ${pm === 'npm' ? 'run ' : ''}test
  coverage: '/All files[^|]*\\|[^|]*\\s+([\\d\\.]+)/'

build:
  stage: build
  image: node:20-alpine
  cache:
    paths:
      - node_modules/
  script:
    - ${pm === 'yarn' ? 'yarn install --frozen-lockfile' : pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci'}
    - ${pm} run build
  artifacts:
    paths:
      - dist/
`;
    }

    if (isPython) {
        config += `test:
  stage: test
  image: python:3.11
  cache:
    paths:
      - .cache/pip
  variables:
    PIP_CACHE_DIR: "$CI_PROJECT_DIR/.cache/pip"
  script:
    - pip install -r requirements.txt
    - pip install pytest pytest-cov flake8
    - flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics || true
    - pytest --cov=./ --cov-report=xml
  coverage: '/TOTAL.*\\s+(\\d+%)/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
`;
    }

    config += `
docker:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  only:
    - main
    - master
`;

    return config;
}

/**
 * Generate default docker-compose configuration
 */
function generateDefaultDockerCompose(analysis: ProjectAnalysis, projectName: string): string {
    let services = `version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
`;

    const deps: string[] = [];

    if (analysis.databases.includes('PostgreSQL')) {
        deps.push('postgres');
        services += `      - postgres
`;
    }

    if (analysis.databases.includes('Redis')) {
        deps.push('redis');
        services += `      - redis
`;
    }

    if (analysis.databases.includes('MongoDB')) {
        deps.push('mongo');
        services += `      - mongo
`;
    }

    if (deps.length === 0) {
        services = services.replace('    depends_on:\n', '');
    }

    // Add database services
    if (analysis.databases.includes('PostgreSQL')) {
        services += `
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${projectName}
      POSTGRES_PASSWORD: password
      POSTGRES_DB: ${projectName}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
`;
    }

    if (analysis.databases.includes('Redis')) {
        services += `
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
`;
    }

    if (analysis.databases.includes('MongoDB')) {
        services += `
  mongo:
    image: mongo:6
    environment:
      MONGO_INITDB_ROOT_USERNAME: root
      MONGO_INITDB_ROOT_PASSWORD: password
    volumes:
      - mongo_data:/data/db
    ports:
      - "27017:27017"
`;
    }

    // Add volumes
    const volumes: string[] = [];
    if (analysis.databases.includes('PostgreSQL')) volumes.push('postgres_data');
    if (analysis.databases.includes('Redis')) volumes.push('redis_data');
    if (analysis.databases.includes('MongoDB')) volumes.push('mongo_data');

    if (volumes.length > 0) {
        services += `
volumes:
${volumes.map(v => `  ${v}:`).join('\n')}
`;
    }

    return services;
}
