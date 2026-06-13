import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { ThemeMode } from '$lib/utils/theme';

const BG = 'var(--bg-primary)';

function gutterColors(isDark: boolean) {
  return {
    gutter: isDark ? '#5c6370' : '#94a3b8',
    activeGutter: isDark ? '#7b8398' : '#64748b',
    copyBtn: isDark ? '#7b8398' : '#64748b',
    copyBtnHover: isDark ? '#abb2bf' : '#475569',
    selection: isDark ? '#264f78' : 'rgba(77, 141, 246, 0.22)',
    selectionFocused: isDark ? '#3584e4' : 'rgba(77, 141, 246, 0.38)',
  };
}

export function codeMirrorSyntaxTheme(theme: ThemeMode): Extension {
  if (theme === 'dark') return oneDark;
  return syntaxHighlighting(defaultHighlightStyle, { fallback: true });
}

export function buildJsonEditorShellTheme(theme: ThemeMode): Extension {
  const isDark = theme === 'dark';
  const c = gutterColors(isDark);

  return EditorView.theme({
    '&': {
      fontSize: '13px',
      border: '1px solid var(--border-color)',
      borderRadius: '4px',
      backgroundColor: BG,
    },
    '.cm-scroller': {
      fontFamily: 'Consolas, Monaco, Courier New, monospace',
      lineHeight: '1.6',
      minHeight: '300px',
      overflow: 'auto',
      backgroundColor: BG,
    },
    '.cm-content': {
      caretColor: 'var(--accent-color)',
    },
    '.cm-gutters': {
      backgroundColor: `${BG} !important`,
      color: c.gutter,
      border: 'none',
      borderRight: 'none',
    },
    '.cm-gutter': { backgroundColor: BG },
    '.cm-lineNumbers .cm-gutterElement': { backgroundColor: BG },
    '.cm-activeLineGutter': {
      backgroundColor: BG,
      color: c.activeGutter,
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-foldGutter': { backgroundColor: BG },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent-color)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: `${c.selectionFocused} !important`,
    },
    '.cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: `${c.selection} !important`,
    },
  });
}

export function buildResponseViewerShellTheme(theme: ThemeMode): Extension {
  const isDark = theme === 'dark';
  const c = gutterColors(isDark);

  return EditorView.theme({
    '&': {
      fontSize: '13px',
      border: '1px solid var(--border-color)',
      borderRadius: '4px',
      backgroundColor: BG,
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'Consolas, Monaco, Courier New, monospace',
      lineHeight: '1.6',
      height: '100%',
      overflow: 'auto',
      backgroundColor: BG,
    },
    '.cm-content': {
      caretColor: 'transparent',
    },
    '.cm-gutters': {
      backgroundColor: `${BG} !important`,
      color: c.gutter,
      border: 'none',
      borderRight: 'none',
    },
    '.cm-gutter': { backgroundColor: BG },
    '.cm-lineNumbers .cm-gutterElement': { backgroundColor: BG },
    '.cm-activeLineGutter': { backgroundColor: BG },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-foldGutter': { backgroundColor: BG },
    '.cm-field-copy-gutter': {
      width: '28px',
      backgroundColor: BG,
    },
    '.cm-field-copy-gutter .cm-gutterElement': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 2px',
    },
    '.cm-field-copy-btn': {
      background: 'none',
      border: 'none',
      color: c.copyBtn,
      cursor: 'pointer',
      fontSize: '12px',
      lineHeight: '1',
      padding: '0',
    },
    '.cm-field-copy-btn:hover': {
      color: c.copyBtnHover,
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(240, 177, 50, 0.3) !important',
      borderRadius: '2px',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'rgba(88, 101, 242, 0.5) !important',
    },
    '.cm-search.cm-panel': {
      display: 'none !important',
    },
    '.cm-selectionBackground': {
      backgroundColor: `${c.selection} !important`,
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: `${c.selectionFocused} !important`,
    },
  });
}
