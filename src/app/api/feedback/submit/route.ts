import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { createClient } from '@/lib/supabase/server'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export const dynamic = 'force-dynamic'

const TYPES = new Set(['bug', 'feature', 'feedback'])
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical'])

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

/**
 * POST /api/feedback/submit
 * Submits feedback (bug report, feature request, or general feedback) - FBK-01
 */
export async function POST(req: NextRequest) {
  try {
    const parsedBody: unknown = await req.json()
    const body = parsedBody && typeof parsedBody === 'object' ? parsedBody as Record<string, unknown> : {}
    const type = cleanText(body.type, 20)
    const section = cleanText(body.section, 80)
    const description = cleanText(body.description, 5000)
    const priority = cleanText(body.priority, 20)
    const page_url = cleanText(body.page_url, 1000)
    const user_agent = cleanText(body.user_agent, 1000)
    const screenshot_url = cleanText(body.screenshot_url, 1000) || null

    if (!TYPES.has(type) || !section || !description || !PRIORITIES.has(priority)) {
      return NextResponse.json(
        { error: 'A valid issue type, area, impact, and description are required.' },
        { status: 400 }
      )
    }

    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user?.email) return NextResponse.json({ error: 'You must be signed in to raise an Andon.' }, { status: 401 })
    const agent = resolveAgentTelephonyProfile(user.email)

    const { data, error } = await supabase
      .from('feedback_submissions')
      .insert({
        type,
        section,
        description,
        priority,
        page_url,
        user_agent,
        agent_id: user.id,
        agent_name: agent.displayName,
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
  } catch (error: unknown) {
    console.error('Feedback submission error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit Andon.' }, { status: 500 })
  }
}
