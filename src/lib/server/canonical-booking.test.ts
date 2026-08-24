import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import { createCanonicalBooking } from './canonical-booking'

const input = {
  leadId: '11111111-1111-4111-8111-111111111111',
  firstName: 'Seller',
  phone: '+18165550123',
  propertyAddress: '123 Main St',
  slotDate: '2026-10-01',
  slotTime: '10:30',
  slotDateTime: '2026-10-01T15:30:00.000Z',
  bookingSource: 'website_form',
  landingPage: '/call',
  assignedTo: 'casey',
}

describe('canonical booking service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the service-only atomic booking RPC and returns canonical IDs', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ booking_id: 'booking-1', appointment_id: 'appointment-1', replayed: false }],
      error: null,
    })

    await expect(createCanonicalBooking(input)).resolves.toEqual({
      bookingId: 'booking-1', appointmentId: 'appointment-1', replayed: false,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('create_canonical_booking_v1', expect.objectContaining({
      p_lead_id: input.leadId,
      p_slot_datetime: input.slotDateTime,
      p_booking_source: 'website_form',
    }))
  })

  it('returns the existing IDs for an exact replay', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ booking_id: 'booking-1', appointment_id: 'appointment-1', replayed: true }],
      error: null,
    })
    await expect(createCanonicalBooking(input)).resolves.toMatchObject({ replayed: true })
  })

  it('translates a competing slot claim without leaking database details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'booking_slot_taken' } })
    await expect(createCanonicalBooking(input)).rejects.toMatchObject({
      code: 'slot_taken',
      message: 'This time slot was just taken. Please choose another time.',
    })
  })

  it('fails closed if the RPC contract is unavailable or malformed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function missing' } })
    await expect(createCanonicalBooking(input)).rejects.toMatchObject({ code: 'unavailable' })

    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(createCanonicalBooking(input)).rejects.toMatchObject({ code: 'unavailable' })
  })
})
