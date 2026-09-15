import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ sms: vi.fn(), email: vi.fn(), disabled: vi.fn() }))
vi.mock('@/lib/send-lead-sms', () => ({ sendLeadSms: mocks.sms }))
vi.mock('@/lib/preview-safety', () => ({ externalSideEffectsDisabled: mocks.disabled }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.email } } }))
import { processAppointmentSequence } from './appointment-sequence'

function fixture(touch = 'arrival_sms', overrides: Record<string, unknown> = {}) {
  const updates: Record<string, unknown>[] = []
  const step = { id: 'step-1', appointment_id: 'a-1', version: 1, touch, due_at: new Date().toISOString() }
  const rpc = vi.fn().mockResolvedValueOnce({ data: [step] }).mockResolvedValue({ data: [] })
  const appointment = { id: 'a-1', lead_id: 'l-1', sequence_enabled: true, sequence_version: 1, status: 'scheduled', scheduled_at: new Date(Date.now() + 52 * 60_000).toISOString(), sequence_booked_at: new Date().toISOString(), assigned_to: 'Ernest', type: 'in_person', ...overrides }
  const from = vi.fn((table: string) => {
    let result: unknown
    if (table === 'appointments') result = appointment
    if (table === 'leads') result = { full_name: 'Seller Smith', phone: '+19135550100', email: 'seller@example.com' }
    if (table === 'agent_profiles') result = { profile_photo_url: null }
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain), ilike: vi.fn(() => chain),
      single: vi.fn(async () => ({ data: result })), maybeSingle: vi.fn(async () => ({ data: result })),
      update: vi.fn((payload: Record<string, unknown>) => { updates.push(payload); return chain }),
      insert: vi.fn(async () => ({ error: null })), then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ error: null })),
    }
    return chain
  })
  return { db: { rpc, from } as unknown as SupabaseClient, rpc, updates }
}
describe('appointment delivery worker', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.disabled.mockReturnValue(false); mocks.sms.mockResolvedValue({ status: 'sent', sid: 'SM1' }); vi.stubEnv('RESEND_API_KEY', 'test'); vi.stubEnv('RESEND_FROM_EMAIL', 'test@example.com') })
  it('never claims or sends in previews or test mode', async () => {
    mocks.disabled.mockReturnValue(true)
    const f = fixture(); await processAppointmentSequence(10, f.db)
    expect(f.rpc).not.toHaveBeenCalled(); expect(mocks.sms).not.toHaveBeenCalled()
  })
  it('automatically sends the 52-minute in-person text once', async () => {
    const f = fixture(); await processAppointmentSequence(10, f.db)
    expect(mocks.sms).toHaveBeenCalledTimes(1)
    expect(mocks.sms.mock.calls[0][0].body).toMatch(/^On my way/)
    expect(f.updates[0]).toMatchObject({ status: 'sent', provider_id: 'SM1' })
  })
  it.each([{ status: 'cancelled' }, { status: 'completed' }, { reschedule_requested_at: new Date().toISOString() }, { sequence_version: 2 }])('rechecks the appointment after claiming: %j', async change => {
    const f = fixture('arrival_sms', change); await processAppointmentSequence(10, f.db)
    expect(mocks.sms).not.toHaveBeenCalled(); expect(f.updates[0].status).toBe('skipped')
  })
  it('skips arrival for phone and video', async () => {
    const f = fixture('arrival_sms', { type: 'google_meet' }); await processAppointmentSequence(10, f.db)
    expect(mocks.sms).not.toHaveBeenCalled()
  })
  it('preserves uncertain provider outcomes without retrying', async () => {
    mocks.sms.mockResolvedValue({ status: 'failed', deliveryState: 'delivery_unknown', error: 'timeout' })
    const f = fixture(); await processAppointmentSequence(10, f.db)
    expect(f.updates[0].status).toBe('uncertain'); expect(mocks.sms).toHaveBeenCalledTimes(1)
  })
  it('sends booking email through Resend with a stable idempotency key', async () => {
    mocks.email.mockResolvedValue({ data: { id: 'email-1' } })
    const f = fixture('booking_email'); await processAppointmentSequence(10, f.db)
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ to: ['seller@example.com'] }), { idempotencyKey: 'appointment:step-1' })
    expect(f.updates[0]).toMatchObject({ status: 'sent', provider_id: 'email-1' })
  })
})
