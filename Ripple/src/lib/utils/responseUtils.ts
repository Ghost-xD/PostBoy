export const LARGE_RESPONSE_THRESHOLD = 200 * 1024; // 200KB
export const TRUNCATED_PREVIEW_SIZE = 50 * 1024;   // 50KB shown initially

export type ResponseBodyType = 'json' | 'html' | 'xml' | 'image' | 'pdf' | 'binary' | 'text';

export interface ResponseTypeInfo {
  type: ResponseBodyType;
  mimeType: string;
  label: string;
  previewable: boolean;
}

const MIME_MAPPINGS: Array<{ pattern: RegExp; type: ResponseBodyType; label: string; previewable: boolean }> = [
  { pattern: /^image\/(png|jpeg|jpg|gif|webp|svg\+xml|bmp|ico|x-icon|avif)/, type: 'image', label: 'Image', previewable: true },
  { pattern: /^application\/pdf/, type: 'pdf', label: 'PDF', previewable: true },
  { pattern: /^application\/json/, type: 'json', label: 'JSON', previewable: false },
  { pattern: /^text\/html/, type: 'html', label: 'HTML', previewable: false },
  { pattern: /^(text|application)\/(xml|xhtml\+xml)/, type: 'xml', label: 'XML', previewable: false },
  { pattern: /^(audio|video|font)\//, type: 'binary', label: 'Binary', previewable: false },
  { pattern: /^application\/(zip|gzip|octet-stream|wasm|protobuf)/, type: 'binary', label: 'Binary', previewable: false },
  { pattern: /^application\/vnd\./, type: 'binary', label: 'Binary', previewable: false },
];

export function detectResponseType(contentType: string, isBinary: boolean): ResponseTypeInfo {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();

  for (const mapping of MIME_MAPPINGS) {
    if (mapping.pattern.test(ct)) {
      return { type: mapping.type, mimeType: ct, label: mapping.label, previewable: mapping.previewable };
    }
  }

  if (isBinary) {
    return { type: 'binary', mimeType: ct || 'application/octet-stream', label: 'Binary', previewable: false };
  }

  return { type: 'text', mimeType: ct || 'text/plain', label: 'Text', previewable: false };
}

export function isResponseLarge(body: string): boolean {
  return body.length > LARGE_RESPONSE_THRESHOLD;
}

export function truncateResponse(body: string): { truncated: string; totalSize: number; isTruncated: boolean } {
  if (body.length <= LARGE_RESPONSE_THRESHOLD) {
    return { truncated: body, totalSize: body.length, isTruncated: false };
  }
  return { truncated: body.slice(0, TRUNCATED_PREVIEW_SIZE), totalSize: body.length, isTruncated: true };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function base64ToDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

export function getImageMimeType(contentType: string): string {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (ct.startsWith('image/')) return ct;
  return 'image/png';
}
