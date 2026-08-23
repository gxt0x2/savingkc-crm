import { describe, expect, it } from 'vitest'
import { buildLeadActivityInsert } from './lead-activity-command'

describe('lead activity command boundary', () => {
  it('builds an internal note with server-owned actor metadata', () => {
    expect(buildLeadActivityInsert('lead-1', 'Ernest Dodson', {
      description: 'Call after 3 PM',
      agent: 'Spoofed',
    })).toEqual({
      ok: true,
      insert: expect.objectContaining({
        lead_id: 'lead-1',
        activity_type: 'note',
        agent: 'Ernest Dodson',
        metadata: { internal: true, source: 'manual_note' },
      }),
    })
  })

  it('allows only typed contract fields and rejects incomplete terms', () => {
    expect(buildLeadActivityInsert('lead-1', 'Casey Davis', {
      kind: 'contract_terms',
      propertyAddress: '123 Main St',
      purchasePrice: 125000,
      closingDate: '2026-09-30',
      arbitrary: 'not persisted',
    })).toEqual({
      ok: true,
      insert: expect.objectContaining({
        activity_type: 'contract_sent',
        agent: 'Casey Davis',
        metadata: expect.not.objectContaining({ arbitrary: expect.anything() }),
      }),
    })
    expect(buildLeadActivityInsert('lead-1', 'Casey Davis', {
      kind: 'contract_terms',
      purchasePrice: 0,
    })).toEqual({ ok: false, error: expect.any(String) })
  })

  it('allowlists physical-mail evidence and rejects unknown commands', () => {
    const result = buildLeadActivityInsert('lead-1', 'Ernest Dodson', {
      kind: 'mail_piece',
      pieceType: 'thank_you',
      sentDate: '2026-08-23',
      campaign: 'Probate follow-up',
    })
    expect(result).toEqual({
      ok: true,
      insert: expect.objectContaining({
        activity_type: 'letter_tracking',
        description: 'Thank You sent — Probate follow-up',
      }),
    })
    expect(buildLeadActivityInsert('lead-1', 'Ernest Dodson', { kind: 'delete_all' }))
      .toEqual({ ok: false, error: 'Unsupported activity command' })
  })
})
