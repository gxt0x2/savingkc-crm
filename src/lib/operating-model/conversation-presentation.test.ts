import { describe, expect, it } from 'vitest'
import {
  communicationActivitySummary,
  getCallOutcomePresentation,
  getCallParties,
  getConversationDirection,
  getEligibleSmsReplySender,
  isSmsConversationActivityType,
} from './conversation-presentation'

describe('conversation activity presentation', () => {
  it('renders an IVR arrival as routing with explicit from and to numbers', () => {
    const activity = {
      activity_type: 'call',
      description: 'Inbound call from +14195585125 — no IVR input, routing to agents',
      metadata: {
        direction: 'inbound',
        from: '+14195585125',
        calledNumber: '+18163077835',
        tag: 'ivr_no_input',
      },
    }

    expect(getCallOutcomePresentation(activity)).toMatchObject({
      key: 'routing',
      label: 'Routing to Acquisitions',
      icon: 'groups',
    })
    expect(getCallParties(activity)).toEqual({
      from: '+14195585125',
      to: '+18163077835',
    })
    expect(communicationActivitySummary(activity)).toBe('Inbound call · Routing to Acquisitions')
  })

  it.each([
    [{ outcome: 'connected', direction: 'inbound' }, 'connected', 'Connected', 'phone_in_talk'],
    [{ outcome: 'missed', direction: 'inbound' }, 'missed', 'Missed', 'phone_missed'],
    [{ dialStatus: 'no-answer', direction: 'inbound' }, 'no_answer', 'No answer', 'phone_missed'],
    [{ dialStatus: 'busy', direction: 'inbound' }, 'busy', 'Line busy', 'phone_paused'],
    [{ outcome: 'voicemail', direction: 'inbound' }, 'voicemail', 'Voicemail', 'voicemail'],
  ])('maps call metadata %o to an actionable outcome', (metadata, key, label, icon) => {
    expect(getCallOutcomePresentation({ activity_type: 'call', description: null, metadata })).toMatchObject({ key, label, icon })
  })

  it('uses direction-aware party fallbacks instead of repeating one phone', () => {
    expect(getCallParties(
      { activity_type: 'call', description: null, metadata: { direction: 'outbound' } },
      { leadPhone: '+18165550111', teamPhone: '+18163077835' },
    )).toEqual({ from: '+18163077835', to: '+18165550111' })
  })

  it.each([
    ['sms', 'outbound'],
    ['sms_sent', 'outbound'],
    ['sms_outbound', 'outbound'],
    ['sms_received', 'inbound'],
    ['sms_inbound', 'inbound'],
  ] as const)('normalizes %s as an SMS message with %s direction', (activityType, direction) => {
    const activity = { activity_type: activityType, description: 'Hello', metadata: null }

    expect(isSmsConversationActivityType(activityType)).toBe(true)
    expect(getConversationDirection(activity)).toBe(direction)
  })

  it('does not classify non-SMS system activity as an SMS message', () => {
    expect(isSmsConversationActivityType('status_change')).toBe(false)
  })

  it('derives the reply sender from eligible inbound and outbound SMS history', () => {
    expect(getEligibleSmsReplySender({
      activity_type: 'sms_received',
      description: 'Inbound',
      metadata: { from: '+19135550123', to: '(816) 608-8559' },
    })).toBe('+18166088559')
    expect(getEligibleSmsReplySender({
      activity_type: 'sms_sent',
      description: 'Outbound',
      metadata: { from: '+18163077835', to: '+19135550123' },
    })).toBe('+18163077835')
  })

  it('does not derive reply identity from calls, protected lines, or empty history', () => {
    expect(getEligibleSmsReplySender({
      activity_type: 'call',
      description: 'Inbound call',
      metadata: { direction: 'inbound', to: '+18163077835' },
    })).toBeUndefined()
    expect(getEligibleSmsReplySender({
      activity_type: 'sms_inbound',
      description: 'Inbound ad text',
      metadata: { from: '+19135550123', to: '+18166088808' },
    })).toBeUndefined()
    expect(getEligibleSmsReplySender({ activity_type: 'sms', description: null, metadata: null })).toBeUndefined()
  })
})
