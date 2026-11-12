/**
 * Pure utility functions for RAG semantic chunking and concurrency management
 */

export interface SemanticChunk {
  text: string;
  type: string;
}

/**
 * Concurrently maps items using an async mapper function with a maximum limit on concurrent promises.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Semantic chunking for Python code based on classes, top-level defs, and decorators.
 */
export function chunkPythonCode(text: string): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let currentType = 'code-block';
  const minChunkSize = 80;
  const maxChunkSize = 1500;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTopLevelDef = /^(def |async def |class |@)/.test(line);

    if (isTopLevelDef && currentChunk.length > minChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: currentType });
      currentChunk = '';
      currentType = line.startsWith('class ') ? 'class' : (line.includes('def ') ? 'function' : 'code-block');
    }

    currentChunk += line + '\n';

    if (currentChunk.length > maxChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: currentType });
      currentChunk = '';
      currentType = 'code-block';
    }
  }

  if (currentChunk.trim().length > 30) {
    chunks.push({ text: currentChunk.trim(), type: currentType });
  }

  return chunks.filter(c => c.text.length > 40);
}

/**
 * Semantic chunking for Markdown documents based on headings (#, ##, ###).
 */
export function chunkMarkdown(text: string): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let currentType = 'markdown-section';
  const minChunkSize = 80;
  const maxChunkSize = 1600;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = /^#{1,4}\s+/.test(line);

    if (isHeading && currentChunk.length > minChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: currentType });
      currentChunk = '';
    }

    currentChunk += line + '\n';

    if (currentChunk.length > maxChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: currentType });
      currentChunk = '';
    }
  }

  if (currentChunk.trim().length > 30) {
    chunks.push({ text: currentChunk.trim(), type: currentType });
  }

  return chunks.filter(c => c.text.length > 40);
}

const BRACE_DECL_START = /^(?:public|private|protected|internal|static|final|abstract|sealed|partial|open|export|default|async|unsafe|extern|inline|virtual|override|readonly|friend|constexpr|template|namespace|package|import|using|module|impl|trait|enum|struct|class|interface|union|record|object|type|func|fn|void|int|long|short|byte|char|float|double|boolean|bool|string|auto|char16_t|size_t)\b/;

function braceDepthDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === '{') delta++;
    else if (ch === '}') delta--;
  }
  return delta;
}

/**
 * Semantic chunking for brace-delimited languages (Java, C#, C/C++, Go, Rust, etc.).
 * Splits on top-level declarations detected at brace depth 0.
 */
export function chunkBraceLanguage(text: string): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let depth = 0;
  const minChunkSize = 80;
  const maxChunkSize = 1500;

  for (const line of lines) {
    const trimmed = line.trim();
    const isTopLevelDecl = depth === 0 && trimmed.length > 0 && BRACE_DECL_START.test(trimmed);

    if (isTopLevelDecl && currentChunk.length > minChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: 'declaration' });
      currentChunk = '';
    }

    currentChunk += line + '\n';
    depth = Math.max(0, depth + braceDepthDelta(line));

    if (currentChunk.length > maxChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: 'code-block' });
      currentChunk = '';
    }
  }

  if (currentChunk.trim().length > 30) {
    chunks.push({ text: currentChunk.trim(), type: 'declaration' });
  }

  return chunks.filter(c => c.text.length > 40);
}

const CSS_SELECTOR_START = /^@?[a-zA-Z#.*:[\]-][^{;]*\{?\s*$/;

/**
 * Semantic chunking for CSS/SCSS/Less: splits on top-level selectors and at-rules.
 */
export function chunkCss(text: string): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let depth = 0;
  const minChunkSize = 60;
  const maxChunkSize = 1200;

  for (const line of lines) {
    const trimmed = line.trim();
    const isTopLevelRule = depth === 0 && trimmed.length > 0 && CSS_SELECTOR_START.test(trimmed) && !trimmed.endsWith(';');

    if (isTopLevelRule && currentChunk.length > minChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: 'css-rule' });
      currentChunk = '';
    }

    currentChunk += line + '\n';
    depth = Math.max(0, depth + braceDepthDelta(line));

    if (currentChunk.length > maxChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: 'css-block' });
      currentChunk = '';
    }
  }

  if (currentChunk.trim().length > 30) {
    chunks.push({ text: currentChunk.trim(), type: 'css-rule' });
  }

  return chunks.filter(c => c.text.length > 40);
}

const HTML_MAJOR_TAG = /^\s*<(section|article|header|footer|main|nav|aside|h[1-6]|table|form|ul|ol)\b/i;

/**
 * Semantic chunking for HTML/XML markup: splits on major block-level tags.
 */
export function chunkMarkup(text: string): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const lines = text.split('\n');
  let currentChunk = '';
  const minChunkSize = 120;
  const maxChunkSize = 2000;

  for (const line of lines) {
    if (HTML_MAJOR_TAG.test(line) && currentChunk.length > minChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: 'markup-section' });
      currentChunk = '';
    }

    currentChunk += line + '\n';

    if (currentChunk.length > maxChunkSize) {
      chunks.push({ text: currentChunk.trim(), type: 'markup-block' });
      currentChunk = '';
    }
  }

  if (currentChunk.trim().length > 30) {
    chunks.push({ text: currentChunk.trim(), type: 'markup-section' });
  }

  return chunks.filter(c => c.text.length > 40);
}

/**
 * Semantic chunking for JSON: one chunk per top-level key when parseable,
 * otherwise falls back to declaration-based splitting.
 */
export function chunkJson(text: string): SemanticChunk[] {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const chunks: SemanticChunk[] = [];
      for (const [key, value] of Object.entries(parsed)) {
        const serialized = JSON.stringify({ [key]: value }, null, 2);
        if (serialized.length > 40) {
          chunks.push({ text: serialized, type: `json:${key}` });
        }
      }
      if (chunks.length > 0) return chunks;
    }
    if (Array.isArray(parsed)) {
      const chunks: SemanticChunk[] = parsed
        .map((item, i) => ({ text: JSON.stringify(item, null, 2), type: `json[${i}]` }))
        .filter(c => c.text.length > 40);
      if (chunks.length > 0) return chunks;
    }
  } catch {
    // fall through to heuristic below
  }

  return chunkBraceLanguage(text);
}
