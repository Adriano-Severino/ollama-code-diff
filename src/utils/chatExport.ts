import { marked } from 'marked';

export interface ExportableMessage {
  role: string;
  content: string;
  timestamp?: number;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(content: string): string {
  try {
    return marked.parse(content, { async: false }) as string;
  } catch {
    return `<pre>${escapeHtml(content)}</pre>`;
  }
}

function formatTimestamp(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

const ROLE_LABELS: Record<string, string> = {
  user: 'Você',
  assistant: 'Ollama',
  system: 'Sistema'
};

export function buildChatHtmlExport(
  title: string,
  messages: ExportableMessage[],
  generatedAt: Date = new Date()
): string {
  const safeTitle = escapeHtml(title || 'Chat Ollama');
  const exportedAt = generatedAt.toLocaleString();

  const body = messages.map((msg) => {
    const role = ROLE_LABELS[msg.role] ?? msg.role;
    const ts = formatTimestamp(msg.timestamp);
    const meta = ts ? `<div class="meta">${escapeHtml(role)} · ${escapeHtml(ts)}</div>` : `<div class="meta">${escapeHtml(role)}</div>`;
    return `<section class="message ${escapeHtml(msg.role)}">${meta}<div class="content">${renderMarkdown(msg.content)}</div></section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle} — Ollama Code Diff</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; line-height: 1.6; }
  header { border-bottom: 2px solid #8884; padding-bottom: 12px; margin-bottom: 24px; }
  h1 { margin: 0 0 4px; font-size: 1.4rem; }
  .subtitle { color: #888; font-size: 0.85rem; }
  .message { border: 1px solid #8883; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .message.user { border-left: 4px solid #4a9eff; }
  .message.assistant { border-left: 4px solid #7c5cff; }
  .message.system { border-left: 4px solid #999; }
  .meta { font-size: 0.75rem; color: #888; margin-bottom: 6px; }
  .content pre { background: #8881; padding: 12px; border-radius: 6px; overflow-x: auto; }
  .content code { background: #8881; padding: 1px 4px; border-radius: 4px; }
  .content pre code { background: none; padding: 0; }
  @media print { .message { break-inside: avoid; } body { max-width: none; } }
</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <div class="subtitle">Exportado do Ollama Code Diff em ${escapeHtml(exportedAt)} · ${messages.length} mensagem(ns)</div>
</header>
${body || '<p><em>Nenhuma mensagem para exportar.</em></p>'}
</body>
</html>`;
}
