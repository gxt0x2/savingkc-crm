import { NextResponse } from 'next/server'
import { getCurrentUserEmail, isUserAdmin } from '@/lib/auth/admin'
import { runPhoneLineChecks } from '@/lib/server/phone-line-check'
import { phoneLineCheckStore } from '@/lib/server/phone-line-check-store'
import { createTwilioLookupClient, lookupPhoneLine } from '@/lib/server/phone-line-lookup'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('source_list_not_found')) {
    return NextResponse.json({ ok: false, error: 'List not found' }, { status: 404, headers: HEADERS })
  }
  if (
    message.includes('phone_line_check_selector_conflict')
    || message.includes('phone_line_check_batch')
    || message.includes('phone_line_check_actor')
    || message.includes('phone_line_check_source')
  ) {
    return NextResponse.json({ ok: false, error: 'Line check request is invalid' }, { status: 400, headers: HEADERS })
  }
  if (message.includes('not configured')) {
    return NextResponse.json({ ok: false, error: 'Twilio Lookup is not configured' }, { status: 503, headers: HEADERS })
  }
  console.error('[line-check] manual failed', message.slice(0, 180))
  return NextResponse.json({ ok: false, error: 'Line check is unavailable' }, { status: 503, headers: HEADERS })
}

export async function POST(request: Request) {
  const email = await getCurrentUserEmail()
  if (!email || !(await isUserAdmin(email))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Line check request is invalid' }, { status: 400, headers: HEADERS })
  }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const sourceListId = typeof record.sourceListId === 'string' ? record.sourceListId.trim() : ''
  const rawIds = Array.isArray(record.prospectPhoneIds) ? record.prospectPhoneIds : null
  if (Boolean(sourceListId) === Boolean(rawIds)) {
    return NextResponse.json({ error: 'Provide a source list or phone ids' }, { status: 400, headers: HEADERS })
  }
  if (sourceListId && !UUID.test(sourceListId)) {
    return NextResponse.json({ error: 'Line check request is invalid' }, { status: 400, headers: HEADERS })
  }
  const prospectPhoneIds = rawIds?.map((value) => typeof value === 'string' ? value.trim() : '') ?? null
  if (prospectPhoneIds && (
    prospectPhoneIds.length === 0
    || prospectPhoneIds.length > 100
    || prospectPhoneIds.some((id) => !UUID.test(id))
  )) {
    return NextResponse.json({ error: 'Line check request is invalid' }, { status: 400, headers: HEADERS })
  }

  try {
    const client = createTwilioLookupClient()
    const summary = await runPhoneLineChecks({
      store: phoneLineCheckStore(supabaseAdmin()),
      lookup: (phone) => lookupPhoneLine(client, phone),
      source: 'manual',
      actor: email,
      sourceListId: sourceListId || null,
      prospectPhoneIds,
      batchSize: 40,
      deadlineMs: Date.now() + 50_000,
    })
    return NextResponse.json(summary, { headers: HEADERS })
  } catch (error) {
    return failure(error)
  }
}
