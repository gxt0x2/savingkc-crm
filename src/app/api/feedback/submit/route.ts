import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

/**
 * POST /api/feedback/submit
 * Submits feedback (bug report, feature request, or general feedback) - FBK-01
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, section, description, priority, page_url, user_agent, screenshot_url } = body

    if (!type || !section || !description || !priority) {
      return NextResponse.json(
        { error: 'Missing required fields: type, section, description, priority' },
        { status: 400 }
      )
    }

    // TODO: Get agent_id and agent_name from session/auth
    const agent_id = 'CA'
    const agent_name = 'Casey'

    const { data, error } = await supabase
      .from('feedback_submissions')
      .insert({
        type,
        section,
        description,
        priority,
        page_url,
        user_agent,
        agent_id,
        agent_name,
        screenshot_url,
        status: 'open',
      })
      .select()
      .single()

    if (error) {
      console.error('Error submitting feedback:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      feedback_id: data.id,
      message: 'Feedback submitted successfully',
    })
  } catch (error: any) {
    console.error('Feedback submission error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
