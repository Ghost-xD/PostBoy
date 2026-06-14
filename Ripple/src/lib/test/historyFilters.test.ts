import { describe, expect, it } from 'vitest';
import {
  filterHistoryItems,
  historyFiltersActive,
  matchesStatusFilter,
} from '$lib/utils/historyFilters';

describe('historyFilters', () => {
  const items = [
    { method: 'GET', url: 'https://api.example.com/users', status_code: 200 },
    { method: 'POST', url: 'https://api.example.com/users', status_code: 201 },
    { method: 'GET', url: 'https://api.example.com/missing', status_code: 404 },
    { method: 'WS', url: 'wss://echo.example.com', status_code: 101 },
    { method: 'GET', url: 'https://api.example.com/error', status_code: null },
  ];

  it('filters by status bucket', () => {
    expect(matchesStatusFilter(200, '2xx')).toBe(true);
    expect(matchesStatusFilter(404, '2xx')).toBe(false);
    expect(matchesStatusFilter(null, 'ERR')).toBe(true);
    expect(matchesStatusFilter(101, 'OK')).toBe(true);
  });

  it('filters by method and status together', () => {
    const filtered = filterHistoryItems(items, { method: 'GET', status: '2xx' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].url).toContain('/users');
  });

  it('filters by URL search', () => {
    const filtered = filterHistoryItems(items, { query: 'missing' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].status_code).toBe(404);
  });

  it('detects active filters', () => {
    expect(historyFiltersActive({})).toBe(false);
    expect(historyFiltersActive({ status: '4xx' })).toBe(true);
    expect(historyFiltersActive({ query: '  ' })).toBe(false);
    expect(historyFiltersActive({ query: 'api' })).toBe(true);
  });
});
