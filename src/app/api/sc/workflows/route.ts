import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** One step in a workflow builder payload. */
interface StepInput {
  delay_days?: number
  delay_hours?: number
  body?: string
  template_id?: string | null
}

/** Insert steps for a workflow, ordered by array index. Assumes prior steps cleared. */
async function insertSteps(
  db: ReturnType<typeof supabaseAdmin>,
  workflowId: string,
  steps: StepInput[],
): Promise<string | null> {
  const rows = (steps || [])
    .filter((s) => (s.body || '').trim().length > 0)
    .map((s, i) => ({
      workflow_id: workflowId,
      step_order: i,
      delay_days: Math.max(0, Math.floor(Number(s.delay_days) || 0)),
      delay_hours: Math.max(0, Math.floor(Number(s.delay_hours) || 0)),
      channel: 'sms' as const,
      body: String(s.body).trim(),
      template_id: s.template_id ?? null,
    }))
  if (rows.length === 0) return null
  const { error } = await db.from('sc_workflow_steps').insert(rows)
  return error ? error.message : null
}

/**
 * GET /api/sc/workflows
 * List workflows with derived day_span (max cumulative delay_days), message_count
 * (step count), and active enrollment count.
 */
export async function GET() {
  const db = supabaseAdmin()
  const { data: workflows, error } = await db
    .from('sc_workflows')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (workflows || []).map((w) => w.id)

  // Steps for day_span + message_count.
  const stepsByWf: Record<string, { delay_days: number }[]> = {}
  if (ids.length) {
    const { data: steps } = await db
      .from('sc_workflow_steps')
      .select('workflow_id, delay_days, step_order')
      .in('workflow_id', ids)
      .order('step_order', { ascending: true })
    for (const s of steps || []) {
      ;(stepsByWf[s.workflow_id] ||= []).push({ delay_days: s.delay_days })
    }
  }

  // Active enrollment counts.
  const activeByWf: Record<string, number> = {}
  if (ids.length) {
    const { data: enrolls } = await db
      .from('sc_workflow_enrollments')
      .select('workflow_id')
      .in('workflow_id', ids)
      .eq('status', 'active')
    for (const e of enrolls || []) {
      activeByWf[e.workflow_id] = (activeByWf[e.workflow_id] || 0) + 1
    }
  }

  const enriched = (workflows || []).map((w) => {
    const steps = stepsByWf[w.id] || []
    const daySpan = steps.reduce((sum, s) => sum + (s.delay_days || 0), 0)
    return {
      ...w,
      day_span: daySpan,
      message_count: steps.length,
      active_count: activeByWf[w.id] || 0,
    }
  })

  return NextResponse.json({ workflows: enriched })
}

/**
 * POST /api/sc/workflows
 * Create a workflow + steps.
 * Body: { name, trigger?, from_strategy?, sending_number_ids?, steps: StepInput[] }
 */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const { data: workflow, error } = await db
    .from('sc_workflows')
    .insert({
      name: String(body.name).trim(),
      status: 'draft',
      trigger: body.trigger || 'manual',
      from_strategy: body.from_strategy === 'single' ? 'single' : 'pool',
      sending_number_ids: Array.isArray(body.sending_number_ids) ? body.sending_number_ids : [],
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stepErr = await insertSteps(db, workflow.id, body.steps || [])
  if (stepErr) return NextResponse.json({ error: stepErr }, { status: 500 })

  return NextResponse.json({ workflow })
}

/**
 * PATCH /api/sc/workflows
 * Update a workflow. If `steps` provided, replace all existing steps.
 * Body: { id, name?, status?, trigger?, from_strategy?, sending_number_ids?, steps? }
 */
export async function PATCH(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.status !== undefined) patch.status = body.status
  if (body.trigger !== undefined) patch.trigger = body.trigger
  if (body.from_strategy !== undefined) {
    patch.from_strategy = body.from_strategy === 'single' ? 'single' : 'pool'
  }
  if (body.sending_number_ids !== undefined) {
    patch.sending_number_ids = Array.isArray(body.sending_number_ids) ? body.sending_number_ids : []
  }

  if (Object.keys(patch).length) {
    const { error } = await db.from('sc_workflows').update(patch).eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (Array.isArray(body.steps)) {
    // Replace steps wholesale.
    const { error: delErr } = await db
      .from('sc_workflow_steps')
      .delete()
      .eq('workflow_id', body.id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    const stepErr = await insertSteps(db, body.id, body.steps)
    if (stepErr) return NextResponse.json({ error: stepErr }, { status: 500 })
  }

  const { data: workflow, error } = await db
    .from('sc_workflows')
    .select('*')
    .eq('id', body.id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workflow })
}

/** DELETE /api/sc/workflows?id= — delete a workflow (steps + enrollments cascade). */
export async function DELETE(req: Request) {
  const db = supabaseAdmin()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { error } = await db.from('sc_workflows').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
