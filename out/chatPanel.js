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
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const historyManager_1 = require("./historyManager");
const logger_1 = require("./utils/logger");
const agentToolCallParser_1 = require("./utils/agentToolCallParser");
const contextWindow_1 = require("./utils/contextWindow");
const terminalCommand_1 = require("./utils/terminalCommand");
const unifiedDiff_1 = require("./utils/unifiedDiff");
class ChatPanel {
    constructor(extensionUri, ollamaService, diffManager, ragService, context) {
        this.extensionUri = extensionUri;
        this.ollamaService = ollamaService;
        this.diffManager = diffManager;
        this.ragService = ragService;
        this.chatHistory = [];
        this.currentMode = 'chat';
        this.pinnedFiles = new Set();
        this.historyManager = new historyManager_1.HistoryManager(context);
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        webviewView.onDidDispose(() => {
            try {
                this.currentAbort?.abort();
            }
            catch {
                // ignore
            }
            try {
                this.ollamaService.abort();
            }
            catch {
                // ignore
            }
            this.currentAbort = undefined;
        });
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'sendMessage': {
                    const userMessage = message.text;
                    const mode = message.mode;
                    this.chatHistory.push({ role: 'user', content: userMessage });
                    this.view?.webview.postMessage({ type: 'addMessage', sender: 'user', text: userMessage });
                    if (mode === 'agent')
                        await this.handleAgentMessage(userMessage);
                    else if (mode === 'edit')
                        await this.handleEditMessage(userMessage);
                    else
                        await this.handleChatMessage(userMessage);
                    break;
                }
                case 'cancelGeneration': {
                    // 1) abort local controller (para interromper loops e sinalizar cancelamento)
                    try {
                        this.currentAbort?.abort();
                    }
                    catch {
                        // ignore
                    }
                    // 2) abort no cliente ollama-js (interrompe request/stream de verdade)
                    try {
                        this.ollamaService.abort();
                    }
                    catch {
                        // ignore
                    }
                    this.view?.webview.postMessage({ type: 'generationCancelled' });
                    break;
                }
                case 'requestModels':
                    await this.requestModels();
                    break;
                case 'setSelectedModel':
                    await this.setSelectedModel(message.modelName);
                    break;
                case 'requestCurrentModel':
                    await this.requestCurrentModel();
                    break;
                case 'requestFiles': {
                    const files = await this.getWorkspaceFiles();
                    this.view?.webview.postMessage({ type: 'fileList', files });
                    break;
                }
                case 'pinFile':
                    this.addPinnedFile(message.filePath);
                    break;
                case 'unpinFile':
                    this.removePinnedFile(message.filePath);
                    break;
                case 'requestPinFile':
                    await this.handlePinFileRequest();
                    break;
                case 'openSettings':
                    await vscode.commands.executeCommand('ollama-code-diff.showConfigurationMenu');
                    break;
                case 'changeMode':
                    this.currentMode = message.mode;
                    vscode.window.showInformationMessage(`Modo alterado para: ${this.currentMode}`);
                    break;
                case 'newChat':
                    await this.startNewChat();
                    break;
                case 'requestHistory':
                    await this.sendHistoryList();
                    break;
                case 'loadSession':
                    await this.loadSession(message.sessionId);
                    break;
                case 'deleteSession':
                    await this.deleteSession(message.sessionId);
                    break;
            }
        });
        this.initializeSession();
    }
    async initializeSession() {
        const sessions = this.historyManager.getSessions();
        if (sessions.length > 0)
            await this.loadSession(sessions[0].id);
        else
            await this.startNewChat();
    }
    async startNewChat() {
        const session = await this.historyManager.createSession();
        this.currentSessionId = session.id;
        this.chatHistory = [];
        this.view?.webview.postMessage({ type: 'clearChat' });
        this.view?.webview.postMessage({ type: 'updateSessionId', sessionId: session.id });
    }
    async loadSession(sessionId) {
        const session = this.historyManager.getSession(sessionId);
        if (!session)
            return;
        this.currentSessionId = session.id;
        this.chatHistory = session.messages.map(m => ({ role: m.role, content: m.content }));
        this.view?.webview.postMessage({ type: 'clearChat' });
        session.messages.forEach(m => {
            this.view?.webview.postMessage({
                type: 'addMessage',
                sender: m.role === 'user' ? 'user' : 'ollama',
                text: m.content
            });
        });
        this.view?.webview.postMessage({ type: 'updateSessionId', sessionId: session.id });
    }
    async deleteSession(sessionId) {
        await this.historyManager.deleteSession(sessionId);
        await this.sendHistoryList();
        if (this.currentSessionId === sessionId)
            await this.startNewChat();
    }
    async sendHistoryList() {
        const sessions = this.historyManager.getSessions();
        this.view?.webview.postMessage({ type: 'historyList', sessions });
    }
    async saveCurrentSession() {
        if (!this.currentSessionId)
            return;
        const session = this.historyManager.getSession(this.currentSessionId);
        if (!session)
            return;
        session.messages = this.chatHistory.map(m => ({
            role: m.role,
            content: m.content,
            timestamp: Date.now()
        }));
        session.lastModified = Date.now();
        if (session.title === 'New Chat' && this.chatHistory.length > 0) {
            await this.historyManager.updateSessionTitle(session);
        }
        await this.historyManager.saveSession(session);
    }
    startGenerationUI(title, subtitle) {
        this.view?.webview.postMessage({ type: 'generationStart', title, subtitle });
    }
    updateGenerationUI(subtitle) {
        this.view?.webview.postMessage({ type: 'generationStatus', subtitle });
    }
    endGenerationUI() {
        this.view?.webview.postMessage({ type: 'generationEnd' });
    }
    resetAbortController() {
        // Cancela qualquer geração anterior
        try {
            this.currentAbort?.abort();
        }
        catch {
            // ignore
        }
        try {
            this.ollamaService.abort();
        }
        catch {
            // ignore
        }
        this.currentAbort = new AbortController();
        return this.currentAbort;
    }
    isAbortError(err) {
        if (!err)
            return false;
        const anyErr = err;
        return anyErr?.name === 'AbortError' || /aborted/i.test(String(anyErr?.message || ''));
    }
    isTimeoutError(err) {
        if (!err)
            return false;
        const anyErr = err;
        return anyErr?.name === 'TimeoutError' || /timeout/i.test(String(anyErr?.message || ''));
    }
    async handleChatMessage(userMessage) {
        if (!this.view)
            return;
        const abort = this.resetAbortController();
        this.startGenerationUI('Processando…', 'Resolvendo contexto…');
        try {
            await this.saveCurrentSession();
            // placeholder para stream
            this.view.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: '' });
            let messageWithContext = await this.resolveMessageContext(userMessage);
            // Slash Commands
            if (userMessage.startsWith('/')) {
                const command = userMessage.split(' ')[0];
                const rest = userMessage.substring(command.length).trim();
                const editor = vscode.window.activeTextEditor;
                let selection = '';
                if (editor && !editor.selection.isEmpty)
                    selection = editor.document.getText(editor.selection);
                messageWithContext += `\n\n--- CÓDIGO SELECIONADO ---\n\`\`\`${editor?.document.languageId || ''}\n${selection}\n\`\`\`\n`;
                switch (command) {
                    case '/explain':
                        messageWithContext = `Explique o código abaixo detalhadamente.\n${selection}\n${rest || ''}`;
                        break;
                    case '/fix':
                        messageWithContext = `Identifique problemas e proponha correções para o código abaixo.\n${selection}\n${rest || ''}`;
                        break;
                    case '/test':
                        messageWithContext = `Gere testes unitários para o código abaixo.\n${selection}\n${rest || ''}`;
                        break;
                    case '/refactor':
                        messageWithContext = `Refatore o código abaixo para melhorar legibilidade e performance.\n${selection}\n${rest || ''}`;
                        break;
                }
            }
            this.updateGenerationUI('Gerando resposta (stream)…');
            let fullResponse = '';
            for await (const part of this.ollamaService.chatStream(messageWithContext, this.chatHistory, { signal: abort.signal })) {
                fullResponse += part;
                this.view.webview.postMessage({ type: 'updateLastMessage', sender: 'ollama', text: fullResponse });
            }
            this.chatHistory.push({ role: 'assistant', content: fullResponse });
            await this.saveCurrentSession();
        }
        catch (error) {
            if (this.isTimeoutError(error)) {
                this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: 'Tempo limite atingido.' });
            }
            else if (this.isAbortError(error)) {
                this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: 'Geração cancelada.' });
            }
            else {
                const errorMessage = `Erro: ${error instanceof Error ? error.message : String(error)}`;
                this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: errorMessage });
                vscode.window.showErrorMessage(`Erro no chat: ${errorMessage}`);
            }
        }
        finally {
            this.endGenerationUI();
            this.currentAbort = undefined;
        }
    }
    async handleEditMessage(userMessage) {
        if (!this.view)
            return;
        const abort = this.resetAbortController();
        this.startGenerationUI('Edit Mode...', 'Preparando contexto para patch...');
        try {
            await this.saveCurrentSession();
            this.view.webview.postMessage({
                type: 'addMessage',
                sender: 'ollama',
                text: 'Gerando patch aplicavel em formato unified diff...'
            });
            const messageWithContext = await this.resolveMessageContext(userMessage);
            const patchPrompt = this.buildEditPatchPrompt(messageWithContext);
            this.updateGenerationUI('Gerando patch unified diff...');
            const rawModelResponse = await this.ollamaService.generateCode(patchPrompt, { signal: abort.signal });
            const diffContent = this.extractUnifiedDiffContent(rawModelResponse);
            if (diffContent === '') {
                const noChangeMessage = 'Nenhuma mudanca necessaria para a instrucao informada.';
                this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: noChangeMessage });
                this.chatHistory.push({ role: 'assistant', content: noChangeMessage });
                await this.saveCurrentSession();
                return;
            }
            if (!diffContent) {
                throw new Error('Nao foi possivel extrair um unified diff da resposta do modelo.');
            }
            try {
                (0, unifiedDiff_1.parseUnifiedDiff)(diffContent);
            }
            catch (error) {
                throw new Error(`Patch gerado invalido: ${error instanceof Error ? error.message : String(error)}`);
            }
            this.updateGenerationUI('Abrindo preview e aplicando patch...');
            const applyResult = await this.diffManager.previewAndApplyUnifiedDiff(diffContent, 'Patch do Modo Edit');
            const assistantMessage = applyResult.applied
                ? `Patch gerado e aplicado (${applyResult.changedFiles} arquivo(s)).\n${applyResult.message}`
                : `Patch gerado, mas nao aplicado.\n${applyResult.message}`;
            this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: assistantMessage });
            this.chatHistory.push({ role: 'assistant', content: assistantMessage });
            await this.saveCurrentSession();
        }
        catch (error) {
            if (this.isTimeoutError(error)) {
                this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: 'Tempo limite atingido.' });
            }
            else if (this.isAbortError(error)) {
                this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: 'Geracao cancelada.' });
            }
            else {
                const errorMessage = `Erro no modo Edit: ${error instanceof Error ? error.message : String(error)}`;
                this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: errorMessage });
                vscode.window.showErrorMessage(errorMessage);
            }
        }
        finally {
            this.endGenerationUI();
            this.currentAbort = undefined;
        }
    }
    async handleAgentMessage(userMessage) {
        if (!this.view)
            return;
        const abort = this.resetAbortController();
        this.startGenerationUI('Agent Mode…', 'Resolvendo contexto…');
        const maxSteps = 15;
        let currentStep = 0;
        let shouldContinue = true;
        const messageWithContext = await this.resolveMessageContext(userMessage);
        const toolsDescription = `You are an autonomous AI agent capable of using tools to solve complex tasks.
You must follow a Thought-Plan-Action cycle:
1. Thought: Analyze the current state and what needs to be done.
2. Plan: Outline the next step.
3. Action: Choose exactly one tool call in JSON.

AVAILABLE TOOLS:
- run: Execute shell commands after user confirmation. args: { "command": "npm test" }. Returns stdout/stderr/exit code.
- read: Read file content. args: { "filePath": "src/app.ts" }
- write: Write/create file. args: { "filePath": "new.ts", "content": "..." }
- editcode: Edit code in active editor or file selection with AI. args: { "instruction": "..." }
- listfiles: List directory contents. args: { "directoryPath": "." }
- findfile: Find files by pattern. args: { "pattern": "**/*.test.ts" }
- searchtext: Search text using git grep. args: { "query": "SearchTerm" }
- searchsemantic: Semantic search (RAG). args: { "query": "How is X implemented?" }
- openfile: Open file in editor. args: { "filePath": "path/to/file" }
- applydiff: Apply unified diff with preview/undo. args: { "diffContent": "diff --git ..." }

LSP TOOLS (semantic editor operations):
- lsprename: Rename symbol using language server. args: { "newName": "nextName", "filePath": "src/file.ts", "line": 12, "character": 5 }
- lsporganizeimports: Organize imports in target file. args: { "filePath": "src/file.ts" }
- lspcodeactions: List or apply code actions from language server.
  args: { "filePath": "src/file.ts", "kind": "quickfix", "startLine": 10, "startCharacter": 0, "endLine": 10, "endCharacter": 20, "apply": true, "titleContains": "Add missing import", "index": 0 }
- lspquickfix: Apply preferred quick fix for a range/cursor. args: { "filePath": "src/file.ts", "startLine": 10, "startCharacter": 0, "endLine": 10, "endCharacter": 20, "titleContains": "..." }

RESPONSE FORMAT:
Thought: ...
Plan: ...
Action:
\`\`\`json
{ "tool": "toolname", "args": { ... } }
\`\`\`

IMPORTANT:
- Use only one tool per turn.
- Always include valid JSON for the tool call.
- Use workspace-relative file paths.
When the task is complete, respond with:
Thought: I have completed the task.
Final Answer: ...`;
        const systemPrompt = { role: 'system', content: toolsDescription };
        let runHistory = [
            systemPrompt,
            ...this.chatHistory.map(m => ({ role: m.role, content: m.content }))
        ];
        if (runHistory.length > 1 && runHistory[runHistory.length - 1].role === 'user') {
            runHistory[runHistory.length - 1] = { role: 'user', content: messageWithContext };
        }
        let agentSteps = [];
        const updateProcessUI = (label, status = 'loading', details) => {
            const existingStep = agentSteps.find(s => s.label === label);
            if (existingStep) {
                existingStep.status = status;
                if (details)
                    existingStep.details = details;
            }
            else {
                agentSteps.push({ id: agentSteps.length + 1, label, status, details });
            }
            this.view?.webview.postMessage({
                type: 'updateLastMessage',
                sender: 'ollama',
                text: { type: 'agentProcess', steps: agentSteps }
            });
        };
        try {
            this.view.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: { type: 'agentProcess', steps: [] } });
            updateProcessUI('Analisando solicitação…', 'loading');
            while (shouldContinue && currentStep < maxSteps) {
                if (abort.signal.aborted)
                    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
                currentStep++;
                this.updateGenerationUI(`Agent step ${currentStep}/${maxSteps}…`);
                // 1) Get LLM response
                const ollamaResponse = await this.ollamaService.chat(runHistory, { signal: abort.signal });
                // 2) Parse Thought/Plan and JSON tool call
                const parsedResponse = (0, agentToolCallParser_1.parseAgentToolCall)(ollamaResponse);
                const isToolCall = parsedResponse !== null;
                const thoughtMatch = ollamaResponse.match(/Thought:([\s\S]*?)Plan:|Thought:([\s\S]*?)Action:/i);
                const planMatch = ollamaResponse.match(/Plan:([\s\S]*?)Action:/i);
                if (thoughtMatch) {
                    const thought = String(thoughtMatch[1] || thoughtMatch[2] || '').trim();
                    updateProcessUI('Pensando…', 'done', thought.substring(0, 100) + (thought.length > 100 ? '…' : ''));
                }
                if (planMatch) {
                    const plan = String(planMatch[1] || '').trim();
                    if (plan) {
                        updateProcessUI('Planejando…', 'done', plan.substring(0, 100) + (plan.length > 100 ? '…' : ''));
                    }
                }
                if (isToolCall && parsedResponse) {
                    updateProcessUI(`Usando ferramenta: ${parsedResponse.tool}`, 'loading');
                    // 3) Execute tool
                    const toolResult = await this.executeTool(parsedResponse.tool, parsedResponse.args);
                    updateProcessUI(`Usando ferramenta: ${parsedResponse.tool}`, 'done', `Resultado: ${toolResult.substring(0, 50)}…`);
                    // 4) Update history
                    runHistory.push({ role: 'assistant', content: ollamaResponse });
                    runHistory.push({
                        role: 'user',
                        content: `Tool Output (${parsedResponse.tool}):\n${toolResult}\n\nContinue with your Thought-Plan-Action cycle.`
                    });
                    // prune
                    if (runHistory.length > 20) {
                        runHistory = [systemPrompt, ...runHistory.slice(-10)];
                    }
                }
                else {
                    shouldContinue = false;
                    updateProcessUI('Tarefa concluída', 'done');
                    const finalAnswerMatch = ollamaResponse.match(/Final Answer:([\s\S]*)/i);
                    const finalResponse = finalAnswerMatch ? finalAnswerMatch[1].trim() : ollamaResponse;
                    this.view.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: finalResponse });
                    this.chatHistory.push({ role: 'assistant', content: finalResponse });
                    await this.saveCurrentSession();
                }
            }
            if (currentStep >= maxSteps)
                updateProcessUI('Limite de passos atingido', 'error');
        }
        catch (error) {
            if (this.isTimeoutError(error)) {
                this.view.webview.postMessage({ type: 'addMessage', sender: 'system', text: 'Tempo limite atingido.' });
            }
            else if (this.isAbortError(error)) {
                this.view.webview.postMessage({ type: 'addMessage', sender: 'system', text: 'Geração cancelada.' });
            }
            else {
                updateProcessUI('Erro no agente', 'error', String(error));
                this.view.webview.postMessage({ type: 'addMessage', sender: 'system', text: `Agent Error: ${String(error)}` });
            }
        }
        finally {
            this.endGenerationUI();
            this.currentAbort = undefined;
        }
    }
    async executeTool(tool, args) {
        const normalizedTool = String(tool || '').toLowerCase().trim();
        const safeArgs = (typeof args === 'object' && args !== null) ? args : {};
        switch (normalizedTool) {
            case 'run':
                return await this.runCommand(safeArgs.command);
            case 'read':
                return await this.readFile(safeArgs.filePath);
            case 'write':
                return await this.writeFile(safeArgs.filePath, safeArgs.content);
            case 'generatecode':
                return await this.generateCode(safeArgs.prompt);
            case 'editcode':
                return await this.editCode(safeArgs.instruction);
            case 'analyzefile':
                return await this.analyzeFile(safeArgs.filePath, safeArgs.instruction);
            case 'listfiles':
                return await this.listFiles(safeArgs.directoryPath);
            case 'executevscodecommand':
                return await this.executeVscodeCommand(safeArgs.command, safeArgs.args);
            case 'openfile':
                return await this.openFile(safeArgs.filePath);
            case 'applycodechanges':
                return await this.applyCodeChanges(safeArgs.newCode, safeArgs.startLine, safeArgs.startCharacter, safeArgs.endLine, safeArgs.endCharacter);
            case 'applydiff':
                return await this.applyDiff(safeArgs.diffContent);
            case 'findfile':
                return await this.findFile(safeArgs.pattern);
            case 'savefile':
                return await this.saveFile();
            case 'closefile':
                return await this.closeFile();
            case 'getselectedtext':
                return await this.getSelectedText();
            case 'searchtext':
                return await this.searchText(safeArgs.query);
            case 'searchsemantic':
                return await this.searchSemantic(safeArgs.query);
            case 'lsprename':
                return await this.lspRename(safeArgs);
            case 'lsporganizeimports':
                return await this.lspOrganizeImports(safeArgs);
            case 'lspcodeactions':
                return await this.lspCodeActions(safeArgs);
            case 'lspquickfix':
                return await this.lspQuickFix(safeArgs);
            default:
                logger_1.Logger.error('Ferramenta desconhecida:', normalizedTool);
                return `Ferramenta desconhecida: ${normalizedTool}`;
        }
    }
    async runCommand(commandValue) {
        const command = this.asNonEmptyString(commandValue);
        if (!command)
            return 'Por favor, forneca um comando para executar.';
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
            return 'Nenhum workspace aberto para executar o comando.';
        const cwd = workspaceFolder.uri.fsPath;
        const confirmationEnabled = vscode.workspace
            .getConfiguration('ollama-code-diff')
            .get('requireTerminalCommandConfirmation', true);
        if (confirmationEnabled) {
            const action = await vscode.window.showWarningMessage('O Agent quer executar um comando de terminal.', {
                modal: true,
                detail: `Comando: ${command}\nDiretorio: ${cwd}\nA saida sera anexada ao contexto do Agent.`
            }, 'Executar', 'Cancelar');
            if (action !== 'Executar') {
                this.view?.webview.postMessage({
                    type: 'addMessage',
                    sender: 'system',
                    text: `Execucao cancelada para: ${command}`
                });
                return (0, terminalCommand_1.formatTerminalCommandForContext)({
                    command,
                    cwd,
                    status: 'cancelled',
                    exitCode: null,
                    durationMs: 0
                });
            }
        }
        logger_1.Logger.info(`[Agent/run] Executando comando: ${command}`);
        this.view?.webview.postMessage({ type: 'addMessage', sender: 'system', text: `Executando: ${command}...` });
        const startedAt = Date.now();
        return new Promise((resolve) => {
            (0, child_process_1.exec)(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                const execError = error;
                const rawExitCode = execError?.code;
                const exitCode = typeof rawExitCode === 'number' ? rawExitCode : null;
                const durationMs = Date.now() - startedAt;
                if (execError) {
                    logger_1.Logger.warn(`[Agent/run] Comando falhou: ${command}`, execError);
                }
                else {
                    logger_1.Logger.debug(`[Agent/run] Comando concluido em ${durationMs}ms: ${command}`);
                }
                resolve((0, terminalCommand_1.formatTerminalCommandForContext)({
                    command,
                    cwd,
                    status: execError ? 'failed' : 'completed',
                    exitCode: execError ? (exitCode ?? 1) : 0,
                    durationMs,
                    stdout: stdout || '',
                    stderr: stderr || '',
                    errorMessage: execError?.message
                }));
            });
        });
    }
    async readFile(filePath) {
        if (!filePath)
            return 'Por favor, forneca um caminho de arquivo para ler.';
        if (!vscode.workspace.workspaceFolders)
            return 'Nenhum workspace aberto.';
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const absolutePath = path.resolve(workspaceRoot, filePath);
        if (!this.isPathInsideRoot(workspaceRoot, absolutePath)) {
            return `Caminho fora do workspace: ${filePath}`;
        }
        try {
            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            const { chunkSizeChars, readTokenBudget } = this.getContextWindowConfig();
            const chunked = (0, contextWindow_1.chunkTextForTokenBudget)(fileContent, {
                chunkSizeChars,
                maxTokens: readTokenBudget
            });
            if (chunked.includedChunkCount === 0) {
                return `Conteudo de ${filePath} nao pode ser exibido no budget atual de contexto.`;
            }
            const renderedContent = this.renderChunkedContent(chunked);
            const summary = chunked.truncated
                ? `Conteudo de ${filePath} (~${chunked.usedTokens}/${chunked.estimatedTotalTokens} tokens, ${chunked.includedChunkCount}/${chunked.totalChunkCount} chunks):`
                : `Conteudo de ${filePath}:`;
            const truncationNote = chunked.truncated
                ? '\n\n...[arquivo truncado para respeitar o limite de contexto]'
                : '';
            return `${summary}\n\n${renderedContent}${truncationNote}`;
        }
        catch (error) {
            return `Erro ao ler arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async writeFile(filePath, content) {
        if (!filePath || content === undefined)
            return 'Uso: write <caminho-do-arquivo> <conteúdo>.';
        if (!vscode.workspace.workspaceFolders)
            return 'Nenhum workspace aberto.';
        const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
        try {
            await fs.promises.writeFile(absolutePath, content, 'utf8');
            return `Conteúdo escrito em ${filePath}.`;
        }
        catch (error) {
            return `Erro ao escrever no arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async generateCode(prompt) {
        if (!prompt)
            return 'Por favor, forneça um prompt para gerar código.';
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return 'Nenhum editor ativo encontrado.';
        try {
            this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Gerando código…' });
            const fullPrompt = this.buildGeneratePrompt(prompt, editor.document.languageId, this.getEditorContext(editor));
            const generatedCode = await this.ollamaService.generateCode(fullPrompt, { signal: this.currentAbort?.signal });
            const cleanedCode = generatedCode.replace(/```[a-zA-Z]*\n?|\n?```/g, '').trim();
            await this.applyCodeChanges(cleanedCode);
            return 'Código gerado e aplicado no editor.';
        }
        catch (error) {
            if (this.isTimeoutError(error))
                return 'Tempo limite atingido.';
            if (this.isAbortError(error))
                return 'Geração cancelada.';
            return `Erro ao gerar código: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async editCode(instruction) {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return 'Nenhum editor ativo. Abra um arquivo para editar ou selecione o código.';
        let selectedCode = editor.document.getText(editor.selection);
        let rangeToReplace = editor.selection;
        if (!selectedCode) {
            selectedCode = editor.document.getText();
            rangeToReplace = new vscode.Range(editor.document.lineAt(0).range.start, editor.document.lineAt(editor.document.lineCount - 1).range.end);
        }
        if (!instruction)
            return 'Por favor, forneça uma instrução de edição.';
        try {
            this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Editando código…' });
            const fullPrompt = this.buildEditPrompt(selectedCode, instruction, editor.document.languageId);
            const editedCode = await this.ollamaService.generateCode(fullPrompt, { signal: this.currentAbort?.signal });
            const cleanedCode = editedCode.replace(/```[a-zA-Z]*\n?|\n?```/g, '').trim();
            await this.applyCodeChanges(cleanedCode, rangeToReplace.start.line, rangeToReplace.start.character, rangeToReplace.end.line, rangeToReplace.end.character);
            return 'Código editado e aplicado no editor.';
        }
        catch (error) {
            if (this.isTimeoutError(error))
                return 'Tempo limite atingido.';
            if (this.isAbortError(error))
                return 'Edição cancelada.';
            return `Erro ao editar código: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async analyzeFile(filePath, instruction) {
        if (!filePath || !instruction)
            return 'Uso: analyzefile <caminho-do-arquivo> <instrução>.';
        try {
            this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: `Analisando arquivo ${filePath}...` });
            const analysisResult = await this.ollamaService.analyzeFile(filePath, instruction, { signal: this.currentAbort?.signal });
            return `Análise de ${filePath}:\n\n${analysisResult}`;
        }
        catch (error) {
            if (this.isTimeoutError(error))
                return 'Tempo limite atingido.';
            if (this.isAbortError(error))
                return 'Análise cancelada.';
            return `Erro ao analisar arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async listFiles(directoryPath) {
        if (!directoryPath)
            return 'Por favor, forneça um caminho de diretório para listar.';
        if (!vscode.workspace.workspaceFolders)
            return 'Nenhum workspace aberto.';
        const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, directoryPath);
        try {
            const files = await fs.promises.readdir(absolutePath);
            return `Arquivos em ${directoryPath}:\n${files.join('\n')}`;
        }
        catch (error) {
            return `Erro ao listar arquivos em ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async executeVscodeCommand(command, args) {
        if (!command)
            return 'Por favor, forneça um comando do VS Code para executar.';
        try {
            await vscode.commands.executeCommand(command, ...(args || []));
            return `Comando ${command} executado com sucesso.`;
        }
        catch (error) {
            return `Erro ao executar o comando ${command}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async openFile(filePath) {
        if (!filePath)
            return 'Por favor, forneça um caminho de arquivo para abrir.';
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0)
            return 'Nenhum workspace aberto para abrir o arquivo.';
        const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
        try {
            const document = await vscode.workspace.openTextDocument(absolutePath);
            await vscode.window.showTextDocument(document);
            return `Arquivo ${filePath} aberto com sucesso.`;
        }
        catch (error) {
            return `Erro ao abrir o arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async applyCodeChanges(newCode, startLine, startCharacter, endLine, endCharacter) {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return 'Nenhum editor ativo encontrado para aplicar as mudanças.';
        try {
            await editor.edit(editBuilder => {
                if (startLine !== undefined && startCharacter !== undefined && endLine !== undefined && endCharacter !== undefined) {
                    const range = new vscode.Range(startLine, startCharacter, endLine, endCharacter);
                    editBuilder.replace(range, newCode);
                }
                else {
                    const fullRange = new vscode.Range(editor.document.lineAt(0).range.start, editor.document.lineAt(editor.document.lineCount - 1).range.end);
                    editBuilder.replace(fullRange, newCode);
                }
            });
            return 'Alterações de código aplicadas com sucesso.';
        }
        catch (error) {
            return `Erro ao aplicar alterações de código: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async applyDiff(diffContent) {
        if (!diffContent)
            return 'Por favor, forneça o conteúdo do diff para aplicar.';
        const result = await this.diffManager.previewAndApplyUnifiedDiff(diffContent, 'Patch do Agente');
        return result.message;
    }
    async lspRename(args) {
        const newName = this.asNonEmptyString(args.newName);
        if (!newName) {
            return 'Uso: lsprename requer "newName".';
        }
        const target = await this.resolveToolDocument(args.filePath);
        if (!target.document) {
            return target.error;
        }
        const position = this.resolveToolPosition(target.document, args.line, args.character);
        if (!position) {
            return 'Forneca "line" e "character" ou deixe o cursor no simbolo a renomear.';
        }
        try {
            const renameEdit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', target.document.uri, position, newName);
            if (!renameEdit || renameEdit.size === 0) {
                return `Rename indisponivel para ${target.relativePath} na posicao ${position.line}:${position.character}.`;
            }
            const applied = await vscode.workspace.applyEdit(renameEdit);
            if (!applied) {
                return 'Falha ao aplicar rename no workspace.';
            }
            const touchedFiles = this.workspaceEditFileCount(renameEdit);
            return `Rename aplicado para "${newName}" em ${touchedFiles} arquivo(s).`;
        }
        catch (error) {
            return `Erro no rename LSP: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async lspOrganizeImports(args) {
        const target = await this.resolveToolDocument(args.filePath);
        if (!target.document) {
            return target.error;
        }
        try {
            const edits = await vscode.commands.executeCommand('vscode.executeOrganizeImports', target.document.uri);
            if (!edits || edits.length === 0) {
                return `Nenhum import para organizar em ${target.relativePath}.`;
            }
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(target.document.uri, edits);
            const applied = await vscode.workspace.applyEdit(workspaceEdit);
            if (!applied) {
                return 'Falha ao aplicar organize imports.';
            }
            return `Imports organizados em ${target.relativePath}.`;
        }
        catch (error) {
            return `Erro no organize imports LSP: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async lspCodeActions(args) {
        const target = await this.resolveToolDocument(args.filePath);
        if (!target.document) {
            return target.error;
        }
        const range = this.resolveToolRange(target.document, args);
        const kind = this.asNonEmptyString(args.kind);
        try {
            const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', target.document.uri, range, kind) || [];
            if (actions.length === 0) {
                return `Nenhuma code action disponivel em ${target.relativePath} para o range ${this.rangeLabel(range)}${kind ? ` (kind: ${kind})` : ''}.`;
            }
            const index = this.asOptionalNumber(args.index);
            const titleContains = this.asNonEmptyString(args.titleContains)?.toLowerCase();
            const shouldApply = this.asBoolean(args.apply, false) || index !== undefined || !!titleContains;
            if (!shouldApply) {
                return this.describeCodeActions(actions, target.relativePath, range, kind);
            }
            const selected = this.selectCodeAction(actions, index, titleContains);
            if (!selected) {
                return 'Nao foi possivel selecionar uma code action aplicavel.';
            }
            const applyResult = await this.applyCodeActionEntry(selected);
            return `${applyResult}\n${this.describeCodeActions(actions, target.relativePath, range, kind)}`;
        }
        catch (error) {
            return `Erro ao consultar code actions LSP: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async lspQuickFix(args) {
        const quickFixArgs = {
            ...args,
            kind: 'quickfix',
            apply: true
        };
        return await this.lspCodeActions(quickFixArgs);
    }
    async applyCodeActionEntry(entry) {
        try {
            if (this.isCodeAction(entry)) {
                if (entry.disabled) {
                    return `Code action desabilitada: ${entry.title} (${entry.disabled.reason}).`;
                }
                if (entry.edit) {
                    const appliedEdit = await vscode.workspace.applyEdit(entry.edit);
                    if (!appliedEdit) {
                        return `Falha ao aplicar edicoes da code action: ${entry.title}.`;
                    }
                }
                if (entry.command) {
                    await vscode.commands.executeCommand(entry.command.command, ...(entry.command.arguments || []));
                }
                return `Code action aplicada: ${entry.title}.`;
            }
            await vscode.commands.executeCommand(entry.command, ...(entry.arguments || []));
            return `Comando de code action executado: ${entry.title}.`;
        }
        catch (error) {
            return `Erro ao aplicar code action: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    selectCodeAction(actions, index, titleContains) {
        const normalizedIndex = index !== undefined ? Math.floor(index) : undefined;
        if (normalizedIndex !== undefined && normalizedIndex >= 0 && normalizedIndex < actions.length) {
            return actions[normalizedIndex];
        }
        if (titleContains) {
            const byTitle = actions.find(action => action.title.toLowerCase().includes(titleContains));
            if (byTitle) {
                return byTitle;
            }
        }
        const preferred = actions.find(action => this.isCodeAction(action) && action.isPreferred && !action.disabled);
        if (preferred) {
            return preferred;
        }
        const enabled = actions.find(action => !this.isCodeAction(action) || !action.disabled);
        return enabled ?? actions[0];
    }
    describeCodeActions(actions, relativePath, range, kind) {
        const lines = actions.slice(0, 20).map((action, index) => {
            const typeLabel = this.isCodeAction(action)
                ? (action.kind?.value || 'codeaction')
                : 'command';
            const preferred = this.isCodeAction(action) && action.isPreferred ? ' preferred' : '';
            const disabled = this.isCodeAction(action) && action.disabled ? ` disabled(${action.disabled.reason})` : '';
            return `[${index}] ${action.title} [${typeLabel}${preferred}]${disabled}`;
        });
        const suffix = actions.length > 20 ? `\n... +${actions.length - 20} action(s)` : '';
        return `Code actions em ${relativePath} ${this.rangeLabel(range)}${kind ? ` (kind: ${kind})` : ''}:\n${lines.join('\n')}${suffix}`;
    }
    async resolveToolDocument(filePathValue) {
        const activeEditor = vscode.window.activeTextEditor;
        const filePath = this.asNonEmptyString(filePathValue);
        if (!filePath) {
            if (!activeEditor) {
                return { relativePath: '', error: 'Nenhum editor ativo. Forneca "filePath" ou abra um arquivo.' };
            }
            return {
                document: activeEditor.document,
                relativePath: vscode.workspace.asRelativePath(activeEditor.document.uri, false),
                error: ''
            };
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { relativePath: filePath, error: 'Nenhum workspace aberto.' };
        }
        const absolutePath = path.resolve(workspaceFolder.uri.fsPath, filePath);
        if (!this.isPathInsideRoot(workspaceFolder.uri.fsPath, absolutePath)) {
            return { relativePath: filePath, error: `Caminho fora do workspace: ${filePath}` };
        }
        try {
            const document = await vscode.workspace.openTextDocument(absolutePath);
            return {
                document,
                relativePath: vscode.workspace.asRelativePath(document.uri, false),
                error: ''
            };
        }
        catch (error) {
            return {
                relativePath: filePath,
                error: `Erro ao abrir arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    resolveToolPosition(document, lineValue, characterValue) {
        const parsedLine = this.asOptionalNumber(lineValue);
        const parsedCharacter = this.asOptionalNumber(characterValue);
        if (parsedLine !== undefined && parsedCharacter !== undefined) {
            return this.clampPosition(document, parsedLine, parsedCharacter);
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
            return activeEditor.selection.active;
        }
        return undefined;
    }
    resolveToolRange(document, args) {
        const startLine = this.asOptionalNumber(args.startLine);
        const startCharacter = this.asOptionalNumber(args.startCharacter);
        const endLine = this.asOptionalNumber(args.endLine);
        const endCharacter = this.asOptionalNumber(args.endCharacter);
        if (startLine !== undefined && startCharacter !== undefined && endLine !== undefined && endCharacter !== undefined) {
            const start = this.clampPosition(document, startLine, startCharacter);
            const end = this.clampPosition(document, endLine, endCharacter);
            return start.isBeforeOrEqual(end) ? new vscode.Range(start, end) : new vscode.Range(end, start);
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
            const selection = activeEditor.selection;
            return new vscode.Range(selection.start, selection.end);
        }
        return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    }
    clampPosition(document, lineValue, characterValue) {
        const maxLine = Math.max(document.lineCount - 1, 0);
        const line = Math.min(Math.max(Math.floor(lineValue), 0), maxLine);
        const lineLength = document.lineAt(line).text.length;
        const character = Math.min(Math.max(Math.floor(characterValue), 0), lineLength);
        return new vscode.Position(line, character);
    }
    rangeLabel(range) {
        return `[${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}]`;
    }
    workspaceEditFileCount(edit) {
        const entries = edit.entries();
        if (entries.length > 0) {
            return entries.length;
        }
        return edit.size;
    }
    isCodeAction(entry) {
        return 'kind' in entry || 'edit' in entry || 'isPreferred' in entry || 'disabled' in entry;
    }
    asNonEmptyString(value) {
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    asOptionalNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return undefined;
    }
    asBoolean(value, defaultValue) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true')
                return true;
            if (normalized === 'false')
                return false;
        }
        return defaultValue;
    }
    isPathInsideRoot(rootPath, targetPath) {
        const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }
    async findFile(pattern) {
        if (!pattern)
            return 'Por favor, forneça um padrão para buscar arquivos.';
        try {
            const uris = await vscode.workspace.findFiles(pattern, null, 10);
            if (uris.length === 0)
                return `Nenhum arquivo encontrado para o padrão: ${pattern}.`;
            return `Arquivos encontrados para ${pattern}:\n${uris.map(uri => uri.fsPath).join('\n')}`;
        }
        catch (error) {
            return `Erro ao buscar arquivos: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async searchText(query) {
        if (!query)
            return 'Por favor, forneça um texto para buscar.';
        if (!vscode.workspace.workspaceFolders)
            return 'Nenhum workspace aberto.';
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        return new Promise((resolve) => {
            (0, child_process_1.exec)(`git grep -I -n "${query.replace(/"/g, '\\"')}"`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
                if (error) {
                    if (error.code === 1)
                        return resolve(`Nenhum resultado encontrado para: ${query}.`);
                    return resolve(`Erro ao buscar texto: ${stderr || error.message}`);
                }
                const lines = stdout.split('\n').filter(line => line.trim() !== '');
                const limited = lines.slice(0, 50).join('\n');
                const count = lines.length;
                resolve(`Encontrados ${count} resultados para "${query}".\n\n${count > 50 ? '(mostrando 50 primeiros)\n\n' : ''}${limited}`);
            });
        });
    }
    async searchSemantic(query) {
        if (!query)
            return 'Por favor, forneça uma query para busca semântica.';
        try {
            this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: `Buscando semanticamente: ${query}...` });
            const results = await this.ragService.search(query, 5);
            if (results.length === 0)
                return 'Nenhum resultado relevante encontrado.';
            return `Resultados Semânticos para: ${query}\n\n` + results.map(r => `File: ${r.filePath}\nScore: ${(r.score || 0).toFixed(2)}\n${r.content.substring(0, 500)}...\n`).join('\n');
        }
        catch (error) {
            return `Erro na busca semântica: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async saveFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return 'Nenhum editor ativo para salvar.';
        try {
            await editor.document.save();
            return `Arquivo ${editor.document.fileName} salvo com sucesso.`;
        }
        catch (error) {
            return `Erro ao salvar arquivo: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async closeFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return 'Nenhum editor ativo para fechar.';
        try {
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            return `Arquivo ${editor.document.fileName} fechado com sucesso.`;
        }
        catch (error) {
            return `Erro ao fechar arquivo: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async getSelectedText() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return 'Nenhum editor ativo. Abra um arquivo e selecione o código.';
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText)
            return 'Nenhum texto selecionado no editor ativo.';
        return `Texto selecionado:\n\n${selectedText}`;
    }
    async requestModels() {
        try {
            const modelDetails = await this.ollamaService.getModelDetails();
            this.view?.webview.postMessage({ type: 'availableModels', models: modelDetails });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Erro ao buscar modelos: ${error}`);
            this.view?.webview.postMessage({ type: 'availableModels', models: [], error: String(error) });
        }
    }
    async setSelectedModel(modelName) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        await config.update('modelName', modelName, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Modelo Ollama alterado para: ${modelName}`);
    }
    async requestCurrentModel() {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const currentModel = config.get('modelName');
        this.view?.webview.postMessage({ type: 'currentModel', modelName: currentModel });
    }
    async getWorkspaceFiles() {
        if (!vscode.workspace.workspaceFolders)
            return [];
        const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h,html,css,json,md}', '**/node_modules/**');
        return files.map(file => vscode.workspace.asRelativePath(file));
    }
    async handlePinFileRequest() {
        const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h,html,css,json,md}', '**/node_modules/**');
        const fileItems = files.map(file => vscode.workspace.asRelativePath(file));
        const selected = await vscode.window.showQuickPick(fileItems, { placeHolder: 'Selecione um arquivo para fixar no contexto' });
        if (selected)
            this.addPinnedFile(selected);
    }
    addPinnedFile(filePath) {
        this.pinnedFiles.add(filePath);
        this.updatePinnedFilesUI();
        vscode.window.showInformationMessage(`Arquivo fixado: ${filePath}`);
    }
    removePinnedFile(filePath) {
        this.pinnedFiles.delete(filePath);
        this.updatePinnedFilesUI();
        vscode.window.showInformationMessage(`Arquivo desafixado: ${filePath}`);
    }
    updatePinnedFilesUI() {
        this.view?.webview.postMessage({ type: 'updatePinnedFiles', files: Array.from(this.pinnedFiles) });
    }
    normalizePositiveInt(value, fallback, minimum = 1) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
            return fallback;
        }
        return Math.max(minimum, Math.floor(value));
    }
    getContextWindowConfig() {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const contextSize = this.normalizePositiveInt(config.get('contextSize', 32768), 32768, 1024);
        const maxTokens = this.normalizePositiveInt(config.get('maxTokens', 8192), 8192, 256);
        const chunkSizeChars = this.normalizePositiveInt(config.get('chunkSize', 25000), 25000, 512);
        const safeInputTokens = Math.max(1024, contextSize - Math.max(512, maxTokens));
        const contextTokenBudget = Math.max(512, Math.floor(safeInputTokens * 0.5));
        const readTokenBudget = Math.max(256, Math.floor(safeInputTokens * 0.65));
        return { chunkSizeChars, contextTokenBudget, readTokenBudget };
    }
    async resolveContextFileUri(fileRef) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }
        const normalizedRef = fileRef.trim();
        if (!normalizedRef) {
            return undefined;
        }
        const directPath = path.resolve(workspaceFolder.uri.fsPath, normalizedRef);
        if (this.isPathInsideRoot(workspaceFolder.uri.fsPath, directPath)) {
            try {
                const stats = await fs.promises.stat(directPath);
                if (stats.isFile()) {
                    return vscode.Uri.file(directPath);
                }
            }
            catch {
                // fallback to workspace glob lookup
            }
        }
        try {
            const matches = await vscode.workspace.findFiles(normalizedRef, '**/node_modules/**', 1);
            return matches[0];
        }
        catch {
            return undefined;
        }
    }
    renderChunkedContent(chunked) {
        const shouldAnnotateChunks = chunked.totalChunkCount > 1 || chunked.partialChunkIncluded;
        return chunked.chunks
            .map((chunk, index) => {
            if (!shouldAnnotateChunks) {
                return chunk;
            }
            return `[chunk ${index + 1}/${chunked.totalChunkCount}]\n${chunk}`;
        })
            .join('\n\n');
    }
    async resolveMessageContext(message) {
        const mentionRegex = /@([a-zA-Z0-9_.\-\/]+)/g;
        const resolvedMessage = message;
        const { chunkSizeChars, contextTokenBudget } = this.getContextWindowConfig();
        let remainingTokens = contextTokenBudget;
        let contextData = '';
        const targets = [];
        const seenPaths = new Set();
        const addTarget = async (source, requestedPath) => {
            const fileUri = await this.resolveContextFileUri(requestedPath);
            if (!fileUri) {
                return;
            }
            const relativePath = vscode.workspace.asRelativePath(fileUri, false);
            const dedupeKey = relativePath.toLowerCase();
            if (seenPaths.has(dedupeKey)) {
                return;
            }
            seenPaths.add(dedupeKey);
            targets.push({ source, requestedPath, uri: fileUri, relativePath });
        };
        for (const pinnedFile of this.pinnedFiles) {
            await addTarget('pinned', pinnedFile);
        }
        const matches = message.match(mentionRegex);
        if (matches) {
            for (const match of matches) {
                const filename = match.substring(1);
                await addTarget('mention', filename);
            }
        }
        if (targets.length === 0) {
            return resolvedMessage;
        }
        const pinnedSections = [];
        const mentionSections = [];
        let omittedFiles = 0;
        for (let index = 0; index < targets.length; index++) {
            if (remainingTokens <= 0) {
                omittedFiles += targets.length - index;
                break;
            }
            const target = targets[index];
            const remainingFiles = targets.length - index;
            const fairShare = Math.floor(remainingTokens / Math.max(remainingFiles, 1));
            const fileTokenBudget = Math.max(1, Math.min(remainingTokens, Math.max(128, fairShare)));
            try {
                const content = await fs.promises.readFile(target.uri.fsPath, 'utf8');
                const chunked = (0, contextWindow_1.chunkTextForTokenBudget)(content, {
                    chunkSizeChars,
                    maxTokens: fileTokenBudget
                });
                if (chunked.includedChunkCount === 0) {
                    omittedFiles++;
                    continue;
                }
                remainingTokens = Math.max(0, remainingTokens - chunked.usedTokens);
                const rendered = this.renderChunkedContent(chunked);
                const truncationNote = chunked.truncated
                    ? `\n[context truncated: ${chunked.includedChunkCount}/${chunked.totalChunkCount} chunks, ~${chunked.usedTokens}/${chunked.estimatedTotalTokens} tokens]`
                    : '';
                if (target.source === 'pinned') {
                    pinnedSections.push(`\n# ${target.relativePath}\n${rendered}${truncationNote}\n`);
                }
                else {
                    mentionSections.push(`\n\n--- CONTEXTO DO ARQUIVO: ${target.relativePath} ---\n${rendered}${truncationNote}\n----------------------------------\n`);
                }
            }
            catch (error) {
                omittedFiles++;
                logger_1.Logger.error(`Erro ao ler arquivo de contexto: ${target.requestedPath}`, error);
            }
        }
        if (pinnedSections.length > 0) {
            contextData += '\n\n--- ARQUIVOS FIXADOS (PINNED) ---\n';
            contextData += pinnedSections.join('');
            contextData += '\n---------------------------------\n';
        }
        if (mentionSections.length > 0) {
            contextData += mentionSections.join('');
        }
        if (omittedFiles > 0) {
            contextData += `\n[Context budget reached: ${omittedFiles} arquivo(s) omitido(s)]\n`;
        }
        return resolvedMessage + contextData;
    }
    getEditorContext(editor) {
        const document = editor.document;
        const currentLine = editor.selection.active.line;
        const startLine = Math.max(0, currentLine - 5);
        const endLine = Math.min(document.lineCount - 1, currentLine + 5);
        const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
        return document.getText(range);
    }
    buildGeneratePrompt(userPrompt, language, context) {
        return `Você é um assistente de programação especializado. Gere código ${language} baseado na seguinte solicitação:

${userPrompt}

--- CONTEXTO DO CÓDIGO ATUAL (${language}) ---
${context}

REGRAS:
- Gere apenas o código solicitado, sem explicações
- Mantenha o estilo consistente com o contexto
- Use boas práticas da linguagem ${language}
- Adicione comentários apenas quando necessário
`;
    }
    buildEditPrompt(originalCode, editInstruction, language) {
        return `Você é um assistente de programação especializado. Edite o código seguindo as instruções fornecidas

--- CÓDIGO ORIGINAL (${language}) ---
${originalCode}

--- INSTRUÇÃO DE EDIÇÃO ---
${editInstruction}

REGRAS:
- Mantenha a funcionalidade principal do código
- Aplique apenas as mudanças solicitadas
- Use boas práticas da linguagem ${language}
- Retorne apenas o código editado, sem explicações

--- CÓDIGO EDITADO ---
`;
    }
    buildEditPatchPrompt(userMessageWithContext) {
        const activeEditorContext = this.getActiveEditorPatchContext();
        return `You are a senior software engineer specialized in code editing.
Your task is to convert the user request into an APPLYABLE unified git diff patch.

STRICT OUTPUT RULES:
- Return ONLY the unified diff patch text.
- Do NOT add markdown fences.
- Do NOT add explanations.
- The patch must start with "diff --git".
- Use workspace-relative paths (example: src/app.ts).
- For new files use /dev/null correctly.
- For deleted files use /dev/null correctly.
- If no change is needed, return exactly: NO_CHANGES

USER INSTRUCTION + CONTEXT:
${userMessageWithContext}

ACTIVE EDITOR CONTEXT:
${activeEditorContext}
`;
    }
    getActiveEditorPatchContext() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return 'No active editor.';
        }
        const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
        const language = editor.document.languageId;
        const selection = editor.selection;
        const hasSelection = !selection.isEmpty;
        const selectedText = hasSelection ? editor.document.getText(selection) : '';
        const fullFileText = editor.document.getText();
        const maxChars = 20000;
        const normalizedFileText = fullFileText.length > maxChars
            ? `${fullFileText.slice(0, maxChars)}\n... [truncated after ${maxChars} chars]`
            : fullFileText;
        const selectionDescription = hasSelection
            ? `${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`
            : 'none';
        return `Active file: ${relativePath}
Language: ${language}
Selected range: ${selectionDescription}
Selected text:
\`\`\`${language}
${selectedText}
\`\`\`

Current file content:
\`\`\`${language}
${normalizedFileText}
\`\`\``;
    }
    extractUnifiedDiffContent(modelResponse) {
        const rawResponse = String(modelResponse || '').trim();
        if (!rawResponse) {
            return undefined;
        }
        if (/^NO_CHANGES$/i.test(rawResponse)) {
            return '';
        }
        const sanitized = (0, unifiedDiff_1.sanitizeUnifiedDiff)(rawResponse);
        if (/^NO_CHANGES$/i.test(sanitized)) {
            return '';
        }
        const diffStartIndex = sanitized.indexOf('diff --git ');
        if (diffStartIndex >= 0) {
            return sanitized.slice(diffStartIndex).trim();
        }
        const rawDiffStartIndex = rawResponse.indexOf('diff --git ');
        if (rawDiffStartIndex >= 0) {
            return rawResponse.slice(rawDiffStartIndex).trim();
        }
        return undefined;
    }
    getHtmlForWebview(webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'));
        const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'marked.min.js'));
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Ollama Chat</title>
</head>
<body>
  <div id="chat-container">
    <div class="header-controls">
      <div class="left-controls">
        <button id="new-chat-button" class="icon-button" title="Novo Chat">+</button>
        <button id="history-button" class="icon-button" title="Histórico">≡</button>
      </div>

      <div class="window-controls">
        <button id="settings-button" class="icon-button" title="Configurações">⚙</button>
      </div>
    </div>

    <div id="history-overlay" class="history-overlay hidden">
      <div class="history-header">
        <span>Histórico de Chats</span>
        <button id="close-history">✖</button>
      </div>
      <div id="history-list" class="history-list"></div>
    </div>

    <div id="pinned-files" class="pinned-files"></div>

    <div id="messages" class="messages-container"></div>

    <div id="processing-indicator" class="processing-indicator hidden">
      <div class="spinner" aria-hidden="true"></div>
      <div class="processing-text">
        <div id="processing-title">Processando…</div>
        <div id="processing-subtitle">Gerando resposta</div>
      </div>
      <button id="stop-button" class="stop-button" title="Parar geração">⏹</button>
    </div>

    <div id="suggestions" class="suggestions-box" style="display:none"></div>

    <div class="input-area-container">
      <div class="input-tools">
        <button id="pin-button" title="Adicionar Contexto (Arquivo/Seleção)" class="icon-button">📌</button>
      </div>

      <textarea id="chat-input" placeholder="Pergunte algo ou digite /explain, /fix, /test, /refactor..." rows="1"></textarea>

      <div class="bottom-controls">
        <div class="model-selector-group">
          <span class="icon-ollama" title="Ollama">O</span>
          <select id="model-select" title="Selecionar Modelo"></select>
          <button id="refresh-models" class="icon-button" title="Atualizar Modelos">↻</button>
        </div>

        <div class="right-bottom">
          <select id="mode-select" title="Modo de Operação">
            <option value="chat">Chat</option>
            <option value="agent">Agent</option>
            <option value="edit">Edit</option>
            <option value="plan">Plan</option>
          </select>

          <button id="send-button" class="send-button" title="Enviar Mensagem">Enviar</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
exports.ChatPanel = ChatPanel;
ChatPanel.viewId = 'ollama-code-diff.chatView';
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=chatPanel.js.map