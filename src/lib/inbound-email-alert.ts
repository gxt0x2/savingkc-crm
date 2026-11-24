import { afterRequest } from '@/lib/after-request'
import { getDisplayLeadName, shouldUsePhoneAsName } from '@/lib/contact-display'
import { sendMobilePushToUsers } from '@/lib/mobile-push'
import { sendPushToUser } from '@/lib/push-notifications'
import { supabaseAdmin } from '@/lib/supabase/admin'

const DEFAULT_OWNER_EMAIL = 'ernest@savingkc.com'
const COMPANY_MAIL_DOMAIN = '@savingkc.com'

export type InboundEmailAlert = {
  leadId: string
  activityId: string
  subject: string
  snippet: string
  bodyText?: string | null
}

const EMAIL_PUSH_BODY_CAP = 150

function collapsed(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

/** Preview line for an email push: the stored snippet, otherwise the start of the plain body. */
export function inboundEmailPushBody(snippet: string | null | undefined, bodyText?: string | null): string {
  const preview = collapsed(snippet)
  if (preview) return preview.slice(0, EMAIL_PUSH_BODY_CAP)
  const text = collapsed(bodyText)
  if (text) return text.slice(0, EMAIL_PUSH_BODY_CAP)
  return 'New email'
}

type LeadAlertRow = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  assigned_agent: string | null
}

function normalizedEmail(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function ownerEmail(): string {
  return normalizedEmail(process.env.OWNER_EMAIL) || DEFAULT_OWNER_EMAIL
}

export function inboundEmailRecipientEmails(assignedAgent: string | null | undefined, owner = ownerEmail()): string[] {
  const emails: string[] = []
  const seen = new Set<string>()
  const add = (email: string) => {
    const normalized = normalizedEmail(email)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    emails.push(normalized)
  }
  const agentName = (assignedAgent || '').trim().split(/\s+/)[0]
  if (agentName) add(`${agentName.toLowerCase()}${COMPANY_MAIL_DOMAIN}`)
  add(owner)
  return emails
}

function alertTitle(lead: LeadAlertRow): string {
  const name = lead.full_name?.trim() || ''
  if (name && !shouldUsePhoneAsName(name)) return getDisplayLeadName(name, lead.phone)
  const sender = lead.email?.trim()
  if (sender) return sender
  return getDisplayLeadName(name, lead.phone)
}

function alertSubtitle(subject: string): string {
  return collapsed(subject)
}

async function loadLead(leadId: string): Promise<LeadAlertRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('leads')
    .select('id, full_name, phone, email, assigned_agent')
    .eq('id', leadId)
    .maybeSingle()
  if (error) {
    console.error('[inbound-email-alert] lead lookup failed:', error.message)
    return null
  }
  return (data as LeadAlertRow | null) ?? null
}

async function userIdsForEmails(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return []
  const { data, error } = await supabaseAdmin()
    .from('agent_profiles')
    .select('user_id, email')
    .in('email', emails)
  if (error) {
    console.error('[inbound-email-alert] agent profile lookup failed:', error.message)
    return []
  }
  const byEmail = new Map<string, string>()
  for (const profile of (data || []) as Array<{ user_id: string | null; email: string | null }>) {
    const userId = typeof profile.user_id === 'string' ? profile.user_id.trim() : ''
    const email = normalizedEmail(profile.email)
    if (!userId || !email || byEmail.has(email)) continue
    byEmail.set(email, userId)
  }
  const seen = new Set<string>()
  const userIds: string[] = []
  for (const email of emails) {
    const userId = byEmail.get(email)
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    userIds.push(userId)
  }
  return userIds
}

export async function notifyInboundEmail(input: InboundEmailAlert): Promise<void> {
  try {
    const lead = await loadLead(input.leadId)
    if (!lead) return

    const userIds = await userIdsForEmails(inboundEmailRecipientEmails(lead.assigned_agent))
    if (userIds.length === 0) return

    const title = alertTitle(lead)
    const subtitle = alertSubtitle(input.subject)
    const body = inboundEmailPushBody(input.snippet, input.bodyText)
    const href = `/conversation/${input.leadId}`
    const eventId = `email_${input.activityId}`
    const data = {
      href,
      kind: 'inbound_email',
      leadId: input.leadId,
      eventId,
    }

    afterRequest(() => Promise.allSettled([
      sendMobilePushToUsers(userIds, { title, ...(subtitle ? { subtitle } : {}), body, data }),
      ...userIds.map((userId) => sendPushToUser(userId, { title, body, url: href, tag: eventId })),
    ]))
  } catch (error) {
    console.error('[inbound-email-alert] notify failed:', error)
  }
}
