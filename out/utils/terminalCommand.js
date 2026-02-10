"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TERMINAL_STREAM_LIMIT = void 0;
exports.truncateForContext = truncateForContext;
exports.formatTerminalCommandForContext = formatTerminalCommandForContext;
exports.DEFAULT_TERMINAL_STREAM_LIMIT = 6000;
function truncateForContext(raw, maxChars = exports.DEFAULT_TERMINAL_STREAM_LIMIT) {
    const normalized = String(raw ?? '');
    const limit = Number.isFinite(maxChars) && maxChars > 0
        ? Math.floor(maxChars)
        : exports.DEFAULT_TERMINAL_STREAM_LIMIT;
    if (normalized.length <= limit) {
        return { text: normalized, truncated: false };
    }
    const hiddenChars = normalized.length - limit;
    return {
        text: `${normalized.slice(0, limit)}\n...[truncated ${hiddenChars} chars]`,
        truncated: true
    };
}
function formatTerminalCommandForContext(capture, maxStreamChars = exports.DEFAULT_TERMINAL_STREAM_LIMIT) {
    const stdout = truncateForContext(capture.stdout || '', maxStreamChars);
    const stderr = truncateForContext(capture.stderr || '', maxStreamChars);
    const durationMs = Math.max(0, Math.round(capture.durationMs || 0));
    const lines = [
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
//# sourceMappingURL=terminalCommand.js.map