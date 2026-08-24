import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import {
  claimCanonicalLeadBriefings,
  finishCanonicalLeadBriefing,
  generateCanonicalLeadBriefing,
  type CanonicalBriefingClaim,
} from '@/lib/server/canonical-lead-briefing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BATCH_SIZE = 3
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

async function processClaim(claim: CanonicalBriefingClaim) {
  try {
    await generateCanonicalLeadBriefing({ claim })
    const status = await finishCanonicalLeadBriefing({ claim, success: true })
    return { success: true, status }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    console.error('[briefing-worker] generation failed', {
      reason: claim.reason,
      revision: claim.revision,
      error: message.slice(0, 500),
    })
    try {
      const status = await finishCanonicalLeadBriefing({ claim, success: false, error: message })
      return { success: false, status }
    } catch (finishError) {
      console.error('[briefing-worker] claim release failed', finishError)
      return { success: false, status: 'claim_release_failed' }
    }
  }
}

export async function GET(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const claims = await claimCanonicalLeadBriefings(BATCH_SIZE)
    const results = await Promise.all(claims.map(processClaim))
    return NextResponse.json({
      claimed: claims.length,
      completed: results.filter((result) => result.success).length,
      retrying: results.filter((result) => !result.success && result.status === 'retry').length,
      failed: results.filter((result) => !result.success && result.status === 'failed').length,
      superseded: results.filter((result) => result.status === 'pending').length,
      statuses: results.map((result) => result.status),
      source: 'canonical_briefing_jobs',
    }, { headers: HEADERS })
  } catch (error) {
    console.error('[briefing-worker] claim failed', error)
    return NextResponse.json({ error: 'Briefing worker is temporarily unavailable.' }, { status: 503, headers: HEADERS })
  }
}
