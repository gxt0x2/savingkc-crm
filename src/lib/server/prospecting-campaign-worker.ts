import { randomUUID } from 'node:crypto'
import { supabase } from '@/lib/supabase-lazy'

type ClaimedCampaignAction = {
  id: string
  campaignId: string
  memberId: string
  stepId: string
  subjectKind: 'lead' | 'prospect'
  leadId: string | null
  prospectId: string | null
  prospectPhoneId: string | null
  attemptCount: number
  phone: string
  timezone: string
  bodyTemplate: string
  fromPhone: string
  sendWindowStart: string
  sendWindowEnd: string
  sendDays: number[]
  perHour: number
  perDay: number
  ownerName: string
}

type WorkerSummary = { processed: number; sent: number; deferred: number; blocked: number; failed: number }

function validClaim(value: unknown): value is ClaimedCampaignAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string'
    && typeof row.campaignId === 'string'
    && typeof row.memberId === 'string'
    && typeof row.stepId === 'string'
    && (row.subjectKind === 'lead' || row.subjectKind === 'prospect')
    && (typeof row.leadId === 'string' || row.leadId === null)
    && (typeof row.prospectId === 'string' || row.prospectId === null)
    && (typeof row.prospectPhoneId === 'string' || row.prospectPhoneId === null)
    && ((row.subjectKind === 'lead' && typeof row.leadId === 'string' && row.prospectId === null)
      || (row.subjectKind === 'prospect' && row.leadId === null && typeof row.prospectId === 'string'))
    && typeof row.phone === 'string'
    && typeof row.timezone === 'string'
    && typeof row.bodyTemplate === 'string'
    && typeof row.fromPhone === 'string'
    && typeof row.sendWindowStart === 'string'
    && typeof row.sendWindowEnd === 'string'
    && Array.isArray(row.sendDays)
    && row.sendDays.every((day) => Number.isInteger(day))
    && Number.isInteger(row.attemptCount)
    && Number.isInteger(row.perHour)
    && Number.isInteger(row.perDay)
}

async function finishAction(
  action: ClaimedCampaignAction,
  workerToken: string,
  result: 'sent' | 'blocked' | 'failed' | 'deferred',
  detail: { renderedBody?: string; providerSid?: string; errorCode?: string; retryAt?: string } = {},
) {
  const response = await supabase.rpc('finish_prospecting_campaign_action_v1', {
    p_action_id: action.id,
    p_worker_token: workerToken,
    p_result: result,
    p_rendered_body: detail.renderedBody || null,
    p_provider_sid: detail.providerSid || null,
    p_error_code: detail.errorCode || null,
    p_retry_at: detail.retryAt || null,
  })
  if (response.error) throw response.error
}

async function processAction(action: ClaimedCampaignAction, workerToken: string): Promise<keyof Omit<WorkerSummary, 'processed'>> {
  console.error('[prospecting-worker] refused automated SMS send', {
    actionId: action.id,
    reason: 'automated_sms_disabled',
  })
  await finishAction(action, workerToken, 'blocked', { errorCode: 'automated_sms_disabled' })
  return 'blocked'
}

export async function processProspectingCampaignActions(requestedLimit = 10): Promise<WorkerSummary> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 25))
  const workerToken = randomUUID()
  const summary: WorkerSummary = { processed: 0, sent: 0, deferred: 0, blocked: 0, failed: 0 }

  for (let index = 0; index < limit; index += 1) {
    const claim = await supabase.rpc('claim_prospecting_campaign_action_v1', {
      p_worker_token: workerToken,
      p_lease_seconds: 120,
    })
    if (claim.error) throw claim.error
    if (claim.data == null) break
    if (!validClaim(claim.data)) throw new Error('Invalid prospecting campaign action claim')
    summary.processed += 1
    try {
      const result = await processAction(claim.data, workerToken)
      summary[result] += 1
    } catch (error) {
      console.error('[prospecting-worker] Campaign action failed', { actionId: claim.data.id, error })
      try {
        await finishAction(claim.data, workerToken, 'failed', { errorCode: 'worker_runtime_error' })
      } catch (finishError) {
        console.error('[prospecting-worker] Could not release campaign action claim', { actionId: claim.data.id, finishError })
      }
      summary.failed += 1
    }
  }
  return summary
}
