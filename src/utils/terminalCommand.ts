export const DEFAULT_TERMINAL_STREAM_LIMIT = 6000;

export type TerminalCommandStatus = 'completed' | 'failed' | 'cancelled';

export type TerminalCommandContext = {
  command: string;
  cwd: string;
  status: TerminalCommandStatus;
  exitCode: number | null;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  errorMessage?: string;
};

export function truncateForContext(raw: string, maxChars = DEFAULT_TERMINAL_STREAM_LIMIT): { text: string; truncated: boolean } {
  const normalized = String(raw ?? '');
  const limit = Number.isFinite(maxChars) && maxChars > 0
    ? Math.floor(maxChars)
    : DEFAULT_TERMINAL_STREAM_LIMIT;

  if (normalized.length <= limit) {
    return { text: normalized, truncated: false };
  }

  const hiddenChars = normalized.length - limit;
  return {
    text: `${normalized.slice(0, limit)}\n...[truncated ${hiddenChars} chars]`,
    truncated: true
  };
}

export function formatTerminalCommandForContext(
  capture: TerminalCommandContext,
  maxStreamChars = DEFAULT_TERMINAL_STREAM_LIMIT
): string {
  const stdout = truncateForContext(capture.stdout || '', maxStreamChars);
  const stderr = truncateForContext(capture.stderr || '', maxStreamChars);
  const durationMs = Math.max(0, Math.round(capture.durationMs || 0));

  const lines: string[] = [
    `Terminal Command: ${capture.command}`,
    `Working Directory: ${capture.cwd}`,
    `Status: ${capture.status}`,
    `Exit Code: ${capture.exitCode === null ? 'null' : capture.exitCode}`,
    `DurationMs: ${durationMs}`
  ];

  if (capture.status === 'cancelled') {
    lines.push('Result: command execution was cancelled by the user.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('STDOUT:');
  lines.push(stdout.text || '(empty)');
  lines.push('');
  lines.push('STDERR:');
  lines.push(stderr.text || '(empty)');

  if (capture.errorMessage) {
    lines.push('');
    lines.push('ERROR:');
    lines.push(capture.errorMessage);
  }

  if (stdout.truncated || stderr.truncated) {
    lines.push('');
    lines.push(`Note: command output was truncated to ${Math.max(1, Math.floor(maxStreamChars))} chars per stream.`);
  }

  return lines.join('\n');
}
