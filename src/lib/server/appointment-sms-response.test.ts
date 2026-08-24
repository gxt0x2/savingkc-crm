import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))

import {
  classifyAppointmentSmsReply,
  recordAppointmentSmsResponse,
} from './appointment-sms-response'

function appointmentLookup(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'gte', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => ({ data, error }))
  return chain
}

function appointmentUpdate(error: unknown = null) {
  const result = { error }
  const chain: Record<string, unknown> = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
  }
  return chain
}

describe('appointment SMS response classification', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['1', 'yes', 'CONFIRMED', 'works for me', "I'm good"])('recognizes factual confirmation %s', (message) => {
    expect(classifyAppointmentSmsReply(message)).toBe('confirm')
  })

  it.each(["I can't make it", 'Can we reschedule?', 'Need a different time', 'Please move this'])('recognizes reschedule request %s', (message) => {
    expect(classifyAppointmentSmsReply(message)).toBe('reschedule')
  })

  it.each(['Thanks', 'Call me', 'Maybe', 'Stop by later'])('does not invent an appointment outcome for %s', (message) => {
    expect(classifyAppointmentSmsReply(message)).toBeNull()
  })

  it('updates the canonical appointment and writes one deterministic evidence event', async () => {
    const lookup = appointmentLookup({ id: 'appointment-1', status: 'scheduled', scheduled_at: '2026-10-01T15:30:00Z' })
    const update = appointmentUpdate()
    const insert = vi.fn().mockResolvedValue({ error: null })
    let appointmentCalls = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'appointments') return appointmentCalls++ === 0 ? lookup : update
      if (table === 'lead_activities') return { insert }
      throw new Error(`Unexpected table ${table}`)
    })

    await expect(recordAppointmentSmsResponse({
      leadId: 'lead-1', message: 'CONFIRM', messageSid: 'SM123',
    })).resolves.toEqual({ handled: true, appointmentId: 'appointment-1', response: 'confirm' })

    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      activity_type: 'appointment_confirmed',
      metadata: expect.objectContaining({ appointment_id: 'appointment-1', message_sid: 'SM123' }),
    }))
  })

  it('leaves unrelated replies and contacts without an active appointment untouched', async () => {
    await expect(recordAppointmentSmsResponse({
      leadId: 'lead-1', message: 'Thanks', messageSid: 'SM1',
    })).resolves.toEqual({ handled: false })
    expect(mocks.from).not.toHaveBeenCalled()

    mocks.from.mockReturnValue(appointmentLookup(null))
    await expect(recordAppointmentSmsResponse({
      leadId: 'lead-1', message: 'yes', messageSid: 'SM2',
    })).resolves.toEqual({ handled: false })
  })

  it('fails honestly when canonical appointment persistence is unavailable', async () => {
    const lookup = appointmentLookup({ id: 'appointment-1', status: 'scheduled', scheduled_at: '2026-10-01T15:30:00Z' })
    let appointmentCalls = 0
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'appointments') throw new Error('Unexpected table')
      return appointmentCalls++ === 0 ? lookup : appointmentUpdate({ message: 'database unavailable' })
    })
    await expect(recordAppointmentSmsResponse({
      leadId: 'lead-1', message: 'reschedule', messageSid: 'SM3',
    })).rejects.toThrow('Appointment response update failed')
  })
})
