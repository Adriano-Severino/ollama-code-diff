import { Ollama } from 'ollama';
import fetch from 'cross-fetch';
import * as vscode from 'vscode';

export class OllamaService {
    private ollama: Ollama;

    constructor() {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const host = config.get<string>('ollamaHost', 'http://localhost:11434');
        
        this.ollama = new Ollama({
            host: host,
            fetch: fetch
        });
    }

    // NOVO: Método para obter lista de modelos do Ollama
async getAvailableModels(): Promise<string[]> {
    try {
        // Usar a API /api/tags do Ollama para obter modelos reais
        const response = await this.ollama.list();
        
        if (response && response.models) {
            // Extrair apenas os nomes dos modelos
            return response.models.map((model: any) => model.name);
        }
        
        return [];
        
    } catch (error) {
        console.error('Erro ao obter lista de modelos:', error);
        // Fallback para modelos padrão se a API falhar
        return [
            'qwen2.5-coder:1.5b-base',
            'qwen2.5-coder:7b',
            'codellama:7b-instruct-q5_K_M'
        ];
    }
}

// NOVO: Método para obter informações detalhadas dos modelos
async getModelDetails(): Promise<Array<{name: string, size: string, modified: string}>> {
    try {
        const response = await this.ollama.list();
        
        if (response && response.models) {
            return response.models.map((model: any) => ({
                name: model.name,
                size: this.formatSize(model.size),
                modified: new Date(model.modified_at).toLocaleDateString()
            }));
        }
        
        return [];
        
    } catch (error) {
        console.error('Erro ao obter detalhes dos modelos:', error);
        return [];
    }
}

// Método auxiliar para formatar tamanho
private formatSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}


    async generateCode(prompt: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get<number>('contextSize', 32768);
        const maxTokens = config.get<number>('maxTokens', 8192);

        try {
            const t0 = performance.now();
            
            const response = await this.ollama.generate({
                model: model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: maxTokens,      // Usa configuração personalizável
                    num_ctx: contextSize,        // Usa configuração personalizável
                    repeat_penalty: 1.1,
                    top_k: 40
                }
            });
            
            const t1 = performance.now();
            console.log(`CodeLlama gerou código em: ${(t1 - t0) / 1000} segundos`);
            
            return this.cleanCodeResponse(response.response);
            
        } catch (error) {
            console.error('Erro ao comunicar com CodeLlama:', error);
            throw new Error(`Falha na comunicação com CodeLlama: ${error}`);
        }
    }

    async analyzeFile(filePath: string, instruction: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get<number>('contextSize', 32768);
        const maxTokens = config.get<number>('maxTokens', 8192);
        const chunkSize = config.get<number>('chunkSize', 25000);

        try {
            const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const content = Buffer.from(fileContent).toString('utf8');
            
            // Usar configuração personalizável para tamanho máximo
            const maxSize = chunkSize * 2; // 50KB por padrão antes de fragmentar
            
            console.log(`Analisando arquivo de ${content.length} caracteres (limite: ${maxSize})`);
            
            if (content.length > maxSize) {
                return await this.analyzeFileInChunks(content, instruction, model);
            }
            
            const fullPrompt = this.buildAnalysisPrompt(content, instruction);
            
            const response = await this.ollama.generate({
                model: model,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    num_predict: maxTokens,      // Usa configuração personalizável
                    num_ctx: contextSize,        // Usa configuração personalizável
                    repeat_penalty: 1.15,
                    top_k: 30
                }
            });
            
            return this.cleanCodeResponse(response.response);
            
        } catch (error) {
            console.error('Erro ao analisar arquivo:', error);
            throw new Error(`Falha na análise: ${error}`);
        }
    }

    // NOVO: Análise de projeto completo
    async analyzeProject(projectPath: string, instruction: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');

        try {
            // 1. Criar mapa do repositório
            const repoMap = await this.createRepositoryMap(projectPath);
            
            // 2. Identificar arquivos principais
            const mainFiles = await this.identifyMainFiles(projectPath);
            
            // 3. Criar contexto do projeto
            const projectContext = await this.buildProjectContext(mainFiles, repoMap, instruction);
            
            const response = await this.ollama.generate({
                model: model,
                prompt: projectContext,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    num_predict: 12288,      // Mais tokens para análise de projeto
                    num_ctx: 65536,          // Contexto máximo
                    repeat_penalty: 1.15
                }
            });
            
            return response.response;
            
        } catch (error) {
            console.error('Erro ao analisar projeto:', error);
            throw new Error(`Falha na análise do projeto: ${error}`);
        }
    }

    // NOVO: Análise de múltiplos arquivos específicos
    async analyzeMultipleFiles(filePaths: string[], instruction: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');

        try {
            const filesContent: Array<{path: string, content: string}> = [];
            let totalSize = 0;
            
            // Ler todos os arquivos selecionados
            for (const filePath of filePaths) {
                try {
                    const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                    const content = Buffer.from(fileContent).toString('utf8');
                    
                    filesContent.push({
                        path: vscode.workspace.asRelativePath(filePath),
                        content: content
                    });
                    
                    totalSize += content.length;
                } catch (error) {
                    console.error(`Erro ao ler arquivo ${filePath}:`, error);
                }
            }
            
            // Se muito grande, fragmentar
            if (totalSize > 30000) { // 30KB limite
                return await this.analyzeMultipleFilesInChunks(filesContent, instruction, model);
            }
            
            const multiFilePrompt = this.buildMultiFilePrompt(filesContent, instruction);
            
            const response = await this.ollama.generate({
                model: model,
                prompt: multiFilePrompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    num_predict: 10240,
                    num_ctx: 65536,
                    repeat_penalty: 1.15
                }
            });
            
            return response.response;
            
        } catch (error) {
            console.error('Erro ao analisar múltiplos arquivos:', error);
            throw new Error(`Falha na análise: ${error}`);
        }
    }

    private async analyzeFileInChunks(content: string, instruction: string, model: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const chunkSize = config.get<number>('chunkSize', 25000);
        const contextSize = config.get<number>('contextSize', 32768);
        const maxTokens = config.get<number>('maxTokens', 8192);
        
        const chunks = this.splitIntoChunks(content, chunkSize);
        const results: string[] = [];
        
        console.log(`Fragmentando arquivo em ${chunks.length} partes de ~${chunkSize} caracteres cada`);
        
        for (let i = 0; i < chunks.length; i++) {
            const chunkPrompt = this.buildChunkPrompt(chunks[i], instruction, i + 1, chunks.length);
            
            try {
                console.log(`Processando parte ${i + 1}/${chunks.length}...`);
                
                const response = await this.ollama.generate({
                    model: model,
                    prompt: chunkPrompt,
                    stream: false,
                    options: {
                        temperature: 0.3,
                        top_p: 0.9,
                        num_predict: Math.floor(maxTokens * 0.75),  // 75% do máximo para chunks
                        num_ctx: contextSize,
                        repeat_penalty: 1.15
                    }
                });
                
                results.push(`=== PARTE ${i + 1}/${chunks.length} ===\n${response.response}`);
                
                // Delay menor para não sobrecarregar
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
            } catch (error) {
                console.error(`Erro na parte ${i + 1}:`, error);
                results.push(`=== ERRO NA PARTE ${i + 1} ===\nErro: ${error}`);
            }
        }
        
        // Consolidação final
        console.log('Consolidando análises...');
        const consolidatedPrompt = this.buildConsolidationPrompt(results.join('\n\n'), instruction);
        
        const finalResponse = await this.ollama.generate({
            model: model,
            prompt: consolidatedPrompt,
            stream: false,
            options: {
                temperature: 0.5,
                top_p: 0.9,
                num_predict: maxTokens,              // Máximo para consolidação
                num_ctx: Math.min(contextSize * 2, 131072)  // Contexto expandido (máx 128K)
            }
        });
        
        return finalResponse.response;
    }

    // Criar mapa do repositório (similar ao Continue.dev)
    private async createRepositoryMap(projectPath: string): Promise<string> {
        try {
            const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h}', '**/node_modules/**');
            
            const repoMap: string[] = [];
            repoMap.push('## REPOSITORY STRUCTURE');
            
            for (const file of files.slice(0, 50)) { // Limitar a 50 arquivos principais
                const relativePath = vscode.workspace.asRelativePath(file);
                try {
                    const content = await vscode.workspace.fs.readFile(file);
                    const text = Buffer.from(content).toString('utf8');
                    
                    // Extrair assinaturas de funções/classes
                    const signatures = this.extractSignatures(text, relativePath);
                    if (signatures.length > 0) {
                        repoMap.push(`\n### ${relativePath}`);
                        repoMap.push(...signatures);
                    }
                } catch (error) {
                    // Ignorar arquivos que não conseguimos ler
                }
            }
            
            return repoMap.join('\n');
            
        } catch (error) {
            console.error('Erro ao criar mapa do repositório:', error);
            return 'Erro ao mapear repositório';
        }
    }

    // Extrair assinaturas de código (classes, funções)
    private extractSignatures(content: string, filePath: string): string[] {
        const signatures: string[] = [];
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // TypeScript/JavaScript
            if (line.match(/^(export\s+)?(class|interface|function|const|let|var)\s+\w+/)) {
                signatures.push(`- ${line}`);
            }
            // Python
            else if (line.match(/^(class|def)\s+\w+/)) {
                signatures.push(`- ${line}`);
            }
            // C#/Java
            else if (line.match(/^(public|private|protected|internal)\s+(class|interface|static|void|int|string)/)) {
                signatures.push(`- ${line}`);
            }
        }
        
        return signatures.slice(0, 10); // Máximo 10 assinaturas por arquivo
    }

    // Identificar arquivos principais do projeto
    private async identifyMainFiles(projectPath: string): Promise<string[]> {
        const importantFiles: string[] = [];
        
        // Arquivos de configuração e entrada
        const configFiles = await vscode.workspace.findFiles('{package.json,tsconfig.json,*.config.js,main.py,app.py,index.ts,index.js,Program.cs}');
        
        for (const file of configFiles) {
            importantFiles.push(file.fsPath);
        }
        
        return importantFiles.slice(0, 5); // Máximo 5 arquivos principais
    }

    private buildProjectContext(mainFiles: string[], repoMap: string, instruction: string): string {
        return `[INST] PROJECT ANALYSIS\n\nInstruction: ${instruction}\n\n${repoMap}\n\n## MAIN FILES CONTENT\n${mainFiles.map((file, index) => `### File ${index + 1}: ${vscode.workspace.asRelativePath(file)}`).join('\n')}\n\nPlease analyze this project structure and provide insights based on the instruction. [/INST]`;
    }

    private buildMultiFilePrompt(filesContent: Array<{path: string, content: string}>, instruction: string): string {
        const filesSection = filesContent.map((file, index) => 
            `### File ${index + 1}: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``
        ).join('\n\n');
        
        return `[INST] MULTI-FILE ANALYSIS\n\nInstruction: ${instruction}\n\nFiles to analyze:\n${filesSection}\n\nPlease analyze these files together and provide insights based on the instruction. [/INST]`;
    }

    private async analyzeMultipleFilesInChunks(filesContent: Array<{path: string, content: string}>, instruction: string, model: string): Promise<string> {
        const results: string[] = [];
        
        for (let i = 0; i < filesContent.length; i++) {
            const file = filesContent[i];
            const prompt = `[INST] Analyzing file ${i + 1}/${filesContent.length}: ${file.path}\n\nInstruction: ${instruction}\n\nContent:\n\`\`\`\n${file.content}\n\`\`\`\n\nAnalyze this file in context of multi-file analysis: [/INST]`;
            
            try {
                const response = await this.ollama.generate({
                    model: model,
                    prompt: prompt,
                    stream: false,
                    options: {
                        temperature: 0.3,
                        top_p: 0.9,
                        num_predict: 4096,
                        num_ctx: 32768
                    }
                });
                
                results.push(`## ${file.path}\n${response.response}`);
            } catch (error) {
                results.push(`## ${file.path}\nERRO: ${error}`);
            }
        }
        
        // Consolidar resultados
        const consolidationPrompt = `[INST] CONSOLIDATION OF MULTI-FILE ANALYSIS\n\nOriginal instruction: ${instruction}\n\nIndividual file analyses:\n${results.join('\n\n')}\n\nProvide a unified analysis considering all files together: [/INST]`;
        
        const finalResponse = await this.ollama.generate({
            model: model,
            prompt: consolidationPrompt,
            stream: false,
            options: {
                temperature: 0.5,
                num_predict: 8192,
                num_ctx: 65536
            }
        });
        
        return finalResponse.response;
    }

    private splitIntoChunks(content: string, chunkSize: number): string[] {
        const chunks: string[] = [];
        const lines = content.split('\n');
        let currentChunk = '';
        
        for (const line of lines) {
            const newChunk = currentChunk + line + '\n';
            
            // Tenta manter funções/classes inteiras quando possível
            if (newChunk.length > chunkSize && currentChunk.length > 0) {
                // Se a linha atual é início de função/classe, mantém junto
                if (this.isStructuralLine(line)) {
                    chunks.push(currentChunk);
                    currentChunk = line + '\n';
                } else {
                    chunks.push(currentChunk);
                    currentChunk = line + '\n';
                }
            } else {
                currentChunk = newChunk;
            }
        }
        
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        
        return chunks;
    }

    private isStructuralLine(line: string): boolean {
        const trimmed = line.trim();
        return trimmed.startsWith('class ') ||
               trimmed.startsWith('function ') ||
               trimmed.startsWith('def ') ||
               trimmed.startsWith('public ') ||
               trimmed.startsWith('private ') ||
               trimmed.startsWith('protected ') ||
               trimmed.includes('function(') ||
               trimmed.includes(') {');
    }

    private buildAnalysisPrompt(content: string, instruction: string): string {
        return `[INST] You are an expert programmer analyzing code. Task: ${instruction}\n\nCode to analyze:\n${content}\n\nPlease provide:\n1. Detailed analysis based on the specific instruction\n2. Identify patterns, issues, and opportunities\n3. Specific actionable recommendations\n4. Code improvements if applicable\n\nFocus on the instruction: "${instruction}" [/INST]`;
    }

    private buildChunkPrompt(chunk: string, instruction: string, partNum: number, totalParts: number): string {
        return `[INST] LARGE FILE ANALYSIS - PART ${partNum} of ${totalParts}\n\nMain instruction: ${instruction}\n\nCode fragment to analyze:\n${chunk}\n\nNote: This is part ${partNum} of ${totalParts} of a larger file. Focus on this fragment while considering it may have dependencies elsewhere.\n\nProvide analysis for this specific part: [/INST]`;
    }

    private buildConsolidationPrompt(allResults: string, instruction: string): string {
        return `[INST] CONSOLIDATION OF LARGE FILE ANALYSIS\n\nOriginal instruction: ${instruction}\n\nAnalysis results from all parts:\n${allResults}\n\nPlease provide:\n1. Unified analysis consolidating all parts\n2. Global patterns identified across the entire file\n3. Overall recommendations prioritized by impact\n4. Summary of key findings\n\nCreate a comprehensive final analysis: [/INST]`;
    }

    private cleanCodeResponse(response: string): string {
        let cleaned = response.trim();
        
        // Remove linhas que começam com explicações desnecessárias
        const lines = cleaned.split('\n');
        const filteredLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed.length > 0 &&
                   !trimmed.startsWith('Aqui está') &&
                   !trimmed.startsWith('Este código') &&
                   !trimmed.startsWith('O código acima') &&
                   !trimmed.startsWith('Explicação:') &&
                   !trimmed.startsWith('Como funciona:');
        });
        
        return filteredLines.join('\n').trim();
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.ollama.list();
            return true;
        } catch (error) {
            console.error('Erro ao testar conexão:', error);
            return false;
        }
    }

    // Método para verificar limites do modelo
    async getModelInfo(): Promise<any> {
        try {
            const config = vscode.workspace.getConfiguration('ollama-code-diff');
            const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
            
            // Simula verificação de capacidades
            return {
                model: model,
                maxContext: 32768,
                recommendedChunkSize: 25000,
                maxFileSize: 50000
            };
        } catch (error) {
            console.error('Erro ao obter info do modelo:', error);
            return null;
        }
    }
}