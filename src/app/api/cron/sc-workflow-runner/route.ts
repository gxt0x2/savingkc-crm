import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scSendSms } from '@/lib/smartercontact/messaging'
import { renderMessage, type MergeContext } from '@/lib/smartercontact/spintax'
import { nextRunAt } from '@/lib/smartercontact/workflow-schedule'

const BATCH_SIZE = 200

interface WorkflowStepRow {
  id: string
  step_order: number
  delay_days: number
  delay_hours: number
  body: string
}

interface WorkflowRow {
  id: string
  status: string
  from_strategy: string
  sending_number_ids: string[]
}

async function run(req: NextRequest) {
  // CRON_SECRET auth (same pattern as process-mojo-queue).
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = supabaseAdmin()
  const now = new Date()
  const nowIso = now.toISOString()

  const { data: due, error } = await db
    .from('sc_workflow_enrollments')
    .select('id, workflow_id, contact_id, phone, current_step')
    .eq('status', 'active')
    .lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let processed = 0
  let sent = 0
  let completed = 0
  let stopped = 0

  // Cache workflows + steps to avoid refetching per enrollment.
  const wfCache = new Map<string, WorkflowRow | null>()
  const stepsCache = new Map<string, WorkflowStepRow[]>()

  async function loadWorkflow(wfId: string): Promise<WorkflowRow | null> {
    if (wfCache.has(wfId)) return wfCache.get(wfId)!
    const { data } = await db
      .from('sc_workflows')
      .select('id, status, from_strategy, sending_number_ids')
      .eq('id', wfId)
      .maybeSingle()
    const row = (data as WorkflowRow | null) ?? null
    wfCache.set(wfId, row)
    return row
  }

  async function loadSteps(wfId: string): Promise<WorkflowStepRow[]> {
    if (stepsCache.has(wfId)) return stepsCache.get(wfId)!
    const { data } = await db
      .from('sc_workflow_steps')
      .select('id, step_order, delay_days, delay_hours, body')
      .eq('workflow_id', wfId)
      .order('step_order', { ascending: true })
    const rows = (data as WorkflowStepRow[]) ?? []
    stepsCache.set(wfId, rows)
    return rows
  }

  for (const enr of due || []) {
    processed++

    const workflow = await loadWorkflow(enr.workflow_id)
    // Only run active workflows; leave paused/draft enrollments untouched for later.
    if (!workflow || workflow.status !== 'active') continue

    const steps = await loadSteps(enr.workflow_id)
    const step = steps[enr.current_step]

    // No step at this index → the sequence is finished.
    if (!step) {
      await db
        .from('sc_workflow_enrollments')
        .update({ status: 'completed', completed_at: nowIso })
        .eq('id', enr.id)
      completed++
      continue
    }

    // Build merge context from the contact (by id, else by phone).
    let ctx: MergeContext = { phone: enr.phone }
    let contact: Record<string, unknown> | null = null
    if (enr.contact_id) {
      const { data } = await db
        .from('sc_contacts')
        .select('first_name, last_name, phone, email, address, city, state, zip, custom_fields')
        .eq('id', enr.contact_id)
        .maybeSingle()
      contact = data
    }
    if (!contact) {
      const { data } = await db
        .from('sc_contacts')
        .select('first_name, last_name, phone, email, address, city, state, zip, custom_fields')
        .eq('phone', enr.phone)
        .maybeSingle()
      contact = data
    }
    if (contact) ctx = { ...contact, phone: (contact.phone as string) || enr.phone }

    const rendered = renderMessage(step.body, ctx, enr.phone)

    const result = await scSendSms({
      toPhone: enr.phone,
      body: rendered,
      poolIds:
        workflow.from_strategy === 'pool' && workflow.sending_number_ids?.length
          ? workflow.sending_number_ids
          : undefined,
      contactId: enr.contact_id,
      workflowId: workflow.id,
      sticky: false,
    })

    if (result.skipped === 'opted_out') {
      await db
        .from('sc_workflow_enrollments')
        .update({ status: 'stopped' })
        .eq('id', enr.id)
      stopped++
      continue
    }

    if (result.success) sent++

    // Advance the enrollment regardless of transient send failure (avoid retry storms);
    // failures are logged in sc_messages by scSendSms.
    const nextIndex = enr.current_step + 1
    const nextStep = steps[nextIndex]
    if (nextStep) {
      await db
        .from('sc_workflow_enrollments')
        .update({ current_step: nextIndex, next_run_at: nextRunAt(nextStep, now) })
        .eq('id', enr.id)
    } else {
      await db
        .from('sc_workflow_enrollments')
        .update({ current_step: nextIndex, status: 'completed', completed_at: nowIso })
        .eq('id', enr.id)
      completed++
    }
  }

  // Keep enrolled_count (active) fresh for the workflows touched this run.
  const touchedWfIds = [...wfCache.keys()]
  for (const wfId of touchedWfIds) {
    const { count } = await db
      .from('sc_workflow_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('workflow_id', wfId)
      .eq('status', 'active')
    await db.from('sc_workflows').update({ enrolled_count: count || 0 }).eq('id', wfId)
  }

  return NextResponse.json({ processed, sent, completed, stopped })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
