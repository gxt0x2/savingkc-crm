import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { createClient } from '@/lib/supabase/server'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import {
  ANDON_PRIORITIES,
  encodeLegacyAndon,
  inferAndonIssueKind,
  isAndonIssueKind,
  legacyFeedbackType,
} from '@/lib/andon'

export const dynamic = 'force-dynamic'

const PRIORITIES = new Set<string>(ANDON_PRIORITIES)

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
    const legacyType = cleanText(body.type, 20)
    const requestedKind = cleanText(body.issue_kind, 20)
    const issueKind = isAndonIssueKind(requestedKind) ? requestedKind : inferAndonIssueKind(legacyType)
    const department = cleanText(body.department, 80) || cleanText(body.section, 80)
    const category = cleanText(body.category, 120) || cleanText(body.section, 80)
    const section = [department, category].filter(Boolean).join(' · ').slice(0, 200)
    const description = cleanText(body.description, 5000)
    const priority = cleanText(body.priority, 20)
    const page_url = cleanText(body.page_url, 1000)
    const user_agent = cleanText(body.user_agent, 1000)
    const screenshot_url = cleanText(body.screenshot_url, 1000) || null
    const five_whys = Array.isArray(body.five_whys)
      ? body.five_whys.slice(0, 5).map((value) => cleanText(value, 1000))
      : ['', '', '', '', '']
    while (five_whys.length < 5) five_whys.push('')
    const type = legacyFeedbackType(issueKind)

    if (!department || !category || !description || !PRIORITIES.has(priority)) {
      return NextResponse.json(
        { error: 'A valid issue type, work area, process, impact, and description are required.' },
        { status: 400 }
      )
    }

    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user?.email) return NextResponse.json({ error: 'You must be signed in to raise an Andon.' }, { status: 401 })
    const agent = resolveAgentTelephonyProfile(user.email)

    const extendedPayload = {
      type,
      issue_kind: issueKind,
      section,
      department,
      category,
      description,
      five_whys,
      priority,
      page_url,
      user_agent,
      agent_id: user.id,
      agent_name: agent.displayName,
      screenshot_url,
      status: 'open',
    }

    let { data, error } = await supabase
      .from('feedback_submissions')
      .insert(extendedPayload)
      .select()
      .single()

    const missingStructuredColumns = error && (
      error.code === 'PGRST204' ||
      /issue_kind|department|category|five_whys|schema cache|column/i.test(error.message ?? '')
    )

    if (missingStructuredColumns) {
      const fallback = await supabase
        .from('feedback_submissions')
        .insert({
          type,
          section,
          description: encodeLegacyAndon({ issueKind, description, fiveWhys: five_whys }),
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
      data = fallback.data
      error = fallback.error
    }

    if (error) {
      console.error('Error submitting feedback:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      feedback_id: data.id,
      message: 'Andon submitted successfully',
    })
  } catch (error: unknown) {
    console.error('Feedback submission error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit Andon.' }, { status: 500 })
  }
}
