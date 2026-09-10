import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  assertDialerMutationControl,
  dialerMutationControlErrorResponse,
} from '@/lib/api/dialer-mutation-control'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { createWorkItem, listWorkItems, transitionWorkItem, WorkItemError } from '@/lib/server/work-items'

export const dynamic = 'force-dynamic'

const MAIL_PIECES = new Set(['thank_you', 'letter', 'postcard'])

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function workItemErrorResponse(error: unknown) {
  if (!(error instanceof WorkItemError)) return null
  const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503
  return prospectingJson({ error: error.message }, { status })
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })

  try {
    const input = await request.json() as Record<string, unknown>
    const leadId = text(input.leadId, 80)
    const prospectId = text(input.prospectId, 80)
    const campaignMemberId = text(input.campaignMemberId, 80)
    const dialerSessionId = text(input.dialerSessionId, 80)
    const pieceType = text(input.pieceType, 40) || ''
    const mailState = text(input.mailState, 20) || 'needed'
    const sellerName = text(input.sellerName, 160) || 'seller'
    const propertyAddress = text(input.propertyAddress, 240)
    const notes = text(input.notes, 2_000)
    const rawDueAt = text(input.dueAt, 80)
    const existingKey = text(input.workItemKey, 100)

    if (!leadId && !prospectId) return prospectingJson({ error: 'A Lead or source Prospect is required' }, { status: 400 })
    if (!MAIL_PIECES.has(pieceType)) return prospectingJson({ error: 'Choose a valid mail piece' }, { status: 400 })
    if (mailState !== 'needed' && mailState !== 'sent') return prospectingJson({ error: 'Choose whether the mail is needed or already sent' }, { status: 400 })
    const dueAt = rawDueAt ? new Date(rawDueAt) : null
    if (dueAt && Number.isNaN(dueAt.getTime())) return prospectingJson({ error: 'Choose a valid due date' }, { status: 400 })

    await assertDialerMutationControl({
      request,
      actor,
      sessionId: dialerSessionId,
      subject: { leadId, prospectId, campaignMemberId },
      protectMatchingOpenSession: true,
    })

    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || crypto.randomUUID()
    if (existingKey) {
      if (mailState !== 'sent') return prospectingJson({ error: 'Existing mail can only be marked sent here' }, { status: 400 })
      const [existing] = await listWorkItems({ key: existingKey, limit: 1 })
      if (!existing || existing.kind !== 'mail'
        || (leadId && existing.leadId !== leadId)
        || (prospectId && existing.prospectId !== prospectId)) {
        return prospectingJson({ error: 'Mail work no longer matches this seller. Refresh and try again.' }, { status: 409 })
      }
      if (existing.status === 'completed') return prospectingJson({ created: false, mailAction: existing })
      const result = await transitionWorkItem({ key: existing.key, actor: actor.name, action: 'complete', idempotencyKey, expectedVersion: existing.version })
      return prospectingJson({ created: false, mailAction: result.workItem })
    }

    if (mailState === 'needed' && !dueAt) return prospectingJson({ error: 'Choose when the mail is due' }, { status: 400 })
    const pieceLabel = pieceType === 'thank_you' ? 'Thank-you letter' : pieceType === 'postcard' ? 'Postcard' : 'Letter'
    const created = await createWorkItem({
      actor: actor.name,
      idempotencyKey,
      leadId,
      prospectId,
      kind: 'mail',
      title: `${pieceLabel} for ${sellerName}`,
      notes: [propertyAddress ? `Property: ${propertyAddress}` : null, notes].filter(Boolean).join('\n') || null,
      dueAt: dueAt?.toISOString() || null,
      assignedTo: actor.name,
      department: 'acquisitions',
      role: 'setter',
      priority: 'normal',
      provenance: {
        origin: 'prospecting_wrap_up',
        mail_piece_type: pieceType,
        mail_state: mailState,
        subject_kind: prospectId ? 'prospect' : 'lead',
        prospect_id: prospectId,
        campaign_member_id: campaignMemberId,
        dialer_session_id: dialerSessionId,
      },
    })

    const result = mailState === 'sent'
      ? await transitionWorkItem({
          key: created.workItem.key,
          actor: actor.name,
          action: 'complete',
          idempotencyKey: `${idempotencyKey}:sent`,
          expectedVersion: created.workItem.version,
        })
      : created

    return prospectingJson({
      created: created.created,
      mailAction: result.workItem,
    }, { status: 201 })
  } catch (error) {
    const expectedResponse = dialerMutationControlErrorResponse(error) ?? workItemErrorResponse(error)
    if (expectedResponse) return expectedResponse
    console.error('[prospecting/mail-actions] save failed', error)
    return prospectingJson({ error: 'Mail action could not be saved' }, { status: 500 })
  }
}
