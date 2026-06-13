import { mount, unmount } from 'svelte';
import SensitiveValuePopover from '$lib/components/SensitiveValuePopover.svelte';

type PopoverAnchor = { left: number; bottom: number };

let activeHost: HTMLDivElement | null = null;
let activeMount: ReturnType<typeof mount> | null = null;
let activeKey = '';
let activeValue = '';
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let popoverPinned = false;

function removePopover() {
  if (activeMount) {
    unmount(activeMount);
    activeMount = null;
  }
  activeHost?.remove();
  activeHost = null;
  activeKey = '';
  activeValue = '';
  popoverPinned = false;
}

export function hideSensitiveValuePopover() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  removePopover();
}

export function scheduleHideSensitiveValuePopover() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!popoverPinned) removePopover();
  }, 180);
}

export function showSensitiveValuePopover(
  anchor: PopoverAnchor,
  label: string,
  value: string
) {
  if (activeKey === label && activeValue === value && activeMount) {
    const el = activeHost?.firstElementChild as HTMLElement | null;
    if (el) {
      el.style.left = `${Math.max(8, anchor.left)}px`;
      el.style.top = `${anchor.bottom + 4}px`;
    }
    return;
  }

  removePopover();
  activeKey = label;
  activeValue = value;

  activeHost = document.createElement('div');
  document.body.appendChild(activeHost);

  activeMount = mount(SensitiveValuePopover, {
    target: activeHost,
    props: {
      label,
      value,
      placement: 'fixed',
      left: Math.max(8, anchor.left),
      top: anchor.bottom + 4,
      hoverBridge: false,
      onmouseenter: () => {
        popoverPinned = true;
        if (hideTimer) clearTimeout(hideTimer);
      },
      onmouseleave: () => {
        popoverPinned = false;
        hideSensitiveValuePopover();
      },
    },
  });
}
