import { describe, expect, it } from 'vitest'
import { mojoRowToDial, twilioRowToDial } from './caller-id-health-db'

describe('caller ID dial rows', () => {
  it('keeps our Mojo caller ID and drops a masked one', () => {
    expect(mojoRowToDial({
      id: '1',
      caller_id: '+18166404701',
      call_at: '2026-11-13T15:00:00.000Z',
      duration_seconds: 12,
      result_label: 'No Answer',
      result_code: null,
    })).toMatchObject({ callerId: '+18166404701', connected: false, source: 'mojo' })
    expect(mojoRowToDial({
      id: '2',
      caller_id: '(***) ***-4701',
      call_at: '2026-11-13T15:00:00.000Z',
      duration_seconds: 0,
      result_label: 'Contact',
      result_code: null,
    })).toBeNull()
  })

  it('reads the Twilio from number and ignores the dialed party', () => {
    const dial = twilioRowToDial({
      id: '3',
      created_at: '2026-11-13T15:00:00.000Z',
      metadata: {
        source: 'twilio_status_callback',
        direction: 'outbound',
        from: '+1 (816) 640-4701',
        to: '+19135550199',
        status: 'completed',
        duration: 9,
      },
    })
    expect(dial).toEqual({
      callerId: '+18166404701',
      at: '2026-11-13T15:00:00.000Z',
      connected: true,
      source: 'twilio',
    })
    expect(JSON.stringify(dial)).not.toContain('9135550199')
  })
})
