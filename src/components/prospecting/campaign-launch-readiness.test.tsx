/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'
import { CampaignLaunchReadiness } from './campaign-launch-readiness'

const campaign: ProspectingCampaignDetail = {
  id: 'campaign-1', name: 'August Absentee', kind: 'sms', status: 'draft', ownerEmail: 'ernest@savingkc.com', ownerName: 'Ernest', callerId: null, fromPhone: '+18163077835', defaultTimezone: 'America/Chicago', perHour: 75, perDay: 500, createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T11:00:00.000Z', activatedAt: null, pausedAt: null, completedAt: null,
  steps: [{ id: 'step-1', position: 1, delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}' }], members: [], stats: { total: 4, active: 3, suppressed: 1, replied: 0, completed: 0, sent: 0, failed: 0 },
}

describe('CampaignLaunchReadiness', () => {
  it('requires a second explicit confirmation and explains SMS automation', () => {
    const activate = vi.fn()
    render(<CampaignLaunchReadiness campaign={campaign} actionPending={false} onActivate={activate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review & activate' }))
    expect(screen.getByRole('dialog', { name: 'Activate August Absentee?' })).toBeVisible()
    expect(screen.getByText(/queue automated seller messages for 3 eligible contacts/)).toBeVisible()
    expect(activate).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review & activate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, activate campaign' }))
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('blocks activation until an eligible audience exists', () => {
    render(<CampaignLaunchReadiness campaign={{ ...campaign, stats: { ...campaign.stats, active: 0 } }} actionPending={false} onActivate={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '1 item needs attention' })).toBeVisible()
    expect(screen.getByText('Add at least one eligible seller')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review & activate' })).toBeDisabled()
  })

  it('makes clear that dialer activation never places an automatic call', () => {
    render(<CampaignLaunchReadiness campaign={{ ...campaign, kind: 'dialer', callerId: '+18163077835', fromPhone: null, steps: [] }} actionPending={false} onActivate={vi.fn()} />)
    expect(screen.getByText('No calls are placed automatically')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Review & activate' }))
    expect(screen.getByText(/It does not place a call automatically/)).toBeVisible()
  })
})
