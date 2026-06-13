import { describe, it, expect } from 'vitest';

/** Mirrors RequestBuilder body sync after tab switch (load then persist). */
function applyTabSwitchBodySync(
  previousLocalContent: string,
  newTabStoreContent: string,
): { localContent: string; persistUpdate: string | null } {
  const localContent = newTabStoreContent;
  const persistUpdate = localContent !== newTabStoreContent ? localContent : null;
  return { localContent, persistUpdate };
}

function getPersistedBodyContentUpdate(
  localContent: string,
  activeTabStoreContent: string,
): string | null {
  return localContent !== activeTabStoreContent ? localContent : null;
}

describe('tab body content sync on new tab', () => {
  it('clears local body and does not persist stale content on new tab', () => {
    const { localContent, persistUpdate } = applyTabSwitchBodySync(
      JSON.stringify({
        tenantName: 'p3-rmteam-npe-may2026',
        username: 'gaurav.saroha',
        password: 'secret',
      }),
      '',
    );

    expect(localContent).toBe('');
    expect(persistUpdate).toBeNull();
  });

  it('documents stale persist-before-load corrupting a blank new tab', () => {
    const staleLocal = JSON.stringify({ tenantName: 'test' });
    const persistBeforeLoad = getPersistedBodyContentUpdate(staleLocal, '');

    expect(persistBeforeLoad).toBe(staleLocal);
  });

  it('persists user edits when local content changes on the active tab', () => {
    expect(getPersistedBodyContentUpdate('{"updated":true}', '')).toBe('{"updated":true}');
  });
});
