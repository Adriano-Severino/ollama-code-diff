import * as assert from 'assert';
import { buildChatHtmlExport } from '../../utils/chatExport';

suite('ChatExport (unit)', () => {
  test('builds html document with title and messages', () => {
    const html = buildChatHtmlExport('Minha Sessão', [
      { role: 'user', content: 'Olá', timestamp: 1700000000000 },
      { role: 'assistant', content: '**Oi!** Como posso ajudar?', timestamp: 1700000001000 }
    ], new Date('2026-01-01T00:00:00Z'));

    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>Minha Sessão — Ollama Code Diff</title>'));
    assert.ok(html.includes('class="message user"'));
    assert.ok(html.includes('class="message assistant"'));
    assert.ok(html.includes('<strong>Oi!</strong>'));
    assert.ok(html.includes('2 mensagem(ns)'));
  });

  test('escapes html in title and renders roles labels', () => {
    const html = buildChatHtmlExport('<script>alert(1)</script>', [
      { role: 'user', content: 'oi' }
    ]);

    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('>Você<') || html.includes('Você ·'));
  });

  test('falls back to preformatted text when markdown parsing fails', () => {
    const html = buildChatHtmlExport('t', [{ role: 'assistant', content: 'plain' }]);
    assert.ok(html.includes('class="content"'));
  });

  test('handles empty message list', () => {
    const html = buildChatHtmlExport('vazio', []);
    assert.ok(html.includes('Nenhuma mensagem para exportar'));
  });
});
