import * as vscode from 'vscode';
import { OllamaService } from './ollama';
import { DiffManager } from './diffManager';
import { ChatPanel } from './chatPanel'; // Import the new ChatPanel class
import { OllamaInlineCompletionProvider } from './providers/inlineCompletionProvider';
import { OllamaQuickFixProvider } from './providers/quickFixProvider';
import { RAGService } from './services/ragService';
import { Logger } from './utils/logger';



export function activate(context: vscode.ExtensionContext) {
    Logger.init(context);
    Logger.info('Ollama Code Diff extension ativada! (Versão com diagnóstico)');

    const ollamaService = new OllamaService();
    const diffManager = new DiffManager();
    // Initialize RAG Service early
    const ragService = new RAGService(context, ollamaService);

    // Pass ragService to ChatPanel
    const chatPanel = new ChatPanel(context.extensionUri, ollamaService, diffManager, ragService, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatPanel.viewId, chatPanel)
    );

    // Register Inline Completion Provider (Ghost Text)
    const provider = new OllamaInlineCompletionProvider(ollamaService);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)
    );

    const statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarButton.text = "$(robot) Ollama";
    statusBarButton.tooltip = "Ollama Code Diff - Clique para ver opções";
    statusBarButton.command = 'ollama-code-diff.showMenu';
    statusBarButton.show();

    const showMenuCommand = vscode.commands.registerCommand(
        'ollama-code-diff.showMenu',
        async () => {
            await showOllamaMenu(ollamaService, diffManager, chatPanel, ragService); // Pass chatPanel instance
        }
    );

    const showConfigurationMenuCommand = vscode.commands.registerCommand(
        'ollama-code-diff.showConfigurationMenu',
        async () => {
            await showConfigurationMenu(ragService);
        }
    );

    const generateCodeCommand = vscode.commands.registerCommand(
        'ollama-code-diff.generateCode',
        async () => {
            await handleGenerateCode(ollamaService, diffManager, chatPanel);
        }
    );

    const editCodeCommand = vscode.commands.registerCommand(
        'ollama-code-diff.editCode',
        async () => {
            await handleEditCode(ollamaService, diffManager, chatPanel);
        }
    );

    const analyzeFileCommand = vscode.commands.registerCommand(
        'ollama-code-diff.analyzeFile',
        async () => {
            await handleAnalyzeFile(ollamaService);
        }
    );

    const analyzeProjectCommand = vscode.commands.registerCommand(
        'ollama-code-diff.analyzeProject',
        async () => {
            await handleAnalyzeProject(ollamaService);
        }
    );

    const analyzeMultipleFilesCommand = vscode.commands.registerCommand(
        'ollama-code-diff.analyzeMultipleFiles',
        async () => {
            await handleAnalyzeMultipleFiles(ollamaService);
        }
    );

    const showDiffCommand = vscode.commands.registerCommand(
        'ollama-code-diff.showDiff',
        async () => {
            await diffManager.showLastDiff();
        }
    );

    const undoLastAppliedChangesCommand = vscode.commands.registerCommand(
        'ollama-code-diff.undoLastAppliedChanges',
        async () => {
            await diffManager.undoLastAppliedChanges();
        }
    );

    const validateConfigCommand = vscode.commands.registerCommand(
        'ollama-code-diff.validateConfig',
        async () => {
            await validateOllamaConfig(ollamaService, { showSuccess: true });
        }
    );

    const lspRenameSymbolCommand = vscode.commands.registerCommand(
        'ollama-code-diff.lspRenameSymbol',
        async () => {
            await runEditorLspCommand('editor.action.rename');
        }
    );

    const lspOrganizeImportsCommand = vscode.commands.registerCommand(
        'ollama-code-diff.lspOrganizeImports',
        async () => {
            await runEditorLspCommand('editor.action.organizeImports');
        }
    );

    const lspCodeActionsCommand = vscode.commands.registerCommand(
        'ollama-code-diff.lspCodeActions',
        async () => {
            await runEditorLspCommand('editor.action.codeAction');
        }
    );

    const lspQuickFixCommand = vscode.commands.registerCommand(
        'ollama-code-diff.lspQuickFix',
        async () => {
            await runEditorLspCommand('editor.action.quickFix');
        }
    );

    context.subscriptions.push(
        statusBarButton,
        showMenuCommand,
        showConfigurationMenuCommand,
        generateCodeCommand,
        editCodeCommand,
        analyzeFileCommand,
        analyzeProjectCommand,
        analyzeMultipleFilesCommand,
        showDiffCommand,
        undoLastAppliedChangesCommand,
        validateConfigCommand,
        lspRenameSymbolCommand,
        lspOrganizeImportsCommand,
        lspCodeActionsCommand,
        lspQuickFixCommand
    );

    // Register Quick Fix Provider
    const quickFixProvider = new OllamaQuickFixProvider(ollamaService);
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider({ pattern: '**' }, quickFixProvider)
    );

    // Register Fix Command
    const fixDiagnosticCommand = vscode.commands.registerCommand(
        'ollama-code-diff.fixDiagnostic',
        async (document: vscode.TextDocument, range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
            await handleFixDiagnostic(document, range, diagnostics, ollamaService, diffManager);
        }
    );
    context.subscriptions.push(fixDiagnosticCommand);

    // RAG Service is already initialized at the top

    const indexCodebaseCommand = vscode.commands.registerCommand(
        'ollama-code-diff.indexCodebase',
        async () => {
            const config = vscode.workspace.getConfiguration('ollama-code-diff');
            const embeddingModel = config.get<string>('embeddingModelName', 'nomic-embed-text');
            try {
                await ragService.indexWorkspace();
            } catch (e) {
                vscode.window.showErrorMessage(`Falha na indexação. Certifique-se de ter o modelo '${embeddingModel}' instalado. Erro: ${e}`);
            }
        }
    );

    const semanticSearchCommand = vscode.commands.registerCommand(
        'ollama-code-diff.semanticSearch',
        async () => {
            const query = await vscode.window.showInputBox({ prompt: 'O que você procura no código?' });
            if (query) {
                vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Buscando..." }, async () => {
                    const results = await ragService.search(query, 5);
                    const resultText = results.map(r => `### ${vscode.workspace.asRelativePath(r.filePath)}\nScore: ${(r.score || 0).toFixed(3)}\n\`\`\`\n${r.content.substring(0, 300)}...\n\`\`\``).join('\n\n');

                    const doc = await vscode.workspace.openTextDocument({
                        content: `# Resultados Semânticos para: "${query}"\n\n${resultText}`,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
                });
            }
        }
    );

    context.subscriptions.push(indexCodebaseCommand, semanticSearchCommand);

    // Incremental Indexing on Save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            await ragService.indexFile(document.uri);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('ollama-code-diff.enableVerboseLogs')) {
                Logger.refreshConfig();
            }

            if (
                event.affectsConfiguration('ollama-code-diff.modelName') ||
                event.affectsConfiguration('ollama-code-diff.completionModelName') ||
                event.affectsConfiguration('ollama-code-diff.embeddingModelName') ||
                event.affectsConfiguration('ollama-code-diff.ollamaHost') ||
                event.affectsConfiguration('ollama-code-diff.enableGhostText')
            ) {
                validateOllamaConfig(ollamaService);
            }
        })
    );

    const validateTimer = setTimeout(() => {
        validateOllamaConfig(ollamaService);
    }, 1000);
    context.subscriptions.push({ dispose: () => clearTimeout(validateTimer) });
}

// Handler for Quick Fix
async function handleFixDiagnostic(
    document: vscode.TextDocument,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[],
    ollamaService: OllamaService,
    diffManager: DiffManager
) {
    if (diagnostics.length === 0) return;

    const diagnostic = diagnostics[0]; // Focus on the first/primary error
    const errorText = document.getText(diagnostic.range);
    const errorMessage = diagnostic.message;

    // Expand context a bit
    const startLine = Math.max(0, range.start.line - 2);
    const endLine = Math.min(document.lineCount - 1, range.end.line + 2);
    const contextRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
    const contextCode = document.getText(contextRange);

    const prompt = `Fix the following error in the code:\nERROR: ${errorMessage}\n\nCODE CONTEXT:\n\`\`\`${document.languageId}\n${contextCode}\n\`\`\`\n\nProvide only the fixed code for the context block without explanations.`;

    try {
        const fixedCode = await runWithCancelableProgress(
            'Corrigindo com IA...',
            (signal) => ollamaService.generateCode(prompt, { signal })
        );

        await diffManager.showCodeDiff(
            vscode.window.activeTextEditor!,
            fixedCode,
            'AI Fix',
            contextRange // Replace the context range
        );

    } catch (error) {
        if (isTimeoutError(error)) {
            vscode.window.showWarningMessage('Tempo limite atingido.');
            return;
        }
        if (isAbortError(error)) {
            vscode.window.showWarningMessage('Operação cancelada.');
            return;
        }
        vscode.window.showErrorMessage(`Failed to fix diagnostic: ${error}`);
    }
}

function isAbortError(err: unknown): boolean {
    if (!err) return false;
    const anyErr = err as any;
    return anyErr?.name === 'AbortError' || /aborted/i.test(String(anyErr?.message || ''));
}

function isTimeoutError(err: unknown): boolean {
    if (!err) return false;
    const anyErr = err as any;
    return anyErr?.name === 'TimeoutError' || /timeout/i.test(String(anyErr?.message || ''));
}

async function runWithCancelableProgress<T>(
    title: string,
    task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    return await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: true },
        async (_progress, token) => {
            const controller = new AbortController();
            const sub = token.onCancellationRequested(() => controller.abort());
            try {
                return await task(controller.signal);
            } finally {
                sub.dispose();
            }
        }
    );
}

async function runEditorLspCommand(command: string): Promise<void> {
    if (!vscode.window.activeTextEditor) {
        vscode.window.showWarningMessage('Abra um arquivo para executar esta ação LSP.');
        return;
    }

    try {
        await vscode.commands.executeCommand(command);
    } catch (error) {
        vscode.window.showErrorMessage(`Falha ao executar ação LSP: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Flexible model name matching - handles cases like:
 * - "nomic-embed-text" matches "nomic-embed-text:latest"
 * - "qwen2.5-coder:7b" matches exactly
 */
function modelMatchesAny(configuredModel: string, availableModels: string[]): boolean {
    const normalizedConfig = configuredModel.toLowerCase().trim();

    for (const available of availableModels) {
        const normalizedAvailable = available.toLowerCase().trim();

        // Exact match
        if (normalizedConfig === normalizedAvailable) {
            return true;
        }

        // Config without tag matches available with :latest
        if (normalizedAvailable === `${normalizedConfig}:latest`) {
            return true;
        }

        // Config with tag, check base name + tag match
        if (normalizedConfig.includes(':')) {
            const configBase = normalizedConfig.split(':')[0];
            const configTag = normalizedConfig.split(':')[1];
            const availableBase = normalizedAvailable.split(':')[0];
            const availableTag = normalizedAvailable.split(':')[1] || 'latest';
            if (configBase === availableBase && configTag === availableTag) {
                return true;
            }
        }

        // Available base name matches config (ignoring :latest)
        const availableBase = normalizedAvailable.split(':')[0];
        if (normalizedConfig === availableBase) {
            return true;
        }
    }

    return false;
}

async function validateOllamaConfig(
    ollamaService: OllamaService,
    options: { showSuccess?: boolean } = {}
) {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const host = config.get<string>('ollamaHost', 'http://localhost:11434');
    const modelName = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
    const completionModelName = config.get<string>('completionModelName', modelName);
    const embeddingModelName = config.get<string>('embeddingModelName', 'nomic-embed-text');
    const ghostTextEnabled = config.get<boolean>('enableGhostText', true);

    const models = await ollamaService.listModels();
    if (!models) {
        Logger.warn(`Não foi possível conectar ao Ollama em ${host}.`);
        const action = await vscode.window.showWarningMessage(
            `Não foi possível conectar ao Ollama em ${host}. Verifique se o servidor está rodando.`,
            'Abrir Settings',
            'Testar Conexão'
        );
        if (action === 'Abrir Settings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-diff');
        } else if (action === 'Testar Conexão') {
            await checkOllamaStatus(ollamaService);
        }
        return;
    }

    const missing = new Set<string>();
    if (modelName && !modelMatchesAny(modelName, models)) missing.add(modelName);
    if (ghostTextEnabled && completionModelName && !modelMatchesAny(completionModelName, models)) missing.add(completionModelName);
    if (embeddingModelName && !modelMatchesAny(embeddingModelName, models)) missing.add(embeddingModelName);

    if (missing.size === 0) {
        Logger.info('Validação de configuração OK.');
        if (options.showSuccess) {
            vscode.window.showInformationMessage('Configuração do Ollama OK.');
        }
        return;
    }

    const missingList = Array.from(missing);
    Logger.warn(`Modelos não encontrados: ${missingList.join(', ')}`);
    const action = await vscode.window.showWarningMessage(
        `Modelos não encontrados: ${missingList.join(', ')}.`,
        'Abrir Settings',
        'Copiar ollama pull'
    );

    if (action === 'Abrir Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-diff');
    } else if (action === 'Copiar ollama pull') {
        const commands = missingList.map((name) => `ollama pull ${name}`).join('\n');
        await vscode.env.clipboard.writeText(commands);
        vscode.window.showInformationMessage('Comandos copiados para a área de transferência.');
    }
}

async function showOllamaMenu(
    ollamaService: OllamaService,
    diffManager: DiffManager,
    chatPanel: ChatPanel,
    ragService: RAGService
) {
    const editor = vscode.window.activeTextEditor;
    const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;

    // Criar itens do menu baseado no contexto
    const menuItems = [
        {
            label: "$(add) Gerar Código",
            description: "Criar novo código com IA",
            detail: "Gera código baseado em sua descrição"
        },
        {
            label: "$(edit) Editar Código",
            description: editor?.selection && !editor.selection.isEmpty ? "Editar código selecionado" : "Selecione código primeiro",
            detail: "Modifica código selecionado conforme instrução"
        },
        {
            label: "$(search) Analisar Arquivo",
            description: editor ? `Analisar ${editor.document.fileName.split('/').pop()}` : "Abra um arquivo primeiro",
            detail: "Análise completa do arquivo atual"
        }
    ];

    // Adicionar opções de projeto se houver workspace
    if (hasWorkspace) {
        menuItems.push(
            {
                label: "$(folder-opened) Analisar Projeto",
                description: "Análise completa do projeto",
                detail: "Mapeia e analisa toda estrutura do projeto"
            },
            {
                label: "$(files) Múltiplos Arquivos",
                description: "Selecionar arquivos específicos",
                detail: "Análise comparativa de arquivos selecionados"
            }
        );
    }

    // Adicionar opções de configuração
    menuItems.push(
        {
            label: "$(gear) Configurações",
            description: "Configurar Ollama",
            detail: "Modelo, contexto e outras configurações"
        },
        {
            label: "$(info) Status da Conexão",
            description: "Verificar conexão com Ollama",
            detail: "Testa se Ollama está funcionando"
        }
    );

    const selected = await vscode.window.showQuickPick(menuItems, {
        placeHolder: "Escolha uma ação do Ollama Code Diff",
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (!selected) return;

    // Executar ação baseada na seleção
    switch (selected.label) {
        case "$(add) Gerar Código":
            await handleGenerateCode(ollamaService, diffManager, chatPanel);
            break;
        case "$(edit) Editar Código":
            await handleEditCode(ollamaService, diffManager, chatPanel);
            break;
        case "$(search) Analisar Arquivo":
            await handleAnalyzeFile(ollamaService);
            break;
        case "$(folder-opened) Analisar Projeto":
            await handleAnalyzeProject(ollamaService);
            break;
        case "$(files) Múltiplos Arquivos":
            await handleAnalyzeMultipleFiles(ollamaService);
            break;
        case "$(gear) Configurações":
            await showConfigurationMenu(ragService);
            break;
        case "$(info) Status da Conexão":
            await checkOllamaStatus(ollamaService);
            break;
    }
}

async function showConfigurationMenu(ragService: RAGService) {
    const hasExistingIndex = ragService.hasIndex();
    const indexActionLabel = hasExistingIndex
        ? "$(sync) Reindexar Projeto (RAG)"
        : "$(database) Indexar Projeto (RAG)";
    const configItems = [
        {
            label: indexActionLabel,
            description: hasExistingIndex
                ? "Recriar o indice semantico do projeto"
                : "Indexar codebase para busca semantica",
            detail: hasExistingIndex
                ? "Executa nova indexacao completa do workspace"
                : "Permite que a IA 'leia' todo o projeto"
        },
        {
            label: "$(symbol-class) Modelo Ollama",
            description: "Alterar modelo de IA",
            detail: "CodeLlama, Qwen2.5, DeepSeek, etc."
        },
        {
            label: "$(symbol-numeric) Tamanho do Contexto",
            description: "Configurar num_ctx",
            detail: "16K, 32K, 64K tokens"
        },
        {
            label: "$(symbol-variable) Tokens Máximos",
            description: "Configurar num_predict",
            detail: "4K, 8K, 16K tokens de saída"
        },
        {
            label: "$(check) Validar Configuração",
            description: "Checar modelos disponíveis",
            detail: "Verifica se modelos configurados existem"
        },
        {
            label: "$(notebook) Abrir Settings",
            description: "Edição manual das configurações",
            detail: "Abrir configurações do VS Code"
        }
    ];

    const selected = await vscode.window.showQuickPick(configItems, {
        placeHolder: "Configurações do Ollama Code Diff"
    });

    if (!selected) return;

    switch (selected.label) {
        case "$(sync) Reindexar Projeto (RAG)":
        case "$(database) Indexar Projeto (RAG)":
            await vscode.commands.executeCommand('ollama-code-diff.indexCodebase');
            break;
        case "$(symbol-class) Modelo Ollama":
            await changeModelAdvanced();
            break;
        case "$(symbol-numeric) Tamanho do Contexto":
            await changeContextSize();
            break;
        case "$(symbol-variable) Tokens Máximos":
            await changeMaxTokens();
            break;
        case "$(check) Validar Configuração":
            await vscode.commands.executeCommand('ollama-code-diff.validateConfig');
            break;
        case "$(notebook) Abrir Settings":
            await vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-diff');
            break;
    }
}

// NOVA FUNÇÃO: Alterar modelo
// ATUALIZADA: Função para alterar modelo com lista dinâmica
async function changeModel() {
    try {
        // Obter modelos reais do usuário
        const ollamaService = new OllamaService();
        const availableModels = await ollamaService.getAvailableModels();

        if (availableModels.length === 0) {
            vscode.window.showErrorMessage('Nenhum modelo encontrado. Verifique se o Ollama está rodando.');
            return;
        }

        // Criar itens do QuickPick com informações detalhadas
        const modelDetails = await ollamaService.getModelDetails();
        const modelItems = modelDetails.map(model => ({
            label: model.name,
            description: `${model.size}`,
            detail: `Modificado: ${model.modified}`
        }));

        const selectedModel = await vscode.window.showQuickPick(modelItems, {
            placeHolder: `Escolha o modelo Ollama (${availableModels.length} disponíveis)`
        });

        if (selectedModel) {
            const config = vscode.workspace.getConfiguration('ollama-code-diff');
            await config.update('modelName', selectedModel.label, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`✅ Modelo alterado para: ${selectedModel.label}`);
        }

    } catch (error) {
        vscode.window.showErrorMessage(`❌ Erro ao obter modelos: ${error}`);

        // Fallback para lista manual se API falhar
        await changeModelFallback();
    }
}

// Função de fallback com lista manual
async function changeModelFallback() {
    const manualModels = [
        'qwen2.5-coder:1.5b-base',
        'qwen2.5-coder:7b',
        'qwen2.5:14b',
        'codellama:7b-instruct-q5_K_M',
        'deepseek-r1:1.5b',
        'phi4:14b-q4_k_m',
        'phi4:14b-q8_0',
        'dotnet-specialist-phi4-14b-q4-k-m:latest',
        'dotnet-specialist-qwen2-5-7b:latest',
        'gemma3:12b'
    ];

    const selectedModel = await vscode.window.showQuickPick(manualModels, {
        placeHolder: 'Escolha o modelo Ollama (lista manual)'
    });

    if (selectedModel) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        await config.update('modelName', selectedModel, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`✅ Modelo alterado para: ${selectedModel}`);
    }
}

// NOVA: Função para alterar modelo com informações completas
async function changeModelAdvanced() {
    try {
        vscode.window.showInformationMessage("🔍 Buscando modelos disponíveis...");

        const ollamaService = new OllamaService();
        const modelDetails = await ollamaService.getModelDetails();

        if (modelDetails.length === 0) {
            vscode.window.showErrorMessage('❌ Nenhum modelo encontrado. Execute: ollama list');
            return;
        }

        // Criar itens com ícones baseados no tamanho
        const modelItems = modelDetails.map(model => {
            let icon = '📦';
            const sizeNum = parseFloat(model.size);

            if (model.size.includes('GB')) {
                if (sizeNum > 10) icon = '🐘'; // Modelo muito grande
                else if (sizeNum > 5) icon = '🦏'; // Modelo grande  
                else icon = '🐃'; // Modelo médio
            } else if (model.size.includes('MB')) {
                icon = '🐭'; // Modelo pequeno
            }

            return {
                label: `${icon} ${model.name}`,
                description: `${model.size}`,
                detail: `Modificado: ${model.modified}`
            };
        });

        const selected = await vscode.window.showQuickPick(modelItems, {
            placeHolder: `🎯 Escolha o modelo (${modelDetails.length} disponíveis)`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const modelName = selected.label.replace(/^.+ /, ''); // Remove o ícone

            const config = vscode.workspace.getConfiguration('ollama-code-diff');
            await config.update('modelName', modelName, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(
                `✅ Modelo alterado para: ${modelName}`,
                'Testar Modelo'
            ).then(action => {
                if (action === 'Testar Modelo') {
                    checkOllamaStatus(ollamaService);
                }
            });
        }

    } catch (error) {
        vscode.window.showErrorMessage(`❌ Erro: ${error}`);
    }
}

// NOVA FUNÇÃO: Alterar contexto
async function changeContextSize() {
    const sizes = ['8192', '16384', '32768', '65536'];

    const selected = await vscode.window.showQuickPick(sizes, {
        placeHolder: 'Escolha o tamanho do contexto'
    });

    if (selected) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        await config.update('contextSize', parseInt(selected), vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Contexto alterado para: ${selected} tokens`);
    }
}

// NOVA FUNÇÃO: Alterar tokens máximos
async function changeMaxTokens() {
    const tokens = ['2048', '4096', '8192', '16384'];

    const selected = await vscode.window.showQuickPick(tokens, {
        placeHolder: 'Escolha tokens máximos'
    });

    if (selected) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        await config.update('maxTokens', parseInt(selected), vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Tokens máximos alterado para: ${selected}`);
    }
}

// NOVA FUNÇÃO: Verificar status do Ollama
async function checkOllamaStatus(ollamaService: OllamaService) {
    try {
        vscode.window.showInformationMessage("Verificando conexão com Ollama...");

        const isConnected = await ollamaService.testConnection();
        const modelInfo = await ollamaService.getModelInfo();

        if (isConnected && modelInfo) {
            vscode.window.showInformationMessage(
                `✅ Ollama conectado! Modelo: ${modelInfo.model}`
            );
        } else {
            vscode.window.showErrorMessage("❌ Ollama não está respondendo. Verifique se está rodando.");
        }
    } catch (error) {
        vscode.window.showErrorMessage(`❌ Erro na conexão: ${error}`);
    }
}

// Função para gerar código
async function handleGenerateCode(ollamaService: OllamaService, diffManager: DiffManager, chatPanel: ChatPanel) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('Nenhum editor ativo encontrado');
        return;
    }

    const prompt = await vscode.window.showInputBox({
        prompt: 'Descreva o código que você quer gerar:',
        placeHolder: 'Ex: Função para ordenar uma lista de números'
    });

    if (!prompt) return;

    try {
        const language = editor.document.languageId;
        const context = chatPanel.getEditorContext(editor);

        const fullPrompt = chatPanel.buildGeneratePrompt(prompt, language, context);
        const generatedCode = await runWithCancelableProgress(
            'Gerando código...',
            (signal) => ollamaService.generateCode(fullPrompt, { signal })
        );

        await diffManager.showCodeDiff(editor, generatedCode, 'Código Gerado');

    } catch (error) {
        if (isTimeoutError(error)) {
            vscode.window.showWarningMessage('Tempo limite atingido.');
            return;
        }
        if (isAbortError(error)) {
            vscode.window.showWarningMessage('Operação cancelada.');
            return;
        }
        vscode.window.showErrorMessage(`Erro ao gerar código: ${error}`);
    }
}

// Função para editar código
async function handleEditCode(ollamaService: OllamaService, diffManager: DiffManager, chatPanel: ChatPanel) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('Nenhum editor ativo encontrado');
        return;
    }

    const selection = editor.selection;
    const selectedCode = editor.document.getText(selection);

    if (!selectedCode) {
        vscode.window.showErrorMessage('Selecione o código que deseja editar');
        return;
    }

    const editInstruction = await vscode.window.showInputBox({
        prompt: 'Como você quer editar este código?',
        placeHolder: 'Ex: Adicionar tratamento de erro, otimizar performance'
    });

    if (!editInstruction) return;

    try {
        const language = editor.document.languageId;
        const fullPrompt = chatPanel.buildEditPrompt(selectedCode, editInstruction, language);
        const editedCode = await runWithCancelableProgress(
            'Editando código...',
            (signal) => ollamaService.generateCode(fullPrompt, { signal })
        );

        await diffManager.showCodeDiff(
            editor,
            editedCode,
            'Código Editado',
            selection
        );

    } catch (error) {
        if (isTimeoutError(error)) {
            vscode.window.showWarningMessage('Tempo limite atingido.');
            return;
        }
        if (isAbortError(error)) {
            vscode.window.showWarningMessage('Operação cancelada.');
            return;
        }
        vscode.window.showErrorMessage(`Erro ao editar código: ${error}`);
    }
}

// Função para analisar arquivo
async function handleAnalyzeFile(ollamaService: OllamaService) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('Nenhum editor ativo encontrado');
        return;
    }

    const instruction = await vscode.window.showInputBox({
        prompt: 'O que você quer analisar neste arquivo?',
        placeHolder: 'Ex: Encontrar bugs, otimizar performance, refatorar código'
    });

    if (!instruction) return;

    try {
        const result = await runWithCancelableProgress(
            'Analisando arquivo...',
            (signal) => ollamaService.analyzeFile(editor.document.fileName, instruction, { signal })
        );

        const doc = await vscode.workspace.openTextDocument({
            content: `# Análise do Arquivo: ${editor.document.fileName}\n\n**Instrução:** ${instruction}\n\n---\n\n${result}`,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

        vscode.window.showInformationMessage('Análise concluída!');

    } catch (error) {
        if (isTimeoutError(error)) {
            vscode.window.showWarningMessage('Tempo limite atingido.');
            return;
        }
        if (isAbortError(error)) {
            vscode.window.showWarningMessage('Operação cancelada.');
            return;
        }
        vscode.window.showErrorMessage(`Erro na análise: ${error}`);
    }
}

// Função para analisar projeto completo
async function handleAnalyzeProject(ollamaService: OllamaService) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Nenhum workspace aberto');
        return;
    }

    const instruction = await vscode.window.showInputBox({
        prompt: 'O que você quer analisar no projeto?',
        placeHolder: 'Ex: Encontrar padrões de arquitetura, revisar segurança'
    });

    if (!instruction) return;

    try {
        const projectContext = await runWithCancelableProgress(
            'Analisando projeto completo...',
            (signal) => ollamaService.analyzeProject(workspaceFolder.uri.fsPath, instruction, { signal })
        );

        const doc = await vscode.workspace.openTextDocument({
            content: `# Análise do Projeto: ${workspaceFolder.name}\n\n**Instrução:** ${instruction}\n\n---\n\n${projectContext}`,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

    } catch (error) {
        if (isTimeoutError(error)) {
            vscode.window.showWarningMessage('Tempo limite atingido.');
            return;
        }
        if (isAbortError(error)) {
            vscode.window.showWarningMessage('Operação cancelada.');
            return;
        }
        vscode.window.showErrorMessage(`Erro na análise do projeto: ${error}`);
    }
}

// Função para analisar múltiplos arquivos
async function handleAnalyzeMultipleFiles(ollamaService: OllamaService) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Nenhum workspace aberto');
        return;
    }

    const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h}', '**/node_modules/**');

    const fileItems = files.map(file => ({
        label: vscode.workspace.asRelativePath(file),
        description: file.fsPath,
        picked: false
    }));

    const selectedFiles = await vscode.window.showQuickPick(fileItems, {
        canPickMany: true,
        placeHolder: 'Selecione os arquivos para análise (múltipla seleção)'
    });

    if (!selectedFiles || selectedFiles.length === 0) return;

    const instruction = await vscode.window.showInputBox({
        prompt: 'O que você quer analisar nos arquivos selecionados?',
        placeHolder: 'Ex: Comparar implementações, encontrar inconsistências'
    });

    if (!instruction) return;

    try {
        const filePaths = selectedFiles.map(item => item.description!);
        const result = await runWithCancelableProgress(
            `Analisando ${selectedFiles.length} arquivos...`,
            (signal) => ollamaService.analyzeMultipleFiles(filePaths, instruction, { signal })
        );

        const doc = await vscode.workspace.openTextDocument({
            content: `# Análise de Múltiplos Arquivos\n\n**Arquivos:** ${selectedFiles.map(f => f.label).join(', ')}\n\n**Instrução:** ${instruction}\n\n---\n\n${result}`,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

    } catch (error) {
        if (isTimeoutError(error)) {
            vscode.window.showWarningMessage('Tempo limite atingido.');
            return;
        }
        if (isAbortError(error)) {
            vscode.window.showWarningMessage('Operação cancelada.');
            return;
        }
        vscode.window.showErrorMessage(`Erro na análise: ${error}`);
    }
}

export function deactivate() { }
