import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { ensureManifestExists } from '@/lib/manifest-sync'

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
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, address, phone, email, source } = body

    const { data, error } = await supabase
      .from('leads')
      .insert({
        full_name: name,
        property_address: address,
        phone,
        email,
        source: source || 'website_form',
        station: 'intake',
        priority: 'normal',
      })
      .select('id')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
    }

    // Create manifest (fire-and-forget)
    if (data?.id) ensureManifestExists(data.id).catch(() => {})

    const smsText = `🔔 New website lead: ${name} | ${address} | ${phone}`

    await Promise.allSettled([
      twilioClient.messages.create({
        body: smsText,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.CASEY_PHONE!,
      }),
      twilioClient.messages.create({
        body: smsText,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.ERNEST_PHONE!,
      }),
    ])

    return NextResponse.json({ success: true, leadId: data.id }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads route error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, activity, ...fields } = body

    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400, headers: corsHeaders })
    }

    // CRITICAL: Handle appointment_set disposition → manifest write
    if (activity?.disposition === 'appointment_set') {
      const { updateManifestAndCascade, ensureManifestExists } = await import('@/lib/manifest-sync')
      const { checkAutoAdvance } = await import('@/lib/pipeline-auto-advance')
      const { randomUUID } = await import('crypto')

      // 0. Ensure manifest exists
      await ensureManifestExists(id)

      // 1. Update manifest with appointment object
      await updateManifestAndCascade(id, (manifest) => {
        // Create appointment object with all required fields
        manifest.pipeline.appointment = {
          appointmentId: randomUUID(),
          type: 'phone_call', // Default from disposition - can be changed via modal
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Default: tomorrow same time
          createdAt: new Date().toISOString(),
          status: 'scheduled',
          confirmationCount: 0,
          lastSellerResponse: null,
          ghostRiskScore: 0,
          ghostProtocolActive: false,
          automationLog: [],
          assignedTo: 'casey', // Default assignee
          address: null,
          notes: activity.notes || null,
        }

        // Set station to qualified
        manifest.currentStation = 'qualified'

        // Mark briefing as stale
        if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
        manifest.ariIntelligence.briefingStale = true

        // Add to audit trail
        if (!manifest.auditTrail) manifest.auditTrail = []
        manifest.auditTrail.push({
          timestamp: new Date().toISOString(),
          agent: 'disposition:appointment_set',
          action: 'appointment_created',
          details: {
            source: 'call_disposition',
            notes: activity.notes,
          },
        })
      }, 'disposition:appointment_set')

      // 2. Fire appointment_set auto-advance trigger
      await checkAutoAdvance(id, 'appointment_set')

      // 3. Log to lead_activities for timeline/calendar display
      const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('lead_activities').insert({
        lead_id: id,
        activity_type: 'appointment',
        description: `Appointment scheduled during call${activity.notes ? ': ' + activity.notes : ''}`,
        agent: 'Casey',
        metadata: {
          source: 'call_disposition',
          disposition: activity.disposition,
          scheduled_at: scheduledAt,
          due_date: scheduledAt, // Calendar reads due_date
          status: 'scheduled',
        },
      })
    } else if (activity) {
      // Log other call dispositions as call activities
      await supabase.from('lead_activities').insert({
        lead_id: id,
        activity_type: 'call',
        description: `Call: ${activity.disposition?.replace(/_/g, ' ') || 'completed'}${activity.notes ? ' - ' + activity.notes : ''}`,
        agent: 'Casey',
        metadata: {
          disposition: activity.disposition,
          phone: activity.phone,
          notes: activity.notes,
        },
      })
    }

    // Manifest-owned fields must cascade through manifest → leads
    const MANIFEST_OWNED = ['station', 'priority', 'motivation_score'] as const
    const manifestFields: Record<string, any> = {}
    const directFields: Record<string, any> = {}

    for (const [key, val] of Object.entries(fields)) {
      if ((MANIFEST_OWNED as readonly string[]).includes(key)) {
        manifestFields[key] = val
      } else {
        directFields[key] = val
      }
    }

    // If manifest-owned fields are being updated, go through manifest cascade
    if (Object.keys(manifestFields).length > 0) {
      const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
      const cascaded = await updateManifestAndCascade(id, (manifest) => {
        if (manifestFields.station) manifest.currentStation = manifestFields.station
        if (manifestFields.priority) manifest.priority = manifestFields.priority
        if (manifestFields.motivation_score) {
          if (!manifest.situation.motivation) manifest.situation.motivation = {}
          manifest.situation.motivation.score = manifestFields.motivation_score
        }
      }, 'api:leads_patch')

      // Fallback to direct write if no manifest exists
      if (!cascaded) {
        Object.assign(directFields, manifestFields)
      }
    }

    // Write non-manifest fields directly to leads table
    if (Object.keys(directFields).length > 0) {
      const { error } = await supabase
        .from('leads')
        .update(directFields)
        .eq('id', id)

      if (error) {
        console.error('Supabase update error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
      }
    }

    // Return updated lead
    const { data, error: fetchError } = await supabase
      .from('leads')
      .select()
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ success: false, error: fetchError.message }, { status: 500, headers: corsHeaders })
    }

    return NextResponse.json({ success: true, lead: data }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads PATCH error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids array required' }, { status: 400, headers: corsHeaders })
    }

    // Delete related rows first (foreign key constraints)
    await Promise.all([
      supabase.from('bookings').delete().in('lead_id', ids),
      supabase.from('activity_log').delete().in('lead_id', ids),
      supabase.from('manifests').delete().in('lead_id', ids),
    ])

    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)

    if (error) {
      console.error('Supabase delete error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
    }

    return NextResponse.json({ success: true, deleted: ids.length }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads DELETE error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    const { data, error, count } = await supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
    }

    return NextResponse.json({ success: true, leads: data, total: count }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads GET error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}
