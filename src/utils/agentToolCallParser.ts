export type AgentToolCall = {
  tool: string;
  args: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

export function parseAgentToolCall(response: string): AgentToolCall | null {
  if (!response || !response.trim()) {
    return null;
  }

  const candidates = collectJsonCandidates(response);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeToolCall(parsed);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Ignore invalid JSON snippets and keep searching.
    }
  }

  return null;
}

function normalizeToolCall(value: unknown): AgentToolCall | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const tool = record.tool;
  if (typeof tool !== 'string' || !tool.trim()) {
    return null;
  }

  const args = asRecord(record.args) ?? {};
  return {
    tool: tool.trim().toLowerCase(),
    args
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as UnknownRecord;
}

function collectJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fencedMatch: RegExpExecArray | null;
  while ((fencedMatch = fencedRegex.exec(text)) !== null) {
    addCandidate(fencedMatch[1]);
  }

  for (const objectCandidate of extractBalancedJsonObjects(text)) {
    addCandidate(objectCandidate);
  }

  return candidates;
}

function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        startIndex = index;
      }
      depth++;
      continue;
    }

    if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && startIndex >= 0) {
        objects.push(text.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return objects;
}
