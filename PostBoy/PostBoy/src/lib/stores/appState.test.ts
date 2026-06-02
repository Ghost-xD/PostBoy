import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  tabs,
  activeTabId,
  collections,
  history,
  settings,
  addTab,
  removeTab,
  setActiveTab,
  updateTab,
  addCollection,
  removeCollection,
  updateCollection,
  addToHistory,
  clearHistory,
  updateSetting
} from './appState';

describe('App State Stores', () => {
  beforeEach(() => {
    // Reset stores before each test
    tabs.set([{ id: '1', name: 'New Request', method: 'GET', url: '' } as any]);
    activeTabId.set('1');
    collections.set([]);
    history.set([]);
    settings.set({});
  });

  describe('Tab Management', () => {
    it('should add a new tab', () => {
      addTab();
      const currentTabs = get(tabs);
      expect(currentTabs).toHaveLength(2);
      expect(currentTabs[1].name).toBe('New Request');
    });

    it('should remove a tab', () => {
      addTab();
      const tabsBeforeRemove = get(tabs);
      const tabIdToRemove = tabsBeforeRemove[1].id;
      
      removeTab(tabIdToRemove);
      const currentTabs = get(tabs);
      
      expect(currentTabs).toHaveLength(1);
      expect(currentTabs.find(t => t.id === tabIdToRemove)).toBeUndefined();
    });

    it('should not remove last tab — replaces with fresh blank tab', () => {
      const currentTabs = get(tabs);
      const oldId = currentTabs[0].id;
      removeTab(oldId);
      
      const newTabs = get(tabs);
      expect(newTabs).toHaveLength(1);
      expect(newTabs[0].id).not.toBe(oldId);
      expect(newTabs[0].name).toBe('New Request');
    });


    it('should set active tab', () => {
      addTab();
      const currentTabs = get(tabs);
      const newTabId = currentTabs[1].id;
      
      setActiveTab(newTabId);
      
      expect(get(activeTabId)).toBe(newTabId);
    });

    it('should update tab', () => {
      const currentTabs = get(tabs);
      const tabId = currentTabs[0].id;
      
      updateTab(tabId, {
        method: 'POST',
        url: 'https://api.test.com',
        name: 'Updated Request'
      });
      
      const updatedTabs = get(tabs);
      const updatedTab = updatedTabs.find(t => t.id === tabId);
      
      expect(updatedTab?.method).toBe('POST');
      expect(updatedTab?.url).toBe('https://api.test.com');
      expect(updatedTab?.name).toBe('Updated Request');
    });

    it('should not modify other tabs when updating by id', () => {
      addTab();
      const allTabs = get(tabs);
      const firstId = allTabs[0].id;
      const secondId = allTabs[1].id;

      updateTab(secondId, { method: 'DELETE', url: '/remove' });

      const result = get(tabs);
      expect(result.find(t => t.id === firstId)?.method).toBe('GET');
      expect(result.find(t => t.id === secondId)?.method).toBe('DELETE');
    });
  });

  describe('Collection Management', () => {
    it('should add collection', () => {
      const collection = {
        id: 1,
        name: 'Test Collection',
        description: 'Test',
        requests: []
      };
      
      addCollection(collection);
      const currentCollections = get(collections);
      
      expect(currentCollections).toHaveLength(1);
      expect(currentCollections[0]).toEqual(collection);
    });

    it('should remove collection', () => {
      const collection = {
        id: 1,
        name: 'Test Collection',
        description: 'Test',
        requests: []
      };
      
      addCollection(collection);
      removeCollection(1);
      
      expect(get(collections)).toHaveLength(0);
    });

    it('should update collection', () => {
      const collection = {
        id: 1,
        name: 'Test Collection',
        description: 'Test',
        requests: []
      };
      
      addCollection(collection);
      updateCollection(1, { name: 'Updated Collection' });
      
      const currentCollections = get(collections);
      expect(currentCollections[0].name).toBe('Updated Collection');
    });

    it('should not modify other collections when updating by id', () => {
      addCollection({ id: 1, name: 'First', description: '', requests: [] });
      addCollection({ id: 2, name: 'Second', description: '', requests: [] });

      updateCollection(2, { name: 'Updated Second' });

      const result = get(collections);
      expect(result[0].name).toBe('First');
      expect(result[1].name).toBe('Updated Second');
    });
  });

  describe('History Management', () => {
    it('should add to history', () => {
      const historyItem = {
        id: 1,
        method: 'GET',
        url: 'https://api.test.com',
        status: 200,
        responseTime: 150,
        timestamp: Date.now()
      };
      
      addToHistory(historyItem);
      const currentHistory = get(history);
      
      expect(currentHistory).toHaveLength(1);
      expect(currentHistory[0]).toEqual(historyItem);
    });

    it('should clear history', () => {
      const historyItem = {
        id: 1,
        method: 'GET',
        url: 'https://api.test.com',
        status: 200,
        responseTime: 150,
        timestamp: Date.now()
      };
      
      addToHistory(historyItem);
      clearHistory();
      
      expect(get(history)).toHaveLength(0);
    });

    it('should limit history to 100 items', () => {
      for (let i = 0; i < 150; i++) {
        addToHistory({
          id: i,
          method: 'GET',
          url: `https://api.test.com/${i}`,
          status: 200,
          responseTime: 150,
          timestamp: Date.now()
        });
      }
      
      const currentHistory = get(history);
      expect(currentHistory).toHaveLength(100);
    });
  });

  describe('Settings Management', () => {
    it('should update setting', () => {
      updateSetting('theme', 'dark');
      const currentSettings = get(settings);
      
      expect(currentSettings.theme).toBe('dark');
    });

    it('should update multiple settings', () => {
      updateSetting('theme', 'dark');
      updateSetting('fontSize', '14px');
      
      const currentSettings = get(settings);
      
      expect(currentSettings.theme).toBe('dark');
      expect(currentSettings.fontSize).toBe('14px');
    });
  });
});
