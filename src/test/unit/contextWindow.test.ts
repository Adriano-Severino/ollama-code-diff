import * as assert from 'assert';
import {
  chunkTextForTokenBudget,
  estimateTokenCount,
  splitTextIntoChunks
} from '../../utils/contextWindow';

suite('ContextWindow (unit)', () => {
  test('estimates token count from chars', () => {
    assert.strictEqual(estimateTokenCount('abcd'), 1);
    assert.strictEqual(estimateTokenCount('abcde'), 2);
    assert.strictEqual(estimateTokenCount(''), 0);
  });

  test('splits text into bounded chunks and preserves content', () => {
    const longLine = 'x'.repeat(35);
    const source = `line-1\n${longLine}\nline-3`;
    const chunks = splitTextIntoChunks(source, 10);

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 10));
    assert.strictEqual(chunks.join(''), source);
  });

  test('respects token budget and marks truncation', () => {
    const source = 'a'.repeat(400);
    const result = chunkTextForTokenBudget(source, {
      chunkSizeChars: 100,
      maxTokens: 30,
      charsPerToken: 4
    });

    assert.strictEqual(result.truncated, true);
    assert.ok(result.usedTokens <= 30);
    assert.ok(result.includedChunkCount >= 1);
    assert.ok(result.omittedChunkCount > 0 || result.partialChunkIncluded);
  });

  test('returns full content when budget is enough', () => {
    const source = 'hello\nworld';
    const result = chunkTextForTokenBudget(source, {
      chunkSizeChars: 100,
      maxTokens: 100
    });

    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.chunks.join(''), source);
  });
});
