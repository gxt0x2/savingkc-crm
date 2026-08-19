import { NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { supabaseAdmin } from '@/lib/supabase/admin'

const AGENT_NAMES = new Map([
  ['ernest', 'Ernest'],
  ['casey', 'Casey'],
  ['gertha', 'Gertha'],
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanAgent(value: unknown): string | null | undefined {
  if (value === null || value === '') return null
  const requested = cleanText(value)?.toLowerCase()
  return requested ? AGENT_NAMES.get(requested) : undefined
}

export async function PATCH(req: Request) {
  try {
    const authenticatedActor = await resolveAuthenticatedActor()
    if (!authenticatedActor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const leadId = cleanText(body?.leadId)
    const assignedAgent = cleanAgent(body?.assignedAgent)

    if (!leadId || !UUID_PATTERN.test(leadId)) {
      return NextResponse.json({ success: false, error: 'A valid leadId is required' }, { status: 400 })
    }
    if (assignedAgent === undefined) {
      return NextResponse.json({ success: false, error: 'Choose Ernest, Casey, Gertha, or Unassigned' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data: current, error: currentError } = await db
      .from('leads')
      .select('id, assigned_agent')
      .eq('id', leadId)
      .maybeSingle()

    if (currentError) {
      console.error('[conversations/assignment] lead lookup failed:', currentError.message)
      return NextResponse.json({ success: false, error: 'Conversation assignment could not be loaded' }, { status: 500 })
    }
    if (!current) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 })
    }

    const { error: updateError } = await db
      .from('leads')
      .update({ assigned_agent: assignedAgent, updated_at: new Date().toISOString() })
      .eq('id', leadId)

    if (updateError) {
      console.error('[conversations/assignment] lead update failed:', updateError.message)
      return NextResponse.json({ success: false, error: 'Conversation assignment could not be saved' }, { status: 500 })
    }

    const previousAgent = cleanText(current.assigned_agent)
    const label = assignedAgent ? `Conversation assigned to ${assignedAgent}` : 'Conversation returned to the team queue'
    const { error: activityError } = await db.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'status_change',
      description: label,
      agent: authenticatedActor.name,
      metadata: {
        source: 'conversation_hub',
        hub_action: assignedAgent ? 'agent_assigned' : 'agent_unassigned',
        previous_agent: previousAgent,
        assigned_agent: assignedAgent,
      },
    })

    if (activityError) {
      console.error('[conversations/assignment] audit activity failed:', activityError.message)
    }

    return NextResponse.json({
      success: true,
      assignedAgent,
      previousAgent,
      auditRecorded: !activityError,
    })
  } catch (error) {
    console.error('[conversations/assignment] error:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
