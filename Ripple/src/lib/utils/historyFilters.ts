import { isHistorySuccessStatus } from '$lib/utils/streamHistory';

export type StatusFilter = 'ALL' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'OK' | 'ERR';

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All status' },
  { value: 'OK', label: 'Success (2xx/101)' },
  { value: 'ERR', label: 'Error / failed' },
  { value: '1xx', label: '1xx' },
  { value: '2xx', label: '2xx' },
  { value: '3xx', label: '3xx' },
  { value: '4xx', label: '4xx' },
  { value: '5xx', label: '5xx+' },
];

export const METHOD_FILTER_OPTIONS = [
  'ALL',
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
  'WS',
  'WSS',
  'SSE',
  'GRPC',
] as const;

export type MethodFilter = (typeof METHOD_FILTER_OPTIONS)[number];

export function matchesStatusFilter(
  statusCode: number | null | undefined,
  filter: StatusFilter
): boolean {
  if (filter === 'ALL') return true;
  if (statusCode == null) return filter === 'ERR';
  if (filter === 'OK') return isHistorySuccessStatus(statusCode);
  if (filter === 'ERR') return !isHistorySuccessStatus(statusCode);

  const hundred = Math.floor(statusCode / 100);
  switch (filter) {
    case '1xx':
      return hundred === 1;
    case '2xx':
      return hundred === 2;
    case '3xx':
      return hundred === 3;
    case '4xx':
      return hundred === 4;
    case '5xx':
      return hundred >= 5;
    default:
      return true;
  }
}

export function matchesMethodFilter(method: string | undefined, filter: MethodFilter): boolean {
  if (filter === 'ALL') return true;
  return (method ?? '').toUpperCase() === filter;
}

export function matchesHistorySearch(url: string | undefined, query: string): boolean {
  if (!query.trim()) return true;
  return (url ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

export function filterHistoryItems<
  T extends { method?: string; url?: string; status_code?: number | null; status?: number | null }
>(
  items: T[],
  options: { query?: string; method?: MethodFilter; status?: StatusFilter }
): T[] {
  const query = options.query ?? '';
  const method = options.method ?? 'ALL';
  const status = options.status ?? 'ALL';

  return items.filter((item) => {
    const statusCode = item.status_code ?? item.status ?? null;
    return (
      matchesHistorySearch(item.url, query) &&
      matchesMethodFilter(item.method, method) &&
      matchesStatusFilter(statusCode, status)
    );
  });
}

export function historyFiltersActive(options: {
  query?: string;
  method?: MethodFilter;
  status?: StatusFilter;
}): boolean {
  return !!(
    options.query?.trim() ||
    (options.method && options.method !== 'ALL') ||
    (options.status && options.status !== 'ALL')
  );
}
