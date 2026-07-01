import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scSendSms } from '@/lib/smartercontact/messaging'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/**
 * POST /api/sc/send — start a new conversation / send a one-off SMS.
 * Body: { phone, body, forceFrom? }. Creates a contact if none exists.
 */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const { phone, body, forceFrom } = await req.json().catch(() => ({}))
  const to = normalizePhoneToE164(phone || '')
  if (!to) return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })
  if (!body?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

  // Attach to an existing contact if we have one.
  const { data: contact } = await db
    .from('sc_contacts')
    .select('id')
    .eq('phone', to)
    .maybeSingle()

  const res = await scSendSms({
    toPhone: to,
    body: body.trim(),
    contactId: contact?.id ?? null,
    forceFrom: forceFrom || undefined,
    sticky: true,
  })

  if (!res.success) {
    return NextResponse.json(
      {
        error:
          res.skipped === 'opted_out'
            ? 'Contact has opted out'
            : res.skipped === 'no_number'
              ? 'No sending number available'
              : res.error || 'Send failed',
      },
      { status: 400 },
    )
  }
  return NextResponse.json({ success: true, sid: res.sid, from: res.from })
}
