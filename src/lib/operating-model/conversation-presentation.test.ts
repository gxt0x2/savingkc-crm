import { describe, expect, it } from 'vitest'
import {
  communicationActivitySummary,
  getCallOutcomePresentation,
  getCallParties,
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
})
