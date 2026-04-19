import { vi } from 'vitest';

// Mock Tauri APIs for unit tests
global.window = global.window || {};

// @ts-ignore
global.window.__TAURI__ = {
  invoke: vi.fn(),
  dialog: {
    open: vi.fn(),
    save: vi.fn()
  },
  fs: {
    readTextFile: vi.fn(),
    writeTextFile: vi.fn()
  }
};
