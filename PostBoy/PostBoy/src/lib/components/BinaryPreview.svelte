<script lang="ts">
  import { base64ToDataUrl, getImageMimeType, formatBytes } from '$lib/utils/responseUtils';
  import type { ResponseTypeInfo } from '$lib/utils/responseUtils';

  export let body: string = '';
  export let typeInfo: ResponseTypeInfo;
  export let contentType: string = '';

  let imageError = false;
  let imageLoaded = false;
  let naturalWidth = 0;
  let naturalHeight = 0;

  $: dataUrl = typeInfo.type === 'image'
    ? base64ToDataUrl(body, getImageMimeType(contentType))
    : typeInfo.type === 'pdf'
      ? base64ToDataUrl(body, 'application/pdf')
      : '';

  $: sizeBytes = Math.ceil(body.length * 3 / 4);

  function handleImageLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
    imageLoaded = true;
  }

  function handleImageError() {
    imageError = true;
  }

  async function downloadBinary() {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = getExtensionFromMime(contentType);
    a.download = `response${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function getExtensionFromMime(mime: string): string {
    const map: Record<string, string> = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
      'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
      'image/avif': '.avif', 'application/pdf': '.pdf', 'application/zip': '.zip',
      'application/gzip': '.gz',
    };
    return map[mime.toLowerCase().split(';')[0].trim()] || '';
  }
</script>

<div class="binary-preview">
  <div class="binary-header">
    <div class="binary-info">
      <span class="binary-type-badge">{typeInfo.label}</span>
      <span class="binary-mime">{contentType || 'unknown'}</span>
      <span class="binary-size">{formatBytes(sizeBytes)}</span>
      {#if imageLoaded}
        <span class="binary-dimensions">{naturalWidth} × {naturalHeight}</span>
      {/if}
    </div>
    <button class="download-btn" on:click={downloadBinary} title="Download file">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>
      Download
    </button>
  </div>

  <div class="binary-content">
    {#if typeInfo.type === 'image'}
      {#if imageError}
        <div class="binary-fallback">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
            <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2"/>
            <path d="M16 28l8-10 8 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="18" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
          </svg>
          <span>Unable to render image</span>
          <span class="binary-fallback-hint">The image data may be corrupted or in an unsupported format</span>
        </div>
      {:else}
        <div class="image-container">
          <img
            src={dataUrl}
            alt="Response preview"
            on:load={handleImageLoad}
            on:error={handleImageError}
            class="preview-image"
            class:loaded={imageLoaded}
          />
          {#if !imageLoaded}
            <div class="image-loading">Loading preview...</div>
          {/if}
        </div>
      {/if}
    {:else if typeInfo.type === 'pdf'}
      <div class="pdf-container">
        <object data={dataUrl} type="application/pdf" width="100%" height="100%" title="PDF Preview">
          <div class="binary-fallback">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
              <path d="M12 4h18l10 10v30H12V4z" stroke="currentColor" stroke-width="2"/>
              <path d="M30 4v10h10" stroke="currentColor" stroke-width="2"/>
              <text x="24" y="32" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5">PDF</text>
            </svg>
            <span>PDF preview not supported in this view</span>
            <span class="binary-fallback-hint">Use the download button to view the file</span>
          </div>
        </object>
      </div>
    {:else}
      <div class="binary-fallback">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
          <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" stroke-width="2"/>
          <line x1="15" y1="16" x2="33" y2="16" stroke="currentColor" stroke-width="2" opacity="0.5"/>
          <line x1="15" y1="22" x2="33" y2="22" stroke="currentColor" stroke-width="2" opacity="0.5"/>
          <line x1="15" y1="28" x2="28" y2="28" stroke="currentColor" stroke-width="2" opacity="0.5"/>
        </svg>
        <span>Binary response ({typeInfo.mimeType})</span>
        <span class="binary-fallback-hint">This content type cannot be previewed — download to view</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .binary-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .binary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-secondary, #2b2d31);
    border-bottom: 1px solid var(--border-color, #3e4045);
    flex-shrink: 0;
  }

  .binary-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #949ba4;
  }

  .binary-type-badge {
    padding: 2px 8px;
    background: rgba(88, 101, 242, 0.15);
    color: #8b9cf7;
    border-radius: 3px;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .binary-mime {
    font-family: monospace;
    color: #b0b0b0;
  }

  .binary-size {
    color: #72767d;
  }

  .binary-dimensions {
    color: #72767d;
  }

  .download-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: transparent;
    color: #949ba4;
    border: 1px solid #3e4045;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .download-btn:hover {
    background: #383a40;
    color: #e0e0e0;
    border-color: #4e5058;
  }

  .binary-content {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1e1f22;
  }

  .image-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    width: 100%;
    height: 100%;
  }

  .preview-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.3s ease;
    background: repeating-conic-gradient(#2a2b2e 0% 25%, #232427 0% 50%) 50% / 16px 16px;
  }

  .preview-image.loaded {
    opacity: 1;
  }

  .image-loading {
    position: absolute;
    color: #72767d;
    font-size: 13px;
  }

  .pdf-container {
    width: 100%;
    height: 100%;
    min-height: 400px;
  }

  .pdf-container object {
    border: none;
  }

  .binary-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px;
    color: #72767d;
    font-size: 14px;
  }

  .binary-fallback-hint {
    font-size: 12px;
    color: #4e5058;
  }
</style>
