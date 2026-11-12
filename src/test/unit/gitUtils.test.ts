import * as assert from 'assert';
import {
  GIT_OUTPUT_LIMIT,
  buildCommitAnalysisPrompt,
  sanitizeGitRef,
  truncateGitText
} from '../../utils/git';

suite('GitUtils (unit)', () => {
  test('sanitizeGitRef accepts common refs', () => {
    assert.strictEqual(sanitizeGitRef(''), 'HEAD');
    assert.strictEqual(sanitizeGitRef('  HEAD~3  '), 'HEAD~3');
    assert.strictEqual(sanitizeGitRef('feature/x'), 'feature/x');
    assert.strictEqual(sanitizeGitRef('abc1234'), 'abc1234');
    assert.strictEqual(sanitizeGitRef('HEAD@{1}'), 'HEAD@{1}');
  });

  test('sanitizeGitRef rejects dangerous input', () => {
    assert.throws(() => sanitizeGitRef('HEAD; rm -rf /'));
    assert.throws(() => sanitizeGitRef('$(whoami)'));
    assert.throws(() => sanitizeGitRef('a`b`'));
  });

  test('truncateGitText keeps short output intact', () => {
    assert.strictEqual(truncateGitText('abc'), 'abc');
  });

  test('truncateGitText truncates and notes omitted chars', () => {
    const long = 'x'.repeat(GIT_OUTPUT_LIMIT + 500);
    const result = truncateGitText(long);
    assert.ok(result.startsWith('x'.repeat(GIT_OUTPUT_LIMIT)));
    assert.ok(result.includes('500 caracteres omitidos'));
  });

  test('buildCommitAnalysisPrompt embeds content and instruction', () => {
    const prompt = buildCommitAnalysisPrompt('DIFF CONTENT', 'ache bugs', 'commit');
    assert.ok(prompt.includes('DIFF CONTENT'));
    assert.ok(prompt.includes('ache bugs'));
    assert.ok(prompt.includes('commit'));
  });
});
