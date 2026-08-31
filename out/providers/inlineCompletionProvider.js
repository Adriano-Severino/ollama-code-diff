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
exports.OllamaInlineCompletionProvider = exports.cleanInlineCompletion = exports.buildFimPrompt = void 0;
const vscode = __importStar(require("vscode"));
const logger_1 = require("../utils/logger");
const fimPrompt_1 = require("../utils/fimPrompt");
Object.defineProperty(exports, "buildFimPrompt", { enumerable: true, get: function () { return fimPrompt_1.buildFimPrompt; } });
Object.defineProperty(exports, "cleanInlineCompletion", { enumerable: true, get: function () { return fimPrompt_1.cleanInlineCompletion; } });
class OllamaInlineCompletionProvider {
    constructor(ollamaService) {
        this.ollamaService = ollamaService;
        this._isGenerating = false;
    }
    async provideInlineCompletionItems(document, position, context, token) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const enabled = config.get('enableGhostText', true);
        const debounceDelay = config.get('completionDebounceMs', 350);
        const modelName = config.get('completionModelName', config.get('modelName', 'qwen2.5-coder:1.5b-base'));
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
        return new Promise((resolve) => {
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
                    const cleaned = (0, fimPrompt_1.cleanInlineCompletion)(rawCompletion);
                    if (cleaned && !token.isCancellationRequested) {
                        const item = new vscode.InlineCompletionItem(cleaned, new vscode.Range(position, position));
                        resolve([item]);
                    }
                    else {
                        resolve(null);
                    }
                }
                catch (error) {
                    logger_1.Logger.error('Erro ao gerar autocompletar inline:', error);
                    resolve(null);
                }
                finally {
                    this._isGenerating = false;
                }
            }, Math.max(50, debounceDelay));
        });
    }
    buildPrompt(document, position, modelName) {
        const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const textAfter = document.getText(new vscode.Range(position, new vscode.Position(document.lineCount, 0)));
        // Truncate context to keep completions fast and lightweight
        const maxContextLinesBefore = 60;
        const maxContextLinesAfter = 20;
        const linesBefore = textBefore.split('\n').slice(-maxContextLinesBefore).join('\n');
        const linesAfter = textAfter.split('\n').slice(0, maxContextLinesAfter).join('\n');
        return (0, fimPrompt_1.buildFimPrompt)(linesBefore, linesAfter, modelName);
    }
}
exports.OllamaInlineCompletionProvider = OllamaInlineCompletionProvider;
//# sourceMappingURL=inlineCompletionProvider.js.map