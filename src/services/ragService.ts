import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as ts from 'typescript';
import ignore, { Ignore } from 'ignore';
import { OllamaService } from '../ollama';
import { Logger } from '../utils/logger';

interface VectorDocument {
    id: string;
    filePath: string;
    content: string;
    contentHash: string;
    embedding: number[];
    timestamp: number;
    score?: number;
}

interface GitignoreEntry {
    filePath: string;
    dir: string;
    matcher: Ignore;
    mtimeMs: number;
    depth: number;
}

interface GitignoreCache {
    entries: GitignoreEntry[];
    lastScanMs: number;
}

export class RAGService {
    private vectors: VectorDocument[] = [];
    private dbPath: string;
    private ollamaService: OllamaService;
    private isIndexing: boolean = false;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private embeddingCache: Map<string, number[]> = new Map();
    private gitignoreCache: Map<string, GitignoreCache> = new Map();
    private readonly includePattern = '**/*.{ts,tsx,js,jsx,py,java,cs,cpp,c,h,md,json,html,css}';
    private readonly excludePattern = '**/{node_modules,.git}/**';
    private readonly gitignoreScanThrottleMs = 2000;

    constructor(context: vscode.ExtensionContext, ollamaService: OllamaService) {
        this.ollamaService = ollamaService;
        // Store the vector DB in the extension's global storage or workspace storage
        const storagePath = context.storageUri?.fsPath || context.globalStorageUri.fsPath;
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.dbPath = path.join(storagePath, 'vectors.json');
        this.loadVectors();
    }

    private loadVectors() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const data = fs.readFileSync(this.dbPath, 'utf8');
                this.vectors = JSON.parse(data);
                Logger.info(`Carregados ${this.vectors.length} vetores.`);
            } catch (e) {
                Logger.error('Erro ao carregar vetores.', e);
                this.vectors = [];
            }
        }
    }

    private saveVectors() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.vectors), 'utf8');
        } catch (e) {
            Logger.error('Erro ao salvar vetores.', e);
        }
    }

    public async indexWorkspace() {
        if (this.isIndexing) {
            vscode.window.showWarningMessage('Indexação já em andamento.');
            return;
        }
        this.isIndexing = true;

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Indexando código (RAG)',
                    cancellable: true
                },
                async (progress, token) => {
                    progress.report({ message: 'Coletando arquivos...' });

                    const { files, ignoredByGitignore } = await this.collectIndexableFiles(workspaceFolders, true);

                    if (files.length === 0) {
                        vscode.window.showInformationMessage('Nenhum arquivo para indexar.');
                        return;
                    }

                    const filePathSet = new Set(files.map(f => f.fsPath));

                    let updated = 0;
                    let skipped = 0;
                    const total = files.length;
                    const increment = total > 0 ? 100 / total : 0;
                    let cancelled = false;

                    for (let i = 0; i < files.length; i++) {
                        if (token.isCancellationRequested) {
                            cancelled = true;
                            break;
                        }

                        const fileUri = files[i];
                        try {
                            const changed = await this.processFile(fileUri);
                            if (changed) updated++;
                            else skipped++;
                        } catch (e) {
                            Logger.error(`Erro ao indexar ${fileUri.fsPath}.`, e);
                        }

                        const percent = Math.round(((i + 1) / total) * 100);
                        progress.report({
                            increment,
                            message: `Indexando ${i + 1}/${total} (${percent}%)`
                        });
                    }

                    if (!cancelled) {
                        const beforeCount = this.vectors.length;
                        this.vectors = this.vectors.filter(v => filePathSet.has(v.filePath));
                        const removed = beforeCount - this.vectors.length;

                        this.saveVectors();
                        vscode.window.showInformationMessage(
                            `Indexação concluída! ${updated} atualizados, ${skipped} sem mudanças, ${removed} removidos, ${ignoredByGitignore} ignorados.`
                        );
                        return;
                    }

                    this.saveVectors();
                    vscode.window.showWarningMessage(
                        `Indexação cancelada. ${updated} atualizados, ${skipped} sem mudanças, ${ignoredByGitignore} ignorados.`
                    );
                }
            );

        } finally {
            this.isIndexing = false;
        }
    }
    public async indexFile(uri: vscode.Uri) {
        if (this.isIndexing) return;
        if (!(await this.shouldIndexFile(uri))) return;

        // Debounce by file path
        const pathStr = uri.fsPath;
        if (this.debounceTimers.has(pathStr)) {
            clearTimeout(this.debounceTimers.get(pathStr)!);
        }

        const timer = setTimeout(async () => {
            this.debounceTimers.delete(pathStr);
            try {
                const updated = await this.processFile(uri);
                if (updated) {
                    this.saveVectors();
                    Logger.debug(`RAG: Arquivo ${path.basename(pathStr)} reindexado.`);
                }
            } catch (e) {
                Logger.error(`Erro ao reindexar arquivo ${pathStr}.`, e);
            }
        }, 1000); // 1 second debounce

        this.debounceTimers.set(pathStr, timer);
    }

    private async processFile(fileUri: vscode.Uri): Promise<boolean> {
        try {
            const stats = fs.statSync(fileUri.fsPath);
            const existingDocs = this.vectors.filter(v => v.filePath === fileUri.fsPath);

            if (existingDocs.length > 0) {
                const lastIndexed = Math.max(...existingDocs.map(d => d.timestamp));
                if (stats.mtimeMs <= lastIndexed) {
                    return false; // Not modified since last index
                }
            }

            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();

            // Skip large files or binaries (rudimentary check)
            if (content.length > 50000) return false;

            const contentHash = crypto.createHash('sha256').update(content).digest('hex');

            // Check if modified since last index via content hash
            if (existingDocs.length > 0 && existingDocs[0].contentHash === contentHash) {
                for (const doc of existingDocs) {
                    doc.timestamp = stats.mtimeMs;
                }
                return true;
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
        } catch (e) {
            Logger.error(`Erro ao processar arquivo ${fileUri.fsPath}.`, e);
            return false;
        }
    }

    private async collectIndexableFiles(
        workspaceFolders: readonly vscode.WorkspaceFolder[],
        forceRefresh: boolean = false
    ): Promise<{ files: vscode.Uri[]; ignoredByGitignore: number }> {
        const files: vscode.Uri[] = [];
        let ignoredByGitignore = 0;

        for (const folder of workspaceFolders) {
            const include = new vscode.RelativePattern(folder, this.includePattern);
            const exclude = new vscode.RelativePattern(folder, this.excludePattern);
            const found = await vscode.workspace.findFiles(include, exclude);

            const entries = await this.getGitignoreEntries(folder, forceRefresh);

            for (const fileUri of found) {
                if (entries.length > 0 && this.isIgnoredByGitignore(fileUri, entries)) {
                    ignoredByGitignore++;
                    continue;
                }
                files.push(fileUri);
            }
        }

        return { files, ignoredByGitignore };
    }

    private async getGitignoreEntries(folder: vscode.WorkspaceFolder, forceRefresh: boolean = false): Promise<GitignoreEntry[]> {
        const rootPath = folder.uri.fsPath;
        const now = Date.now();
        const cached = this.gitignoreCache.get(rootPath);

        if (!forceRefresh && cached && (now - cached.lastScanMs) < this.gitignoreScanThrottleMs) {
            return cached.entries;
        }

        const gitignoreUris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/.gitignore'),
            this.excludePattern
        );

        const cachedByPath = new Map<string, GitignoreEntry>();
        if (cached) {
            for (const entry of cached.entries) {
                cachedByPath.set(entry.filePath, entry);
            }
        }

        const entries: GitignoreEntry[] = [];
        for (const uri of gitignoreUris) {
            const filePath = uri.fsPath;
            let stats: fs.Stats;
            try {
                stats = fs.statSync(filePath);
            } catch {
                continue;
            }

            const cachedEntry = cachedByPath.get(filePath);
            if (cachedEntry && cachedEntry.mtimeMs === stats.mtimeMs) {
                entries.push(cachedEntry);
                continue;
            }

            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const matcher = ignore();
                matcher.add(content);
                const dir = path.dirname(filePath);
                const depth = dir.split(path.sep).length;
                entries.push({
                    filePath,
                    dir,
                    matcher,
                    mtimeMs: stats.mtimeMs,
                    depth
                });
            } catch (e) {
                Logger.warn(`Erro ao ler .gitignore em ${filePath}.`, e);
            }
        }

        entries.sort((a, b) => a.depth - b.depth);
        this.gitignoreCache.set(rootPath, { entries, lastScanMs: now });
        return entries;
    }

    private isIgnoredByGitignore(fileUri: vscode.Uri, entries: GitignoreEntry[]): boolean {
        if (entries.length === 0) return false;

        const filePath = fileUri.fsPath;
        let ignored = false;

        for (const entry of entries) {
            const relPath = path.relative(entry.dir, filePath);
            if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) {
                continue;
            }

            const relPosix = relPath.split(path.sep).join('/');
            const result = entry.matcher.test(relPosix);
            if (result.ignored) ignored = true;
            if (result.unignored) ignored = false;
        }

        return ignored;
    }

    private async shouldIndexFile(uri: vscode.Uri): Promise<boolean> {
        const filePath = uri.fsPath;
        const extOk = /\.(ts|tsx|js|jsx|py|java|cs|cpp|c|h|md|json|html|css)$/i.test(filePath);
        if (!extOk) return false;

        const normalized = filePath.split(path.sep);
        if (normalized.includes('node_modules') || normalized.includes('.git')) return false;

        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) return false;
        const entries = await this.getGitignoreEntries(folder);
        if (entries.length > 0 && this.isIgnoredByGitignore(uri, entries)) return false;

        return true;
    }

    private semanticChunking(text: string, filePath: string): { text: string, type: string }[] {
        const ext = path.extname(filePath);
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            return this.tsChunking(text, filePath);
        }

        // Fallback or multi-language structural heuristic
        return this.heuristicChunking(text);
    }

    private tsChunking(text: string, filePath: string): { text: string, type: string }[] {
        const chunks: { text: string, type: string }[] = [];
        const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

        const visitor = (node: ts.Node) => {
            if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isMethodDeclaration(node)) {
                const start = node.getStart(sourceFile);
                const end = node.getEnd();
                const content = text.substring(start, end);

                if (content.length > 50) {
                    let type = 'code-block';
                    if (ts.isClassDeclaration(node)) type = 'class';
                    else if (ts.isFunctionDeclaration(node)) type = 'function';
                    else if (ts.isInterfaceDeclaration(node)) type = 'interface';
                    else if (ts.isMethodDeclaration(node)) type = 'method';

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

    private heuristicChunking(text: string): { text: string, type: string }[] {
        const chunks: { text: string, type: string }[] = [];
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

    private isStructuralLine(line: string): boolean {
        const trimmed = line.trim();
        return /^(export\s+)?(class|interface|function|const|let|var|def|public|private|protected|async)\s+\w+/.test(trimmed) ||
            (trimmed.includes('(') && trimmed.includes(')') && trimmed.endsWith('{'));
    }

    private chunkText(text: string, maxSize: number): string[] {
        // Kept for backward compatibility or simple files
        const chunks: string[] = [];
        let currentChunk = '';
        const lines = text.split('\n');

        for (const line of lines) {
            if ((currentChunk.length + line.length) > maxSize) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            currentChunk += line + '\n';
        }
        if (currentChunk.trim()) chunks.push(currentChunk);
        return chunks;
    }

    public async search(query: string, limit: number = 5): Promise<VectorDocument[]> {
        if (this.vectors.length === 0) return [];

        const queries = [query];

        // Advanced: Multi-query expansion
        try {
            const expandedQueries = await this.expandQuery(query);
            queries.push(...expandedQueries.slice(0, 2)); // Limit to 2 additional variations (total 3)
        } catch (e) {
            Logger.warn('Falha na expansão da query RAG.', e);
        }

        const allResults: Map<string, VectorDocument & { maxScore: number }> = new Map();

        for (const q of queries) {
            let queryEmbedding: number[];

            // Query Embedding Cache
            if (this.embeddingCache.has(q)) {
                queryEmbedding = this.embeddingCache.get(q)!;
            } else {
                queryEmbedding = await this.ollamaService.generateEmbeddings(q);
                // Keep cache small
                if (this.embeddingCache.size > 100) {
                    const firstKey = this.embeddingCache.keys().next().value;
                    if (firstKey) this.embeddingCache.delete(firstKey);
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

    private async expandQuery(query: string): Promise<string[]> {
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
        } catch (e) {
            return [];
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
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
