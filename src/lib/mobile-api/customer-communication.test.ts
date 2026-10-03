import { describe, expect, it } from 'vitest'
import { isMobileCustomerActivity } from './customer-communication'

describe('canonical customer communication exclusions', () => {
  it('excludes operational directions, queue/recipient metadata and true flags', () => {
    for (const metadata of [{ direction: 'outbound-alert' }, { direction: 'internal' }, { direction: 'team_alert' }, { to_agents: [] }, { to_agent_phones: [] }, { queue_contract: null }, { is_team: true }, { is_internal: 'TRUE' }, { internal_alert: true }, { team_alert: true }]) {
      expect(isMobileCustomerActivity({ activity_type: 'sms', metadata })).toBe(false)
    }
  })
  it('uses the canonical narrow legacy alert signature without dropping ordinary seller text', () => {
    const description = 'Seller just texted: "Call me" — https://crm.savingkc.com/leads/123'
    expect(isMobileCustomerActivity({ activity_type: 'sms', description })).toBe(false)
    expect(isMobileCustomerActivity({ activity_type: 'sms', description, metadata: { direction: 'received' } })).toBe(true)
    expect(isMobileCustomerActivity({ activity_type: 'sms', description, metadata: { is_internal: false } })).toBe(true)
    expect(isMobileCustomerActivity({ activity_type: 'sms', description: 'I just texted my son' })).toBe(true)
  })
})
