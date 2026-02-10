import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

import { OllamaService } from './ollama';
import { DiffManager } from './diffManager';
import { RAGService } from './services/ragService';
import { HistoryManager } from './historyManager';
import { Logger } from './utils/logger';
import { parseAgentToolCall } from './utils/agentToolCallParser';

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'ollama-code-diff.chatView';

  private view?: vscode.WebviewView;
  private chatHistory: Array<{ role: string; content: string }> = [];
  private currentMode: 'chat' | 'agent' | 'plan' = 'chat';
  private pinnedFiles: Set<string> = new Set();
  private historyManager: HistoryManager;
  private currentSessionId: string | undefined;

  // Cancel support
  private currentAbort?: AbortController;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private ollamaService: OllamaService,
    private diffManager: DiffManager,
    private ragService: RAGService,
    context: vscode.ExtensionContext
  ) {
    this.historyManager = new HistoryManager(context);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.onDidDispose(() => {
      try {
        this.currentAbort?.abort();
      } catch {
        // ignore
      }
      try {
        this.ollamaService.abort();
      } catch {
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

          if (mode === 'agent') await this.handleAgentMessage(userMessage);
          else await this.handleChatMessage(userMessage);
          break;
        }

        case 'cancelGeneration': {
          // 1) abort local controller (para interromper loops e sinalizar cancelamento)
          try {
            this.currentAbort?.abort();
          } catch {
            // ignore
          }

          // 2) abort no cliente ollama-js (interrompe request/stream de verdade)
          try {
            this.ollamaService.abort();
          } catch {
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

  private async initializeSession() {
    const sessions = this.historyManager.getSessions();
    if (sessions.length > 0) await this.loadSession(sessions[0].id);
    else await this.startNewChat();
  }

  private async startNewChat() {
    const session = await this.historyManager.createSession();
    this.currentSessionId = session.id;
    this.chatHistory = [];

    this.view?.webview.postMessage({ type: 'clearChat' });
    this.view?.webview.postMessage({ type: 'updateSessionId', sessionId: session.id });
  }

  private async loadSession(sessionId: string) {
    const session = this.historyManager.getSession(sessionId);
    if (!session) return;

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

  private async deleteSession(sessionId: string) {
    await this.historyManager.deleteSession(sessionId);
    await this.sendHistoryList();

    if (this.currentSessionId === sessionId) await this.startNewChat();
  }

  private async sendHistoryList() {
    const sessions = this.historyManager.getSessions();
    this.view?.webview.postMessage({ type: 'historyList', sessions });
  }

  private async saveCurrentSession() {
    if (!this.currentSessionId) return;

    const session = this.historyManager.getSession(this.currentSessionId);
    if (!session) return;

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

  private startGenerationUI(title: string, subtitle: string) {
    this.view?.webview.postMessage({ type: 'generationStart', title, subtitle });
  }

  private updateGenerationUI(subtitle: string) {
    this.view?.webview.postMessage({ type: 'generationStatus', subtitle });
  }

  private endGenerationUI() {
    this.view?.webview.postMessage({ type: 'generationEnd' });
  }

  private resetAbortController() {
    // Cancela qualquer geração anterior
    try {
      this.currentAbort?.abort();
    } catch {
      // ignore
    }
    try {
      this.ollamaService.abort();
    } catch {
      // ignore
    }

    this.currentAbort = new AbortController();
    return this.currentAbort;
  }

  private isAbortError(err: unknown): boolean {
    if (!err) return false;
    const anyErr = err as any;
    return anyErr?.name === 'AbortError' || /aborted/i.test(String(anyErr?.message || ''));
  }

  private isTimeoutError(err: unknown): boolean {
    if (!err) return false;
    const anyErr = err as any;
    return anyErr?.name === 'TimeoutError' || /timeout/i.test(String(anyErr?.message || ''));
  }

  private async handleChatMessage(userMessage: string) {
    if (!this.view) return;

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
        if (editor && !editor.selection.isEmpty) selection = editor.document.getText(editor.selection);

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
      for await (const part of this.ollamaService.chatStream(
        messageWithContext,
        this.chatHistory as any,
        { signal: abort.signal }
      )) {
        fullResponse += part;
        this.view.webview.postMessage({ type: 'updateLastMessage', sender: 'ollama', text: fullResponse });
      }

      this.chatHistory.push({ role: 'assistant', content: fullResponse });
      await this.saveCurrentSession();
    } catch (error) {
      if (this.isTimeoutError(error)) {
        this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: 'Tempo limite atingido.' });
      } else if (this.isAbortError(error)) {
        this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: 'Geração cancelada.' });
      } else {
        const errorMessage = `Erro: ${error instanceof Error ? error.message : String(error)}`;
        this.view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: errorMessage });
        vscode.window.showErrorMessage(`Erro no chat: ${errorMessage}`);
      }
    } finally {
      this.endGenerationUI();
      this.currentAbort = undefined;
    }
  }

  private async handleAgentMessage(userMessage: string) {
    if (!this.view) return;

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
- run: Execute shell commands. args: { "command": "npm test" }
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

    const systemPrompt: ChatMsg = { role: 'system', content: toolsDescription };
    let runHistory: ChatMsg[] = [
      systemPrompt,
      ...this.chatHistory.map(m => ({ role: m.role as any, content: m.content } as ChatMsg))
    ];
    if (runHistory.length > 1 && runHistory[runHistory.length - 1].role === 'user') {
      runHistory[runHistory.length - 1] = { role: 'user', content: messageWithContext };
    }

    let agentSteps: Array<{ id: number; label: string; status: 'loading' | 'done' | 'error'; details?: string }> = [];
    const updateProcessUI = (label: string, status: 'loading' | 'done' | 'error' = 'loading', details?: string) => {
      const existingStep = agentSteps.find(s => s.label === label);
      if (existingStep) {
        existingStep.status = status;
        if (details) existingStep.details = details;
      } else {
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
        if (abort.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });

        currentStep++;
        this.updateGenerationUI(`Agent step ${currentStep}/${maxSteps}…`);

        // 1) Get LLM response
        const ollamaResponse = await this.ollamaService.chat(runHistory as any, { signal: abort.signal });

        // 2) Parse Thought/Plan and JSON tool call
        const parsedResponse = parseAgentToolCall(ollamaResponse);
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
        } else {
          shouldContinue = false;
          updateProcessUI('Tarefa concluída', 'done');

          const finalAnswerMatch = ollamaResponse.match(/Final Answer:([\s\S]*)/i);
          const finalResponse = finalAnswerMatch ? finalAnswerMatch[1].trim() : ollamaResponse;

          this.view.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: finalResponse });
          this.chatHistory.push({ role: 'assistant', content: finalResponse });
          await this.saveCurrentSession();
        }
      }

      if (currentStep >= maxSteps) updateProcessUI('Limite de passos atingido', 'error');
    } catch (error) {
      if (this.isTimeoutError(error)) {
        this.view.webview.postMessage({ type: 'addMessage', sender: 'system', text: 'Tempo limite atingido.' });
      } else if (this.isAbortError(error)) {
        this.view.webview.postMessage({ type: 'addMessage', sender: 'system', text: 'Geração cancelada.' });
      } else {
        updateProcessUI('Erro no agente', 'error', String(error));
        this.view.webview.postMessage({ type: 'addMessage', sender: 'system', text: `Agent Error: ${String(error)}` });
      }
    } finally {
      this.endGenerationUI();
      this.currentAbort = undefined;
    }
  }

  private async executeTool(tool: string, args: any): Promise<string> {
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
        return await this.applyCodeChanges(
          safeArgs.newCode,
          safeArgs.startLine,
          safeArgs.startCharacter,
          safeArgs.endLine,
          safeArgs.endCharacter
        );

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
        Logger.error('Ferramenta desconhecida:', normalizedTool);
        return `Ferramenta desconhecida: ${normalizedTool}`;
    }
  }

  private async runCommand(command: string): Promise<string> {
    if (!command) return 'Por favor, forneça um comando para executar.';
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) return 'Nenhum workspace aberto para executar o comando.';

    const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
    this.view?.webview.postMessage({ type: 'addMessage', sender: 'system', text: `Executando: ${command}...` });

    return new Promise((resolve) => {
      exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += `\nSTDERR:\n${stderr}`;
        if (error) output += `\nERROR:\n${error.message}`;
        if (!output.trim()) output = 'Comando executado sem saída.';
        resolve(output);
      });
    });
  }

  private async readFile(filePath: string): Promise<string> {
    if (!filePath) return 'Por favor, forneça um caminho de arquivo para ler.';
    if (!vscode.workspace.workspaceFolders) return 'Nenhum workspace aberto.';

    const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
    try {
      const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
      return `Conteúdo de ${filePath}:\n\n${fileContent}`;
    } catch (error) {
      return `Erro ao ler arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async writeFile(filePath: string, content: string): Promise<string> {
    if (!filePath || content === undefined) return 'Uso: write <caminho-do-arquivo> <conteúdo>.';
    if (!vscode.workspace.workspaceFolders) return 'Nenhum workspace aberto.';

    const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
    try {
      await fs.promises.writeFile(absolutePath, content, 'utf8');
      return `Conteúdo escrito em ${filePath}.`;
    } catch (error) {
      return `Erro ao escrever no arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async generateCode(prompt: string): Promise<string> {
    if (!prompt) return 'Por favor, forneça um prompt para gerar código.';
    const editor = vscode.window.activeTextEditor;
    if (!editor) return 'Nenhum editor ativo encontrado.';

    try {
      this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Gerando código…' });
      const fullPrompt = this.buildGeneratePrompt(prompt, editor.document.languageId, this.getEditorContext(editor));
      const generatedCode = await this.ollamaService.generateCode(fullPrompt, { signal: this.currentAbort?.signal });

      const cleanedCode = generatedCode.replace(/```[a-zA-Z]*\n?|\n?```/g, '').trim();
      await this.applyCodeChanges(cleanedCode);
      return 'Código gerado e aplicado no editor.';
    } catch (error) {
      if (this.isTimeoutError(error)) return 'Tempo limite atingido.';
      if (this.isAbortError(error)) return 'Geração cancelada.';
      return `Erro ao gerar código: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async editCode(instruction: string): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return 'Nenhum editor ativo. Abra um arquivo para editar ou selecione o código.';

    let selectedCode = editor.document.getText(editor.selection);
    let rangeToReplace: vscode.Range = editor.selection;

    if (!selectedCode) {
      selectedCode = editor.document.getText();
      rangeToReplace = new vscode.Range(
        editor.document.lineAt(0).range.start,
        editor.document.lineAt(editor.document.lineCount - 1).range.end
      );
    }

    if (!instruction) return 'Por favor, forneça uma instrução de edição.';

    try {
      this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Editando código…' });
      const fullPrompt = this.buildEditPrompt(selectedCode, instruction, editor.document.languageId);

      const editedCode = await this.ollamaService.generateCode(fullPrompt, { signal: this.currentAbort?.signal });

      const cleanedCode = editedCode.replace(/```[a-zA-Z]*\n?|\n?```/g, '').trim();
      await this.applyCodeChanges(
        cleanedCode,
        rangeToReplace.start.line,
        rangeToReplace.start.character,
        rangeToReplace.end.line,
        rangeToReplace.end.character
      );

      return 'Código editado e aplicado no editor.';
    } catch (error) {
      if (this.isTimeoutError(error)) return 'Tempo limite atingido.';
      if (this.isAbortError(error)) return 'Edição cancelada.';
      return `Erro ao editar código: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async analyzeFile(filePath: string, instruction: string): Promise<string> {
    if (!filePath || !instruction) return 'Uso: analyzefile <caminho-do-arquivo> <instrução>.';
    try {
      this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: `Analisando arquivo ${filePath}...` });
      const analysisResult = await this.ollamaService.analyzeFile(filePath, instruction, { signal: this.currentAbort?.signal });
      return `Análise de ${filePath}:\n\n${analysisResult}`;
    } catch (error) {
      if (this.isTimeoutError(error)) return 'Tempo limite atingido.';
      if (this.isAbortError(error)) return 'Análise cancelada.';
      return `Erro ao analisar arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async listFiles(directoryPath: string): Promise<string> {
    if (!directoryPath) return 'Por favor, forneça um caminho de diretório para listar.';
    if (!vscode.workspace.workspaceFolders) return 'Nenhum workspace aberto.';

    const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, directoryPath);
    try {
      const files = await fs.promises.readdir(absolutePath);
      return `Arquivos em ${directoryPath}:\n${files.join('\n')}`;
    } catch (error) {
      return `Erro ao listar arquivos em ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async executeVscodeCommand(command: string, args: any): Promise<string> {
    if (!command) return 'Por favor, forneça um comando do VS Code para executar.';
    try {
      await vscode.commands.executeCommand(command, ...(args || []));
      return `Comando ${command} executado com sucesso.`;
    } catch (error) {
      return `Erro ao executar o comando ${command}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async openFile(filePath: string): Promise<string> {
    if (!filePath) return 'Por favor, forneça um caminho de arquivo para abrir.';
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) return 'Nenhum workspace aberto para abrir o arquivo.';

    const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
    try {
      const document = await vscode.workspace.openTextDocument(absolutePath);
      await vscode.window.showTextDocument(document);
      return `Arquivo ${filePath} aberto com sucesso.`;
    } catch (error) {
      return `Erro ao abrir o arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async applyCodeChanges(
    newCode: string,
    startLine?: number,
    startCharacter?: number,
    endLine?: number,
    endCharacter?: number
  ): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return 'Nenhum editor ativo encontrado para aplicar as mudanças.';

    try {
      await editor.edit(editBuilder => {
        if (startLine !== undefined && startCharacter !== undefined && endLine !== undefined && endCharacter !== undefined) {
          const range = new vscode.Range(startLine, startCharacter, endLine, endCharacter);
          editBuilder.replace(range, newCode);
        } else {
          const fullRange = new vscode.Range(
            editor.document.lineAt(0).range.start,
            editor.document.lineAt(editor.document.lineCount - 1).range.end
          );
          editBuilder.replace(fullRange, newCode);
        }
      });
      return 'Alterações de código aplicadas com sucesso.';
    } catch (error) {
      return `Erro ao aplicar alterações de código: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async applyDiff(diffContent: string): Promise<string> {
    if (!diffContent) return 'Por favor, forneça o conteúdo do diff para aplicar.';

    const result = await this.diffManager.previewAndApplyUnifiedDiff(diffContent, 'Patch do Agente');
    return result.message;
  }

  private async lspRename(args: Record<string, unknown>): Promise<string> {
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
      const renameEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | null>(
        'vscode.executeDocumentRenameProvider',
        target.document.uri,
        position,
        newName
      );

      if (!renameEdit || renameEdit.size === 0) {
        return `Rename indisponivel para ${target.relativePath} na posicao ${position.line}:${position.character}.`;
      }

      const applied = await vscode.workspace.applyEdit(renameEdit);
      if (!applied) {
        return 'Falha ao aplicar rename no workspace.';
      }

      const touchedFiles = this.workspaceEditFileCount(renameEdit);
      return `Rename aplicado para "${newName}" em ${touchedFiles} arquivo(s).`;
    } catch (error) {
      return `Erro no rename LSP: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async lspOrganizeImports(args: Record<string, unknown>): Promise<string> {
    const target = await this.resolveToolDocument(args.filePath);
    if (!target.document) {
      return target.error;
    }

    try {
      const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | null>(
        'vscode.executeOrganizeImports',
        target.document.uri
      );

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
    } catch (error) {
      return `Erro no organize imports LSP: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async lspCodeActions(args: Record<string, unknown>): Promise<string> {
    const target = await this.resolveToolDocument(args.filePath);
    if (!target.document) {
      return target.error;
    }

    const range = this.resolveToolRange(target.document, args);
    const kind = this.asNonEmptyString(args.kind);

    try {
      const actions = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
        'vscode.executeCodeActionProvider',
        target.document.uri,
        range,
        kind
      ) || [];

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
    } catch (error) {
      return `Erro ao consultar code actions LSP: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async lspQuickFix(args: Record<string, unknown>): Promise<string> {
    const quickFixArgs: Record<string, unknown> = {
      ...args,
      kind: 'quickfix',
      apply: true
    };
    return await this.lspCodeActions(quickFixArgs);
  }

  private async applyCodeActionEntry(entry: vscode.CodeAction | vscode.Command): Promise<string> {
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
    } catch (error) {
      return `Erro ao aplicar code action: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private selectCodeAction(
    actions: Array<vscode.CodeAction | vscode.Command>,
    index?: number,
    titleContains?: string
  ): vscode.CodeAction | vscode.Command | undefined {
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

  private describeCodeActions(
    actions: Array<vscode.CodeAction | vscode.Command>,
    relativePath: string,
    range: vscode.Range,
    kind?: string
  ): string {
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

  private async resolveToolDocument(filePathValue: unknown): Promise<{ document?: vscode.TextDocument; relativePath: string; error: string }> {
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
    } catch (error) {
      return {
        relativePath: filePath,
        error: `Erro ao abrir arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private resolveToolPosition(
    document: vscode.TextDocument,
    lineValue: unknown,
    characterValue: unknown
  ): vscode.Position | undefined {
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

  private resolveToolRange(document: vscode.TextDocument, args: Record<string, unknown>): vscode.Range {
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

  private clampPosition(document: vscode.TextDocument, lineValue: number, characterValue: number): vscode.Position {
    const maxLine = Math.max(document.lineCount - 1, 0);
    const line = Math.min(Math.max(Math.floor(lineValue), 0), maxLine);
    const lineLength = document.lineAt(line).text.length;
    const character = Math.min(Math.max(Math.floor(characterValue), 0), lineLength);
    return new vscode.Position(line, character);
  }

  private rangeLabel(range: vscode.Range): string {
    return `[${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}]`;
  }

  private workspaceEditFileCount(edit: vscode.WorkspaceEdit): number {
    const entries = edit.entries();
    if (entries.length > 0) {
      return entries.length;
    }

    return edit.size;
  }

  private isCodeAction(entry: vscode.CodeAction | vscode.Command): entry is vscode.CodeAction {
    return 'kind' in entry || 'edit' in entry || 'isPreferred' in entry || 'disabled' in entry;
  }

  private asNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private asOptionalNumber(value: unknown): number | undefined {
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

  private asBoolean(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }

    return defaultValue;
  }

  private isPathInsideRoot(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private async findFile(pattern: string): Promise<string> {
    if (!pattern) return 'Por favor, forneça um padrão para buscar arquivos.';
    try {
      const uris = await vscode.workspace.findFiles(pattern, null, 10);
      if (uris.length === 0) return `Nenhum arquivo encontrado para o padrão: ${pattern}.`;
      return `Arquivos encontrados para ${pattern}:\n${uris.map(uri => uri.fsPath).join('\n')}`;
    } catch (error) {
      return `Erro ao buscar arquivos: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async searchText(query: string): Promise<string> {
    if (!query) return 'Por favor, forneça um texto para buscar.';
    if (!vscode.workspace.workspaceFolders) return 'Nenhum workspace aberto.';

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

    return new Promise((resolve) => {
      exec(`git grep -I -n "${query.replace(/"/g, '\\"')}"`, { cwd: workspaceRoot }, (error: any, stdout: string, stderr: string) => {
        if (error) {
          if (error.code === 1) return resolve(`Nenhum resultado encontrado para: ${query}.`);
          return resolve(`Erro ao buscar texto: ${stderr || error.message}`);
        }

        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        const limited = lines.slice(0, 50).join('\n');
        const count = lines.length;

        resolve(`Encontrados ${count} resultados para "${query}".\n\n${count > 50 ? '(mostrando 50 primeiros)\n\n' : ''}${limited}`);
      });
    });
  }

  private async searchSemantic(query: string): Promise<string> {
    if (!query) return 'Por favor, forneça uma query para busca semântica.';
    try {
      this.view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: `Buscando semanticamente: ${query}...` });
      const results = await this.ragService.search(query, 5);
      if (results.length === 0) return 'Nenhum resultado relevante encontrado.';

      return `Resultados Semânticos para: ${query}\n\n` + results.map(r =>
        `File: ${r.filePath}\nScore: ${(r.score || 0).toFixed(2)}\n${r.content.substring(0, 500)}...\n`
      ).join('\n');
    } catch (error) {
      return `Erro na busca semântica: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async saveFile(): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return 'Nenhum editor ativo para salvar.';

    try {
      await editor.document.save();
      return `Arquivo ${editor.document.fileName} salvo com sucesso.`;
    } catch (error) {
      return `Erro ao salvar arquivo: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async closeFile(): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return 'Nenhum editor ativo para fechar.';
    try {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      return `Arquivo ${editor.document.fileName} fechado com sucesso.`;
    } catch (error) {
      return `Erro ao fechar arquivo: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async getSelectedText(): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return 'Nenhum editor ativo. Abra um arquivo e selecione o código.';
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText) return 'Nenhum texto selecionado no editor ativo.';
    return `Texto selecionado:\n\n${selectedText}`;
  }

  private async requestModels() {
    try {
      const modelDetails = await this.ollamaService.getModelDetails();
      this.view?.webview.postMessage({ type: 'availableModels', models: modelDetails });
    } catch (error) {
      vscode.window.showErrorMessage(`Erro ao buscar modelos: ${error}`);
      this.view?.webview.postMessage({ type: 'availableModels', models: [], error: String(error) });
    }
  }

  private async setSelectedModel(modelName: string) {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    await config.update('modelName', modelName, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Modelo Ollama alterado para: ${modelName}`);
  }

  private async requestCurrentModel() {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const currentModel = config.get<string>('modelName');
    this.view?.webview.postMessage({ type: 'currentModel', modelName: currentModel });
  }

  private async getWorkspaceFiles(): Promise<string[]> {
    if (!vscode.workspace.workspaceFolders) return [];
    const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h,html,css,json,md}', '**/node_modules/**');
    return files.map(file => vscode.workspace.asRelativePath(file));
  }

  private async handlePinFileRequest() {
    const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h,html,css,json,md}', '**/node_modules/**');
    const fileItems = files.map(file => vscode.workspace.asRelativePath(file));
    const selected = await vscode.window.showQuickPick(fileItems, { placeHolder: 'Selecione um arquivo para fixar no contexto' });
    if (selected) this.addPinnedFile(selected);
  }

  private addPinnedFile(filePath: string) {
    this.pinnedFiles.add(filePath);
    this.updatePinnedFilesUI();
    vscode.window.showInformationMessage(`Arquivo fixado: ${filePath}`);
  }

  private removePinnedFile(filePath: string) {
    this.pinnedFiles.delete(filePath);
    this.updatePinnedFilesUI();
    vscode.window.showInformationMessage(`Arquivo desafixado: ${filePath}`);
  }

  private updatePinnedFilesUI() {
    this.view?.webview.postMessage({ type: 'updatePinnedFiles', files: Array.from(this.pinnedFiles) });
  }

  private async resolveMessageContext(message: string): Promise<string> {
    const mentionRegex = /@([a-zA-Z0-9_.\-\/]+)/g;
    const resolvedMessage = message;
    let contextData = '';

    // 1) Pinned files
    if (this.pinnedFiles.size > 0) {
      contextData += '\n\n--- ARQUIVOS FIXADOS (PINNED) ---\n';
      for (const pinnedFile of this.pinnedFiles) {
        try {
          const files = await vscode.workspace.findFiles(pinnedFile);
          if (files.length === 0) continue;
          const content = await fs.promises.readFile(files[0].fsPath, 'utf8');
          contextData += `\n# ${pinnedFile}\n${content}\n`;
        } catch (e) {
          Logger.error(`Erro ao ler arquivo fixado: ${pinnedFile}`, e);
        }
      }
      contextData += '\n---------------------------------\n';
    }

    // 2) Mentions
    const matches = message.match(mentionRegex);
    if (matches) {
      for (const match of matches) {
        const filename = match.substring(1);
        try {
          const files = await vscode.workspace.findFiles(filename);
          if (files.length === 0) continue;
          const fileUri = files[0];
          const content = await fs.promises.readFile(fileUri.fsPath, 'utf8');
          contextData += `\n\n--- CONTEXTO DO ARQUIVO: ${vscode.workspace.asRelativePath(fileUri)} ---\n${content}\n----------------------------------\n`;
        } catch (e) {
          Logger.error(`Erro ao ler arquivo mencionado: ${filename}`, e);
        }
      }
    }

    return resolvedMessage + contextData;
  }

  public getEditorContext(editor: vscode.TextEditor): string {
    const document = editor.document;
    const currentLine = editor.selection.active.line;
    const startLine = Math.max(0, currentLine - 5);
    const endLine = Math.min(document.lineCount - 1, currentLine + 5);

    const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
    return document.getText(range);
  }

  public buildGeneratePrompt(userPrompt: string, language: string, context: string): string {
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

  public buildEditPrompt(originalCode: string, editInstruction: string, language: string): string {
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

  private getHtmlForWebview(webview: vscode.Webview): string {
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

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
