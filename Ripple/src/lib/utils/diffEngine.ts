import { diffLines, diffChars } from 'diff';

export interface DiffSegment {
  text: string;
  type: 'added' | 'removed' | 'unchanged';
}

export interface DiffLineEntry {
  leftNum: number | null;
  rightNum: number | null;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  leftText: string;
  rightText: string;
  charDiffs?: DiffSegment[];
  charDiffsRight?: DiffSegment[];
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  totalLeft: number;
  totalRight: number;
}

export interface DiffResult {
  lines: DiffLineEntry[];
  stats: DiffStats;
}

export function computeCharDiffs(oldText: string, newText: string): { left: DiffSegment[]; right: DiffSegment[] } {
  const changes = diffChars(oldText, newText);
  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];

  for (const change of changes) {
    if (change.added) {
      right.push({ text: change.value, type: 'added' });
    } else if (change.removed) {
      left.push({ text: change.value, type: 'removed' });
    } else {
      left.push({ text: change.value, type: 'unchanged' });
      right.push({ text: change.value, type: 'unchanged' });
    }
  }

  return { left, right };
}

export interface DiffOptions {
  ignoreWhitespace?: boolean;
}

export function buildLineColorMap(result: DiffResult): { left: Map<number, string>; right: Map<number, string> } {
  const left = new Map<number, string>();
  const right = new Map<number, string>();
  for (const line of result.lines) {
    if (line.leftNum !== null) left.set(line.leftNum, line.type);
    if (line.rightNum !== null) right.set(line.rightNum, line.type);
  }
  return { left, right };
}

export function computeSideBySideDiff(textA: string, textB: string, options?: DiffOptions): DiffResult {
  const changes = diffLines(textA, textB, options?.ignoreWhitespace ? { ignoreWhitespace: true } : undefined);

  const lines: DiffLineEntry[] = [];
  let leftNum = 0;
  let rightNum = 0;

  const stats: DiffStats = { added: 0, removed: 0, modified: 0, unchanged: 0, totalLeft: 0, totalRight: 0 };

  let i = 0;
  while (i < changes.length) {
    const change = changes[i];

    if (!change.added && !change.removed) {
      const unchangedLines = splitKeepEmpty(change.value);
      for (const line of unchangedLines) {
        leftNum++;
        rightNum++;
        lines.push({ leftNum, rightNum, type: 'unchanged', leftText: line, rightText: line });
        stats.unchanged++;
      }
      i++;
    } else if (change.removed && i + 1 < changes.length && changes[i + 1].added) {
      const removedLines = splitKeepEmpty(change.value);
      const addedLines = splitKeepEmpty(changes[i + 1].value);
      const maxLen = Math.max(removedLines.length, addedLines.length);

      for (let j = 0; j < maxLen; j++) {
        const leftLine = j < removedLines.length ? removedLines[j] : null;
        const rightLine = j < addedLines.length ? addedLines[j] : null;

        if (leftLine !== null && rightLine !== null) {
          const { left: charLeft, right: charRight } = computeCharDiffs(leftLine, rightLine);
          if (leftLine !== null) leftNum++;
          if (rightLine !== null) rightNum++;
          lines.push({
            leftNum,
            rightNum,
            type: 'modified',
            leftText: leftLine,
            rightText: rightLine,
            charDiffs: charLeft,
            charDiffsRight: charRight,
          });
          stats.modified++;
        } else if (leftLine !== null) {
          leftNum++;
          lines.push({ leftNum, rightNum: null, type: 'removed', leftText: leftLine, rightText: '' });
          stats.removed++;
        } else if (rightLine !== null) {
          rightNum++;
          lines.push({ leftNum: null, rightNum, type: 'added', leftText: '', rightText: rightLine });
          stats.added++;
        }
      }
      i += 2;
    } else if (change.removed) {
      const removedLines = splitKeepEmpty(change.value);
      for (const line of removedLines) {
        leftNum++;
        lines.push({ leftNum, rightNum: null, type: 'removed', leftText: line, rightText: '' });
        stats.removed++;
      }
      i++;
    } else if (change.added) {
      const addedLines = splitKeepEmpty(change.value);
      for (const line of addedLines) {
        rightNum++;
        lines.push({ leftNum: null, rightNum, type: 'added', leftText: '', rightText: line });
        stats.added++;
      }
      i++;
    } else {
      i++;
    }
  }

  stats.totalLeft = leftNum;
  stats.totalRight = rightNum;

  return { lines, stats };
}

function splitKeepEmpty(value: string): string[] {
  if (!value) return [];
  const result = value.split('\n');
  if (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result;
}

export function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function detectLanguage(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<') && (trimmed.includes('</') || trimmed.includes('/>'))) {
    if (trimmed.toLowerCase().includes('<!doctype html') || trimmed.toLowerCase().includes('<html')) return 'html';
    return 'xml';
  }
  if (/^---\s*\n/.test(trimmed) || /^\w+:\s/.test(trimmed)) return 'yaml';
  return 'text';
}
