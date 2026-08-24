import { NextRequest, NextResponse } from 'next/server'
import { detectCounty, parseAddressForCounty } from '@/lib/county-enrichment'
import { phoneLookupVariants } from '@/lib/google-ads-phone'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { buildQueuedSmsMetadata } from '@/lib/queued-sms'
import {
  CanonicalBookingError,
  createCanonicalBooking,
} from '@/lib/server/canonical-booking'
import { supabase } from '@/lib/supabase-lazy'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function resolveLeadId(input: {
  explicitLeadId: unknown
  phone: string
  firstName: string
  propertyAddress: string
  source: string
}): Promise<string | null> {
  if (isUuid(input.explicitLeadId)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id')
      .eq('id', input.explicitLeadId)
      .maybeSingle()
    if (error) throw new Error('Contact identity could not be checked')
    if (data?.id) return data.id
  }

  for (const variant of phoneLookupVariants(input.phone)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', variant)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error('Contact identity could not be checked')
    if (data?.id) return data.id
  }

  const { lookupProspectByPhone } = await import('@/lib/prospect-lookup')
  const { createEnrichedLeadFromProspect } = await import('@/lib/prospect-to-lead')
  const prospectMatches = await lookupProspectByPhone(input.phone)
  if (prospectMatches.length > 0) {
    const enrichedLeadId = await createEnrichedLeadFromProspect(
      prospectMatches[0], input.phone,
      input.source === 'youtube' ? 'youtube' : 'website_form', 'hot',
    )
    if (enrichedLeadId) return enrichedLeadId
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      full_name: input.firstName,
      phone: input.phone,
      ...(input.propertyAddress ? { property_address: input.propertyAddress } : {}),
      source: 'website_form', station: 'new', priority: 'hot',
    })
    .select('id')
    .single()
  if (error || !data?.id) throw new Error('Contact could not be created')
  return data.id
}

async function refreshAddressSnapshot(leadId: string, address: string, body: Record<string, unknown>) {
  if (!address) return
  const parsed = parseAddressForCounty(address)
  const city = typeof body.property_city === 'string' ? body.property_city : parsed?.city
  const state = typeof body.property_state === 'string' ? body.property_state : parsed?.state
  const zip = typeof body.property_zip === 'string' ? body.property_zip : parsed?.zip
  let county = typeof body.property_county === 'string' ? body.property_county : parsed?.county
  if (!county && (city || state || zip)) county = detectCounty(city, state, zip)?.county
  if (!city && !state && !zip && !county) return

  const { error } = await supabase.from('leads').update({
    ...(city ? { city } : {}), ...(state ? { state } : {}),
    ...(zip ? { zip } : {}), ...(county ? { county } : {}),
  }).eq('id', leadId)
  if (error) throw new Error('Property location refresh is pending')
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid booking request.' }, { status: 400, headers: corsHeaders })
  }

  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : ''
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const propertyAddress = typeof body.property_address === 'string' ? body.property_address.trim() : ''
  const slotDate = typeof body.slot_date === 'string' ? body.slot_date : ''
  const slotTime = typeof body.slot_time === 'string' ? body.slot_time : ''
  const slotDateTime = typeof body.slot_datetime === 'string' ? body.slot_datetime : ''
  const source = typeof body.source === 'string' ? body.source : 'website_form'

  if (body.website) {
    return NextResponse.json({ success: true, message: 'Booking confirmed!' }, { headers: corsHeaders })
  }
  const phone = normalizePhone(rawPhone)
  if (!firstName || !phone || !slotDate || !slotTime || !slotDateTime) {
    return NextResponse.json(
      { error: 'Please enter a valid name, phone number, and appointment time.' },
      { status: 400, headers: corsHeaders },
    )
  }

  const isPpcBooking = source === 'ppc-landing'
  const bookingSource = source === 'youtube' ? 'youtube' : isPpcBooking ? 'ppc-landing' : source || 'website_form'
  const landingPage = isPpcBooking ? '/ppc' : '/call'

  try {
    if (body.manifest_id || body.manifestId) {
      console.warn(JSON.stringify({
        event: 'legacy_booking_manifest_identifier_ignored',
        replacement: 'lead_id_or_phone_identity',
      }))
    }

    const leadId = await resolveLeadId({
      explicitLeadId: body.lead_id || body.leadId,
      phone, firstName, propertyAddress, source,
    })
    if (!leadId) throw new Error('Contact could not be resolved')

    const booking = await createCanonicalBooking({
      leadId, firstName, phone, propertyAddress, slotDate, slotTime, slotDateTime,
      bookingSource, landingPage, assignedTo: 'casey',
    })

    const warnings: string[] = []
    const { error: snapshotError } = await supabase.from('leads').update({
      appointment_date: slotDateTime,
      appointment_notes: `Booked via ${bookingSource}`,
      updated_at: new Date().toISOString(),
    }).eq('id', leadId)
    if (snapshotError) warnings.push('The contact appointment snapshot is pending.')

    await refreshAddressSnapshot(leadId, propertyAddress, body).catch((error) => {
      console.error('[book] address snapshot failed:', error)
      warnings.push('Property location enrichment is pending.')
    })

    const lifecycle = await checkAutoAdvance(leadId, 'appointment_set').catch((error) => {
      console.error('[book] lifecycle advance failed:', error)
      warnings.push('The lifecycle stage refresh is pending.')
      return { advanced: false }
    })

    const dateObj = new Date(slotDateTime)
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago',
    })
    const displayTime = dateObj.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
    })

    let activityId: string | null = null
    let ppcConversion: Awaited<ReturnType<typeof queuePpcAppointmentBookedConversion>> | null = null
    if (!booking.replayed) {
      const { data: activity, error: activityError } = await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'appointment',
        description: `Call appointment scheduled for ${formattedDate} at ${displayTime}`,
        agent: 'System',
        metadata: {
          appointment_id: booking.appointmentId, booking_id: booking.bookingId,
          type: 'phone_call', scheduled_at: slotDateTime, due_date: slotDateTime,
          assigned_to: 'casey', source: bookingSource, status: 'scheduled',
        },
      }).select('id').maybeSingle()
      activityId = activity?.id ?? null
      if (activityError) warnings.push('The appointment timeline entry is pending.')

      const confirmationBody = `Hi ${firstName}! Your call with Saving KC Homebuyers is confirmed for ${formattedDate} at ${displayTime} CT. We'll call you at ${phone}. Questions? Call (816) 429-2900.`
      const { error: queueError } = await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'sms',
        description: 'SMS appointment confirmation queued',
        agent: 'System',
        metadata: buildQueuedSmsMetadata({
          to: phone, from: process.env.TWILIO_PHONE_NUMBER || '+18163077835',
          body: confirmationBody, source: 'public_booking_confirmation',
          template: 'public_booking_confirmation',
          extra: { appointment_id: booking.appointmentId, booking_id: booking.bookingId },
        }),
      })
      if (queueError) warnings.push('The confirmation text is pending; do not book again.')

      if (isPpcBooking) {
        ppcConversion = await queuePpcAppointmentBookedConversion({
          leadId, appointmentId: booking.appointmentId, bookingId: booking.bookingId,
          activityId, scheduledAt: slotDateTime, scheduledTime: slotTime,
          appointmentType: 'phone_call', assignedTo: 'casey', source: bookingSource,
        }).catch((error) => {
          console.error('[book] PPC conversion queue failed:', error)
          warnings.push('Marketing attribution is pending.')
          return null
        })
      }

      await sendTeamLeadAlert({
        leadId,
        smsBody: `New call booked: ${firstName}${propertyAddress ? ` at ${propertyAddress}` : ''} — ${formattedDate} at ${displayTime}. Phone: ${phone}`,
        trigger: 'booking_alert', source: bookingSource,
        trafficSource: isPpcBooking ? 'google_ads' : 'non_paid',
        push: {
          title: 'New Booking', body: `${firstName} booked for ${formattedDate} at ${displayTime}`,
          url: `/leads/${leadId}`, tag: `booking-${booking.bookingId}`,
        },
        metadata: {
          booking_id: booking.bookingId, appointment_id: booking.appointmentId,
          slot_date: slotDate, slot_time: slotTime, scheduled_at: slotDateTime,
        },
      }).catch((error) => {
        console.error('[book] team alert failed:', error)
        warnings.push('The team alert is pending.')
      })
    }

    return NextResponse.json({
      success: true,
      message: booking.replayed ? 'Booking already confirmed.' : 'Booking confirmed!',
      booking_id: booking.bookingId, appointment_id: booking.appointmentId,
      lead_id: leadId, manifest_id: null, replayed: booking.replayed,
      lifecycle_advanced: lifecycle.advanced, ppc_conversion: ppcConversion,
      display_date: formattedDate, display_time: displayTime,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    }, { headers: corsHeaders })
  } catch (error) {
    if (error instanceof CanonicalBookingError) {
      const status = error.code === 'slot_taken' ? 409 : error.code === 'invalid' ? 400 : 503
      return NextResponse.json({ error: error.message }, { status, headers: corsHeaders })
    }
    console.error('[book] failed:', error)
    return NextResponse.json(
      { error: 'Booking is temporarily unavailable. Please try again.' },
      { status: 503, headers: corsHeaders },
    )
  }
}
