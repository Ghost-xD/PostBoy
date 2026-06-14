export type HarImportEntry = {
  requestData: Record<string, unknown>;
  responseData: Record<string, unknown>;
};

export type HarImportResult = {
  entries: HarImportEntry[];
  errors: string[];
  skipped: number;
};

type HarHeader = { name?: string; value?: string };
type HarQueryParam = { name?: string; value?: string };
type HarPostData = { mimeType?: string; text?: string };
type HarRequest = {
  method?: string;
  url?: string;
  headers?: HarHeader[];
  queryString?: HarQueryParam[];
  postData?: HarPostData;
};
type HarResponse = {
  status?: number;
  headers?: HarHeader[];
  content?: { mimeType?: string; text?: string };
};
type HarEntry = { request?: HarRequest; response?: HarResponse; time?: number };
type HarDocument = { log?: { entries?: HarEntry[] } };

function harHeadersToObject(headers: HarHeader[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (header.name) out[header.name] = header.value ?? '';
  }
  return out;
}

function mimeToBodyType(mime: string | undefined): string {
  if (!mime) return 'none';
  const normalized = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalized === 'application/json' || normalized.endsWith('+json')) return 'json';
  if (normalized === 'application/x-www-form-urlencoded') return 'urlencoded';
  if (normalized.startsWith('multipart/form-data')) return 'formdata';
  if (normalized === 'text/xml' || normalized === 'application/xml') return 'xml';
  if (normalized.startsWith('text/')) return 'raw';
  return 'raw';
}

function queryStringToParams(queryString: HarQueryParam[] | undefined): Array<{ key: string; value: string }> {
  return (queryString ?? [])
    .filter((param) => param.name)
    .map((param) => ({ key: param.name!, value: param.value ?? '' }));
}

export function parseHarToHistoryEntries(har: unknown): HarImportResult {
  const errors: string[] = [];
  let skipped = 0;
  const entries: HarImportEntry[] = [];

  if (!har || typeof har !== 'object') {
    return { entries: [], errors: ['Invalid HAR: expected a JSON object'], skipped: 0 };
  }

  const doc = har as HarDocument;
  const rawEntries = doc.log?.entries;
  if (!Array.isArray(rawEntries)) {
    return { entries: [], errors: ['Invalid HAR: missing log.entries array'], skipped: 0 };
  }

  rawEntries.forEach((entry, index) => {
    const request = entry.request;
    const response = entry.response;
    if (!request?.url || !request.method) {
      skipped += 1;
      errors.push(`Entry ${index + 1}: missing request method or URL`);
      return;
    }

    const bodyText = request.postData?.text ?? '';
    const bodyType = bodyText ? mimeToBodyType(request.postData?.mimeType) : 'none';
    const responseBody = response?.content?.text ?? '';
    const responseHeaders = harHeadersToObject(response?.headers);

    entries.push({
      requestData: {
        method: request.method.toUpperCase(),
        url: request.url,
        headers: harHeadersToObject(request.headers),
        params: queryStringToParams(request.queryString),
        bodyType,
        bodyContent: bodyText,
        authType: 'none',
        authData: {},
      },
      responseData: {
        status: response?.status ?? 0,
        responseTime: Math.round(entry.time ?? 0),
        headers: responseHeaders,
        body: responseBody,
      },
    });
  });

  return { entries, errors, skipped };
}

/** Normalize `read_file` invoke result (`{ data: string }` or raw string) then parse HAR. */
export function parseHarFromFileReadResult(readResult: unknown): HarImportResult {
  const raw =
    typeof readResult === 'string'
      ? readResult
      : readResult && typeof readResult === 'object' && 'data' in readResult
        ? (readResult as { data: unknown }).data
        : null;

  if (raw == null || raw === '') {
    return { entries: [], errors: ['Empty or unreadable HAR file'], skipped: 0 };
  }

  let har: unknown;
  if (typeof raw === 'string') {
    try {
      har = JSON.parse(raw);
    } catch (error) {
      return {
        entries: [],
        errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
        skipped: 0,
      };
    }
  } else {
    har = raw;
  }

  return parseHarToHistoryEntries(har);
}
