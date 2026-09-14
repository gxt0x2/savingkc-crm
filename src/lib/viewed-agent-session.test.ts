/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readViewedAgentEmail,
  setViewedAgentEmail,
  subscribeToViewedAgentChange,
  viewedAgentStorageKey,
} from './viewed-agent-session'

describe('viewed agent session', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('persists the viewed workspace for the authenticated owner across tabs', () => {
    setViewedAgentEmail('CASEY@SAVINGKC.COM', 'ERNEST@SAVINGKC.COM')

    expect(window.localStorage.getItem(viewedAgentStorageKey('ernest@savingkc.com')))
      .toBe('casey@savingkc.com')
    window.sessionStorage.clear()
    expect(readViewedAgentEmail('ernest@savingkc.com')).toBe('casey@savingkc.com')
  })

  it('keeps viewed workspace choices isolated by authenticated actor', () => {
    setViewedAgentEmail('casey@savingkc.com', 'ernest@savingkc.com')

    expect(readViewedAgentEmail('other@savingkc.com')).toBe('other@savingkc.com')
  })

  it('continues an existing tab-scoped choice during the persistence migration', () => {
    window.sessionStorage.setItem('savingkc:viewed-agent-email', 'casey@savingkc.com')

    expect(readViewedAgentEmail('ernest@savingkc.com')).toBe('casey@savingkc.com')
  })

  it('notifies subscribers for same-tab and cross-tab changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToViewedAgentChange(listener)

    setViewedAgentEmail('casey@savingkc.com', 'ernest@savingkc.com')
    window.dispatchEvent(new StorageEvent('storage', {
      key: viewedAgentStorageKey('ernest@savingkc.com'),
      newValue: 'casey@savingkc.com',
    }))

    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
