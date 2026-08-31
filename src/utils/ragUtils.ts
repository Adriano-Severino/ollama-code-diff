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
