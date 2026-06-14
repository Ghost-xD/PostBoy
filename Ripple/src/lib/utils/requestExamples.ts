export interface StoredRequestExample {
  id?: number;
  name: string;
  status_code?: number | null;
  response_time?: number | null;
  response_headers?: string | null;
  response_body?: string | null;
}

export interface ExampleResponsePayload {
  statusCode: number;
  responseTime: number | null;
  responseHeaders: string;
  responseBody: string;
}

export interface ExampleTabUpdates {
  responseStatus: number | null;
  responseStatusText: string;
  responseTime: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
}

/** Build the DB payload for createRequestExample from a live response. */
export function buildExamplePayloadFromResponse(params: {
  responseStatus: number | null;
  responseTime: number | null | undefined;
  responseHeaders: Record<string, string> | string;
  responseBody: string | unknown;
}): ExampleResponsePayload | null {
  if (params.responseStatus == null) return null;

  return {
    statusCode: params.responseStatus,
    responseTime: params.responseTime ?? null,
    responseHeaders:
      typeof params.responseHeaders === 'string'
        ? params.responseHeaders
        : JSON.stringify(params.responseHeaders ?? {}),
    responseBody:
      typeof params.responseBody === 'string'
        ? params.responseBody
        : JSON.stringify(params.responseBody ?? ''),
  };
}

/** Parse a stored example row into tab response fields. */
export function exampleToTabUpdates(example: StoredRequestExample): ExampleTabUpdates {
  let responseHeaders: Record<string, string> = {};
  if (example.response_headers) {
    try {
      responseHeaders = JSON.parse(example.response_headers);
    } catch {
      responseHeaders = {};
    }
  }

  let responseBody = example.response_body ?? '';
  if (typeof responseBody === 'string' && responseBody.startsWith('"') && responseBody.endsWith('"')) {
    try {
      responseBody = JSON.parse(responseBody);
    } catch {
      /* keep raw string */
    }
  }

  return {
    responseStatus: example.status_code ?? null,
    responseStatusText: '',
    responseTime: example.response_time ?? 0,
    responseHeaders,
    responseBody,
  };
}

export function canSaveRequestExample(requestId: number | undefined, responseStatus: number | null): boolean {
  return !!requestId && responseStatus != null;
}
