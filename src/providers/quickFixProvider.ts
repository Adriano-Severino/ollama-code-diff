import * as vscode from 'vscode';
import { OllamaService } from '../ollama';

export class OllamaQuickFixProvider implements vscode.CodeActionProvider {

    constructor(private ollamaService: OllamaService) { }

    async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): Promise<(vscode.Command | vscode.CodeAction)[]> {

        // Only provide if there are diagnostics (errors/warnings)
        if (context.diagnostics.length === 0) {
            return [];
        }

        const actions: vscode.CodeAction[] = [];

        // Create a generic "Fix with AI" action
        const fixAction = new vscode.CodeAction('🤖 Fix with Ollama', vscode.CodeActionKind.QuickFix);
        fixAction.command = {
            command: 'ollama-code-diff.fixDiagnostic',
            title: 'Fix with Ollama',
            arguments: [document, range, context.diagnostics]
        };
        actions.push(fixAction);

        // We could also pre-generate specific fixes, but that might be slow.
        // Better to have the command trigger the generation.

        return actions;
    }
}
