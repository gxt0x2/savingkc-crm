import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

/**
 * POST /api/feedback/update-status
 * Updates status of feedback or error item (FBK-04)
 */
export async function POST(req: NextRequest) {
  try {
    const { id, source, status } = await req.json()

    if (!id || !source || !status) {
      return NextResponse.json({ error: 'Missing required fields: id, source, status' }, { status: 400 })
    }

    if (source === 'feedback') {
      const updateData: any = { status }
      if (status === 'resolved' || status === 'closed') {
        updateData.resolved_at = new Date().toISOString()
      }

      const { error } = await supabase
        .from('feedback_submissions')
        .update(updateData)
        .eq('id', id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else if (source === 'error_log') {
      const { error } = await supabase
        .from('error_log')
        .update({
          resolved: status === 'resolved',
          resolved_at: status === 'resolved' ? new Date().toISOString() : null,
        })
        .eq('id', id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, message: 'Status updated' })
  } catch (error: any) {
    console.error('Status update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
