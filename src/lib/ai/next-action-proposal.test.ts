import { describe, expect, it } from 'vitest'
import {
  buildNextActionEvidence,
  nextActionProposalPrompt,
  normalizeNextActionProposal,
  proposalSources,
} from './next-action-proposal'

const LEAD_ID = '10000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-21T15:00:00.000Z')

function snapshot() {
  return {
    record: {
      lead: {
        id: LEAD_ID,
        full_name: 'Seller Example',
        property_address: '123 Main St',
        station: 'lead',
        assigned_agent: 'Casey',
        updated_at: '2026-08-21T14:00:00.000Z',
        crmUrl: `https://crm.savingkc.com/leads/${LEAD_ID}`,
      },
      activities: [{
        id: '20000000-0000-4000-8000-000000000001',
        activity_type: 'call',
        description: 'Seller asked for a callback after speaking with her brother.',
        metadata: { outcome: 'spoke_with_owner', summary: 'Call Monday afternoon.' },
        created_at: '2026-08-21T13:00:00.000Z',
      }],
      appointments: [],
      transactionCoordination: [],
    },
  }
}

describe('AI next-action proposal evidence', () => {
  it('builds a bounded evidence catalog with server-owned CRM URLs', () => {
    const evidence = buildNextActionEvidence(snapshot())
    expect(evidence).toHaveLength(2)
    expect(evidence.map((item) => item.id)).toEqual([
      `lead:${LEAD_ID}`,
      'activity:20000000-0000-4000-8000-000000000001',
    ])
    expect(nextActionProposalPrompt(evidence, NOW)).toContain('Verified CRM evidence')
    expect(nextActionProposalPrompt(evidence, NOW)).toContain('America/Chicago')
  })

  it('rejects invented citations and due dates outside the governed window', () => {
    const evidence = buildNextActionEvidence(snapshot())
    const base = {
      kind: 'callback',
      title: 'Call seller after family review',
      notes: 'Ask whether the family review changed the seller timeline and record the decision.',
      dueAt: '2026-08-24T18:00:00.000Z',
      rationale: 'The seller explicitly asked for a callback after speaking with family.',
      confidence: 'high',
      evidenceIds: ['activity:invented'],
    }
    expect(() => normalizeNextActionProposal(base, evidence, NOW)).toThrow('verified CRM record')
    expect(() => normalizeNextActionProposal({ ...base, evidenceIds: [evidence[1].id], dueAt: '2027-01-01T18:00:00.000Z' }, evidence, NOW)).toThrow('45-day')
  })

  it('returns only verified citations and canonicalizes the due date', () => {
    const evidence = buildNextActionEvidence(snapshot())
    const proposal = normalizeNextActionProposal({
      kind: 'callback',
      title: 'Call seller after family review',
      notes: 'Ask whether the family review changed the seller timeline and record the decision.',
      dueAt: '2026-08-24T13:00:00-05:00',
      rationale: 'The seller explicitly asked for a callback after speaking with family.',
      confidence: 'high',
      evidenceIds: [evidence[1].id, evidence[1].id],
    }, evidence, NOW)
    expect(proposal.dueAt).toBe('2026-08-24T18:00:00.000Z')
    expect(proposal.evidenceIds).toEqual([evidence[1].id])
    expect(proposalSources(proposal, evidence)).toEqual([
      expect.objectContaining({ name: 'call activity', url: expect.stringContaining(`/leads/${LEAD_ID}`) }),
    ])
  })
})
