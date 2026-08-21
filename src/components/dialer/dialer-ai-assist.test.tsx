/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialerAiAssist } from './dialer-ai-assist'

describe('DialerAiAssist', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads one inert session-owned snapshot and labels stale AI context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ brief: {
      leadId: 'lead-1', snapshotAt: '2026-08-21T16:00:00Z',
      contact: { name: 'Seller One', address: '1 Main St', station: 'contacted', priority: 'high' },
      objective: { title: 'Confirm price floor', description: null, dueAt: null, kind: 'callback', source: 'work_item' },
      aiBriefing: { situation: 'Inherited property.', motivation: 'Ready soon.', strategy: 'Confirm price.', generatedAt: '2026-08-20T16:00:00Z', freshness: 'stale' },
      facts: [{ label: 'Motivation', value: '7/10' }], questions: ['What price would make selling worthwhile?'], coOwners: [],
      recentEvidence: [{ id: 'activity-1', kind: 'message', direction: 'inbound', summary: 'Can you call tomorrow?', createdAt: '2026-08-21T15:00:00Z' }], sourceRowCount: 4,
    } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<DialerAiAssist sessionId="session-1" leadId="lead-1" />)

    expect(await screen.findByText('Confirm price floor')).toBeVisible()
    expect(screen.getByText('Newer activity exists')).toBeVisible()
    expect(screen.getByText('What price would make selling worthwhile?')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/dialer/sessions/session-1/pre-call-brief', expect.objectContaining({ cache: 'no-store' }))
  })
})
