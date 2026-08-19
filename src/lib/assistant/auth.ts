import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type AssistantActor = {
  email: string
  fullName: string
  role: string
  access: 'owner' | 'admin' | 'agent'
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function authorizeAssistantRequest(request: Request): { email: string } | null {
  const configuredSecret = process.env.CRM_ASSISTANT_API_SECRET?.trim()
  const suppliedSecret = request.headers.get('x-crm-assistant-secret')?.trim()
  if (!configuredSecret || !suppliedSecret || !safeEqual(configuredSecret, suppliedSecret)) {
    console.warn('[assistant-auth] rejected credential', {
      hasConfiguredSecret: Boolean(configuredSecret),
      suppliedSecretLength: suppliedSecret?.length ?? 0,
    })
    return null
  }

  const email = request.headers.get('x-savingkc-user-email')?.trim().toLowerCase()
  if (!email) return null

  const allowedEmails = new Set(
    (process.env.CRM_ASSISTANT_ALLOWED_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )

  if (!allowedEmails.has(email)) {
    console.warn('[assistant-auth] rejected identity', { hasEmail: true, allowedEmailCount: allowedEmails.size })
    return null
  }
  return { email }
}

function configuredOwnerEmails(): Set<string> {
  return new Set(
    (process.env.CRM_ASSISTANT_OWNER_EMAILS || 'ernest@savingkc.com')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

export async function resolveAssistantActor(email: string): Promise<AssistantActor | null> {
  const normalizedEmail = email.trim().toLowerCase()
  const owners = configuredOwnerEmails()
  const { data, error } = await supabaseAdmin()
    .from('agent_profiles')
    .select('email, full_name, role, is_admin')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (error && !owners.has(normalizedEmail)) {
    console.error('[assistant-auth] profile lookup failed', { code: error.code })
    return null
  }

  const fullName = String(data?.full_name || normalizedEmail.split('@')[0] || 'Unknown').trim()
  const role = String(data?.role || (owners.has(normalizedEmail) ? 'owner' : 'agent')).trim()
  const access = owners.has(normalizedEmail) ? 'owner' : data?.is_admin ? 'admin' : 'agent'
  return { email: normalizedEmail, fullName, role, access }
}

export function assistantActorCanReadCompanyWide(actor: AssistantActor): boolean {
  return actor.access === 'owner' || actor.access === 'admin'
}
