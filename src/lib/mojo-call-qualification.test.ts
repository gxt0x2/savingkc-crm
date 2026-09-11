import { describe, expect, it } from 'vitest'
import {
  MOJO_MINIMUM_MEANINGFUL_SECONDS,
  assessMojoCallQualification,
} from './mojo-call-qualification.mjs'

describe('Mojo CRM qualification policy', () => {
  it('requires two minutes, a recording, and seller-intent evidence', () => {
    expect(MOJO_MINIMUM_MEANINGFUL_SECONDS).toBe(120)
    expect(assessMojoCallQualification({
      outcome: 'meaningful_conversation',
      call_duration: 119,
      recording_url: 'https://app71.mojosells.com/audio/1',
      notes: 'Motivation: retiring and wants to sell in 60 days.',
    })).toMatchObject({ eligible: false, status: 'ineligible', reasons: ['below_minimum_duration'] })

    expect(assessMojoCallQualification({
      outcome: 'meaningful_conversation',
      call_duration: 180,
      recording_url: 'https://app71.mojosells.com/audio/1',
      notes: 'Motivation: retiring. Timeline: 60 days.',
    })).toMatchObject({ eligible: true, status: 'eligible' })
  })

  it('recognizes natural seller-intent wording from real call notes', () => {
    expect(assessMojoCallQualification({
      outcome: 'meaningful_conversation',
      call_duration: 649,
      recording_url: 'https://app71.mojosells.com/audio/real-call',
      notes: 'His daughter is moving in 60 days. He is getting rid of properties that are not close and is ready for retirement.',
    })).toMatchObject({
      eligible: true,
      status: 'eligible',
      reasons: ['seller_intent_documented', 'minimum_duration_met'],
      sellerIntel: ['motivation'],
    })
  })

  it('does not treat a generic callback request as a lead', () => {
    expect(assessMojoCallQualification({
      outcome: 'callback_scheduled',
      call_duration: 240,
      recording_url: 'https://app71.mojosells.com/audio/2',
      notes: 'Was with a client. Call back in two weeks.',
    })).toMatchObject({
      eligible: false,
      status: 'ineligible',
      reasons: ['callback_without_scheduled_time'],
    })
  })

  it('lets negative notes override an interested provider disposition', () => {
    expect(assessMojoCallQualification({
      outcome: 'meaningful_conversation',
      call_duration: 758,
      recording_url: 'https://app71.mojosells.com/audio/3',
      notes: 'As soon as I mentioned wholesaling he said no thank you and abruptly hung up.',
      qualified_by_agent: true,
    })).toMatchObject({ eligible: false, status: 'ineligible', reasons: ['negative_intent'] })
  })

  it('allows a reasoned agent exception without weakening the ordinary negative-intent guard', () => {
    expect(assessMojoCallQualification({
      outcome: 'meaningful_conversation',
      call_duration: 758,
      recording_url: 'https://app71.mojosells.com/audio/3',
      notes: 'He said no thank you and abruptly hung up, but the CRM owner approved this record as a special exception.',
      qualified_by_agent: true,
      qualification_override_reason: 'CRM owner approved Howard Snitkoff as a one-off exception on 2026-09-09.',
    })).toMatchObject({
      eligible: true,
      status: 'eligible',
      reasons: ['agent_qualified', 'negative_intent_overridden', 'minimum_duration_met'],
    })
  })

  it('holds missing recording evidence for a later retry', () => {
    expect(assessMojoCallQualification({
      outcome: 'meaningful_conversation',
      call_duration: 0,
      notes: 'Motivation: retiring. Timeline: 60 days.',
    })).toMatchObject({ eligible: false, status: 'evidence_pending', reasons: ['recording_pending'] })
  })

  it('allows a specifically scheduled appointment as the duration exception', () => {
    expect(assessMojoCallQualification({
      outcome: 'appointment_set',
      call_duration: 45,
      follow_up_date: '2026-09-10T15:00:00Z',
      has_appointment: true,
      notes: 'Appointment set at the property.',
    })).toMatchObject({
      eligible: true,
      status: 'eligible',
      reasons: ['scheduled_appointment_override', 'recording_pending'],
    })
  })
})
