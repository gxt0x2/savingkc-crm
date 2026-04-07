import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { safeSendSMS } from '@/lib/safe-communications'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { unexpected, went_right, lesson_learned, team_member, checklist_items } = body

    const summary = `EOD by ${team_member || 'team'}: ${went_right || '(no summary)'}`

    // Save to lead_activities
    const { error: dbError } = await supabase.from('lead_activities').insert({
      type: 'eod_submission',
      description: summary,
      agent: 'system',
      metadata: { unexpected, went_right, lesson_learned, checklist_items },
    })

    if (dbError) {
      console.error('DB error saving EOD:', dbError)
      // Don't fail the whole request over a DB write
    }

    // SMS to Casey and Ernest
    const smsBody = `EOD from ${team_member || 'team'}: ${went_right || ''}`
    await Promise.allSettled([
      safeSendSMS({
        body: smsBody,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.CASEY_PHONE!,
      }),
      safeSendSMS({
        body: smsBody,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: process.env.ERNEST_PHONE!,
      }),
    ])

    console.log(`EOD submitted — ${smsBody}`)

    // Trigger immediate Mojo refresh (INT-02)
    try {
      await fetch(`${req.nextUrl.origin}/api/workers/mojo-sync?force=true`, {
        method: 'POST',
      })
      console.log('Mojo refresh triggered')
    } catch (mojoErr) {
      console.error('Mojo refresh failed (non-fatal):', mojoErr)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('EOD route error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
