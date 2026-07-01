import { NextResponse } from 'next/server'
import { parse } from 'csv-parse/sync'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { runSkiptrace, type SkiptraceRow } from '@/lib/smartercontact/skiptrace'

/** GET /api/sc/skiptrace — list jobs, newest first. */
export async function GET() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('sc_skiptrace_jobs')
    .select('id, filename, status, total_rows, matched_rows, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data || [] })
}

/**
 * POST /api/sc/skiptrace — multipart form-data with a "file" CSV.
 * Parses the CSV, creates a job (processing), runs a best-effort append via the
 * provider abstraction, then finalizes the job. Never throws.
 */
export async function POST(req: Request) {
  const db = supabaseAdmin()

  let filename = 'upload.csv'
  let rows: SkiptraceRow[]
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }
    filename = file.name || filename
    const text = await file.text()
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as SkiptraceRow[]
  } catch (err) {
    return NextResponse.json(
      { error: `Could not parse CSV: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 })
  }

  // Create the job row up front so it appears in the list while processing.
  const { data: job, error: insertErr } = await db
    .from('sc_skiptrace_jobs')
    .insert({ filename, status: 'processing', total_rows: rows.length })
    .select()
    .single()
  if (insertErr || !job) {
    return NextResponse.json(
      { error: insertErr?.message || 'Could not create job' },
      { status: 500 },
    )
  }

  try {
    const result = await runSkiptrace(rows)
    const { data: finished, error: updErr } = await db
      .from('sc_skiptrace_jobs')
      .update({
        status: 'completed',
        matched_rows: result.matched,
        result: { rows: result.rows, note: result.note, providerRan: result.providerRan },
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .select('id, filename, status, total_rows, matched_rows, created_at, completed_at')
      .single()
    if (updErr) throw new Error(updErr.message)
    return NextResponse.json({ job: { ...finished, note: result.note } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const { data: failed } = await db
      .from('sc_skiptrace_jobs')
      .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
      .eq('id', job.id)
      .select('id, filename, status, total_rows, matched_rows, created_at')
      .single()
    return NextResponse.json({ job: failed, error: message }, { status: 200 })
  }
}
