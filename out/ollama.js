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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaService = void 0;
const ollama_1 = require("ollama");
const cross_fetch_1 = __importDefault(require("cross-fetch"));
const vscode = __importStar(require("vscode"));
const perf_hooks_1 = require("perf_hooks");
const crypto = __importStar(require("crypto"));
const logger_1 = require("./utils/logger");
const lruCache_1 = require("./utils/lruCache");
class OllamaService {
    constructor() {
        this.embeddingCache = new lruCache_1.LruCache(2000, 24 * 60 * 60 * 1000);
        this.responseCache = new lruCache_1.LruCache(500, 60 * 60 * 1000);
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const host = config.get('ollamaHost', 'http://localhost:11434');
        this.ollama = new ollama_1.Ollama({
            host,
            fetch: cross_fetch_1.default,
        });
    }
    /**
     * NEW: Abort all active requests started by this Ollama client instance.
     * Use this on "Stop" button.
     */
    abort() {
        try {
            // ollama-js supports aborting all active requests for a client instance
            this.ollama.abort?.();
        }
        catch {
            // ignore
        }
    }
    // Helper: attach AbortSignal -> call ollama.abort()
    attachAbort(signal) {
        if (!signal)
            return;
        const handler = () => {
            try {
                this.abort();
            }
            catch {
                // ignore
            }
        };
        if (signal.aborted) {
            handler();
            return;
        }
        signal.addEventListener('abort', handler, { once: true });
        return () => signal.removeEventListener('abort', handler);
    }
    throwIfAborted(signal) {
        if (signal?.aborted) {
            const reason = signal?.reason;
            if (reason instanceof Error) {
                throw reason;
            }
            const err = new Error(reason ? String(reason) : 'Aborted');
            err.name = 'AbortError';
            throw err;
        }
    }
    getRequestTimeoutMs() {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const timeoutMs = config.get('requestTimeoutMs', 120000);
        return Math.max(0, timeoutMs);
    }
    withTimeout(signal, timeoutMs, options = {}) {
        if (!timeoutMs || timeoutMs <= 0) {
            return {
                signal,
                refresh: () => { },
                dispose: () => { }
            };
        }
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) {
                controller.abort();
            }
            else {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        }
        let timer;
        const refresh = () => {
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => {
                const timeoutError = new Error(`Timeout de inatividade (${timeoutMs}ms) atingido`);
                timeoutError.name = 'TimeoutError';
                try {
                    controller.abort?.(timeoutError);
                }
                catch {
                    controller.abort();
                }
                logger_1.Logger.warn(`Timeout de inatividade (${timeoutMs}ms) atingido.`);
            }, timeoutMs);
        };
        if (options.startOnCreate !== false) {
            refresh();
        }
        const dispose = () => {
            if (timer) {
                clearTimeout(timer);
            }
            if (signal)
                signal.removeEventListener('abort', onAbort);
        };
        return { signal: controller.signal, refresh, dispose };
    }
    cacheKey(kind, model, prompt, options = {}) {
        const payload = JSON.stringify({ kind, model, prompt, options });
        return crypto.createHash('sha256').update(payload).digest('hex');
    }
    // NOVO: Método para obter lista de modelos do Ollama
    async getAvailableModels() {
        const models = await this.listModels();
        if (models)
            return models;
        return [
            'qwen2.5-coder:1.5b-base',
            'qwen2.5-coder:7b',
            'codellama:7b-instruct-q5_K_M',
        ];
    }
    // NOVO: Lista de modelos sem fallback (retorna null se falhar)
    async listModels() {
        try {
            const response = await this.ollama.list();
            if (response && response.models) {
                return response.models.map((model) => model.name);
            }
            return [];
        }
        catch (error) {
            logger_1.Logger.error('Erro ao obter lista de modelos:', error);
            return null;
        }
    }
    // NOVO: Método para obter informações detalhadas dos modelos
    async getModelDetails() {
        try {
            const response = await this.ollama.list();
            if (response && response.models) {
                return response.models.map((model) => ({
                    name: model.name,
                    size: this.formatSize(model.size),
                    modified: new Date(model.modified_at).toLocaleDateString(),
                }));
            }
            return [];
        }
        catch (error) {
            logger_1.Logger.error('Erro ao obter detalhes dos modelos:', error);
            return [];
        }
    }
    // Método auxiliar para formatar tamanho
    formatSize(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (!bytes)
            return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
    }
    async generateCode(prompt, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const timeoutMs = this.getRequestTimeoutMs();
        const { signal, refresh, dispose } = this.withTimeout(opts.signal, timeoutMs, { startOnCreate: false });
        const detach = this.attachAbort(signal);
        try {
            this.throwIfAborted(signal);
            const t0 = perf_hooks_1.performance.now();
            const req = {
                model,
                prompt,
                stream: true,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: maxTokens,
                    num_ctx: contextSize,
                    repeat_penalty: 1.1,
                    top_k: 40,
                },
            };
            // If the library supports signal param, pass it (safe via any)
            if (signal)
                req.signal = signal;
            const response = await this.ollama.generate(req);
            let fullResponse = '';
            for await (const part of response) {
                this.throwIfAborted(signal);
                refresh();
                const chunk = typeof part?.response === 'string' ? part.response : '';
                if (chunk) {
                    fullResponse += chunk;
                }
            }
            const t1 = perf_hooks_1.performance.now();
            logger_1.Logger.debug(`Ollama gerou código em: ${(t1 - t0) / 1000} segundos`);
            return this.cleanCodeResponse(fullResponse);
        }
        catch (error) {
            logger_1.Logger.error('Erro ao comunicar com Ollama:', error);
            throw new Error(`Falha na comunicação com Ollama: ${error}`);
        }
        finally {
            detach?.();
            dispose();
        }
    }
    async *generateStream(prompt, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const timeoutMs = this.getRequestTimeoutMs();
        const { signal, refresh, dispose } = this.withTimeout(opts.signal, timeoutMs, { startOnCreate: false });
        const detach = this.attachAbort(signal);
        try {
            this.throwIfAborted(opts.signal);
            const req = {
                model,
                prompt,
                stream: true,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: maxTokens,
                    num_ctx: contextSize,
                    repeat_penalty: 1.1,
                    top_k: 40,
                },
            };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.generate(req);
            for await (const part of response) {
                this.throwIfAborted(signal);
                refresh();
                const chunk = typeof part?.response === 'string' ? part.response : '';
                if (chunk) {
                    yield chunk;
                }
            }
        }
        catch (error) {
            logger_1.Logger.error('Erro no stream do Ollama:', error);
            throw error;
        }
        finally {
            detach?.();
            dispose();
        }
    }
    async analyzeFile(filePath, instruction, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const chunkSize = config.get('chunkSize', 25000);
        const enablePartialCache = config.get('enablePartialResponseCache', true);
        const timeoutMs = this.getRequestTimeoutMs();
        let detach;
        let dispose;
        try {
            // Check abort BEFORE any async work, using opts.signal (not the timed signal)
            this.throwIfAborted(opts.signal);
            const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const content = Buffer.from(fileContent).toString('utf8');
            const maxSize = chunkSize * 2; // 50KB por padrão antes de fragmentar
            logger_1.Logger.debug(`Analisando arquivo de ${content.length} caracteres (limite: ${maxSize})`);
            if (content.length > maxSize) {
                return await this.analyzeFileInChunks(content, instruction, model, enablePartialCache, timeoutMs, opts.signal);
            }
            const fullPrompt = this.buildAnalysisPrompt(content, instruction);
            // Now create the timed signal for the actual request
            const timed = this.withTimeout(opts.signal, timeoutMs);
            const signal = timed.signal;
            dispose = timed.dispose;
            detach = this.attachAbort(signal);
            const req = {
                model,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    num_predict: maxTokens,
                    num_ctx: contextSize,
                    repeat_penalty: 1.15,
                    top_k: 30,
                },
            };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.generate(req);
            return this.cleanCodeResponse(response.response);
        }
        catch (error) {
            logger_1.Logger.error('Erro ao analisar arquivo:', error);
            throw error;
        }
        finally {
            detach?.();
            dispose?.();
        }
    }
    // NOVO: Análise de projeto completo
    async analyzeProject(projectPath, instruction, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const timeoutMs = this.getRequestTimeoutMs();
        let detach;
        let dispose;
        try {
            this.throwIfAborted(opts.signal);
            const repoMap = await this.createRepositoryMap(projectPath);
            this.throwIfAborted(opts.signal);
            const mainFiles = await this.identifyMainFiles(projectPath);
            this.throwIfAborted(opts.signal);
            const projectContext = await this.buildProjectContext(mainFiles, repoMap, instruction, opts);
            const timed = this.withTimeout(opts.signal, timeoutMs);
            const signal = timed.signal;
            dispose = timed.dispose;
            detach = this.attachAbort(signal);
            const req = {
                model,
                prompt: projectContext,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    num_predict: 12288,
                    num_ctx: 65536,
                    repeat_penalty: 1.15,
                },
            };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.generate(req);
            return response.response;
        }
        catch (error) {
            logger_1.Logger.error('Erro ao analisar projeto:', error);
            throw error;
        }
        finally {
            detach?.();
            dispose?.();
        }
    }
    // NOVO: Análise de múltiplos arquivos específicos
    async analyzeMultipleFiles(filePaths, instruction, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const enablePartialCache = config.get('enablePartialResponseCache', true);
        const timeoutMs = this.getRequestTimeoutMs();
        let detach;
        let dispose;
        try {
            this.throwIfAborted(opts.signal);
            const filesContent = [];
            let totalSize = 0;
            for (const filePath of filePaths) {
                this.throwIfAborted(opts.signal);
                try {
                    const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                    const content = Buffer.from(fileContent).toString('utf8');
                    filesContent.push({
                        path: vscode.workspace.asRelativePath(filePath),
                        content,
                    });
                    totalSize += content.length;
                }
                catch (error) {
                    logger_1.Logger.error(`Erro ao ler arquivo ${filePath}:`, error);
                }
            }
            if (totalSize > 30000) {
                return await this.analyzeMultipleFilesInChunks(filesContent, instruction, model, enablePartialCache, timeoutMs, opts.signal);
            }
            const multiFilePrompt = this.buildMultiFilePrompt(filesContent, instruction);
            const timed = this.withTimeout(opts.signal, timeoutMs);
            const signal = timed.signal;
            dispose = timed.dispose;
            detach = this.attachAbort(signal);
            const req = {
                model,
                prompt: multiFilePrompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    num_predict: 10240,
                    num_ctx: 65536,
                    repeat_penalty: 1.15,
                },
            };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.generate(req);
            return response.response;
        }
        catch (error) {
            logger_1.Logger.error('Erro ao analisar múltiplos arquivos:', error);
            throw error;
        }
        finally {
            detach?.();
            dispose?.();
        }
    }
    async analyzeFileInChunks(content, instruction, model, enablePartialCache, timeoutMs, signal) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const chunkSize = config.get('chunkSize', 25000);
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const chunks = this.splitIntoChunks(content, chunkSize);
        const results = [];
        logger_1.Logger.debug(`Fragmentando arquivo em ${chunks.length} partes de ~${chunkSize} caracteres cada`);
        for (let i = 0; i < chunks.length; i++) {
            this.throwIfAborted(signal);
            const chunkPrompt = this.buildChunkPrompt(chunks[i], instruction, i + 1, chunks.length);
            try {
                logger_1.Logger.debug(`Processando parte ${i + 1}/${chunks.length}...`);
                const cacheKey = enablePartialCache
                    ? this.cacheKey('analyze_chunk', model, chunkPrompt, { part: i + 1, total: chunks.length })
                    : '';
                if (enablePartialCache) {
                    const cached = this.responseCache.get(cacheKey);
                    if (cached) {
                        logger_1.Logger.debug(`Cache hit (parte ${i + 1}/${chunks.length})`);
                        results.push(`=== PARTE ${i + 1}/${chunks.length} ===\n${cached}`);
                        continue;
                    }
                }
                const timed = this.withTimeout(signal, timeoutMs);
                const requestSignal = timed.signal;
                const detach = this.attachAbort(requestSignal);
                try {
                    const req = {
                        model,
                        prompt: chunkPrompt,
                        stream: false,
                        options: {
                            temperature: 0.3,
                            top_p: 0.9,
                            num_predict: Math.floor(maxTokens * 0.75),
                            num_ctx: contextSize,
                            repeat_penalty: 1.15,
                        },
                    };
                    if (requestSignal)
                        req.signal = requestSignal;
                    const response = await this.ollama.generate(req);
                    const responseText = response.response;
                    if (enablePartialCache) {
                        this.responseCache.set(cacheKey, responseText);
                    }
                    results.push(`=== PARTE ${i + 1}/${chunks.length} ===\n${responseText}`);
                }
                finally {
                    detach?.();
                    timed.dispose();
                }
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            catch (error) {
                logger_1.Logger.error(`Erro na parte ${i + 1}:`, error);
                results.push(`=== ERRO NA PARTE ${i + 1} ===\nErro: ${error}`);
            }
        }
        this.throwIfAborted(signal);
        logger_1.Logger.debug('Consolidando análises...');
        const consolidatedPrompt = this.buildConsolidationPrompt(results.join('\n\n'), instruction);
        const finalTimed = this.withTimeout(signal, timeoutMs);
        const finalSignal = finalTimed.signal;
        const finalDetach = this.attachAbort(finalSignal);
        const finalReq = {
            model,
            prompt: consolidatedPrompt,
            stream: false,
            options: {
                temperature: 0.5,
                top_p: 0.9,
                num_predict: maxTokens,
                num_ctx: Math.min(contextSize * 2, 131072),
            },
        };
        if (finalSignal)
            finalReq.signal = finalSignal;
        try {
            const finalResponse = await this.ollama.generate(finalReq);
            return finalResponse.response;
        }
        finally {
            finalDetach?.();
            finalTimed.dispose();
        }
    }
    // Criar mapa do repositório
    async createRepositoryMap(_projectPath) {
        try {
            const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h}', '**/node_modules/**');
            const repoMap = [];
            repoMap.push('## REPOSITORY STRUCTURE');
            for (const file of files.slice(0, 50)) {
                const relativePath = vscode.workspace.asRelativePath(file);
                try {
                    const content = await vscode.workspace.fs.readFile(file);
                    const text = Buffer.from(content).toString('utf8');
                    const signatures = this.extractSignatures(text, relativePath);
                    if (signatures.length > 0) {
                        repoMap.push(`\n### ${relativePath}`);
                        repoMap.push(...signatures);
                    }
                }
                catch {
                    // ignore
                }
            }
            return repoMap.join('\n');
        }
        catch (error) {
            logger_1.Logger.error('Erro ao criar mapa do repositório:', error);
            return 'Erro ao mapear repositório';
        }
    }
    // Extrair assinaturas de código
    extractSignatures(content, _filePath) {
        const signatures = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.match(/^(export\s+)?(class|interface|function|const|let|var)\s+\w+/))
                signatures.push(`- ${line}`);
            else if (line.match(/^(class|def)\s+\w+/))
                signatures.push(`- ${line}`);
            else if (line.match(/^(public|private|protected|internal)\s+(class|interface|static|void|int|string)/))
                signatures.push(`- ${line}`);
        }
        return signatures.slice(0, 10);
    }
    // Identificar arquivos principais do projeto
    async identifyMainFiles(_projectPath) {
        const importantFiles = [];
        const configFiles = await vscode.workspace.findFiles('{package.json,tsconfig.json,*.config.js,main.py,app.py,index.ts,index.js,Program.cs}');
        for (const file of configFiles)
            importantFiles.push(file.fsPath);
        return importantFiles.slice(0, 5);
    }
    async buildProjectContext(mainFiles, repoMap, instruction, opts) {
        // Nota: seu código original só listava nomes; aqui mantive o formato mas também anexo conteúdo real
        const filesSection = [];
        filesSection.push('## MAIN FILES CONTENT');
        for (let i = 0; i < mainFiles.length; i++) {
            this.throwIfAborted(opts.signal);
            const fp = mainFiles[i];
            let content = '';
            try {
                const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(fp));
                content = Buffer.from(buf).toString('utf8');
            }
            catch {
                content = '(não foi possível ler o arquivo)';
            }
            filesSection.push(`### File ${i + 1}: ${vscode.workspace.asRelativePath(fp)}`);
            filesSection.push('```');
            filesSection.push(content);
            filesSection.push('```');
            filesSection.push('');
        }
        return `[INST] PROJECT ANALYSIS

Instruction: ${instruction}

${repoMap}

${filesSection.join('\n')}

Please analyze this project structure and provide insights based on the instruction. [/INST]`;
    }
    buildMultiFilePrompt(filesContent, instruction) {
        const filesSection = filesContent
            .map((file, index) => `### File ${index + 1}: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
            .join('\n\n');
        return `[INST] MULTI-FILE ANALYSIS

Instruction: ${instruction}

Files to analyze:
${filesSection}

Please analyze these files together and provide insights based on the instruction. [/INST]`;
    }
    async analyzeMultipleFilesInChunks(filesContent, instruction, model, enablePartialCache, timeoutMs, signal) {
        const results = [];
        for (let i = 0; i < filesContent.length; i++) {
            this.throwIfAborted(signal);
            const file = filesContent[i];
            const prompt = `[INST] Analyzing file ${i + 1}/${filesContent.length}: ${file.path}

Instruction: ${instruction}

Content:
\`\`\`
${file.content}
\`\`\`

Analyze this file in context of multi-file analysis: [/INST]`;
            try {
                const cacheKey = enablePartialCache
                    ? this.cacheKey('analyze_multifile', model, prompt, { index: i + 1, total: filesContent.length })
                    : '';
                if (enablePartialCache) {
                    const cached = this.responseCache.get(cacheKey);
                    if (cached) {
                        logger_1.Logger.debug(`Cache hit (arquivo ${i + 1}/${filesContent.length})`);
                        results.push(`## ${file.path}\n${cached}`);
                        continue;
                    }
                }
                const timed = this.withTimeout(signal, timeoutMs);
                const requestSignal = timed.signal;
                const detach = this.attachAbort(requestSignal);
                try {
                    const req = {
                        model,
                        prompt,
                        stream: false,
                        options: {
                            temperature: 0.3,
                            top_p: 0.9,
                            num_predict: 4096,
                            num_ctx: 32768,
                        },
                    };
                    if (requestSignal)
                        req.signal = requestSignal;
                    const response = await this.ollama.generate(req);
                    const responseText = response.response;
                    if (enablePartialCache) {
                        this.responseCache.set(cacheKey, responseText);
                    }
                    results.push(`## ${file.path}\n${responseText}`);
                }
                finally {
                    detach?.();
                    timed.dispose();
                }
            }
            catch (error) {
                results.push(`## ${file.path}\nERRO: ${error}`);
            }
        }
        this.throwIfAborted(signal);
        const consolidationPrompt = `[INST] CONSOLIDATION OF MULTI-FILE ANALYSIS

Original instruction: ${instruction}

Individual file analyses:
${results.join('\n\n')}

Provide a unified analysis considering all files together: [/INST]`;
        const finalTimed = this.withTimeout(signal, timeoutMs);
        const finalSignal = finalTimed.signal;
        const finalDetach = this.attachAbort(finalSignal);
        const finalReq = {
            model,
            prompt: consolidationPrompt,
            stream: false,
            options: {
                temperature: 0.5,
                num_predict: 8192,
                num_ctx: 65536,
            },
        };
        if (finalSignal)
            finalReq.signal = finalSignal;
        try {
            const finalResponse = await this.ollama.generate(finalReq);
            return finalResponse.response;
        }
        finally {
            finalDetach?.();
            finalTimed.dispose();
        }
    }
    splitIntoChunks(content, chunkSize) {
        const chunks = [];
        const lines = content.split('\n');
        let currentChunk = '';
        for (const line of lines) {
            const newChunk = currentChunk + line + '\n';
            if (newChunk.length > chunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = line + '\n';
            }
            else {
                currentChunk = newChunk;
            }
        }
        if (currentChunk.length > 0)
            chunks.push(currentChunk);
        return chunks;
    }
    isStructuralLine(line) {
        const trimmed = line.trim();
        return (trimmed.startsWith('class ') ||
            trimmed.startsWith('function ') ||
            trimmed.startsWith('def ') ||
            trimmed.startsWith('public ') ||
            trimmed.startsWith('private ') ||
            trimmed.startsWith('protected ') ||
            trimmed.includes('function(') ||
            trimmed.includes(') {'));
    }
    buildAnalysisPrompt(content, instruction) {
        return `[INST] You are an expert programmer analyzing code. Task: ${instruction}

Code to analyze:
${content}

Please provide:
1. Detailed analysis based on the specific instruction
2. Identify patterns, issues, and opportunities
3. Specific actionable recommendations
4. Code improvements if applicable

Focus on the instruction: "${instruction}" [/INST]`;
    }
    buildChunkPrompt(chunk, instruction, partNum, totalParts) {
        return `[INST] LARGE FILE ANALYSIS - PART ${partNum} of ${totalParts}

Main instruction: ${instruction}

Code fragment to analyze:
${chunk}

Note: This is part ${partNum} of ${totalParts} of a larger file. Focus on this fragment while considering it may have dependencies elsewhere.

Provide analysis for this specific part: [/INST]`;
    }
    buildConsolidationPrompt(allResults, instruction) {
        return `[INST] CONSOLIDATION OF LARGE FILE ANALYSIS

Original instruction: ${instruction}

Analysis results from all parts:
${allResults}

Please provide:
1. Unified analysis consolidating all parts
2. Global patterns identified across the entire file
3. Overall recommendations prioritized by impact
4. Summary of key findings

Create a comprehensive final analysis: [/INST]`;
    }
    cleanCodeResponse(response) {
        let cleaned = response.trim();
        const lines = cleaned.split('\n');
        const filteredLines = lines.filter(line => {
            const trimmed = line.trim();
            return (trimmed.length > 0 &&
                !trimmed.startsWith('Aqui está') &&
                !trimmed.startsWith('Este código') &&
                !trimmed.startsWith('O código acima') &&
                !trimmed.startsWith('Explicação:') &&
                !trimmed.startsWith('Como funciona:'));
        });
        return filteredLines.join('\n').trim();
    }
    /**
     * STREAM CHAT (supports AbortSignal)
     */
    async *chatStream(message, history = [], opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const timeoutMs = this.getRequestTimeoutMs();
        const { signal, refresh, dispose } = this.withTimeout(opts.signal, timeoutMs, { startOnCreate: false });
        const detach = this.attachAbort(signal);
        const messages = [...history, { role: 'user', content: message }];
        try {
            this.throwIfAborted(signal);
            const req = {
                model,
                messages,
                stream: true,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: maxTokens,
                    num_ctx: contextSize,
                    repeat_penalty: 1.1,
                },
            };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.chat(req);
            for await (const part of response) {
                this.throwIfAborted(signal);
                refresh();
                const chunk = typeof part?.message?.content === 'string' ? part.message.content : '';
                if (chunk) {
                    yield chunk;
                }
            }
        }
        catch (error) {
            logger_1.Logger.error('Erro no stream do chat Ollama:', error);
            throw error;
        }
        finally {
            detach?.();
            dispose();
        }
    }
    /**
     * Chat with aggregated stream chunks (supports AbortSignal).
     * Timeout is evaluated by inactivity between chunks.
     */
    async chat(messages, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const timeoutMs = this.getRequestTimeoutMs();
        const { signal, refresh, dispose } = this.withTimeout(opts.signal, timeoutMs, { startOnCreate: false });
        const detach = this.attachAbort(signal);
        try {
            this.throwIfAborted(signal);
            const req = {
                model,
                messages,
                stream: true,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: maxTokens,
                    num_ctx: contextSize,
                    repeat_penalty: 1.1,
                },
            };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.chat(req);
            let fullResponse = '';
            for await (const part of response) {
                this.throwIfAborted(signal);
                refresh();
                const chunk = typeof part?.message?.content === 'string' ? part.message.content : '';
                if (chunk) {
                    fullResponse += chunk;
                }
            }
            return fullResponse;
        }
        catch (error) {
            logger_1.Logger.error('Erro no chat raw do Ollama:', error);
            throw error;
        }
        finally {
            detach?.();
            dispose();
        }
    }
    // Mantido por compatibilidade com seu código antigo
    async chatWithOllama(message, history = [], opts = {}) {
        const messages = [...history, { role: 'user', content: message }];
        return await this.chat(messages, opts);
    }
    async testConnection() {
        try {
            await this.ollama.list();
            return true;
        }
        catch (error) {
            logger_1.Logger.error('Erro ao testar conexão:', error);
            return false;
        }
    }
    // Método para verificar limites do modelo
    async getModelInfo() {
        try {
            const config = vscode.workspace.getConfiguration('ollama-code-diff');
            const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
            return {
                model,
                maxContext: 32768,
                recommendedChunkSize: 25000,
                maxFileSize: 50000,
            };
        }
        catch (error) {
            logger_1.Logger.error('Erro ao obter info do modelo:', error);
            return null;
        }
    }
    async generateCompletion(prompt, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('completionModelName', config.get('modelName', 'qwen2.5-coder:1.5b-base'));
        const timeoutMs = this.getRequestTimeoutMs();
        const { signal, dispose } = this.withTimeout(opts.signal, timeoutMs);
        const detach = this.attachAbort(signal);
        try {
            this.throwIfAborted(signal);
            const req = {
                model,
                prompt,
                stream: false,
                options: {
                    temperature: 0.2,
                    top_p: 0.9,
                    num_predict: 50,
                    num_ctx: 1024,
                    stop: ['<EOT>', '\n\n', '```'],
                },
            };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.generate(req);
            return response.response;
        }
        catch (error) {
            logger_1.Logger.warn('Falha no autocompletar:', error);
            return '';
        }
        finally {
            detach?.();
            dispose();
        }
    }
    async generateEmbeddings(prompt, opts = {}) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('embeddingModelName', 'nomic-embed-text');
        const enableEmbeddingCache = config.get('enableEmbeddingCache', true);
        const timeoutMs = this.getRequestTimeoutMs();
        const { signal, dispose } = this.withTimeout(opts.signal, timeoutMs);
        const detach = this.attachAbort(signal);
        try {
            this.throwIfAborted(signal);
            const cacheKey = enableEmbeddingCache
                ? this.cacheKey('embedding', model, prompt)
                : '';
            if (enableEmbeddingCache) {
                const cached = this.embeddingCache.get(cacheKey);
                if (cached) {
                    logger_1.Logger.debug('Embedding cache hit');
                    return cached;
                }
            }
            const req = { model, prompt };
            if (signal)
                req.signal = signal;
            const response = await this.ollama.embeddings(req);
            const embedding = response.embedding;
            if (enableEmbeddingCache) {
                this.embeddingCache.set(cacheKey, embedding);
            }
            return embedding;
        }
        catch (error) {
            logger_1.Logger.error('Erro ao gerar embeddings:', error);
            throw error;
        }
        finally {
            detach?.();
            dispose();
        }
    }
}
exports.OllamaService = OllamaService;
//# sourceMappingURL=ollama.js.map