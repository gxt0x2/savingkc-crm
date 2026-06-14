import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { supabase } from '@/lib/supabase-lazy'

export const runtime = 'nodejs'

type CandidateRow = {
  id: string
  lead_id?: string | null
  event_id?: string | null
  gclid?: string | null
  session_id?: string | null
  visitor_id?: string | null
  click_id?: string | null
  dedupe_key?: string | null
  name?: string | null
  full_name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  property_address?: string | null
  is_test?: boolean | null
}

const TEST_RE = /(^|[^a-z0-9])(codex|dummy|probe|smoke|test|internalfilter|filtercheck|hashcheck|finalhash)([^a-z0-9]|$)/i
const FAKE_PHONE_RE = /^1?816555/

function hasTestMarker(...values: Array<unknown>): boolean {
  return values.some((value) => typeof value === 'string' && TEST_RE.test(value))
}

function isFakePhone(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return FAKE_PHONE_RE.test(value.replace(/\D/g, ''))
}

function isTestLead(row: CandidateRow): boolean {
  return (
    hasTestMarker(row.id, row.name, row.full_name, row.email, row.address, row.property_address) ||
    isFakePhone(row.phone) ||
    (typeof row.email === 'string' && /@example\.com$/i.test(row.email.trim()))
  )
}

function isTestTrackingEvent(row: CandidateRow): boolean {
  return (
    row.is_test === true ||
    hasTestMarker(row.event_id, row.gclid, row.session_id, row.visitor_id, row.click_id, row.dedupe_key) ||
    isFakePhone(row.phone)
  )
}

async function collectTestData() {
  const [trackingResult, outboxResult, leadResult] = await Promise.all([
    supabase
      .from('ppc_tracking_events')
      .select('id,event_id,gclid,session_id,visitor_id,lead_id,is_test')
      .or('is_test.eq.true,event_id.ilike.%codex%,event_id.ilike.%dummy%,event_id.ilike.%probe%,event_id.ilike.%smoke%,event_id.ilike.%test%,event_id.ilike.%internalfilter%,event_id.ilike.%filtercheck%,event_id.ilike.%hashcheck%,event_id.ilike.%finalhash%,gclid.ilike.%codex%,gclid.ilike.%dummy%,gclid.ilike.%probe%,gclid.ilike.%smoke%,gclid.ilike.%test%,gclid.ilike.%internalfilter%,gclid.ilike.%filtercheck%,gclid.ilike.%hashcheck%,gclid.ilike.%finalhash%,session_id.ilike.%codex%,session_id.ilike.%internalfilter%,session_id.ilike.%filtercheck%,session_id.ilike.%hashcheck%,session_id.ilike.%finalhash%,visitor_id.ilike.%codex%,visitor_id.ilike.%internalfilter%,visitor_id.ilike.%filtercheck%,visitor_id.ilike.%hashcheck%,visitor_id.ilike.%finalhash%')
      .limit(1000),
    supabase
      .from('ppc_conversion_outbox')
      .select('id,lead_id,click_id,dedupe_key')
      .or('click_id.ilike.%codex%,click_id.ilike.%dummy%,click_id.ilike.%probe%,click_id.ilike.%smoke%,click_id.ilike.%test%,dedupe_key.ilike.%codex%,dedupe_key.ilike.%dummy%,dedupe_key.ilike.%probe%,dedupe_key.ilike.%smoke%,dedupe_key.ilike.%test%')
      .limit(1000),
    supabase
      .from('leads')
      .select('id,full_name,email,phone,property_address')
      .or('full_name.ilike.%codex%,full_name.ilike.%dummy%,full_name.ilike.%probe%,full_name.ilike.%smoke%,full_name.ilike.%test%,email.ilike.%example.com%,email.ilike.%codex%,phone.ilike.%816555%,phone.ilike.%(816) 555%,property_address.ilike.%codex%')
      .limit(1000),
  ])

  if (trackingResult.error) throw trackingResult.error
  if (outboxResult.error) throw outboxResult.error
  if (leadResult.error) throw leadResult.error

  const trackingRows = ((trackingResult.data ?? []) as CandidateRow[]).filter(isTestTrackingEvent)
  const outboxRows = ((outboxResult.data ?? []) as CandidateRow[]).filter(isTestTrackingEvent)
  const leadRows = ((leadResult.data ?? []) as CandidateRow[]).filter(isTestLead)
  const leadIds = new Set<string>(leadRows.map((row) => row.id))

  for (const row of [...trackingRows, ...outboxRows]) {
    if (row.lead_id) leadIds.add(row.lead_id)
  }

  const linkedLeadIds = Array.from(leadIds)

  const [activityResult, manifestResult, linkedOutboxResult, linkedTrackingResult] = linkedLeadIds.length
    ? await Promise.all([
        supabase.from('lead_activities').select('id,lead_id').in('lead_id', linkedLeadIds).limit(1000),
        supabase.from('manifests').select('id,lead_id').in('lead_id', linkedLeadIds).limit(1000),
        supabase.from('ppc_conversion_outbox').select('id,lead_id').in('lead_id', linkedLeadIds).limit(1000),
        supabase.from('ppc_tracking_events').select('id,lead_id').in('lead_id', linkedLeadIds).limit(1000),
      ])
    : [null, null, null, null]

  for (const result of [activityResult, manifestResult, linkedOutboxResult, linkedTrackingResult]) {
    if (result?.error) throw result.error
  }

  const activityRows = ((activityResult?.data ?? []) as CandidateRow[])
  const manifestRows = ((manifestResult?.data ?? []) as CandidateRow[])
  const linkedOutboxRows = ((linkedOutboxResult?.data ?? []) as CandidateRow[])
  const linkedTrackingRows = ((linkedTrackingResult?.data ?? []) as CandidateRow[])

  const trackingIds = new Set([...trackingRows, ...linkedTrackingRows].map((row) => row.id))
  const outboxIds = new Set([...outboxRows, ...linkedOutboxRows].map((row) => row.id))

  return {
    trackingIds: Array.from(trackingIds),
    outboxIds: Array.from(outboxIds),
    activityIds: activityRows.map((row) => row.id),
    manifestIds: manifestRows.map((row) => row.id),
    leadIds: linkedLeadIds,
  }
}

function counts(data: Awaited<ReturnType<typeof collectTestData>>) {
  return {
    ppc_tracking_events: data.trackingIds.length,
    ppc_conversion_outbox: data.outboxIds.length,
    lead_activities: data.activityIds.length,
    manifests: data.manifestIds.length,
    leads: data.leadIds.length,
  }
}

async function deleteIds(table: string, ids: string[]) {
  if (ids.length === 0) return 0
  const { error } = await supabase.from(table).delete().in('id', ids)
  if (error) throw error
  return ids.length
}

export async function GET(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const data = await collectTestData()
  return NextResponse.json({ counts: counts(data) })
}

export async function DELETE(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const data = await collectTestData()
  const deleted = {
    lead_activities: await deleteIds('lead_activities', data.activityIds),
    manifests: await deleteIds('manifests', data.manifestIds),
    ppc_conversion_outbox: await deleteIds('ppc_conversion_outbox', data.outboxIds),
    ppc_tracking_events: await deleteIds('ppc_tracking_events', data.trackingIds),
    leads: await deleteIds('leads', data.leadIds),
  }

  const remaining = await collectTestData()
  return NextResponse.json({ deleted, remaining: counts(remaining) })
}
