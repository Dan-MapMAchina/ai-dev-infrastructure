import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('ai-dev-infrastructure.claude-ai-dev-assistant'));
    });

    test('Should register all commands', async () => {
        const commands = await vscode.commands.getCommands(true);

        const expectedCommands = [
            'claudeAiDev.chat',
            'claudeAiDev.codeReview',
            'claudeAiDev.refactor',
            'claudeAiDev.generateTests',
            'claudeAiDev.explainCode',
            'claudeAiDev.viewDashboard',
            'claudeAiDev.generateCode',
            'claudeAiDev.browseAgents',
            'claudeAiDev.manageCustomRules',
            'claudeAiDev.viewComplianceReport'
        ];

        for (const cmd of expectedCommands) {
            assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });
});
