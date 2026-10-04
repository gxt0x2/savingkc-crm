import { describe, expect, it } from 'vitest'
import {
  assertManualLeadEmailSend,
  manualEmailConsentFields,
  manualEmailConsentForLeads,
  type ManualEmailConsentLookup,
} from './manual-email-consent'

const leadId = '11111111-1111-4111-8111-111111111111'

function lookup(input: {
  email?: string | null
  leadError?: boolean
  addressError?: boolean
  suppressionError?: boolean
  ruleError?: boolean
  suppressed?: boolean
  rule?: string | null
}): ManualEmailConsentLookup {
  return {
    async loadLead() {
      if (input.leadError) return 'error'
      return { email: input.email === undefined ? 'savingkc@gmail.com' : input.email }
    },
    async loadAddresses() {
      if (input.addressError) return { data: null, error: { message: 'unavailable' } }
      return { data: [{ id: 'address-1', normalized_address: 'savingkc@gmail.com' }], error: null }
    },
    async loadSuppressions() {
      if (input.suppressionError) return { data: null, error: { message: 'unavailable' } }
      return { data: input.suppressed ? [{ address_id: 'address-1' }] : [], error: null }
    },
    async loadParties() {
      return { data: [{ id: 'party-1', lead_id: leadId }], error: null }
    },
    async loadRules() {
      if (input.ruleError) return { data: null, error: { message: 'unavailable' } }
      return { data: input.rule ? [{ party_id: 'party-1', status: input.rule }] : [], error: null }
    },
  }
}

describe('manual email consent', () => {
  it('reports an explicit clear only after both gates are empty', () => {
    expect(manualEmailConsentFields({ addressLookup: 'clear', personRule: 'none' })).toEqual({
      email_opt_out: false,
      email_suppressed: false,
      email_consent: 'clear',
    })
  })

  it('does not report a false clear when either gate cannot be read', () => {
    expect(manualEmailConsentFields({ addressLookup: 'unknown', personRule: 'none' })).toEqual({
      email_consent: 'unknown',
    })
    expect(manualEmailConsentFields({ addressLookup: 'clear', personRule: 'unknown' })).not.toHaveProperty('email_opt_out')
  })

  it('fail-closes a mailbox stop and a person marketing rule', async () => {
    const suppressed = await manualEmailConsentForLeads(
      [{ id: leadId, email: 'savingkc@gmail.com' }],
      lookup({ suppressed: true }),
    )
    expect(suppressed.get(leadId)).toMatchObject({ email_suppressed: true, email_consent: 'suppressed' })

    const stopped = await manualEmailConsentForLeads(
      [{ id: leadId, email: 'SavingKC@gmail.com' }],
      lookup({ rule: 'stopped' }),
    )
    expect(stopped.get(leadId)).toMatchObject({ email_opt_out: true, email_consent: 'opted_out' })

    const unreadable = await manualEmailConsentForLeads(
      [{ id: leadId, email: 'savingkc@gmail.com' }],
      lookup({ suppressionError: true }),
    )
    expect(unreadable.get(leadId)).toEqual({ email_consent: 'unknown' })

    const thrown = await manualEmailConsentForLeads(
      [{ id: leadId, email: 'savingkc@gmail.com' }],
      { ...lookup({}), loadAddresses: async () => { throw new Error('down') } },
    )
    expect(thrown.get(leadId)).toEqual({ email_consent: 'unknown' })
    expect(thrown.get(leadId)).not.toHaveProperty('email_opt_out')
  })

  it('sends only to the stored lead email and refuses an unknown or stopped status', async () => {
    const allowed = await assertManualLeadEmailSend({
      leadId,
      to: 'savingkc@gmail.com',
      lookup: lookup({}),
    })
    expect(allowed).toEqual({ ok: true, to: 'savingkc@gmail.com' })

    const mismatch = await assertManualLeadEmailSend({
      leadId,
      to: 'seller@example.com',
      lookup: lookup({ email: 'savingkc@gmail.com' }),
    })
    expect(mismatch).toMatchObject({ ok: false, code: 'recipient_mismatch' })

    const stopped = await assertManualLeadEmailSend({
      leadId,
      to: 'savingkc@gmail.com',
      lookup: lookup({ rule: 'deceased_confirmed' }),
    })
    expect(stopped).toMatchObject({ ok: false, status: 409, code: 'email_opt_out' })

    const unknown = await assertManualLeadEmailSend({
      leadId,
      to: 'savingkc@gmail.com',
      lookup: lookup({ addressError: true }),
    })
    expect(unknown).toMatchObject({ ok: false, code: 'email_consent_unknown' })
  })

  it('keeps bulk marketing locked and does not require every send to use the sandbox mailbox', async () => {
    expect(await assertManualLeadEmailSend({
      leadId,
      to: 'savingkc@gmail.com, other@example.com',
      lookup: lookup({}),
    })).toMatchObject({ ok: false, code: 'bulk_email_locked' })

    const otherStored = await assertManualLeadEmailSend({
      leadId,
      to: 'owner@example.com',
      lookup: lookup({ email: 'owner@example.com' }),
    })
    expect(otherStored).toEqual({ ok: true, to: 'owner@example.com' })
  })
})
