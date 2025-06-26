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
class OllamaService {
    constructor() {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const host = config.get('ollamaHost', 'http://localhost:11434');
        this.ollama = new ollama_1.Ollama({
            host: host,
            fetch: cross_fetch_1.default
        });
    }
    // NOVO: Método para obter lista de modelos do Ollama
    async getAvailableModels() {
        try {
            // Usar a API /api/tags do Ollama para obter modelos reais
            const response = await this.ollama.list();
            if (response && response.models) {
                // Extrair apenas os nomes dos modelos
                return response.models.map((model) => model.name);
            }
            return [];
        }
        catch (error) {
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
    async getModelDetails() {
        try {
            const response = await this.ollama.list();
            if (response && response.models) {
                return response.models.map((model) => ({
                    name: model.name,
                    size: this.formatSize(model.size),
                    modified: new Date(model.modified_at).toLocaleDateString()
                }));
            }
            return [];
        }
        catch (error) {
            console.error('Erro ao obter detalhes dos modelos:', error);
            return [];
        }
    }
    // Método auxiliar para formatar tamanho
    formatSize(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0)
            return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
    async generateCode(prompt) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        try {
            const t0 = performance.now();
            const response = await this.ollama.generate({
                model: model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: maxTokens, // Usa configuração personalizável
                    num_ctx: contextSize, // Usa configuração personalizável
                    repeat_penalty: 1.1,
                    top_k: 40
                }
            });
            const t1 = performance.now();
            console.log(`CodeLlama gerou código em: ${(t1 - t0) / 1000} segundos`);
            return this.cleanCodeResponse(response.response);
        }
        catch (error) {
            console.error('Erro ao comunicar com CodeLlama:', error);
            throw new Error(`Falha na comunicação com CodeLlama: ${error}`);
        }
    }
    async analyzeFile(filePath, instruction) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const chunkSize = config.get('chunkSize', 25000);
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
                    num_predict: maxTokens, // Usa configuração personalizável
                    num_ctx: contextSize, // Usa configuração personalizável
                    repeat_penalty: 1.15,
                    top_k: 30
                }
            });
            return this.cleanCodeResponse(response.response);
        }
        catch (error) {
            console.error('Erro ao analisar arquivo:', error);
            throw new Error(`Falha na análise: ${error}`);
        }
    }
    // NOVO: Análise de projeto completo
    async analyzeProject(projectPath, instruction) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
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
                    num_predict: 12288, // Mais tokens para análise de projeto
                    num_ctx: 65536, // Contexto máximo
                    repeat_penalty: 1.15
                }
            });
            return response.response;
        }
        catch (error) {
            console.error('Erro ao analisar projeto:', error);
            throw new Error(`Falha na análise do projeto: ${error}`);
        }
    }
    // NOVO: Análise de múltiplos arquivos específicos
    async analyzeMultipleFiles(filePaths, instruction) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
        try {
            const filesContent = [];
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
                }
                catch (error) {
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
        }
        catch (error) {
            console.error('Erro ao analisar múltiplos arquivos:', error);
            throw new Error(`Falha na análise: ${error}`);
        }
    }
    async analyzeFileInChunks(content, instruction, model) {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        const chunkSize = config.get('chunkSize', 25000);
        const contextSize = config.get('contextSize', 32768);
        const maxTokens = config.get('maxTokens', 8192);
        const chunks = this.splitIntoChunks(content, chunkSize);
        const results = [];
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
                        num_predict: Math.floor(maxTokens * 0.75), // 75% do máximo para chunks
                        num_ctx: contextSize,
                        repeat_penalty: 1.15
                    }
                });
                results.push(`=== PARTE ${i + 1}/${chunks.length} ===\n${response.response}`);
                // Delay menor para não sobrecarregar
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            catch (error) {
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
                num_predict: maxTokens, // Máximo para consolidação
                num_ctx: Math.min(contextSize * 2, 131072) // Contexto expandido (máx 128K)
            }
        });
        return finalResponse.response;
    }
    // Criar mapa do repositório (similar ao Continue.dev)
    async createRepositoryMap(projectPath) {
        try {
            const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h}', '**/node_modules/**');
            const repoMap = [];
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
                }
                catch (error) {
                    // Ignorar arquivos que não conseguimos ler
                }
            }
            return repoMap.join('\n');
        }
        catch (error) {
            console.error('Erro ao criar mapa do repositório:', error);
            return 'Erro ao mapear repositório';
        }
    }
    // Extrair assinaturas de código (classes, funções)
    extractSignatures(content, filePath) {
        const signatures = [];
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
    async identifyMainFiles(projectPath) {
        const importantFiles = [];
        // Arquivos de configuração e entrada
        const configFiles = await vscode.workspace.findFiles('{package.json,tsconfig.json,*.config.js,main.py,app.py,index.ts,index.js,Program.cs}');
        for (const file of configFiles) {
            importantFiles.push(file.fsPath);
        }
        return importantFiles.slice(0, 5); // Máximo 5 arquivos principais
    }
    buildProjectContext(mainFiles, repoMap, instruction) {
        return `[INST] PROJECT ANALYSIS\n\nInstruction: ${instruction}\n\n${repoMap}\n\n## MAIN FILES CONTENT\n${mainFiles.map((file, index) => `### File ${index + 1}: ${vscode.workspace.asRelativePath(file)}`).join('\n')}\n\nPlease analyze this project structure and provide insights based on the instruction. [/INST]`;
    }
    buildMultiFilePrompt(filesContent, instruction) {
        const filesSection = filesContent.map((file, index) => `### File ${index + 1}: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``).join('\n\n');
        return `[INST] MULTI-FILE ANALYSIS\n\nInstruction: ${instruction}\n\nFiles to analyze:\n${filesSection}\n\nPlease analyze these files together and provide insights based on the instruction. [/INST]`;
    }
    async analyzeMultipleFilesInChunks(filesContent, instruction, model) {
        const results = [];
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
            }
            catch (error) {
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
    splitIntoChunks(content, chunkSize) {
        const chunks = [];
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
                }
                else {
                    chunks.push(currentChunk);
                    currentChunk = line + '\n';
                }
            }
            else {
                currentChunk = newChunk;
            }
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        return chunks;
    }
    isStructuralLine(line) {
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
    buildAnalysisPrompt(content, instruction) {
        return `[INST] You are an expert programmer analyzing code. Task: ${instruction}\n\nCode to analyze:\n${content}\n\nPlease provide:\n1. Detailed analysis based on the specific instruction\n2. Identify patterns, issues, and opportunities\n3. Specific actionable recommendations\n4. Code improvements if applicable\n\nFocus on the instruction: "${instruction}" [/INST]`;
    }
    buildChunkPrompt(chunk, instruction, partNum, totalParts) {
        return `[INST] LARGE FILE ANALYSIS - PART ${partNum} of ${totalParts}\n\nMain instruction: ${instruction}\n\nCode fragment to analyze:\n${chunk}\n\nNote: This is part ${partNum} of ${totalParts} of a larger file. Focus on this fragment while considering it may have dependencies elsewhere.\n\nProvide analysis for this specific part: [/INST]`;
    }
    buildConsolidationPrompt(allResults, instruction) {
        return `[INST] CONSOLIDATION OF LARGE FILE ANALYSIS\n\nOriginal instruction: ${instruction}\n\nAnalysis results from all parts:\n${allResults}\n\nPlease provide:\n1. Unified analysis consolidating all parts\n2. Global patterns identified across the entire file\n3. Overall recommendations prioritized by impact\n4. Summary of key findings\n\nCreate a comprehensive final analysis: [/INST]`;
    }
    cleanCodeResponse(response) {
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
    async testConnection() {
        try {
            await this.ollama.list();
            return true;
        }
        catch (error) {
            console.error('Erro ao testar conexão:', error);
            return false;
        }
    }
    // Método para verificar limites do modelo
    async getModelInfo() {
        try {
            const config = vscode.workspace.getConfiguration('ollama-code-diff');
            const model = config.get('modelName', 'codellama:7b-instruct-q5_K_M');
            // Simula verificação de capacidades
            return {
                model: model,
                maxContext: 32768,
                recommendedChunkSize: 25000,
                maxFileSize: 50000
            };
        }
        catch (error) {
            console.error('Erro ao obter info do modelo:', error);
            return null;
        }
    }
}
exports.OllamaService = OllamaService;
//# sourceMappingURL=ollama.js.map