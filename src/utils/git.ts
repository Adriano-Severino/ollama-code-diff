import { execFile } from 'child_process';

export const GIT_MAX_BUFFER = 10 * 1024 * 1024;
export const GIT_OUTPUT_LIMIT = 150_000;

export function truncateGitText(text: string, maxChars = GIT_OUTPUT_LIMIT): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[saida truncada: ${text.length - maxChars} caracteres omitidos]`;
}

export function sanitizeGitRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return 'HEAD';
  if (!/^[a-zA-Z0-9_./~^@{}-]+$/.test(trimmed)) {
    throw new Error(`Ref invalida: ${ref}`);
  }
  return trimmed;
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: GIT_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || '').trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function getCommitShow(cwd: string, ref = 'HEAD'): Promise<string> {
  const safeRef = sanitizeGitRef(ref);
  const output = await runGit(
    ['show', '--stat', '--patch', '--find-renames', '--format=fuller', safeRef],
    cwd
  );
  return truncateGitText(output);
}

export async function getRecentCommitsLog(cwd: string, count = 10): Promise<string> {
  const safeCount = Math.min(Math.max(1, Math.floor(count) || 10), 50);
  const output = await runGit(
    [
      'log',
      '-n', `${safeCount}`,
      '--date=short',
      '--stat',
      '--pretty=format:commit %h %ad %an%n%s%n%b'
    ],
    cwd
  );
  return truncateGitText(output);
}

export function buildCommitAnalysisPrompt(commitText: string, instruction: string, scope: string): string {
  return `Você é um revisor de código sênior analisando histórico Git.

Analise o seguinte ${scope} e responda à instrução do usuário de forma clara e objetiva, em Markdown.

--- ${scope.toUpperCase()} ---
${commitText}
--- FIM ${scope.toUpperCase()} ---

INSTRUÇÃO DO USUÁRIO:
${instruction}
`;
}
