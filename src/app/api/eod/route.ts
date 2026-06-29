import { NextRequest, NextResponse } from 'next/server'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { safeSendSMS } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'

const WORKER_SECRET =
  process.env.ADMIN_API_SECRET ||
  process.env.CRON_SECRET ||
  process.env.DEPLOY_SECRET ||
  ''

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
    const fromNumber = normalizePhoneToE164(process.env.TWILIO_PHONE_NUMBER)
    const caseyPhone = normalizePhoneToE164(process.env.CASEY_PHONE)
    const ernestPhone = normalizePhoneToE164(process.env.ERNEST_PHONE)
    const messages: Array<ReturnType<typeof safeSendSMS>> = []
    if (fromNumber && caseyPhone) {
      messages.push(safeSendSMS({
        body: smsBody,
        from: fromNumber,
        to: caseyPhone,
      }))
    }
    if (fromNumber && ernestPhone) {
      messages.push(safeSendSMS({
        body: smsBody,
        from: fromNumber,
        to: ernestPhone,
      }))
    }

    await Promise.allSettled(messages)

    console.log(`EOD submitted — ${smsBody}`)

    // Trigger immediate Mojo refresh (INT-02)
    try {
      await fetch(`${req.nextUrl.origin}/api/workers/mojo-sync?force=true`, {
        method: 'POST',
        headers: WORKER_SECRET ? { authorization: `Bearer ${WORKER_SECRET}` } : undefined,
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
