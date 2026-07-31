import { describe, expect, it } from 'vitest'

import {
  buildAcquisitionsReport,
  filterAcquisitionContacts,
  type AcquisitionContact,
  type AcquisitionThread,
} from './acquisitions-report'

const contacts: AcquisitionContact[] = [
  { id: 'new', station: 'new', score: 20, isFavorite: false, source: 'google_ads', phone: '8165551000', email: null, createdAt: '2026-07-20T12:00:00Z', firstOutboundAt: '2026-07-20T12:10:00Z', lastContactAt: null },
  { id: 'qualified', station: 'qualified', score: 82, isFavorite: false, source: 'google_ads', phone: null, email: 'seller@example.com', createdAt: '2026-04-01T12:00:00Z', firstOutboundAt: '2026-04-01T12:20:00Z', lastContactAt: '2026-07-01T12:00:00Z' },
  { id: 'contract', station: 'under_contract', score: 70, isFavorite: true, source: 'referral', phone: '8165552000', email: 'owner@example.com', createdAt: '2026-01-05T12:00:00Z', firstOutboundAt: null, lastContactAt: '2026-07-29T12:00:00Z' },
]

const threads: AcquisitionThread[] = [
  { id: 'new', attentionState: 'needs_reply', owner: null, lastActivityAt: null, primaryNextAction: null },
  { id: 'qualified', attentionState: 'waiting_on_contact', owner: 'Casey', lastActivityAt: '2026-07-01T12:00:00Z', primaryNextAction: { overdue: true } },
  { id: 'contract', attentionState: 'resolved', owner: 'Ernest', lastActivityAt: '2026-07-29T12:00:00Z', primaryNextAction: { overdue: false } },
]

describe('buildAcquisitionsReport', () => {
  it('builds cumulative funnel, attention, source, and data-quality metrics', () => {
    const report = buildAcquisitionsReport(contacts, threads, new Date('2026-07-31T12:00:00Z'))

    expect(report.stages.map((stage) => stage.value)).toEqual([3, 2, 1, 1, 1, 0])
    expect(report.attention).toEqual({ needsReply: 1, overdue: 1, unassigned: 1, hot: 2, stale: 1 })
    expect(report.dataQuality).toMatchObject({ missingPhone: 1, missingEmail: 1, noActivity: 1, missingNextAction: 1 })
    expect(report.averageSpeedToLeadMinutes).toBe(15)
    expect(report.sources[0]).toMatchObject({ source: 'google_ads', leads: 2, qualified: 1 })
    expect(report.bottleneck.label).toBe('Closed')
  })

  it('filters contacts by operational reporting period', () => {
    const now = new Date('2026-07-31T12:00:00Z')

    expect(filterAcquisitionContacts(contacts, '30d', now).map((contact) => contact.id)).toEqual(['new'])
    expect(filterAcquisitionContacts(contacts, 'quarter', now).map((contact) => contact.id)).toEqual(['new'])
    expect(filterAcquisitionContacts(contacts, 'ytd', now)).toHaveLength(3)
    expect(filterAcquisitionContacts(contacts, 'all', now)).toBe(contacts)
  })
})
