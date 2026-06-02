<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount, onDestroy } from 'svelte';

  interface Props {
    data: any;
  }

  let { data }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let root: any;
  let mounted = $state(false);
  let viewport: any = null;

  function handleKeydown(e: KeyboardEvent) {
    if (!viewport?.camera) return;
    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      viewport.camera.recenter(viewport.centerX, viewport.centerY, viewport.zoomFactor + 0.15);
    } else if (isCtrl && e.key === '-') {
      e.preventDefault();
      viewport.camera.recenter(viewport.centerX, viewport.centerY, viewport.zoomFactor - 0.15);
    } else if (isCtrl && e.key === '0') {
      e.preventDefault();
      const canvas = container?.querySelector('.jsoncrack-canvas');
      if (canvas) viewport.camera.centerFitElementIntoView(canvas);
    }
  }

  function handleDocWheel(e: WheelEvent) {
    if (!mounted || !viewport?.camera || !container) return;
    if (!container.contains(e.target as Node)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // Trackpad pinch sends ctrlKey + small deltaY; two-finger scroll sends larger deltaY
    const isPinch = e.ctrlKey;
    const step = isPinch ? 0.01 * Math.abs(e.deltaY) : 0.06;
    const direction = e.deltaY > 0 ? -1 : 1;
    const newZoom = Math.max(0.05, Math.min(5, viewport.zoomFactor + direction * step));
    viewport.camera.recenter(viewport.centerX, viewport.centerY, newZoom);
  }

  async function renderReact() {
    if (!container || !data) return;

    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { JSONCrack } = await import('jsoncrack-react');
    await import('jsoncrack-react/style.css');

    if (!root) {
      root = createRoot(container);
    }

    root.render(
      React.createElement(JSONCrack, {
        json: data,
        theme: 'dark',
        layoutDirection: 'RIGHT',
        showControls: true,
        showGrid: true,
        trackpadZoom: true,
        centerOnLayout: true,
        style: { height: '100%', width: '100%' },
        onViewportCreate: (vp: any) => {
          viewport = vp;
          setTimeout(() => {
            if (!container || !vp?.camera) return;
            const firstNode = container.querySelector("g[id$='node-1']");
            if (firstNode) {
              vp.camera.centerFitElementIntoView(firstNode, { elementExtraMarginForZoom: 100 });
            }
          }, 1200);
        },
      })
    );
  }

  onMount(() => {
    mounted = true;
    window.addEventListener('keydown', handleKeydown);
    document.addEventListener('wheel', handleDocWheel, { passive: false, capture: true });
    renderReact();
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('wheel', handleDocWheel, { capture: true });
    root?.unmount();
    root = null;
    viewport = null;
    mounted = false;
  });

  run(() => {
    if (mounted && data) {
      renderReact();
    }
  });
</script>

<div class="graph-viewer-container" bind:this={container}></div>

<style>
  .graph-viewer-container {
    width: 100%;
    height: 100%;
    min-height: 300px;
    background: var(--bg-primary, #1e1f22);
    overflow: hidden;
  }
</style>
