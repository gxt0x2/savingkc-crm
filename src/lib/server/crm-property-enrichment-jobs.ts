import { autoEnrichLead } from '@/lib/auto-enrich'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type PropertyEnrichmentJobClaim = {
  leadId: string
  revision: number
  claimToken: string
}

type Db = ReturnType<typeof supabaseAdmin>

function claimsFromRpc(data: unknown): PropertyEnrichmentJobClaim[] {
  if (!Array.isArray(data)) throw new Error('Property enrichment claim returned an invalid result')
  return data.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Property enrichment claim returned an invalid row')
    }
    const item = row as Record<string, unknown>
    if (typeof item.lead_id !== 'string' || typeof item.revision !== 'number' || typeof item.claim_token !== 'string') {
      throw new Error('Property enrichment claim returned an invalid row')
    }
    return { leadId: item.lead_id, revision: item.revision, claimToken: item.claim_token }
  })
}

export async function claimPropertyEnrichmentJobs(
  limit: number,
  db: Db = supabaseAdmin(),
): Promise<PropertyEnrichmentJobClaim[]> {
  const { data, error } = await db.rpc('claim_crm_property_enrichment_jobs_v1', {
    p_limit: Math.max(1, Math.min(Math.trunc(limit), 5)),
  })
  if (error) throw new Error(`Property enrichment claim failed: ${error.message}`)
  return claimsFromRpc(data)
}

export async function finishPropertyEnrichmentJob(
  claim: PropertyEnrichmentJobClaim,
  success: boolean,
  errorMessage: string | null,
  db: Db = supabaseAdmin(),
): Promise<string> {
  const { data, error } = await db.rpc('finish_crm_property_enrichment_job_v1', {
    p_lead_id: claim.leadId,
    p_revision: claim.revision,
    p_claim_token: claim.claimToken,
    p_success: success,
    p_error: errorMessage,
  })
  if (error) throw new Error(`Property enrichment completion failed: ${error.message}`)
  if (typeof data !== 'string') throw new Error('Property enrichment completion returned an invalid result')
  return data
}

type WorkerDependencies = {
  claim: typeof claimPropertyEnrichmentJobs
  enrich: typeof autoEnrichLead
  finish: typeof finishPropertyEnrichmentJob
}

export async function runPropertyEnrichmentWorker(
  requestedLimit = 3,
  dependencies: WorkerDependencies = {
    claim: claimPropertyEnrichmentJobs,
    enrich: autoEnrichLead,
    finish: finishPropertyEnrichmentJob,
  },
) {
  const claims = await dependencies.claim(Math.max(1, Math.min(Math.trunc(requestedLimit), 5)))
  const results = await Promise.all(claims.map(async (claim) => {
    try {
      await dependencies.enrich(claim.leadId)
      const status = await dependencies.finish(claim, true, null)
      return { leadId: claim.leadId, status }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown enrichment error'
      try {
        const status = await dependencies.finish(claim, false, message)
        return { leadId: claim.leadId, status, error: message }
      } catch (finishError) {
        console.error('[property-enrichment-worker] failed to release claim', claim.leadId, finishError)
        return { leadId: claim.leadId, status: 'claim_release_failed', error: message }
      }
    }
  }))

  return {
    claimed: claims.length,
    completed: results.filter((result) => result.status === 'completed').length,
    pending: results.filter((result) => result.status === 'pending' || result.status === 'retry').length,
    failed: results.filter((result) => result.status === 'failed' || result.status === 'claim_release_failed').length,
    results,
  }
}

