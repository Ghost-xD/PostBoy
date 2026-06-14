import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
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

/** Class-based highlighter; colors live in ScriptEditor.svelte CSS (avoids theme injection issues). */
const scriptHighlightClasses = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword],
    class: 'cm-sh-kw',
  },
  { tag: [tags.string, tags.special(tags.string), tags.inserted], class: 'cm-sh-str' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: 'cm-sh-num' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.meta], class: 'cm-sh-cmt' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], class: 'cm-sh-fn' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], class: 'cm-sh-var' },
  {
    tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName), tags.className, tags.typeName],
    class: 'cm-sh-type',
  },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], class: 'cm-sh-op' },
]);

/** JS syntax token classes for the script editor. */
export function scriptEditorSyntaxTheme(): Extension {
  // Use direct color styles instead of classes for debugging
  const directColorStyle = HighlightStyle.define([
    {
      tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword],
      color: '#c678dd',
      fontWeight: 'bold'
    },
    { tag: [tags.string, tags.special(tags.string), tags.inserted], color: '#98c379' },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#d19a66' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.meta], color: '#5c6370', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], color: '#61afef' },
    { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: '#e06c75' },
    {
      tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName), tags.className, tags.typeName],
      color: '#e5c07b',
    },
    { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], color: '#56b6c2' },
  ]);

  return syntaxHighlighting(directColorStyle, { fallback: true });
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

export function buildScriptEditorShellTheme(theme: ThemeMode, minHeight = '280px'): Extension {
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
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      lineHeight: '1.6',
      minHeight,
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
    '.cm-activeLine': { backgroundColor: 'rgba(127, 127, 127, 0.08)' },
    '.cm-foldGutter': { backgroundColor: BG },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent-color)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: `${c.selectionFocused} !important`,
    },
    '.cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: `${c.selection} !important`,
    },
    '.cm-placeholder': {
      color: 'var(--text-secondary)',
      fontStyle: 'italic',
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
