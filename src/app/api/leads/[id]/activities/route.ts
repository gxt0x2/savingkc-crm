export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { buildLeadActivityInsert } from '@/lib/server/lead-activity-command'
import { syncLeadActivityCreated } from '@/lib/lead-activity-sync'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await requireAuthenticatedUser({ success: false, error: 'Unauthorized' })
    if (unauthorized) return unauthorized

    const { id } = await params
    const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)
    const limit = Math.min(Math.max(limitParam, 1), 100)
    const activityType = req.nextUrl.searchParams.get('type')?.trim() || null

    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })
    }
    if (activityType && !/^[a-z][a-z0-9_]{0,49}$/.test(activityType)) {
      return NextResponse.json({ success: false, error: 'invalid activity type' }, { status: 400 })
    }

    let query = supabase
      .from('lead_activities')
      .select('id, activity_type, description, agent, metadata, created_at')
      .eq('lead_id', id)
    if (activityType) query = query.eq('activity_type', activityType)

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[leads/:id/activities] fetch failed:', error.message)
      return NextResponse.json({ success: false, activities: [], error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, activities: data || [] })
  } catch (err) {
    console.error('[leads/:id/activities] unexpected error:', err)
    return NextResponse.json({ success: false, activities: [], error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()

    if (!id) {
      return NextResponse.json({ success: false, error: 'lead id required' }, { status: 400 })
    }

    const command = buildLeadActivityInsert(id, actor.name, body)
    if (!command.ok) {
      return NextResponse.json({ success: false, error: command.error }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('lead_activities')
      .insert(command.insert)
      .select('id, activity_type, description, agent, metadata, created_at')
      .single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    let projectionSynced = false
    try {
      projectionSynced = await syncLeadActivityCreated({
        leadId: id,
        activityId: data.id,
        activityType: data.activity_type,
        description: data.description,
        actorName: actor.name,
      })
    } catch (error) {
      console.error('[leads/:id/activities] projection sync failed:', error)
    }

    return NextResponse.json({
      success: true,
      activity: data,
      ...(projectionSynced ? {} : {
        warning: 'Activity saved, but the lead briefing could not be refreshed.',
      }),
    }, { status: 201 })
  } catch (err) {
    console.error('[leads/:id/activities] create note failed:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
