import * as assert from 'assert';
import {
  DEFAULT_TERMINAL_STREAM_LIMIT,
  formatTerminalCommandForContext,
  truncateForContext
} from '../../utils/terminalCommand';

suite('TerminalCommand (unit)', () => {
  test('formats completed execution with stdout and stderr', () => {
    const formatted = formatTerminalCommandForContext({
      command: 'npm test',
      cwd: 'C:\\repo',
      status: 'completed',
      exitCode: 0,
      durationMs: 1200,
      stdout: 'ok',
      stderr: ''
    });

    assert.ok(formatted.includes('Terminal Command: npm test'));
    assert.ok(formatted.includes('Status: completed'));
    assert.ok(formatted.includes('Exit Code: 0'));
    assert.ok(formatted.includes('STDOUT:\nok'));
    assert.ok(formatted.includes('STDERR:\n(empty)'));
  });

  test('formats cancelled execution', () => {
    const formatted = formatTerminalCommandForContext({
      command: 'npm install',
      cwd: 'C:\\repo',
      status: 'cancelled',
      exitCode: null,
      durationMs: 0
    });

    assert.ok(formatted.includes('Status: cancelled'));
    assert.ok(formatted.includes('Result: command execution was cancelled by the user.'));
  });

  test('truncates oversized command streams and adds note', () => {
    const longText = 'a'.repeat(30);
    const formatted = formatTerminalCommandForContext({
      command: 'echo test',
      cwd: 'C:\\repo',
      status: 'failed',
      exitCode: 1,
      durationMs: 20,
      stdout: longText,
      stderr: longText
    }, 10);

    assert.ok(formatted.includes('...[truncated 20 chars]'));
    assert.ok(formatted.includes('Note: command output was truncated to 10 chars per stream.'));
  });

  test('uses default limit when truncate input is invalid', () => {
    const source = 'x'.repeat(DEFAULT_TERMINAL_STREAM_LIMIT + 10);
    const result = truncateForContext(source, 0);

    assert.strictEqual(result.truncated, true);
    assert.ok(result.text.includes(`[truncated 10 chars]`));
  });
});
