/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskWorklist } from './use-task-worklist'

describe('useTaskWorklist', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('requests one bounded server page and maps canonical items to task UI shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          key: 'activity:task-1', sourceKind: 'activity', sourceId: 'task-1', leadId: 'lead-1', tcFileId: null,
          kind: 'callback', title: 'Call seller', description: 'Confirm timing', status: 'blocked', priority: 'high',
          dueAt: '2026-08-22T15:00:00Z', assignedTo: 'Casey', department: 'acquisitions', role: null,
          primaryNextAction: true, version: 3, sourceCreatedAt: '2026-08-20T00:00:00Z', completedAt: null,
          updatedAt: '2026-08-21T00:00:00Z', contact: { id: 'lead-1', fullName: 'Michael Maddox', phone: null, email: null, propertyAddress: '123 Main St', city: 'Kansas City', state: 'MO', zip: null, station: 'contacted', createdAt: '2026-08-01T00:00:00Z' },
        }],
        counts: { all: 1, due_today: 0, overdue: 0, upcoming: 1, completed: 0 },
        laneCounts: { current: 1, review: 0, quarantine: 0, all: 1 },
        pageInfo: { limit: 20, total: 1, hasMore: false, nextCursor: null }, serverNow: '2026-08-21T15:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

    const { result } = renderHook(() => useTaskWorklist({ view: 'upcoming', assignee: 'Casey', limit: 20 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/worklist?view=upcoming&assignee=Casey&limit=20', { cache: 'no-store' })
    expect(result.current.data?.tasks[0]).toMatchObject({ id: 'activity:task-1', type: 'callback', status: 'pending', version: 3, property_address: '123 Main St', contact: { first_name: 'Michael', last_name: 'Maddox' } })
  })

  it('surfaces the server error without manufacturing an empty task list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Task worklist is unavailable.' }) }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useTaskWorklist({}), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ message: 'Task worklist is unavailable.' })
  })
})
