import { supabaseAdmin } from '@/lib/supabase/admin'

const ROW_LIMIT = 500

type DealRow = {
  id: string
  lead_id: string
  stage: string
  accepted_offer_id: string | null
}

type TcFileRow = {
  id: string
  lead_id: string
  dispo_deal_id: string | null
  buyer_offer_id: string | null
  status: string
}

type OfferRow = {
  id: string
  lead_id: string
  status: string
  assignment_signed_at: string | null
}

type HandoffRow = {
  lead_id: string
  from_department: string
  to_department: string
  source_record_type: string | null
  source_record_id: string | null
}

type OutcomeRow = { lead_id: string; outcome: 'closed_won' | 'fell_through' }
type LeadRow = { id: string; full_name: string | null; property_address: string | null; city: string | null; state: string | null }

export type LifecycleEvidenceIssue = {
  key: string
  kind: 'seller_handoff' | 'assignment_handoff' | 'close_outcome' | 'orphan_closing_file'
  leadId: string
  recordId: string
  title: string
  detail: string
  href: string
}

export type LifecycleReconciliationSnapshot = {
  generatedAt: string
  source: 'governed_evidence_audit'
  degraded: boolean
  warning: string | null
  counts: {
    reviewedDeals: number
    reviewedClosingFiles: number
    missingSellerHandoffs: number
    missingAssignmentHandoffs: number
    missingCloseOutcomes: number
    orphanClosingFiles: number
  }
  issues: LifecycleEvidenceIssue[]
}

function propertyLabel(lead: LeadRow | undefined) {
  if (!lead) return 'CRM record'
  const place = [lead.city, lead.state].filter(Boolean).join(', ')
  return [lead.property_address || lead.full_name || 'CRM record', place].filter(Boolean).join(' · ')
}

export function summarizeLifecycleReconciliation(input: {
  deals: DealRow[]
  closingFiles: TcFileRow[]
  offers: OfferRow[]
  handoffs: HandoffRow[]
  outcomes: OutcomeRow[]
  leads: LeadRow[]
  degraded?: boolean
  now: Date
}): LifecycleReconciliationSnapshot {
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]))
  const offerById = new Map(input.offers.map((offer) => [offer.id, offer]))
  const sellerHandoffLeadIds = new Set(input.handoffs
    .filter((row) => row.from_department === 'acquisitions' && row.to_department === 'dispositions')
    .map((row) => row.lead_id))
  const assignmentHandoffOfferIds = new Set(input.handoffs
    .filter((row) => row.from_department === 'dispositions' && row.to_department === 'transaction_coordination' && row.source_record_type === 'buyer_offer' && row.source_record_id)
    .map((row) => row.source_record_id as string))
  const outcomeByLead = new Map(input.outcomes.map((row) => [row.lead_id, row.outcome]))
  const issues: LifecycleEvidenceIssue[] = []

  for (const deal of input.deals) {
    const label = propertyLabel(leadById.get(deal.lead_id))
    if (!sellerHandoffLeadIds.has(deal.lead_id)) {
      issues.push({
        key: `seller-handoff:${deal.id}`,
        kind: 'seller_handoff',
        leadId: deal.lead_id,
        recordId: deal.id,
        title: label,
        detail: 'Dispositions record predates a verified signed seller-contract handoff.',
        href: `/leads/${deal.lead_id}`,
      })
    }
    const expectedOutcome = deal.stage === 'closed' ? 'closed_won' : deal.stage === 'dead' ? 'fell_through' : null
    if (expectedOutcome && outcomeByLead.get(deal.lead_id) !== expectedOutcome) {
      issues.push({
        key: `close-outcome:${deal.id}`,
        kind: 'close_outcome',
        leadId: deal.lead_id,
        recordId: deal.id,
        title: label,
        detail: expectedOutcome === 'closed_won'
          ? 'Closed record has no verified funded-close outcome or revenue evidence for Marketing.'
          : 'Fell-through record has no verified zero-revenue outcome for Marketing.',
        href: '/dispo/pipeline?closeout=due',
      })
    }
  }

  for (const file of input.closingFiles.filter((row) => row.status !== 'cancelled')) {
    const label = propertyLabel(leadById.get(file.lead_id))
    if (!file.dispo_deal_id || !input.deals.some((deal) => deal.id === file.dispo_deal_id)) {
      issues.push({
        key: `orphan-closing-file:${file.id}`,
        kind: 'orphan_closing_file',
        leadId: file.lead_id,
        recordId: file.id,
        title: label,
        detail: 'Closing file is not linked to a Dispositions deal.',
        href: '/dispo/tc',
      })
    }
    const offer = file.buyer_offer_id ? offerById.get(file.buyer_offer_id) : undefined
    if (!offer?.assignment_signed_at || !assignmentHandoffOfferIds.has(offer.id)) {
      issues.push({
        key: `assignment-handoff:${file.id}`,
        kind: 'assignment_handoff',
        leadId: file.lead_id,
        recordId: file.id,
        title: label,
        detail: 'Closing file lacks a verified executed buyer assignment handoff.',
        href: '/dispo/tc',
      })
    }
  }

  const counts = {
    reviewedDeals: input.deals.length,
    reviewedClosingFiles: input.closingFiles.length,
    missingSellerHandoffs: issues.filter((issue) => issue.kind === 'seller_handoff').length,
    missingAssignmentHandoffs: issues.filter((issue) => issue.kind === 'assignment_handoff').length,
    missingCloseOutcomes: issues.filter((issue) => issue.kind === 'close_outcome').length,
    orphanClosingFiles: issues.filter((issue) => issue.kind === 'orphan_closing_file').length,
  }

  return {
    generatedAt: input.now.toISOString(),
    source: 'governed_evidence_audit',
    degraded: Boolean(input.degraded),
    warning: input.degraded ? `Evidence review is capped at ${ROW_LIMIT} rows per source.` : null,
    counts,
    issues: issues.slice(0, 50),
  }
}

export async function getLifecycleReconciliationSnapshot(now = new Date()) {
  const db = supabaseAdmin()
  const [dealResult, fileResult, offerResult, handoffResult, outcomeResult] = await Promise.all([
    db.from('dispo_deals').select('id,lead_id,stage,accepted_offer_id').order('updated_at', { ascending: false }).limit(ROW_LIMIT + 1),
    db.from('tc_files').select('id,lead_id,dispo_deal_id,buyer_offer_id,status').order('updated_at', { ascending: false }).limit(ROW_LIMIT + 1),
    db.from('buyer_offers').select('id,lead_id,status,assignment_signed_at').order('created_at', { ascending: false }).limit(ROW_LIMIT + 1),
    db.from('crm_department_handoffs').select('lead_id,from_department,to_department,source_record_type,source_record_id').order('created_at', { ascending: false }).limit(ROW_LIMIT + 1),
    db.from('crm_marketing_outcomes').select('lead_id,outcome').order('occurred_at', { ascending: false }).limit(ROW_LIMIT + 1),
  ])
  for (const result of [dealResult, fileResult, offerResult, handoffResult, outcomeResult]) {
    if (result.error) throw new Error(result.error.message)
  }
  const deals = (dealResult.data ?? []).slice(0, ROW_LIMIT) as DealRow[]
  const closingFiles = (fileResult.data ?? []).slice(0, ROW_LIMIT) as TcFileRow[]
  const offers = (offerResult.data ?? []).slice(0, ROW_LIMIT) as OfferRow[]
  const handoffs = (handoffResult.data ?? []).slice(0, ROW_LIMIT) as HandoffRow[]
  const outcomes = (outcomeResult.data ?? []).slice(0, ROW_LIMIT) as OutcomeRow[]
  const leadIds = [...new Set([...deals.map((row) => row.lead_id), ...closingFiles.map((row) => row.lead_id)])]
  const leads: LeadRow[] = []
  for (let offset = 0; offset < leadIds.length; offset += 200) {
    const result = await db.from('leads').select('id,full_name,property_address,city,state').in('id', leadIds.slice(offset, offset + 200))
    if (result.error) throw new Error(result.error.message)
    leads.push(...((result.data ?? []) as LeadRow[]))
  }
  return summarizeLifecycleReconciliation({
    deals,
    closingFiles,
    offers,
    handoffs,
    outcomes,
    leads,
    degraded: [dealResult, fileResult, offerResult, handoffResult, outcomeResult].some((result) => (result.data?.length ?? 0) > ROW_LIMIT),
    now,
  })
}
