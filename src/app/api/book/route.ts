import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { buildManifest } from '@/lib/manifest-builder'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { first_name, phone, property_address, slot_date, slot_time, slot_datetime, source } = body

    // Validate required fields — property_address is optional from /call page
    if (!first_name?.trim() || !phone?.trim() || !slot_date || !slot_time || !slot_datetime) {
      return NextResponse.json(
        { error: 'Please enter your name and phone number.' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Honeypot check
    if (body.website) {
      return NextResponse.json(
        { success: true, message: 'Booking confirmed!' },
        { status: 200, headers: corsHeaders }
      )
    }

    const normalizedPhone = normalizePhone(phone)

    // Race condition guard: check if slot is still available
    const { data: existing } = await supabase
      .from('bookings')
      .select('id')
      .eq('slot_date', slot_date)
      .eq('slot_time', slot_time)
      .eq('status', 'confirmed')
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'This time slot was just taken. Please choose another time.' },
        { status: 409, headers: corsHeaders }
      )
    }

    // Try to find existing lead by phone
    let leadId: string | null = null
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .limit(1)

    if (existingLead && existingLead.length > 0) {
      leadId = existingLead[0].id
    } else {
      // Create new lead
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert({
          full_name: first_name.trim(),
          phone: normalizedPhone,
          ...(property_address?.trim() ? { property_address: property_address.trim() } : {}),
          source: 'website_form',
          station: 'intake',
          priority: 'hot',
        })
        .select('id')
        .single()

      if (!leadError && newLead) {
        leadId = newLead.id
      } else {
        console.error('Failed to create lead:', leadError)
      }
    }

    // Insert booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        first_name: first_name.trim(),
        phone: normalizedPhone,
        property_address: property_address?.trim() || '',
        slot_date,
        slot_time,
        slot_datetime,
        lead_id: leadId,
        source: source === 'youtube' ? 'youtube' : 'website_form',
        landing_page: '/call',
      })
      .select('id')
      .single()

    if (bookingError) {
      console.error('Booking insert error:', bookingError)
      return NextResponse.json(
        { error: 'Failed to create booking. Please try again.' },
        { status: 500, headers: corsHeaders }
      )
    }

    // Log lead activity
    if (leadId) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'task',
        description: `Call booked via /call page for ${slot_date} at ${slot_time}`,
        agent: 'System',
        metadata: {
          booking_id: booking.id,
          slot_date,
          slot_time,
          property_address: property_address?.trim() || '',
          source: 'website_form',
        },
      })
    }

    // Create manifest (don't fail booking if this fails)
    if (leadId) {
      try {
        const manifest = buildManifest({
          firstName: first_name.trim(),
          phone: normalizedPhone,
          propertyAddress: property_address?.trim(),
          source: source === 'youtube' ? 'youtube' : 'website_form',
          bookingId: booking.id,
          leadId,
          slotDate: slot_date,
          slotTime: slot_time,
          station: 'intake',
          priority: 'hot',
        })

        await supabase.from('manifests').insert({
          lead_id: leadId,
          booking_id: booking.id,
          version: manifest.version,
          manifest: manifest,
          current_station: manifest.currentStation,
          priority: manifest.priority,
          tier: manifest.tier,
          qualification_score: manifest.qualificationScore,
        })
      } catch (manifestErr) {
        console.error('Failed to create manifest (non-critical):', manifestErr)
        // Don't fail the booking
      }
    }

    // Format date/time for SMS
    const dateObj = new Date(slot_datetime)
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Chicago',
    })
    
    // Extract display time from slot_time (HH:MM:SS -> readable)
    const [h, m] = slot_time.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h
    const displayTime = `${displayHour}:${m.toString().padStart(2, '0')} ${period}`

    // Send confirmation SMS to seller
    try {
      await twilioClient.messages.create({
        body: `Hi ${first_name.trim()}! Your call with Saving KC Homebuyers is confirmed for ${formattedDate} at ${displayTime} CT. We'll call you at ${normalizedPhone}. Questions? Call (816) 429-2900.`,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: normalizedPhone,
      })
    } catch (smsErr) {
      console.error('Failed to send confirmation SMS:', smsErr)
      // Don't fail the booking if SMS fails
    }

    // Send alert SMS to Casey
    try {
      await twilioClient.messages.create({
        body: `📅 New call booked: ${first_name.trim()}${property_address?.trim() ? ` at ${property_address.trim()}` : ''} — ${formattedDate} at ${displayTime}. Phone: ${normalizedPhone}`,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.CASEY_PHONE || '+18167564943',
      })
    } catch (smsErr) {
      console.error('Failed to send Casey alert SMS:', smsErr)
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Booking confirmed!',
        booking_id: booking.id,
        display_date: formattedDate,
        display_time: displayTime,
      },
      { status: 200, headers: corsHeaders }
    )
  } catch (err) {
    console.error('Book error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
