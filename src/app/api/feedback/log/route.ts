import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { decodeLegacyAndon, extractAndonRecordContext, inferAndonIssueKind, isAndonIssueKind } from '@/lib/andon'
import { ensureAndonStorage } from '@/lib/andon-storage'

function storageMissing(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === 'PGRST205' || /could not find the table|schema cache/i.test(error.message ?? '')))
}

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

    const errorStatusSupported = !filterStatus || ['open', 'resolved', 'closed'].includes(filterStatus)
    const shouldFetchErrors = (filterType === 'error' || !filterType) && errorStatusSupported

    const fetchFeedback = async () => {
      let query = supabase.from('feedback_submissions').select('*').order('created_at', { ascending: false })
      if (filterType && filterType !== 'error') query = query.eq('type', filterType)
      if (filterStatus) query = query.eq('status', filterStatus)
      if (filterSection) query = query.eq('section', filterSection)
      if (from) query = query.gte('created_at', from)
      if (to) query = query.lte('created_at', to)
      return query
    }
    const fetchErrors = async () => {
      if (!shouldFetchErrors) return { data: [], error: null }
      let query = supabase.from('error_log').select('*').order('created_at', { ascending: false })
      if (filterStatus) query = query.eq('resolved', ['resolved', 'closed'].includes(filterStatus))
      if (from) query = query.gte('created_at', from)
      if (to) query = query.lte('created_at', to)
      return query
    }

    let [feedbackResult, errorResult] = await Promise.all([fetchFeedback(), fetchErrors()])
    if (storageMissing(feedbackResult.error) || storageMissing(errorResult.error)) {
      const repaired = await ensureAndonStorage()
      if (repaired) [feedbackResult, errorResult] = await Promise.all([fetchFeedback(), fetchErrors()])
    }

    const { data: feedback, error: feedbackError } = feedbackResult
    const { data: errors, error: errorError } = errorResult

    const warnings: string[] = []
    if (feedbackError) {
      console.error('Error fetching feedback submissions:', feedbackError)
      warnings.push(feedbackError.code === 'PGRST205' ? 'Andon storage is not initialized.' : 'Agent-submitted Andons are temporarily unavailable.')
    }
    if (errorError) {
      console.error('Error fetching automatic error log:', errorError)
      warnings.push(errorError.code === 'PGRST205' ? 'Automatic error storage is not initialized.' : 'Automatic system errors are temporarily unavailable.')
    }

    // Combine and format
    const combined = [
      ...(feedback || []).map((f) => {
        const decoded = decodeLegacyAndon(f.description)
        const [legacyDepartment = 'Other', legacyCategory = 'General'] = String(f.section ?? '').split(' · ')
        const issueKind = isAndonIssueKind(f.issue_kind) ? f.issue_kind : inferAndonIssueKind(f.type, f.description)
        const recordContext = extractAndonRecordContext(f.record_url || f.page_url || '')
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
          record_id: f.record_id || recordContext.recordId,
          record_type: f.record_type || recordContext.recordType,
          record_url: f.record_url || recordContext.recordUrl || f.page_url,
          assignee: f.assignee || null,
          notes: Array.isArray(f.notes) ? f.notes : [],
          chat_space_id: f.chat_space_id || null,
          chat_thread_id: f.chat_thread_id || null,
          estimated_resolution_at: f.estimated_resolution_at || null,
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
        five_whys: Array.isArray(e.five_whys) ? e.five_whys : [],
        priority: e.error_type === 'frontend_crash' ? 'high' : 'medium',
        status: e.resolved ? 'resolved' : 'open',
        created_at: e.created_at,
        resolved_at: e.resolved_at,
        record_id: extractAndonRecordContext(e.page_url || '').recordId,
        record_type: extractAndonRecordContext(e.page_url || '').recordType,
        record_url: e.page_url,
        assignee: e.assignee || null,
        estimated_resolution_at: e.estimated_resolution_at || null,
        agent_name: e.agent_name,
        page_url: e.page_url,
        source: 'error_log',
        error_type: e.error_type,
        stack_trace: e.stack_trace,
      })),
    ]

    // Sort by created_at descending
    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({
      items: combined,
      total: combined.length,
      warnings,
      storage_ready: !feedbackError,
      automatic_error_log_ready: !errorError,
    })
  } catch (error: unknown) {
    console.error('Feedback log error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Andons.' }, { status: 500 })
  }
}
