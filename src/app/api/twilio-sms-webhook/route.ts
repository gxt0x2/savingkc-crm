import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const messageBody = body.get('Body') as string
    const messageSid = body.get('MessageSid') as string

    if (!from || !messageBody) {
      return new NextResponse('Missing required fields', { status: 400 })
    }

    // Match sender phone number to a lead in the database
    const { data: leads, error: searchError } = await supabase
      .from('leads')
      .select('id, full_name, phone')
      .eq('phone', from)
      .limit(1)

    if (searchError) {
      console.error('Error searching for lead:', searchError)
    }

    const leadId = leads && leads.length > 0 ? leads[0].id : null
    const leadName = leads && leads.length > 0 ? leads[0].full_name : 'Unknown'

    // Log the inbound SMS to lead_activities
    const { error: insertError } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        type: 'sms',
        description: messageBody,
        agent: 'system',
        metadata: {
          direction: 'inbound',
          from: from,
          to: to,
          message_sid: messageSid,
          lead_name: leadName,
        },
      })

    if (insertError) {
      console.error('Error inserting SMS activity:', insertError)
    }

    // Return empty TwiML response (no auto-reply)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`

    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (err) {
    console.error('Twilio SMS webhook error:', err)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
