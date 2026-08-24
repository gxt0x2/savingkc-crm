import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { supabase } from '@/lib/supabase-lazy'

const EDITABLE_ACTIVITY_TYPES = ['note', 'letter_tracking']
const TASK_ACTIVITY_TYPES = ['task', 'appointment', 'follow_up', 'callback', 'send_offer']

function canonicalTaskMutationResponse(id: string) {
  return NextResponse.json({
    success: false,
    error: 'Task mutations moved to the canonical work-item service',
    replacement: `/api/calendar/tasks/${encodeURIComponent(id)}`,
  }, { status: 410 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedActor = await resolveAuthenticatedActor()
    if (!authenticatedActor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()
    const { description, activity_type: activityType } = body

    if (typeof activityType === 'string' && TASK_ACTIVITY_TYPES.includes(activityType)) {
      return canonicalTaskMutationResponse(id)
    }

    if (!description || typeof description !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Description is required' },
        { status: 400 }
      )
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      description: description.trim()
    }

    const { data, error } = await supabase
      .from('lead_activities')
      .update(updateData)
      .eq('id', id)
      .in('activity_type', EDITABLE_ACTIVITY_TYPES)
      .select('id, activity_type, description, agent, metadata, created_at')
      .single()

    if (error) {
      console.error('Failed to update activity:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update activity' },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Activity not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      activity: data,
    })
  } catch (err) {
    console.error('Error updating note:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedActor = await resolveAuthenticatedActor()
    if (!authenticatedActor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Read the immutable activity kind before enforcing the deletion boundary.
    const { data: activityData } = await supabase
      .from('lead_activities')
      .select('lead_id, activity_type')
      .eq('id', id)
      .single()

    // Task-shaped activities are cancelled through the canonical work-item
    // service. This generic route is limited to editable notes and mail logs.
    if (activityData && TASK_ACTIVITY_TYPES.includes(activityData.activity_type)) {
      return canonicalTaskMutationResponse(id)
    }
    if (activityData && !EDITABLE_ACTIVITY_TYPES.includes(activityData.activity_type)) {
      return NextResponse.json(
        { success: false, error: 'Cannot delete this activity type' },
        { status: 403 }
      )
    }

    const { error } = await supabase
      .from('lead_activities')
      .delete()
      .eq('id', id)
      .in('activity_type', EDITABLE_ACTIVITY_TYPES)

    if (error) {
      console.error('Failed to delete activity:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to delete activity' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
    })
  } catch (err) {
    console.error('Error deleting activity:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
