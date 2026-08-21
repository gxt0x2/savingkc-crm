/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadDialerAttemptHistory: vi.fn(),
  loadDialerSessionHistory: vi.fn(),
  decideDialerAiChanges: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('@/lib/dialer-session-client', () => ({
  loadDialerAttemptHistory: mocks.loadDialerAttemptHistory,
  loadDialerSessionHistory: mocks.loadDialerSessionHistory,
  decideDialerAiChanges: mocks.decideDialerAiChanges,
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
    mocks.decideDialerAiChanges.mockResolvedValue({
      id: 'proposal-1',
      status: 'applied',
      summary: 'Review extracted seller details.',
      changes: [{ field: 'motivation_score', label: 'Motivation score', before: 4, proposed: 8 }],
      decidedBy: 'Casey',
      decisionNote: null,
      decidedAt: '2026-08-21T14:04:00.000Z',
      appliedAt: '2026-08-21T14:04:00.000Z',
      errorCode: null,
    })
    mocks.loadDialerAttemptHistory.mockResolvedValue({
      session: session(),
      attempts: {
        items: [{
          id: '00000000-0000-4000-8000-000000000030',
          client_attempt_id: 'attempt-1',
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
          postCallReview: {
            status: 'ready',
            summary: 'Seller wants to move before October and asked for a Friday follow-up.',
            sentiment: 'positive',
            motivationScore: 8,
            nextAction: 'Call Friday',
            nextActionAt: null,
            strengths: ['Clarified timeline'],
            improvements: ['Confirm all decision makers'],
            recordingSid: 'RE123',
            providerCallSid: 'CA123',
            completedAt: '2026-08-21T14:03:00.000Z',
            updatedAt: '2026-08-21T14:03:00.000Z',
            failureCode: null,
            changeProposal: {
              id: 'proposal-1',
              status: 'proposed',
              summary: 'Review extracted seller details.',
              changes: [{ field: 'motivation_score', label: 'Motivation score', before: 4, proposed: 8 }],
              decidedBy: null,
              decisionNote: null,
              decidedAt: null,
              appliedAt: null,
              errorCode: null,
            },
          },
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
    expect(screen.getByText('Post-call AI review')).toBeVisible()
    expect(screen.getByText(/Seller wants to move before October/)).toBeVisible()
    expect(screen.getByText(/Confirm the summary/)).toBeVisible()
    await waitFor(() => expect(mocks.loadDialerAttemptHistory).toHaveBeenCalledTimes(1))
  })

  it('keeps proposed CRM changes inert until the session owner approves them', async () => {
    render(<DialerSessionHistory onResume={vi.fn()} onOpenQueue={vi.fn()} />)
    await screen.findByText('Active and paused')
    fireEvent.click(screen.getAllByRole('button', { name: 'View calls' })[0])

    expect(await screen.findByText('AI-proposed CRM changes')).toBeVisible()
    expect(screen.getByText('Nothing below changes until you approve it.')).toBeVisible()
    expect(mocks.decideDialerAiChanges).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Approve & apply' }))
    await waitFor(() => expect(mocks.decideDialerAiChanges).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: '00000000-0000-4000-8000-000000000010',
      clientAttemptId: 'attempt-1',
      decision: 'approved',
      decisionKey: 'dialer-ai:proposal-1:approved',
    })))
    expect(await screen.findByText('Reviewed and applied by Casey.')).toBeVisible()
  })
})
