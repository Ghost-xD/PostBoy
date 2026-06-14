import type { Variable } from '$lib/stores/variableStore';

const COMPLETE_VARIABLE_REGEX = /\{\{([^}]+)\}\}/g;

export interface VariableTokenSpan {
  name: string;
  start: number;
  end: number;
}

/** Returns the complete `{{name}}` token at `index`, if any. */
export function getCompleteVariableTokenAt(text: string, index: number): VariableTokenSpan | null {
  if (!text || index < 0) return null;

  COMPLETE_VARIABLE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMPLETE_VARIABLE_REGEX.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (index >= start && index <= end) {
      return { name: match[1].trim(), start, end };
    }
  }
  return null;
}

export function resolveVariableValue(name: string, vars: Variable[]): string | null {
  const found = vars.find((v) => v.key === name);
  return found ? found.value : null;
}

export { maskSecret } from '$lib/utils/sensitiveData';

function measureCharIndex(text: string, x: number, style: CSSStyleDeclaration): number {
  if (x <= 0 || !text) return 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(text.slice(0, mid)).width <= x) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return Math.min(low, text.length);
}

/** Map a mouse X (and optional Y for textarea) to a character index in an input. */
export function getInputIndexFromMouseEvent(
  el: HTMLInputElement | HTMLTextAreaElement,
  clientX: number,
  clientY?: number
): number {
  const style = getComputedStyle(el);
  const padL = parseFloat(style.paddingLeft) || 0;
  const rect = el.getBoundingClientRect();

  if (el instanceof HTMLTextAreaElement && clientY !== undefined) {
    if (typeof (document as any).caretPositionFromPoint === 'function') {
      const pos = (document as any).caretPositionFromPoint(clientX, clientY);
      if (pos?.offsetNode === el) {
        return Math.min(pos.offset, el.value.length);
      }
    }

    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const padT = parseFloat(style.paddingTop) || 0;
    const line = Math.max(0, Math.floor((clientY - rect.top - padT + el.scrollTop) / lineHeight));
    const lines = el.value.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(line, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    const lineText = lines[Math.min(line, Math.max(lines.length - 1, 0))] ?? '';
    const x = clientX - rect.left - padL + el.scrollLeft;
    return Math.min(offset + measureCharIndex(lineText, x, style), el.value.length);
  }

  const x = clientX - rect.left - padL + el.scrollLeft;
  return measureCharIndex(el.value, x, style);
}
