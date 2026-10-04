import { assistantActorCanReadCompanyWide } from '@/lib/assistant/auth'
import { MobileAuthError, requireMobileUser } from '@/lib/mobile-api/auth'
import {
  mobileActorCanReadAssignedLead,
  requireAuthorizedMobileLead,
  resolveMobileScopedActor,
  type MobileScopedActor,
} from '@/lib/mobile-api/authorized-lead'
import { normalizeWorkItemKey } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

export class MobileCommandAccessError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) { super(message) }
}

function actorLabel(actor: MobileScopedActor) {
  return { email: actor.email, name: actor.fullName }
}

export async function requireMobileCommandActor(req: Request) {
  const { user } = await requireMobileUser(req)
  const email = user.email?.trim().toLowerCase()
  if (!email) throw new MobileAuthError('Authenticated user has no email')
  const actor = await resolveMobileScopedActor(email)
  if (!actor) throw new MobileCommandAccessError('CRM profile not authorized', 403)
  return { actor: actorLabel(actor), scopedActor: actor }
}

export async function requireAuthorizedMobileAppointment(req: Request, appointmentId: string) {
  const identity = await requireMobileCommandActor(req)
  const { data, error } = await supabaseAdmin().from('appointments')
    .select('id,lead_id,assigned_to,mobile_appointment_calendar_sync(owner_email)').eq('id', appointmentId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new MobileCommandAccessError('Appointment not found', 404)
  if (data.lead_id) await requireAuthorizedMobileLead(req, data.lead_id)
  else {
    const owners = data.mobile_appointment_calendar_sync
    const owner = Array.isArray(owners) ? owners[0]?.owner_email : (owners as { owner_email?: string } | null)?.owner_email
    if (owner !== identity.actor.email) {
      throw new MobileCommandAccessError('This appointment is outside your authorized scope', 403)
    }
  }
  return { ...identity, leadId: data.lead_id as string | null }
}

export async function requireAuthorizedMobileWorkItem(req: Request, inputKey: string) {
  const identity = await requireMobileCommandActor(req)
  const key = normalizeWorkItemKey(inputKey)
  if (!key) throw new MobileCommandAccessError('Work item id is required', 400)
  const { data, error } = await supabaseAdmin().from('work_items')
    .select('work_item_key,lead_id,assigned_to,due_at').eq('work_item_key', key).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new MobileCommandAccessError('Work item not found', 404)
  if (data.lead_id) await requireAuthorizedMobileLead(req, data.lead_id)
  else if (!assistantActorCanReadCompanyWide(identity.scopedActor)
    && !mobileActorCanReadAssignedLead(identity.scopedActor, data.assigned_to)) {
    throw new MobileCommandAccessError('This work item is outside your authorized scope', 403)
  }
  return { ...identity, key, dueAt: data.due_at as string | null }
}
