import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/system-health/agent-status
 * Returns agent-facing status page data (FBK-10)
 */
export async function GET() {
  try {
    // Known Issues - bugs that are open or in progress
    const { data: knownIssues } = await supabase
      .from('feedback_submissions')
      .select('id, type, section, description, status, created_at')
      .eq('type', 'bug')
      .in('status', ['open', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(10)

    // Coming Soon - features that are in progress or testing
    const { data: comingSoon } = await supabase
      .from('feedback_submissions')
      .select('id, type, section, description, status, created_at')
      .eq('type', 'feature')
      .in('status', ['in_progress', 'testing'])
      .order('created_at', { ascending: false })
      .limit(10)

    // Recently Shipped - items resolved in last 14 days
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const { data: recentlyShipped } = await supabase
      .from('feedback_submissions')
      .select('id, type, section, description, status, created_at, resolved_at')
      .eq('status', 'resolved')
      .gte('resolved_at', fourteenDaysAgo.toISOString())
      .order('resolved_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      known_issues: knownIssues || [],
      coming_soon: comingSoon || [],
      recently_shipped: recentlyShipped || [],
    })
  } catch (error: any) {
    console.error('Agent status error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
