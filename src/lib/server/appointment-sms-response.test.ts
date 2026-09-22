import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }))
import { classifyAppointmentSmsReply, recordAppointmentSmsResponse } from './appointment-sms-response'

describe('appointment SMS replies', () => {
  beforeEach(() => rpc.mockReset())
  it.each(['1', 'yes!', 'CONFIRMED', 'works for me', "I'm good"])('confirms explicit affirmative: %s', message => {
    expect(classifyAppointmentSmsReply(message)).toBe('confirm')
  })
  it.each(["I can't make it", 'Can we reschedule?', 'Yes, but can we do 6?', 'No', 'Cancel please', 'Please move this'])('routes change requests: %s', message => {
    expect(classifyAppointmentSmsReply(message)).toBe('reschedule')
  })
  it.each(['Thanks', 'Call me', 'Maybe', 'Stop by later', 'yes but maybe later'])('leaves unclear replies for the rep: %s', message => {
    expect(classifyAppointmentSmsReply(message)).toBeNull()
  })
  it('does not apply a natural-language stop as an appointment reply', async () => {
    await expect(recordAppointmentSmsResponse({
      leadId: 'lead-1',
      message: 'Please stop texting me',
      messageSid: 'SM-stop',
    })).resolves.toEqual({ handled: false })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses one atomic idempotent reply transaction', async () => {
    rpc.mockResolvedValue({ data: 'appointment-1', error: null })
    await expect(recordAppointmentSmsResponse({ leadId: 'lead-1', message: 'yes', messageSid: 'SM123' })).resolves.toEqual({ handled: true, appointmentId: 'appointment-1', response: 'confirm' })
    expect(rpc).toHaveBeenCalledWith('appointment_sequence_reply_v1', expect.objectContaining({ p_response: 'confirm', p_event_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }))
  })
  it('does not claim success when persistence fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'unavailable' } })
    await expect(recordAppointmentSmsResponse({ leadId: 'lead-1', message: 'yes', messageSid: 'SM1' })).rejects.toThrow('Appointment response update failed')
  })
})
