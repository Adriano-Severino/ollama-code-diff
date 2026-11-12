import * as assert from 'assert';
import {
  findPromptTemplate,
  normalizeTemplateName,
  renderPromptTemplate
} from '../../utils/promptTemplates';

suite('PromptTemplates (unit)', () => {
  test('normalizeTemplateName strips slash and lowercases', () => {
    assert.strictEqual(normalizeTemplateName('/Docs'), 'docs');
    assert.strictEqual(normalizeTemplateName(' docs '), 'docs');
    assert.strictEqual(normalizeTemplateName(''), '');
  });

  test('findPromptTemplate matches command ignoring case and slash', () => {
    const templates = { docs: 'Document {input}', '/Review': 'Review {selection}' };
    assert.strictEqual(findPromptTemplate('/docs', templates), 'Document {input}');
    assert.strictEqual(findPromptTemplate('review', templates), 'Review {selection}');
    assert.strictEqual(findPromptTemplate('/missing', templates), undefined);
    assert.strictEqual(findPromptTemplate('/docs', undefined), undefined);
  });

  test('findPromptTemplate ignores empty templates', () => {
    assert.strictEqual(findPromptTemplate('/docs', { docs: '   ' }), undefined);
    assert.strictEqual(findPromptTemplate('/docs', { docs: 42 as any }), undefined);
  });

  test('renderPromptTemplate replaces known variables', () => {
    const rendered = renderPromptTemplate(
      'File {file} ({language})\nInput: {input}\nSelection:\n{selection}',
      { input: 'add tests', selection: 'const x = 1;', file: 'src/app.ts', language: 'typescript' }
    );

    assert.ok(rendered.includes('File src/app.ts (typescript)'));
    assert.ok(rendered.includes('Input: add tests'));
    assert.ok(rendered.includes('const x = 1;'));
  });

  test('renderPromptTemplate keeps unknown placeholders untouched', () => {
    const rendered = renderPromptTemplate('Use {unknown} and {input}', {
      input: 'hi',
      selection: '',
      file: '',
      language: ''
    });

    assert.strictEqual(rendered, 'Use {unknown} and hi');
  });
});
