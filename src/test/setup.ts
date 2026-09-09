import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Next resolves this marker during application builds. Vitest executes modules
// directly, so replace the marker package with its no-op server condition.
vi.mock('server-only', () => ({}))

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

// Node 25 exposes an incomplete global localStorage unless a backing file is
// configured. Keep jsdom tests deterministic when that experimental global is
// inherited by the test environment.
if (typeof window !== 'undefined') {
  if (typeof window.localStorage?.clear !== 'function') {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
  }
  if (typeof window.sessionStorage?.clear !== 'function') {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memoryStorage() })
  }
}

afterEach(() => {
  cleanup()
})
