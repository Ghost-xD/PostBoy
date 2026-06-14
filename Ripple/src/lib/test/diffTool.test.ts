import { describe, it, expect } from 'vitest';
import {
  computeSideBySideDiff,
  computeCharDiffs,
  tryFormatJson,
  detectLanguage,
  buildLineColorMap,
  type DiffResult,
} from '$lib/utils/diffEngine';

describe('Diff Engine — computeSideBySideDiff', () => {
  it('returns empty result for two empty strings', () => {
    const result = computeSideBySideDiff('', '');
    expect(result.lines).toHaveLength(0);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.unchanged).toBe(0);
  });

  it('detects identical content', () => {
    const text = 'line one\nline two\nline three\n';
    const result = computeSideBySideDiff(text, text);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.unchanged).toBe(3);
    for (const line of result.lines) {
      expect(line.type).toBe('unchanged');
      expect(line.leftNum).not.toBeNull();
      expect(line.rightNum).not.toBeNull();
    }
  });

  it('detects added lines', () => {
    const a = 'line one\nline two\n';
    const b = 'line one\nline two\nline three\n';
    const result = computeSideBySideDiff(a, b);
    expect(result.stats.added).toBeGreaterThanOrEqual(1);
    const addedLines = result.lines.filter(l => l.type === 'added');
    expect(addedLines.length).toBeGreaterThanOrEqual(1);
    expect(addedLines.some(l => l.rightText === 'line three')).toBe(true);
  });

  it('detects removed lines', () => {
    const a = 'line one\nline two\nline three\n';
    const b = 'line one\nline three\n';
    const result = computeSideBySideDiff(a, b);
    expect(result.stats.removed + result.stats.modified).toBeGreaterThanOrEqual(1);
    const removedOrModified = result.lines.filter(l => l.type === 'removed' || l.type === 'modified');
    expect(removedOrModified.length).toBeGreaterThanOrEqual(1);
  });

  it('detects modified lines with character-level diffs', () => {
    const a = 'hello world\n';
    const b = 'hello there\n';
    const result = computeSideBySideDiff(a, b);
    const modifiedLines = result.lines.filter(l => l.type === 'modified');
    expect(modifiedLines.length).toBeGreaterThanOrEqual(1);
    const mod = modifiedLines[0];
    expect(mod.charDiffs).toBeDefined();
    expect(mod.charDiffsRight).toBeDefined();
    expect(mod.charDiffs!.length).toBeGreaterThan(0);
    expect(mod.charDiffsRight!.length).toBeGreaterThan(0);
  });

  it('tracks line numbers correctly for mixed changes', () => {
    const a = 'aaa\nbbb\nccc\n';
    const b = 'aaa\nBBB\nccc\nddd\n';
    const result = computeSideBySideDiff(a, b);
    expect(result.stats.totalLeft).toBe(3);
    expect(result.stats.totalRight).toBe(4);
  });

  it('handles first line being empty', () => {
    const a = '';
    const b = 'new content\n';
    const result = computeSideBySideDiff(a, b);
    expect(result.stats.added).toBeGreaterThanOrEqual(1);
    expect(result.stats.removed).toBe(0);
  });

  it('handles second line being empty', () => {
    const a = 'old content\n';
    const b = '';
    const result = computeSideBySideDiff(a, b);
    expect(result.stats.removed).toBeGreaterThanOrEqual(1);
    expect(result.stats.added).toBe(0);
  });

  it('handles multi-line additions and removals', () => {
    const a = 'A\nB\nC\nD\nE\n';
    const b = 'A\nX\nY\nD\nE\nF\n';
    const result = computeSideBySideDiff(a, b);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.stats.totalLeft).toBe(5);
    expect(result.stats.totalRight).toBe(6);
  });
});

describe('Diff Engine — computeCharDiffs', () => {
  it('returns unchanged segments for identical strings', () => {
    const { left, right } = computeCharDiffs('hello', 'hello');
    expect(left).toHaveLength(1);
    expect(left[0]).toEqual({ text: 'hello', type: 'unchanged' });
    expect(right).toHaveLength(1);
    expect(right[0]).toEqual({ text: 'hello', type: 'unchanged' });
  });

  it('detects character-level additions', () => {
    const { left, right } = computeCharDiffs('abc', 'abXc');
    const addedInRight = right.filter(s => s.type === 'added');
    expect(addedInRight.length).toBeGreaterThan(0);
    expect(addedInRight.some(s => s.text.includes('X'))).toBe(true);
  });

  it('detects character-level removals', () => {
    const { left, right } = computeCharDiffs('abcd', 'acd');
    const removedInLeft = left.filter(s => s.type === 'removed');
    expect(removedInLeft.length).toBeGreaterThan(0);
    expect(removedInLeft.some(s => s.text.includes('b'))).toBe(true);
  });

  it('handles complete replacement', () => {
    const { left, right } = computeCharDiffs('foo', 'bar');
    expect(left.some(s => s.type === 'removed')).toBe(true);
    expect(right.some(s => s.type === 'added')).toBe(true);
  });

  it('handles empty to non-empty', () => {
    const { left, right } = computeCharDiffs('', 'hello');
    expect(left).toHaveLength(0);
    expect(right).toHaveLength(1);
    expect(right[0]).toEqual({ text: 'hello', type: 'added' });
  });
});

describe('Diff Engine — tryFormatJson', () => {
  it('formats valid JSON', () => {
    const result = tryFormatJson('{"a":1,"b":2}');
    expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('returns original text for invalid JSON', () => {
    const text = 'not json at all';
    expect(tryFormatJson(text)).toBe(text);
  });

  it('formats JSON arrays', () => {
    const result = tryFormatJson('[1,2,3]');
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });
});

describe('Diff Engine — detectLanguage', () => {
  it('detects JSON objects', () => {
    expect(detectLanguage('{"key": "value"}')).toBe('json');
  });

  it('detects JSON arrays', () => {
    expect(detectLanguage('[1, 2, 3]')).toBe('json');
  });

  it('detects HTML', () => {
    expect(detectLanguage('<!DOCTYPE html><html><body></body></html>')).toBe('html');
  });

  it('detects XML', () => {
    expect(detectLanguage('<root><child>value</child></root>')).toBe('xml');
  });

  it('detects YAML', () => {
    expect(detectLanguage('---\nkey: value\n')).toBe('yaml');
    expect(detectLanguage('name: test\nversion: 1\n')).toBe('yaml');
  });

  it('defaults to text', () => {
    expect(detectLanguage('hello world')).toBe('text');
    expect(detectLanguage('some random text')).toBe('text');
  });
});

describe('Diff Engine — ignoreWhitespace option', () => {
  it('treats lines differing only in leading/trailing whitespace as unchanged when enabled', () => {
    const result = computeSideBySideDiff('  hello world\n', 'hello world\n', { ignoreWhitespace: true });
    expect(result.stats.modified).toBe(0);
    expect(result.stats.unchanged).toBeGreaterThan(0);
  });

  it('detects leading/trailing whitespace differences when disabled', () => {
    const result = computeSideBySideDiff('  hello world\n', 'hello world\n');
    expect(result.stats.modified + result.stats.added + result.stats.removed).toBeGreaterThan(0);
  });
});

describe('Diff Engine — buildLineColorMap', () => {
  it('maps line numbers to their diff types', () => {
    const result = computeSideBySideDiff('aaa\nbbb\nccc\n', 'aaa\nBBB\nccc\n');
    const colorMap = buildLineColorMap(result);
    expect(colorMap.left.get(1)).toBe('unchanged');
    expect(colorMap.left.get(2)).toBe('modified');
    expect(colorMap.left.get(3)).toBe('unchanged');
    expect(colorMap.right.get(2)).toBe('modified');
  });

  it('handles added lines (only in right)', () => {
    const result = computeSideBySideDiff('aaa\n', 'aaa\nbbb\n');
    const colorMap = buildLineColorMap(result);
    expect(colorMap.left.get(1)).toBe('unchanged');
    expect(colorMap.right.get(1)).toBe('unchanged');
    expect(colorMap.right.get(2)).toBe('added');
    expect(colorMap.left.has(2)).toBe(false);
  });

  it('handles removed lines (only in left)', () => {
    const result = computeSideBySideDiff('aaa\nbbb\n', 'aaa\n');
    const colorMap = buildLineColorMap(result);
    expect(colorMap.left.get(2)).toBe('removed');
    expect(colorMap.right.has(2)).toBe(false);
  });
});
