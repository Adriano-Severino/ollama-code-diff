import * as assert from 'assert';
import { buildFimPrompt, cleanInlineCompletion } from '../../utils/fimPrompt';

suite('InlineCompletionProvider (unit)', () => {
  test('buildFimPrompt produces Qwen 2.5 Coder FIM format', () => {
    const prompt = buildFimPrompt('const a = 1;\n', '\nconsole.log(a);', 'qwen2.5-coder:7b');
    assert.strictEqual(
      prompt,
      '<|fim_prefix|>const a = 1;\n<|fim_suffix|>\nconsole.log(a);<|fim_middle|>'
    );
  });

  test('buildFimPrompt produces DeepSeek Coder FIM format', () => {
    const prompt = buildFimPrompt('def hello():\n    ', '\n    return True', 'deepseek-coder:6.7b');
    assert.strictEqual(
      prompt,
      '<｜fim begin｜>def hello():\n    <｜fim hole｜>\n    return True<｜fim end｜>'
    );
  });

  test('buildFimPrompt produces CodeLlama FIM format', () => {
    const prompt = buildFimPrompt('function add(a, b) {', '}', 'codellama:7b-code');
    assert.strictEqual(
      prompt,
      '<PRE> function add(a, b) { <SUF>} <MID>'
    );
  });

  test('buildFimPrompt produces StarCoder FIM format', () => {
    const prompt = buildFimPrompt('class Server {', '}', 'starcoder2:3b');
    assert.strictEqual(
      prompt,
      '<fim_prefix>class Server {<fim_suffix>}<fim_middle>'
    );
  });

  test('cleanInlineCompletion removes FIM control tokens', () => {
    const raw = 'return a + b;<|file_sep|><|fim_suffix|>';
    const cleaned = cleanInlineCompletion(raw);
    assert.strictEqual(cleaned, 'return a + b;');
  });

  test('cleanInlineCompletion strips markdown code block fences', () => {
    const raw = '```typescript\nconst x = 10;\n```';
    const cleaned = cleanInlineCompletion(raw);
    assert.strictEqual(cleaned, 'const x = 10;');
  });

  test('cleanInlineCompletion removes leading newlines', () => {
    const raw = '\n\n\nconst z = 42;';
    const cleaned = cleanInlineCompletion(raw);
    assert.strictEqual(cleaned, 'const z = 42;');
  });
});
