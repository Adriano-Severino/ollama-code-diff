import * as vscode from 'vscode';
import { OllamaService } from '../ollama';
import { Logger } from '../utils/logger';

import { buildFimPrompt, cleanInlineCompletion } from '../utils/fimPrompt';
export { buildFimPrompt, cleanInlineCompletion };

export class OllamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private _debounceTimer: NodeJS.Timeout | undefined;
    private _isGenerating = false;

    constructor(private ollamaService: OllamaService) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const enabled = config.get<boolean>('enableGhostText', true);
        const debounceDelay = config.get<number>('completionDebounceMs', 350);
        const modelName = config.get<string>('completionModelName', config.get<string>('modelName', 'qwen2.5-coder:1.5b-base'));
        
        if (!enabled) {
            return [];
        }

        // Avoid triggering if already generating
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && this._isGenerating) {
            return null;
        }

        // Cancel previous pending request
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        return new Promise<vscode.InlineCompletionItem[] | null>((resolve) => {
            this._debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve(null);
                    return;
                }

                this._isGenerating = true;

                try {
                    const prompt = this.buildPrompt(document, position, modelName);
                    if (!prompt || token.isCancellationRequested) {
                        resolve(null);
                        return;
                    }

                    const rawCompletion = await this.ollamaService.generateCompletion(prompt);
                    const cleaned = cleanInlineCompletion(rawCompletion);
                    
                    if (cleaned && !token.isCancellationRequested) {
                        const item = new vscode.InlineCompletionItem(cleaned, new vscode.Range(position, position));
                        resolve([item]);
                    } else {
                        resolve(null);
                    }
                } catch (error) {
                    Logger.error('Erro ao gerar autocompletar inline:', error);
                    resolve(null);
                } finally {
                    this._isGenerating = false;
                }
            }, Math.max(50, debounceDelay));
        });
    }

    private buildPrompt(document: vscode.TextDocument, position: vscode.Position, modelName: string): string {
        const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const textAfter = document.getText(new vscode.Range(position, new vscode.Position(document.lineCount, 0)));
        
        // Truncate context to keep completions fast and lightweight
        const maxContextLinesBefore = 60;
        const maxContextLinesAfter = 20;
        const linesBefore = textBefore.split('\n').slice(-maxContextLinesBefore).join('\n');
        const linesAfter = textAfter.split('\n').slice(0, maxContextLinesAfter).join('\n');

        return buildFimPrompt(linesBefore, linesAfter, modelName);
    }
}
