<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount, onDestroy, tick } from 'svelte';
  import {
    computeSideBySideDiff, tryFormatJson, detectLanguage, buildLineColorMap,
    type DiffResult, type DiffLineEntry, type DiffSegment, type DiffOptions
  } from '$lib/utils/diffEngine';

  interface DiffBlock {
    type: 'added' | 'removed' | 'modified';
    leftStart: number | null; leftEnd: number | null;
    rightStart: number | null; rightEnd: number | null;
    leftInsertAfter: number; rightInsertAfter: number;
    topY: number; height: number;
  }

  interface DisplayLine {
    uid: number; isSep: boolean; hiddenCount: number;
    leftNum: number | null; rightNum: number | null;
    type: string; leftText: string; rightText: string;
    charDiffs?: DiffSegment[]; charDiffsRight?: DiffSegment[];
  }

  let leftText = $state('');
  let rightText = $state('');
  let formatJson = $state(false);
  let wordWrap = $state(false);
  let ignoreWhitespace = $state(false);
  let showOnlyChanges = $state(false);
  let contextLines = 3;
  let diffResult: DiffResult | null = $state(null);
  let changePositions: number[] = $state([]);
  let currentChangeIdx = $state(-1);
  let leftLabel = $state('Original');
  let rightLabel = $state('Modified');
  let copiedSide: 'left' | 'right' | null = $state(null);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  let leftTaEl: HTMLTextAreaElement | undefined = $state();
  let rightTaEl: HTMLTextAreaElement | undefined = $state();
  let leftBgEl: HTMLDivElement | undefined = $state();
  let rightBgEl: HTMLDivElement | undefined = $state();
  let leftGiEl: HTMLDivElement | undefined = $state();
  let rightGiEl: HTMLDivElement | undefined = $state();
  let cgInnerEl: HTMLDivElement | undefined = $state();
  let leftFvEl: HTMLDivElement | undefined = $state();
  let rightFvEl: HTMLDivElement | undefined = $state();
  let scrolling = false;

  let isDragging = $state(false);
  let mergeHeight = $state(100);
  let dragStartY = 0;
  let dragStartH = 0;

  let leftLineTypes: string[] = $state([]);
  let rightLineTypes: string[] = $state([]);
  let diffBlocks: DiffBlock[] = $state([]);
  let displayLines: DisplayLine[] = $state([]);
  let mergeText = $state('');

  let mmH = $state(0);
  let scrollY = $state(0);
  let editorH = $state(0);

  const LH = 20;
  const PHDR_H = 28;




  function scheduleDiff() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCompare, 80);
  }

  function runCompare() {
    if (!leftText && !rightText) {
      diffResult = null; changePositions = []; currentChangeIdx = -1;
      leftLineTypes = []; rightLineTypes = []; diffBlocks = []; displayLines = []; mergeText = '';
      return;
    }
    if (!leftText || !rightText) {
      diffResult = null; changePositions = []; currentChangeIdx = -1;
      leftLineTypes = new Array(leftLineCount).fill('unchanged');
      rightLineTypes = new Array(rightLineCount).fill('unchanged');
      diffBlocks = []; displayLines = []; mergeText = rightText || leftText;
      return;
    }

    const opts: DiffOptions | undefined = ignoreWhitespace ? { ignoreWhitespace: true } : undefined;
    diffResult = computeSideBySideDiff(leftText, rightText, opts);

    changePositions = [];
    diffResult.lines.forEach((line, i) => {
      if (line.type !== 'unchanged') {
        if (changePositions.length === 0 || changePositions[changePositions.length - 1] !== i - 1) {
          changePositions.push(i);
        }
      }
    });
    currentChangeIdx = changePositions.length > 0 ? 0 : -1;

    const colorMap = buildLineColorMap(diffResult);
    leftLineTypes = Array.from({ length: leftLineCount }, (_, i) => colorMap.left.get(i + 1) || 'unchanged');
    rightLineTypes = Array.from({ length: rightLineCount }, (_, i) => colorMap.right.get(i + 1) || 'unchanged');

    diffBlocks = buildDiffBlocks(diffResult);
    rebuildDisplayLines();
    rebuildMergeText();
  }


  function rebuildDisplayLines() {
    if (!diffResult) { displayLines = []; return; }
    const lines = diffResult.lines;
    if (!showOnlyChanges) {
      displayLines = lines.map((l, i) => ({ ...l, uid: i, isSep: false, hiddenCount: 0 }));
      return;
    }
    const shown = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== 'unchanged') {
        for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) shown.add(j);
      }
    }
    const result: DisplayLine[] = [];
    let uid = 0, lastIdx = -1;
    for (const idx of [...shown].sort((a, b) => a - b)) {
      if (lastIdx >= 0 && idx > lastIdx + 1) {
        result.push({ uid: uid++, isSep: true, hiddenCount: idx - lastIdx - 1, leftNum: null, rightNum: null, type: 'unchanged', leftText: '', rightText: '' });
      }
      result.push({ ...lines[idx], uid: uid++, isSep: false, hiddenCount: 0 });
      lastIdx = idx;
    }
    displayLines = result;
  }

  function rebuildMergeText() {
    if (!diffResult) { mergeText = rightText || leftText; return; }
    const ml: string[] = [];
    for (const line of diffResult.lines) {
      if (line.type === 'unchanged') ml.push(line.rightText);
      else if (line.type === 'added') ml.push(line.rightText);
      else if (line.type === 'modified') ml.push(line.rightText);
    }
    mergeText = ml.join('\n');
  }

  function buildDiffBlocks(dr: DiffResult): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    let cur: DiffBlock | null = null;
    let lastLeftNum = 0, lastRightNum = 0;
    for (const line of dr.lines) {
      if (line.type === 'unchanged') {
        if (cur) { blocks.push(cur); cur = null; }
        if (line.leftNum !== null) lastLeftNum = line.leftNum;
        if (line.rightNum !== null) lastRightNum = line.rightNum;
        continue;
      }
      if (!cur) {
        cur = { type: line.type as any, leftStart: line.leftNum, leftEnd: line.leftNum, rightStart: line.rightNum, rightEnd: line.rightNum, leftInsertAfter: lastLeftNum, rightInsertAfter: lastRightNum, topY: 0, height: 0 };
      } else {
        if (line.leftNum !== null) { if (cur.leftStart === null) cur.leftStart = line.leftNum; cur.leftEnd = line.leftNum; }
        if (line.rightNum !== null) { if (cur.rightStart === null) cur.rightStart = line.rightNum; cur.rightEnd = line.rightNum; }
        if (cur.type !== 'modified' && cur.type !== line.type) cur.type = 'modified';
      }
    }
    if (cur) blocks.push(cur);
    for (const b of blocks) {
      if (b.leftStart !== null) {
        b.topY = (b.leftStart - 1) * LH;
      } else {
        b.topY = b.leftInsertAfter * LH;
      }
      const leftSpan = (b.leftStart !== null && b.leftEnd !== null) ? (b.leftEnd - b.leftStart + 1) : 0;
      const rightSpan = (b.rightStart !== null && b.rightEnd !== null) ? (b.rightEnd - b.rightStart + 1) : 0;
      b.height = Math.max(leftSpan, rightSpan, 1) * LH;
    }
    return blocks;
  }

  function transferBlock(idx: number, dir: 'ltr' | 'rtl') {
    const block = diffBlocks[idx];
    if (!block) return;
    const la = leftText.split('\n'), ra = rightText.split('\n');
    if (dir === 'ltr') {
      if (block.leftStart !== null && block.rightStart !== null && block.leftEnd !== null && block.rightEnd !== null) {
        ra.splice(block.rightStart - 1, block.rightEnd - block.rightStart + 1, ...la.slice(block.leftStart - 1, block.leftEnd));
      } else if (block.leftStart !== null && block.leftEnd !== null) {
        ra.splice(block.rightInsertAfter, 0, ...la.slice(block.leftStart - 1, block.leftEnd));
      } else if (block.rightStart !== null && block.rightEnd !== null) {
        ra.splice(block.rightStart - 1, block.rightEnd - block.rightStart + 1);
      }
      rightText = ra.join('\n');
    } else {
      if (block.rightStart !== null && block.leftStart !== null && block.rightEnd !== null && block.leftEnd !== null) {
        la.splice(block.leftStart - 1, block.leftEnd - block.leftStart + 1, ...ra.slice(block.rightStart - 1, block.rightEnd));
      } else if (block.rightStart !== null && block.rightEnd !== null) {
        la.splice(block.leftInsertAfter, 0, ...ra.slice(block.rightStart - 1, block.rightEnd));
      } else if (block.leftStart !== null && block.leftEnd !== null) {
        la.splice(block.leftStart - 1, block.leftEnd - block.leftStart + 1);
      }
      leftText = la.join('\n');
    }
  }

  function syncLeft() {
    if (!leftTaEl) return;
    const y = leftTaEl.scrollTop;
    scrollY = y;
    if (leftBgEl) leftBgEl.style.transform = `translateY(${-y}px)`;
    if (leftGiEl) leftGiEl.style.transform = `translateY(${-y}px)`;
    if (cgInnerEl) cgInnerEl.style.transform = `translateY(${-y}px)`;
    if (!scrolling && rightTaEl) {
      scrolling = true;
      requestAnimationFrame(() => {
        if (rightTaEl) {
          rightTaEl.scrollTop = y;
          if (rightBgEl) rightBgEl.style.transform = `translateY(${-y}px)`;
          if (rightGiEl) rightGiEl.style.transform = `translateY(${-y}px)`;
        }
        scrolling = false;
      });
    }
  }
  function syncRight() {
    if (!rightTaEl) return;
    const y = rightTaEl.scrollTop;
    scrollY = y;
    if (rightBgEl) rightBgEl.style.transform = `translateY(${-y}px)`;
    if (rightGiEl) rightGiEl.style.transform = `translateY(${-y}px)`;
    if (cgInnerEl) cgInnerEl.style.transform = `translateY(${-y}px)`;
    if (!scrolling && leftTaEl) {
      scrolling = true;
      requestAnimationFrame(() => {
        if (leftTaEl) {
          leftTaEl.scrollTop = y;
          if (leftBgEl) leftBgEl.style.transform = `translateY(${-y}px)`;
          if (leftGiEl) leftGiEl.style.transform = `translateY(${-y}px)`;
        }
        scrolling = false;
      });
    }
  }
  function syncFvLeft() {
    if (!leftFvEl || !rightFvEl || scrolling) return;
    scrolling = true;
    rightFvEl.scrollTop = leftFvEl.scrollTop;
    scrolling = false;
  }
  function syncFvRight() {
    if (!rightFvEl || !leftFvEl || scrolling) return;
    scrolling = true;
    leftFvEl.scrollTop = rightFvEl.scrollTop;
    scrolling = false;
  }

  function handleGlobalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'j') { e.preventDefault(); toggleFormatJson(); }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') { e.preventDefault(); goNext(); }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') { e.preventDefault(); goPrev(); }
  }
  onMount(() => window.addEventListener('keydown', handleGlobalKey));
  onDestroy(() => { window.removeEventListener('keydown', handleGlobalKey); if (debounceTimer) clearTimeout(debounceTimer); });

  function toggleFormatJson() { formatJson = !formatJson; if (formatJson) { leftText = tryFormatJson(leftText); rightText = tryFormatJson(rightText); } }
  function swap() { [leftText, rightText] = [rightText, leftText]; [leftLabel, rightLabel] = [rightLabel, leftLabel]; }
  function clearAll() { leftText = ''; rightText = ''; leftLabel = 'Original'; rightLabel = 'Modified'; }
  function copyText(side: 'left' | 'right') { const t = side === 'left' ? leftText : rightText; if (t) { navigator.clipboard.writeText(t); copiedSide = side; setTimeout(() => copiedSide = null, 1200); } }

  function loadFile(side: 'left' | 'right') {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        if (side === 'left') { leftText = content; leftLabel = file.name; }
        else { rightText = content; rightLabel = file.name; }
      } catch (err) {
        console.error('Failed to read file:', err);
      }
    };
    input.click();
  }

  function copyMerge() { if (mergeText) navigator.clipboard.writeText(mergeText); }
  function goNext() { if (changePositions.length === 0) return; currentChangeIdx = (currentChangeIdx + 1) % changePositions.length; scrollToChange(); }
  function goPrev() { if (changePositions.length === 0) return; currentChangeIdx = (currentChangeIdx - 1 + changePositions.length) % changePositions.length; scrollToChange(); }
  function scrollToChange() {
    if (!diffResult || currentChangeIdx < 0) return;
    const entry = diffResult.lines[changePositions[currentChangeIdx]];
    const targetLine = entry.leftNum ?? entry.rightNum ?? 0;
    if (targetLine > 0) {
      const y = (targetLine - 1) * LH;
      if (!isFiltered && leftTaEl) { leftTaEl.scrollTop = y - leftTaEl.clientHeight / 2; syncLeft(); }
    }
  }
  function startDrag(e: MouseEvent) { isDragging = true; dragStartY = e.clientY; dragStartH = mergeHeight; e.preventDefault(); }
  function onDragMove(e: MouseEvent) { if (!isDragging) return; mergeHeight = Math.max(40, Math.min(500, dragStartH - (e.clientY - dragStartY))); }
  function onDragEnd() { isDragging = false; }

  function mmClick(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (mmScale <= 0) return;
    const targetScroll = y / mmScale - editorH / 2;
    if (!isFiltered && leftTaEl) {
      leftTaEl.scrollTop = Math.max(0, targetScroll);
      syncLeft();
    }
  }

  function renderCharSegs(segs: DiffSegment[]): string {
    return segs.map(s => {
      const e = s.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (s.type === 'removed') return `<span class="ch-del">${e}</span>`;
      if (s.type === 'added') return `<span class="ch-add">${e}</span>`;
      return e;
    }).join('');
  }
  let leftLangHint = $derived(leftText ? detectLanguage(leftText) : '');
  let rightLangHint = $derived(rightText ? detectLanguage(rightText) : '');
  let leftLineCount = $derived(leftText ? leftText.split('\n').length : 0);
  let rightLineCount = $derived(rightText ? rightText.split('\n').length : 0);
  let leftGutterH = $derived(leftLineCount * LH);
  let rightGutterH = $derived(rightLineCount * LH);
  let maxGutterH = $derived(Math.max(leftGutterH, rightGutterH, LH));
  let isFiltered = $derived(showOnlyChanges && diffResult !== null);
  let mmScale = $derived(mmH > 0 && maxGutterH > 0 ? mmH / maxGutterH : 0);
  let mmVpTop = $derived(scrollY * mmScale);
  let mmVpH = $derived(Math.max(editorH * mmScale, 8));
  let mmMarkers = $derived(diffBlocks.map(b => ({
    type: b.type,
    top: b.topY * mmScale,
    height: Math.max(b.height * mmScale, 3)
  })));
  run(() => {
    void leftText; void rightText; void formatJson; void ignoreWhitespace;
    scheduleDiff();
  });
  run(() => {
    if (diffResult) { void showOnlyChanges; rebuildDisplayLines(); rebuildMergeText(); }
  });
</script>

<svelte:window onmousemove={onDragMove} onmouseup={onDragEnd} />

<div class="dt">
  <!-- ═══ TOOLBAR ═══ -->
  <div class="dt-bar">
    <div class="dt-bar-l">
      <button class="dt-b" onclick={swap}>⇄ Swap</button>
      <button class="dt-b" onclick={clearAll}>Clear</button>
      <span class="dt-sep"></span>
      <label class="dt-chk"><input type="checkbox" checked={formatJson} onchange={toggleFormatJson} /><span>JSON</span></label>
      <label class="dt-chk"><input type="checkbox" bind:checked={wordWrap} /><span>Wrap</span></label>
      <label class="dt-chk"><input type="checkbox" bind:checked={ignoreWhitespace} /><span>Ignore WS</span></label>
      <label class="dt-chk"><input type="checkbox" bind:checked={showOnlyChanges} /><span>Diffs Only</span></label>
    </div>
    <div class="dt-bar-r">
      {#if diffResult && changePositions.length > 0}
        <div class="dt-nav">
          <button class="dt-nb" onclick={goPrev} title="Previous (Alt+P)">▲</button>
          <span class="dt-nl">{currentChangeIdx + 1}/{changePositions.length}</span>
          <button class="dt-nb" onclick={goNext} title="Next (Alt+N)">▼</button>
        </div>
      {/if}
      {#if diffResult}
        <div class="dt-stats">
          {#if diffResult.stats.modified > 0}<span class="sm">~{diffResult.stats.modified}</span>{/if}
          {#if diffResult.stats.added > 0}<span class="sa">+{diffResult.stats.added}</span>{/if}
          {#if diffResult.stats.removed > 0}<span class="sd">-{diffResult.stats.removed}</span>{/if}
          <span class="su">{diffResult.stats.unchanged} same</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- ═══ BODY (minimap + content) ═══ -->
  <div class="dt-body">
    <!-- MINIMAP / quick navigator -->
    <div class="dt-minimap" bind:clientHeight={mmH} onclick={mmClick} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && mmClick(e as unknown as MouseEvent)} role="button" tabindex="0" aria-label="Diff overview — click to navigate">
      {#if diffResult}
        <div class="dt-mm-vp" style="top:{mmVpTop}px;height:{mmVpH}px"></div>
        {#each mmMarkers as m}
          <div class="dt-mm-mark {m.type}" style="top:{m.top}px;height:{Math.max(m.height, 3)}px"></div>
        {/each}
      {/if}
    </div>

    <!-- WORK AREA (left col + center gutter + right col) -->
    <div class="dt-work">
      <!-- LEFT COLUMN -->
      <div class="dt-col">
        <div class="dt-phdr">
          <span class="dt-plbl">{leftLabel}</span>
          {#if leftLangHint}<span class="dt-badge">{leftLangHint}</span>{/if}
          {#if diffResult}<span class="dt-plc">{diffResult.stats.totalLeft} lines</span>{/if}
          <div class="dt-pactions">
            <button class="dt-pa" onclick={() => loadFile('left')}>Load</button>
            <button class="dt-pa" onclick={() => copyText('left')} disabled={!leftText}>{copiedSide === 'left' ? '✓' : 'Copy'}</button>
          </div>
        </div>
        <div class="dt-editor" bind:clientHeight={editorH}>
          {#if isFiltered}
            <div class="dt-fv" bind:this={leftFvEl} onscroll={syncFvLeft} class:ww={wordWrap}>
              {#each displayLines as line (line.uid)}
                {#if line.isSep}
                  <div class="dt-fv-sep"><span>⋯ {line.hiddenCount} unchanged lines ⋯</span></div>
                {:else}
                  <div class="dt-fv-row {line.type}">
                    <span class="dt-fv-ln {line.type}">{line.leftNum ?? ''}</span>
                    <span class="dt-fv-txt {line.type}">
                      {#if line.type === 'modified' && line.charDiffs}{@html renderCharSegs(line.charDiffs)}{:else}{line.leftText}{/if}
                    </span>
                  </div>
                {/if}
              {/each}
            </div>
          {:else}
            <div class="dt-gutter">
              <div class="dt-gi" bind:this={leftGiEl} style="height:{leftGutterH}px">
                {#each { length: leftLineCount } as _, i}<div class="dt-gn {leftLineTypes[i] || ''}">{i + 1}</div>{/each}
              </div>
            </div>
            <div class="dt-ed-wrap">
              <div class="dt-bg" bind:this={leftBgEl} style="height:{leftGutterH}px">
                {#each { length: leftLineCount } as _, i}<div class="dt-bgl {leftLineTypes[i] || ''}"></div>{/each}
              </div>
              <textarea bind:this={leftTaEl} bind:value={leftText} onscroll={syncLeft} class="dt-ta" class:ww={wordWrap} placeholder="Click here and paste or type original text..." spellcheck="false"></textarea>
            </div>
          {/if}
        </div>
      </div>

      <!-- CENTER GUTTER COLUMN -->
      {#if !isFiltered}
        <div class="dt-cgcol">
          <div class="dt-cghdr"></div>
          <div class="dt-cg">
            <div class="dt-cg-inner" bind:this={cgInnerEl} style="height:{maxGutterH}px">
              {#each diffBlocks as block, i}
                <div class="dt-cg-block {block.type}" style="top:{block.topY}px;height:{Math.max(block.height, LH)}px">
                  <button class="dt-cg-arr ltr" onclick={() => transferBlock(i, 'ltr')} title="Copy left → right"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.47 4.29a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06L9.69 8.56H2.75a.75.75 0 0 1 0-1.5h6.94L6.47 5.35a.75.75 0 0 1 0-1.06Z"/><path d="M13.25 3a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-1.5 0v-8.5a.75.75 0 0 1 .75-.75Z"/></svg></button>
                  <button class="dt-cg-arr rtl" onclick={() => transferBlock(i, 'rtl')} title="Copy right → left"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.53 4.29a.75.75 0 0 0-1.06 0L4.72 8.04a.75.75 0 0 0 0 1.06l3.75 3.75a.75.75 0 1 0 1.06-1.06L6.31 8.56h6.94a.75.75 0 0 0 0-1.5H6.31l3.22-3.21a.75.75 0 0 0 0-1.06Z"/><path d="M2.75 3a.75.75 0 0 0-.75.75v8.5a.75.75 0 0 0 1.5 0v-8.5A.75.75 0 0 0 2.75 3Z"/></svg></button>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {:else}
        <div class="dt-cg-simple"></div>
      {/if}

      <!-- RIGHT COLUMN -->
      <div class="dt-col">
        <div class="dt-phdr">
          <span class="dt-plbl">{rightLabel}</span>
          {#if rightLangHint}<span class="dt-badge">{rightLangHint}</span>{/if}
          {#if diffResult}<span class="dt-plc">{diffResult.stats.totalRight} lines</span>{/if}
          <div class="dt-pactions">
            <button class="dt-pa" onclick={() => loadFile('right')}>Load</button>
            <button class="dt-pa" onclick={() => copyText('right')} disabled={!rightText}>{copiedSide === 'right' ? '✓' : 'Copy'}</button>
          </div>
        </div>
        <div class="dt-editor">
          {#if isFiltered}
            <div class="dt-fv" bind:this={rightFvEl} onscroll={syncFvRight} class:ww={wordWrap}>
              {#each displayLines as line (line.uid)}
                {#if line.isSep}
                  <div class="dt-fv-sep"><span>⋯ {line.hiddenCount} unchanged lines ⋯</span></div>
                {:else}
                  <div class="dt-fv-row {line.type}">
                    <span class="dt-fv-ln {line.type}">{line.rightNum ?? ''}</span>
                    <span class="dt-fv-txt {line.type}">
                      {#if line.type === 'modified' && line.charDiffsRight}{@html renderCharSegs(line.charDiffsRight)}{:else}{line.rightText}{/if}
                    </span>
                  </div>
                {/if}
              {/each}
            </div>
          {:else}
            <div class="dt-gutter">
              <div class="dt-gi" bind:this={rightGiEl} style="height:{rightGutterH}px">
                {#each { length: rightLineCount } as _, i}<div class="dt-gn {rightLineTypes[i] || ''}">{i + 1}</div>{/each}
              </div>
            </div>
            <div class="dt-ed-wrap">
              <div class="dt-bg" bind:this={rightBgEl} style="height:{rightGutterH}px">
                {#each { length: rightLineCount } as _, i}<div class="dt-bgl {rightLineTypes[i] || ''}"></div>{/each}
              </div>
              <textarea bind:this={rightTaEl} bind:value={rightText} onscroll={syncRight} class="dt-ta" class:ww={wordWrap} placeholder="Click here and paste or type modified text..." spellcheck="false"></textarea>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- ═══ DRAG HANDLE ═══ -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="dt-drag" onmousedown={startDrag} class:active={isDragging} role="separator" aria-orientation="horizontal" aria-label="Resize diff/merge panels" tabindex="-1"><div class="dt-drag-dots"></div></div>

  <!-- ═══ MERGE OUTPUT ═══ -->
  <div class="dt-merge" style="height:{mergeHeight}px">
    <div class="dt-mhdr">
      <span class="dt-mlbl">Merge Output</span>
      <span class="dt-minfo">Use ‹ › arrows in gutter to transfer individual blocks</span>
      <button class="dt-pa" onclick={copyMerge} disabled={!mergeText}>Copy</button>
    </div>
    <textarea class="dt-mta" value={mergeText} readonly placeholder="Merge output appears here when both panels have text..."></textarea>
  </div>

  <!-- ═══ STATUS BAR ═══ -->
  <div class="dt-status">
    {#if diffResult}
      <span class="dt-si">{changePositions.length} difference section(s)</span>
      <span class="dt-si">{diffResult.stats.totalLeft} / {diffResult.stats.totalRight} lines</span>
      {#if ignoreWhitespace}<span class="dt-si">WS ignored</span>{/if}
    {:else}
      <span class="dt-si">Paste or type text in both panels to compare</span>
    {/if}
  </div>
</div>

<style>
  /* ═══ LIGHT THEME for diff tool ═══ */
  .dt {
    display: flex; flex-direction: column; height: 100%; overflow: hidden;
    background: #ffffff; color: #1f2328;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  }

  /* ── Toolbar ── */
  .dt-bar { display: flex; align-items: center; justify-content: space-between; padding: 5px 10px; border-bottom: 1px solid #d1d9e0; flex-shrink: 0; gap: 6px; flex-wrap: wrap; background: #f6f8fa; }
  .dt-bar-l, .dt-bar-r { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .dt-b { padding: 3px 10px; background: #ffffff; border: 1px solid #d1d9e0; border-radius: 4px; color: #1f2328; font-size: 11.5px; cursor: pointer; white-space: nowrap; transition: all .1s; font-weight: 500; }
  .dt-b:hover { background: #f0f2f5; border-color: #b0b8c1; }
  .dt-sep { width: 1px; height: 14px; background: #d1d9e0; }
  .dt-chk { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: #57606a; cursor: pointer; user-select: none; }
  .dt-chk input { width: 13px; height: 13px; accent-color: #0969da; cursor: pointer; }
  .dt-chk:hover span { color: #1f2328; }

  .dt-nav { display: flex; align-items: center; gap: 1px; background: #fff; border: 1px solid #d1d9e0; border-radius: 4px; padding: 1px; }
  .dt-nb { display: flex; align-items: center; justify-content: center; width: 22px; height: 20px; background: none; border: none; border-radius: 3px; color: #57606a; font-size: 9px; cursor: pointer; }
  .dt-nb:hover { background: #f0f2f5; color: #1f2328; }
  .dt-nl { font-size: 10.5px; color: #57606a; min-width: 36px; text-align: center; font-variant-numeric: tabular-nums; }
  .dt-stats { display: flex; gap: 5px; font-size: 10.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .sa { color: #1a7f37; } .sd { color: #cf222e; } .sm { color: #9a6700; }
  .su { color: #8b949e; }

  /* ── Body: minimap + work area ── */
  .dt-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }

  /* ── Minimap / quick navigator ── */
  .dt-minimap {
    width: 22px; min-width: 22px; flex-shrink: 0;
    position: relative; background: #f0f2f5; border-right: 1px solid #d1d9e0;
    cursor: pointer; overflow: hidden;
  }
  .dt-mm-vp {
    position: absolute; left: 0; right: 0;
    background: rgba(9, 105, 218, 0.12); border: 1px solid rgba(9, 105, 218, 0.35);
    border-radius: 2px; pointer-events: none; min-height: 8px;
    transition: top 0.05s linear;
  }
  .dt-mm-mark {
    position: absolute; left: 3px; right: 3px; border-radius: 1px;
    pointer-events: none; min-height: 3px;
  }
  .dt-mm-mark.removed  { background: #cf222e; opacity: .7; }
  .dt-mm-mark.added    { background: #1a7f37; opacity: .7; }
  .dt-mm-mark.modified { background: #9a6700; opacity: .7; }

  /* ── Work area: 3 columns ── */
  .dt-work { flex: 1; display: flex; min-width: 0; overflow: hidden; }

  /* ── Panel columns (left/right) ── */
  .dt-col { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .dt-phdr {
    display: flex; align-items: center; gap: 6px; padding: 3px 10px;
    background: #f6f8fa; border-bottom: 1px solid #d1d9e0; flex-shrink: 0;
    height: 28px; box-sizing: border-box;
  }
  .dt-plbl { font-size: 11.5px; font-weight: 600; color: #1f2328; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
  .dt-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: #e8ecf0; color: #57606a; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  .dt-plc { font-size: 9px; color: #8b949e; }
  .dt-pactions { display: flex; gap: 3px; margin-left: auto; }
  .dt-pa { padding: 2px 8px; background: #fff; border: 1px solid #d1d9e0; border-radius: 4px; color: #57606a; font-size: 10.5px; cursor: pointer; transition: all .1s; white-space: nowrap; font-weight: 500; }
  .dt-pa:hover:not(:disabled) { background: #f0f2f5; color: #1f2328; border-color: #b0b8c1; }
  .dt-pa:disabled { opacity: .3; cursor: default; }

  /* ── Editor area ── */
  .dt-editor { flex: 1; display: flex; min-height: 0; overflow: hidden; background: #ffffff; }

  /* Line number gutter - outer frame clips, inner scrolls via transform */
  .dt-gutter {
    width: 48px; min-width: 48px; overflow: hidden;
    background: #f6f8fa; border-right: 1px solid #d1d9e0;
  }
  .dt-gi { will-change: transform; }
  .dt-gn {
    height: 20px; line-height: 20px; text-align: right; padding-right: 8px;
    font-size: 11px; font-family: 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, monospace;
    color: #57606a; font-variant-numeric: tabular-nums; user-select: none; box-sizing: border-box;
  }
  .dt-gn.removed  { color: #cf222e; background: #ffebe9; font-weight: 600; }
  .dt-gn.added    { color: #1a7f37; background: #dafbe1; font-weight: 600; }
  .dt-gn.modified { color: #9a6700; background: #fff8c5; font-weight: 600; }

  /* Background overlay */
  .dt-ed-wrap { flex: 1; position: relative; overflow: hidden; }
  .dt-bg { position: absolute; top: 0; left: 0; right: 0; pointer-events: none; will-change: transform; z-index: 0; }
  .dt-bgl { height: 20px; }
  .dt-bgl.removed  { background: #ffebe9; border-left: 4px solid #ff8182; }
  .dt-bgl.added    { background: #dafbe1; border-left: 4px solid #4ac26b; }
  .dt-bgl.modified { background: #fff8c5; border-left: 4px solid #d4a72c; }

  /* Textarea */
  .dt-ta {
    position: relative; z-index: 1; width: 100%; height: 100%; margin: 0;
    padding: 0 10px 0 14px; background: transparent; color: #1f2328;
    font-family: 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, monospace;
    font-size: 12px; line-height: 20px; border: none; outline: none; resize: none;
    white-space: pre; tab-size: 4; overflow: auto; box-sizing: border-box;
  }
  .dt-ta.ww { white-space: pre-wrap; word-break: break-all; }
  .dt-ta::placeholder { color: #8b949e; }
  .dt-ta:focus { box-shadow: inset 0 0 0 2px #0969da; }

  /* ── Filtered diff view (Diffs Only mode) ── */
  .dt-fv {
    flex: 1; overflow: auto;
    font-family: 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, monospace;
    font-size: 12px; line-height: 20px;
  }
  .dt-fv-row { display: flex; min-height: 20px; }
  .dt-fv-row.removed  { background: #ffebe9; }
  .dt-fv-row.added    { background: #dafbe1; }
  .dt-fv-row.modified { background: #fff8c5; }
  .dt-fv-ln {
    width: 48px; min-width: 48px; text-align: right; padding-right: 8px;
    color: #57606a; font-size: 11px; line-height: 20px; user-select: none;
    font-variant-numeric: tabular-nums; box-sizing: border-box;
    background: #f6f8fa; border-right: 1px solid #d1d9e0;
  }
  .dt-fv-ln.removed  { color: #cf222e; background: #ffcecb; font-weight: 600; }
  .dt-fv-ln.added    { color: #1a7f37; background: #aff5b4; font-weight: 600; }
  .dt-fv-ln.modified { color: #9a6700; background: #ffeea8; font-weight: 600; }
  .dt-fv-txt { flex: 1; padding: 0 10px; white-space: pre; overflow: hidden; text-overflow: ellipsis; line-height: 20px; color: #1f2328; }
  .ww .dt-fv-txt { white-space: pre-wrap; word-break: break-all; overflow: visible; }
  .dt-fv-sep {
    display: flex; align-items: center; justify-content: center;
    min-height: 24px; background: #f0f2f5; border-top: 1px solid #d1d9e0; border-bottom: 1px solid #d1d9e0;
    font-size: 10px; color: #8b949e; font-style: italic; letter-spacing: .04em;
  }

  /* Character-level highlights */
  :global(.ch-del) { background: #ff818266; border-radius: 2px; padding: 1px 1px; text-decoration: line-through; text-decoration-color: #cf222e; }
  :global(.ch-add) { background: #4ac26b66; border-radius: 2px; padding: 1px 1px; font-weight: 700; }

  /* ── Center gutter column ── */
  .dt-cgcol { width: 36px; min-width: 36px; flex-shrink: 0; display: flex; flex-direction: column; }
  .dt-cghdr {
    height: 28px; flex-shrink: 0;
    background: #f6f8fa; border-bottom: 1px solid #d1d9e0;
  }
  .dt-cg { flex: 1; position: relative; overflow: hidden; background: #f6f8fa; border-left: 1px solid #d1d9e0; border-right: 1px solid #d1d9e0; }
  .dt-cg-simple { width: 4px; flex-shrink: 0; background: #d1d9e0; }
  .dt-cg-inner { position: relative; will-change: transform; }
  .dt-cg-block {
    position: absolute; left: 2px; right: 2px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; border-radius: 4px; padding: 2px 0;
  }
  .dt-cg-block.removed  { background: #ffebe9; border-left: 3px solid #cf222e; }
  .dt-cg-block.added    { background: #dafbe1; border-left: 3px solid #1a7f37; }
  .dt-cg-block.modified { background: #fff8c5; border-left: 3px solid #9a6700; }
  .dt-cg-block:hover { filter: brightness(.95); }
  .dt-cg-arr {
    width: 24px; height: 16px; display: flex; align-items: center; justify-content: center;
    background: #ffffff; border: 1px solid #d1d9e0; border-radius: 3px;
    cursor: pointer; transition: all .12s; padding: 0; flex-shrink: 0;
  }
  .dt-cg-arr svg { width: 11px; height: 11px; }
  .dt-cg-arr.ltr { color: #1a7f37; }
  .dt-cg-arr.rtl { color: #cf222e; }
  .dt-cg-arr.ltr:hover { background: #dafbe1; border-color: #1a7f37; }
  .dt-cg-arr.rtl:hover { background: #ffebe9; border-color: #cf222e; }

  /* ── Drag handle ── */
  .dt-drag { height: 6px; flex-shrink: 0; cursor: ns-resize; background: #f6f8fa; border-top: 1px solid #d1d9e0; display: flex; align-items: center; justify-content: center; }
  .dt-drag:hover, .dt-drag.active { background: #e8ecf0; }
  .dt-drag-dots { width: 30px; height: 2px; border-radius: 1px; background: #b0b8c1; }

  /* ── Merge output ── */
  .dt-merge { display: flex; flex-direction: column; flex-shrink: 0; border-top: 1px solid #d1d9e0; min-height: 40px; }
  .dt-mhdr { display: flex; align-items: center; gap: 8px; padding: 3px 10px; background: #f6f8fa; border-bottom: 1px solid #d1d9e0; flex-shrink: 0; }
  .dt-mlbl { font-size: 10.5px; font-weight: 600; color: #1f2328; text-transform: uppercase; letter-spacing: .03em; }
  .dt-minfo { font-size: 9px; color: #8b949e; flex: 1; }
  .dt-mta {
    flex: 1; width: 100%; padding: 4px 10px; background: #ffffff; border: none;
    color: #1f2328; font-family: 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, monospace;
    font-size: 11px; line-height: 1.5; resize: none; outline: none; box-sizing: border-box;
    white-space: pre; overflow: auto;
  }
  .dt-mta::placeholder { color: #b0b8c1; }

  /* ── Status bar ── */
  .dt-status { display: flex; align-items: center; gap: 14px; padding: 3px 10px; background: #f6f8fa; border-top: 1px solid #d1d9e0; flex-shrink: 0; }
  .dt-si { font-size: 10.5px; color: #57606a; font-variant-numeric: tabular-nums; }
</style>
