import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { googleAdsQualityPayload, normalizeGoogleAdsQualityScore } from '@/lib/ppc/conversion-approval'
import { cleanJsonRecord } from '@/lib/ppc/conversion-outbox'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 500) : null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const email = await getCurrentUserEmail()
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Conversion id required' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const score = normalizeGoogleAdsQualityScore(body.qualityScore ?? body.score)
  if (!score) {
    return NextResponse.json(
      { error: 'qualityScore must be 1, 2, or 3' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const db = supabaseAdmin()
  const { data: existing, error: loadError } = await db
    .from('ppc_conversion_outbox')
    .select('id, lead_id, event_name, status, payload')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Conversion not found' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  const status = typeof existing.status === 'string' ? existing.status : ''
  if (status === 'sent') {
    return NextResponse.json(
      { error: 'Conversion has already been sent to Google Ads' },
      { status: 409, headers: NO_STORE_HEADERS },
    )
  }
  if (status === 'processing') {
    return NextResponse.json(
      { error: 'Conversion export is already processing; refresh and try again if needed' },
      { status: 409, headers: NO_STORE_HEADERS },
    )
  }

  const now = new Date().toISOString()
  const currentPayload = isRecord(existing.payload) ? existing.payload : {}
  const approvalNote = cleanNote(body.note) ?? `Approved with Google Ads quality score ${score}`

  const { data, error } = await db
    .from('ppc_conversion_outbox')
    .update({
      approved_for_google_ads: true,
      approved_at: now,
      approved_by: email,
      approval_note: approvalNote,
      conversion_value: score,
      currency: 'USD',
      status: 'pending',
      attempts: 0,
      last_error: null,
      locked_at: null,
      payload: cleanJsonRecord({
        ...currentPayload,
        ...googleAdsQualityPayload({ score, approvedAt: now, approvedBy: email }),
      }),
    })
    .eq('id', id)
    .select('id, event_name, status, approved_for_google_ads, approved_at, approved_by, approval_note, conversion_value')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  return NextResponse.json({ ok: true, conversion: data }, { headers: NO_STORE_HEADERS })
}
