import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { SkiptraceRow } from '@/lib/smartercontact/skiptrace'

/** Escape a single CSV cell (RFC 4180): quote when it contains , " or newline. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(rows: SkiptraceRow[]): string {
  if (!rows.length) return ''
  // Union of all keys, preserving first-seen order, with phone/email last.
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k)
  const headers = [...seen]
  const lines = [headers.map(csvCell).join(',')]
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(','))
  return lines.join('\n')
}

/**
 * GET /api/sc/skiptrace/:id
 *   default          → full job JSON (including result rows)
 *   ?format=csv      → download the appended CSV
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = supabaseAdmin()
  const { data: job, error } = await db
    .from('sc_skiptrace_jobs')
    .select('*')
    .eq('id', id)
    .single()
  if (error || !job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const format = new URL(req.url).searchParams.get('format')
  if (format === 'csv') {
    const rows = (job.result?.rows as SkiptraceRow[] | undefined) || []
    const csv = toCsv(rows)
    const safeName = (job.filename || 'skiptrace').replace(/[^a-zA-Z0-9._-]/g, '_')
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="skiptrace_${safeName}"`,
      },
    })
  }

  return NextResponse.json({ job })
}
