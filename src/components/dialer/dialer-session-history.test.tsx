/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadDialerAttemptHistory: vi.fn(),
  loadDialerSessionHistory: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('@/lib/dialer-session-client', () => ({
  loadDialerAttemptHistory: mocks.loadDialerAttemptHistory,
  loadDialerSessionHistory: mocks.loadDialerSessionHistory,
}))

import { DialerSessionHistory } from './dialer-session-history'

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    status: 'paused',
    actorEmail: 'casey@savingkc.com',
    agentName: 'Casey',
    queueKey: 'cold_prospecting',
    savedQueueId: null,
    leadIds: ['00000000-0000-4000-8000-000000000001'],
    queueSize: 1,
    currentIndex: 0,
    currentLeadId: '00000000-0000-4000-8000-000000000001',
    callerId: '+18167277667',
    dialsCompleted: 2,
    contacts: 1,
    skips: 0,
    outcomes: { answered: 1, no_answer: 1 },
    startedAt: '2026-08-21T14:00:00.000Z',
    pausedAt: '2026-08-21T14:15:00.000Z',
    endedAt: null,
    updatedAt: '2026-08-21T14:15:00.000Z',
    ...overrides,
  }
}

describe('DialerSessionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadDialerSessionHistory.mockResolvedValue({
      items: [session(), session({ id: '00000000-0000-4000-8000-000000000020', status: 'completed', dialsCompleted: 4, contacts: 2 })],
      pageInfo: { limit: 20, hasMore: false, nextCursor: null },
    })
    mocks.loadDialerAttemptHistory.mockResolvedValue({
      session: session(),
      attempts: {
        items: [{
          id: '00000000-0000-4000-8000-000000000030',
          lead_id: '00000000-0000-4000-8000-000000000001',
          phone: '+18165550123',
          caller_id: '+18167277667',
          status: 'dispositioned',
          disposition: 'answered',
          duration_seconds: 125,
          reached: true,
          started_at: '2026-08-21T14:00:00.000Z',
          connected_at: '2026-08-21T14:00:05.000Z',
          ended_at: '2026-08-21T14:02:05.000Z',
          dispositioned_at: '2026-08-21T14:02:20.000Z',
          created_at: '2026-08-21T14:00:00.000Z',
          updated_at: '2026-08-21T14:02:20.000Z',
          leadName: 'Helen Seller',
          propertyAddress: '123 Main St',
        }],
        pageInfo: { limit: 50, hasMore: false, nextCursor: null },
      },
    })
  })

  it('shows actor-owned open and completed session metrics and resumes the durable record', async () => {
    const onResume = vi.fn()
    render(<DialerSessionHistory onResume={onResume} onOpenQueue={vi.fn()} />)

    expect(await screen.findByText('Active and paused')).toBeVisible()
    expect(screen.getByText('Recent history')).toBeVisible()
    expect(screen.getAllByText('contact rate', { exact: false })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }))
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ status: 'paused' }))
  })

  it('loads attempt detail only after the user opens a session', async () => {
    render(<DialerSessionHistory onResume={vi.fn()} onOpenQueue={vi.fn()} />)
    await screen.findByText('Active and paused')
    expect(mocks.loadDialerAttemptHistory).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'View calls' })[0])

    expect(await screen.findByText('Helen Seller')).toBeVisible()
    expect(screen.getByText(/123 Main St · Aug 21,/)).toBeVisible()
    expect(screen.getByText('2m 5s')).toBeVisible()
    await waitFor(() => expect(mocks.loadDialerAttemptHistory).toHaveBeenCalledTimes(1))
  })
})
