import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
