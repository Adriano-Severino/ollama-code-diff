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
exports.RAGService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const ts = __importStar(require("typescript"));
class RAGService {
    constructor(context, ollamaService) {
        this.vectors = [];
        this.isIndexing = false;
        this.debounceTimers = new Map();
        this.embeddingCache = new Map();
        this.ollamaService = ollamaService;
        // Store the vector DB in the extension's global storage or workspace storage
        const storagePath = context.storageUri?.fsPath || context.globalStorageUri.fsPath;
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.dbPath = path.join(storagePath, 'vectors.json');
        this.loadVectors();
    }
    loadVectors() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const data = fs.readFileSync(this.dbPath, 'utf8');
                this.vectors = JSON.parse(data);
                console.log(`Carregados ${this.vectors.length} vetores.`);
            }
            catch (e) {
                console.error('Erro ao carregar vetores:', e);
                this.vectors = [];
            }
        }
    }
    saveVectors() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.vectors), 'utf8');
        }
        catch (e) {
            console.error('Erro ao salvar vetores:', e);
        }
    }
    async indexWorkspace() {
        if (this.isIndexing) {
            vscode.window.showWarningMessage('Indexação já em andamento.');
            return;
        }
        this.isIndexing = true;
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders)
                return;
            // Only index reasonably sized source files
            const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h,md,json,html,css}', '**/node_modules/**');
            vscode.window.showInformationMessage(`Iniciando indexação de ${files.length} arquivos...`);
            let processed = 0;
            for (const fileUri of files) {
                try {
                    const success = await this.processFile(fileUri);
                    if (success)
                        processed++;
                }
                catch (e) {
                    console.error(`Erro ao indexar ${fileUri.fsPath}:`, e);
                }
            }
            this.saveVectors();
            vscode.window.showInformationMessage(`Indexação concluída! ${processed} arquivos processados.`);
        }
        finally {
            this.isIndexing = false;
        }
    }
    async indexFile(uri) {
        // Debounce by file path
        const pathStr = uri.fsPath;
        if (this.debounceTimers.has(pathStr)) {
            clearTimeout(this.debounceTimers.get(pathStr));
        }
        const timer = setTimeout(async () => {
            this.debounceTimers.delete(pathStr);
            try {
                const updated = await this.processFile(uri);
                if (updated) {
                    this.saveVectors();
                    console.log(`RAG: Arquivo ${path.basename(pathStr)} reindexado.`);
                }
            }
            catch (e) {
                console.error(`Erro ao reindexar arquivo ${pathStr}:`, e);
            }
        }, 1000); // 1 second debounce
        this.debounceTimers.set(pathStr, timer);
    }
    async processFile(fileUri) {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            // Skip large files or binaries (rudimentary check)
            if (content.length > 50000)
                return false;
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            // Check if modified since last index via content hash
            const existingDocs = this.vectors.filter(v => v.filePath === fileUri.fsPath);
            const stats = fs.statSync(fileUri.fsPath);
            if (existingDocs.length > 0 && existingDocs[0].contentHash === contentHash) {
                return false; // Already fresh
            }
            // Remove old entries if they exist
            this.vectors = this.vectors.filter(v => v.filePath !== fileUri.fsPath);
            // Generate Embedding
            // Advanced Chunking: Semantic/Structural
            const chunks = this.semanticChunking(content, fileUri.fsPath);
            for (const chunk of chunks) {
                const contextText = `File: ${vscode.workspace.asRelativePath(fileUri.fsPath)}\nContent: ${chunk.text}`;
                const embedding = await this.ollamaService.generateEmbeddings(contextText);
                this.vectors.push({
                    id: `${fileUri.fsPath}-${Date.now()}-${Math.random()}`,
                    filePath: fileUri.fsPath,
                    content: chunk.text,
                    contentHash: contentHash,
                    embedding: embedding,
                    timestamp: stats.mtimeMs
                });
            }
            return true;
        }
        catch (e) {
            console.error(`Erro ao processar arquivo ${fileUri.fsPath}:`, e);
            return false;
        }
    }
    semanticChunking(text, filePath) {
        const ext = path.extname(filePath);
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            return this.tsChunking(text, filePath);
        }
        // Fallback or multi-language structural heuristic
        return this.heuristicChunking(text);
    }
    tsChunking(text, filePath) {
        const chunks = [];
        const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
        const visitor = (node) => {
            if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isMethodDeclaration(node)) {
                const start = node.getStart(sourceFile);
                const end = node.getEnd();
                const content = text.substring(start, end);
                if (content.length > 50) {
                    let type = 'code-block';
                    if (ts.isClassDeclaration(node))
                        type = 'class';
                    else if (ts.isFunctionDeclaration(node))
                        type = 'function';
                    else if (ts.isInterfaceDeclaration(node))
                        type = 'interface';
                    else if (ts.isMethodDeclaration(node))
                        type = 'method';
                    chunks.push({ text: content, type });
                }
            }
            ts.forEachChild(node, visitor);
        };
        visitor(sourceFile);
        // If no chunks were extracted (e.g. only top level code), use heuristic
        if (chunks.length === 0) {
            return this.heuristicChunking(text);
        }
        return chunks;
    }
    heuristicChunking(text) {
        const chunks = [];
        const lines = text.split('\n');
        let currentChunk = '';
        const maxSize = 1500;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const isStructural = this.isStructuralLine(line);
            if (isStructural && currentChunk.length > 500) {
                chunks.push({ text: currentChunk.trim(), type: 'code-block' });
                currentChunk = '';
            }
            currentChunk += line + '\n';
            if (currentChunk.length > maxSize) {
                chunks.push({ text: currentChunk.trim(), type: 'chunk' });
                currentChunk = '';
            }
        }
        if (currentChunk.trim()) {
            chunks.push({ text: currentChunk.trim(), type: 'chunk' });
        }
        return chunks.filter(c => c.text.length > 50);
    }
    isStructuralLine(line) {
        const trimmed = line.trim();
        return /^(export\s+)?(class|interface|function|const|let|var|def|public|private|protected|async)\s+\w+/.test(trimmed) ||
            (trimmed.includes('(') && trimmed.includes(')') && trimmed.endsWith('{'));
    }
    chunkText(text, maxSize) {
        // Kept for backward compatibility or simple files
        const chunks = [];
        let currentChunk = '';
        const lines = text.split('\n');
        for (const line of lines) {
            if ((currentChunk.length + line.length) > maxSize) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            currentChunk += line + '\n';
        }
        if (currentChunk.trim())
            chunks.push(currentChunk);
        return chunks;
    }
    async search(query, limit = 5) {
        if (this.vectors.length === 0)
            return [];
        const queries = [query];
        // Advanced: Multi-query expansion
        try {
            const expandedQueries = await this.expandQuery(query);
            queries.push(...expandedQueries.slice(0, 2)); // Limit to 2 additional variations (total 3)
        }
        catch (e) {
            console.warn('Falha na expansão da query RAG:', e);
        }
        const allResults = new Map();
        for (const q of queries) {
            let queryEmbedding;
            // Query Embedding Cache
            if (this.embeddingCache.has(q)) {
                queryEmbedding = this.embeddingCache.get(q);
            }
            else {
                queryEmbedding = await this.ollamaService.generateEmbeddings(q);
                // Keep cache small
                if (this.embeddingCache.size > 100) {
                    const firstKey = this.embeddingCache.keys().next().value;
                    if (firstKey)
                        this.embeddingCache.delete(firstKey);
                }
                this.embeddingCache.set(q, queryEmbedding);
            }
            for (const doc of this.vectors) {
                let score = this.cosineSimilarity(queryEmbedding, doc.embedding);
                // Hybrid Search: Boost score if query keywords appear in content
                const keywords = q.toLowerCase().split(/\W+/).filter(w => w.length > 3);
                let keywordBonus = 0;
                for (const kw of keywords) {
                    if (doc.content.toLowerCase().includes(kw)) {
                        keywordBonus += 0.05; // 5% bonus per keyword match
                    }
                }
                score += Math.min(keywordBonus, 0.2); // Cap bonus at 20%
                const existing = allResults.get(doc.id);
                if (!existing || score > existing.maxScore) {
                    allResults.set(doc.id, { ...doc, score, maxScore: score });
                }
            }
        }
        // Sort by score descending
        const sortedResults = Array.from(allResults.values())
            .sort((a, b) => (b.score || 0) - (a.score || 0));
        return sortedResults.slice(0, limit);
    }
    async expandQuery(query) {
        // Cache for query expansion could also be added, but for now just limit use
        const prompt = `Como um assistente de busca técnica, gere 2 variações curtas da pergunta abaixo para melhorar a busca em código-fonte (RAG). 
Pergunta: "${query}"
Retorne apenas as variações, uma por linha, sem explicações.`;
        try {
            const response = await this.ollamaService.chat([{ role: 'user', content: prompt }]);
            return response.split('\n')
                .map(s => s.trim())
                .filter(s => s.length > 5 && s !== query)
                .slice(0, 2);
        }
        catch (e) {
            return [];
        }
    }
    cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) {
            return 0; // Return 0 if dimensions don't match or invalid
        }
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
exports.RAGService = RAGService;
//# sourceMappingURL=ragService.js.map