import * as assert from 'assert';
import { buildSessionDiff, sessionToDiffText } from '../../utils/sessionDiff';

suite('SessionDiff (unit)', () => {
  test('sessionToDiffText renders role headers and content', () => {
    const text = sessionToDiffText({
      messages: [
        { role: 'user', content: 'Olá' },
        { role: 'assistant', content: 'Oi!' }
      ]
    });

    assert.ok(text.includes('## [user]\nOlá'));
    assert.ok(text.includes('## [assistant]\nOi!'));
  });

  test('buildSessionDiff detects added lines', () => {
    const a = { messages: [{ role: 'user', content: 'pergunta' }] };
    const b = { messages: [
      { role: 'user', content: 'pergunta' },
      { role: 'assistant', content: 'resposta nova' }
    ] };

    const { lines, added, removed } = buildSessionDiff(a, b);
    assert.ok(added > 0);
    assert.strictEqual(removed, 0);
    assert.ok(lines.some(l => l.type === 'add' && l.content.includes('resposta nova')));
    assert.ok(lines.some(l => l.type === 'context' && l.content.includes('pergunta')));
  });

  test('buildSessionDiff detects removed lines', () => {
    const a = { messages: [
      { role: 'user', content: 'pergunta' },
      { role: 'assistant', content: 'resposta antiga' }
    ] };
    const b = { messages: [{ role: 'user', content: 'pergunta' }] };

    const { lines, added, removed } = buildSessionDiff(a, b);
    assert.strictEqual(added, 0);
    assert.ok(removed > 0);
    assert.ok(lines.some(l => l.type === 'remove' && l.content.includes('resposta antiga')));
  });

  test('identical sessions produce only context lines', () => {
    const session = { messages: [{ role: 'user', content: 'igual' }] };
    const { added, removed, lines } = buildSessionDiff(session, session);
    assert.strictEqual(added, 0);
    assert.strictEqual(removed, 0);
    assert.ok(lines.every(l => l.type === 'context'));
  });

  test('empty sessions produce empty diff', () => {
    const { lines, added, removed } = buildSessionDiff({}, {});
    assert.strictEqual(lines.length, 0);
    assert.strictEqual(added, 0);
    assert.strictEqual(removed, 0);
  });
});
