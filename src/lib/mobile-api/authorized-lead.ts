import { assistantActorCanReadCompanyWide, resolveAssistantActor, type AssistantActor } from '@/lib/assistant/auth'
import { MobileAuthError, requireMobileUser } from '@/lib/mobile-api/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export class MobileLeadAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export type AuthorizedMobileLead = {
  id: string
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  assigned_agent: string | null
}

export type MobileScopedActor = AssistantActor & { assignmentAliases: string[] }

const TRUSTED_ASSIGNMENT_ALIASES: Record<string, string> = {
  'ernest@savingkc.com': 'Ernest',
  'casey@savingkc.com': 'Casey',
  'gertha@savingkc.com': 'Gertha',
}

function normalizeAssignment(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function resolveMobileScopedActor(email: string): Promise<MobileScopedActor | null> {
  const actor = await resolveAssistantActor(email)
  if (!actor) return null
  if (assistantActorCanReadCompanyWide(actor)) return { ...actor, assignmentAliases: [] }
  const { data, error } = await supabaseAdmin().from('agent_profiles')
    .select('email,full_name').eq('email', email).maybeSingle()
  if (error || !data || String(data.email || '').trim().toLowerCase() !== email) return null
  const registeredName = String(data.full_name || '').trim()
  if (!registeredName) return null
  return {
    ...actor,
    assignmentAliases: [registeredName, TRUSTED_ASSIGNMENT_ALIASES[email]]
      .filter((value): value is string => Boolean(value)),
  }
}

export function mobileActorCanReadAssignedLead(actor: MobileScopedActor, assignedAgent: unknown): boolean {
  if (assistantActorCanReadCompanyWide(actor)) return true
  const assignment = normalizeAssignment(String(assignedAgent || ''))
  return Boolean(assignment) && actor.assignmentAliases.some((alias) => normalizeAssignment(alias) === assignment)
}

/** Use the bearer subject and the same CRM actor visibility rule as canonical briefings. */
export async function requireAuthorizedMobileLead(req: Request, leadId: string) {
  const { user } = await requireMobileUser(req)
  const email = user.email?.trim().toLowerCase()
  if (!email) throw new MobileAuthError('Authenticated user has no email')
  const actor = await resolveMobileScopedActor(email)
  if (!actor) throw new MobileLeadAccessError('CRM profile not authorized', 403)
  const { data, error } = await supabaseAdmin().from('leads')
    .select('id, property_address, city, state, zip, assigned_agent')
    .eq('id', leadId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new MobileLeadAccessError('Lead not found', 404)
  if (!mobileActorCanReadAssignedLead(actor, data.assigned_agent)) {
    throw new MobileLeadAccessError('This contact is outside your authorized scope', 403)
  }
  return { actor, lead: data as AuthorizedMobileLead }
}
