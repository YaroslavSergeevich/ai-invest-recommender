import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Node 25 exposes its own localStorage; use deterministic Web Storage in jsdom.
const data = new Map<string, string>();
const storage: Storage = {
  get length() {
    return data.size;
  },
  clear: () => data.clear(),
  key: (index) => [...data.keys()][index] ?? null,
  getItem: (key) => data.get(String(key)) ?? null,
  setItem: (key, value) => {
    data.set(String(key), String(value));
  },
  removeItem: (key) => {
    data.delete(String(key));
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

// Mock scrollIntoView for jsdom
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});
