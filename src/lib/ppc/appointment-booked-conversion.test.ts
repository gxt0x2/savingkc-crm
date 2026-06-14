import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueuePpcConversion: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/ppc/conversion-outbox', () => ({
  enqueuePpcConversion: mocks.enqueuePpcConversion,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: mocks.from,
  },
}))

import { queuePpcAppointmentBookedConversion } from './appointment-booked-conversion'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function mockPpcLeadContext() {
  const userIdentifiers = [
    {
      userIdentifierSource: 'FIRST_PARTY' as const,
      hashedEmail: 'a'.repeat(64),
    },
    {
      userIdentifierSource: 'FIRST_PARTY' as const,
      hashedPhoneNumber: 'b'.repeat(64),
    },
  ]

  mocks.from.mockImplementation((table: string) => {
    if (table === 'leads') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'lead-1', source: 'ppc-landing', station: 'appointment_set' },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === 'manifests') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'manifest-1',
                    manifest: {
                      acquisition: {
                        source: 'ppc-landing',
                        channel: 'google-ads',
                        attribution: {
                          gclid: 'manifest-click',
                          campaign: 'Search 2026',
                        },
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }
    }

    if (table === 'ppc_conversion_outbox') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({
                data: [
                  {
                    click_id: 'submit-click',
                    click_id_type: 'gclid',
                    attribution: { gclid: 'submit-click' },
                    payload: { user_identifiers: userIdentifiers },
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }
    }

    throw new Error(`Unexpected table ${table}`)
  })

  return userIdentifiers
}

describe('queuePpcAppointmentBookedConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queues one secondary appointment conversion per PPC lead with stored identifiers', async () => {
    const userIdentifiers = mockPpcLeadContext()
    mocks.enqueuePpcConversion.mockResolvedValue({ queued: true, row: {} })

    const result = await queuePpcAppointmentBookedConversion({
      leadId: 'lead-1',
      appointmentId: 'appointment-1',
      bookingId: 'booking-1',
      activityId: 'activity-1',
      scheduledAt: '2026-06-08T15:00:00.000Z',
      scheduledTime: '10:00',
      appointmentType: 'phone_call',
      assignedTo: 'casey',
      source: 'appointment_modal',
      bookedAt: '2026-06-06T15:00:00.000Z',
    })

    expect(result).toEqual({ queued: true, reason: 'queued' })
    expect(mocks.enqueuePpcConversion).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'appointment_booked',
      eventCategory: 'appointment',
      leadId: 'lead-1',
      manifestId: 'manifest-1',
      activityId: 'activity-1',
      dedupeKey: 'lead:lead-1:appointment_booked',
      optimizationRole: 'secondary',
      approvedForGoogleAds: true,
      conversionValue: 1,
      eventTime: '2026-06-06T15:00:00.000Z',
      attribution: expect.objectContaining({
        gclid: 'manifest-click',
        campaign: 'Search 2026',
      }),
      payload: expect.objectContaining({
        source: 'appointment_modal',
        appointment_id: 'appointment-1',
        booking_id: 'booking-1',
        scheduled_at: '2026-06-08T15:00:00.000Z',
        scheduled_time: '10:00',
        appointment_type: 'phone_call',
        assigned_to: 'casey',
        approval_required: false,
        user_identifiers: userIdentifiers,
      }),
    }))
  })

  it('uses lead email/phone identifiers for appointment exports when prior submit identifiers are missing', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'lead-call-1',
                  source: 'google_ads_phone',
                  station: 'appointment_set',
                  phone: '+18165551212',
                  email: 'SELLER@EXAMPLE.COM',
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'manifests') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'manifest-call-1',
                      manifest: {
                        acquisition: {
                          source: 'google_ads_phone',
                          channel: 'google-ads',
                          attribution: {
                            traffic_source: 'google_ads',
                            campaign: 'Search 2026',
                          },
                        },
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'ppc_conversion_outbox') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    mocks.enqueuePpcConversion.mockResolvedValue({ queued: true, row: {} })

    const result = await queuePpcAppointmentBookedConversion({
      leadId: 'lead-call-1',
      appointmentId: 'appointment-call-1',
      source: 'manual_appointment',
    })

    expect(result).toEqual({ queued: true, reason: 'queued' })
    expect(mocks.enqueuePpcConversion).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'appointment_booked',
      attribution: expect.objectContaining({
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
      }),
      payload: expect.objectContaining({
        user_identifiers: [
          {
            userIdentifierSource: 'FIRST_PARTY',
            hashedEmail: sha256Hex('seller@example.com'),
          },
          {
            userIdentifierSource: 'FIRST_PARTY',
            hashedPhoneNumber: sha256Hex('+18165551212'),
          },
        ],
      }),
    }))
  })

  it('does not queue appointment conversions for non-PPC leads', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'lead-2', source: 'website_form', station: 'appointment_set' },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'manifests') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'ppc_conversion_outbox') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    const result = await queuePpcAppointmentBookedConversion({
      leadId: 'lead-2',
      appointmentId: 'appointment-2',
    })

    expect(result).toEqual({ queued: false, reason: 'not_ppc_lead' })
    expect(mocks.enqueuePpcConversion).not.toHaveBeenCalled()
  })
})
