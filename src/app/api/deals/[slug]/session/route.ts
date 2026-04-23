export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
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
      const ip =
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        null
      const userAgent = req.headers.get('user-agent') || ''
      const country = req.headers.get('cf-ipcountry') || null
      const region = req.headers.get('cf-ipregion') || null
      const city = req.headers.get('cf-ipcity') || null

      await db.from('deal_page_sessions').upsert({
        deal_page_id: dealPage.id,
        session_id,
        visitor_id: body.visitor_id || null,
        ip_address: ip,
        user_agent: userAgent.slice(0, 500),
        referrer: body.referrer || null,
        ref_code: body.ref_code || null,
        utm_source: body.utm_source || null,
        utm_medium: body.utm_medium || null,
        utm_campaign: body.utm_campaign || null,
        country,
        region,
        city,
        device_type: body.device_type || null,
        browser: body.browser || null,
        os: body.os || null,
        screen_width: body.screen_width || null,
        screen_height: body.screen_height || null,
        viewport_width: body.viewport_width || null,
        viewport_height: body.viewport_height || null,
      }, { onConflict: 'session_id' })

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
