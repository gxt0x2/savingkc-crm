import { describe, expect, it } from 'vitest'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { PHONE_SYSTEM, PHONE_SYSTEM_ATTENTION } from './phone-system'
import { WORKFLOW_CATALOG } from './workflow-catalog'

describe('master phone system', () => {
  it('registers every owned number exactly once', () => {
    expect(TWILIO_NUMBERS).toHaveLength(21)
    expect(PHONE_SYSTEM).toHaveLength(TWILIO_NUMBERS.length)
    expect(new Set(PHONE_SYSTEM.map((record) => record.number)).size).toBe(PHONE_SYSTEM.length)
    expect(PHONE_SYSTEM.map((record) => record.number).sort())
      .toEqual(TWILIO_NUMBERS.map((record) => record.value).sort())
  })

  it('links every phone identity to a registered workflow and complete path', () => {
    const workflowIds = new Set(WORKFLOW_CATALOG.map((workflow) => workflow.id))
    for (const record of PHONE_SYSTEM) {
      expect(workflowIds.has(record.workflowId), record.label).toBe(true)
      expect(record.inboundPath.length, record.label).toBeGreaterThanOrEqual(3)
      expect(record.answeredPath, record.label).not.toBe('')
      expect(record.noAnswerPath, record.label).not.toBe('')
      expect(record.smsPath, record.label).not.toBe('')
      expect(record.smsSenderPolicy, record.label).not.toBe('')
      expect(record.outboundUse, record.label).not.toBe('')
      expect(record.carrierFallback, record.label).not.toBe('')
      expect(record.sourceFiles.length, record.label).toBeGreaterThan(0)
    }
  })

  it('routes the dispositions and Casey legacy identities directly to their owners', () => {
    expect(PHONE_SYSTEM_ATTENTION).toEqual([])
    expect(PHONE_SYSTEM.find((record) => record.number === '+18166088858')).toMatchObject({
      owner: 'Ernest', routeType: 'dispositions', health: 'healthy',
    })
    expect(PHONE_SYSTEM.find((record) => record.number === '+18163754666')).toMatchObject({
      owner: 'Casey', routeType: 'legacy', health: 'healthy',
      outboundUse: 'Conversation reply only; excluded from broadcasts and dialer caller-ID rotation.',
    })
  })

  it('keeps parked cold numbers on the callback IVR and out of outbound rotation', () => {
    const parkedNote = 'PARKED 2026-09-23 owner — spam/high-risk community flags; outbound disabled; Twilio ownership retained; do not release.'
    for (const number of ['+18162538313', '+18166408032', '+18163100845', '+18164761589']) {
      expect(PHONE_SYSTEM.find((record) => record.number === number)).toMatchObject({
        routeType: 'cold_callback',
        health: 'healthy',
        healthNote: parkedNote,
        workflowId: 'cold-call-callback-flow',
        outboundUse: 'Conversation reply only; excluded from broadcasts and dialer caller-ID rotation.',
        inboundPath: ['Twilio number', '/api/twiml-voice', 'Press-1 callback IVR', '/api/ivr/handle-input', 'Acquisitions team'],
        noAnswerPath: 'No IVR input enters /api/ivr/cold-no-input, ends the call, and queues a same-number SMS follow-up.',
      })
    }
    for (const number of ['+18166404701', '+18165788107', '+18166536616', '+18164761344']) {
      expect(PHONE_SYSTEM.find((record) => record.number === number)).toMatchObject({
        routeType: 'cold_callback',
        healthNote: 'Callback identity and reply-from number remain the dialed number.',
        outboundUse: 'Available for dialer, conversations, and approved broadcasts.',
      })
    }
    expect(PHONE_SYSTEM.find((record) => record.number === '+18163077835')?.outboundUse)
      .toBe('Available for dialer, conversations, and approved broadcasts.')
    expect(PHONE_SYSTEM.find((record) => record.number === '+18167277667')?.outboundUse)
      .toBe('Available as an approved conversation, broadcast, and dialer caller ID.')
  })
})
