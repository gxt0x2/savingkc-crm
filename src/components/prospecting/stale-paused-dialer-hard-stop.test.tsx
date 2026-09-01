/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StalePausedDialerHardStop } from '@/lib/dialer-stale-paused-session'
import { StalePausedDialerHardStopBanner } from './stale-paused-dialer-hard-stop'

vi.mock('@/components/feedback/feedback-form', () => ({
  FeedbackForm: ({ onClose, onSubmit }: { onClose: () => void; onSubmit: () => void }) => (
    <div>
      <p>Andon form</p>
      <button type="button" onClick={onSubmit}>Submit Andon</button>
      <button type="button" onClick={onClose}>Close Andon</button>
    </div>
  ),
}))

const hardStop: StalePausedDialerHardStop = {
  code: 'stale_paused_session_blocks_start',
  sessionId: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
  campaignId: '74609ed4-7e26-4111-b626-b2e3f68efa0b',
  campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
  actorEmail: 'ernest@savingkc.com',
  actorName: 'Ernest A. Dodson III',
  status: 'paused',
  pausedAt: '2026-09-01T16:55:40.491Z',
  startedAt: '2026-08-31T12:53:54.838Z',
  attemptCountToday: 0,
  reasons: ['zero_attempts_today'],
  cannotStartNew: true,
  andonCapable: true,
}

describe('StalePausedDialerHardStopBanner', () => {
  it('shows an Andon-capable hard stop and keeps preview from clearing', async () => {
    render(<StalePausedDialerHardStopBanner hardStop={hardStop} canClear={false} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot start a new session')
    expect(screen.getByRole('alert')).toHaveTextContent('0 attempts today')
    expect(screen.getByRole('button', { name: 'Raise Andon' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Clear stuck session' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Raise Andon' }))
    expect(await screen.findByText('Andon form')).toBeVisible()
  })

  it('lets acquisitions clear the wedged paused row without Resume', () => {
    const onClear = vi.fn()
    render(<StalePausedDialerHardStopBanner hardStop={hardStop} canClear onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear stuck session' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /Resume/ })).not.toBeInTheDocument()
  })
})
