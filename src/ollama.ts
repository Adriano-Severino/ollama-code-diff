import { Ollama } from 'ollama';
import fetch from 'cross-fetch';
import * as vscode from 'vscode';
import { performance } from 'perf_hooks';

type AbortableOpts = { signal?: AbortSignal };

export class OllamaService {
  private ollama: Ollama;

  constructor() {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const host = config.get<string>('ollamaHost', 'http://localhost:11434');

    this.ollama = new Ollama({
      host,
      fetch: fetch as any,
    });
  }

  /**
   * NEW: Abort all active requests started by this Ollama client instance.
   * Use this on "Stop" button.
   */
  public abort(): void {
    try {
      // ollama-js supports aborting all active requests for a client instance
      (this.ollama as any).abort?.();
    } catch {
      // ignore
    }
  }

  // Helper: attach AbortSignal -> call ollama.abort()
  private attachAbort(signal?: AbortSignal): (() => void) | undefined {
    if (!signal) return;

    const handler = () => {
      try {
        this.abort();
      } catch {
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

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      (err as any).name = 'AbortError';
      throw err;
    }
  }

  // NOVO: Método para obter lista de modelos do Ollama
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.ollama.list();
      if (response && (response as any).models) {
        return (response as any).models.map((model: any) => model.name);
      }
      return [];
    } catch (error) {
      console.error('Erro ao obter lista de modelos:', error);
      return [
        'qwen2.5-coder:1.5b-base',
        'qwen2.5-coder:7b',
        'codellama:7b-instruct-q5_K_M',
      ];
    }
  }

  // NOVO: Método para obter informações detalhadas dos modelos
  async getModelDetails(): Promise<Array<{ name: string; size: string; modified: string }>> {
    try {
      const response = await this.ollama.list();

      if (response && (response as any).models) {
        return (response as any).models.map((model: any) => ({
          name: model.name,
          size: this.formatSize(model.size),
          modified: new Date(model.modified_at).toLocaleDateString(),
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
    if (!bytes) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  }

  async generateCode(prompt: string, opts: AbortableOpts = {}): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
    const contextSize = config.get<number>('contextSize', 32768);
    const maxTokens = config.get<number>('maxTokens', 8192);

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const t0 = performance.now();

      const req: any = {
        model,
        prompt,
        stream: false,
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
      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).generate(req);

      const t1 = performance.now();
      console.log(`Ollama gerou código em: ${(t1 - t0) / 1000} segundos`);

      return this.cleanCodeResponse(response.response);
    } catch (error) {
      console.error('Erro ao comunicar com Ollama:', error);
      throw new Error(`Falha na comunicação com Ollama: ${error}`);
    } finally {
      detach?.();
    }
  }

  async *generateStream(prompt: string, opts: AbortableOpts = {}): AsyncGenerator<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
    const contextSize = config.get<number>('contextSize', 32768);
    const maxTokens = config.get<number>('maxTokens', 8192);

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const req: any = {
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

      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).generate(req);

      for await (const part of response) {
        this.throwIfAborted(opts.signal);
        yield part.response;
      }
    } catch (error) {
      console.error('Erro no stream do Ollama:', error);
      throw error;
    } finally {
      detach?.();
    }
  }

  async analyzeFile(filePath: string, instruction: string, opts: AbortableOpts = {}): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
    const contextSize = config.get<number>('contextSize', 32768);
    const maxTokens = config.get<number>('maxTokens', 8192);
    const chunkSize = config.get<number>('chunkSize', 25000);

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const content = Buffer.from(fileContent).toString('utf8');

      const maxSize = chunkSize * 2; // 50KB por padrão antes de fragmentar
      console.log(`Analisando arquivo de ${content.length} caracteres (limite: ${maxSize})`);

      if (content.length > maxSize) {
        return await this.analyzeFileInChunks(content, instruction, model, opts);
      }

      const fullPrompt = this.buildAnalysisPrompt(content, instruction);

      const req: any = {
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

      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).generate(req);
      return this.cleanCodeResponse(response.response);
    } catch (error) {
      console.error('Erro ao analisar arquivo:', error);
      throw error;
    } finally {
      detach?.();
    }
  }

  // NOVO: Análise de projeto completo
  async analyzeProject(projectPath: string, instruction: string, opts: AbortableOpts = {}): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const repoMap = await this.createRepositoryMap(projectPath);
      this.throwIfAborted(opts.signal);

      const mainFiles = await this.identifyMainFiles(projectPath);
      this.throwIfAborted(opts.signal);

      const projectContext = await this.buildProjectContext(mainFiles, repoMap, instruction, opts);

      const req: any = {
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

      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).generate(req);
      return response.response;
    } catch (error) {
      console.error('Erro ao analisar projeto:', error);
      throw error;
    } finally {
      detach?.();
    }
  }

  // NOVO: Análise de múltiplos arquivos específicos
  async analyzeMultipleFiles(filePaths: string[], instruction: string, opts: AbortableOpts = {}): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const filesContent: Array<{ path: string; content: string }> = [];
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
        } catch (error) {
          console.error(`Erro ao ler arquivo ${filePath}:`, error);
        }
      }

      if (totalSize > 30000) {
        return await this.analyzeMultipleFilesInChunks(filesContent, instruction, model, opts);
      }

      const multiFilePrompt = this.buildMultiFilePrompt(filesContent, instruction);

      const req: any = {
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

      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).generate(req);
      return response.response;
    } catch (error) {
      console.error('Erro ao analisar múltiplos arquivos:', error);
      throw error;
    } finally {
      detach?.();
    }
  }

  private async analyzeFileInChunks(content: string, instruction: string, model: string, opts: AbortableOpts): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const chunkSize = config.get<number>('chunkSize', 25000);
    const contextSize = config.get<number>('contextSize', 32768);
    const maxTokens = config.get<number>('maxTokens', 8192);

    const chunks = this.splitIntoChunks(content, chunkSize);
    const results: string[] = [];

    console.log(`Fragmentando arquivo em ${chunks.length} partes de ~${chunkSize} caracteres cada`);

    for (let i = 0; i < chunks.length; i++) {
      this.throwIfAborted(opts.signal);

      const chunkPrompt = this.buildChunkPrompt(chunks[i], instruction, i + 1, chunks.length);

      try {
        console.log(`Processando parte ${i + 1}/${chunks.length}...`);

        const req: any = {
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

        if (opts.signal) req.signal = opts.signal;

        const response = await (this.ollama as any).generate(req);
        results.push(`=== PARTE ${i + 1}/${chunks.length} ===\n${response.response}`);

        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Erro na parte ${i + 1}:`, error);
        results.push(`=== ERRO NA PARTE ${i + 1} ===\nErro: ${error}`);
      }
    }

    this.throwIfAborted(opts.signal);

    console.log('Consolidando análises...');
    const consolidatedPrompt = this.buildConsolidationPrompt(results.join('\n\n'), instruction);

    const finalReq: any = {
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

    if (opts.signal) finalReq.signal = opts.signal;

    const finalResponse = await (this.ollama as any).generate(finalReq);
    return finalResponse.response;
  }

  // Criar mapa do repositório
  private async createRepositoryMap(_projectPath: string): Promise<string> {
    try {
      const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,c,h}', '**/node_modules/**');

      const repoMap: string[] = [];
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
        } catch {
          // ignore
        }
      }

      return repoMap.join('\n');
    } catch (error) {
      console.error('Erro ao criar mapa do repositório:', error);
      return 'Erro ao mapear repositório';
    }
  }

  // Extrair assinaturas de código
  private extractSignatures(content: string, _filePath: string): string[] {
    const signatures: string[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.match(/^(export\s+)?(class|interface|function|const|let|var)\s+\w+/)) signatures.push(`- ${line}`);
      else if (line.match(/^(class|def)\s+\w+/)) signatures.push(`- ${line}`);
      else if (line.match(/^(public|private|protected|internal)\s+(class|interface|static|void|int|string)/)) signatures.push(`- ${line}`);
    }

    return signatures.slice(0, 10);
  }

  // Identificar arquivos principais do projeto
  private async identifyMainFiles(_projectPath: string): Promise<string[]> {
    const importantFiles: string[] = [];

    const configFiles = await vscode.workspace.findFiles('{package.json,tsconfig.json,*.config.js,main.py,app.py,index.ts,index.js,Program.cs}');
    for (const file of configFiles) importantFiles.push(file.fsPath);

    return importantFiles.slice(0, 5);
  }

  private async buildProjectContext(mainFiles: string[], repoMap: string, instruction: string, opts: AbortableOpts): Promise<string> {
    // Nota: seu código original só listava nomes; aqui mantive o formato mas também anexo conteúdo real
    const filesSection: string[] = [];
    filesSection.push('## MAIN FILES CONTENT');

    for (let i = 0; i < mainFiles.length; i++) {
      this.throwIfAborted(opts.signal);

      const fp = mainFiles[i];
      let content = '';
      try {
        const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(fp));
        content = Buffer.from(buf).toString('utf8');
      } catch {
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

  private buildMultiFilePrompt(filesContent: Array<{ path: string; content: string }>, instruction: string): string {
    const filesSection = filesContent
      .map((file, index) => `### File ${index + 1}: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
      .join('\n\n');

    return `[INST] MULTI-FILE ANALYSIS

Instruction: ${instruction}

Files to analyze:
${filesSection}

Please analyze these files together and provide insights based on the instruction. [/INST]`;
  }

  private async analyzeMultipleFilesInChunks(
    filesContent: Array<{ path: string; content: string }>,
    instruction: string,
    model: string,
    opts: AbortableOpts
  ): Promise<string> {
    const results: string[] = [];

    for (let i = 0; i < filesContent.length; i++) {
      this.throwIfAborted(opts.signal);

      const file = filesContent[i];
      const prompt = `[INST] Analyzing file ${i + 1}/${filesContent.length}: ${file.path}

Instruction: ${instruction}

Content:
\`\`\`
${file.content}
\`\`\`

Analyze this file in context of multi-file analysis: [/INST]`;

      try {
        const req: any = {
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

        if (opts.signal) req.signal = opts.signal;

        const response = await (this.ollama as any).generate(req);
        results.push(`## ${file.path}\n${response.response}`);
      } catch (error) {
        results.push(`## ${file.path}\nERRO: ${error}`);
      }
    }

    this.throwIfAborted(opts.signal);

    const consolidationPrompt = `[INST] CONSOLIDATION OF MULTI-FILE ANALYSIS

Original instruction: ${instruction}

Individual file analyses:
${results.join('\n\n')}

Provide a unified analysis considering all files together: [/INST]`;

    const finalReq: any = {
      model,
      prompt: consolidationPrompt,
      stream: false,
      options: {
        temperature: 0.5,
        num_predict: 8192,
        num_ctx: 65536,
      },
    };

    if (opts.signal) finalReq.signal = opts.signal;

    const finalResponse = await (this.ollama as any).generate(finalReq);
    return finalResponse.response;
  }

  private splitIntoChunks(content: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    const lines = content.split('\n');
    let currentChunk = '';

    for (const line of lines) {
      const newChunk = currentChunk + line + '\n';
      if (newChunk.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk = newChunk;
      }
    }

    if (currentChunk.length > 0) chunks.push(currentChunk);
    return chunks;
  }

  private isStructuralLine(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('class ') ||
      trimmed.startsWith('function ') ||
      trimmed.startsWith('def ') ||
      trimmed.startsWith('public ') ||
      trimmed.startsWith('private ') ||
      trimmed.startsWith('protected ') ||
      trimmed.includes('function(') ||
      trimmed.includes(') {')
    );
  }

  private buildAnalysisPrompt(content: string, instruction: string): string {
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

  private buildChunkPrompt(chunk: string, instruction: string, partNum: number, totalParts: number): string {
    return `[INST] LARGE FILE ANALYSIS - PART ${partNum} of ${totalParts}

Main instruction: ${instruction}

Code fragment to analyze:
${chunk}

Note: This is part ${partNum} of ${totalParts} of a larger file. Focus on this fragment while considering it may have dependencies elsewhere.

Provide analysis for this specific part: [/INST]`;
  }

  private buildConsolidationPrompt(allResults: string, instruction: string): string {
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

  private cleanCodeResponse(response: string): string {
    let cleaned = response.trim();

    const lines = cleaned.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith('Aqui está') &&
        !trimmed.startsWith('Este código') &&
        !trimmed.startsWith('O código acima') &&
        !trimmed.startsWith('Explicação:') &&
        !trimmed.startsWith('Como funciona:')
      );
    });

    return filteredLines.join('\n').trim();
  }

  /**
   * STREAM CHAT (supports AbortSignal)
   */
  async *chatStream(
    message: string,
    history: Array<{ role: string; content: string }> = [],
    opts: AbortableOpts = {}
  ): AsyncGenerator<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
    const contextSize = config.get<number>('contextSize', 32768);
    const maxTokens = config.get<number>('maxTokens', 8192);

    const detach = this.attachAbort(opts.signal);

    const messages = [...history, { role: 'user', content: message }];

    try {
      this.throwIfAborted(opts.signal);

      const req: any = {
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

      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).chat(req);

      for await (const part of response) {
        this.throwIfAborted(opts.signal);
        yield part.message.content;
      }
    } catch (error) {
      console.error('Erro no stream do chat Ollama:', error);
      throw error;
    } finally {
      detach?.();
    }
  }

  /**
   * Non-stream chat (supports AbortSignal)
   */
  async chat(messages: Array<{ role: string; content: string }>, opts: AbortableOpts = {}): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('modelName', 'codellama:7b-instruct-q5_K_M');
    const contextSize = config.get<number>('contextSize', 32768);
    const maxTokens = config.get<number>('maxTokens', 8192);

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const req: any = {
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: maxTokens,
          num_ctx: contextSize,
          repeat_penalty: 1.1,
        },
      };

      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).chat(req);
      return response.message.content;
    } catch (error) {
      console.error('Erro no chat raw do Ollama:', error);
      throw error;
    } finally {
      detach?.();
    }
  }

  // Mantido por compatibilidade com seu código antigo
  async chatWithOllama(message: string, history: Array<{ role: string; content: string }> = [], opts: AbortableOpts = {}): Promise<string> {
    const messages = [...history, { role: 'user', content: message }];
    return await this.chat(messages, opts);
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

      return {
        model,
        maxContext: 32768,
        recommendedChunkSize: 25000,
        maxFileSize: 50000,
      };
    } catch (error) {
      console.error('Erro ao obter info do modelo:', error);
      return null;
    }
  }

  async generateCompletion(prompt: string, opts: AbortableOpts = {}): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('completionModelName', config.get<string>('modelName', 'qwen2.5-coder:1.5b-base'));

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const req: any = {
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

      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).generate(req);
      return response.response;
    } catch (error) {
      console.warn('Falha no autocompletar:', error);
      return '';
    } finally {
      detach?.();
    }
  }

  async generateEmbeddings(prompt: string, opts: AbortableOpts = {}): Promise<number[]> {
    const config = vscode.workspace.getConfiguration('ollama-code-diff');
    const model = config.get<string>('embeddingModelName', 'nomic-embed-text');

    const detach = this.attachAbort(opts.signal);

    try {
      this.throwIfAborted(opts.signal);

      const req: any = { model, prompt };
      if (opts.signal) req.signal = opts.signal;

      const response = await (this.ollama as any).embeddings(req);
      return response.embedding;
    } catch (error) {
      console.error('Erro ao gerar embeddings:', error);
      throw error;
    } finally {
      detach?.();
    }
  }
}