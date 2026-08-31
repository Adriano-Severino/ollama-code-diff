import * as assert from 'assert';
import { chunkPythonCode, chunkMarkdown, mapConcurrent } from '../../utils/ragUtils';

suite('RAG Chunking & Concurrency (unit)', () => {
  test('chunkPythonCode divides code by class and def structures', () => {
    const pythonCode = `
import math

class Calculator:
    def __init__(self):
        self.history = []

    def add(self, a, b):
        result = a + b
        self.history.append(result)
        return result

def standalone_helper(x, y):
    """A helpful standalone utility function that does extra operations."""
    return x * y + 42
`;

    const chunks = chunkPythonCode(pythonCode);
    assert.ok(chunks.length >= 1, 'Should extract at least one chunk');
    const fullText = chunks.map(c => c.text).join('\n');
    assert.ok(fullText.includes('class Calculator'), 'Should contain class declaration');
    assert.ok(fullText.includes('standalone_helper'), 'Should contain helper function');
  });

  test('chunkMarkdown divides markdown documents by headings', () => {
    const markdownDoc = `
# Project Overview
This project is an awesome extension that provides AI capabilities directly in your local environment.

## Installation Guide
To install this extension, run the following commands in your favorite terminal window:
\`\`\`bash
npm install
npm run build
\`\`\`

## Architecture & Design
The system uses a modular design with RAG semantic indexing, inline completion providers, and autonomous agents.
`;

    const chunks = chunkMarkdown(markdownDoc);
    assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
    assert.ok(chunks.some(c => c.text.includes('Installation Guide')));
    assert.ok(chunks.some(c => c.text.includes('Architecture & Design')));
  });

  test('mapConcurrent executes promises in order and limits concurrency', async () => {
    const items = [1, 2, 3, 4, 5, 6];
    let active = 0;
    let maxActive = 0;

    const results = await mapConcurrent(items, 2, async (num) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
      return num * 10;
    });

    assert.deepStrictEqual(results, [10, 20, 30, 40, 50, 60]);
    assert.ok(maxActive <= 2, `maxActive (${maxActive}) should be <= 2`);
  });
});
