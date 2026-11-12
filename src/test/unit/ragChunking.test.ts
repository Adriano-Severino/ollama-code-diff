import * as assert from 'assert';
import { chunkPythonCode, chunkMarkdown, chunkBraceLanguage, chunkCss, chunkMarkup, chunkJson, mapConcurrent } from '../../utils/ragUtils';

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

  test('chunkBraceLanguage splits Java-style declarations at top level', () => {
    const javaCode = `package com.example;

public class Greeter {
    private String name;

    public Greeter(String name) {
        this.name = name;
    }

    public String greet() {
        return "Hello " + name;
    }
}

interface Speaker {
    void speak();
    void listen(String input);
    int volume();
}
`;

    const chunks = chunkBraceLanguage(javaCode);
    assert.ok(chunks.length >= 1);
    const fullText = chunks.map(c => c.text).join('\n');
    assert.ok(fullText.includes('public class Greeter'));
    assert.ok(fullText.includes('interface Speaker'));
  });

  test('chunkBraceLanguage splits Go functions', () => {
    const goCode = `package main

import "fmt"

func main() {
	fmt.Println("hello")
}

func helper() int {
	return 42
}
`;

    const chunks = chunkBraceLanguage(goCode);
    const fullText = chunks.map(c => c.text).join('\n');
    assert.ok(fullText.includes('func main()'));
    assert.ok(fullText.includes('func helper()'));
  });

  test('chunkCss splits on top-level selectors', () => {
    const css = `.header {
  color: red;
  padding: 10px;
}

.footer {
  color: blue;
  margin: 0;
}
`;

    const chunks = chunkCss(css);
    assert.ok(chunks.length >= 1);
    const fullText = chunks.map(c => c.text).join('\n');
    assert.ok(fullText.includes('.header'));
    assert.ok(fullText.includes('.footer'));
  });

  test('chunkMarkup splits on major html tags', () => {
    const html = `<html><body>
<header>
  <h1>Title</h1>
</header>
<section>
  <p>Some content here that is reasonably long to pass filters.</p>
</section>
<footer>
  <p>Footer text with enough characters to be kept.</p>
</footer>
</body></html>`;

    const chunks = chunkMarkup(html);
    assert.ok(chunks.length >= 1);
    const fullText = chunks.map(c => c.text).join('\n');
    assert.ok(fullText.includes('<header>'));
    assert.ok(fullText.includes('<footer>'));
  });

  test('chunkJson emits one chunk per top-level key', () => {
    const json = JSON.stringify({
      name: 'my-project-with-a-rather-long-name',
      scripts: { build: 'tsc', test: 'mocha' },
      dependencies: { vscode: '^1.85.0' }
    }, null, 2);

    const chunks = chunkJson(json);
    assert.ok(chunks.length >= 2);
    assert.ok(chunks.some(c => c.type === 'json:name'));
    assert.ok(chunks.some(c => c.type === 'json:scripts'));
  });

  test('chunkJson falls back gracefully on invalid json', () => {
    const chunks = chunkJson('not json at all {{{');
    assert.ok(Array.isArray(chunks));
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
