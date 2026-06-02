<script module lang="ts">
  // Public type — exported from the module so callers can do
  //   `import type { ToolsNavTab } from '.../ToolsNavBar.svelte'`.
  // It has to live in a `context="module"` script because Svelte's
  // instance `<script>` is a component class, not an ES module.
  export type ToolsNavTab = {
    key: string;
    label: string;
    title?: string;
  };
</script>

<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';

  interface Props {
    tabs?: ToolsNavTab[];
    value?: string;
    waveColor?: string;
    actions?: import('svelte').Snippet;
  }

  let {
    tabs = [],
    value = '',
    waveColor = 'var(--bg-secondary)',
    actions
  }: Props = $props();

  const dispatch = createEventDispatcher<{ select: { key: string } }>();

  // Bell-curve dimensions for the wave bump.
  // BUMP_H is how far the wave protrudes UP from the body into the nav
  // strip; BUMP_W is half its width. Tuned to look natural on tabs
  // sized ~80-160px wide.
  const BUMP_H = 16;
  const BUMP_W = 78;
  const DURATION = 480;

  let navEl: HTMLElement | undefined = $state();
  let svgEl: SVGSVGElement | undefined = $state();
  let pathEl: SVGPathElement | undefined = $state();
  let resizeObserver: ResizeObserver | null = null;

  let curX: number | null = null;
  let rafId: number | null = null;

  function getTabEl(key: string): HTMLElement | null {
    if (!navEl) return null;
    return navEl.querySelector<HTMLElement>(`[data-tools-nav-key="${key}"]`);
  }

  function centerXOf(el: HTMLElement): number {
    if (!navEl) return 0;
    const navRect = navEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return elRect.left - navRect.left + elRect.width / 2;
  }

  // Two cubic Bézier halves form a bell curve pushed UP from the bottom
  // of the nav strip. Control-point ratios (0.52 / 0.22) give a flat base
  // and a rounded peak. The strip below the curve is filled solid so the
  // wave reads as "the content panel bulging into the nav".
  function buildPath(cx: number): string {
    if (!navEl) return '';
    const W = navEl.clientWidth;
    const bh = BUMP_H;
    const bw = BUMP_W;
    const lx = cx - bw;
    const rx = cx + bw;
    const l1x = lx + bw * 0.52;
    const l1y = 0;
    const l2x = cx - bw * 0.22;
    const l2y = bh;
    const r1x = cx + bw * 0.22;
    const r1y = bh;
    const r2x = rx - bw * 0.52;
    const r2y = 0;
    return [
      'M 0 0',
      'L ' + lx + ' 0',
      'C ' + l1x + ' ' + l1y + ', ' + l2x + ' ' + l2y + ', ' + cx + ' ' + bh,
      'C ' + r1x + ' ' + r1y + ', ' + r2x + ' ' + r2y + ', ' + rx + ' 0',
      'L ' + W + ' 0',
      'L ' + W + ' ' + (bh + 1),
      'L 0 ' + (bh + 1),
      'Z',
    ].join(' ');
  }

  function renderWave(cx: number) {
    if (!svgEl || !pathEl || !navEl) return;
    const W = navEl.clientWidth;
    svgEl.setAttribute('width', String(W));
    svgEl.setAttribute('height', String(BUMP_H + 1));
    pathEl.setAttribute('d', buildPath(cx));
  }

  // ease-in-out quart — gives the wave a "liquid inertia" feel,
  // slow at the edges, fast through the middle.
  function ease(t: number): number {
    return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;
  }

  function animateTo(target: number) {
    const fromX = curX ?? target;
    if (rafId !== null) cancelAnimationFrame(rafId);
    let startTs: number | null = null;
    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const t = Math.min((ts - startTs) / DURATION, 1);
      curX = fromX + (target - fromX) * ease(t);
      renderWave(curX);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(step);
  }

  async function syncToActive(animated: boolean) {
    await tick();
    const el = getTabEl(value);
    if (!el || !navEl) return;
    const target = centerXOf(el);
    if (!animated || curX === null) {
      curX = target;
      renderWave(target);
    } else {
      animateTo(target);
    }
  }

  function handleClick(key: string) {
    if (key === value) return;
    dispatch('select', { key });
  }

  // Re-position the wave whenever the active tab changes.
  // `value` is the controlled-component prop; we sync the wave to whatever
  // the parent set.
  run(() => {
    if (navEl && value) {
      void syncToActive(true);
    }
  });

  // Re-position when the wave color changes (e.g. switching to a panel
  // with a different body background). The path itself doesn't depend
  // on color, but a render call is cheap and ensures any stale fill is
  // refreshed.
  run(() => {
    if (pathEl && waveColor) {
      pathEl.setAttribute('fill', waveColor);
    }
  });

  onMount(() => {
    // Initial paint without animation, after the tab buttons have laid out.
    void syncToActive(false);
    // Track nav width so the wave's right-edge fill stays glued to the
    // edge during resizes (fullscreen toggle, window resize, etc.).
    resizeObserver = new ResizeObserver(() => {
      void syncToActive(false);
    });
    if (navEl) resizeObserver.observe(navEl);
  });

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
  });
</script>

<nav class="tools-nav" bind:this={navEl}>
  <div class="tools-nav-tabs">
    {#each tabs as tab (tab.key)}
      <button
        type="button"
        class="tools-nav-tab"
        class:active={value === tab.key}
        data-tools-nav-key={tab.key}
        title={tab.title ?? ''}
        onclick={() => handleClick(tab.key)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="tools-nav-actions">
    {@render actions?.()}
  </div>

  <svg
    class="tools-nav-wave"
    bind:this={svgEl}
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path bind:this={pathEl} fill={waveColor} />
  </svg>
</nav>

<style>
  .tools-nav {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 56px;
    padding: 0 18px;
    background: var(--bg-primary);
    flex-shrink: 0;
    /* The wave SVG draws across this whole nav at the bottom edge. We
       don't put a border-bottom here — the wave itself is the visual
       seam between nav and body. */
  }

  .tools-nav-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: auto;
    /* Sit above the wave SVG so clicks land on the buttons, not the
       overlapping bell curve. */
    position: relative;
    z-index: 6;
  }

  .tools-nav-tab {
    padding: 6px 16px;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    letter-spacing: 0.01em;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.25s ease, text-shadow 0.25s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .tools-nav-tab:hover:not(.active) {
    color: var(--text-primary);
  }

  .tools-nav-tab.active {
    color: var(--accent-color);
    font-weight: 600;
    text-shadow: 0 0 14px color-mix(in srgb, var(--accent-color) 55%, transparent);
  }

  .tools-nav-tab:focus-visible {
    color: var(--accent-color);
    outline: 1px solid color-mix(in srgb, var(--accent-color) 60%, transparent);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .tools-nav-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    position: relative;
    z-index: 6;
  }

  .tools-nav-wave {
    position: absolute;
    left: 0;
    bottom: 0;
    overflow: visible;
    pointer-events: none;
    z-index: 5;
    display: block;
    /* Soft blue glow so the wave reads clearly against the pitch-black
       nav background. */
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent-color) 55%, transparent))
            drop-shadow(0 -1px 2px color-mix(in srgb, var(--accent-color) 35%, transparent));
  }
</style>
