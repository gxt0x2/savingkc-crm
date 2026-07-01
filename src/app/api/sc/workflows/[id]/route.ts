import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { nextRunAt } from '@/lib/smartercontact/workflow-schedule'

/**
 * GET /api/sc/workflows/[id]
 * Returns the workflow, its ordered steps, and enrollment counts by status.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseAdmin()

  const { data: workflow, error } = await db
    .from('sc_workflows')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: steps } = await db
    .from('sc_workflow_steps')
    .select('*')
    .eq('workflow_id', id)
    .order('step_order', { ascending: true })

  const { data: enrolls } = await db
    .from('sc_workflow_enrollments')
    .select('status')
    .eq('workflow_id', id)

  const counts = { active: 0, completed: 0, stopped: 0 }
  for (const e of enrolls || []) {
    if (e.status in counts) counts[e.status as keyof typeof counts]++
  }

  return NextResponse.json({ workflow, steps: steps || [], enrollment_counts: counts })
}

/**
 * POST /api/sc/workflows/[id]
 * Body: { action: 'enroll' | 'stop' | 'activate' | 'pause', ... }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  const action = body.action as string

  if (action === 'activate' || action === 'pause') {
    const status = action === 'activate' ? 'active' : 'paused'
    const { data, error } = await db
      .from('sc_workflows')
      .update({ status })
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ workflow: data })
  }

  if (action === 'stop') {
    let q = db.from('sc_workflow_enrollments').update({ status: 'stopped' }).eq('workflow_id', id)
    if (body.enrollmentId) q = q.eq('id', body.enrollmentId)
    else if (body.phone) q = q.eq('phone', body.phone)
    else return NextResponse.json({ error: 'Missing enrollmentId or phone' }, { status: 400 })
    const { error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'enroll') {
    // First step determines the initial next_run_at.
    const { data: steps } = await db
      .from('sc_workflow_steps')
      .select('delay_days, delay_hours, step_order')
      .eq('workflow_id', id)
      .order('step_order', { ascending: true })
    if (!steps || steps.length === 0) {
      return NextResponse.json({ error: 'Workflow has no steps' }, { status: 400 })
    }
    const firstRunAt = nextRunAt(steps[0])

    // Resolve targets → [{ contact_id, phone }].
    const targets: { contact_id: string | null; phone: string }[] = []

    if (body.group_id) {
      const { data: members } = await db
        .from('sc_group_members')
        .select('contact_id')
        .eq('group_id', body.group_id)
      const memberIds = (members || []).map((m) => m.contact_id)
      if (memberIds.length) {
        const { data: contacts } = await db
          .from('sc_contacts')
          .select('id, phone')
          .in('id', memberIds)
          .eq('status', 'active')
        for (const c of contacts || []) {
          if (c.phone) targets.push({ contact_id: c.id, phone: c.phone })
        }
      }
    }

    if (Array.isArray(body.contactIds) && body.contactIds.length) {
      const { data: contacts } = await db
        .from('sc_contacts')
        .select('id, phone')
        .in('id', body.contactIds)
      for (const c of contacts || []) {
        if (c.phone) targets.push({ contact_id: c.id, phone: c.phone })
      }
    }

    if (Array.isArray(body.phones) && body.phones.length) {
      for (const p of body.phones) {
        const phone = String(p).trim()
        if (phone) targets.push({ contact_id: null, phone })
      }
    }

    if (targets.length === 0) {
      return NextResponse.json({ error: 'No enrollable targets' }, { status: 400 })
    }

    // Dedupe by phone within this request.
    const seen = new Set<string>()
    const rows = targets
      .filter((t) => {
        if (seen.has(t.phone)) return false
        seen.add(t.phone)
        return true
      })
      .map((t) => ({
        workflow_id: id,
        contact_id: t.contact_id,
        phone: t.phone,
        status: 'active' as const,
        current_step: 0,
        next_run_at: firstRunAt,
      }))

    // Skip already-enrolled (unique on workflow_id+phone).
    const { data: inserted, error } = await db
      .from('sc_workflow_enrollments')
      .upsert(rows, { onConflict: 'workflow_id,phone', ignoreDuplicates: true })
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Recompute enrolled_count as total active enrollments.
    const { count } = await db
      .from('sc_workflow_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('workflow_id', id)
      .eq('status', 'active')
    await db.from('sc_workflows').update({ enrolled_count: count || 0 }).eq('id', id)

    return NextResponse.json({
      success: true,
      enrolled: inserted?.length || 0,
      skipped: rows.length - (inserted?.length || 0),
      active_count: count || 0,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
