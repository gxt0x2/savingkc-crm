import { describe, expect, it } from 'vitest'

import { buildCallLogCommand } from './call-log-command'

describe('call log commands', () => {
  it('normalizes a provider-authorized browser call event', () => {
    expect(buildCallLogCommand({
      phone: '(816) 555-0100',
      event: 'started',
      lead_id: 'lead-1',
      clientAttemptId: ' attempt-1 ',
    })).toEqual({
      ok: true,
      command: expect.objectContaining({
        event: 'started',
        phone: '+18165550100',
        leadId: 'lead-1',
        clientAttemptId: 'attempt-1',
      }),
    })
  })

  it('turns the manual-dial disposition payload into a final event', () => {
    expect(buildCallLogCommand({
      to_number: '8165550100',
      status: 'completed',
      disposition: 'no_answer',
      duration_seconds: 12,
    })).toMatchObject({
      ok: true,
      command: { event: 'ended', phone: '+18165550100', durationSeconds: 12 },
    })
  })

  it('keeps a human disposition distinct from provisional call-ended telemetry', () => {
    expect(buildCallLogCommand({
      to_number: '8165550100',
      event: 'dispositioned',
      status: 'completed',
      disposition: 'no_answer',
      clientAttemptId: 'attempt-final',
    })).toMatchObject({
      ok: true,
      command: {
        event: 'dispositioned',
        phone: '+18165550100',
        disposition: 'no_answer',
        clientAttemptId: 'attempt-final',
      },
    })
  })

  it('rejects invalid phones and invented event names', () => {
    expect(buildCallLogCommand({ phone: 'not a phone', event: 'started' })).toMatchObject({ ok: false })
    expect(buildCallLogCommand({ phone: '8165550100', event: 'rewound' })).toMatchObject({ ok: false })
  })
})
