export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

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
