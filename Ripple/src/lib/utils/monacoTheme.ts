import * as monaco from 'monaco-editor';

const chalky = 'e5c07b';
const coral = 'e06c75';
const cyan = '56b6c2';
const ivory = 'abb2bf';
const stone = '7d8799';
const malibu = '61afef';
const sage = '98c379';
const whiskey = 'd19a66';
const violet = 'c678dd';

let registered = false;

/**
 * Registers Monaco themes. Editor background is left
 * transparent so the host CSS can paint the app background.
 */
export function registerMonacoThemes(): void {
  if (registered) return;
  registered = true;

  monaco.editor.defineTheme('ripple-one-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: ivory },
      { token: 'keyword', foreground: violet },
      { token: 'keyword.json', foreground: whiskey },
      { token: 'string', foreground: sage },
      { token: 'string.key.json', foreground: coral },
      { token: 'string.value.json', foreground: sage },
      { token: 'number', foreground: chalky },
      { token: 'number.json', foreground: chalky },
      { token: 'comment', foreground: stone, fontStyle: 'italic' },
      { token: 'delimiter', foreground: ivory },
      { token: 'delimiter.bracket', foreground: ivory },
      { token: 'delimiter.array.json', foreground: ivory },
      { token: 'operator', foreground: cyan },
      { token: 'type', foreground: chalky },
      { token: 'function', foreground: malibu },
      { token: 'variable', foreground: coral },
      { token: 'tag', foreground: coral },
      { token: 'attribute.name', foreground: chalky },
      { token: 'attribute.value', foreground: sage },
    ],
    colors: {
      'editor.foreground': `#${ivory}`,
      'editor.background': '#282c34',
      'editorLineNumber.foreground': `#${stone}`,
      'editorLineNumber.activeForeground': `#${ivory}`,
      'editor.selectionBackground': '#3E4451',
      'editorCursor.foreground': '#528bff',
    },
  });

  monaco.editor.defineTheme('ripple-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {},
  });
}

export function monacoThemeName(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? 'ripple-one-dark' : 'ripple-light';
}
