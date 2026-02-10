import * as vscode from 'vscode';
import { OllamaService } from '../ollama';
import { Logger } from '../utils/logger';

export class OllamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private _debounceTimer: NodeJS.Timeout | undefined;
    private _debounceDelay = 500; // 500ms delay to avoid flooding Ollama
    private _isGeneratng = false;

    constructor(private ollamaService: OllamaService) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const enabled = config.get<boolean>('enableGhostText', true);
        
        if (!enabled) {
            return [];
        }

        // Avoid triggering if manually triggered or if already generating
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && this._isGeneratng) {
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

                this._isGeneratng = true;

                try {
                    const prompt = this.buildPrompt(document, position);
                    if (!prompt) {
                        resolve(null);
                        return;
                    }

                    // Use a specific method for completions or the generic generate
                    // Ideally, we'd have a simpler/faster model config for this
                    const completion = await this.ollamaService.generateCompletion(prompt);
                    
                    if (completion && !token.isCancellationRequested) {
                        const item = new vscode.InlineCompletionItem(completion, new vscode.Range(position, position));
                        resolve([item]);
                    } else {
                        resolve(null);
                    }
                } catch (error) {
                    Logger.error('Error generating inline completion:', error);
                    resolve(null);
                } finally {
                    this._isGeneratng = false;
                }
            }, this._debounceDelay);
        });
    }

    private buildPrompt(document: vscode.TextDocument, position: vscode.Position): string {
        const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const textAfter = document.getText(new vscode.Range(position, new vscode.Position(document.lineCount, 0)));
        
        // Simple prompt structure for now. Can be optimized for FIM (Fill-In-Middle) models later.
        // For qwen2.5-coder or codellama, a simple comment or FIM tokens might work best.
        // Using a generic comment style for now.
        
        const language = document.languageId;
        
        // Truncate context to avoid huge prompts
        const maxContextLines = 50;
        const linesBefore = textBefore.split('\n').slice(-maxContextLines).join('\n');
        const linesAfter = textAfter.split('\n').slice(0, 10).join('\n'); // Look ahead a bit

        return `<PRE> ${linesBefore} <SUF> ${linesAfter} <MID>`;
    }
}
