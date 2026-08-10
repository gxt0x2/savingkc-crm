import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { ANDON_STATUSES, encodeLegacyAndon, isAndonIssueKind } from '@/lib/andon'

const VALID_STATUSES = new Set<string>(ANDON_STATUSES)

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

/**
 * POST /api/feedback/update-status
 * Updates status of feedback or error item (FBK-04)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>
    const id = cleanText(body.id, 100)
    const source = cleanText(body.source, 30)
    const status = cleanText(body.status, 30)
    const description = cleanText(body.description, 5000)
    const issueKind = isAndonIssueKind(body.issue_kind) ? body.issue_kind : 'data'
    const fiveWhys = Array.isArray(body.five_whys)
      ? body.five_whys.slice(0, 5).map((value) => cleanText(value, 1000))
      : null

    if (!id || !['feedback', 'error_log'].includes(source) || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'A valid Andon, source, and status are required.' }, { status: 400 })
    }
    if (source === 'error_log' && !['open', 'resolved', 'closed'].includes(status)) {
      return NextResponse.json({ error: 'Automatic system errors support open or resolved status.' }, { status: 400 })
    }

    if (source === 'feedback') {
      const updateData: Record<string, unknown> = { status }
      if (status === 'resolved' || status === 'closed') {
        updateData.resolved_at = new Date().toISOString()
      } else {
        updateData.resolved_at = null
      }
      if (fiveWhys) updateData.five_whys = fiveWhys

      let { error } = await supabase
        .from('feedback_submissions')
        .update(updateData)
        .eq('id', id)

      if (error && fiveWhys && /five_whys|schema cache|column/i.test(error.message ?? '')) {
        const fallbackUpdate = {
          status,
          resolved_at: updateData.resolved_at,
          description: encodeLegacyAndon({ issueKind, description, fiveWhys }),
        }
        const fallback = await supabase.from('feedback_submissions').update(fallbackUpdate).eq('id', id)
        error = fallback.error
      }

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else if (source === 'error_log') {
      const { error } = await supabase
        .from('error_log')
        .update({
          resolved: status === 'resolved' || status === 'closed',
          resolved_at: status === 'resolved' || status === 'closed' ? new Date().toISOString() : null,
        })
        .eq('id', id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, message: 'Status updated' })
  } catch (error: unknown) {
    console.error('Status update error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update Andon.' }, { status: 500 })
  }
}
