import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  tabs,
  activeTabId,
  addTab,
  createDefaultTab,
} from './tabStore';

describe('tabStore addTab', () => {
  beforeEach(() => {
    tabs.set([createDefaultTab('1')]);
    activeTabId.set('1');
  });

  it('creates a blank tab without copying body, headers, params, or url from active tab', () => {
    tabs.set([
      {
        ...createDefaultTab('1'),
        name: 'Get sml token',
        method: 'POST',
        url: 'https://api.example.com/token',
        bodyContent: JSON.stringify({
          tenantName: 'p3-rmteam-npe-may2026',
          username: 'gaurav.saroha',
          password: 'secret',
        }),
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        params: [{ key: 'debug', value: '1' }],
        authType: 'bearer',
        authToken: 'old-token',
      },
    ]);
    activeTabId.set('1');

    const newTab = addTab();

    expect(newTab.bodyContent).toBe('');
    expect(newTab.headers).toEqual([{ key: '', value: '' }]);
    expect(newTab.params).toEqual([{ key: '', value: '' }]);
    expect(newTab.url).toBe('');
    expect(newTab.method).toBe('GET');
    expect(newTab.authType).toBe('none');
    expect(newTab.authToken).toBe('');
    expect(get(activeTabId)).toBe(newTab.id);

    const originalTab = get(tabs).find((tab) => tab.id === '1');
    expect(originalTab?.bodyContent).toContain('tenantName');
    expect(originalTab?.headers).toEqual([{ key: 'Content-Type', value: 'application/json' }]);
  });
});
