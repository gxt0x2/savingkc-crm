import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    // For tasks, allow metadata updates
    if (activity_type === 'task' && metadata) {
      updateData.metadata = metadata
    }

    const { data, error } = await supabase
      .from('lead_activities')
      .update(updateData)
      .eq('id', id)
      .in('activity_type', ['note', 'task'])
      .select('id, activity_type, description, agent, metadata, created_at')
      .single()

    if (error) {
      console.error('Failed to update note:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update note' },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Note not found' },
        { status: 404 }
      )
    }

    // Get lead_id to trigger manifest update
    const { data: activityData } = await supabase
      .from('lead_activities')
      .select('lead_id')
      .eq('id', id)
      .single()

    if (activityData?.lead_id) {
      // Trigger manifest update + briefing refresh via server API
      fetch(`${req.nextUrl.origin}/api/leads`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activityData.lead_id,
          activity: {
            type: 'note',
            disposition: 'note_updated',
            notes: description.trim(),
          },
        }),
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, activity: data })
  } catch (err) {
    console.error('Error updating note:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
