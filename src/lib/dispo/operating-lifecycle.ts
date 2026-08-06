import type { DispoStage, TcStatus, TcTask } from '@/types/dispo'

export type DispositionOperatingLane = 'dispositions' | 'coordination' | 'shared'
export type DispositionEvidenceKind = 'field' | 'document' | 'receipt' | 'approval' | 'communication' | 'none'
export type DispositionPhaseActivation = 'always' | 'marketing' | 'offer' | 'under_contract' | 'closing' | 'closed'

export interface DispositionOperatingTaskDefinition {
  taskType: string
  label: string
  lane: DispositionOperatingLane
  evidence: DispositionEvidenceKind
  gate: boolean
  dueOffsetDays: number
  dueAnchor: 'entered' | 'closing'
}

export interface DispositionOperatingPhaseDefinition {
  id: string
  label: string
  description: string
  activation: DispositionPhaseActivation
  completionGate: string
  tasks: readonly DispositionOperatingTaskDefinition[]
}

export interface DispositionLifecycleContext {
  dealStage: DispoStage
  tcStatus?: TcStatus | null
  enteredAt?: string | null
  closingAt?: string | null
}

const task = (
  taskType: string,
  label: string,
  lane: DispositionOperatingLane,
  evidence: DispositionEvidenceKind,
  gate = false,
  dueOffsetDays = 0,
  dueAnchor: 'entered' | 'closing' = 'entered',
): DispositionOperatingTaskDefinition => ({ taskType, label, lane, evidence, gate, dueOffsetDays, dueAnchor })

export const DISPOSITION_OPERATING_LIFECYCLE: readonly DispositionOperatingPhaseDefinition[] = [
  {
    id: 'contract_intake',
    label: 'Contract intake',
    description: 'Validate the acquisition handoff, economics, closing terms, and seller expectations.',
    activation: 'always',
    completionGate: 'Contract, economics, closing date, and exit strategy are validated.',
    tasks: [
      task('ops.contract.review_acquisition_notes', 'Review acquisition notes', 'shared', 'approval', true),
      task('ops.contract.review_purchase_contract', 'Review purchase contract', 'coordination', 'document', true),
      task('ops.contract.confirm_closing_date', 'Confirm contractual closing date', 'coordination', 'field', true),
      task('ops.contract.confirm_signing_preference', 'Confirm seller signing preference', 'coordination', 'communication'),
      task('ops.contract.confirm_terms', 'Confirm contract terms and contingencies', 'coordination', 'approval', true),
      task('ops.contract.collect_title_information', 'Collect information title will need', 'coordination', 'field'),
      task('ops.contract.explain_closing_process', 'Explain the closing process to the seller', 'coordination', 'communication'),
      task('ops.valuation.verify_address', 'Verify property address', 'dispositions', 'field', true),
      task('ops.valuation.verify_specs', 'Verify property specifications', 'dispositions', 'field', true),
      task('ops.valuation.document_condition', 'Document property condition', 'dispositions', 'field'),
      task('ops.valuation.project_arv', 'Record CMA and projected ARV', 'dispositions', 'field', true),
      task('ops.valuation.estimate_costs', 'Record rehab and holding costs', 'dispositions', 'field', true),
      task('ops.valuation.confirm_profit', 'Confirm profit goal', 'dispositions', 'approval', true),
      task('ops.valuation.select_exit_strategy', 'Select the approved exit strategy', 'dispositions', 'approval', true),
    ],
  },
  {
    id: 'deal_readiness',
    label: 'Due diligence & deal readiness',
    description: 'Create the shared file, secure access, collect media, complete inspection work, and open title.',
    activation: 'always',
    completionGate: 'The shared deal package, title file, access, inspection, media, and seller EMD are recorded.',
    tasks: [
      task('ops.file.create_shared_file', 'Create shared property file', 'coordination', 'document', true, 0),
      task('ops.file.collect_seller_contact', 'Gather seller contact information', 'coordination', 'field', true, 0),
      task('ops.file.review_cyber_notice', 'Review cyber security notice', 'coordination', 'approval', false, 0),
      task('ops.access.record_viewing_instructions', 'Record viewing instructions', 'shared', 'field', true, 1),
      task('ops.access.record_key_lockbox', 'Record key or lockbox access', 'shared', 'field', false, 1),
      task('ops.access.record_tenant_contact', 'Record tenant contact and access constraints', 'shared', 'field', false, 1),
      task('ops.photos.schedule', 'Schedule property photos', 'coordination', 'field', false, 1),
      task('ops.photos.confirm_provider', 'Confirm photographer and payment', 'coordination', 'receipt', false, 1),
      task('ops.photos.provide_access', 'Provide property access instructions', 'coordination', 'communication', false, 1),
      task('ops.photos.review_upload', 'Review photos and attach approved media', 'coordination', 'document', true, 2),
      task('ops.inspection.schedule', 'Schedule property inspection', 'coordination', 'field', false, 1),
      task('ops.inspection.confirm_provider', 'Confirm inspector and payment', 'coordination', 'receipt', false, 1),
      task('ops.inspection.provide_access', 'Provide inspection access', 'coordination', 'communication', false, 1),
      task('ops.inspection.review_report', 'Review and attach inspection report', 'shared', 'document', true, 3),
      task('ops.emd.seller_submit', 'Submit seller earnest money deposit', 'coordination', 'receipt', true, 1),
      task('ops.emd.seller_receipt', 'Attach seller EMD receipt', 'coordination', 'receipt', true, 1),
      task('ops.title.select_company', 'Select title or escrow company and contact', 'coordination', 'field', true, 1),
      task('ops.title.send_opening_package', 'Send contract package to title or escrow', 'coordination', 'document', true, 1),
      task('ops.title.confirm_file_number', 'Confirm title file number', 'coordination', 'field', true, 2),
      task('ops.package.complete', 'Complete the approved deal package', 'dispositions', 'document', true, 3),
    ],
  },
  {
    id: 'buyer_marketing',
    label: 'Buyer marketing & offer selection',
    description: 'Publish the deal, engage qualified buyers, compare offers, and select the best executable outcome.',
    activation: 'marketing',
    completionGate: 'A reviewed buyer offer is selected against seller and profit goals.',
    tasks: [
      task('ops.marketing.publish_deal', 'Publish approved deal page', 'dispositions', 'document', true),
      task('ops.marketing.launch_broadcast', 'Launch approved buyer broadcast', 'dispositions', 'approval', false),
      task('ops.offers.review_spreadsheet', 'Review offer comparison', 'dispositions', 'document', true),
      task('ops.offers.review_seller_goals', 'Review seller goals and constraints', 'shared', 'approval', true),
      task('ops.offers.review_profit_goal', 'Verify projected profit against goal', 'dispositions', 'approval', true),
      task('ops.offers.choose_winner', 'Choose and record winning buyer', 'dispositions', 'approval', true),
    ],
  },
  {
    id: 'assignment',
    label: 'Assignment & buyer commitment',
    description: 'Execute the assignment, establish buyer expectations, collect EMD, and complete the title handoff.',
    activation: 'offer',
    completionGate: 'Assignment is executed, buyer EMD is received, and title has the final buyer package.',
    tasks: [
      task('ops.assignment.notify_buyer', 'Notify selected buyer', 'dispositions', 'communication', true),
      task('ops.assignment.review_contract', 'Review assignment contract', 'shared', 'approval', true),
      task('ops.assignment.send_contract', 'Send assignment contract', 'dispositions', 'document', true),
      task('ops.assignment.send_instructions', 'Send title, escrow, and closing expectations', 'coordination', 'communication'),
      task('ops.assignment.send_to_title', 'Send executed assignment to title', 'coordination', 'document', true),
      task('ops.emd.buyer_submit', 'Confirm buyer EMD submitted', 'coordination', 'receipt', true),
      task('ops.emd.buyer_receipt', 'Attach buyer EMD receipt', 'coordination', 'receipt', true),
    ],
  },
  {
    id: 'closing_readiness',
    label: 'Title, funding & clear to close',
    description: 'Resolve title conditions, verify funding, approve closing documents, and prepare the final walkthrough.',
    activation: 'under_contract',
    completionGate: 'Title, funding, documents, and final property access are approved for closing.',
    tasks: [
      task('ops.title.request_preliminary', 'Request preliminary title report', 'coordination', 'document', true, -10, 'closing'),
      task('ops.title.review_preliminary', 'Review preliminary title report', 'coordination', 'approval', true, -9, 'closing'),
      task('ops.title.attach_preliminary', 'Attach preliminary title report', 'coordination', 'document', true, -9, 'closing'),
      task('ops.ctc.review_conditions', 'Review all open closing conditions', 'shared', 'approval', true, -5, 'closing'),
      task('ops.ctc.verify_inspection', 'Verify inspection requirements complete', 'coordination', 'approval', true, -5, 'closing'),
      task('ops.funding.call_lender', 'Contact buyer lender or funding source', 'dispositions', 'communication', false, -5, 'closing'),
      task('ops.funding.verify', 'Verify current proof of funds', 'shared', 'document', true, -4, 'closing'),
      task('ops.docs.request_closing', 'Request closing documents', 'coordination', 'document', true, -3, 'closing'),
      task('ops.docs.review_closing', 'Review closing documents', 'coordination', 'approval', true, -2, 'closing'),
      task('ops.docs.correct_closing', 'Resolve closing document corrections', 'coordination', 'document', false, -2, 'closing'),
      task('ops.docs.approve_closing', 'Approve final closing documents', 'shared', 'approval', true, -1, 'closing'),
      task('ops.walkthrough.schedule', 'Schedule final property walkthrough', 'coordination', 'field', false, -2, 'closing'),
      task('ops.walkthrough.confirm_access', 'Confirm final property access', 'shared', 'communication', true, -1, 'closing'),
      task('ops.ctc.obtain', 'Record clear-to-close approval', 'coordination', 'approval', true, -1, 'closing'),
    ],
  },
  {
    id: 'closing_day',
    label: 'Closing day',
    description: 'Confirm signatures, payments, access, and the complete closing package before funding is recorded.',
    activation: 'closing',
    completionGate: 'Seller and buyer signed, payments were sent, and the completed closing package is attached.',
    tasks: [
      task('ops.closing.verify_seller_signed', 'Verify seller signed', 'coordination', 'approval', true, 0, 'closing'),
      task('ops.closing.verify_buyer_signed', 'Verify buyer signed', 'coordination', 'approval', true, 0, 'closing'),
      task('ops.closing.verify_payments', 'Verify closing payments sent', 'coordination', 'receipt', true, 0, 'closing'),
      task('ops.closing.confirm_complete', 'Confirm closing complete', 'shared', 'approval', true, 0, 'closing'),
      task('ops.closing.collect_documents', 'Collect and attach completed closing documents', 'coordination', 'document', true, 0, 'closing'),
      task('ops.closing.confirm_access', 'Confirm final buyer access', 'dispositions', 'communication', false, 0, 'closing'),
    ],
  },
  {
    id: 'post_close',
    label: 'Post-close, debrief & archive',
    description: 'Complete aftercare, capture performance and learning, update the CRM, and archive the final file.',
    activation: 'closed',
    completionGate: 'Aftercare, debrief, final documents, metrics, and archive are complete.',
    tasks: [
      task('ops.aftercare.seller_check_in', 'Complete seller post-close check-in', 'coordination', 'communication', false, 1, 'closing'),
      task('ops.aftercare.seller_gift', 'Send seller closing gift', 'coordination', 'receipt', false, 1, 'closing'),
      task('ops.aftercare.buyer_gift', 'Send buyer closing gift', 'dispositions', 'receipt', false, 1, 'closing'),
      task('ops.testimonial.request', 'Request testimonial', 'coordination', 'communication', false, 1, 'closing'),
      task('ops.testimonial.confirm', 'Record testimonial outcome', 'coordination', 'field', false, 3, 'closing'),
      task('ops.closeout.review_documents', 'Review final file completeness', 'shared', 'approval', true, 1, 'closing'),
      task('ops.closeout.update_crm', 'Confirm CRM economics and outcomes updated', 'shared', 'field', true, 1, 'closing'),
      task('ops.closeout.debrief', 'Complete transaction debrief', 'shared', 'approval', true, 1, 'closing'),
      task('ops.closeout.process_change', 'Record approved process improvement', 'shared', 'field', false, 2, 'closing'),
      task('ops.closeout.archive', 'Archive property file', 'coordination', 'document', true, 3, 'closing'),
    ],
  },
] as const

const DISPO_STAGE_RANK: Record<DispoStage, number> = {
  new: 0,
  marketing: 1,
  offers_in: 2,
  negotiating: 3,
  under_contract: 4,
  closed: 5,
  dead: -1,
}

const TC_STATUS_RANK: Record<TcStatus, number> = {
  not_opened: 0,
  opening_package_needed: 1,
  opened: 2,
  emd_pending: 3,
  title_work: 4,
  clear_to_close: 5,
  scheduled: 6,
  closed: 7,
  cancelled: -1,
}

export function isDispositionPhaseActive(phase: DispositionOperatingPhaseDefinition, context: DispositionLifecycleContext) {
  const dealRank = DISPO_STAGE_RANK[context.dealStage]
  const tcRank = context.tcStatus ? TC_STATUS_RANK[context.tcStatus] : 0
  if (dealRank < 0 || tcRank < 0) return false
  if (phase.activation === 'always') return true
  if (phase.activation === 'marketing') return dealRank >= DISPO_STAGE_RANK.marketing
  if (phase.activation === 'offer') return dealRank >= DISPO_STAGE_RANK.offers_in
  if (phase.activation === 'under_contract') return dealRank >= DISPO_STAGE_RANK.under_contract || tcRank >= TC_STATUS_RANK.opened
  if (phase.activation === 'closing') return dealRank >= DISPO_STAGE_RANK.closed || tcRank >= TC_STATUS_RANK.clear_to_close
  return dealRank >= DISPO_STAGE_RANK.closed || tcRank >= TC_STATUS_RANK.closed
}

export function activeDispositionPhases(context: DispositionLifecycleContext) {
  return DISPOSITION_OPERATING_LIFECYCLE.filter((phase) => isDispositionPhaseActive(phase, context))
}

export function calculateDispositionTaskDueAt(
  definition: DispositionOperatingTaskDefinition,
  context: DispositionLifecycleContext,
) {
  const anchor = definition.dueAnchor === 'closing'
    ? context.closingAt
    : context.enteredAt
  if (!anchor) return null
  const date = new Date(anchor)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + definition.dueOffsetDays)
  return date.toISOString()
}

export function activeDispositionTasks(context: DispositionLifecycleContext) {
  return activeDispositionPhases(context).flatMap((phase) => phase.tasks.map((definition) => ({ phase, definition })))
}

export function dispositionTaskDefinition(taskType: string) {
  for (const phase of DISPOSITION_OPERATING_LIFECYCLE) {
    const definition = phase.tasks.find((candidate) => candidate.taskType === taskType)
    if (definition) return { phase, definition }
  }
  return null
}

export function summarizeDispositionPhase(phase: DispositionOperatingPhaseDefinition, tasks: readonly TcTask[]) {
  const taskByType = new Map(tasks.map((item) => [item.task_type, item]))
  const recorded = phase.tasks.map((definition) => taskByType.get(definition.taskType)).filter(Boolean) as TcTask[]
  const completed = recorded.filter((item) => item.status === 'done' || item.status === 'waived').length
  const blocked = recorded.filter((item) => item.status === 'blocked').length
  const gateTasks = phase.tasks.filter((definition) => definition.gate)
  const gateComplete = gateTasks.every((definition) => {
    const item = taskByType.get(definition.taskType)
    return item?.status === 'done' || item?.status === 'waived'
  })

  return {
    total: phase.tasks.length,
    recorded: recorded.length,
    completed,
    blocked,
    percent: phase.tasks.length === 0 ? 100 : Math.round((completed / phase.tasks.length) * 100),
    gateComplete,
  }
}

const STAGE_GATE_PHASES: Partial<Record<DispoStage, readonly string[]>> = {
  marketing: ['contract_intake', 'deal_readiness'],
  offers_in: ['contract_intake', 'deal_readiness', 'buyer_marketing'],
  negotiating: ['contract_intake', 'deal_readiness', 'buyer_marketing'],
  under_contract: ['contract_intake', 'deal_readiness', 'buyer_marketing', 'assignment'],
}

export interface DispositionStageGateResult {
  allowed: boolean
  missing: string[]
  missingPhaseIds: string[]
}

export function validateDispositionStageGate(
  currentStage: DispoStage,
  targetStage: DispoStage,
  tasks: readonly TcTask[],
  deal: { acceptedOfferId?: string | null; acceptedBuyerId?: string | null } = {},
): DispositionStageGateResult {
  if (targetStage === 'dead' || DISPO_STAGE_RANK[targetStage] <= DISPO_STAGE_RANK[currentStage]) {
    return { allowed: true, missing: [], missingPhaseIds: [] }
  }

  const requiredPhaseIds = STAGE_GATE_PHASES[targetStage] ?? []
  const missing: string[] = []
  const missingPhaseIds: string[] = []

  for (const phaseId of requiredPhaseIds) {
    const phase = DISPOSITION_OPERATING_LIFECYCLE.find((candidate) => candidate.id === phaseId)
    if (!phase) continue
    const summary = summarizeDispositionPhase(phase, tasks)
    if (!summary.gateComplete) {
      missingPhaseIds.push(phase.id)
      missing.push(`${phase.label}: ${phase.tasks
        .filter((definition) => definition.gate)
        .filter((definition) => {
          const recorded = tasks.find((item) => item.task_type === definition.taskType)
          return recorded?.status !== 'done' && recorded?.status !== 'waived'
        })
        .map((definition) => definition.label)
        .join(', ')}`)
    }
  }

  if (targetStage === 'under_contract') {
    if (!deal.acceptedOfferId) missing.push('Record the accepted offer')
    if (!deal.acceptedBuyerId) missing.push('Record the accepted buyer')
  }

  return { allowed: missing.length === 0, missing, missingPhaseIds }
}
