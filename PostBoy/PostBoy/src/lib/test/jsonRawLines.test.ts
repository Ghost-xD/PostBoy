import { describe, expect, it } from 'vitest';
import { buildFieldModeDocument, buildJsonRawLines, formatJsonForRawView } from '$lib/utils/jsonRawLines';

describe('jsonRawLines', () => {
  it('formats JSON with indentation', () => {
    expect(formatJsonForRawView('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('extracts copy values from leaf string fields', () => {
    const formatted = formatJsonForRawView(JSON.stringify({
      externalId: '29777350-dda7-410b-9723-5b700e063d9a-' + 'x'.repeat(100),
      count: 42,
      active: true,
    }));
    const lines = buildJsonRawLines(formatted);
    const externalId = lines.find((line) => line.key === 'externalId');
    expect(externalId?.copyValue).toContain('29777350-dda7-410b-9723-5b700e063d9a');
    expect(externalId?.valueDisplay).toContain('...');
  });

  it('maps copy values for long JWT token lines without title metadata', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIs' + 'a'.repeat(2000);
    const body = JSON.stringify({ idToken: jwt, accessToken: jwt + 'b', refreshToken: 'short' });
    const { text, copiesByLine } = buildFieldModeDocument(body);
    const idLine = text.split('\n').findIndex((l) => l.includes('"idToken"')) + 1;
    const accessLine = text.split('\n').findIndex((l) => l.includes('"accessToken"')) + 1;
    expect(text).toContain('"idToken":');
    expect(text).toContain('"accessToken":');
    expect(copiesByLine.get(idLine)).toBe(jwt);
    expect(copiesByLine.get(accessLine)).toBe(jwt + 'b');
  });

  it('does not add copy values for structural lines', () => {
    const formatted = formatJsonForRawView(JSON.stringify({ nested: { a: 1 } }));
    const lines = buildJsonRawLines(formatted);
    expect(lines.find((line) => line.text.trim() === '{')?.copyValue).toBeUndefined();
    expect(lines.find((line) => line.key === 'nested')?.copyValue).toBeUndefined();
  });

  it('masks sensitive JSON keys in field mode document text', () => {
    const body = JSON.stringify({
      username: 'gaurav.saroha',
      password: 'New#Island@2025',
    });
    const { text, copiesByLine } = buildFieldModeDocument(body);
    expect(text).not.toContain('New#Island@2025');
    expect(text).toMatch(/"password": "•+/);
    const passwordLine = text.split('\n').findIndex((line) => line.includes('"password"')) + 1;
    expect(copiesByLine.get(passwordLine)).toBe('New#Island@2025');
  });
});
