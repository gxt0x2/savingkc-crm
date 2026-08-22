/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'
import { CampaignAudienceReview } from './campaign-audience-review'

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }))

const campaign = {
  id: '11111111-1111-4111-8111-111111111111', name: 'August Absentee', kind: 'dialer', status: 'draft', ownerEmail: 'ernest@savingkc.com', ownerName: 'Ernest', callerId: '+18165550101', fromPhone: null, defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1, 2, 3, 4, 5, 6], perHour: 75, perDay: 500, createdAt: '2026-08-21T10:00:00Z', updatedAt: '2026-08-21T10:00:00Z', activatedAt: null, pausedAt: null, completedAt: null, steps: [], members: [], stats: { total: 0, active: 0, suppressed: 0, replied: 0, completed: 0, sent: 0, delivered: 0, failed: 0 }, operations: { queued: 0, processing: 0, nextActionAt: null, lastSentAt: null },
} satisfies ProspectingCampaignDetail

describe('CampaignAudienceReview', () => {
  it('shows the target and confirms a selected audience without activating it', () => {
    const confirm = vi.fn()
    render(<CampaignAudienceReview campaign={campaign} pendingCount={3} saving={false} onConfirm={confirm} onCancel={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Add the right sellers—not just a list.' })).toBeVisible()
    expect(screen.getByText('August Absentee')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 to campaign' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByText('Enrollment does not send messages or place calls.')).toBeVisible()
  })

  it('locks the confirmation when the campaign is active', () => {
    render(<CampaignAudienceReview campaign={{ ...campaign, status: 'active' }} pendingCount={3} saving={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Add 3 to campaign' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Pause this campaign')
  })
})
