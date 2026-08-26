import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

/**
 * POST /api/error/log
 * Logs frontend errors or API failures (FBK-02)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { error_type, message, stack_trace, page_url, request_details } = body

    if (!error_type || !message) {
      return NextResponse.json({ error: 'Missing required fields: error_type, message' }, { status: 400 })
    }

    // TODO: Get agent_id and agent_name from session/auth
    const agent_id = 'CA'
    const agent_name = 'Casey'

    const { error } = await supabase.from('error_log').insert({
      error_type,
      message,
      stack_trace,
      page_url,
      agent_id,
      agent_name,
      request_details,
      resolved: false,
    })

    if (error) {
      console.error('Error logging error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('Error log API error:', error)
    const message = error instanceof Error ? error.message : 'Could not record error log'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
