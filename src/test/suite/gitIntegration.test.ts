import * as assert from 'assert';
import * as path from 'path';
import {
  isGitRepository,
  runGit,
  getCommitShow,
  getRecentCommitsLog,
  sanitizeGitRef
} from '../../utils/git';

// O repositorio da extensao e a raiz de desenvolvimento; os testes rodam a partir de out/test/suite
const repoRoot = path.resolve(__dirname, '../../..');

suite('Git Integration', () => {
  test('runGit executes git --version', async () => {
    const output = await runGit(['--version'], repoRoot);
    assert.ok(/git version/i.test(output), `Unexpected git version output: ${output}`);
  });

  test('isGitRepository detects the extension repo', async () => {
    assert.strictEqual(await isGitRepository(repoRoot), true);
  });

  test('isGitRepository returns false outside a repo', async () => {
    const osTmp = require('os').tmpdir();
    assert.strictEqual(await isGitRepository(osTmp), false);
  });

  test('getCommitShow returns HEAD commit details', async () => {
    const show = await getCommitShow(repoRoot, 'HEAD');
    assert.ok(show.includes('commit'), 'Expected commit header in git show output');
  });

  test('getRecentCommitsLog returns recent history', async () => {
    const log = await getRecentCommitsLog(repoRoot, 3);
    assert.ok(log.trim().length > 0, 'Expected non-empty git log output');
  });

  test('sanitizeGitRef blocks command injection', () => {
    assert.throws(() => sanitizeGitRef('HEAD && calc'));
    assert.throws(() => sanitizeGitRef('HEAD;whoami'));
    assert.strictEqual(sanitizeGitRef('HEAD~2'), 'HEAD~2');
  });
});
