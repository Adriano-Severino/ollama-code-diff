import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path'; // Import path
// Removed: import { exec } from 'child_process'; // Removed as we are using vscode.window.createTerminal

import { OllamaService } from './ollama';
import { DiffManager } from './diffManager';

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewId = 'ollama-code-diff.chatView';

    private _view?: vscode.WebviewView;
    private _chatHistory: Array<{ role: string, content: string }> = [];
    private _currentMode: 'chat' | 'agent' = 'chat'; // Default to chat mode

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private _ollamaService: OllamaService,
        private _diffManager: DiffManager
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'sendMessage':
                    const userMessage = message.text;
                    const mode = message.mode;
                    this._chatHistory.push({ role: 'user', content: userMessage });
                    this._view?.webview.postMessage({ type: 'addMessage', sender: 'user', text: userMessage });

                    if (mode === 'agent') {
                        await this._handleAgentMessage(userMessage);
                    } else {
                        await this._handleChatMessage(userMessage);
                    }
                    break;
                case 'requestModels':
                    this._requestModels();
                    break;
                case 'setSelectedModel':
                    this._setSelectedModel(message.modelName);
                    break;
                case 'requestCurrentModel':
                    this._requestCurrentModel();
                    break;
                case 'changeMode':
                    this._currentMode = message.mode;
                    vscode.window.showInformationMessage(`Modo alterado para: ${this._currentMode}`);
                    break;
            }
        });
    }

    private async _handleChatMessage(userMessage: string) {
        if (!this._view) return;
        try {
            this._view.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Digitando...' });
            const ollamaResponse = await this._ollamaService.chatWithOllama(userMessage, this._chatHistory);
            this._chatHistory.push({ role: 'assistant', content: ollamaResponse });
            this._view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: ollamaResponse });
        } catch (error) {
            const errorMessage = `Erro: ${error instanceof Error ? error.message : String(error)}`;
            this._view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: errorMessage });
            vscode.window.showErrorMessage(`Erro no chat: ${errorMessage}`);
        }
    }

    private async _handleAgentMessage(userMessage: string) {
        if (!this._view) return;
        let agentResponse = "";
        this._view.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Pensando...' });

        // Corrected toolsDescription string with proper escaping
        const toolsDescription = `\n        Você é um agente de IA que pode interagir com o ambiente do VS Code. Você tem acesso às seguintes ferramentas:\n\n        1.  **run**: Executa um comando no terminal. Útil para comandos de shell, npm, git, etc.\n            Uso: /run <command>\n            Exemplo: /run npm install\n            Formato JSON esperado:\n            \`\`\`json\n            {\n              \"tool\": \"run\",\n              \"args\": {\n                \"command\": \"npm install\"\n              }\n            }\n            \`\`\`\n\n        2.  **read**: Lê o conteúdo de um arquivo.\n            Uso: /read <caminho_do_arquivo>\n            Exemplo: /read src/extension.ts\n\n        3.  **write**: Escreve conteúdo em um arquivo. Se o arquivo não existir, ele será criado.\n            Uso: /write <caminho_do_arquivo> <conteúdo>\n            Exemplo: /write test.txt \"Hello World\"\n\n        4.  **generate_code**: Gera código baseado em um prompt. O código gerado será mostrado em uma visualização de diff.\n            Uso: /generate_code <prompt_de_geracao>\n            Exemplo: /generate_code Crie uma função JavaScript para somar dois números.\n            Formato JSON esperado:\n            \`\`\`json\n            {\n              \"tool\": \"generate_code\",\n              \"args\": {\n                \"prompt\": \"Crie uma função JavaScript para somar dois números.\"\n              }\n            }\n            \`\`\`\n\n        5.  **edit_code**: Edita o código selecionado no editor ativo. O código editado será mostrado em uma visualização de diff.\n            Uso: /edit_code <instrucao_de_edicao>\n            Exemplo: /edit_code Refatore esta função para usar arrow functions.\n\n        6.  **analyze_file**: Analisa um arquivo específico com base em uma instrução.\n            Uso: /analyze_file <caminho_do_arquivo> <instrucao_de_analise>\n            Exemplo: /analyze_file src/ollama.ts Encontre possíveis bugs de performance.\n\n        7.  **list_files**: Lista os arquivos em um diretório.\n            Uso: /list_files <caminho_do_diretorio>\n            Exemplo: /list_files src\n\n        8.  **execute_vscode_command**: Executa um comando interno do VS Code.\n            Uso: /execute_vscode_command <nome_do_comando> <...args>\n            Exemplo: /execute_vscode_command editor.action.formatDocument\n\n        9.  **apply_code_changes**: Aplica alterações de código diretamente no editor ativo.\n            Uso: /apply_code_changes <novo_codigo> [startLine] [startCharacter] [endLine] [endCharacter]\n            Exemplo: /apply_code_changes \"console.log('Hello');\" 0 0 0 0 (para inserir no início)\n            Exemplo: /apply_code_changes \"novaFuncao();\" 5 0 5 10 (para substituir a linha 5, caracteres 0-10)\n\n        Seu objetivo é responder à solicitação do usuário usando as ferramentas disponíveis. Responda SEMPRE no formato JSON, especificando a ferramenta a ser usada e seus argumentos. Se nenhuma ferramenta for apropriada, responda com uma mensagem de texto simples. NÃO inclua NENHUM texto conversacional ou explicações adicionais se você estiver retornando um JSON de ferramenta.\n\n        Formato JSON esperado para ferramentas:\n        {\n          \"tool\": \"nome_da_ferramenta\",\n          \"args\": {\n            \"arg1\": \"valor1\",\n            \"arg2\": \"valor2\"\n          }\n        }\n        `;

        const agentPrompt = `${toolsDescription}\n\nSolicitação do usuário: ${userMessage}`;

        try {
            const ollamaResponse = await this._ollamaService.chatWithOllama(agentPrompt, this._chatHistory);
            this._chatHistory.push({ role: 'assistant', content: ollamaResponse });
            console.log('Ollama Raw Response:', ollamaResponse); // Existing log

            try {
                console.log('Attempting to parse Ollama response...');
                const jsonMatch = ollamaResponse.match(/```json\n([\s\S]*?)\n```/);
                let parsedResponse;
                if (jsonMatch && jsonMatch[1]) {
                    parsedResponse = JSON.parse(jsonMatch[1]);
                } else {
                    // If no JSON block is found, try to parse the whole response as JSON
                    parsedResponse = JSON.parse(ollamaResponse);
                }
                console.log('Ollama Parsed Response:', parsedResponse); // Existing log
                console.log('Attempting to execute tool...');
                agentResponse = await this._executeTool(parsedResponse.tool, parsedResponse.args);
                console.log('Tool execution completed.');
            } catch (jsonError) {
                console.error('Error parsing JSON or executing tool:', jsonError); // Log the error
                agentResponse = ollamaResponse; // Treat as a direct text response
            }
        } catch (error) {
            agentResponse = `Erro na comunicação com o agente Ollama: ${error instanceof Error ? error.message : String(error)}`;
        }
        this._view.webview.postMessage({ type: 'replaceLastMessage', sender: 'ollama', text: agentResponse });
    }

    private async _executeTool(tool: string, args: any): Promise<string> {
        switch (tool) {
            case 'run':
                return await this._runCommand(args.command);
            case 'read':
                return this._readFile(args.filePath);
            case 'write':
                return this._writeFile(args.filePath, args.content);
            case 'generate_code':
                return this._generateCode(args.prompt);
            case 'edit_code':
                return this._editCode(args.instruction);
            case 'analyze_file':
                return this._analyzeFile(args.filePath, args.instruction);
            case 'list_files':
                return this._listFiles(args.directoryPath);
            case 'execute_vscode_command':
                return this._executeVscodeCommand(args.command, args.args);
            case 'apply_code_changes':
                return this._applyCodeChanges(args.newCode, args.startLine, args.startCharacter, args.endLine, args.endCharacter);
            default:
                console.error(`Ferramenta desconhecida: ${tool}.`); // Add this line
                return `Ferramenta desconhecida: ${tool}.`;
        }
    }

    private _runCommand(command: string): Promise<string> {
        if (!command) return Promise.resolve("Por favor, forneça um comando para executar.");
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return Promise.resolve("Nenhum workspace aberto para executar o comando.");
        }

        const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath; // Get the current workspace folder path

        try {
            const terminal = vscode.window.createTerminal({ name: "Ollama Agent", cwd: cwd });
            console.log('Attempting to show terminal...');
            terminal.show();
            terminal.sendText(command);
            return Promise.resolve(`Comando \`${command}\` enviado para o terminal. Verifique o terminal para a saída.`);
        } catch (error) {
            return Promise.resolve(`Erro ao abrir terminal ou executar comando: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _readFile(filePath: string): Promise<string> {
        if (!filePath) return "Por favor, forneça um caminho de arquivo para ler.";
        if (!vscode.workspace.workspaceFolders) return "Nenhum workspace aberto.";

        const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);

        try {
            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            return `Conteúdo de ${filePath}:\n\`\`\`\n${fileContent}\n\`\`\``;
        } catch (error) {
            return `Erro ao ler arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _writeFile(filePath: string, content: string): Promise<string> {
        if (!filePath || content === undefined) {
            return "Uso: /write <caminho_do_arquivo> <conteúdo>.";
        }
        if (!vscode.workspace.workspaceFolders) return "Nenhum workspace aberto.";

        const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);

        try {
            await fs.promises.writeFile(absolutePath, content, 'utf8');
            return `Conteúdo escrito em ${filePath}.`;
        } catch (error) {
            return `Erro ao escrever no arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _generateCode(prompt: string): Promise<string> {
        if (!prompt) return "Por favor, forneça um prompt para gerar código.";
        const editor = vscode.window.activeTextEditor;
        if (!editor) return "Nenhum editor ativo encontrado.";

        try {
            this._view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Gerando código...' });
            const fullPrompt = this.buildGeneratePrompt(prompt, editor.document.languageId, this.getEditorContext(editor));
            const generatedCode = await this._ollamaService.generateCode(fullPrompt);
            // Remove Markdown code block delimiters
            const cleanedCode = generatedCode.replace(/```[a-zA-Z]*\n([\s\S]*?)\n```/, '$1').trim();
            await this._applyCodeChanges(cleanedCode);
            return `Código gerado e aplicado no editor.`;
        } catch (error) {
            return `Erro ao gerar código: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _editCode(instruction: string): Promise<string> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return "Nenhum editor ativo. Abra um arquivo e selecione o código para editar.";
        const selection = editor.selection;
        const selectedCode = editor.document.getText(selection);
        if (!selectedCode) return "Selecione o código que deseja editar.";
        if (!instruction) return "Por favor, forneça uma instrução de edição.";

        try {
            this._view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: 'Editando código...' });
            const fullPrompt = this.buildEditPrompt(selectedCode, instruction, editor.document.languageId);
            const editedCode = await this._ollamaService.generateCode(fullPrompt);
            // Remove Markdown code block delimiters
            const cleanedCode = editedCode.replace(/```[a-zA-Z]*\n([\s\S]*?)\n```/, '$1').trim();
            await this._applyCodeChanges(cleanedCode, selection.start.line, selection.start.character, selection.end.line, selection.end.character);
            return `Código editado e aplicado no editor.`;
        } catch (error) {
            return `Erro ao editar código: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _analyzeFile(filePath: string, instruction: string): Promise<string> {
        if (!filePath || !instruction) return "Uso: /analyze_file <caminho_do_arquivo> <instrução>.";
        try {
            this._view?.webview.postMessage({ type: 'addMessage', sender: 'ollama', text: `Analisando arquivo ${filePath}...` });
            const analysisResult = await this._ollamaService.analyzeFile(filePath, instruction);
            return `Análise de ${filePath}:\n\`\`\`\n${analysisResult}\n\`\`\``;
        } catch (error) {
            return `Erro ao analisar arquivo ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _listFiles(directoryPath: string): Promise<string> {
        if (!directoryPath) return "Por favor, forneça um caminho de diretório para listar.";
        if (!vscode.workspace.workspaceFolders) return "Nenhum workspace aberto.";

        const absolutePath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, directoryPath);

        try {
            const files = await fs.promises.readdir(absolutePath);
            return `Arquivos em ${directoryPath}:\n${files.join('\n')}`;
        } catch (error) {
            return `Erro ao listar arquivos em ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _executeVscodeCommand(command: string, args: any[]): Promise<string> {
        if (!command) return "Por favor, forneça um comando do VS Code para executar.";
        try {
            await vscode.commands.executeCommand(command, ...(args || []));
            return `Comando \`${command}\` executado com sucesso.`;
        } catch (error) {
            return `Erro ao executar o comando \`${command}\`: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _applyCodeChanges(newCode: string, startLine?: number, startCharacter?: number, endLine?: number, endCharacter?: number): Promise<string> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return "Nenhum editor ativo encontrado para aplicar as mudanças.";

        try {
            await editor.edit(editBuilder => {
                if (startLine !== undefined && startCharacter !== undefined && endLine !== undefined && endCharacter !== undefined) {
                    const range = new vscode.Range(startLine, startCharacter, endLine, endCharacter);
                    editBuilder.replace(range, newCode);
                } else {
                    // If no range is provided, replace the entire document
                    const fullRange = new vscode.Range(
                        editor.document.lineAt(0).range.start,
                        editor.document.lineAt(editor.document.lineCount - 1).range.end
                    );
                    editBuilder.replace(fullRange, newCode);
                }
            });
            return "Alterações de código aplicadas com sucesso.";
        } catch (error) {
            return `Erro ao aplicar alterações de código: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _requestModels() {
        try {
            const modelDetails = await this._ollamaService.getModelDetails();
            this._view?.webview.postMessage({ type: 'availableModels', models: modelDetails });
        } catch (error) {
            vscode.window.showErrorMessage(`Erro ao buscar modelos: ${error}`);
            this._view?.webview.postMessage({ type: 'availableModels', models: [], error: String(error) });
        }
    }

    private async _setSelectedModel(modelName: string) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        await config.update('modelName', modelName, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Modelo Ollama alterado para: ${modelName}`);
    }

    private _requestCurrentModel() {
        const currentConfig = vscode.workspace.getConfiguration('ollama-code-diff');
        const currentModel = currentConfig.get<string>('modelName');
        this._view?.webview.postMessage({ type: 'currentModel', modelName: currentModel });
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
        return `\nVocê é um assistente de programação especializado. Gere código ${language} baseado na seguinte solicitação:\n\nSOLICITAÇÃO: ${userPrompt}\n\nCONTEXTO DO CÓDIGO ATUAL:\n\`\`\`${language}\n${context}\n\`\`\`\n\nINSTRUÇÕES:\n- Gere apenas o código solicitado, sem explicações\n- Mantenha o estilo consistente com o contexto\n- Use boas práticas da linguagem ${language}\n- Adicione comentários apenas quando necessário\n\nCÓDIGO:`;
    }

    public buildEditPrompt(originalCode: string, editInstruction: string, language: string): string {
        return `\nVocê é um assistente de programação especializado. Edite o código seguindo as instruções fornecidas:\n\nCÓDIGO ORIGINAL:\n\`\`\`${language}\n${originalCode}\n\`\`\`\n\nINSTRUÇÃO DE EDIÇÃO: ${editInstruction}\n\nINSTRUÇÕES:\n- Mantenha a funcionalidade principal do código\n- Aplique apenas as mudanças solicitadas\n- Use boas práticas da linguagem ${language}\n- Retorne apenas o código editado, sem explicações\n\nCÓDIGO EDITADO:`;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));

        return `<!DOCTYPE html>\n            <html lang="en">\n            <head>\n                <meta charset="UTF-8">\n                <meta name="viewport" content="width=device-width, initial-scale=1.0">\n                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">\n                <link href="${styleUri}" rel="stylesheet">\n                <title>Ollama Chat</title>\n            </head>\n            <body>\n                <div id="chat-container">\n                    <div class="controls">\n                        <select id="model-select"></select>\n                        <select id="mode-select">\n                            <option value="chat">Chat</option>\n                            <option value="agent">Agent</option>\n                        </select>\n                    </div>\n                    <div id="messages"></div>\n                    <div class="input-area">\n                        <input type="text" id="chat-input" placeholder="Digite sua mensagem...">\n                        <button id="send-button">Enviar</button>\n                    </div>\n                </div>\n                <script src="${scriptUri}"></script>\n            </body>\n            </html>`;
    }
}