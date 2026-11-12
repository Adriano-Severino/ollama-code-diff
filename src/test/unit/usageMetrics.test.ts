import * as assert from 'assert';
import {
  UsageTracker,
  formatDuration,
  formatRequestUsage,
  formatTokens,
  toRequestUsage
} from '../../utils/usageMetrics';

suite('UsageMetrics (unit)', () => {
  test('toRequestUsage converts nanoseconds and computes tokens/s', () => {
    const usage = toRequestUsage({
      model: 'qwen2.5-coder:7b',
      promptTokens: 1200,
      completionTokens: 300,
      totalDurationNs: 2_500_000_000,
      evalDurationNs: 1_500_000_000
    });

    assert.strictEqual(usage.model, 'qwen2.5-coder:7b');
    assert.strictEqual(usage.promptTokens, 1200);
    assert.strictEqual(usage.completionTokens, 300);
    assert.strictEqual(usage.durationMs, 2500);
    assert.strictEqual(usage.tokensPerSecond, 200);
  });

  test('toRequestUsage handles missing stats', () => {
    const usage = toRequestUsage({ model: '' });

    assert.strictEqual(usage.model, 'unknown');
    assert.strictEqual(usage.promptTokens, 0);
    assert.strictEqual(usage.completionTokens, 0);
    assert.strictEqual(usage.durationMs, 0);
    assert.strictEqual(usage.tokensPerSecond, 0);
  });

  test('formatDuration formats ms and seconds', () => {
    assert.strictEqual(formatDuration(250), '250ms');
    assert.strictEqual(formatDuration(1500), '1.5s');
    assert.strictEqual(formatDuration(-5), '0ms');
  });

  test('formatTokens compacts large numbers', () => {
    assert.strictEqual(formatTokens(999), '999');
    assert.strictEqual(formatTokens(1500), '1.5k');
    assert.strictEqual(formatTokens(25000), '25k');
  });

  test('formatRequestUsage includes model, tokens, duration and speed', () => {
    const text = formatRequestUsage({
      model: 'codellama:7b',
      promptTokens: 500,
      completionTokens: 200,
      durationMs: 2000,
      tokensPerSecond: 100
    });

    assert.ok(text.includes('codellama:7b'));
    assert.ok(text.includes('200 tok'));
    assert.ok(text.includes('2.0s'));
    assert.ok(text.includes('100.0 tok/s'));
  });

  test('UsageTracker aggregates summary per model', () => {
    const tracker = new UsageTracker();
    tracker.record({ model: 'a', promptTokens: 100, completionTokens: 50, durationMs: 1000, tokensPerSecond: 50 });
    tracker.record({ model: 'a', promptTokens: 200, completionTokens: 100, durationMs: 2000, tokensPerSecond: 50 });
    tracker.record({ model: 'b', promptTokens: 10, completionTokens: 5, durationMs: 500, tokensPerSecond: 10 });

    const summary = tracker.formatSummary();
    assert.ok(summary.includes('Requisicoes: 3'));
    assert.ok(summary.includes('Tokens gerados: 155'));
    assert.ok(summary.includes('a: 2 req'));
    assert.ok(summary.includes('b: 1 req'));
    assert.ok(summary.includes('## Por modo'));
    assert.ok(summary.includes('- outros: 3 req'));
  });

  test('UsageTracker aggregates summary per mode', () => {
    const tracker = new UsageTracker();
    tracker.record({ model: 'a', mode: 'chat', promptTokens: 100, completionTokens: 50, durationMs: 1000, tokensPerSecond: 50 });
    tracker.record({ model: 'a', mode: 'chat', promptTokens: 200, completionTokens: 100, durationMs: 2000, tokensPerSecond: 50 });
    tracker.record({ model: 'a', mode: 'agent', promptTokens: 500, completionTokens: 300, durationMs: 5000, tokensPerSecond: 60 });

    const summary = tracker.getSummary();
    assert.strictEqual(summary.byMode['chat'].requests, 2);
    assert.strictEqual(summary.byMode['chat'].completionTokens, 150);
    assert.strictEqual(summary.byMode['agent'].requests, 1);
    assert.strictEqual(summary.byMode['agent'].promptTokens, 500);

    const text = tracker.formatSummary();
    assert.ok(text.includes('- chat: 2 req'));
    assert.ok(text.includes('- agent: 1 req'));
  });

  test('toRequestUsage accepts optional mode', () => {
    const usage = toRequestUsage({ model: 'm', completionTokens: 10 }, 'plan');
    assert.strictEqual(usage.mode, 'plan');
    const noMode = toRequestUsage({ model: 'm' });
    assert.strictEqual(noMode.mode, undefined);
  });

  test('UsageTracker notifies onDidRecord listeners', () => {
    const tracker = new UsageTracker();
    let received: any = null;
    tracker.onDidRecord = (u) => { received = u; };

    const usage = { model: 'm', promptTokens: 1, completionTokens: 2, durationMs: 3, tokensPerSecond: 0 };
    tracker.record(usage);
    assert.strictEqual(received, usage);
  });
});
