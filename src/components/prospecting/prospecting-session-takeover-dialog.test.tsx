/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DialerSessionControlSummary } from '@/lib/dialer-session-client'
import { ProspectingSessionTakeoverDialog } from './prospecting-session-takeover-dialog'

const summary: DialerSessionControlSummary = {
  sessionId: '00000000-0000-4000-8000-000000000010',
  campaignId: '11111111-1111-4111-8111-111111111111',
  campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
  status: 'paused',
  currentIndex: 17,
  queueSize: 166,
  controllerLabel: 'Safari on Casey’s Mac',
  heartbeatAt: '2026-08-31T20:00:00.000Z',
  leaseExpiresAt: '2026-08-31T20:00:45.000Z',
  generation: 4,
  stale: false,
  attemptStatus: null,
  operationActive: false,
  operationLabel: null,
  operationExpiresAt: null,
  canTakeOver: true,
}

describe('ProspectingSessionTakeoverDialog', () => {
  it('shows the preserved campaign, seller position, phase, and controlling device', () => {
    render(<ProspectingSessionTakeoverDialog
      summary={summary}
      selectedCampaignName="Deceased owners"
      busy={false}
      onCancel={vi.fn()}
      onContinue={vi.fn()}
    />)

    expect(screen.getByRole('alertdialog', { name: 'Continue this dialing session here?' })).toBeVisible()
    expect(screen.getAllByText(summary.campaignName).length).toBeGreaterThan(0)
    expect(screen.getByText('Seller 18 of 166')).toBeVisible()
    expect(screen.getByText('Paused')).toBeVisible()
    expect(screen.getByText('Safari on Casey’s Mac')).toBeVisible()
    expect(screen.getByText(/The selected campaign will not start/)).toHaveTextContent(summary.campaignName)
  })

  it('keeps Cancel and Continue as explicit separate decisions', () => {
    const onCancel = vi.fn()
    const onContinue = vi.fn()
    render(<ProspectingSessionTakeoverDialog
      summary={summary}
      selectedCampaignName={summary.campaignName}
      busy={false}
      onCancel={onCancel}
      onContinue={onContinue}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onContinue).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue here' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('blocks transfer while a live call still owns the session', () => {
    const onContinue = vi.fn()
    render(<ProspectingSessionTakeoverDialog
      summary={{ ...summary, status: 'active', attemptStatus: 'connected', canTakeOver: false }}
      busy={false}
      onCancel={vi.fn()}
      onContinue={onContinue}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('Finish the active call in the other window')
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onContinue).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('waits for an in-flight CRM write before transferring control', () => {
    render(<ProspectingSessionTakeoverDialog
      summary={{
        ...summary,
        operationActive: true,
        operationLabel: 'Saving contact note',
        operationExpiresAt: '2026-08-31T20:05:00.000Z',
        canTakeOver: false,
      }}
      busy={false}
      onCancel={vi.fn()}
      onContinue={vi.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('Saving contact note is still saving in the other window')
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
  })
})
