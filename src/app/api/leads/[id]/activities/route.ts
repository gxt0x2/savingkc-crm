export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)
    const limit = Math.min(Math.max(limitParam, 1), 100)

    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, activity_type, description, agent, metadata, created_at')
      .eq('lead_id', id)
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
    const body = await req.json() as { description?: string }
    const description = body.description?.trim()

    if (!id || !description) {
      return NextResponse.json({ success: false, error: 'lead id and description required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: id,
        activity_type: 'note',
        description,
        agent: actor.name,
        metadata: { internal: true },
      })
      .select('id, activity_type, description, agent, metadata, created_at')
      .single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, activity: data }, { status: 201 })
  } catch (err) {
    console.error('[leads/:id/activities] create note failed:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
