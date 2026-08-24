import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveAssistantActor } from '@/lib/assistant/auth'
import { readAssistantLead360 } from '@/lib/assistant/queries'
import {
  getCanonicalLeadBriefingState,
  queueCanonicalLeadBriefing,
} from '@/lib/server/canonical-lead-briefing'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function response(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...HEADERS, ...init?.headers } })
}

function manifestRetired() {
  return response({
    error: 'Manifest-based briefings were retired. Use a canonical CRM leadId.',
    code: 'manifest_briefing_retired',
  }, { status: 410 })
}

async function authorizedLead(email: string, leadId: string) {
  const actor = await resolveAssistantActor(email)
  if (!actor) return { actor: null, found: false }
  const snapshot = await readAssistantLead360(supabaseAdmin(), actor, leadId)
  return { actor, found: Boolean(snapshot.record) }
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.toLowerCase().includes('forbidden')) return response({ error: 'This contact is outside your authorized scope.' }, { status: 403 })
  console.error('[canonical-briefing] request failed', error)
  return response({ error: 'Lead briefing service is temporarily unavailable.' }, { status: 503 })
}

export async function GET(request: Request) {
  const authenticated = await resolveAuthenticatedActor()
  if (!authenticated) return response({ error: 'Unauthorized' }, { status: 401 })
  const search = new URL(request.url).searchParams
  if (search.has('manifestId')) return manifestRetired()
  const leadId = (search.get('leadId') || '').trim().toLowerCase()
  if (!UUID_PATTERN.test(leadId)) return response({ error: 'A valid leadId is required.' }, { status: 400 })

  try {
    const authorized = await authorizedLead(authenticated.email, leadId)
    if (!authorized.actor) return response({ error: 'CRM profile not authorized' }, { status: 403 })
    if (!authorized.found) return response({ error: 'Contact not found.' }, { status: 404 })
    return response(await getCanonicalLeadBriefingState(leadId))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  const authenticated = await resolveAuthenticatedActor()
  if (!authenticated) return response({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (body && 'manifestId' in body) return manifestRetired()
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim().toLowerCase() : ''
  if (!UUID_PATTERN.test(leadId)) return response({ error: 'A valid leadId is required.' }, { status: 400 })

  try {
    const authorized = await authorizedLead(authenticated.email, leadId)
    if (!authorized.actor) return response({ error: 'CRM profile not authorized' }, { status: 403 })
    if (!authorized.found) return response({ error: 'Contact not found.' }, { status: 404 })
    const revision = await queueCanonicalLeadBriefing({
      leadId,
      reason: 'manual_refresh',
      requestedBy: authorized.actor.email,
      delaySeconds: 0,
    })
    return response({
      queued: true,
      leadId,
      revision,
      status: 'pending',
      message: 'A governed briefing refresh is queued.',
    }, { status: 202 })
  } catch (error) {
    return failure(error)
  }
}
