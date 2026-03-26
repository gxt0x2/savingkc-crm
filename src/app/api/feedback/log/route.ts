import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/feedback/log
 * Returns combined feedback_submissions + error_log (FBK-03)
 * Query params: type (bug|feature|feedback|error), status, section
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const filterType = searchParams.get('type')
    const filterStatus = searchParams.get('status')
    const filterSection = searchParams.get('section')

    // Fetch feedback submissions
    let feedbackQuery = supabase
      .from('feedback_submissions')
      .select('*')
      .order('created_at', { ascending: false })

    if (filterType && filterType !== 'error') {
      feedbackQuery = feedbackQuery.eq('type', filterType)
    }
    if (filterStatus) {
      feedbackQuery = feedbackQuery.eq('status', filterStatus)
    }
    if (filterSection) {
      feedbackQuery = feedbackQuery.eq('section', filterSection)
    }

    const { data: feedback, error: feedbackError } = await feedbackQuery

    // Fetch error log
    let errorQuery = supabase
      .from('error_log')
      .select('*')
      .order('created_at', { ascending: false })

    if (filterStatus) {
      const resolved = filterStatus === 'resolved'
      errorQuery = errorQuery.eq('resolved', resolved)
    }

    const { data: errors, error: errorError } = filterType === 'error' || !filterType ? await errorQuery : { data: [], error: null }

    if (feedbackError || errorError) {
      console.error('Error fetching feedback log:', feedbackError || errorError)
      return NextResponse.json({ error: 'Failed to fetch feedback log' }, { status: 500 })
    }

    // Combine and format
    const combined = [
      ...(feedback || []).map((f) => ({
        id: f.id,
        type: f.type,
        section: f.section,
        description: f.description,
        priority: f.priority,
        status: f.status,
        created_at: f.created_at,
        agent_name: f.agent_name,
        page_url: f.page_url,
        source: 'feedback',
      })),
      ...(errors || []).map((e) => ({
        id: e.id,
        type: 'error',
        section: 'System',
        description: e.message,
        priority: e.error_type === 'frontend_crash' ? 'high' : 'medium',
        status: e.resolved ? 'resolved' : 'open',
        created_at: e.created_at,
        agent_name: e.agent_name,
        page_url: e.page_url,
        source: 'error_log',
        error_type: e.error_type,
        stack_trace: e.stack_trace,
      })),
    ]

    // Sort by created_at descending
    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({ items: combined, total: combined.length })
  } catch (error: any) {
    console.error('Feedback log error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
