import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import {
  type SensitiveJsonMatch,
  findSensitiveMatchAtPos,
  isMaskPlaceholder,
} from '$lib/utils/sensitiveData';
import {
  showSensitiveValuePopover,
  scheduleHideSensitiveValuePopover,
  hideSensitiveValuePopover,
} from '$lib/utils/sensitiveValuePopoverHost';

export interface JsonSensitiveHoverOptions {
  /** Resolve the real secret when the document shows a mask placeholder. */
  resolveSecret?: (match: SensitiveJsonMatch) => string;
}

function posAtEvent(view: EditorView, event: MouseEvent): number | null {
  return view.posAtCoords({ x: event.clientX, y: event.clientY });
}

/**
 * Hover popover when the pointer is over a sensitive JSON value span only.
 */
export function jsonSensitiveValueHoverExtension(
  getSensitiveMatches: () => SensitiveJsonMatch[],
  options: JsonSensitiveHoverOptions = {}
): Extension {
  const { resolveSecret } = options;

  return EditorView.domEventHandlers({
    mousemove(event, view) {
      try {
        const pos = posAtEvent(view, event);
        if (pos == null) {
          scheduleHideSensitiveValuePopover();
          return false;
        }

        const match = findSensitiveMatchAtPos(getSensitiveMatches(), pos);
        if (!match) {
          scheduleHideSensitiveValuePopover();
          return false;
        }

        const secret = resolveSecret?.(match) ?? match.value;
        if (!secret) {
          scheduleHideSensitiveValuePopover();
          return false;
        }

        let bottom = event.clientY + 12;
        try {
          const coords = view.coordsAtPos(pos);
          if (coords) bottom = coords.bottom;
        } catch {
          /* use fallback */
        }

        showSensitiveValuePopover(
          { left: event.clientX, bottom },
          `"${match.key}"`,
          secret
        );
      } catch {
        scheduleHideSensitiveValuePopover();
      }
      return false;
    },
    mouseleave() {
      scheduleHideSensitiveValuePopover();
      return false;
    },
  });
}

export function defaultMaskedSecretResolver(
  match: SensitiveJsonMatch,
  secretsByKey: Map<string, string>
): string {
  if (isMaskPlaceholder(match.value)) {
    return secretsByKey.get(match.key) ?? match.value;
  }
  return match.value;
}

/** @deprecated use jsonSensitiveValueHoverExtension */
export const responseFieldSensitiveExtension = jsonSensitiveValueHoverExtension;

export { hideSensitiveValuePopover };
