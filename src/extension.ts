import * as vscode from 'vscode';
import { OllamaService } from './ollama';
import { DiffManager } from './diffManager';
import { ChatPanel } from './chatPanel'; // Import the new ChatPanel class



export function activate(context: vscode.ExtensionContext) {
    console.log('Ollama Code Diff extension ativada! (Versão com diagnóstico)');

    const ollamaService = new OllamaService();
    const diffManager = new DiffManager();
    const chatPanel = new ChatPanel(context.extensionUri, ollamaService, diffManager);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatPanel.viewId, chatPanel)
    );

    const statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarButton.text = "$(robot) Ollama";
    statusBarButton.tooltip = "Ollama Code Diff - Clique para ver opções";
    statusBarButton.command = 'ollama-code-diff.showMenu';
    statusBarButton.show();

    const showMenuCommand = vscode.commands.registerCommand(
        'ollama-code-diff.showMenu',
        async () => {
            await showOllamaMenu(ollamaService, diffManager, chatPanel); // Pass chatPanel instance
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

    context.subscriptions.push(
        statusBarButton,
        showMenuCommand,
        generateCodeCommand,
        editCodeCommand,
        analyzeFileCommand,
        analyzeProjectCommand,
        analyzeMultipleFilesCommand,
        showDiffCommand
    );
}

async function showOllamaMenu(ollamaService: OllamaService, diffManager: DiffManager, chatPanel: ChatPanel) {
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
            await showConfigurationMenu();
            break;
        case "$(info) Status da Conexão":
            await checkOllamaStatus(ollamaService);
            break;
    }
}

async function showConfigurationMenu() {
    const configItems = [
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
            label: "$(notebook) Abrir Settings",
            description: "Edição manual das configurações",
            detail: "Abrir configurações do VS Code"
        }
    ];

    const selected = await vscode.window.showQuickPick(configItems, {
        placeHolder: "Configurações do Ollama Code Diff"
    });

    if (!selected) return;

    // NOVO: Implementar ações para cada opção
    switch (selected.label) {
        case "$(symbol-class) Modelo Ollama":
            await changeModelAdvanced();
            break;
        case "$(symbol-numeric) Tamanho do Contexto":
            await changeContextSize();
            break;
        case "$(symbol-variable) Tokens Máximos":
            await changeMaxTokens();
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
        vscode.window.showInformationMessage('Gerando código...');
        
        const language = editor.document.languageId;
        const context = chatPanel.getEditorContext(editor);
        
        const fullPrompt = chatPanel.buildGeneratePrompt(prompt, language, context);
        const generatedCode = await ollamaService.generateCode(fullPrompt);
        
        await diffManager.showCodeDiff(editor, generatedCode, 'Código Gerado');
        
    } catch (error) {
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
        vscode.window.showInformationMessage('Editando código...');
        
        const language = editor.document.languageId;
        const fullPrompt = chatPanel.buildEditPrompt(selectedCode, editInstruction, language);
        const editedCode = await ollamaService.generateCode(fullPrompt);
        
        await diffManager.showCodeDiff(
            editor, 
            editedCode, 
            'Código Editado',
            selection
        );
        
    } catch (error) {
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
        vscode.window.showInformationMessage('Analisando arquivo...');
        
        const result = await ollamaService.analyzeFile(editor.document.fileName, instruction);
        
        const doc = await vscode.workspace.openTextDocument({
            content: `# Análise do Arquivo: ${editor.document.fileName}\n\n**Instrução:** ${instruction}\n\n---\n\n${result}`,
            language: 'markdown'
        });
        
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        
        vscode.window.showInformationMessage('Análise concluída!');
        
    } catch (error) {
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
        vscode.window.showInformationMessage('Analisando projeto completo...');
        
        const projectContext = await ollamaService.analyzeProject(workspaceFolder.uri.fsPath, instruction);
        
        const doc = await vscode.workspace.openTextDocument({
            content: `# Análise do Projeto: ${workspaceFolder.name}\n\n**Instrução:** ${instruction}\n\n---\n\n${projectContext}`,
            language: 'markdown'
        });
        
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        
    } catch (error) {
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
        vscode.window.showInformationMessage(`Analisando ${selectedFiles.length} arquivos...`);
        
        const filePaths = selectedFiles.map(item => item.description!);
        const result = await ollamaService.analyzeMultipleFiles(filePaths, instruction);
        
        const doc = await vscode.workspace.openTextDocument({
            content: `# Análise de Múltiplos Arquivos\n\n**Arquivos:** ${selectedFiles.map(f => f.label).join(', ')}\n\n**Instrução:** ${instruction}\n\n---\n\n${result}`,
            language: 'markdown'
        });
        
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        
    } catch (error) {
        vscode.window.showErrorMessage(`Erro na análise: ${error}`);
    }
}

    export function deactivate() {}