import { describe, expect, it } from 'vitest'
import { buildConversationDecisionTags } from './conversation-tags'

describe('conversation decision tags', () => {
  it('surfaces durable motivation, situation, property, and risk signals', () => {
    expect(buildConversationDecisionTags({
      flags: { opportunityFlags: ['high_equity'], redFlags: ['tax_delinquent'] },
      situation: { type: ['inherited', 'repairs_needed'] },
    }, { motivation_score: 82 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'High motivation', category: 'Motivation' }),
      expect.objectContaining({ label: 'Inherited property', category: 'Seller situation' }),
      expect.objectContaining({ label: 'Needs repairs', category: 'Property' }),
      expect.objectContaining({ label: 'Tax delinquent', category: 'Risk' }),
      expect.objectContaining({ label: 'High equity', category: 'Opportunity' }),
    ]))
  })

  it('does not turn routing, stage, source, or machine artifacts into tags', () => {
    const tags = buildConversationDecisionTags({
      situation: { type: ['ivr_no_input', 'appointment_made', 'under_contract', 'unknown_machine_token'] },
    })
    expect(tags).toEqual([])
  })

  it('keeps concise human blockers as explicit blocker signals', () => {
    expect(buildConversationDecisionTags({
      situation: { blockers: ['Co-owner approval'] },
    })).toContainEqual(expect.objectContaining({
      label: 'Co Owner Approval',
      category: 'Blocker',
    }))
  })
})
