export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  getDealTrackingRequestContext,
  isSchemaColumnError,
  legacyHashedValue,
} from '@/lib/deals/tracking-context'
import { supabaseAdmin } from '@/lib/supabase/admin'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

type SupabaseWriteError = {
  code?: string
  message?: string
}

function cleanString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  if (!cleaned) return null
  return cleaned.slice(0, max)
}

function cleanUuid(value: unknown): string | null {
  const cleaned = cleanString(value, 80)
  return cleaned && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)
    ? cleaned
    : null
}

async function upsertSessionWithFallback(
  db: ReturnType<typeof supabaseAdmin>,
  nextRow: Record<string, unknown>,
  legacyRow: Record<string, unknown>,
) {
  const result = await db.from('deal_page_sessions').upsert(nextRow, { onConflict: 'session_id' })
  if (!result.error) return result
  if (!isSchemaColumnError(result.error as SupabaseWriteError)) return result
  return db.from('deal_page_sessions').upsert(legacyRow, { onConflict: 'session_id' })
}

// POST /api/deals/:slug/session
// Body: { action: 'start' | 'heartbeat' | 'end', session_id, ... }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await req.json()
    const { action, session_id } = body

    if (!action || !session_id) {
      return NextResponse.json({ error: 'action + session_id required' }, { status: 400, headers: corsHeaders })
    }

    const db = supabaseAdmin()
    const { data: dealPage } = await db
      .from('deal_pages')
      .select('id')
      .eq('slug', slug)
      .single()
    if (!dealPage) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404, headers: corsHeaders })
    }

    if (action === 'start') {
      const requestContext = getDealTrackingRequestContext(req)
      const country = req.headers.get('cf-ipcountry') || null
      const region = req.headers.get('cf-ipregion') || null
      const city = req.headers.get('cf-ipcity') || null

      const nextRow = {
        deal_page_id: dealPage.id,
        session_id,
        visitor_id: cleanString(body.visitor_id, 80),
        buyer_id: cleanUuid(body.buyer_id),
        broadcast_id: cleanUuid(body.broadcast_id),
        broadcast_recipient_id: cleanUuid(body.broadcast_recipient_id),
        share_id: cleanString(body.share_id, 120),
        ip_hash: requestContext.ipHash,
        user_agent_hash: requestContext.userAgentHash,
        ip_address: null,
        user_agent: null,
        referrer: cleanString(body.referrer, 1000),
        ref_code: cleanString(body.ref_code, 120),
        page_path: cleanString(body.page_path, 500),
        page_location: cleanString(body.page_location, 1000),
        utm_source: cleanString(body.utm_source, 200),
        utm_medium: cleanString(body.utm_medium, 200),
        utm_campaign: cleanString(body.utm_campaign, 200),
        utm_term: cleanString(body.utm_term, 200),
        utm_content: cleanString(body.utm_content, 200),
        country,
        region,
        city,
        device_type: cleanString(body.device_type, 50),
        browser: cleanString(body.browser, 50),
        os: cleanString(body.os, 50),
        screen_width: body.screen_width || null,
        screen_height: body.screen_height || null,
        viewport_width: body.viewport_width || null,
        viewport_height: body.viewport_height || null,
        request_context: requestContext.payload,
        is_internal: requestContext.isInternal,
      }

      const legacyRow = {
        deal_page_id: dealPage.id,
        session_id,
        visitor_id: cleanString(body.visitor_id, 80),
        ip_address: legacyHashedValue('ip', requestContext.ipHash),
        user_agent: legacyHashedValue('ua', requestContext.userAgentHash),
        referrer: cleanString(body.referrer, 1000),
        ref_code: cleanString(body.ref_code, 120),
        utm_source: cleanString(body.utm_source, 200),
        utm_medium: cleanString(body.utm_medium, 200),
        utm_campaign: cleanString(body.utm_campaign, 200),
        country,
        region,
        city,
        device_type: cleanString(body.device_type, 50),
        browser: cleanString(body.browser, 50),
        os: cleanString(body.os, 50),
        screen_width: body.screen_width || null,
        screen_height: body.screen_height || null,
        viewport_width: body.viewport_width || null,
        viewport_height: body.viewport_height || null,
      }

      const { error: upsertError } = await upsertSessionWithFallback(db, nextRow, legacyRow)
      if (upsertError) {
        console.error('[deals/:slug/session] Start upsert error:', upsertError)
        return NextResponse.json({ error: 'Failed to record session' }, { status: 500, headers: corsHeaders })
      }

      return NextResponse.json({ ok: true }, { headers: corsHeaders })
    }

    if (action === 'heartbeat' || action === 'end') {
      const update: Record<string, unknown> = {
        last_activity_at: new Date().toISOString(),
      }
      if (typeof body.total_duration_ms === 'number') update.total_duration_ms = body.total_duration_ms
      if (typeof body.active_duration_ms === 'number') update.active_duration_ms = body.active_duration_ms
      if (typeof body.max_scroll_pct === 'number') update.max_scroll_pct = body.max_scroll_pct
      if (Array.isArray(body.sections_viewed)) update.sections_viewed = body.sections_viewed
      if (typeof body.interactions === 'number') update.interactions = body.interactions
      if (typeof body.is_bounced === 'boolean') update.is_bounced = body.is_bounced
      if (typeof body.converted === 'boolean') update.converted = body.converted
      if (typeof body.conversion_type === 'string') update.conversion_type = body.conversion_type
      if (action === 'end') update.ended_at = new Date().toISOString()

      await db
        .from('deal_page_sessions')
        .update(update)
        .eq('session_id', session_id)

      return NextResponse.json({ ok: true }, { headers: corsHeaders })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: corsHeaders })
  } catch (err) {
    console.error('[deals/:slug/session] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}
