export type UnifiedDiffLineType = 'context' | 'add' | 'remove';

export interface UnifiedDiffLine {
  type: UnifiedDiffLineType;
  content: string;
}

export interface UnifiedDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: UnifiedDiffLine[];
}

export interface UnifiedDiffFile {
  oldPath: string;
  newPath: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  hunks: UnifiedDiffHunk[];
  newFileHasTrailingNewline?: boolean;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface ParsedDiffGitHeader {
  oldPath: string;
  newPath: string;
}

interface SplitTextResult {
  lines: string[];
  hasTrailingNewline: boolean;
  eol: '\n' | '\r\n';
}

export function sanitizeUnifiedDiff(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }

  const fencedMatch = trimmed.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

export function parseUnifiedDiff(diffContent: string): UnifiedDiffFile[] {
  const sanitized = sanitizeUnifiedDiff(diffContent);
  if (!sanitized) {
    throw new Error('Diff vazio.');
  }

  const normalized = sanitized.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const files: UnifiedDiffFile[] = [];

  let i = 0;
  while (i < lines.length) {
    let oldPath = '';
    let newPath = '';

    if (lines[i].startsWith('diff --git ')) {
      const parsedHeader = parseDiffGitHeader(lines[i]);
      oldPath = parsedHeader.oldPath;
      newPath = parsedHeader.newPath;
      i++;
    } else if (isFileHeaderLine(lines, i)) {
      oldPath = normalizeDiffPath(lines[i].slice(4));
      newPath = normalizeDiffPath(lines[i + 1].slice(4));
      i += 2;
    } else {
      i++;
      continue;
    }

    const file: UnifiedDiffFile = {
      oldPath,
      newPath,
      isNewFile: false,
      isDeletedFile: false,
      hunks: []
    };

    let lastLineType: UnifiedDiffLineType | null = null;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('diff --git ')) {
        break;
      }

      if (isFileHeaderLine(lines, i) && file.hunks.length > 0) {
        break;
      }

      if (line.startsWith('new file mode ')) {
        file.isNewFile = true;
        i++;
        continue;
      }

      if (line.startsWith('deleted file mode ')) {
        file.isDeletedFile = true;
        i++;
        continue;
      }

      if (line.startsWith('rename from ')) {
        file.oldPath = normalizeDiffPath(line.slice('rename from '.length));
        i++;
        continue;
      }

      if (line.startsWith('rename to ')) {
        file.newPath = normalizeDiffPath(line.slice('rename to '.length));
        i++;
        continue;
      }

      if (isFileHeaderLine(lines, i)) {
        file.oldPath = normalizeDiffPath(lines[i].slice(4));
        file.newPath = normalizeDiffPath(lines[i + 1].slice(4));

        if (file.oldPath === '/dev/null') {
          file.isNewFile = true;
        }
        if (file.newPath === '/dev/null') {
          file.isDeletedFile = true;
        }

        i += 2;
        continue;
      }

      const hunkHeader = line.match(HUNK_HEADER_RE);
      if (!hunkHeader) {
        i++;
        continue;
      }

      const hunk: UnifiedDiffHunk = {
        oldStart: Number.parseInt(hunkHeader[1], 10),
        oldLines: hunkHeader[2] ? Number.parseInt(hunkHeader[2], 10) : 1,
        newStart: Number.parseInt(hunkHeader[3], 10),
        newLines: hunkHeader[4] ? Number.parseInt(hunkHeader[4], 10) : 1,
        lines: []
      };

      i++;

      let consumedOld = 0;
      let consumedNew = 0;

      while (i < lines.length && (consumedOld < hunk.oldLines || consumedNew < hunk.newLines)) {
        const diffLine = lines[i];
        const marker = diffLine.charAt(0);

        if (diffLine === '\\ No newline at end of file') {
          if (lastLineType === 'add' || lastLineType === 'context') {
            file.newFileHasTrailingNewline = false;
          }
          i++;
          continue;
        }

        if (marker !== ' ' && marker !== '+' && marker !== '-') {
          throw new Error(`Linha de hunk inválida em ${file.newPath || file.oldPath}: ${diffLine}`);
        }

        const content = diffLine.slice(1);

        if (marker === ' ') {
          hunk.lines.push({ type: 'context', content });
          consumedOld++;
          consumedNew++;
          lastLineType = 'context';
        } else if (marker === '+') {
          hunk.lines.push({ type: 'add', content });
          consumedNew++;
          lastLineType = 'add';
        } else {
          hunk.lines.push({ type: 'remove', content });
          consumedOld++;
          lastLineType = 'remove';
        }

        i++;
      }

      while (i < lines.length && lines[i] === '\\ No newline at end of file') {
        if (lastLineType === 'add' || lastLineType === 'context') {
          file.newFileHasTrailingNewline = false;
        }
        i++;
      }

      if (consumedOld !== hunk.oldLines || consumedNew !== hunk.newLines) {
        throw new Error(
          `Hunk incompleto em ${file.newPath || file.oldPath}. Esperado -${hunk.oldLines}/+${hunk.newLines}, ` +
          `recebido -${consumedOld}/+${consumedNew}.`
        );
      }

      file.hunks.push(hunk);
    }

    if (!file.oldPath && !file.newPath) {
      throw new Error('Não foi possível identificar o caminho de arquivo do patch.');
    }

    if (file.oldPath === '/dev/null') {
      file.isNewFile = true;
    }
    if (file.newPath === '/dev/null') {
      file.isDeletedFile = true;
    }

    files.push(file);
  }

  if (files.length === 0) {
    throw new Error('Nenhum arquivo encontrado no diff.');
  }

  return files;
}

export function applyUnifiedDiffToContent(originalContent: string, filePatch: UnifiedDiffFile): string {
  const source = splitTextForPatch(originalContent);
  const result: string[] = [];

  let sourceIndex = 0;
  let lineOffset = 0;

  for (const hunk of filePatch.hunks) {
    const expectedSourceIndex = Math.max(0, hunk.oldStart - 1 + lineOffset);

    if (expectedSourceIndex < sourceIndex || expectedSourceIndex > source.lines.length) {
      throw new Error(`Hunk inválido para ${filePatch.newPath || filePatch.oldPath}: posição fora do arquivo.`);
    }

    while (sourceIndex < expectedSourceIndex) {
      result.push(source.lines[sourceIndex]);
      sourceIndex++;
    }

    for (const line of hunk.lines) {
      if (line.type === 'add') {
        result.push(line.content);
        continue;
      }

      if (sourceIndex >= source.lines.length) {
        throw new Error(`Patch não corresponde ao conteúdo atual de ${filePatch.newPath || filePatch.oldPath}.`);
      }

      const currentLine = source.lines[sourceIndex];

      if (currentLine !== line.content) {
        throw new Error(
          `Conflito ao aplicar patch em ${filePatch.newPath || filePatch.oldPath}. ` +
          `Esperado "${line.content}" mas encontrado "${currentLine}".`
        );
      }

      if (line.type === 'context') {
        result.push(currentLine);
      }

      sourceIndex++;
    }

    lineOffset += hunk.newLines - hunk.oldLines;
  }

  while (sourceIndex < source.lines.length) {
    result.push(source.lines[sourceIndex]);
    sourceIndex++;
  }

  let hasTrailingNewline = source.hasTrailingNewline;
  if (filePatch.isNewFile && result.length > 0) {
    hasTrailingNewline = true;
  }
  if (filePatch.newFileHasTrailingNewline === false) {
    hasTrailingNewline = false;
  }

  return joinLinesWithStyle(result, hasTrailingNewline, source.eol);
}

function parseDiffGitHeader(line: string): ParsedDiffGitHeader {
  const rawHeader = line.replace(/^diff --git\s+/, '');
  const tokens = rawHeader.match(/"[^"]+"|\S+/g);

  if (!tokens || tokens.length < 2) {
    throw new Error(`Cabeçalho diff inválido: ${line}`);
  }

  return {
    oldPath: normalizeDiffPath(tokens[0]),
    newPath: normalizeDiffPath(tokens[1])
  };
}

function isFileHeaderLine(lines: string[], index: number): boolean {
  return index + 1 < lines.length && lines[index].startsWith('--- ') && lines[index + 1].startsWith('+++ ');
}

function normalizeDiffPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === '/dev/null') {
    return trimmed;
  }

  let normalized = trimmed;

  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }

  if (normalized.startsWith('a/')) {
    normalized = normalized.slice(2);
  } else if (normalized.startsWith('b/')) {
    normalized = normalized.slice(2);
  }

  return normalized.replace(/\\/g, '/');
}

function splitTextForPatch(content: string): SplitTextResult {
  const eol: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n/g, '\n');

  const hasTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.length === 0 ? [] : normalized.split('\n');

  if (hasTrailingNewline && lines.length > 0) {
    lines.pop();
  }

  return {
    lines,
    hasTrailingNewline,
    eol
  };
}

function joinLinesWithStyle(lines: string[], hasTrailingNewline: boolean, eol: '\n' | '\r\n'): string {
  let normalized = lines.join('\n');

  if (hasTrailingNewline) {
    normalized += '\n';
  }

  if (eol === '\r\n') {
    return normalized.replace(/\n/g, '\r\n');
  }

  return normalized;
}
