import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { buildManifest } from '@/lib/manifest-builder'
import { detectCounty } from '@/lib/county-enrichment'
import { enrichManifestProperty, scoreManifest } from '@/lib/manifest-enrichment'
import { sendPushToAgents } from '@/lib/push-notifications'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

// Random delay to make auto-texts feel human
function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

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
      // Check prospects before creating bare lead
      const { lookupProspectByPhone } = await import('@/lib/prospect-lookup')
      const { createEnrichedLeadFromProspect } = await import('@/lib/prospect-to-lead')

      const prospectMatches = await lookupProspectByPhone(normalizedPhone)
      if (prospectMatches.length > 0) {
        leadId = await createEnrichedLeadFromProspect(
          prospectMatches[0],
          normalizedPhone,
          source === 'youtube' ? 'youtube' : 'website_form',
          'hot'
        )
      }

      // If no prospect match, create bare lead
      if (!leadId) {
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
        let manifest = buildManifest({
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

        const { data: manifestData } = await supabase
          .from('manifests')
          .insert({
            lead_id: leadId,
            booking_id: booking.id,
            version: manifest.version,
            manifest: manifest,
            current_station: manifest.currentStation,
            priority: manifest.priority,
            tier: manifest.tier,
            qualification_score: manifest.qualificationScore,
          })
          .select('id')
          .single()

        // Trigger enrichment if property_address is provided (non-blocking)
        if (manifestData?.id && property_address?.trim()) {
          try {
            // Parse address for county detection
            const { parseAddressForCounty } = await import('@/lib/county-enrichment')
            const parsed = parseAddressForCounty(property_address.trim())

            const city = body.property_city || parsed?.city
            const state = body.property_state || parsed?.state
            const zip = body.property_zip || parsed?.zip
            let county = body.property_county || parsed?.county

            if (!county && (city || state || zip)) {
              const detected = detectCounty(city, state, zip)
              if (detected) county = detected.county
            }

            // Backfill city/state/zip/county on the lead record
            if (leadId && (city || state || zip)) {
              await supabase.from('leads').update({
                ...(city ? { city } : {}),
                ...(state ? { state } : {}),
                ...(zip ? { zip } : {}),
                ...(county ? { county } : {}),
              }).eq('id', leadId)
            }

            // Enrich manifest if county is available
            if (county && state) {
              manifest = await enrichManifestProperty(
                manifest,
                property_address.trim(),
                city,
                state,
                zip,
                county
              )

              // Score manifest
              const { score, tier } = scoreManifest(manifest)

              // Update manifest in Supabase (background, non-blocking)
              await supabase
                .from('manifests')
                .update({
                  manifest: manifest,
                  qualification_score: score,
                  tier: tier,
                })
                .eq('id', manifestData.id)
            }
          } catch (enrichErr) {
            console.error('Manifest enrichment failed (non-critical):', enrichErr)
            // Don't fail the booking
          }
        }
      } catch (manifestErr) {
        console.error('Failed to create manifest (non-critical):', manifestErr)
        // Don't fail the booking
      }
    }

    // 🚨 CRITICAL: Populate pipeline.appointment in manifest (Sprint 1 - S1-03)
    if (leadId) {
      try {
        const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
        const { randomUUID } = await import('crypto')

        // Update manifest with appointment object
        await updateManifestAndCascade(leadId, (manifest) => {
          manifest.pipeline.appointment = {
            appointmentId: randomUUID(),
            type: 'phone_call', // /call bookings are always phone calls
            scheduledAt: slot_datetime,
            createdAt: new Date().toISOString(),
            status: 'scheduled',
            confirmationCount: 0,
            lastSellerResponse: null,
            ghostRiskScore: 0,
            ghostProtocolActive: false,
            automationLog: [],
            assignedTo: 'casey', // Default for website bookings
            address: null, // Phone calls don't need address
            notes: `Booked via ${source === 'youtube' ? 'YouTube' : 'website'} /call widget`,
          }

          // Mark briefing as stale
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          manifest.ariIntelligence.briefingStale = true

          // Add to audit trail
          if (!manifest.auditTrail) manifest.auditTrail = []
          manifest.auditTrail.push({
            timestamp: new Date().toISOString(),
            agent: 'booking:call_widget',
            action: 'appointment_created',
            details: {
              source: source === 'youtube' ? 'youtube' : 'website_form',
              scheduledAt: slot_datetime,
              bookingId: booking.id,
            },
          })
        }, 'booking:call_widget')

        // Create lead_activities record for calendar display
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'appointment',
          description: `Call appointment scheduled via ${source === 'youtube' ? 'YouTube' : 'website'} widget`,
          agent: 'System',
          metadata: {
            type: 'phone_call',
            scheduled_at: slot_datetime,
            due_date: slot_datetime, // Calendar reads due_date
            booking_id: booking.id,
            source: source === 'youtube' ? 'youtube' : 'website_form',
            status: 'scheduled',
          },
        })
      } catch (apptErr) {
        console.error('Failed to populate appointment in manifest (non-critical):', apptErr)
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

    // Send confirmation SMS to seller (delayed 15-30s to feel natural, not robotic)
    const confirmationBody = `Hi ${first_name.trim()}! Your call with Saving KC Homebuyers is confirmed for ${formattedDate} at ${displayTime} CT. We'll call you at ${normalizedPhone}. Questions? Call (816) 429-2900.`
    sendDelayed(async () => {
      await twilioClient.messages.create({
        body: confirmationBody,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: normalizedPhone,
      })
    }, 15, 30)

    // Push notification (instant)
    sendPushToAgents({
      title: 'New Booking',
      body: `${first_name.trim()} booked for ${formattedDate} at ${displayTime}`,
      url: leadId ? `/leads/${leadId}` : '/',
      tag: 'booking',
    }).catch(() => {})

    // Send alert SMS to Casey (delayed 30-60s)
    const alertBody = `📅 New call booked: ${first_name.trim()}${property_address?.trim() ? ` at ${property_address.trim()}` : ''} — ${formattedDate} at ${displayTime}. Phone: ${normalizedPhone}`
    sendDelayed(async () => {
      await twilioClient.messages.create({
        body: alertBody,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.CASEY_PHONE || '+18167564943',
      })
    }, 30, 60)

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
