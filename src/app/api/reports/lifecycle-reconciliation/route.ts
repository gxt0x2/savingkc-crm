export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { attestLegacyHandoff } from '@/lib/server/crm-operating-handoffs'
import { getLifecycleReconciliationSnapshot } from '@/lib/server/lifecycle-reconciliation'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET() {
  const startedAt = performance.now()
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) return unauthorized
  try {
    const snapshot = await getLifecycleReconciliationSnapshot()
    return NextResponse.json(snapshot, {
      headers: { ...NO_STORE, 'Server-Timing': `lifecycle-reconciliation;dur=${(performance.now() - startedAt).toFixed(1)}` },
    })
  } catch (error) {
    console.error('[lifecycle-reconciliation] read failed', error)
    return NextResponse.json({ error: 'Lifecycle evidence review is unavailable.' }, { status: 503, headers: NO_STORE })
  }
}

const attestationSchema = z.object({
  kind: z.enum(['seller_handoff', 'assignment_handoff']),
  leadId: z.string().uuid(),
  recordId: z.string().uuid(),
  candidateId: z.string().uuid().nullable().optional(),
  evidenceReference: z.string().trim().min(3).max(500),
  evidenceOccurredAt: z.string().datetime({ offset: true }),
  confirmed: z.literal(true),
})

export async function POST(request: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const parsed = attestationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Complete the evidence reference, date, and confirmation.' }, { status: 400, headers: NO_STORE })
  try {
    const handoff = await attestLegacyHandoff({
      kind: parsed.data.kind,
      leadId: parsed.data.leadId,
      recordId: parsed.data.recordId,
      candidateId: parsed.data.candidateId ?? null,
      evidenceReference: parsed.data.evidenceReference,
      evidenceOccurredAt: parsed.data.evidenceOccurredAt,
      actorEmail: actor.email,
      actorName: actor.name,
    })
    return NextResponse.json({ handoff }, { headers: NO_STORE })
  } catch (error) {
    console.error('[lifecycle-reconciliation] attestation failed', error)
    return NextResponse.json({ error: 'The evidence could not be recorded. Refresh the record and verify its links.' }, { status: 409, headers: NO_STORE })
  }
}
