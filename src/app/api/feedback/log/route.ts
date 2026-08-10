import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { decodeLegacyAndon, inferAndonIssueKind, isAndonIssueKind } from '@/lib/andon'

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
    const from = searchParams.get('from')
    const to = searchParams.get('to')

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
    if (from) feedbackQuery = feedbackQuery.gte('created_at', from)
    if (to) feedbackQuery = feedbackQuery.lte('created_at', to)

    const { data: feedback, error: feedbackError } = await feedbackQuery

    // Fetch error log
    let errorQuery = supabase
      .from('error_log')
      .select('*')
      .order('created_at', { ascending: false })

    const errorStatusSupported = !filterStatus || ['open', 'resolved', 'closed'].includes(filterStatus)
    if (filterStatus && errorStatusSupported) {
      const resolved = ['resolved', 'closed'].includes(filterStatus)
      errorQuery = errorQuery.eq('resolved', resolved)
    }
    if (from) errorQuery = errorQuery.gte('created_at', from)
    if (to) errorQuery = errorQuery.lte('created_at', to)

    const shouldFetchErrors = (filterType === 'error' || !filterType) && errorStatusSupported
    const { data: errors, error: errorError } = shouldFetchErrors ? await errorQuery : { data: [], error: null }

    if (feedbackError || errorError) {
      console.error('Error fetching feedback log:', feedbackError || errorError)
      return NextResponse.json({ error: 'Failed to fetch feedback log' }, { status: 500 })
    }

    // Combine and format
    const combined = [
      ...(feedback || []).map((f) => {
        const decoded = decodeLegacyAndon(f.description)
        const [legacyDepartment = 'Other', legacyCategory = 'General'] = String(f.section ?? '').split(' · ')
        const issueKind = isAndonIssueKind(f.issue_kind) ? f.issue_kind : inferAndonIssueKind(f.type, f.description)
        return {
          id: f.id,
          type: f.type,
          issue_kind: issueKind,
          section: f.section,
          department: f.department || legacyDepartment,
          category: f.category || legacyCategory,
          description: decoded.happened,
          five_whys: Array.isArray(f.five_whys) ? f.five_whys : decoded.fiveWhys,
          priority: f.priority,
          status: f.status,
          created_at: f.created_at,
          updated_at: f.updated_at,
          resolved_at: f.resolved_at,
          agent_name: f.agent_name,
          page_url: f.page_url,
          source: 'feedback',
        }
      }),
      ...(errors || []).map((e) => ({
        id: e.id,
        type: 'error',
        issue_kind: 'system',
        section: 'System',
        department: 'System',
        category: e.error_type || 'Automatic error',
        description: e.message,
        five_whys: [],
        priority: e.error_type === 'frontend_crash' ? 'high' : 'medium',
        status: e.resolved ? 'resolved' : 'open',
        created_at: e.created_at,
        resolved_at: e.resolved_at,
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
  } catch (error: unknown) {
    console.error('Feedback log error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Andons.' }, { status: 500 })
  }
}
