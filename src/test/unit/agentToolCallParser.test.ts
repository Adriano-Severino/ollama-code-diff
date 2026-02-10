import * as assert from 'assert';
import { parseAgentToolCall } from '../../utils/agentToolCallParser';

suite('AgentToolCallParser (unit)', () => {
  test('parses tool call from fenced JSON block', () => {
    const response = `Thought: I should inspect the file.
Plan: Read source and continue.
Action:
\`\`\`json
{"tool":"read","args":{"filePath":"src/extension.ts"}}
\`\`\``;

    const parsed = parseAgentToolCall(response);
    assert.ok(parsed);
    assert.strictEqual(parsed?.tool, 'read');
    assert.strictEqual(parsed?.args.filePath, 'src/extension.ts');
  });

  test('parses inline JSON object', () => {
    const response = `Action: {"tool":"searchtext","args":{"query":"DiffManager"}}`;
    const parsed = parseAgentToolCall(response);

    assert.ok(parsed);
    assert.strictEqual(parsed?.tool, 'searchtext');
    assert.strictEqual(parsed?.args.query, 'DiffManager');
  });

  test('ignores unrelated JSON and finds the first tool call', () => {
    const response = `Metrics: {"latency":123}
\`\`\`json
{"tool":"openfile","args":{"filePath":"src/chatPanel.ts"}}
\`\`\``;
    const parsed = parseAgentToolCall(response);

    assert.ok(parsed);
    assert.strictEqual(parsed?.tool, 'openfile');
    assert.strictEqual(parsed?.args.filePath, 'src/chatPanel.ts');
  });

  test('normalizes missing args to an empty object', () => {
    const response = `{"tool":"savefile"}`;
    const parsed = parseAgentToolCall(response);

    assert.ok(parsed);
    assert.strictEqual(parsed?.tool, 'savefile');
    assert.deepStrictEqual(parsed?.args, {});
  });

  test('returns null when response has no valid tool call JSON', () => {
    const response = `Thought: done\nFinal Answer: all good`;
    const parsed = parseAgentToolCall(response);

    assert.strictEqual(parsed, null);
  });
});
