import type { SupabaseClient } from '@supabase/supabase-js'
import { activeDispositionTasks, calculateDispositionTaskDueAt } from '@/lib/dispo/operating-lifecycle'
import type { DispoStage } from '@/types/dispo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = SupabaseClient<any, 'public', any>

export const TC_STATUSES = [
  'not_opened',
  'opening_package_needed',
  'opened',
  'emd_pending',
  'title_work',
  'clear_to_close',
  'scheduled',
  'closed',
  'cancelled',
] as const

export type TcStatus = (typeof TC_STATUSES)[number]

export const TC_RISK_LEVELS = ['normal', 'watch', 'urgent', 'blocked'] as const
export type TcRiskLevel = (typeof TC_RISK_LEVELS)[number]

export interface TcFileSummary {
  id: string
  lead_id: string
  dispo_deal_id: string | null
  buyer_offer_id: string | null
  title_company_id: string | null
  title_contact_id: string | null
  file_number: string | null
  status: TcStatus
  opened_at: string | null
  emd_due_at: string | null
  emd_confirmed_at: string | null
  title_clear_at: string | null
  closing_scheduled_at: string | null
  closing_completed_at: string | null
  hud_received_at: string | null
  assignment_fee: number | null
  revenue_logged_at: string | null
  next_action: string | null
  risk_level: TcRiskLevel
  risk_reason: string | null
  notes: string | null
}

export const STANDARD_TC_TASKS = [
  { task_type: 'send_opening_package', label: 'Send opening package to title' },
  { task_type: 'confirm_assignment_signed', label: 'Confirm assignment contract fully signed' },
  { task_type: 'confirm_emd', label: 'Confirm EMD receipt' },
  { task_type: 'confirm_file_number', label: 'Confirm title file number' },
  { task_type: 'confirm_title_clear', label: 'Confirm title clear' },
  { task_type: 'schedule_closing', label: 'Schedule closing' },
  { task_type: 'collect_hud', label: 'Collect HUD / settlement statement' },
  { task_type: 'log_assignment_revenue', label: 'Log assignment revenue' },
] as const

export interface DispositionOperatingTaskSeedContext {
  tcFileId: string
  dealStage: DispoStage
  tcStatus: TcStatus
  enteredAt: string | null
  closingAt: string | null
}

function taskOwner(lane: 'dispositions' | 'coordination' | 'shared') {
  if (lane === 'dispositions') return 'Dispositions'
  if (lane === 'coordination') return 'Closing Coordination'
  return 'Shared'
}

export async function seedDispositionOperatingTasks(
  db: DbClient,
  contexts: readonly DispositionOperatingTaskSeedContext[],
) {
  if (contexts.length === 0) return 0

  const fileIds = contexts.map((context) => context.tcFileId)
  const { data: existing, error: existingError } = await db
    .from('tc_tasks')
    .select('tc_file_id, task_type')
    .in('tc_file_id', fileIds)
  if (existingError) throw new Error(`Failed to inspect operating tasks: ${existingError.message}`)

  const existingKeys = new Set(
    (existing ?? []).map((row: { tc_file_id: string; task_type: string }) => `${row.tc_file_id}:${row.task_type}`),
  )
  const rows = contexts.flatMap((context) => {
    const lifecycleContext = {
      dealStage: context.dealStage,
      tcStatus: context.tcStatus,
      enteredAt: context.enteredAt,
      closingAt: context.closingAt,
    }
    return activeDispositionTasks(lifecycleContext)
      .filter(({ definition }) => !existingKeys.has(`${context.tcFileId}:${definition.taskType}`))
      .map(({ phase, definition }) => ({
        tc_file_id: context.tcFileId,
        task_type: definition.taskType,
        label: definition.label,
        due_at: calculateDispositionTaskDueAt(definition, lifecycleContext),
        assigned_to: taskOwner(definition.lane),
        source: 'disposition_operating_system:v1',
        notes: `Workflow phase: ${phase.label}`,
      }))
  })

  if (rows.length === 0) return 0
  const { error } = await db.from('tc_tasks').insert(rows)
  if (error) throw new Error(`Failed to seed operating tasks: ${error.message}`)
  return rows.length
}

export async function syncDispositionOperatingTasksForFile(db: DbClient, tcFileId: string) {
  const { data, error } = await db
    .from('tc_files')
    .select('id, status, created_at, closing_scheduled_at, dispo_deal:dispo_deal_id(stage, entered_at, close_date)')
    .eq('id', tcFileId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load operating task context: ${error.message}`)
  if (!data) return 0

  const deal = Array.isArray(data.dispo_deal) ? data.dispo_deal[0] : data.dispo_deal
  if (!deal?.stage) return 0
  const closingAt = data.closing_scheduled_at || (deal.close_date ? `${deal.close_date}T17:00:00.000Z` : null)
  return seedDispositionOperatingTasks(db, [{
    tcFileId: data.id,
    dealStage: deal.stage as DispoStage,
    tcStatus: data.status as TcStatus,
    enteredAt: deal.entered_at || data.created_at,
    closingAt,
  }])
}

export function isTcStatus(value: string): value is TcStatus {
  return (TC_STATUSES as readonly string[]).includes(value)
}

export function isTcRiskLevel(value: string): value is TcRiskLevel {
  return (TC_RISK_LEVELS as readonly string[]).includes(value)
}

export async function logTcEvent(
  db: DbClient,
  tcFileId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
  actor = 'system',
) {
  const { error } = await db.from('tc_events').insert({
    tc_file_id: tcFileId,
    event_type: eventType,
    payload,
    actor,
  })
  if (error) console.error('[tc] event log failed:', error)
}

export async function seedStandardTcTasks(db: DbClient, tcFileId: string) {
  await syncDispositionOperatingTasksForFile(db, tcFileId)
}

export async function ensureTcFileForDeal(
  db: DbClient,
  deal: {
    id: string
    leadId: string
    stage: DispoStage
    enteredAt?: string | null
    assignmentFee?: number | null
    closeDate?: string | null
    acceptedOfferId?: string | null
  },
) {
  const { data: existing, error: existingError } = await db
    .from('tc_files')
    .select('id')
    .eq('dispo_deal_id', deal.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError) throw new Error(`Failed to inspect closing file: ${existingError.message}`)
  if (existing?.id) {
    await syncDispositionOperatingTasksForFile(db, existing.id)
    return existing.id as string
  }

  const status: TcStatus = deal.stage === 'dead'
    ? 'cancelled'
    : deal.stage === 'closed'
      ? 'closed'
      : deal.stage === 'under_contract'
        ? 'opening_package_needed'
        : 'not_opened'
  const closingAt = deal.closeDate ? new Date(`${deal.closeDate}T17:00:00.000Z`).toISOString() : null
  const { data: created, error: createError } = await db
    .from('tc_files')
    .insert({
      lead_id: deal.leadId,
      dispo_deal_id: deal.id,
      buyer_offer_id: deal.acceptedOfferId ?? null,
      status,
      opened_at: deal.stage === 'under_contract' || deal.stage === 'closed' ? new Date().toISOString() : null,
      closing_scheduled_at: closingAt,
      assignment_fee: deal.assignmentFee ?? null,
      next_action: 'Complete contract intake and deal readiness',
      risk_level: 'normal',
    })
    .select('id')
    .single()
  if (createError || !created?.id) throw new Error(`Failed to create closing file: ${createError?.message || 'Unknown error'}`)

  await seedDispositionOperatingTasks(db, [{
    tcFileId: created.id,
    dealStage: deal.stage,
    tcStatus: status,
    enteredAt: deal.enteredAt ?? new Date().toISOString(),
    closingAt,
  }])
  await logTcEvent(db, created.id, 'closing_file_created_from_disposition', { dispo_deal_id: deal.id }, 'system')
  return created.id as string
}

async function findDispoDeal(db: DbClient, leadId: string, offerId: string | null) {
  if (offerId) {
    const { data } = await db
      .from('dispo_deals')
      .select('id, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id, stage')
      .eq('accepted_offer_id', offerId)
      .maybeSingle()
    if (data) return data
  }

  const { data } = await db
    .from('dispo_deals')
    .select('id, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id, stage')
    .eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

export async function ensureTcFileForOffer(
  db: DbClient,
  offerId: string,
  options: {
    status?: TcStatus
    actor?: string
    eventType?: string
    seedTasks?: boolean
  } = {},
): Promise<TcFileSummary | null> {
  const { data: existing } = await db
    .from('tc_files')
    .select('*')
    .eq('buyer_offer_id', offerId)
    .maybeSingle()

  if (existing) {
    const updates: Record<string, unknown> = {}
    if (options.status && existing.status !== 'closed' && existing.status !== options.status) {
      updates.status = options.status
      if (options.status !== 'not_opened' && !existing.opened_at) {
        updates.opened_at = new Date().toISOString()
      }
    }

    let file = existing
    if (Object.keys(updates).length > 0) {
      const { data: updated, error } = await db
        .from('tc_files')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single()
      if (error) throw new Error(`Failed to update TC file: ${error.message}`)
      file = updated
      await logTcEvent(db, file.id, options.eventType ?? 'tc_file_updated', updates, options.actor)
    }
    if (options.seedTasks) await seedStandardTcTasks(db, file.id)
    return file as TcFileSummary
  }

  const { data: offer, error: offerError } = await db
    .from('buyer_offers')
    .select('id, lead_id, buyer_id, offer_amount, status, close_days')
    .eq('id', offerId)
    .single()
  if (offerError || !offer) return null

  const deal = await findDispoDeal(db, offer.lead_id, offer.id)
  const status = options.status ?? 'not_opened'
  const now = new Date()
  const closingScheduledAt = offer.close_days
    ? new Date(now.getTime() + Number(offer.close_days) * 86_400_000).toISOString()
    : null

  const { data: file, error } = await db
    .from('tc_files')
    .insert({
      lead_id: offer.lead_id,
      dispo_deal_id: deal?.id ?? null,
      buyer_offer_id: offer.id,
      status,
      opened_at: status === 'not_opened' ? null : now.toISOString(),
      closing_scheduled_at: closingScheduledAt,
      assignment_fee: deal?.assignment_fee ?? null,
      next_action: status === 'not_opened'
        ? 'Send assignment contract and open with title'
        : 'Send opening package to title',
      risk_level: 'normal',
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create TC file: ${error.message}`)

  await logTcEvent(db, file.id, options.eventType ?? 'tc_file_created', {
    buyer_offer_id: offer.id,
    lead_id: offer.lead_id,
    status,
  }, options.actor)

  if (options.seedTasks) await seedStandardTcTasks(db, file.id)
  return file as TcFileSummary
}

export async function ensureTcFileForSignedAssignment(db: DbClient, submissionId: string) {
  const { data: offer } = await db
    .from('buyer_offers')
    .select('id')
    .eq('assignment_submission_id', submissionId)
    .maybeSingle()

  if (!offer?.id) return null
  return ensureTcFileForOffer(db, offer.id, {
    status: 'opening_package_needed',
    actor: 'docuseal',
    eventType: 'assignment_signed',
    seedTasks: true,
  })
}

export async function maybeLogTcRevenue(db: DbClient, tcFileId: string) {
  const { data: file } = await db
    .from('tc_files')
    .select('id, lead_id, assignment_fee, revenue_logged_at, closing_completed_at, lead:lead_id(property_address)')
    .eq('id', tcFileId)
    .maybeSingle()

  type RevenueFileRow = {
    id: string
    lead_id: string
    assignment_fee: number | string | null
    revenue_logged_at: string | null
    lead?: { property_address?: string | null } | { property_address?: string | null }[] | null
  }
  const revenueFile = file as RevenueFileRow | null
  if (!revenueFile || revenueFile.revenue_logged_at || !revenueFile.assignment_fee || Number(revenueFile.assignment_fee) <= 0) return
  const lead = Array.isArray(revenueFile.lead) ? revenueFile.lead[0] : revenueFile.lead

  const now = new Date()
  const { error } = await db.from('revenue_transactions').insert({
    date: now.toISOString().slice(0, 10),
    amount: Number(revenueFile.assignment_fee),
    deal_id: revenueFile.lead_id,
    property_address: lead?.property_address ?? null,
    description: 'Assignment fee from TC closing',
    source: 'closing',
    metadata: { tc_file_id: revenueFile.id },
  })
  if (error) {
    console.error('[tc] revenue insert failed:', error)
    return
  }

  const { error: rpcError } = await db.rpc('increment_revenue', { amount: Number(revenueFile.assignment_fee) })
  if (rpcError) console.error('[tc] increment_revenue failed:', rpcError)
  const loggedAt = now.toISOString()
  await db.from('tc_files').update({ revenue_logged_at: loggedAt }).eq('id', tcFileId)
  await logTcEvent(db, tcFileId, 'revenue_logged', { amount: Number(revenueFile.assignment_fee) }, 'system')
}
