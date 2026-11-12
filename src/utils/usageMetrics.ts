export interface OllamaUsageStats {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalDurationNs?: number;
  evalDurationNs?: number;
}

export interface RequestUsage {
  model: string;
  mode?: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  tokensPerSecond: number;
}

export interface UsageSummary {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalDurationMs: number;
  byModel: Record<string, { requests: number; completionTokens: number; durationMs: number }>;
  byMode: Record<string, { requests: number; promptTokens: number; completionTokens: number; durationMs: number }>;
}

export function toRequestUsage(stats: OllamaUsageStats, mode?: string): RequestUsage {
  const completionTokens = Math.max(0, stats.completionTokens ?? 0);
  const evalSeconds = typeof stats.evalDurationNs === 'number' && stats.evalDurationNs > 0
    ? stats.evalDurationNs / 1e9
    : 0;

  return {
    model: stats.model || 'unknown',
    mode: mode || undefined,
    promptTokens: Math.max(0, stats.promptTokens ?? 0),
    completionTokens,
    durationMs: typeof stats.totalDurationNs === 'number' ? stats.totalDurationNs / 1e6 : 0,
    tokensPerSecond: evalSeconds > 0 ? completionTokens / evalSeconds : 0
  };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count < 1000) return String(Math.round(count));
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

export function formatRequestUsage(usage: RequestUsage): string {
  const parts = [
    usage.model,
    `prompt ${formatTokens(usage.promptTokens)} tok`,
    `completion ${formatTokens(usage.completionTokens)} tok`,
    formatDuration(usage.durationMs)
  ];
  if (usage.tokensPerSecond > 0) {
    parts.push(`${usage.tokensPerSecond.toFixed(1)} tok/s`);
  }
  return parts.join(' · ');
}

export class UsageTracker {
  private requests: RequestUsage[] = [];
  public onDidRecord?: (usage: RequestUsage) => void;

  public record(usage: RequestUsage): void {
    this.requests.push(usage);
    try {
      this.onDidRecord?.(usage);
    } catch {
      // ignore
    }
  }

  public getRequests(): readonly RequestUsage[] {
    return this.requests;
  }

  public getSummary(): UsageSummary {
    const summary: UsageSummary = {
      totalRequests: this.requests.length,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalDurationMs: 0,
      byModel: {},
      byMode: {}
    };

    for (const req of this.requests) {
      summary.totalPromptTokens += req.promptTokens;
      summary.totalCompletionTokens += req.completionTokens;
      summary.totalDurationMs += req.durationMs;

      const entry = summary.byModel[req.model] ?? { requests: 0, completionTokens: 0, durationMs: 0 };
      entry.requests += 1;
      entry.completionTokens += req.completionTokens;
      entry.durationMs += req.durationMs;
      summary.byModel[req.model] = entry;

      const mode = req.mode || 'outros';
      const modeEntry = summary.byMode[mode] ?? { requests: 0, promptTokens: 0, completionTokens: 0, durationMs: 0 };
      modeEntry.requests += 1;
      modeEntry.promptTokens += req.promptTokens;
      modeEntry.completionTokens += req.completionTokens;
      modeEntry.durationMs += req.durationMs;
      summary.byMode[mode] = modeEntry;
    }

    return summary;
  }

  public formatSummary(): string {
    const s = this.getSummary();
    if (s.totalRequests === 0) {
      return 'Nenhuma requisicao registrada ainda nesta sessao.';
    }

    const lines = [
      '# Uso do Ollama',
      '',
      `- Requisicoes: ${s.totalRequests}`,
      `- Tokens de prompt: ${formatTokens(s.totalPromptTokens)}`,
      `- Tokens gerados: ${formatTokens(s.totalCompletionTokens)}`,
      `- Tempo total: ${formatDuration(s.totalDurationMs)}`,
      '',
      '## Por modelo'
    ];

    for (const [model, entry] of Object.entries(s.byModel)) {
      lines.push(`- ${model}: ${entry.requests} req, ${formatTokens(entry.completionTokens)} tok gerados, ${formatDuration(entry.durationMs)}`);
    }

    lines.push('', '## Por modo');
    for (const [mode, entry] of Object.entries(s.byMode)) {
      lines.push(`- ${mode}: ${entry.requests} req, ${formatTokens(entry.promptTokens)} tok prompt, ${formatTokens(entry.completionTokens)} tok gerados, ${formatDuration(entry.durationMs)}`);
    }

    return lines.join('\n');
  }

  public reset(): void {
    this.requests = [];
  }
}
