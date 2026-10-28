import { describe, expect, it } from 'vitest'
import {
  CALLER_ID_VERIFICATION_ACTOR,
  CALLER_ID_VERIFICATION_DEAD_REASON,
  callerIdVerificationRetirementPatch,
  isCallerIdVerificationRobocall,
  isCallerIdVerificationTranscript,
  unconfirmedInboundLeadCanBeRetired,
  withoutCallerIdVerificationLeads,
} from './caller-id-verification'

const MOJO_SCRIPT = 'Press 1 to confirm this caller ID in the Mojo Dialer. Goodbye.'
const MOTO_SCRIPT = 'Press 1 to confirm this caller ID in the Moto Dialer. Goodbye.'
const MIDDLE_SCRIPT = 'Press 1 to confirm this caller ID in the middle of the. Goodbye.'
const SELLER_SCRIPT = 'Hi, this is Maria. I want to sell my house at 123 Oak Street in Kansas City.'

describe('caller ID verification transcripts', () => {
  it.each([
    MOJO_SCRIPT,
    MOTO_SCRIPT,
    MIDDLE_SCRIPT,
    '  press   1 to confirm this caller I.D. in the Mojo Dialer. Goodbye. ',
    'Press one to confirm your caller ID. Goodbye.',
  ])('matches the verification script: %s', (transcript) => {
    expect(isCallerIdVerificationTranscript(transcript)).toBe(true)
    expect(isCallerIdVerificationRobocall({ transcript, durationSeconds: 6 })).toBe(true)
  })

  it('keeps a normal seller call', () => {
    expect(isCallerIdVerificationTranscript(SELLER_SCRIPT)).toBe(false)
    expect(isCallerIdVerificationRobocall({ transcript: SELLER_SCRIPT, durationSeconds: 8 })).toBe(false)
    expect(isCallerIdVerificationRobocall({ transcript: SELLER_SCRIPT, durationSeconds: 42 })).toBe(false)
  })

  it('does not treat a short seller IVR phrase as a verification call', () => {
    const transcript = 'Press 1 if you want a cash offer for your house. Goodbye.'
    expect(isCallerIdVerificationRobocall({ transcript, durationSeconds: 7 })).toBe(false)
  })

  it('requires the short-call pre-check as well as the transcript', () => {
    expect(isCallerIdVerificationRobocall({ transcript: MOJO_SCRIPT, durationSeconds: 4 })).toBe(false)
    expect(isCallerIdVerificationRobocall({ transcript: MOJO_SCRIPT, durationSeconds: 5 })).toBe(true)
    expect(isCallerIdVerificationRobocall({ transcript: MOTO_SCRIPT, durationSeconds: 8 })).toBe(true)
    expect(isCallerIdVerificationRobocall({ transcript: MIDDLE_SCRIPT, durationSeconds: 20 })).toBe(true)
    expect(isCallerIdVerificationRobocall({ transcript: MOJO_SCRIPT, durationSeconds: 21 })).toBe(false)
    expect(isCallerIdVerificationRobocall({ transcript: MOJO_SCRIPT, durationSeconds: 90 })).toBe(false)
  })

  it('does not match a long conversation that merely quotes the script', () => {
    const transcript = `${MOJO_SCRIPT} ${SELLER_SCRIPT} I have owned the house for twelve years and I am ready to close this month if the number works.`
    expect(isCallerIdVerificationTranscript(transcript)).toBe(false)
  })
})

describe('caller ID verification lead retirement', () => {
  it('retires only an unconfirmed new inbound lead', () => {
    expect(unconfirmedInboundLeadCanBeRetired({ classification: null, station: 'new' })).toBe(true)
    expect(unconfirmedInboundLeadCanBeRetired({ classification: '', station: 'new' })).toBe(true)
    expect(unconfirmedInboundLeadCanBeRetired({ classification: 'lead', station: 'new' })).toBe(false)
    expect(unconfirmedInboundLeadCanBeRetired({ classification: 'opportunity', station: 'new' })).toBe(false)
    expect(unconfirmedInboundLeadCanBeRetired({ classification: null, station: 'contacted' })).toBe(false)
    expect(unconfirmedInboundLeadCanBeRetired({ classification: 'dead', station: 'dead' })).toBe(false)
  })

  it('marks the lead not a lead without inventing a new source', () => {
    expect(callerIdVerificationRetirementPatch('2026-10-27T13:25:00.000Z', 'Connected inbound call.')).toMatchObject({
      classification: 'dead',
      station: 'dead',
      priority: 'cold',
      opportunity_score: 0,
      dead_reason: CALLER_ID_VERIFICATION_DEAD_REASON,
      dead_by: CALLER_ID_VERIFICATION_ACTOR,
      updated_at: '2026-10-27T13:25:00.000Z',
      notes: expect.stringContaining('Caller ID verification robocall'),
    })
  })

  it('drops verification leads from funnel rows and keeps seller leads', () => {
    const rows = withoutCallerIdVerificationLeads([
      { id: 'seller-call', source: 'inbound_call', dead_by: null },
      { id: 'form', source: 'website_form', dead_by: null },
      { id: 'robocall', source: 'inbound_call', dead_by: CALLER_ID_VERIFICATION_ACTOR },
      { id: 'human-spam', source: 'inbound_call', dead_by: 'Ernest' },
    ])

    expect(rows.map((row) => row.id)).toEqual(['seller-call', 'form', 'human-spam'])
  })
})
