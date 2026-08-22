/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'
import { CampaignDeliveryPulse } from './campaign-delivery-pulse'

const campaign = {
  id: 'campaign-1', name: 'Absentee owners', kind: 'sms', status: 'active', ownerEmail: 'ernest@savingkc.com', ownerName: 'Ernest', callerId: null, fromPhone: '+18163077835', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1, 2, 3, 4, 5, 6], perHour: 75, perDay: 500, createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T11:00:00.000Z', activatedAt: '2026-08-21T11:00:00.000Z', pausedAt: null, completedAt: null,
  steps: [], members: [], stats: { total: 10, active: 8, suppressed: 2, replied: 0, completed: 0, sent: 3, delivered: 2, failed: 0 }, operations: { queued: 5, processing: 1, nextActionAt: '2026-08-22T14:00:00.000Z', lastSentAt: '2026-08-21T20:00:00.000Z' },
} satisfies ProspectingCampaignDetail

describe('CampaignDeliveryPulse', () => {
  it('shows the authoritative queue, in-flight work, and schedule', () => {
    render(<CampaignDeliveryPulse campaign={campaign} />)
    expect(screen.getByRole('heading', { name: 'Campaign is moving' })).toBeVisible()
    expect(screen.getByText('Queued').previousSibling).toHaveTextContent('5')
    expect(screen.getByText('In flight').previousSibling).toHaveTextContent('1')
    expect(screen.getByText('Delivered').previousSibling).toHaveTextContent('2')
    expect(screen.getByText(/Aug 22/)).toBeVisible()
  })

  it('makes terminal delivery failures impossible to miss', () => {
    render(<CampaignDeliveryPulse campaign={{ ...campaign, stats: { ...campaign.stats, failed: 2 }, operations: { ...campaign.operations, queued: 0, processing: 0 } }} />)
    expect(screen.getByRole('heading', { name: 'Delivery needs attention' })).toBeVisible()
    expect(screen.getByText('Failed').previousSibling).toHaveTextContent('2')
    expect(screen.getByText(/Carrier delivery failures stop/)).toBeVisible()
  })
})
