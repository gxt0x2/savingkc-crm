import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { syncLeadActivityMutation } from '@/lib/lead-activity-sync'

const EDITABLE_ACTIVITY_TYPES = ['note', 'task', 'appointment', 'follow_up', 'callback', 'send_offer']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { description, metadata, activity_type } = body

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

    // For calendar-style tasks, allow metadata updates while preserving the row's existing activity_type.
    if (activity_type === 'task' && metadata) {
      updateData.metadata = metadata
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

    // Get lead_id to trigger manifest update
    const { data: activityData } = await supabase
      .from('lead_activities')
      .select('lead_id')
      .eq('id', id)
      .single()

    const projectionSynced = activityData?.lead_id
      ? await syncLeadActivityMutation({
        leadId: activityData.lead_id,
        activityId: id,
        activityType: data.activity_type,
        mutation: 'updated',
      })
      : true

    return NextResponse.json({
      success: true,
      activity: data,
      ...(projectionSynced ? {} : {
        warning: 'Activity saved, but the lead briefing could not be refreshed.',
      }),
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
    const { id } = await params

    // Get lead_id before deletion for manifest update
    const { data: activityData } = await supabase
      .from('lead_activities')
      .select('lead_id, activity_type')
      .eq('id', id)
      .single()

    // Only allow deletion of notes and calendar-style tasks.
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

    // Trigger manifest update
    const projectionSynced = activityData?.lead_id
      ? await syncLeadActivityMutation({
        leadId: activityData.lead_id,
        activityId: id,
        activityType: activityData.activity_type,
        mutation: 'deleted',
      })
      : true

    return NextResponse.json({
      success: true,
      ...(projectionSynced ? {} : {
        warning: 'Activity deleted, but the lead briefing could not be refreshed.',
      }),
    })
  } catch (err) {
    console.error('Error deleting activity:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
