import { describe, expect, it } from 'vitest'

import { buildLeadDispositionCommand } from './lead-disposition-command'

describe('lead disposition commands', () => {
  it('normalizes canonical outcomes and bounds client text', () => {
    expect(buildLeadDispositionCommand({ disposition: 'callback', notes: ' Call tomorrow ', phone: ' 8165550100 ' })).toEqual({
      ok: true,
      command: {
        disposition: 'callback_requested',
        notes: 'Call tomorrow',
        phone: '8165550100',
        appointmentAt: null,
      },
    })
  })

  it('requires a real future date for Appointment Set', () => {
    const now = Date.parse('2026-08-23T12:00:00.000Z')
    expect(buildLeadDispositionCommand({ disposition: 'appointment_set' }, now)).toMatchObject({
      ok: false,
      code: 'appointment_details_required',
    })
    expect(buildLeadDispositionCommand({
      disposition: 'appointment_set',
      appointmentAt: '2026-08-24T15:00:00.000Z',
    }, now)).toMatchObject({
      ok: true,
      command: { appointmentAt: '2026-08-24T15:00:00.000Z' },
    })
  })

  it('rejects unknown outcomes', () => {
    expect(buildLeadDispositionCommand({ disposition: 'sold_the_company' })).toMatchObject({ ok: false })
  })
})
