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
    const { id, ...fields } = body

    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400, headers: corsHeaders })
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
