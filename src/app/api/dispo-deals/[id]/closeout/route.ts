export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { finalizeFundedClose, finalizeVerifiedFallout } from '@/lib/server/crm-operating-handoffs'
import {
  buildFundingMetrics,
  nextBusinessDayDueAt,
  sellerFollowupDueAt,
  validateDebrief,
  validateFundingCloseout,
  type DebriefInput,
  type FundingCloseoutInput,
} from '@/lib/dispo/closeout'

function money(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) return Number(value)
  return Number.NaN
}

function optionalMoney(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = money(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function insertActivity(input: {
  leadId: string
  activityType: string
  description: string
  agent: string
  metadata: Record<string, unknown>
}) {
  const db = supabaseAdmin()
  const { error } = await db.from('lead_activities').insert({
    lead_id: input.leadId,
    activity_type: input.activityType,
    description: input.description,
    agent: input.agent,
    metadata: input.metadata,
    created_at: new Date().toISOString(),
  })
  if (error) console.error('[dispo-closeout] Activity insert failed:', error.message)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const body = await req.json()
    const action = cleanText(body.action)
    const db = supabaseAdmin()

    const { data: current, error: fetchError } = await db
      .from('dispo_deals')
      .select('*, leads:lead_id(id, full_name, source, assigned_agent, created_at)')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Disposition deal not found' }, { status: 404 })
    }

    const lead = current.leads as {
      id: string
      source: string | null
      assigned_agent: string | null
      created_at: string | null
    } | null
    const existingCloseout = current.closeout && typeof current.closeout === 'object'
      ? current.closeout as Record<string, unknown>
      : {}

    if (action === 'record_fallout') {
      if (current.stage === 'closed' || current.closeout_status === 'awaiting_debrief') {
        return NextResponse.json({ error: 'A funded transaction cannot be marked as fallout' }, { status: 409 })
      }
      const reason = cleanText(body.reason)
      const allowedReasons = new Set(['seller_cancelled', 'buyer_default', 'title_issue', 'inspection_issue', 'financing_failed', 'other'])
      const notes = cleanText(body.notes)
      const evidenceReference = cleanText(body.evidenceReference)
      if (!allowedReasons.has(reason)) return NextResponse.json({ error: 'Choose a verified fallout reason' }, { status: 400 })
      if (!notes) return NextResponse.json({ error: 'Explain what caused the transaction to fall through' }, { status: 400 })
      if (!evidenceReference) return NextResponse.json({ error: 'Reference the cancellation, communication, title note, or other evidence' }, { status: 400 })

      const finalized = await finalizeVerifiedFallout({
        dealId: id,
        reason: reason as 'seller_cancelled' | 'buyer_default' | 'title_issue' | 'inspection_issue' | 'financing_failed' | 'other',
        notes,
        evidenceReference,
        occurredAt: new Date().toISOString(),
        actorEmail: actor.email,
        actorName: actor.name,
      })
      return NextResponse.json({ deal: finalized.deal, next: 'archived_fallout' })
    }

    if (action === 'record_funding') {
      if (current.closeout_status === 'complete' || current.archived_at) {
        return NextResponse.json({ error: 'Archived transactions cannot be reopened from this workflow' }, { status: 409 })
      }

      const fundedAt = cleanText(body.fundedAt)
      const input: FundingCloseoutInput = {
        fundedAt,
        finalAssignmentFee: money(body.finalAssignmentFee),
        closingCosts: money(body.closingCosts),
        sellerPurchasePrice: optionalMoney(body.sellerPurchasePrice),
        buyerPurchasePrice: optionalMoney(body.buyerPurchasePrice),
        settlementStatementVerified: body.settlementStatementVerified === true,
        fundingConfirmed: body.fundingConfirmed === true,
        notes: cleanText(body.notes) || null,
        recordedBy: actor.name,
      }
      const errors = validateFundingCloseout(input)
      if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 })

      const firstCloseout = current.closeout_status !== 'awaiting_debrief'
      const recordedAt = new Date().toISOString()
      const debriefDueAt = nextBusinessDayDueAt(input.fundedAt)
      const followupDueAt = sellerFollowupDueAt(input.fundedAt)
      const metrics = buildFundingMetrics(input, {
        enteredAt: current.entered_at,
        leadCreatedAt: lead?.created_at,
      })
      const closeout = {
        ...existingCloseout,
        version: 1,
        funding: { ...input, recordedAt },
        metrics,
        attribution: {
          source: lead?.source || 'unknown',
          acquisitionOwner: lead?.assigned_agent || null,
        },
        workflow: {
          marketingStopped: true,
          transactionCoordinationClosed: true,
          debriefDueAt,
          sellerFollowupDueAt: followupDueAt,
        },
      }

      const finalized = await finalizeFundedClose({
        dealId: id,
        closeout,
        fundedAt: input.fundedAt,
        assignmentFee: input.finalAssignmentFee,
        closeDate: input.fundedAt.slice(0, 10),
        debriefDueAt,
        actorEmail: actor.email,
        actorName: actor.name,
        netRevenue: metrics.netRevenue,
      })
      const deal = finalized.deal

      await db.from('deal_pages').update({ is_active: false, updated_at: recordedAt }).eq('lead_id', current.lead_id)

      if (firstCloseout) {
        await Promise.all([
          insertActivity({
            leadId: current.lead_id,
            activityType: 'status_change',
            description: `Transaction funded — ${metrics.netRevenue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} net revenue`,
            agent: input.recordedBy,
            metadata: {
              workflow_id: 'disposition-closeout',
              disposition: 'closed_funded',
              deal_id: id,
              metrics,
            },
          }),
          insertActivity({
            leadId: current.lead_id,
            activityType: 'task',
            description: 'Complete post-close debrief',
            agent: input.recordedBy,
            metadata: {
              workflow_id: 'post-close-debrief',
              task_type: 'post_close_debrief',
              status: 'pending',
              due_date: debriefDueAt,
              assigned_to: input.recordedBy,
              deal_id: id,
              primary_next_action: false,
            },
          }),
          insertActivity({
            leadId: current.lead_id,
            activityType: 'task',
            description: 'Review seller follow-up after closing',
            agent: input.recordedBy,
            metadata: {
              workflow_id: 'post-close-seller-followup',
              task_type: 'seller_followup',
              status: 'pending',
              due_date: followupDueAt,
              assigned_to: input.recordedBy,
              deal_id: id,
              primary_next_action: false,
              external_message_requires_review: true,
            },
          }),
        ])

        if (current.accepted_buyer_id) {
          const { data: buyer } = await db.from('buyers').select('deals_closed').eq('id', current.accepted_buyer_id).maybeSingle()
          if (buyer) {
            await db.from('buyers').update({
              deals_closed: Number(buyer.deals_closed || 0) + 1,
              last_deal_date: input.fundedAt.slice(0, 10),
              updated_at: recordedAt,
            }).eq('id', current.accepted_buyer_id)
          }
        }
      }

      return NextResponse.json({ deal, next: 'complete_debrief', debriefDueAt })
    }

    if (action === 'complete_debrief') {
      if (current.closeout_status !== 'awaiting_debrief') {
        return NextResponse.json({ error: 'Record confirmed funding before completing the debrief' }, { status: 409 })
      }

      const input: DebriefInput = {
        outcomeRating: Number(body.outcomeRating),
        buyerPerformance: Number(body.buyerPerformance),
        sourceQuality: Number(body.sourceQuality),
        wentWell: cleanText(body.wentWell),
        friction: cleanText(body.friction),
        lesson: cleanText(body.lesson),
        processChange: cleanText(body.processChange),
        completedBy: actor.name,
      }
      const errors = validateDebrief(input)
      if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 })

      const completedAt = new Date().toISOString()
      const closeout = {
        ...existingCloseout,
        debrief: { ...input, completedAt },
      }
      const { data: deal, error: updateError } = await db
        .from('dispo_deals')
        .update({
          closeout_status: 'complete',
          closeout,
          debrief_completed_at: completedAt,
          archived_at: completedAt,
          updated_at: completedAt,
        })
        .eq('id', id)
        .select('*')
        .single()

      if (updateError) throw new Error(updateError.message)

      const { data: debriefTasks } = await db
        .from('lead_activities')
        .select('id, metadata')
        .eq('lead_id', current.lead_id)
        .eq('activity_type', 'task')
        .order('created_at', { ascending: false })
        .limit(50)
      const pendingDebrief = (debriefTasks ?? []).find((task) => {
        const metadata = task.metadata as Record<string, unknown> | null
        return metadata?.workflow_id === 'post-close-debrief' && metadata?.deal_id === id && metadata?.status !== 'completed'
      })
      if (pendingDebrief) {
        await db.from('lead_activities').update({
          metadata: {
            ...(pendingDebrief.metadata as Record<string, unknown>),
            status: 'completed',
            completed_at: completedAt,
            completed_by: input.completedBy,
          },
        }).eq('id', pendingDebrief.id)
      }

      await insertActivity({
        leadId: current.lead_id,
        activityType: 'status_change',
        description: 'Post-close debrief complete — transaction archived',
        agent: input.completedBy,
        metadata: {
          workflow_id: 'post-close-debrief',
          disposition: 'closed_archived',
          deal_id: id,
          debrief: input,
        },
      })

      return NextResponse.json({ deal, next: 'archived' })
    }

    return NextResponse.json({ error: 'Unsupported close-out action' }, { status: 400 })
  } catch (error) {
    console.error('[dispo-closeout] Unexpected error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update close-out' }, { status: 500 })
  }
}
