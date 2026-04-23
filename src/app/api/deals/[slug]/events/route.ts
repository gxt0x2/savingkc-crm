export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createHash } from 'crypto'

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
  'offer_modal_open',
  'offer_submit_started',
  'offer_submit',
  'photo_open',
  'street_view_open',
  'map_view_open',
  'inquiry_modal_open',
  'inquiry_submit',
  'click',
  'section_view',
  'conversion',
] as const

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
    const { event_type, ref_code, metadata, session_id, x_pct, y_pct, scroll_pct, section, element_tag, element_text } = body

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

    // Visitor fingerprint — hash of IP + UA (reasonably stable, no cookies)
    const ip =
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      '0.0.0.0'
    const userAgent = req.headers.get('user-agent') || ''
    const referrer = req.headers.get('referer') || null
    const visitorId = createHash('sha256').update(`${ip}:${userAgent}`).digest('hex').slice(0, 32)

    await db.from('deal_page_events').insert({
      deal_page_id: dealPage.id,
      event_type,
      visitor_id: visitorId,
      ip_address: ip,
      user_agent: userAgent.slice(0, 500),
      referrer,
      ref_code: ref_code || null,
      metadata: metadata || {},
      session_id: session_id || null,
      x_pct: typeof x_pct === 'number' ? x_pct : null,
      y_pct: typeof y_pct === 'number' ? y_pct : null,
      scroll_pct: typeof scroll_pct === 'number' ? scroll_pct : null,
      section: section || null,
      element_tag: element_tag || null,
      element_text: element_text ? String(element_text).slice(0, 100) : null,
    })

    return NextResponse.json({ ok: true }, { headers: corsHeaders })
  } catch (err) {
    console.error('[deals/:slug/events] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}
