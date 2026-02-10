"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaInlineCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const logger_1 = require("../utils/logger");
class OllamaInlineCompletionProvider {
    constructor(ollamaService) {
        this.ollamaService = ollamaService;
        this._debounceDelay = 500; // 500ms delay to avoid flooding Ollama
        this._isGeneratng = false;
    }
    async provideInlineCompletionItems(document, position, context, token) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const enabled = config.get('enableGhostText', true);
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
        return new Promise((resolve) => {
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
                    }
                    else {
                        resolve(null);
                    }
                }
                catch (error) {
                    logger_1.Logger.error('Error generating inline completion:', error);
                    resolve(null);
                }
                finally {
                    this._isGeneratng = false;
                }
            }, this._debounceDelay);
        });
    }
    buildPrompt(document, position) {
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
exports.OllamaInlineCompletionProvider = OllamaInlineCompletionProvider;
//# sourceMappingURL=inlineCompletionProvider.js.map