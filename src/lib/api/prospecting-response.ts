import { NextResponse } from 'next/server'
import { ProspectingCampaignInputError } from '@/lib/prospecting/campaign-contract'
import { ProspectingCampaignError } from '@/lib/server/prospecting-campaigns'

export const PROSPECTING_NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export function prospectingJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...PROSPECTING_NO_STORE, ...init?.headers } })
}

export function prospectingError(error: unknown) {
  if (error instanceof ProspectingCampaignInputError) return prospectingJson({ error: error.message, code: error.code }, { status: 400 })
  if (error instanceof ProspectingCampaignError) return prospectingJson({ error: error.message, code: error.code, details: error.details }, { status: error.status })
  if (error instanceof SyntaxError) return prospectingJson({ error: 'Request body must be valid JSON', code: 'invalid_json' }, { status: 400 })
  console.error('[prospecting] Unexpected campaign failure', error)
  return prospectingJson({ error: 'Prospecting campaign state is unavailable', code: 'campaign_engine_unavailable' }, { status: 503 })
}
