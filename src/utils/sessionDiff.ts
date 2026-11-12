import { diffLines, type Change } from 'diff';
import type { UnifiedDiffLine } from './unifiedDiff';

export interface DiffableSession {
  title?: string;
  messages?: Array<{ role: string; content: string; timestamp?: number }>;
}

export interface SessionDiffResult {
  lines: UnifiedDiffLine[];
  added: number;
  removed: number;
}

const ROLE_LABELS: Record<string, string> = {
  user: 'user',
  assistant: 'assistant',
  system: 'system'
};

export function sessionToDiffText(session: DiffableSession): string {
  const messages = session.messages || [];
  if (messages.length === 0) {
    return '';
  }

  return messages
    .map(m => {
      const role = ROLE_LABELS[m.role] || m.role || 'unknown';
      const header = `## [${role}]`;
      const content = (m.content || '').replace(/\s+$/, '');
      return content ? `${header}\n${content}` : header;
    })
    .join('\n\n');
}

export function buildSessionDiff(a: DiffableSession, b: DiffableSession): SessionDiffResult {
  const normalize = (s: string) => (s && !s.endsWith('\n') ? s + '\n' : s);
  const textA = normalize(sessionToDiffText(a));
  const textB = normalize(sessionToDiffText(b));

  const changes: Change[] = diffLines(textA, textB);
  const lines: UnifiedDiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const change of changes) {
    if (!change.value) continue;
    const type: UnifiedDiffLine['type'] = change.added ? 'add' : change.removed ? 'remove' : 'context';
    const content = change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value;
    for (const line of content.split('\n')) {
      lines.push({ type, content: line });
      if (type === 'add') added++;
      else if (type === 'remove') removed++;
    }
  }

  return { lines, added, removed };
}
