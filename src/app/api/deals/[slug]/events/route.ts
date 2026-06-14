export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
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

const VALID_EVENTS = [
  'page_view',
  'share_click',
  'share_visit',
  'save_toggle',
  'offer_modal_open',
  'offer_submit_started',
  'offer_submit',
  'photo_open',
  'street_view_open',
  'map_view_open',
  'inquiry_modal_open',
  'inquiry_submit',
  'offer_submit_error',
  'deal_document_open',
  'video_started',
  'video_play',
  'video_progress_25',
  'video_progress_50',
  'video_progress_75',
  'video_completed',
  'video_paused',
  'click',
  'section_view',
  'conversion',
] as const

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

async function insertEventWithFallback(
  db: ReturnType<typeof supabaseAdmin>,
  nextRow: Record<string, unknown>,
  legacyRow: Record<string, unknown>,
) {
  const result = await db.from('deal_page_events').insert(nextRow)
  if (!result.error) return result
  if (!isSchemaColumnError(result.error as SupabaseWriteError)) return result
  return db.from('deal_page_events').insert(legacyRow)
}

// POST /api/deals/:slug/events
// Body: { event_type, ref_code?, metadata? }
// Public endpoint — records visitor events for the deal page.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await req.json()
    const {
      event_type,
      ref_code,
      metadata,
      session_id,
      visitor_id,
      x_pct,
      y_pct,
      scroll_pct,
      section,
      element_tag,
      element_text,
    } = body

    if (!event_type || !VALID_EVENTS.includes(event_type)) {
      return NextResponse.json(
        { error: 'Invalid event_type' },
        { status: 400, headers: corsHeaders }
      )
    }

    const db = supabaseAdmin()

    // Resolve slug → deal_page_id
    const { data: dealPage } = await db
      .from('deal_pages')
      .select('id')
      .eq('slug', slug)
      .single()

    if (!dealPage) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404, headers: corsHeaders })
    }

    const requestContext = getDealTrackingRequestContext(req)
    const referrer = req.headers.get('referer') || null
    const visitorId = cleanString(visitor_id, 80) || requestContext.ipHash?.slice(0, 32) || null
    const eventId = cleanString(body.event_id, 120) || randomUUID()

    const nextRow = {
      deal_page_id: dealPage.id,
      event_id: eventId,
      event_type,
      visitor_id: visitorId,
      buyer_id: cleanUuid(body.buyer_id),
      broadcast_id: cleanUuid(body.broadcast_id),
      broadcast_recipient_id: cleanUuid(body.broadcast_recipient_id),
      share_id: cleanString(body.share_id, 120),
      ip_hash: requestContext.ipHash,
      user_agent_hash: requestContext.userAgentHash,
      ip_address: null,
      user_agent: null,
      referrer,
      ref_code: cleanString(ref_code, 120),
      page_path: cleanString(body.page_path, 500),
      page_location: cleanString(body.page_location, 1000),
      utm_source: cleanString(body.utm_source, 200),
      utm_medium: cleanString(body.utm_medium, 200),
      utm_campaign: cleanString(body.utm_campaign, 200),
      utm_term: cleanString(body.utm_term, 200),
      utm_content: cleanString(body.utm_content, 200),
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
      request_context: requestContext.payload,
      is_internal: requestContext.isInternal,
      session_id: cleanString(session_id, 120),
      x_pct: typeof x_pct === 'number' ? x_pct : null,
      y_pct: typeof y_pct === 'number' ? y_pct : null,
      scroll_pct: typeof scroll_pct === 'number' ? scroll_pct : null,
      section: cleanString(section, 120),
      element_tag: cleanString(element_tag, 80),
      element_text: element_text ? String(element_text).slice(0, 100) : null,
    }

    const legacyRow = {
      deal_page_id: dealPage.id,
      event_type,
      visitor_id: visitorId,
      ip_address: legacyHashedValue('ip', requestContext.ipHash),
      user_agent: legacyHashedValue('ua', requestContext.userAgentHash),
      referrer,
      ref_code: cleanString(ref_code, 120),
      metadata: nextRow.metadata,
      session_id: cleanString(session_id, 120),
      x_pct: nextRow.x_pct,
      y_pct: nextRow.y_pct,
      scroll_pct: nextRow.scroll_pct,
      section: nextRow.section,
      element_tag: nextRow.element_tag,
      element_text: nextRow.element_text,
    }

    const { error: insertError } = await insertEventWithFallback(db, nextRow, legacyRow)
    if (insertError) {
      console.error('[deals/:slug/events] Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to record event' }, { status: 500, headers: corsHeaders })
    }

    return NextResponse.json({ ok: true }, { headers: corsHeaders })
  } catch (err) {
    console.error('[deals/:slug/events] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}
